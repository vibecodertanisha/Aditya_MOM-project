const express = require('express');
const sqlite3 = require('sqlite3').verbose();

const bodyParser = require('body-parser');
const path = require('path');

const fs = require('fs');
const multer = require('multer');
const { parse } = require('csv-parse');

const app = express();
const PORT = 5000;

// Initialize SQLite Database (create a new SQLite file if it doesn't exist)
const db = new sqlite3.Database('./app.db', (err) => {
  if (err) {
    console.error('Error opening database:', err);
  } else {
    console.log('Connected to SQLite database');
  }
});

const cors = require('cors');

const corsOptions = {
  origin: ['http://10.36.85.113:5174', 'http://localhost:5174', '*'],
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: false, // set true only if you use cookies/auth headers cross-origin
};

app.use(cors(corsOptions));


app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

app.use((req, res, next) => {
  console.log(`[${req.method}] ${req.originalUrl}`);
  next();
});

const mailRoutes = require('./mailServer');
app.use(mailRoutes);   

const upload = multer({
  dest: path.join(__dirname, 'uploads_tmp'),
  limits: { fileSize: 20 * 1024 * 1024 } // 20MB
});

const HEADER_MAP = {
  name: ['name','employee name','full name'],
  email: ['email','official email','mail','email id'],
  password: ['password','pwd','pass'],
  department: ['department','dept'],
  manager_name: ['manager_name','manager','reporting manager'],
  photo: ['photo','avatar','image','photo_url']
};

function buildColumnIndex(headerRow) {
  const H = headerRow.map(h => String(h ?? '').trim().toLowerCase());
  const idx = {};
  for (const [dbKey, aliases] of Object.entries(HEADER_MAP)) {
    let found = -1;
    for (const a of aliases) { const j = H.indexOf(a); if (j !== -1) { found = j; break; } }
    idx[dbKey] = found; // -1 = missing
  }
  return idx;
}

function pick(row, j) { return j >= 0 ? String(row[j] ?? '').trim() : ''; }

const UPLOAD_DIR = path.join(__dirname, 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });
app.use('/uploads', express.static(UPLOAD_DIR));

// photo uploader (separate from CSV "upload")
const photoStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const ext = (path.extname(file.originalname || '').toLowerCase() || '.jpg');
    const safeExt = ['.jpg', '.jpeg', '.png'].includes(ext) ? ext : '.jpg';
    cb(null, `user-${Date.now()}-${Math.round(Math.random()*1e9)}${safeExt}`);
  },
});
const photoUpload = multer({
  storage: photoStorage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 2MB
  fileFilter: (req, file, cb) => {
    if (!/image\/(png|jpe?g)$/i.test(file.mimetype || '')) {
      return cb(new Error('Only PNG/JPG images are allowed'));
    }
    cb(null, true);
  },
});

// Create necessary tables if they don't exist
db.serialize(() => {
  // Create the 'users' table
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      user_id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      department TEXT,
      manager_name TEXT,
      photo TEXT
    );
  `);

  // Create the 'meetings' table
  db.run(`
    CREATE TABLE IF NOT EXISTS meetings (
        meeting_id INTEGER PRIMARY KEY AUTOINCREMENT,
        meeting_name TEXT NOT NULL,
        organizer_email TEXT NOT NULL,
        date_of_meeting DATE NOT NULL,
        attendees TEXT NOT NULL,
        department TEXT,
        company TEXT,
        plant TEXT,
        present_by_date TEXT,
        created INTEGER
    );
    `);

  // Create the 'mom_table' for storing MoM (Minutes of Meeting) data
  db.run(`
    CREATE TABLE IF NOT EXISTS mom_table (
      mom_id INTEGER PRIMARY KEY AUTOINCREMENT,
      meeting_id INTEGER,
      name TEXT,
      job TEXT,
      deadline TEXT,
      remark TEXT,
      assigned_by TEXT,
      category TEXT,
      status TEXT,
      status_color TEXT,   
      email TEXT,
      FOREIGN KEY (meeting_id) REFERENCES meetings(meeting_id)
    )
  `);

  // Create the 'sticky_notes' table for storing sticky note messages
  db.run(`
    CREATE TABLE IF NOT EXISTS sticky_notes (
      sticky_note_id INTEGER PRIMARY KEY AUTOINCREMENT,
      meeting_id INTEGER,
      message TEXT NOT NULL,
      created_by TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      color TEXT DEFAULT 'yellow',
      FOREIGN KEY (meeting_id) REFERENCES meetings(meeting_id)
    );
  `);
});

// ------------------- Users API -------------------

// Register new user
app.post('/api/register', (req, res) => {
  const { name, email, password, department, manager_name,photo } = req.body;

  db.run(
    `INSERT INTO users (name, email, password, department, manager_name,photo) VALUES (?, ?, ?, ?, ?, ?)`,
    [name, email, password, department, manager_name,photo],
    function (err) {
      if (err) {
        return res.status(500).json({ message: 'Error adding user', error: err.message });
      }
      res.status(201).json({ message: 'User registered successfully', user_id: this.lastID });
    }
  );
});



// Get all users
app.get('/api/users', (req, res) => {
  db.all('SELECT * FROM users', [], (err, rows) => {
    if (err) {
      return res.status(500).json({ message: 'Error fetching users', error: err.message });
    }
    const camelCaseRows = rows.map(row => ({
    userId: row.user_id,
    name: row.name,
    email: row.email,
    department: row.department,
    managerName: row.manager_name,
    photo: row.photo
    }));
    res.json(camelCaseRows);
  });
});

app.post('/api/users/import', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ message: 'CSV file is required (field: file)' });

  const filePath = req.file.path;
  const results = { inserted: 0, skipped: 0, errors: [] };
  let headerIndex = null;
  let rowNum = 0;

  const stream = fs.createReadStream(filePath).pipe(parse({ trim: true }));

  db.serialize(() => {
    db.run('BEGIN TRANSACTION');

    // Upsert by unique email (requires SQLite >= 3.24.0)
    const stmt = db.prepare(`
      INSERT INTO users (name, email, password, department, manager_name, photo)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(email) DO UPDATE SET
        name=excluded.name,
        password=excluded.password,
        department=excluded.department,
        manager_name=excluded.manager_name,
        photo=excluded.photo
    `);

    stream.on('data', (row) => {
      rowNum++;
      // First row = header
      if (rowNum === 1) {
        headerIndex = buildColumnIndex(row);
        if (headerIndex.name === -1 || headerIndex.email === -1) {
          results.errors.push('CSV must have at least "Name" and "Email" headers.');
          stream.destroy(); // stop
        }
        return;
      }
      if (!headerIndex) return;

      try {
        const name = pick(row, headerIndex.name);
        const email = pick(row, headerIndex.email).toLowerCase();
        if (!name || !email) { results.skipped++; return; }

        const password = pick(row, headerIndex.password) || 'changeme123';
        const department = pick(row, headerIndex.department);
        const manager_name = pick(row, headerIndex.manager_name);
        const photo = pick(row, headerIndex.photo) || null;

        stmt.run([name, email, password, department, manager_name, photo], (err) => {
          if (err) results.errors.push(`Row ${rowNum}: ${err.message}`);
          else results.inserted++; // counts affected (insert or update)
        });
      } catch (e) {
        results.errors.push(`Row ${rowNum}: ${e.message}`);
      }
    });

    stream.on('end', () => {
      stmt.finalize((e1) => {
        if (e1) results.errors.push(e1.message);
        db.run('COMMIT', (e2) => {
          if (e2) results.errors.push(e2.message);
          fs.unlink(filePath, () => {});
          res.json(results);
        });
      });
    });

    stream.on('error', (err) => {
      results.errors.push(err.message);
      db.run('ROLLBACK', () => {
        fs.unlink(filePath, () => {});
        res.status(400).json(results);
      });
    });
  });
});


app.post('/api/users/me/photo', photoUpload.single('photo'), (req, res) => {
  const email = (req.body.email || '').trim();
  if (!email) return res.status(400).json({ message: 'Email is required' });
  if (!req.file) return res.status(400).json({ message: 'No photo uploaded' });

  const relativePath = `/uploads/${req.file.filename}`;
  const absoluteUrl = `${req.protocol}://${req.get('host')}${relativePath}`;

  db.run(`UPDATE users SET photo = ? WHERE email = ?`, [absoluteUrl, email], function (err) {
    if (err) return res.status(500).json({ message: 'DB error updating photo', error: err.message });
    if (this.changes === 0) return res.status(404).json({ message: 'User not found' });
    res.json({ photoUrl: absoluteUrl });
  });
});


app.post('/api/login', (req, res) => {
  const { email, password } = req.body;

  db.get(`SELECT * FROM users WHERE email = ? AND password = ?`, [email, password], (err, row) => {
    if (err) return res.status(500).json({ message: 'Error fetching user', error: err.message });
    if (!row) return res.status(401).json({ message: 'Invalid credentials' });

    let photo = row.photo || '/avatar.png';
    if (photo.startsWith('/uploads/')) {
      photo = `${req.protocol}://${req.get('host')}${photo}`;
    }

    res.json({
      name: row.name,
      email: row.email,
      department: row.department,
      manager_name: row.manager_name,
      photo,
    });
  });
});
// ------------------- Meetings API -------------------

// Get all meetings
app.get('/api/meetings', (req, res) => {
  db.all('SELECT * FROM meetings ORDER BY created DESC', [], async (err, rows) => {
    if (err) {
      return res.status(500).json({ message: 'Error fetching meetings', error: err.message });
    }

    const enhancedMeetings = await Promise.all(
      rows.map(row => {
        return new Promise((resolve, reject) => {
          db.all(
            `SELECT message, color FROM sticky_notes WHERE meeting_id = ?`,
            [row.meeting_id],
            (noteErr, notes) => {
              if (noteErr) {
                return reject(noteErr);
              }

              resolve({
                ...row,
                meetingName: row.meeting_name,
                organizerEmail: row.organizer_email,
                dateOfMeeting: row.date_of_meeting,
                presentByDate: row.present_by_date ? JSON.parse(row.present_by_date) : {},
                stickyNotes: notes || [],
                meeting_id: row.meeting_id
              });
            }
          );
        });
      })
    );

    res.json(enhancedMeetings);
  });
});

// Add new meeting
app.post('/api/meetings', (req, res) => {
  const {
    meetingName,
    organizerEmail,
    dateOfMeeting,
    attendees = [],
    department,
    company,
    plant,
    presentByDate = {} // default to empty object
  } = req.body;

  // Ensure attendees is stored as a comma-separated string
  const attendeesStr = Array.isArray(attendees) ? attendees.join(', ') : attendees || '';

  // Ensure presentByDate is stored as a valid JSON string
  const presentByDateStr = typeof presentByDate === 'object' ? JSON.stringify(presentByDate) : '{}';

  const insertQuery = `
    INSERT INTO meetings (
      meeting_name,
      organizer_email,
      date_of_meeting,
      attendees,
      department,
      company,
      plant,
      present_by_date,
      created
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `;

  const values = [
    meetingName || '',
    organizerEmail || '',
    dateOfMeeting || '',
    attendeesStr,
    department || '',
    company || '',
    plant || '',
    presentByDateStr,
    Date.now()
  ];

  db.run(insertQuery, values, function (err) {
    if (err) {
      console.error('❌ DB Insert Error:', err.message);
      return res.status(500).json({
        message: 'Error adding meeting',
        error: err.message
      });
    }

    db.get(`SELECT * FROM meetings WHERE meeting_id = ?`, [this.lastID], (err2, row) => {
      if (err2) {
        return res.status(500).json({ message: 'Error fetching inserted meeting', error: err2.message });
      }

      res.status(201).json({
        ...row,
        meetingName: row.meeting_name,
        organizerEmail: row.organizer_email,
        dateOfMeeting: row.date_of_meeting,
        presentByDate: row.present_by_date ? JSON.parse(row.present_by_date) : {},
        attendees: row.attendees ? row.attendees.split(',').map(a => a.trim()) : []
      });
    });
  });
});

app.post('/api/meetings/:id/attendees', (req, res) => {
  const meetingId = req.params.id;
  const { name } = req.body;

  if (!name) {
    return res.status(400).json({ message: 'Name is required' });
  }

  db.get(`SELECT attendees FROM meetings WHERE meeting_id = ?`, [meetingId], (err, row) => {
    if (err) return res.status(500).json({ message: 'DB read error', error: err.message });
    if (!row) return res.status(404).json({ message: 'Meeting not found' });

    const current = row.attendees ? row.attendees.split(',').map(x => x.trim()) : [];

    if (!current.includes(name)) current.push(name);
    const updatedStr = current.join(', ');

    db.run(`UPDATE meetings SET attendees = ? WHERE meeting_id = ?`, [updatedStr, meetingId], function (err2) {
      if (err2) {
        return res.status(500).json({ message: 'Update failed', error: err2.message });
      }
      res.json({ message: 'Attendee added successfully', attendees: current });
    });
  });
});

app.post('/api/meetings/:id/stickynotes', (req, res) => {
  const meetingId = req.params.id;
  const {
    message,
    created_by = 'Anonymous',
    created_at = new Date().toISOString(),
    color = 'yellow'
  } = req.body;

  if (!message) {
    return res.status(400).json({ message: 'Note message is required' });
  }

  db.run(
    `INSERT INTO sticky_notes (meeting_id, message, created_by, created_at, color) VALUES (?, ?, ?, ?, ?)`,
    [meetingId, message, created_by, created_at, color],
    function (err) {
      if (err) {
        return res.status(500).json({ message: 'Failed to add sticky note', error: err.message });
      }
      res.status(201).json({
        message: 'Sticky note added',
        sticky_note_id: this.lastID,
      });
    }
  );
});

app.post('/api/meetings/:id/mom', (req, res) => {
  const meetingId = req.params.id;
  const momEntries = req.body.mom;

  if (!Array.isArray(momEntries)) {
    return res.status(400).json({ message: 'MoM must be an array' });
  }

  // include category + accept both assignedBy/assigned_by
  const stmt = db.prepare(`
    INSERT INTO mom_table (
      meeting_id, name, job, deadline, remark, category, assigned_by, status, email
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  for (const row of momEntries) {
    stmt.run(
      meetingId,
      row.name ?? '',
      row.job ?? '',
      row.deadline ?? '',
      row.remark ?? '',
      row.category ?? '',                                  // ← store category
      row.assignedBy ?? row.assigned_by ?? '',             // ← accept both keys
      row.status ?? 'Assigned',
      row.email ?? ''
    );
  }

  stmt.finalize((err) => {
    if (err) {
      return res.status(500).json({ message: 'Error inserting MoM', error: err.message });
    }
    res.json({ message: 'MoM inserted successfully' });
  });
});

app.get('/api/meetings/:id/mom', (req, res) => {
  const meetingId = req.params.id;

  db.all(`SELECT * FROM mom_table WHERE meeting_id = ?`, [meetingId], (err, rows) => {
    if (err) {
      return res.status(500).json({ message: 'Error fetching MoM', error: err.message });
    }
    res.json(rows);
  });
});

app.post('/api/mom/:id/update-status', (req, res) => {
  const momId = req.params.id;
  const { status, remark, statusColor, name, email, deadline } = req.body || {};

  const fields = [];
  const params = [];

  if (status !== undefined)      { fields.push('status = ?');       params.push(status); }
  if (remark !== undefined)      { fields.push('remark = ?');       params.push(remark); }
  if (statusColor !== undefined) { fields.push('status_color = ?'); params.push(statusColor); }
  if (name !== undefined)        { fields.push('name = ?');         params.push(name); }
  if (email !== undefined)       { fields.push('email = ?');        params.push(email); }
  if (deadline !== undefined)    { fields.push('deadline = ?');     params.push(deadline); }

  if (fields.length === 0) {
    return res.status(400).json({ message: 'No fields to update' });
  }

  const sql = `UPDATE mom_table SET ${fields.join(', ')} WHERE mom_id = ?`;
  params.push(momId);

  db.run(sql, params, function (err) {
    if (err) return res.status(500).json({ message: 'Failed to update MoM status', error: err.message });
    res.json({ message: 'MoM status updated successfully' });
  });
});






app.get('/api/meetings/:id', (req, res) => {
  const meetingId = req.params.id;

  db.get('SELECT * FROM meetings WHERE meeting_id = ?', [meetingId], (err, row) => {
    if (err) {
      return res.status(500).json({ message: 'Error fetching meeting', error: err.message });
    }

    if (!row) {
      return res.status(404).json({ message: 'Meeting not found' });
    }

    db.all(
      'SELECT message, created_by, created_at, color FROM sticky_notes WHERE meeting_id = ?',
      [meetingId],
      (noteErr, notes) => {
        if (noteErr) {
          return res.status(500).json({ message: 'Error fetching sticky notes', error: noteErr.message });
        }

        const attendeesArr = row.attendees ? row.attendees.split(',').map(a => a.trim()) : [];
        const presentMap = row.present_by_date ? JSON.parse(row.present_by_date) : {};

        res.json({
          meetingId: row.meeting_id,
          meetingName: row.meeting_name,
          organizerEmail: row.organizer_email,
          dateOfMeeting: row.date_of_meeting,
          attendees: attendeesArr,
          department: row.department,
          company: row.company,
          plant: row.plant,
          presentByDate: presentMap,
          stickyNotes: notes || []
        });
      }
    );
  });
});

// Get distinct meeting names
app.get('/meeting-names', (req, res) => {
  db.all('SELECT DISTINCT meeting_name FROM meetings', [], (err, rows) => {
    if (err) {
      return res.status(500).json({ message: 'Error fetching meeting names', error: err.message });
    }
    res.json(rows.map(row => row.meeting_name));
  });
});

app.get('/attendance-summary', (req, res) => {
  const { meetingName, month } = req.query;
  // month expected "YYYY-MM"
  if (!meetingName || !month || !/^\d{4}-\d{2}$/.test(month)) {
    return res.status(400).json({ error: 'meetingName and month (YYYY-MM) are required' });
  }

  const [yearStr, monStr] = month.split('-');
  const year = Number(yearStr);
  const mon = Number(monStr); // 1..12
  const monthStart = new Date(year, mon - 1, 1);
  const monthEnd = new Date(year, mon, 0);

  // --- helpers -------------------------------------------------
  const pad = (n) => String(n).padStart(2, '0');
  const toKey = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;

  const norm = (s) => (s ?? '').toString().trim();
  const normLower = (s) => norm(s).toLowerCase();

  // remove all non a-z0-9 to make comparison robust
  const canonical = (s) => normLower(s).replace(/[^a-z0-9]/g, '');

  // if email, return local part; else return as-is
  const emailLocal = (s) => {
    const at = s.indexOf('@');
    return at > 0 ? s.slice(0, at) : s;
  };

  // Normalize raw date key like YYYY-M-D / YYYY-MM-DD / YYYY-MM-DDTHH:mm:ss
  const normalizeDateKey = (raw) => {
    const parts = String(raw).split(/[^0-9]+/).filter(Boolean).map(Number);
    if (parts.length >= 3) {
      const [y, m, d] = parts;
      if (y > 1900 && m >= 1 && m <= 12 && d >= 1 && d <= 31) {
        return toKey(y, m, d);
      }
    }
    return null;
  };

  db.all(
    'SELECT meeting_id, attendees, present_by_date FROM meetings WHERE meeting_name = ?',
    [meetingName],
    (err, rows) => {
      if (err) {
        return res.status(500).json({ message: 'Error fetching attendance summary', error: err.message });
      }

      // Build a canonical map of attendees: canon(name) -> Display Name
      const attendeeCanonToDisplay = new Map(); // 'anandkeshri' -> 'Anand Keshri'
      const attendeeCanonSet = new Set();

      for (const m of rows) {
        const baseAttendees = (m.attendees ? m.attendees.split(',') : [])
          .map(norm)
          .filter(Boolean);

        for (const a of baseAttendees) {
          const c = canonical(a);
          if (c && !attendeeCanonToDisplay.has(c)) {
            attendeeCanonToDisplay.set(c, a); // preserve first seen display
            attendeeCanonSet.add(c);
          }
        }
      }

      // dateMap: 'YYYY-MM-DD' -> Map(canon -> Display Name)
      const dateMap = new Map();

      for (const m of rows) {
        const presentByDate = m.present_by_date ? JSON.parse(m.present_by_date) : {};

        for (const [rawDate, presentRaw] of Object.entries(presentByDate)) {
          const key = normalizeDateKey(rawDate);
          if (!key) continue;

          const [y, mm, dd] = key.split('-').map(Number);
          const dt = new Date(y, mm - 1, dd);
          if (dt < monthStart || dt > monthEnd) continue;

          if (!dateMap.has(key)) dateMap.set(key, new Map());
          const bucket = dateMap.get(key);

          const list = Array.isArray(presentRaw) ? presentRaw : [];
          for (const p0 of list) {
            const p = norm(p0);
            if (!p) continue;

            // Try to map p (which can be name or email) to attendee canonical
            const local = emailLocal(p);                  // 'anand.keshri'
            const c1 = canonical(p);                      // 'anandkeshriaditya...' if email with domain
            const c2 = canonical(local);                  // 'anandkeshri'

            // Prefer exact attendee canonical match using c2 (email local) then c1
            let display = null;
            if (attendeeCanonToDisplay.has(c2)) {
              display = attendeeCanonToDisplay.get(c2);
              bucket.set(c2, display);
            } else if (attendeeCanonToDisplay.has(c1)) {
              display = attendeeCanonToDisplay.get(c1);
              bucket.set(c1, display);
            } else {
              // If not found in attendees, still include this person under their canonical key
              const fallback = canonical(p);
              if (fallback) {
                // Use original string as display (email or name), but key on canonical
                if (!bucket.has(fallback)) bucket.set(fallback, p);
                // Also add to attendee list so the table shows them
                if (!attendeeCanonToDisplay.has(fallback)) {
                  attendeeCanonToDisplay.set(fallback, p);
                  attendeeCanonSet.add(fallback);
                }
              }
            }
          }
        }
      }

      // Final attendees array (display names) sorted case-insensitively
      const attendees = Array.from(attendeeCanonToDisplay.values()).sort((a, b) =>
        a.localeCompare(b, undefined, { sensitivity: 'base' })
      );

      // Final dates object: key -> display-name array (sorted)
      const dates = {};
      const sortedDates = Array.from(dateMap.keys()).sort();
      for (const k of sortedDates) {
        const nameMap = dateMap.get(k); // Map(canon -> display)
        dates[k] = Array.from(nameMap.values()).sort((a, b) =>
          a.localeCompare(b, undefined, { sensitivity: 'base' })
        );
      }

      res.json({ attendees, dates });
    }
  );
});

// ------------------- Server Start -------------------

app.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ Backend running at http://10.36.85.113:${PORT}`);
});


