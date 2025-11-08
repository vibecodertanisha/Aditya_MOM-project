const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('./meetings.db'); // Path to your SQLite database file

// Create the table if it doesn't exist
db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS meetings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      meetingName TEXT,
      attendees TEXT,
      present_by_date TEXT
    )
  `);
});

module.exports = {
  // Get all meetings
  getAllMeetings: () => {
    return new Promise((resolve, reject) => {
      db.all("SELECT * FROM meetings", (err, rows) => {
        if (err) {
          reject({ success: false, message: err.message });
        } else {
          resolve(rows);
        }
      });
    });
  },

  // Add a new meeting
  addMeeting: (meeting) => {
    return new Promise((resolve, reject) => {
      const { meetingName, attendees, present_by_date } = meeting;

      // Ensure attendees is always a comma-separated string
      const attendeesStr = Array.isArray(attendees) ? attendees.join(', ') : attendees;
      const presentByDateStr = JSON.stringify(present_by_date || {});

      db.run(
        `INSERT INTO meetings (meetingName, attendees, present_by_date) VALUES (?, ?, ?)`,
        [meetingName, attendeesStr, presentByDateStr],
        function (err) {
          if (err) {
            reject({ success: false, message: err.message });
          } else {
            resolve({
              id: this.lastID,
              meetingName,
              attendees: attendeesStr,
              present_by_date: presentByDateStr,
            });
          }
        }
      );
    });
  },

  // Get distinct meeting names
  getDistinctMeetingNames: () => {
    return new Promise((resolve, reject) => {
      db.all("SELECT DISTINCT meetingName FROM meetings", (err, rows) => {
        if (err) {
          reject({ success: false, message: err.message });
        } else {
          resolve(rows.map((row) => row.meetingName));
        }
      });
    });
  },

  // Get attendance summary for a specific meeting and month
  getAttendanceSummary: (meetingName, month) => {
    return new Promise((resolve, reject) => {
      db.all("SELECT * FROM meetings WHERE meetingName = ?", [meetingName], (err, rows) => {
        if (err) {
          reject({ success: false, message: err.message });
        } else {
          const attendeesSet = new Set();
          const dateMap = {};

          rows.forEach((m) => {
            // Process attendees (comma-separated string)
            const baseAttendees = m.attendees.split(',').map((a) => a.trim());
            baseAttendees.forEach((a) => attendeesSet.add(a));

            // Parse 'present_by_date' field (JSON string)
            const presentByDate = m.present_by_date ? JSON.parse(m.present_by_date) : {};

            // Aggregate attendance by date
            Object.entries(presentByDate).forEach(([date, presentList]) => {
              if (date.startsWith(month)) {
                if (!dateMap[date]) dateMap[date] = [];
                dateMap[date].push(...presentList);
              }
            });
          });

          resolve({
            attendees: Array.from(attendeesSet),
            dates: dateMap,
          });
        }
      });
    });
  },
};
