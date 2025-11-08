// MainPage.jsx — fix avatar popover off-screen (clamped to viewport) + blue pill search + inline Advanced + jump-to-meeting & jump-to-MoM-row
import React, { useState, useEffect, useMemo, useRef, useLayoutEffect } from 'react';
import {
  Moon,
  Sun,
  Users,
  ChevronLeft,
  ChevronRight,
  SlidersHorizontal,
  SortAsc,
  SortDesc,
  Search,
  StickyNote,
  Camera,
  X,
  Eye,
} from 'lucide-react';
import useDarkMode from '../../hooks/useDarkMode';
import { useAuth } from '../../context/AuthContext';
import NewMeetingModal from '../Meeting/NewMeetingModal';
import { useMeetings } from '../../context/MeetingContext';
import * as XLSX from 'xlsx';
import ActionModal from '../Modals/ActionModal';
import ReportDownloadHover from '../Reports/ReportDownloadHover';

/* ===================== Status Colors ===================== */
export const ROW_COLORS = {
  completed: '#bbf7d0', // green
  reassigned: '#bae6fd', // blue
  rejected: '#fecaca',   // red
  needTime: '#fed7aa',   // orange
};

const normalize = (s) => (s ?? '').toString().trim().toLowerCase();

const statusTextClass = (s = '') => {
  const t = normalize(s);
  if (t === 'completed') return 'text-green-700 font-medium';
  if (t === 'rejected') return 'text-red-700 font-medium';
  if (t === 'need time') return 'text-orange-700 font-medium';
  if (t === 'reassigned') return 'text-blue-700 font-medium';
  return '';
};

const groupSeverity = (members) => {
  const statuses = members.map((m) => normalize(m.status));
  if (statuses.length && statuses.every((s) => s === 'completed')) return 'completed';
  if (statuses.some((s) => s === 'rejected')) return 'rejected';
  if (statuses.some((s) => s === 'need time')) return 'needTime';
  if (statuses.some((s) => s === 'reassigned')) return 'reassigned';
  return 'default';
};

const COLOR_BY_SEVERITY = {
  completed: ROW_COLORS.completed,
  reassigned: ROW_COLORS.reassigned,
  rejected: ROW_COLORS.rejected,
  needTime: ROW_COLORS.needTime,
  default: 'transparent',
};

/* ===================== Helpers ===================== */
const parseDateLoose = (input) => {
  if (input === null || input === undefined) return null;
  const s = String(input).trim();
  if (!s) return null;

  // numeric timestamps
  if (/^\d{13}$/.test(s)) return new Date(Number(s));          // ms
  if (/^\d{10}$/.test(s)) return new Date(Number(s) * 1000);   // seconds

  // native/ISO first
  const d0 = new Date(s);
  if (!isNaN(d0)) return d0;

  // DD/MM/YYYY or DD-MM-YYYY
  let m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (m) {
    const [, d, mo, y] = m.map(Number);
    const dt = new Date(y, mo - 1, d);
    return isNaN(dt) ? null : dt;
  }

  // YYYY/MM/DD or YYYY-MM-DD
  m = s.match(/^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})$/);
  if (m) {
    const [, y, mo, d] = m.map(Number);
    const dt = new Date(y, mo - 1, d);
    return isNaN(dt) ? null : dt;
  }

  return null;
};

const parseDate = parseDateLoose;

const inDateRange = (dateStr, from, to) => {
  if (!dateStr) return false;
  const d = parseDateLoose(dateStr);
  if (!d) return false;
  if (from && d < from) return false;
  if (to && d > to) return false;
  return true;
};

const includes = (hay, needle) => normalize(hay).includes(normalize(needle));

/* ===================== Unified query parser ===================== */
const parseDateRangeToken = (value) => {
  if (!value) return { from: null, to: null };
  const [a, b] = value.split('..');
  return { from: parseDateLoose(a) || null, to: parseDateLoose(b) || null };
};

// Returns: { terms: [], fields:{meeting:[],name:[],job:[],status:[],assigned:[],remark:[]}, dom:{from,to}, ddl:{from,to} }
const parseUnifiedQuery = (q) => {
  const res = {
    terms: [],
    fields: { meeting: [], name: [], job: [], status: [], assigned: [], remark: [] },
    dom: null,
    ddl: null,
  };
  if (!q || !q.trim()) return res;

  const tokens = q.match(/"[^"]*"|\S+/g) || [];
  const keyMap = {
    meeting: 'meeting',
    m: 'meeting',
    name: 'name',
    assignee: 'name',
    job: 'job',
    status: 'status',
    assigned: 'assigned',
    assignedby: 'assignedby',
    by: 'assigned',
    remark: 'remark',
    dom: 'dom',
    ddl: 'ddl',
  };

  tokens.forEach((raw) => {
    let token = raw;
    if (token.startsWith('"') && token.endsWith('"')) token = token.slice(1, -1);

    const idx = token.indexOf(':');
    if (idx > 0) {
      const k = token.slice(0, idx).toLowerCase();
      const v = token.slice(idx + 1);
      const key = keyMap[k] || null;
      if (!key || !v) {
        res.terms.push(token);
        return;
      }
      if (key === 'dom') {
        res.dom = parseDateRangeToken(v);
      } else if (key === 'ddl') {
        res.ddl = parseDateRangeToken(v);
      } else if (key === 'assignedby') {
        res.fields.assigned.push(v);
      } else if (res.fields[key]) {
        res.fields[key].push(v);
      } else {
        res.terms.push(token);
      }
    } else {
      res.terms.push(token);
    }
  });
  return res;
};

/* ===================== Groupers ===================== */
const groupMomRows = (rows = []) => {
  const map = new Map();
  rows.forEach((r) => {
    const key = `${normalize(r.job)}|${normalize(r.deadline)}`;
    if (!map.has(key)) map.set(key, { job: r.job, deadline: r.deadline, members: [] });
    map.get(key).members.push(r);
  });

  return Array.from(map.values()).map((g) => {
    const primary =
      g.members.find((m) => !/^(completed|rejected)$/i.test(m.status || '')) || g.members[0];
    return {
      ...g,
      primary,
      count: g.members.length,
      severity: groupSeverity(g.members),
    };
  });
};

const groupMergedMomRows = (rows = []) => {
  const map = new Map();
  rows.forEach((r) => {
    const key = `${normalize(r.from)}|${normalize(r.job)}|${normalize(r.deadline)}`;
    if (!map.has(key)) map.set(key, { from: r.from, job: r.job, deadline: r.deadline, members: [] });
    map.get(key).members.push(r);
  });

  return Array.from(map.values()).map((g) => {
    const primary =
      g.members.find((m) => !/^(completed|rejected)$/i.test(m.status || '')) || g.members[0];
    return {
      ...g,
      primary,
      count: g.members.length,
      severity: groupSeverity(g.members),
    };
  });
};

/* ===================== Viewport-clamped popover helper ===================== */
function useClampedPopover(anchorRef, open, width = 320, gap = 8) {
  const [coords, setCoords] = useState({ left: 0, top: 0, width });
  const update = () => {
    const rect = anchorRef.current?.getBoundingClientRect();
    if (!rect) return;
    const desiredLeft = rect.left + rect.width / 2 - width / 2;
    const clampedLeft = Math.max(8, Math.min(desiredLeft, window.innerWidth - width - 8));
    const top = rect.bottom + gap;
    setCoords({ left: clampedLeft, top, width });
  };
  useLayoutEffect(() => {
    if (open) update();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const onResize = () => update();
    const onScroll = () => update();
    window.addEventListener('resize', onResize);
    window.addEventListener('scroll', onScroll, true);
    return () => {
      window.removeEventListener('resize', onResize);
      window.removeEventListener('scroll', onScroll, true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  return coords;
}

function ViewportPopover({ anchorRef, open, width = 320, innerRef, children }) {
  const coords = useClampedPopover(anchorRef, open, width);
  if (!open) return null;
  return (
    <div
      ref={innerRef}
      className="fixed z-50"
      style={{ left: coords.left, top: coords.top, width: coords.width }}
    >
      {children}
    </div>
  );
}

export default function MainPage() {
  const [darkMode, setDarkMode] = useDarkMode();
  const { user, logout } = useAuth();
  const { meetings, updateMomStatus, fetchMomByMeetingId } = useMeetings();
  const [open, setOpen] = useState(false);

  // ====== Unified Search ======
  const [query, setQuery] = useState('');
  const [searchHover, setSearchHover] = useState(false);
  const [inputFocused, setInputFocused] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const searchWrapRef = useRef(null);

  // ====== Avatar upload popover (CLAMPED) ======
  const avatarWrapRef = useRef(null);
  const avatarBtnRef = useRef(null);
  const avatarPopoverRef = useRef(null);
  const [avatarOpen, setAvatarOpen] = useState(false);
  const [selectedFile, setSelectedFile] = useState(null);
  const [previewUrl, setPreviewUrl] = useState('');
  const [uploading, setUploading] = useState(false);
  const [uploadMsg, setUploadMsg] = useState('');
  const [photoUrl, setPhotoUrl] = useState(user?.photo || '/avatar.png');

  useEffect(() => {
    setPhotoUrl(user?.photo || '/avatar.png');
  }, [user?.photo]);

  const onFilePicked = (file) => {
    if (!file) return;
    setSelectedFile(file);
    setPreviewUrl(URL.createObjectURL(file));
    setUploadMsg('');
  };

  const handleFileChange = (e) => {
    const file = e.target.files?.[0];
    onFilePicked(file);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    const file = e.dataTransfer.files?.[0];
    onFilePicked(file);
  };

  const handleUpload = async () => {
    if (!selectedFile) return;
    setUploading(true);
    setUploadMsg('');
    try {
      const form = new FormData();
      form.append('photo', selectedFile);
      form.append('email', user?.email || '');

      const resp = await fetch('http://192.168.0.106:5000/api/users/me/photo', {
        method: 'POST',
        body: form,
      });

      let data = null;
      try {
        data = await resp.json();
      } catch {}

      if (!resp.ok) {
        throw new Error((data && (data.error || data.message)) || `Upload failed (${resp.status})`);
      }

      const newUrl = data?.photoUrl || data?.url || null;
      if (newUrl) {
        setPhotoUrl(newUrl);
      } else {
        setPhotoUrl((prev) => `${prev.split('?')[0]}?v=${Date.now()}`);
      }

      setUploadMsg('✅ Photo updated');
      setAvatarOpen(false);
      setSelectedFile(null);
      setPreviewUrl('');
    } catch (err) {
      setUploadMsg(`❌ ${err.message || 'Upload failed'}`);
    } finally {
      setUploading(false);
    }
  };

  // Close popovers on outside click
  useEffect(() => {
    const onDocClick = (e) => {
      const inSearch = searchWrapRef.current?.contains(e.target);
      const inAvatarArea = avatarWrapRef.current?.contains(e.target);
      const inAvatarPopover = avatarPopoverRef.current?.contains(e.target);
      if (!inSearch) {
        setAdvancedOpen(false);
        setInputFocused(false);
        setSearchHover(false);
      }
      if (!(inAvatarArea || inAvatarPopover)) {
        setAvatarOpen(false);
      }
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, []);

  // ====== Filters (Advanced popover) ======
  const [fMeetingName, setFMeetingName] = useState('');
  const [fAssignedName, setFAssignedName] = useState('');
  const [fStatus, setFStatus] = useState('');
  const [fDomFrom, setFDomFrom] = useState('');
  const [fDomTo, setFDomTo] = useState('');
  const [fDdlFrom, setFDdlFrom] = useState('');
  const [fDdlTo, setFDdlTo] = useState('');
  const [showOnlyMine, setShowOnlyMine] = useState(false);
  const [onlyMom, setOnlyMom] = useState(false);

  const { name: userName, email: userEmail } = user || {};
  const displayName = userName || userEmail?.split('@')[0] || 'User';

  // ====== Precompute dropdown options ======
  const uniqueMeetingNames = useMemo(
    () => Array.from(new Set(meetings.map((m) => m.meetingName).filter(Boolean))),
    [meetings],
  );
  const uniqueAssignees = useMemo(
    () =>
      Array.from(
        new Set(meetings.flatMap((m) => (m.mom || []).map((row) => row.name)).filter(Boolean)),
      ),
    [meetings],
  );
  const uniqueStatuses = useMemo(
    () =>
      Array.from(
        new Set(
          meetings
            .flatMap((m) => (m.mom || []).map((row) => (row.status || '').trim()))
            .filter(Boolean),
        ),
      ),
    [meetings],
  );

  // ====== Load MoM for meetings that missed it ======
  useEffect(() => {
    meetings.forEach((meeting) => {
      if (!meeting.mom) {
        fetchMomByMeetingId(meeting.meeting_id || meeting.id);
      }
    });
  }, [meetings, fetchMomByMeetingId]);

  // ====== Directory for ActionModal ======
  const [directory, setDirectory] = useState([]);
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('http://192.168.0.106:5000/api/users');
        const data = await res.json();
        setDirectory(
          (Array.isArray(data) ? data : []).map((u) => ({ name: u.name || '', email: u.email || '' })),
        );
      } catch (e) {
        console.error('Failed to load directory', e);
      }
    })();
  }, []);

  // ====== Group Index (for Assigned Jobs overall severity) ======
  const groupIndex = useMemo(() => {
    const idx = {};
    for (const m of meetings || []) {
      const groups = groupMomRows(m?.mom || []);
      for (const g of groups) {
        const key = `${m.meeting_id ?? m.id}|${normalize(g.job)}|${normalize(g.deadline)}`;
        idx[key] = g.severity;
      }
    }
    return idx;
  }, [meetings]);

  // ====== Clear All (Filters) ======
  const clearAll = () => {
    setFMeetingName('');
    setFAssignedName('');
    setFStatus('');
    setFDomFrom('');
    setFDomTo('');
    setFDdlFrom('');
    setFDdlTo('');
    setShowOnlyMine(false);
    setOnlyMom(false);
  };

  // ====== Filtering Logic (Unified + Filters) ======
  const parsedQ = useMemo(() => parseUnifiedQuery(query), [query]);
  const domFromFDate = parseDateLoose(fDomFrom);
  const domToFDate   = parseDateLoose(fDomTo);
  const ddlFromFDate = parseDateLoose(fDdlFrom);
  const ddlToFDate   = parseDateLoose(fDdlTo);

  const filteredMeetings = useMemo(() => {
    return (meetings || [])
      .filter((m) => {
        const mom = m.mom || [];

        // Unified query checks
        if (query.trim().length > 0) {
          if (
            parsedQ.fields.meeting.length &&
            !parsedQ.fields.meeting.every((v) => includes(m.meetingName, v))
          )
            return false;

          if (parsedQ.fields.assigned.length) {
            const hitAssigned = parsedQ.fields.assigned.every(
              (v) =>
                mom.some((r) => includes(r.assigned_by || r.assignedBy || '', v)) ||
                includes(m.organizerEmail || m.organizer || '', v),
            );
            if (!hitAssigned) return false;
          }

          if (parsedQ.fields.name.length) {
            const hitName = parsedQ.fields.name.every((v) =>
              mom.some((r) => includes(r.name || '', v)),
            );
            if (!hitName) return false;
          }

          if (parsedQ.fields.job.length) {
            const hitJob = parsedQ.fields.job.every((v) =>
              mom.some((r) => includes(r.job || '', v)),
            );
            if (!hitJob) return false;
          }

          if (parsedQ.fields.status.length) {
            const hitSt = parsedQ.fields.status.every((v) =>
              mom.some((r) => includes(r.status || '', v)),
            );
            if (!hitSt) return false;
          }

          if (parsedQ.fields.remark.length) {
            const hitRemark = parsedQ.fields.remark.every((v) =>
              mom.some((r) => includes(r.remark || '', v)),
            );
            if (!hitRemark) return false;
          }

          if (parsedQ.dom && (parsedQ.dom.from || parsedQ.dom.to)) {
            const dom = m.dateOfMeeting;
            if (!inDateRange(dom, parsedQ.dom.from, parsedQ.dom.to)) return false;
          }
          if (parsedQ.ddl && (parsedQ.ddl.from || parsedQ.ddl.to)) {
            const hit = mom.some((r) => inDateRange(r.deadline, parsedQ.ddl.from, parsedQ.ddl.to));
            if (!hit) return false;
          }

          if (parsedQ.terms.length) {
            const big = [
              m.meetingName,
              m.organizerEmail || m.organizer || '',
              Array.isArray(m.attendees) ? m.attendees.join(' ') : m.attendees || '',
              mom
                .map((r) =>
                  [r.name, r.job, r.status, r.remark, r.assigned_by || r.assignedBy || '', r.deadline].join(
                    ' ',
                  ),
                )
                .join(' '),
            ].join(' ');
            const allTermsFound = parsedQ.terms.every((t) => includes(big, t));
            if (!allTermsFound) return false;
          }
        }

        // Advanced filters
        if (fMeetingName && m.meetingName !== fMeetingName) return false;
        if (fAssignedName) {
          const hit = mom.some((r) => (r.name || '') === fAssignedName);
          if (!hit) return false;
        }
        if (fStatus) {
          const hit = mom.some((r) => (r.status || '').trim() === fStatus);
          if (!hit) return false;
        }
        const dom = m.dateOfMeeting;
        if ((domFromFDate || domToFDate) && !inDateRange(dom, domFromFDate, domToFDate)) return false;
        if (ddlFromFDate || ddlToFDate) {
          const hit = mom.some((r) => inDateRange(r.deadline, ddlFromFDate, ddlToFDate));
          if (!hit) return false;
        }
        if (showOnlyMine) {
          const appearsInMom =
            mom.some(
              (row) =>
                normalize(row.name) === normalize(displayName) ||
                includes(row.remark || '', displayName),
            );
          const att = Array.isArray(m.attendees) ? m.attendees : (m.attendees || '').split(',');
          const appearsInAttendees = att.some((a) => normalize(a.trim()) === normalize(displayName));
          if (!(appearsInMom || appearsInAttendees)) return false;
        }
        return true;
      })
      .sort((a, b) => b.created - a.created);
  }, [
    meetings,
    query,
    parsedQ,
    fMeetingName,
    fAssignedName,
    fStatus,
    fDomFrom,
    fDomTo,
    fDdlFrom,
    fDdlTo,
    showOnlyMine,
    displayName,
  ]);

  const mergedMom = useMemo(
    () => filteredMeetings.flatMap((m) => (m.mom || []).map((r) => ({ ...r, from: m.meetingName })) ),
    [filteredMeetings],
  );

  // ====== Assigned Jobs panel =========
  const [selectedJobIndex, setSelectedJobIndex] = useState(null);
  const [sortAsc, setSortAsc] = useState(true);
  const [hideExpired, setHideExpired] = useState(false);
  const [showAssignedPanel, setShowAssignedPanel] = useState(true);

  const myPendingJobs = useMemo(
    () =>
      meetings
        .flatMap((m) =>
          (m.mom || [])
            .map((row) => ({
              ...row,
              momId: row.mom_id ?? row.momId,
              meetingId: m.meeting_id ?? m.id,
              createdAt: m.created,
              assignedBy: row.assigned_by || m.organizerEmail || m.organizer || '',
              organizer: row.assigned_by || m.organizerEmail || m.organizer || '',
            }))
            .filter((row) => normalize(row.name) === normalize(displayName)),
        ),
    [meetings, displayName],
  );

  const calculateCardVisual = (createdAt, deadline) => {
    const now = new Date();
    const start = parseDateLoose(createdAt) || now;   // safer parsing
    const end   = parseDateLoose(deadline);

    if (!end || end <= start) return { background: '#f3f4f6' };

    const totalDays = (end - start) / 86400000;
    if (!Number.isFinite(totalDays) || totalDays <= 0) return { background: '#f3f4f6' };

    const leftDays = (end - now) / 86400000;
    if (leftDays <= 0) return { background: '#d1d5db' }; // overdue

    const percentLeft = Math.max(0, Math.min(100, (leftDays / totalDays) * 100));

    let r, g, b;
    if (percentLeft >= 50) {
      const ratio = (percentLeft - 50) / 50;
      r = Math.round(255 - 100 * ratio);
      g = 255;
      b = 200;
    } else {
      const ratio = percentLeft / 50;
      r = 255;
      g = Math.round(200 * ratio + 55);
      b = 200;
    }
    const fillColor = `rgb(${r}, ${g}, ${b})`;

    return {
      background: `linear-gradient(to right, ${fillColor} ${percentLeft}%, white ${percentLeft}%)`,
    };
  };

  async function sendMail(job, action, remark = '', newDeadline = null, to = null) {
    const subject = `Job ${action} - ${job.job}`;
    const message = `Action: ${action}
Job: ${job.job}
Deadline: ${newDeadline || job.deadline}
Remark: ${remark || job.remark}
From: ${job.name}`;

    const recipients = Array.from(
      new Set([to, job?.email, job?.organizer, user?.email].filter(Boolean)),
    );

    try {
      const response = await fetch('http://192.168.0.106:5000/send-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to: recipients.join(','),
          subject,
          text: message,
        }),
      });

      let json = null;
      try {
        json = await response.json();
      } catch {}
      if (!response.ok || !json?.success) {
        const txt = await response.text().catch(() => '');
        console.error('📧 Email failed:', response.status, txt);
        return false;
      }
      console.log('📧 Mail sent successfully to', recipients);
      return true;
    } catch (error) {
      console.error('❌ Network error sending email:', error);
      return false;
    }
  }

  const handleFinalAction = async (type, job, payload = {}) => {
    const momId = job.momId || job.mom_id;
    const meetingId = job.meetingId;
    if (!momId) {
      console.error('Missing momId on job:', job);
      return;
    }

    if (type === 'rejected') {
      const patch = { status: 'Rejected', statusColor: ROW_COLORS.rejected, remark: payload.remark ?? '' };
      await updateMomStatus(momId, patch, meetingId);
      await sendMail(job, 'Rejected', payload.remark);
      return;
    }

    if (type === 'needTime') {
      const patch = {
        status: 'Need Time',
        statusColor: ROW_COLORS.needTime,
        deadline: payload.deadline ?? job.deadline ?? '',
        remark: payload.remark ?? '',
      };
      await updateMomStatus(momId, patch, meetingId);

      const toInsert = Array.isArray(payload.assignList) ? payload.assignList : [];
      if (toInsert.length > 0) {
        const momRows = toInsert.map((p) => ({
          name: p.name,
          job: job.job,
          deadline: payload.deadline ?? job.deadline ?? '',
          remark: payload.remark ?? job.remark ?? '',
          status: 'Assigned',
          email: p.email || '',
        }));

        try {
          const resp = await fetch(`http://192.168.0.106:5000/api/meetings/${meetingId}/mom`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ mom: momRows }),
          });
          const txt = await resp.text();
          if (!resp.ok) console.error('❌ Need Time: failed to insert extra MoM rows', resp.status, txt);
          else console.log('✅ Need Time: inserted extra MoM rows', txt);
        } catch (e) {
          console.error('❌ Need Time: network error inserting extra MoM rows', e);
        }

        for (const p of toInsert) {
          await sendMail(job, `Assigned (Need Time support) to ${p.name}`, payload.remark, payload.deadline, p.email);
        }
      }
      await fetchMomByMeetingId(meetingId);
      return;
    }

    if (type === 'completed') {
      const patch = { status: 'Completed', statusColor: ROW_COLORS.completed };
      await updateMomStatus(momId, patch, meetingId);
      await sendMail(job, 'Completed');
      return;
    }

    if (type === 'reassign') {
      const patch = { status: 'Reassigned', statusColor: ROW_COLORS.reassigned, remark: payload.remark ?? '' };
      await updateMomStatus(momId, patch, meetingId);

      const toInsert =
        Array.isArray(payload.assignList) && payload.assignList.length > 0
          ? payload.assignList
          : payload.name && payload.email
          ? [{ name: payload.name, email: payload.email }]
          : [];

      if (toInsert.length > 0) {
        const momRows = toInsert.map((p) => ({
          name: p.name,
          job: job.job,
          deadline: job.deadline,
          remark: payload.remark ?? job.remark ?? '',
          status: 'Assigned',
          email: p.email,
        }));

        try {
          const resp = await fetch(`http://192.168.0.106:5000/api/meetings/${meetingId}/mom`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ mom: momRows }),
          });
          const txt = await resp.text();
          if (!resp.ok) console.error('❌ Failed to insert new MoM rows:', resp.status, txt);
          else console.log('✅ Inserted new MoM rows:', txt);
        } catch (e) {
          console.error('❌ Network error inserting new MoM rows:', e);
        }

        for (const p of toInsert) {
          await sendMail(job, `Reassigned to ${p.name}`, payload.remark, null, p.email);
        }
      }
      await fetchMomByMeetingId(meetingId);
      return;
    }
  };

  /* ===================== Jump to Meeting (scroll + highlight) ===================== */
  const meetingRefs = useRef(new Map());
  const registerMeetingRef = (id) => (el) => {
    if (el) meetingRefs.current.set(id, el);
    else meetingRefs.current.delete(id);
  };

  const scrollToMeeting = (meetingId) => {
    if (onlyMom) setOnlyMom(false); // ensure meeting list view
    requestAnimationFrame(() => {
      const el = meetingRefs.current.get(meetingId);
      if (!el) return;
      el.scrollIntoView({ behavior: 'smooth', block: 'start', inline: 'nearest' });
      el.classList.add('ring-2', 'ring-blue-400', 'ring-offset-2', 'ring-offset-white', 'dark:ring-offset-gray-900');
      setTimeout(() => {
        el.classList.remove('ring-2', 'ring-blue-400', 'ring-offset-2', 'ring-offset-white', 'dark:ring-offset-gray-900');
      }, 1500);
    });
  };

  /* ===================== Jump to specific MoM row in Only MoM view ===================== */
  const makeMergedKey = (from, job, deadline) =>
    `${normalize(from)}|${normalize(job)}|${normalize(deadline)}`;

  const meetingNameById = useMemo(() => {
    const map = {};
    (meetings || []).forEach((m) => {
      map[m.meeting_id ?? m.id] = m.meetingName || '';
    });
    return map;
  }, [meetings]);

  const mergedRowRefs = useRef(new Map());
  const registerMergedRowRef = (key) => (el) => {
    if (el) mergedRowRefs.current.set(key, el);
    else mergedRowRefs.current.delete(key);
  };

  const [pendingMomRowKey, setPendingMomRowKey] = useState(null);

  const jumpToMomRow = (job) => {
    const from = meetingNameById[job.meetingId] || job.from || '';
    const key = makeMergedKey(from, job.job, job.deadline);
    setOnlyMom(true);
    setPendingMomRowKey(key); // effect will perform scroll+highlight when row is rendered
  };

  useEffect(() => {
    if (!pendingMomRowKey) return;
    // Try to find the row and scroll when available
    const tryScroll = () => {
      const el = mergedRowRefs.current.get(pendingMomRowKey);
      if (!el) return false;
      el.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' });
      el.classList.add('ring-2', 'ring-blue-400', 'ring-offset-2', 'ring-offset-white', 'dark:ring-offset-gray-900');
      setTimeout(() => {
        el.classList.remove('ring-2', 'ring-blue-400', 'ring-offset-2', 'ring-offset-white', 'dark:ring-offset-gray-900');
      }, 1500);
      return true;
    };

    // attempt immediately, then a couple of rafs in case render is not done
    if (tryScroll()) { setPendingMomRowKey(null); return; }
    let raf1 = requestAnimationFrame(() => {
      if (tryScroll()) { setPendingMomRowKey(null); return; }
      let raf2 = requestAnimationFrame(() => {
        tryScroll();
        setPendingMomRowKey(null);
      });
      // cleanup inner raf
      return () => cancelAnimationFrame(raf2);
    });
    return () => cancelAnimationFrame(raf1);
  }, [pendingMomRowKey, mergedMom]);

  /* ===================== Derived UI state ===================== */
  const hasActiveFilters =
    !!fMeetingName ||
    !!fAssignedName ||
    !!fStatus ||
    !!fDomFrom ||
    !!fDomTo ||
    !!fDdlFrom ||
    !!fDdlTo ||
    showOnlyMine ||
    onlyMom;

  const expanded =
    searchHover || inputFocused || advancedOpen || (query && query.trim().length > 0);

  /* ===================== UI ===================== */
  const [modalType, setModalType] = useState(null);
  const [modalData, setModalData] = useState(null);

  return (
    <div className="h-screen bg-gray-100 dark:bg-gray-900 flex flex-col text-gray-800 dark:text-gray-100">
      {/* Header */}
      <header className="grid grid-cols-1 md:grid-cols-[1fr_auto_1fr] items-center gap-3 px-6 py-2 bg-white dark:bg-gray-800 shadow border-b border-gray-200 dark:border-gray-700">
        {/* Left: avatar + welcome */}
        <div className="flex items-center gap-4 justify-self-start" ref={avatarWrapRef}>
          <div className="relative">
            <img
              src={photoUrl}
              alt="User Avatar"
              className="w-10 h-10 rounded-full border border-gray-300 object-cover"
            />
            <button
              ref={avatarBtnRef}
              type="button"
              onClick={() => setAvatarOpen((v) => !v)}
              className="absolute -bottom-1 -right-1 h-6 w-6 rounded-full bg-blue-600 hover:bg-blue-700 text-white flex items-center justify-center shadow"
              title="Update profile photo"
              aria-expanded={avatarOpen}
            >
              <Camera size={14} />
            </button>
          </div>

          <ViewportPopover anchorRef={avatarBtnRef} open={avatarOpen} width={320} innerRef={avatarPopoverRef}>
            <div className="p-4 rounded-xl bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 shadow-2xl">
              <div className="flex items-center justify-between mb-2">
                <div className="text-sm font-semibold text-gray-800 dark:text-gray-100">Update Photo</div>
                <button
                  className="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-500"
                  onClick={() => setAvatarOpen(false)}
                  title="Close"
                >
                  <X size={16} />
                </button>
              </div>

              {/* Dropzone */}
              <label
                onDragOver={(e) => e.preventDefault()}
                onDrop={handleDrop}
                className="block border-2 border-dashed rounded-lg p-3 text-center cursor-pointer
                           border-blue-300 dark:border-blue-700 bg-blue-50/40 dark:bg-blue-900/20"
              >
                <input type="file" accept="image/*" className="hidden" onChange={handleFileChange} />
                <div className="text-xs text-blue-700 dark:text-blue-300">
                  Drag & drop a photo here, or <span className="underline">browse</span>
                </div>
              </label>

              {/* Preview */}
              {previewUrl && (
                <div className="mt-3 flex items-center gap-3">
                  <img
                    src={previewUrl}
                    alt="Preview"
                    className="w-12 h-12 rounded-full object-cover border border-blue-200"
                  />
                  <div className="text-xs text-gray-600 dark:text-gray-300">
                    {selectedFile?.name} ({Math.round((selectedFile?.size || 0) / 1024)} kb)
                  </div>
                  <button
                    className="ml-auto text-xs text-red-600 hover:underline"
                    onClick={() => {
                      setSelectedFile(null);
                      setPreviewUrl('');
                    }}
                  >
                    Clear
                  </button>
                </div>
              )}

              {/* Actions */}
              <div className="mt-3 flex items-center justify-between">
                <span className="text-xs text-gray-500">{uploadMsg}</span>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setAvatarOpen(false)}
                    className="px-3 py-1.5 text-xs rounded border border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleUpload}
                    disabled={!selectedFile || uploading}
                    className={`px-3 py-1.5 text-xs rounded text-white ${
                      uploading || !selectedFile ? 'bg-blue-400 cursor-not-allowed' : 'bg-blue-600 hover:bg-blue-700'
                    }`}
                  >
                    {uploading ? 'Saving…' : 'Save'}
                  </button>
                </div>
              </div>
            </div>
          </ViewportPopover>

          <h2 className="text-base font-medium text-gray-800 dark:text-gray-100 whitespace-nowrap">
            Welcome, {user?.name || user?.email?.split('@')[0] || 'User'}
          </h2>
        </div>

        {/* Center: blue search pill + Advanced */}
        <div className="justify-self-center relative" ref={searchWrapRef}>
          <div
            className={`transition-all duration-300 ease-out ${expanded ? 'w-[360px] md:w-[520px]' : 'w-[200px] md:w-[240px]'}`}
            onMouseEnter={() => setSearchHover(true)}
            onMouseLeave={() => setSearchHover(false)}
          >
            <div
              className={`relative flex items-center pl-10 pr-10 py-2 rounded-full border shadow-sm
                          bg-blue-50 dark:bg-blue-900/40
                          border-blue-300 dark:border-blue-600
                          focus-within:ring-2 focus-within:ring-blue-500/60`}
            >
              <button
                type="button"
                onClick={() => {
                  if (!expanded) setSearchHover(true);
                }}
                className="absolute left-3"
                aria-label="Search"
                title="Search"
              >
                <Search className="h-4 w-4 text-blue-600 dark:text-blue-300" />
              </button>

              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onFocus={() => setInputFocused(true)}
                onBlur={() => setInputFocused(false)}
                placeholder={
                  expanded
                    ? 'Search everything… e.g. name:"Anand" status:completed dom:2025-01-01..2025-01-31'
                    : 'Search…'
                }
                className={`bg-transparent text-sm text-blue-900 placeholder:text-blue-500
                            dark:text-blue-50 dark:placeholder:text-blue-300 w-full outline-none
                            transition-opacity ${expanded ? 'opacity-100' : 'opacity-80'}`}
              />

              <button
                type="button"
                onClick={() => setAdvancedOpen((v) => !v)}
                className={`absolute right-2 inline-flex items-center justify-center rounded-full h-7 w-7 transition
                            ${hasActiveFilters
                              ? 'bg-blue-600 text-white'
                              : 'text-blue-700 hover:bg-blue-100 dark:text-blue-200 dark:hover:bg-blue-800/40'}`}
                title="Advanced filters"
                aria-expanded={advancedOpen}
              >
                <SlidersHorizontal size={16} />
              </button>
            </div>
          </div>

          {advancedOpen && (
            <div
              className="absolute left-1/2 -translate-x-1/2 mt-2 w-[44rem] max-w-[92vw] z-50
                         bg-white dark:bg-gray-800 border border-blue-200 dark:border-blue-700
                         rounded-xl shadow-2xl p-4 text-sm"
            >
              <div className="mb-3 text-[12px] text-blue-700 dark:text-blue-300">
                Tip: Use quick query too —{' '}
                <code className="bg-blue-50 dark:bg-blue-900/40 px-1 rounded">
                  name:Jane status:completed ddl:2025-01-01..2025-01-31
                </code>
              </div>

              <AdvancedFilters
                uniqueMeetingNames={uniqueMeetingNames}
                uniqueAssignees={uniqueAssignees}
                uniqueStatuses={uniqueStatuses}
                fMeetingName={fMeetingName}
                setFMeetingName={setFMeetingName}
                fAssignedName={fAssignedName}
                setFAssignedName={setFAssignedName}
                fStatus={fStatus}
                setFStatus={setFStatus}
                fDomFrom={fDomFrom}
                setFDomFrom={setFDomFrom}
                fDomTo={fDomTo}
                setFDomTo={setFDomTo}
                fDdlFrom={fDdlFrom}
                setFDdlFrom={setFDdlFrom}
                fDdlTo={fDdlTo}
                setFDdlTo={setFDdlTo}
                showOnlyMine={showOnlyMine}
                setShowOnlyMine={setShowOnlyMine}
                onlyMom={onlyMom}
                setOnlyMom={setOnlyMom}
                clearAll={clearAll}
                onApply={() => setAdvancedOpen(false)}
              />
            </div>
          )}
        </div>

        {/* Right: actions */}
        <div className="flex items-center gap-2 justify-self-end">
          <button
            onClick={() => setOpen(true)}
            className="bg-gradient-to-r from-blue-600 to-green-600 hover:from-green-700 hover:to-blue-700
                       text-white text-sm px-3 py-1.5 rounded-md shadow"
          >
            + New Meeting
          </button>

          <button
            onClick={logout}
            className="bg-red-500 hover:bg-red-600 text-white text-sm px-3 py-1.5 rounded-md shadow"
          >
            Logout
          </button>

          <button
            onClick={() => setDarkMode(!darkMode)}
            className="text-gray-700 dark:text-gray-200 hover:text-black dark:hover:text-white p-1.5 rounded transition"
            title="Toggle Dark Mode"
          >
            {darkMode ? <Sun size={18} /> : <Moon size={18} />}
          </button>

          <div className="relative">
            <ReportDownloadHover />
          </div>
        </div>
      </header>

      {/* Body */}
      <div className="flex flex-grow overflow-hidden">
        {/* Assigned Jobs aside */}
        <AssignedJobsAside
          showAssignedPanel={showAssignedPanel}
          setShowAssignedPanel={setShowAssignedPanel}
          myPendingJobs={myPendingJobs}
          groupIndex={groupIndex}
          calculateCardVisual={calculateCardVisual}
          selectedJobIndex={selectedJobIndex}
          setSelectedJobIndex={setSelectedJobIndex}
          sortAsc={sortAsc}
          setSortAsc={setSortAsc}
          hideExpired={hideExpired}
          setHideExpired={setHideExpired}
          openModal={(type, job) => {
            setModalType(type);
            setModalData(job);
          }}
          handleFinalAction={handleFinalAction}
          onlyMom={onlyMom}                 // NEW
          onJumpToMeeting={scrollToMeeting} // existing
          onJumpToMomRow={jumpToMomRow}     // NEW
        />

        {/* Main */}
        <main className={`${showAssignedPanel ? 'w-2/3' : 'w-full'} p-4 overflow-y-auto space-y-5`}>
          {onlyMom ? (
            <MergedMomTable
              mergedMom={mergedMom}
              registerMergedRowRef={registerMergedRowRef} // NEW
              makeMergedKey={makeMergedKey}               // NEW
            />
          ) : (
            filteredMeetings.map((meeting) => {
              const mId = meeting.meeting_id ?? meeting.id;
              return (
                <div key={mId} ref={registerMeetingRef(mId)} className="rounded-xl transition-shadow">
                  <MeetingCard
                    meeting={meeting}
                    groupMomRows={groupMomRows}
                    COLOR_BY_SEVERITY={COLOR_BY_SEVERITY}
                    statusTextClass={statusTextClass}
                  />
                </div>
              );
            })
          )}
        </main>

        {!showAssignedPanel && (
          <button
            type="button"
            onClick={() => setShowAssignedPanel(true)}
            className="fixed left-2 top-24 z-40 bg-blue-600/50 text-white border border-transparent shadow px-2 py-1 rounded-full hover:bg-blue-700/60 hover:shadow-md focus:outline-none focus:ring-2 focus:ring-blue-500/50 dark:bg-blue-600/50 dark:hover:bg-blue-500/60"
            title="Show Assigned Jobs"
          >
            <div className="flex items-center gap-1 text-sm">
              <ChevronRight size={16} /> Assigned Jobs
            </div>
          </button>
        )}
      </div>

      {open && <NewMeetingModal close={() => setOpen(false)} />}

      {modalType && modalData && (
        <ActionModal
          type={modalType}
          onClose={() => {
            setModalType(null);
            setModalData(null);
          }}
          onSubmit={(payload) => handleFinalAction(modalType, modalData, payload)}
          people={directory}
          currentAssignee={modalData?.name || ''}
        />
      )}
    </div>
  );
}

/* ===================== Extracted UI Components ===================== */

function AdvancedFilters({
  uniqueMeetingNames,
  uniqueAssignees,
  uniqueStatuses,
  fMeetingName,
  setFMeetingName,
  fAssignedName,
  setFAssignedName,
  fStatus,
  setFStatus,
  fDomFrom,
  setFDomFrom,
  fDomTo,
  setFDomTo,
  fDdlFrom,
  setFDdlFrom,
  fDdlTo,
  setFDdlTo,
  showOnlyMine,
  setShowOnlyMine,
  onlyMom,
  setOnlyMom,
  clearAll,
  onApply,
}) {
  return (
    <>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div>
          <label className="block text-[12px] text-gray-700 dark:text-gray-200 mb-1">Meeting name</label>
          <select
            value={fMeetingName}
            onChange={(e) => setFMeetingName(e.target.value)}
            className="w-full px-2 py-1 border rounded bg-white dark:bg-gray-700 border-blue-300 dark:border-blue-700"
          >
            <option value="">All</option>
            {uniqueMeetingNames.map((n, i) => (
              <option key={i} value={n}>
                {n}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-[12px] text-gray-700 dark:text-gray-200 mb-1">Assigned name (assignee)</label>
          <select
            value={fAssignedName}
            onChange={(e) => setFAssignedName(e.target.value)}
            className="w-full px-2 py-1 border rounded bg-white dark:bg-gray-700 border-blue-300 dark:border-blue-700"
          >
            <option value="">All</option>
            {uniqueAssignees.map((n, i) => (
              <option key={i} value={n}>
                {n}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-[12px] text-gray-700 dark:text-gray-200 mb-1">Status</label>
          <select
            value={fStatus}
            onChange={(e) => setFStatus(e.target.value)}
            className="w-full px-2 py-1 border rounded bg-white dark:bg-gray-700 border-blue-300 dark:border-blue-700"
          >
            <option value="">All</option>
            {uniqueStatuses.map((s, i) => (
              <option key={i} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="block text-[12px] text-gray-700 dark:text-gray-200 mb-1">Meeting date — From</label>
            <input
              type="date"
              value={fDomFrom}
              onChange={(e) => setFDomFrom(e.target.value)}
              className="w-full px-2 py-1 border rounded bg-white dark:bg-gray-700 border-blue-300 dark:border-blue-700"
            />
          </div>
          <div>
            <label className="block text-[12px] text-gray-700 dark:text-gray-200 mb-1">Meeting date — To</label>
            <input
              type="date"
              value={fDomTo}
              onChange={(e) => setFDomTo(e.target.value)}
              className="w-full px-2 py-1 border rounded bg-white dark:bg-gray-700 border-blue-300 dark:border-blue-700"
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="block text-[12px] text-gray-700 dark:text-gray-200 mb-1">Deadline — From</label>
            <input
              type="date"
              value={fDdlFrom}
              onChange={(e) => setFDdlFrom(e.target.value)}
              className="w-full px-2 py-1 border rounded bg-white dark:bg-gray-700 border-blue-300 dark:border-blue-700"
            />
          </div>
          <div>
            <label className="block text-[12px] text-gray-700 dark:text-gray-200 mb-1">Deadline — To</label>
            <input
              type="date"
              value={fDdlTo}
              onChange={(e) => setFDdlTo(e.target.value)}
              className="w-full px-2 py-1 border rounded bg-white dark:bg-gray-700 border-blue-300 dark:border-blue-700"
            />
          </div>
        </div>

        <label className="flex items-center justify-between col-span-1 md:col-span-2 px-2 py-1.5 border rounded bg-blue-50 dark:bg-blue-900/30 border-blue-200 dark:border-blue-800">
          <span className="text-gray-800 dark:text-gray-100">Only my meetings</span>
          <label className="relative inline-flex items-center cursor-pointer">
            <input
              type="checkbox"
              checked={showOnlyMine}
              onChange={() => setShowOnlyMine((v) => !v)}
              className="sr-only peer"
            />
            <div className="w-10 h-5 bg-blue-200 peer-checked:bg-blue-500 rounded-full peer relative after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:after:translate-x-5" />
          </label>
        </label>

        <label className="flex items-center justify-between col-span-1 md:col-span-2 px-2 py-1.5 border rounded bg-blue-50 dark:bg-blue-900/30 border-blue-200 dark:border-blue-800">
          <span className="text-gray-800 dark:text-gray-100">Only MoM view</span>
          <label className="relative inline-flex items-center cursor-pointer">
            <input
              type="checkbox"
              checked={onlyMom}
              onChange={() => setOnlyMom((v) => !v)}
              className="sr-only peer"
            />
            <div className="w-10 h-5 bg-blue-200 peer-checked:bg-blue-500 rounded-full peer relative after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:after:translate-x-5" />
          </label>
        </label>
      </div>

      {/* Footer */}
      <div className="pt-3 mt-3 border-top border-t border-blue-200 dark:border-blue-800 flex items-center justify-between">
        <button
          onClick={clearAll}
          className="px-3 py-1.5 text-sm rounded border border-blue-300 dark:border-blue-700 hover:bg-blue-50 dark:hover:bg-blue-900/30 text-blue-700 dark:text-blue-200"
        >
          Reset
        </button>
        <div className="flex items-center gap-2">
          <button onClick={onApply} className="px-3 py-1.5 text-sm rounded bg-blue-600 hover:bg-blue-700 text-white">
            Apply
          </button>
        </div>
      </div>
    </>
  );
}

function AssignedJobsAside({
  showAssignedPanel,
  setShowAssignedPanel,
  myPendingJobs,
  groupIndex,
  calculateCardVisual,
  selectedJobIndex,
  setSelectedJobIndex,
  sortAsc,
  setSortAsc,
  hideExpired,
  setHideExpired,
  openModal,
  handleFinalAction,
  onlyMom,             // NEW
  onJumpToMeeting,     // existing
  onJumpToMomRow,      // NEW
}) {
  return showAssignedPanel ? (
    <aside className="w-1/3 bg-white dark:bg-gray-800 p-4 border-r border-gray-300 dark:border-gray-700 overflow-y-auto text-gray-800 dark:text-gray-100">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-base font-semibold text-gray-800 dark:text-gray-100">🕒 Assigned Jobs</h3>
        <button
          type="button"
          onClick={() => setShowAssignedPanel(false)}
          className="flex items-center gap-1 text-sm px-2 py-1 rounded-full bg-blue-600 text-white hover:bg-blue-700 border border-transparent dark:bg-blue-600 dark:hover:bg-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/50"
          title="Hide Assigned Jobs"
        >
          <ChevronLeft size={16} /> Hide
        </button>
      </div>

      <AssignedJobsControls
        sortAsc={sortAsc}
        setSortAsc={setSortAsc}
        hideExpired={hideExpired}
        setHideExpired={setHideExpired}
      />

      {myPendingJobs.length === 0 ? (
        <p className="text-gray-600 text-sm">No pending jobs assigned to you.</p>
      ) : (
        <AssignedJobsList
          jobsRaw={myPendingJobs}
          groupIndex={groupIndex}
          calculateCardVisual={calculateCardVisual}
          selectedJobIndex={selectedJobIndex}
          setSelectedJobIndex={setSelectedJobIndex}
          sortAsc={sortAsc}
          hideExpired={hideExpired}
          openModal={openModal}
          handleFinalAction={handleFinalAction}
          onlyMom={onlyMom}                 // NEW
          onJumpToMeeting={onJumpToMeeting}
          onJumpToMomRow={onJumpToMomRow}
        />
      )}
    </aside>
  ) : null;
}

function AssignedJobsControls({ sortAsc, setSortAsc, hideExpired, setHideExpired }) {
  return (
    <div className="flex items-center gap-3 mb-4">
      <button
        onClick={() => setSortAsc((prev) => !prev)}
        className="flex items-center text-sm text-blue-600 hover:underline"
        title="Sort by Time Left"
      >
        {sortAsc ? <SortAsc size={16} /> : <SortDesc size={16} />}
      </button>
      <label className="flex items-center text-sm gap-2 cursor-pointer">
        <span className="text-gray-600">Hide Expired</span>
        <div className="relative inline-flex items-center">
          <input
            type="checkbox"
            checked={hideExpired}
            onChange={() => setHideExpired(!hideExpired)}
            className="sr-only peer"
          />
          <div className="w-10 h-5 bg-gray-300 peer-checked:bg-blue-500 rounded-full peer relative after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:after:translate-x-5" />
        </div>
      </label>
    </div>
  );
}

function AssignedJobsList({
  jobsRaw,
  groupIndex,
  calculateCardVisual,
  selectedJobIndex,
  setSelectedJobIndex,
  sortAsc,
  hideExpired,
  openModal,
  handleFinalAction,
  onlyMom,             // NEW
  onJumpToMeeting,
  onJumpToMomRow,
}) {
  const now = new Date();
  const jobs = jobsRaw.map((job) => {
    const key = `${job.meetingId}|${normalize(job.job)}|${normalize(job.deadline)}`;
    const overall = groupIndex[key] || 'default';
    const isDone = overall === 'completed' || overall === 'rejected';

    const end = parseDateLoose(job.deadline);
    const timeLeftMs = end ? end.getTime() - now.getTime() : Number.POSITIVE_INFINITY;
    const isExpiredTime = end ? timeLeftMs <= 0 : false;

    return {
      ...job,
      _overall: overall,
      _isDone: isDone,
      _timeLeftMs: timeLeftMs,
      _isExpiredTime: isExpiredTime,
    };
  });

  let active = jobs.filter((j) => !j._isDone);
  const activeValid = active.filter((j) => !j._isExpiredTime);
  const activeExpired = active.filter((j) => j._isExpiredTime);

  const sortedActiveValid = [...activeValid].sort((a, b) =>
    sortAsc ? a._timeLeftMs - b._timeLeftMs : b._timeLeftMs - a._timeLeftMs,
  );

  const activeFinal = hideExpired ? sortedActiveValid : [...sortedActiveValid, ...activeExpired];

  const done = jobs.filter((j) => j._isDone);
  const sortedDone = [...done].sort((a, b) => new Date(b.deadline) - new Date(a.deadline));

  const renderCard = (job, index) => {
    const canAct = !job._isDone;
    const isExpired = job._isExpiredTime || job._isDone;
    const style = calculateCardVisual(job.createdAt, job.deadline);

    return (
      <div
        key={`${job.momId || job.mom_id || job.job}-${index}`}
        className={`relative border rounded-lg shadow-sm px-4 py-3 transition ${
          canAct ? 'cursor-pointer hover:shadow-md' : 'cursor-default'
        } ${isExpired ? 'bg-gray-100 opacity-70' : ''}`}
        style={style}
        onClick={() => {
          if (canAct) setSelectedJobIndex(selectedJobIndex === index ? null : index);
          if (onlyMom) {
            onJumpToMomRow?.(job); // highlight the specific merged row
          } else {
            onJumpToMeeting?.(job.meetingId); // scroll to the meeting card
          }
        }}
      >
        <div className="flex justify-between items-center mb-1">
          <h4 className="font-semibold text-gray-800 text-sm">{job.job}</h4>
          <span
            className={`text-xs font-medium px-2 py-0.5 rounded-full ${
              isExpired ? 'bg-gray-300 text-gray-700' : 'bg-blue-100 text-blue-800'
            }`}
          >
            Deadline: {new Date(job.deadline).toLocaleDateString()}
          </span>
        </div>
        <p className="text-sm text-gray-600">
          <strong>Remark:</strong> {job.remark || '—'}
        </p>
        <p className="text-sm text-gray-600 dark:text-gray-300">
          <strong>Assigned By:</strong> {job.assignedBy || job.organizer || 'N/A'}
        </p>

        {canAct && selectedJobIndex === index && (
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              className="bg-red-500 hover:bg-red-600 text-white text-xs font-medium px-3 py-1 rounded"
              onClick={(e) => {
                e.stopPropagation();
                handleFinalAction('rejected', job, { remark: '' });
              }}
              title="Reject"
            >
              ❌ Reject
            </button>
            <button
              className="bg-blue-500 hover:bg-blue-600 text-white text-xs font-medium px-3 py-1 rounded"
              onClick={(e) => {
                e.stopPropagation();
                openModal('reassign', job);
              }}
              title="Reassign"
            >
              🔄 Reassign
            </button>
            <button
              className="bg-yellow-500 hover:bg-yellow-600 text-white text-xs font-medium px-3 py-1 rounded"
              onClick={(e) => {
                e.stopPropagation();
                openModal('needTime', job);
              }}
              title="Need Time"
            >
              ⏳ Need Time
            </button>
            <button
              className="bg-green-500 hover:bg-green-600 text-white text-xs font-medium px-3 py-1 rounded"
              onClick={(e) => {
                e.stopPropagation();
                handleFinalAction('completed', job);
              }}
              title="Completed"
            >
              ✅ Completed
            </button>
          </div>
        )}
      </div>
    );
  };

  const elements = [];
  activeFinal.forEach((job, i) => elements.push(renderCard(job, i)));
  if (sortedDone.length > 0) {
    elements.push(
      <div
        key="done-separator"
        className="border-t border-gray-200 dark:border-gray-700 pt-2 mt-2 text-xs uppercase tracking-wide text-gray-500"
      >
        Completed / Rejected
      </div>,
    );
    sortedDone.forEach((job, i) => elements.push(renderCard(job, activeFinal.length + i)));
  }
  return <div className="space-y-4">{elements}</div>;
}

function MergedMomTable({ mergedMom, registerMergedRowRef, makeMergedKey }) {
  return (
    <div className="bg-white rounded-xl p-5 shadow-sm border border-gray-200 text-sm text-gray-700">
      <h3 className="text-base font-semibold text-blue-700 mb-3">Merged MoM View</h3>
      <table className="w-full border border-gray-300 text-xs">
        <thead className="bg-gray-100 dark:bg-gray-700">
          <tr>
            <th className="border px-2 py-1">From</th>
            <th className="border px-2 py-1">Name</th>
            <th className="border px-2 py-1">Job</th>
            <th className="border px-2 py-1">Deadline</th>
            <th className="border px-2 py-1">Remark</th>
            <th className="border px-2 py-1">Assigned By</th>
            <th className="border px-2 py-1">Status</th>
          </tr>
        </thead>
        <tbody className="bg-white dark:bg-gray-800">
          {groupMergedMomRows(mergedMom).map((g, idx) => {
            const key = makeMergedKey(g.from, g.job, g.deadline);
            return (
              <tr
                key={idx}
                ref={registerMergedRowRef(key)}
                style={{ backgroundColor: COLOR_BY_SEVERITY[g.severity] }}
              >
                <td className="border px-2 py-1">{g.from}</td>
                <td className="border px-2 py-1">
                  <span className={statusTextClass(g.primary.status)}>{g.primary.name}</span>
                  {g.count > 1 && (
                    <>
                      <span className="text-xs text-gray-600"> +{g.count - 1} others</span>
                      <span className="relative inline-block group ml-1 align-middle">
                        <Users
                          size={14}
                          className="text-blue-600 cursor-help inline-block hover:text-blue-700"
                          aria-hidden="true"
                          title="View team details"
                        />
                        <div className="absolute left-0 mt-1 z-10 hidden group-hover:block bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow p-3 w-72">
                          <div className="text-xs font-semibold mb-1">Assignees</div>
                          <ul className="max-h-48 overflow-auto text-xs space-y-1">
                            {g.members.map((m, i) => (
                              <li key={i} className="flex justify-between gap-2">
                                <span className={`truncate ${statusTextClass(m.status)}`}>{m.name}</span>
                                <span className={`shrink-0 ${statusTextClass(m.status)}`}>{m.status || 'Assigned'}</span>
                              </li>
                            ))}
                          </ul>
                        </div>
                      </span>
                    </>
                  )}
                </td>
                <td className="border px-2 py-1">{g.job}</td>
                <td className="border px-2 py-1">
                  <DeadlineCell
                    deadline={g.primary.deadline || g.deadline}
                    status={g.primary.status}
                    history={g.primary.deadline_history || g.primary.deadlineHistory || []}
                  />
                </td>
                <td className="border px-2 py-1">{g.primary.remark || ''}</td>
                <td className="border px-2 py-1">{g.primary.assigned_by || g.primary.assignedBy || '—'}</td>
                <td className="border px-2 py-1">{g.primary.status || ''}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function DeadlineCell({ deadline, status, history = [] }) {
  const [open, setOpen] = React.useState(false);
  const hasHistory = Array.isArray(history) && history.length > 0;
  const isNeedTime = String(status || '').toLowerCase() === 'need time';

  const latest = deadline ? new Date(deadline).toLocaleDateString() : '—';
  if (!(isNeedTime && hasHistory)) {
    return <span>{latest}</span>;
  }

  const items = [...history].sort((a, b) => {
    const ta = Date.parse(a.changedAt || 0) || 0;
    const tb = Date.parse(b.changedAt || 0) || 0;
    return tb - ta;
  });

  return (
    <div className="relative inline-flex items-center gap-2">
      <span>{latest}</span>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title="View older revised deadlines"
        className="p-1 rounded hover:bg-gray-100 text-blue-700 dark:text-blue-300 dark:hover:bg-gray-700"
        aria-expanded={open}
      >
        <Eye size={16} />
      </button>
      {open && (
        <div
          className="absolute z-50 mt-2 p-2 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded shadow text-xs w-56 right-0"
          onMouseLeave={() => setOpen(false)}
        >
          <div className="font-semibold mb-1 text-gray-700 dark:text-gray-100">Previous deadlines</div>
          <ul className="max-h-48 overflow-auto space-y-1">
            {items.map((it, idx) => (
              <li key={idx} className="flex justify-between gap-2">
                <span>{it.old ? new Date(it.old).toLocaleDateString() : '—'}</span>
                <span className="text-gray-500 dark:text-gray-400">
                  {it.changedAt ? new Date(it.changedAt).toLocaleString() : ''}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function MeetingCard({ meeting, groupMomRows, COLOR_BY_SEVERITY, statusTextClass }) {
  const attendees = [
    ...(Array.isArray(meeting.attendees) ? meeting.attendees : (meeting.attendees || '').split(',')),
    ...(meeting.additionalAttendees || []).map((a) => (typeof a === 'string' ? a : a.name || '')),
  ];

  return (
    <div className="bg-white rounded-xl p-5 shadow-sm border border-gray-200 text-sm text-gray-700">
      <div className="flex justify-between items-center mb-1">
        <h3 className="text-base font-semibold text-blue-700">{meeting.meetingName}</h3>
        <span className="text-xs text-gray-500">{new Date(meeting.dateOfMeeting).toLocaleString()}</span>
      </div>
      <p>
        <strong>Department:</strong> {meeting.department}
      </p>
      <p>
        <strong>Organizer:</strong> {meeting.organizerEmail}
      </p>

      <div className="mt-2">
        <strong className="block text-sm text-gray-700 mb-1">Attendees:</strong>
        {attendees.length <= 10 ? (
          <ul className="list-disc list-inside text-xs text-gray-600 pl-2">
            {attendees.map((name, idx) => (
              <li key={idx}>{name.trim()}</li>
            ))}
          </ul>
        ) : (() => {
            const content = attendees.map((name) => name.trim()).join('\n');
            const blob = new Blob([content], { type: 'text/plain' });
            const url = URL.createObjectURL(blob);
            const fileName = `${meeting.meetingName.replace(/\s+/g, '_')}_Attendees.txt`;
            return (
              <a
                href={url}
                download={fileName}
                className="text-blue-600 text-xs underline hover:text-blue-800 transition"
              >
                Download attendee list ({attendees.length} people)
              </a>
            );
          })()}
      </div>

      {meeting.mom?.length > 0 && (
        <div className="mt-3">
          <strong className="block text-sm text-gray-700 mb-1">Minutes of Meeting:</strong>
          <table className="w-full border border-gray-300 dark:border-gray-600 text-xs">
            <thead className="bg-gray-100">
              <tr>
                <th className="border px-2 py-1 text-left">Name</th>
                <th className="border px-2 py-1 text-left">Job / Activity</th>
                <th className="border px-2 py-1 text-left">Deadline</th>
                <th className="border px-2 py-1 text-left">Remark</th>
                <th className="border px-2 py-1 text-left">Assigned By</th>
                <th className="border px-2 py-1 text-left">Status</th>
              </tr>
            </thead>
            <tbody>
              {groupMomRows(meeting.mom).map((g, idx) => (
                <tr key={idx} style={{ backgroundColor: COLOR_BY_SEVERITY[g.severity] }}>
                  <td className="border px-2 py-1">
                    <span className={statusTextClass(g.primary.status)}>{g.primary.name}</span>
                    {g.count > 1 && (
                      <>
                        <span className="text-xs text-gray-600"> +{g.count - 1} others</span>
                        <span className="relative inline-block group ml-1 align-middle">
                          <Users
                            size={14}
                            className="text-blue-600 cursor-help inline-block hover:text-blue-700"
                            aria-hidden="true"
                            title="View team details"
                          />
                          <div className="absolute left-0 mt-1 z-10 hidden group-hover:block bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow p-3 w-72">
                            <div className="text-xs font-semibold mb-1">Assignees</div>
                            <ul className="max-h-48 overflow-auto text-xs space-y-1">
                              {g.members.map((m, i) => (
                                <li key={i} className="flex justify-between gap-2">
                                  <span className={`truncate ${statusTextClass(m.status)}`}>{m.name}</span>
                                  <span className={`shrink-0 ${statusTextClass(m.status)}`}>{m.status || 'Assigned'}</span>
                                </li>
                              ))}
                            </ul>
                          </div>
                        </span>
                      </>
                    )}
                  </td>
                  <td className="border px-2 py-1">{g.job}</td>
                  <td className="border px-2 py-1">
                    <DeadlineCell
                      deadline={g.primary.deadline || g.deadline}
                      status={g.primary.status}
                      history={g.primary.deadline_history || g.primary.deadlineHistory || []}
                    />
                  </td>
                  <td className="border px-2 py-1">{g.primary.remark || ''}</td>
                  <td className="border px-2 py-1">
                    {g.primary.assigned_by || g.primary.assignedBy || meeting.organizerEmail || meeting.organizer || '—'}
                  </td>
                  <td className="border px-2 py-1">{g.primary.status || ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Sticky Notes */}
      <StickyNotesBlock meeting={meeting} />

      {/* Download */}
      <div className="mt-3 flex justify-end">
        <button
          onClick={() => {
            const sheetData = [];
            sheetData.push(['Meeting Name', meeting.meetingName]);
            sheetData.push(['Department', meeting.department]);
            sheetData.push(['Organizer', meeting.organizerEmail || '']);
            sheetData.push(['Date Created', new Date(meeting.dateOfMeeting).toLocaleString()]);
            sheetData.push([]);
            sheetData.push(['Attendees']);
            (Array.isArray(meeting.attendees) ? meeting.attendees : (meeting.attendees || '').split(',')).forEach(
              (name) => {
                sheetData.push([name.trim()]);
              },
            );
            if (meeting.mom && meeting.mom.length > 0) {
              sheetData.push([]);
              sheetData.push(['Minutes of Meeting']);
              sheetData.push(['Name', 'Job / Activity', 'Deadline', 'Remark', 'Assigned By', 'Status']);
              meeting.mom.forEach((row) => {
                sheetData.push([
                  row.name || '',
                  row.job || '',
                  row.deadline || '',
                  row.remark || '',
                  row.assigned_by || row.assignedBy || meeting.organizerEmail || '',
                  row.status || '',
                ]);
              });
            }
            const worksheet = XLSX.utils.aoa_to_sheet(sheetData);
            const workbook = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(workbook, worksheet, 'Meeting Details');
            const fileName = `${(meeting.meetingName || 'Meeting').replace(/\s+/g, '_')}_Meeting.xlsx`;
            XLSX.writeFile(workbook, fileName);
          }}
          className="px-4 py-2 bg-gradient-to-r from-blue-500 to-green-500 text-white text-xs font-semibold rounded-lg shadow hover:from-green-600 hover:to-blue-600 transition duration-200"
        >
          Download
        </button>
      </div>
    </div>
  );
}

function StickyNotesBlock({ meeting }) {
  const notes = meeting.stickyNotes ?? meeting.stickynotes ?? [];
  if (!Array.isArray(notes) || notes.length === 0) return null;

  const tailwindToColor = {
    'bg-yellow-100': '#fef9c3',
    'bg-yellow-200': '#fef08a',
    'bg-red-100': '#fee2e2',
    'bg-red-200': '#fecaca',
    'bg-green-100': '#dcfce7',
    'bg-green-200': '#bbf7d0',
    'bg-blue-100': '#dbeafe',
    'bg-blue-200': '#bfdbfe',
    'bg-pink-100': '#fce7f3',
    'bg-pink-200': '#fbcfe8',
  };
  const resolveColor = (raw) => {
    if (!raw) return '#E5E7EB';
    if (typeof raw === 'string' && raw.startsWith('#')) return raw;
    return tailwindToColor[raw] || '#E5E7EB';
  };
  const hexToRgb = (hex) => {
    const h = hex.replace('#', '');
    const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
    const n = parseInt(full, 16);
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
  };

  return (
    <section className="mt-5">
      <div className="flex items-center gap-2 mb-2">
        <StickyNote size={16} className="text-blue-600" />
        <h4 className="text-sm font-semibold text-gray-800 dark:text-gray-100">Notes</h4>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {notes.map((note, idx) => {
          const accent = resolveColor(note.color);
          const { r, g, b } = hexToRgb(accent);
          const tint = `rgba(${r}, ${g}, ${b}, 0.10)`;
          const border = `rgba(${r}, ${g}, ${b}, 0.35)`;

          return (
            <div
              key={idx}
              className="relative rounded-lg border bg-white dark:bg-gray-800 shadow-sm hover:shadow-md transition"
              style={{ backgroundImage: `linear-gradient(0deg, ${tint}, ${tint})`, borderColor: border }}
            >
              <div className="absolute left-0 top-0 h-full w-1 rounded-l-lg" style={{ backgroundColor: accent }} />
              <div className="p-3 pl-4">
                <div className="flex items-center justify-between gap-2">
                  <span
                    className="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full"
                    style={{ backgroundColor: `rgba(${r}, ${g}, ${b}, 0.15)`, color: `rgb(${r}, ${g}, ${b})` }}
                  >
                    <StickyNote size={12} />
                  </span>
                  {note.created_at && (
                    <time dateTime={note.created_at} className="text-[11px] text-gray-500 dark:text-gray-400">
                      {new Date(note.created_at).toLocaleString()}
                    </time>
                  )}
                </div>
                <p className="mt-2 text-sm text-gray-800 dark:text-gray-100 whitespace-pre-wrap break-words">
                  {note.message || note.text}
                </p>
                {note.created_by && (
                  <div className="mt-2 text-[12px] text-gray-500 dark:text-gray-400">— {note.created_by}</div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
