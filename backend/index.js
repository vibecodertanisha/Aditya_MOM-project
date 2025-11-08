// backend/index.js
// -----------------------------------------------------------------------------
// Meeting Management System – PostgreSQL backend + serve Vite build (../dist)
// -----------------------------------------------------------------------------

// 1) Load env first
require('dotenv').config();

// 2) Imports (declare each ONLY once)
const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const { parse } = require('csv-parse');

// 3) App + config
const app = express();
const PORT = Number(process.env.PORT || 5000);
// If your server is accessed by IP:PORT (e.g., 10.36.85.113:5000)
// set BASE_HOST=10.36.85.113 (NO :PORT)
const BASE_HOST = process.env.BASE_HOST || null;

// 4) PostgreSQL pool
const db = new Pool({
  user: process.env.PGUSER || 'postgres',
  host: process.env.PGHOST || 'localhost',
  database: process.env.PGDATABASE || 'meeting_management',
  password: process.env.PGPASSWORD || '',
  port: Number(process.env.PGPORT || 5432),
});

// quick connection test
db.connect()
  .then((client) => {
    client.release();
    console.log('✅ Connected to PostgreSQL');
  })
  .catch((err) => {
    console.error('❌ Error connecting to PostgreSQL:', err);
    process.exit(1);
  });

// 5) Middleware
const corsOptions = {
  origin: ['http://10.36.81.141:5174', 'http://localhost:5174', '*'],
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: false,
};
app.use(cors(corsOptions));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use((req, _res, next) => {
  console.log(`[${req.method}] ${req.originalUrl}`);
  next();
});

// 6) Optional mail routes
try {
  const mailRoutes = require('./mailServer');
  app.use(mailRoutes);
} catch (e) {
  console.warn('ⓘ mailServer not found or failed to load. Skipping mail routes.');
}

// 7) Uploads (Photos)
const UPLOAD_DIR = path.join(__dirname, 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });
app.use('/uploads', express.static(UPLOAD_DIR));

const photoStorage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename: (_req, file, cb) => {
    const ext = (path.extname(file.originalname || '').toLowerCase() || '.jpg');
    const safeExt = ['.jpg', '.jpeg', '.png'].includes(ext) ? ext : '.jpg';
    cb(null, `user-${Date.now()}-${Math.round(Math.random() * 1e9)}${safeExt}`);
  },
});
const photoUpload = multer({
  storage: photoStorage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (!/image\/(png|jpe?g)$/i.test(file.mimetype || '')) {
      return cb(new Error('Only PNG/JPG images are allowed'));
    }
    cb(null, true);
  },
});

// 8) CSV upload (temp)
const upload = multer({
  dest: path.join(__dirname, 'uploads_tmp'),
  limits: { fileSize: 20 * 1024 * 1024 }, // 20MB
});

// 9) Schema – ensure tables (date_of_meeting is TIMESTAMPTZ)
async function initTables() {
  const sql = `
  CREATE TABLE IF NOT EXISTS users (
    user_id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    department TEXT,
    manager_name TEXT,
    photo TEXT
  );

  CREATE TABLE IF NOT EXISTS meetings (
    meeting_id SERIAL PRIMARY KEY,
    meeting_name TEXT NOT NULL,
    organizer_email TEXT NOT NULL,
    date_of_meeting timestamptz NOT NULL,   -- store date + time
    attendees TEXT NOT NULL,
    department TEXT,
    company TEXT,
    plant TEXT,
    present_by_date JSONB,
    created BIGINT
  );

  CREATE TABLE IF NOT EXISTS mom_table (
    mom_id SERIAL PRIMARY KEY,
    meeting_id INTEGER REFERENCES meetings(meeting_id) ON DELETE CASCADE,
    name TEXT,
    job TEXT,
    deadline TEXT,
    remark TEXT,
    assigned_by TEXT,
    category TEXT,
    status TEXT,
    status_color TEXT,
    email TEXT,
    deadline_history JSONB DEFAULT '[]'::jsonb
  );

  CREATE TABLE IF NOT EXISTS sticky_notes (
    sticky_note_id SERIAL PRIMARY KEY,
    meeting_id INTEGER REFERENCES meetings(meeting_id) ON DELETE CASCADE,
    message TEXT NOT NULL,
    created_by TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    color TEXT DEFAULT 'yellow'
  );
  `;
  await db.query(sql);
  console.log('✅ Tables ensured');
}

// 10) Helpers for CSV user import
const HEADER_MAP = {
  name: ['name', 'employee name', 'full name'],
  email: ['email', 'official email', 'mail', 'email id'],
  password: ['password', 'pwd', 'pass'],
  department: ['department', 'dept'],
  manager_name: ['manager_name', 'manager', 'reporting manager'],
  photo: ['photo', 'avatar', 'image', 'photo_url'],
};
function buildColumnIndex(headerRow) {
  const H = headerRow.map((h) => String(h ?? '').trim().toLowerCase());
  const idx = {};
  for (const [dbKey, aliases] of Object.entries(HEADER_MAP)) {
    let found = -1;
    for (const a of aliases) {
      const j = H.indexOf(a);
      if (j !== -1) {
        found = j;
        break;
      }
    }
    idx[dbKey] = found; // -1 = missing
  }
  return idx;
}
function pick(row, j) {
  return j >= 0 ? String(row[j] ?? '').trim() : '';
}

// 11) Users API
app.post('/api/register', async (req, res) => {
  const { name, email, password, department, manager_name, photo } = req.body;
  try {
    const result = await db.query(
      `INSERT INTO users (name, email, password, department, manager_name, photo)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING user_id`,
      [name, email, password, department, manager_name, photo]
    );
    res.status(201).json({ message: 'User registered successfully', user_id: result.rows[0].user_id });
  } catch (err) {
    res.status(500).json({ message: 'Error adding user', error: err.message });
  }
});

app.get('/api/users', async (_req, res) => {
  try {
    const result = await db.query('SELECT * FROM users');
    const camel = result.rows.map((row) => ({
      userId: row.user_id,
      name: row.name,
      email: row.email,
      department: row.department,
      managerName: row.manager_name,
      photo: row.photo,
    }));
    res.json(camel);
  } catch (err) {
    res.status(500).json({ message: 'Error fetching users', error: err.message });
  }
});

app.post('/api/users/import', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ message: 'CSV file is required (field: file)' });

  const filePath = req.file.path;
  const results = { inserted: 0, skipped: 0, errors: [] };
  let headerIndex = null;
  let rowNum = 0;

  const stream = fs.createReadStream(filePath).pipe(parse({ trim: true }));

  const client = await db.connect();
  try {
    await client.query('BEGIN');

    // NOTE: this event handler uses await, which Node handles, but events will still stream in.
    // For very large CSVs you might prefer a pipeline + pause/resume to control concurrency.
    stream.on('data', async (row) => {
      rowNum++;
      try {
        // header
        if (rowNum === 1) {
          headerIndex = buildColumnIndex(row);
          if (headerIndex.name === -1 || headerIndex.email === -1) {
            results.errors.push('CSV must have at least "Name" and "Email" headers.');
            stream.destroy();
          }
          return;
        }
        if (!headerIndex) return;

        const name = pick(row, headerIndex.name);
        const email = pick(row, headerIndex.email).toLowerCase();
        if (!name || !email) {
          results.skipped++;
          return;
        }

        const password = pick(row, headerIndex.password) || 'changeme123';
        const department = pick(row, headerIndex.department);
        const manager_name = pick(row, headerIndex.manager_name);
        const photo = pick(row, headerIndex.photo) || null;

        // Upsert on email
        await client.query(
          `
            INSERT INTO users (name, email, password, department, manager_name, photo)
            VALUES ($1, $2, $3, $4, $5, $6)
            ON CONFLICT (email) DO UPDATE SET
              name = EXCLUDED.name,
              password = EXCLUDED.password,
              department = EXCLUDED.department,
              manager_name = EXCLUDED.manager_name,
              photo = EXCLUDED.photo
          `,
          [name, email, password, department, manager_name, photo]
        );
        results.inserted++;
      } catch (e) {
        results.errors.push(`Row ${rowNum}: ${e.message}`);
      }
    });

    stream.on('end', async () => {
      try {
        await client.query('COMMIT');
      } catch (e2) {
        results.errors.push(e2.message);
      } finally {
        client.release();
      }
      fs.unlink(filePath, () => {});
      res.json(results);
    });

    stream.on('error', async (err) => {
      results.errors.push(err.message);
      try {
        await client.query('ROLLBACK');
      } catch (_) {}
      client.release();
      fs.unlink(filePath, () => {});
      res.status(400).json(results);
    });
  } catch (outerErr) {
    try {
      await client.query('ROLLBACK');
    } catch (_) {}
    client.release();
    fs.unlink(filePath, () => {});
    res.status(500).json({ message: 'Import failed', error: outerErr.message });
  }
});

app.post('/api/users/me/photo', photoUpload.single('photo'), async (req, res) => {
  const email = (req.body.email || '').trim();
  if (!email) return res.status(400).json({ message: 'Email is required' });
  if (!req.file) return res.status(400).json({ message: 'No photo uploaded' });

  const relativePath = `/uploads/${req.file.filename}`;
  // Build absolute URL
  const host = BASE_HOST || req.get('host');
  const absoluteUrl = `${req.protocol}://${host}${relativePath}`;

  try {
    const result = await db.query('UPDATE users SET photo = $1 WHERE email = $2', [
      absoluteUrl,
      email,
    ]);
    if (result.rowCount === 0) return res.status(404).json({ message: 'User not found' });
    res.json({ photoUrl: absoluteUrl });
  } catch (err) {
    res.status(500).json({ message: 'DB error updating photo', error: err.message });
  }
});

app.post('/api/login', async (req, res) => {
  const { email, password } = req.body;
  try {
    const q = await db.query(
      'SELECT name, email, department, manager_name, photo FROM users WHERE email = $1 AND password = $2',
      [email, password]
    );
    if (q.rowCount === 0) return res.status(401).json({ message: 'Invalid credentials' });

    let photo = q.rows[0].photo || '/avatar.png';
    if (photo.startsWith('/uploads/')) {
      const host = BASE_HOST || req.get('host');
      photo = `${req.protocol}://${host}${photo}`;
    }
    res.json({
      name: q.rows[0].name,
      email: q.rows[0].email,
      department: q.rows[0].department,
      manager_name: q.rows[0].manager_name,
      photo,
    });
  } catch (err) {
    res.status(500).json({ message: 'Error fetching user', error: err.message });
  }
});

// 12) Meetings API
app.get('/api/meetings', async (_req, res) => {
  try {
    const rows = (await db.query('SELECT * FROM meetings ORDER BY created DESC')).rows;

    // Fetch sticky notes per meeting (simple N+1 for clarity)
    const enhanced = await Promise.all(
      rows.map(async (row) => {
        const notes = (
          await db.query(
            'SELECT message, color FROM sticky_notes WHERE meeting_id = $1',
            [row.meeting_id]
          )
        ).rows;

        return {
          ...row,
          meetingName: row.meeting_name,
          organizerEmail: row.organizer_email,
          dateOfMeeting: row.date_of_meeting,
          presentByDate:
            typeof row.present_by_date === 'string'
              ? JSON.parse(row.present_by_date || '{}')
              : row.present_by_date || {},
          stickyNotes: notes || [],
          meeting_id: row.meeting_id,
        };
      })
    );

    res.json(enhanced);
  } catch (err) {
    res.status(500).json({ message: 'Error fetching meetings', error: err.message });
  }
});

app.post('/api/meetings', async (req, res) => {
  const {
    meetingName,
    organizerEmail,
    meetingDate,                 // optional: "YYYY-MM-DD"
    meetingTime,                 // optional: "HH:mm"
    dateOfMeeting: dateOfMeetingRaw, // optional: prebuilt ISO
    attendees = [],
    department,
    company,
    plant,
    presentByDate = {},
  } = req.body;

  // Build a single timestamp for storage (TIMESTAMPTZ)
  let dateOfMeeting;
  if (dateOfMeetingRaw) {
    dateOfMeeting = dateOfMeetingRaw;
  } else if (meetingDate && meetingTime) {
    const dt = new Date(`${meetingDate}T${meetingTime}`);
    dateOfMeeting = !isNaN(dt) ? dt.toISOString() : new Date().toISOString();
  } else if (meetingDate) {
    dateOfMeeting = new Date(`${meetingDate}T00:00`).toISOString();
  } else {
    dateOfMeeting = new Date().toISOString();
  }

  const attendeesStr = Array.isArray(attendees) ? attendees.join(', ') : attendees || '';
  const presentJSON =
    typeof presentByDate === 'object' ? JSON.stringify(presentByDate) : presentByDate || '{}';

  try {
    const insert = await db.query(
      `
      INSERT INTO meetings (
        meeting_name, organizer_email, date_of_meeting, attendees,
        department, company, plant, present_by_date, created
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
      RETURNING *
      `,
      [
        meetingName || '',
        organizerEmail || '',
        dateOfMeeting,
        attendeesStr,
        department || '',
        company || '',
        plant || '',
        presentJSON,
        Date.now(),
      ]
    );

    const row = insert.rows[0];
    res.status(201).json({
      ...row,
      meetingName: row.meeting_name,
      organizerEmail: row.organizer_email,
      dateOfMeeting: row.date_of_meeting,
      presentByDate:
        typeof row.present_by_date === 'string'
          ? JSON.parse(row.present_by_date || '{}')
          : row.present_by_date || {},
      attendees: row.attendees ? row.attendees.split(',').map((a) => a.trim()) : [],
    });
  } catch (err) {
    console.error('❌ DB Insert Error:', err.message);
    res.status(500).json({ message: 'Error adding meeting', error: err.message });
  }
});

app.post('/api/meetings/:id/attendees', async (req, res) => {
  const meetingId = req.params.id;
  const { name } = req.body;
  if (!name) return res.status(400).json({ message: 'Name is required' });

  try {
    const r = await db.query('SELECT attendees FROM meetings WHERE meeting_id = $1', [meetingId]);
    if (r.rowCount === 0) return res.status(404).json({ message: 'Meeting not found' });

    const current = r.rows[0].attendees ? r.rows[0].attendees.split(',').map((x) => x.trim()) : [];
    if (!current.includes(name)) current.push(name);

    const updatedStr = current.join(', ');
    await db.query('UPDATE meetings SET attendees = $1 WHERE meeting_id = $2', [
      updatedStr,
      meetingId,
    ]);

    res.json({ message: 'Attendee added successfully', attendees: current });
  } catch (err) {
    res.status(500).json({ message: 'Update failed', error: err.message });
  }
});

app.post('/api/meetings/:id/stickynotes', async (req, res) => {
  const meetingId = req.params.id;
  const {
    message,
    created_by = 'Anonymous',
    created_at = new Date().toISOString(),
    color = 'yellow',
  } = req.body;

  if (!message) return res.status(400).json({ message: 'Note message is required' });

  try {
    const ins = await db.query(
      `INSERT INTO sticky_notes (meeting_id, message, created_by, created_at, color)
       VALUES ($1,$2,$3,$4,$5) RETURNING sticky_note_id`,
      [meetingId, message, created_by, created_at, color]
    );
    res.status(201).json({ message: 'Sticky note added', sticky_note_id: ins.rows[0].sticky_note_id });
  } catch (err) {
    res.status(500).json({ message: 'Failed to add sticky note', error: err.message });
  }
});

app.post('/api/meetings/:id/mom', async (req, res) => {
  const meetingId = req.params.id;
  const momEntries = req.body.mom;

  if (!Array.isArray(momEntries)) {
    return res.status(400).json({ message: 'MoM must be an array' });
  }

  const client = await db.connect();
  try {
    await client.query('BEGIN');

    const stmt = `
      INSERT INTO mom_table (
        meeting_id, name, job, deadline, remark, category, assigned_by, status, email,deadline_history
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'[]'::jsonb)
    `;

    for (const row of momEntries) {
      await client.query(stmt, [
        meetingId,
        row.name ?? '',
        row.job ?? '',
        row.deadline ?? '',
        row.remark ?? '',
        row.category ?? '',
        row.assignedBy ?? row.assigned_by ?? '',
        row.status ?? 'Assigned',
        row.email ?? '',
      ]);
    }

    await client.query('COMMIT');
    res.json({ message: 'MoM inserted successfully' });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ message: 'Error inserting MoM', error: err.message });
  } finally {
    client.release();
  }
});

app.get('/api/meetings/:id/mom', async (req, res) => {
  const meetingId = req.params.id;
  try {
    const r = await db.query('SELECT * FROM mom_table WHERE meeting_id = $1', [meetingId]);
    res.json(r.rows);
  } catch (err) {
    res.status(500).json({ message: 'Error fetching MoM', error: err.message });
  }
});

app.post('/api/mom/:id/update-status', async (req, res) => {
  const momId = req.params.id;
  const { status, remark, statusColor, name, email, deadline } = req.body || {};

  try {
    // 1) Load current row
    const curQ = await db.query(
      'SELECT deadline, deadline_history FROM mom_table WHERE mom_id = $1',
      [momId]
    );
    if (curQ.rowCount === 0) {
      return res.status(404).json({ message: 'MoM row not found' });
    }

    const current = curQ.rows[0];
    const currentDeadline = (current.deadline || '').trim();
    const history = Array.isArray(current.deadline_history) ? current.deadline_history : [];

    // 2) Build update fields
    const fields = [];
    const params = [];

    // helper to push field updates
    const pushField = (column, value) => {
      fields.push(`${column} = $${params.length + 1}`);
      params.push(value);
    };

    if (status !== undefined) pushField('status', status);
    if (remark !== undefined) pushField('remark', remark);
    if (statusColor !== undefined) pushField('status_color', statusColor);
    if (name !== undefined) pushField('name', name);
    if (email !== undefined) pushField('email', email);

    // 3) If deadline changed, append a history record then set new deadline + history
    if (deadline !== undefined) {
      const newDeadline = String(deadline || '').trim();
      if (newDeadline && newDeadline !== currentDeadline) {
        const record = {
          old: currentDeadline || null,
          new: newDeadline,
          reason: status || 'updated',
          remark: remark || '',
          by: name || null,
          changedAt: new Date().toISOString(),
        };
        const newHistory = [...history, record];
        pushField('deadline', newDeadline);
        pushField('deadline_history', JSON.stringify(newHistory));
      } else {
        // deadline provided but not changed → still update if caller wants to overwrite blank
        pushField('deadline', newDeadline);
      }
    }

    if (fields.length === 0) {
      return res.status(400).json({ message: 'No fields to update' });
    }

    // Final UPDATE
    const sql = `UPDATE mom_table SET ${fields.join(', ')} WHERE mom_id = $${params.length + 1}`;
    params.push(momId);
    await db.query(sql, params);

    res.json({ message: 'MoM status updated successfully' });
  } catch (err) {
    console.error('update-status error:', err);
    res.status(500).json({ message: 'Failed to update MoM status', error: err.message });
  }
});

app.get('/api/mom/:id/deadline-history', async (req, res) => {
  const momId = req.params.id;
  try {
    const r = await db.query(
      'SELECT deadline, deadline_history FROM mom_table WHERE mom_id = $1',
      [momId]
    );
    if (r.rowCount === 0) return res.status(404).json({ message: 'MoM row not found' });

    const row = r.rows[0];
    const history = Array.isArray(row.deadline_history) ? row.deadline_history : [];
    // newest first (optional)
    history.sort((a, b) => new Date(b.changedAt) - new Date(a.changedAt));

    res.json({
      currentDeadline: row.deadline || null,
      history,
    });
  } catch (err) {
    res.status(500).json({ message: 'Failed to fetch deadline history', error: err.message });
  }
});

app.get('/api/meetings/:id', async (req, res) => {
  const meetingId = req.params.id;
  try {
    const r = await db.query('SELECT * FROM meetings WHERE meeting_id = $1', [meetingId]);
    if (r.rowCount === 0) return res.status(404).json({ message: 'Meeting not found' });

    const row = r.rows[0];
    const notes = (
      await db.query(
        'SELECT message, created_by, created_at, color FROM sticky_notes WHERE meeting_id = $1',
        [meetingId]
      )
    ).rows;

    const attendeesArr = row.attendees ? row.attendees.split(',').map((a) => a.trim()) : [];
    const presentMap =
      typeof row.present_by_date === 'string'
        ? JSON.parse(row.present_by_date || '{}')
        : row.present_by_date || {};

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
      stickyNotes: notes || [],
    });
  } catch (err) {
    res.status(500).json({ message: 'Error fetching meeting', error: err.message });
  }
});

// 13) Utility endpoints
app.get('/meeting-names', async (_req, res) => {
  try {
    const r = await db.query('SELECT DISTINCT meeting_name FROM meetings');
    res.json(r.rows.map((x) => x.meeting_name));
  } catch (err) {
    res.status(500).json({ message: 'Error fetching meeting names', error: err.message });
  }
});

app.get('/attendance-summary', async (req, res) => {
  const { meetingName, month } = req.query;
  if (!meetingName || !month || !/^\d{4}-\d{2}$/.test(month)) {
    return res.status(400).json({ error: 'meetingName and month (YYYY-MM) are required' });
  }

  const [yearStr, monStr] = month.split('-');
  const year = Number(yearStr);
  const mon = Number(monStr); // 1..12
  const monthStart = new Date(year, mon - 1, 1);
  const monthEnd = new Date(year, mon, 0);

  const pad = (n) => String(n).padStart(2, '0');
  const toKey = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;
  const norm = (s) => (s ?? '').toString().trim();
  const normLower = (s) => norm(s).toLowerCase();
  const canonical = (s) => normLower(s).replace(/[^a-z0-9]/g, '');
  const emailLocal = (s) => {
    const at = s.indexOf('@');
    return at > 0 ? s.slice(0, at) : s;
  };
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

  try {
    const r = await db.query(
      'SELECT meeting_id, attendees, present_by_date FROM meetings WHERE meeting_name = $1',
      [meetingName]
    );

    const attendeeCanonToDisplay = new Map();
    const attendeeCanonSet = new Set();

    for (const m of r.rows) {
      const baseAttendees = (m.attendees ? m.attendees.split(',') : []).map(norm).filter(Boolean);
      for (const a of baseAttendees) {
        const c = canonical(a);
        if (c && !attendeeCanonToDisplay.has(c)) {
          attendeeCanonToDisplay.set(c, a);
          attendeeCanonSet.add(c);
        }
      }
    }

    const dateMap = new Map();

    for (const m of r.rows) {
      const presentByDate =
        typeof m.present_by_date === 'string'
          ? JSON.parse(m.present_by_date || '{}')
          : m.present_by_date || {};

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

          const local = emailLocal(p);
          const c1 = canonical(p);
          const c2 = canonical(local);

          if (attendeeCanonToDisplay.has(c2)) {
            bucket.set(c2, attendeeCanonToDisplay.get(c2));
          } else if (attendeeCanonToDisplay.has(c1)) {
            bucket.set(c1, attendeeCanonToDisplay.get(c1));
          } else {
            const fallback = canonical(p);
            if (fallback) {
              if (!bucket.has(fallback)) bucket.set(fallback, p);
              if (!attendeeCanonToDisplay.has(fallback)) {
                attendeeCanonToDisplay.set(fallback, p);
                attendeeCanonSet.add(fallback);
              }
            }
          }
        }
      }
    }

    const attendees = Array.from(attendeeCanonToDisplay.values()).sort((a, b) =>
      a.localeCompare(b, undefined, { sensitivity: 'base' })
    );

    const dates = {};
    const sortedDates = Array.from(dateMap.keys()).sort();
    for (const k of sortedDates) {
      const nameMap = dateMap.get(k);
      dates[k] = Array.from(nameMap.values()).sort((a, b) =>
        a.localeCompare(b, undefined, { sensitivity: 'base' })
      );
    }

    res.json({ attendees, dates });
  } catch (err) {
    res.status(500).json({ message: 'Error fetching attendance summary', error: err.message });
  }
});

// 14) Serve the built Vite app (place AFTER all API routes)
//    This block will not swallow /api/* or /uploads/*.
const DIST_DIR = path.resolve(__dirname, '../dist');
if (fs.existsSync(path.join(DIST_DIR, 'index.html'))) {
  app.use(express.static(DIST_DIR));
  // SPA fallback for any non-API route
  app.get(/^(?!\/(api|uploads)\/).*/, (_req, res) => {
    res.sendFile(path.join(DIST_DIR, 'index.html'));
  });
} else {
  console.warn('⚠️ No dist build found at:', DIST_DIR);
}

// 15) Start server
(async () => {
  await initTables();
  app.listen(PORT, '0.0.0.0', () => {
    const host = BASE_HOST || 'localhost';
    console.log(`✅ Backend running at http://${host}:${PORT}`);
  });
})();
