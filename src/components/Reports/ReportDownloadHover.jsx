// ReportDownloadHover.jsx
import React, { useState, useEffect } from 'react';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { Download } from 'lucide-react';

export default function ReportDownloadHover() {
  const [hover, setHover] = useState(false);
  const [selectedMeeting, setSelectedMeeting] = useState('');
  const [selectedMonth, setSelectedMonth] = useState(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`; // YYYY-MM
  });
  const [meetingNames, setMeetingNames] = useState([]);
  const [attendanceData, setAttendanceData] = useState(null);

  // Small helpers
  const norm = (s) => (s ?? '').toString().trim();
  const pad = (n) => String(n).padStart(2, '0');
  const ymd = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;
  const monthOf = (iso) => iso.slice(0, 7); // YYYY-MM
  const toISODate = (dstr) => {
    // tolerant parser; returns 'YYYY-MM-DD'
    if (!dstr) return null;
    const parts = String(dstr).split(/[^0-9]+/).filter(Boolean).map(Number);
    if (parts.length >= 3) {
      const [y, m, d] = parts;
      if (y > 1900 && m >= 1 && m <= 12 && d >= 1 && d <= 31) return ymd(y, m, d);
    }
    // Fallback: try Date
    const dt = new Date(dstr);
    if (!isNaN(dt)) return ymd(dt.getFullYear(), dt.getMonth() + 1, dt.getDate());
    return null;
  };

  // 1) Get distinct meeting names for dropdown
  useEffect(() => {
    fetch('http://10.36.81.141:5000/meeting-names')
      .then((r) => r.json())
      .then((data) => Array.isArray(data) ? setMeetingNames(data) : setMeetingNames([]))
      .catch((e) => console.error('❌ meeting-names:', e));
  }, []);

  // 2) Build attendance purely from meetings table (attendees + date_of_meeting)
  useEffect(() => {
    if (!selectedMeeting || !selectedMonth) return;

    fetch('http://10.36.81.141:5000/api/meetings')
      .then((r) => r.json())
      .then((rows) => {
        // Filter rows by meeting name and the selected month
        const filtered = (Array.isArray(rows) ? rows : []).filter((m) => {
          const name = m.meetingName || m.meeting_name || '';
          if (name !== selectedMeeting) return false;
          const iso = toISODate(m.dateOfMeeting || m.date_of_meeting);
          return iso && monthOf(iso) === selectedMonth;
        });

        // Union of attendees across all occurrences in the month
        const attendeeSet = new Set();
        // Map: YYYY-MM-DD -> Set of present attendees
        const dateMap = new Map();

        for (const m of filtered) {
          const iso = toISODate(m.dateOfMeeting || m.date_of_meeting);
          if (!iso) continue;

          // attendees is stored as CSV in DB (backend normalizes to string or array)
          const attRaw = Array.isArray(m.attendees)
            ? m.attendees
            : (m.attendees || '').split(','); // csv to array

          const cleaned = attRaw.map((a) => norm(a)).filter(Boolean);

          // Add to union
          cleaned.forEach((a) => attendeeSet.add(a));

          // Add to date bucket (these are PRESENT for that day)
          if (!dateMap.has(iso)) dateMap.set(iso, new Set());
          const bucket = dateMap.get(iso);
          cleaned.forEach((a) => bucket.add(a));
        }

        // Shape for the PDF generator:
        // attendees: array of display names (sorted)
        // dates: { 'YYYY-MM-DD': [display names present] }
        const attendees = Array.from(attendeeSet.values()).sort((a, b) =>
          a.localeCompare(b, undefined, { sensitivity: 'base' })
        );
        const dates = {};
        Array.from(dateMap.keys()).sort().forEach((k) => {
          dates[k] = Array.from(dateMap.get(k).values()).sort((a, b) =>
            a.localeCompare(b, undefined, { sensitivity: 'base' })
          );
        });

        setAttendanceData({ attendees, dates });
      })
      .catch((e) => {
        console.error('❌ fetch /api/meetings:', e);
        setAttendanceData(null);
      });
  }, [selectedMeeting, selectedMonth]);

  // 3) Generate PDF (P/A for actual meeting days; blank for non-meeting days)
  const generatePDF = () => {
    if (!attendanceData || !attendanceData.attendees?.length) {
      alert('No data available to download.');
      return;
    }

    const { attendees, dates } = attendanceData;
    const today = new Date();
    today.setHours(0, 0, 0, 0); // local midnight
    const [Y, M] = selectedMonth.split('-').map(Number); // YYYY, MM
    const daysInMonth = new Date(Y, M, 0).getDate();

    

    // days in this month where the meeting actually occurred and is not in the future
    const meetingDays = [];
    for (let d = 1; d <= daysInMonth; d++) {
      const iso = ymd(Y, M, d);
      const cellDate = new Date(Y, M - 1, d);
      if (dates[iso] && cellDate <= today) {
        meetingDays.push(d);
      }
    }
    const totalMeetingsHeld = meetingDays.length;



    // Build headers like "1-Sep"
    const dateLabels = Array.from({ length: daysInMonth }, (_, i) => {
      const day = i + 1;
      const dt = new Date(Y, M - 1, day);
      const mon = dt.toLocaleString('default', { month: 'short' });
      return `${day}-${mon}`;
    });

    const columns = ['Name', ...dateLabels, 'Total Present (Avail %)'];
    const body = [];
    const cellColors = {};
    const COLOR_PRESENT = [198, 239, 206];   // green
    const COLOR_NO_MEETING = [255, 229, 204]; // orange

    const presentCache = {}; // 'YYYY-MM-DD' -> Set(lowercase)
    const getPresentSet = (iso) => {
      if (presentCache[iso]) return presentCache[iso];
      const list = dates[iso] || null;
      if (!list) return (presentCache[iso] = null);
      presentCache[iso] = new Set(list.map((s) => s.toLowerCase()));
      return presentCache[iso];
    };

    attendees.forEach((name, rowIndex) => {
      const nameKey = name.toLowerCase();
      const row = [name];
      let presentCount = 0;

      for (let d = 1; d <= daysInMonth; d++) {
        const iso = ymd(Y, M, d);
        const pset = getPresentSet(iso);
        const colIndex = d; // 0 is Name

        const cellDate = new Date(Y, M - 1, d);
        const isFuture = cellDate > today;

        if (isFuture) {
          // Future day → blank, no color
          row.push('');
          continue;
        }

        if (pset === null) {
          // Past/Today with no meeting → orange, blank cell
          row.push('');
          cellColors[`${rowIndex}-${colIndex}`] = COLOR_NO_MEETING;
        } else {
          const isPresent = pset.has(nameKey);
          row.push(isPresent ? 'P' : 'A');
          if (isPresent) {
            cellColors[`${rowIndex}-${colIndex}`] = COLOR_PRESENT; // green
            presentCount++;
          }
          // Absent → no color
        }
      }

      const availabilityPct = totalMeetingsHeld > 0
        ? Math.round((presentCount / totalMeetingsHeld) * 100)
        : 0;

      // show "present/held (XX%)"
      row.push(`${presentCount}/${totalMeetingsHeld} (${availabilityPct}%)`);
      body.push(row);
    });

    try {
      const doc = new jsPDF({ orientation: 'landscape' });
      doc.setFontSize(10);
      doc.text(`Attendance – ${selectedMeeting} | ${selectedMonth}`, 14, 10);

      autoTable(doc, {
        startY: 15,
        head: [columns],
        body,
        styles: { fontSize: 6, cellPadding: 1.5, halign: 'center', valign: 'middle' },
        columnStyles: { 0: { cellWidth: 30 }, [columns.length - 1]: { cellWidth: 22 } },
        theme: 'grid',
        tableWidth: 'auto',
        didParseCell: (data) => {
          if (data.section !== 'body') return;
          const key = `${data.row.index}-${data.column.index}`;
          const bg = cellColors[key];
          if (bg) data.cell.styles.fillColor = bg;
        },
      });

      doc.save(`Attendance_Report_${selectedMonth}.pdf`);
    } catch (err) {
      console.error('❌ Error generating PDF:', err);
      alert('Failed to generate report.');
    }
  };

  return (
    <div
      className="relative"
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      <button className="p-2 text-gray-700 hover:text-blue-600" title="Download Attendance PDF">
        <Download size={20} />
      </button>

      {hover && (
        <div className="absolute right-0 top-10 bg-white shadow-lg rounded-lg p-4 z-50 w-64 border border-gray-300">
          <h3 className="text-sm font-semibold mb-2 text-gray-700">Download Attendance Report</h3>

          <select
            value={selectedMeeting}
            onChange={(e) => setSelectedMeeting(e.target.value)}
            className="w-full mb-2 p-1 border rounded"
          >
            <option value="">Select Meeting</option>
            {meetingNames.map((m, i) => (
              <option key={i} value={m}>{m}</option>
            ))}
          </select>

          <input
            type="month"
            value={selectedMonth}
            onChange={(e) => setSelectedMonth(e.target.value)}
            className="w-full mb-3 p-1 border rounded"
          />

          <button
            onClick={generatePDF}
            className="bg-blue-600 text-white px-4 py-1 rounded text-sm w-full hover:bg-blue-700"
          >
            Download PDF
          </button>
        </div>
      )}
    </div>
  );
}
