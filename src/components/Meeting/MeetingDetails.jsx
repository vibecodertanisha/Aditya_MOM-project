import React, { useState, useEffect,useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useMeetings } from '../../context/MeetingContext';
import { format } from 'date-fns';
import { v4 as uuid } from 'uuid';
import { Search, X } from 'lucide-react';

const ALL_OPTION = '__ALL__';

const noteColors = [
  '#fef9c3', // yellow-100
  '#fef08a', // yellow-200
  '#fde047', // yellow-300
  '#fca5a5', // red-300
  '#fdba74', // orange-300
  '#86efac', // green-300
  '#93c5fd', // blue-300
  '#a5b4fc', // indigo-300
  '#d8b4fe', // violet-300
  '#f9a8d4', // pink-300
  '#a7f3d0', // teal-300
  '#67e8f9', // cyan-300
];

const API_BASE = 'http://10.36.81.141:5000';

// Prefer user's display name; if missing, fallback to email local-part
const normalizeUserName = (u) => {
  const name = (u?.name ?? '').trim();
  if (name) return name;
  const email = (u?.email ?? '').trim();
  return email ? email.split('@')[0] : '';
};

// Case-insensitive merge + sort (keep original casing)
const mergeUnique = (base = [], extra = []) => {
  const seen = new Set(base.map(n => n.toLowerCase()));
  const out = [...base];
  for (const n of extra) {
    const key = String(n || '').toLowerCase();
    if (key && !seen.has(key)) {
      seen.add(key);
      out.push(n);
    }
  }
  return out.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
};

function AutoExpandTextArea({
  value,
  onChange,
  placeholder = '',
  className = '',
}) {
  const [expanded, setExpanded] = React.useState(false);
  const ref = React.useRef(null);

  React.useEffect(() => {
    if (!ref.current) return;
    // autosize to fit content
    ref.current.style.height = 'auto';
    ref.current.style.height = `${ref.current.scrollHeight}px`;
  }, [value, expanded]);

  const base =
    'w-full border border-blue-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-400 transition-all duration-200';
  // collapsed = one-line look; expanded = no max-height
  const size = expanded
    ? 'min-h-[96px] max-h-none overflow-auto'
    : 'min-h-[36px] max-h-[36px] overflow-hidden';

  return (
    <textarea
      ref={ref}
      rows={1}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className={`${base} ${size} ${className}`}
      onFocus={() => setExpanded(true)}
      onClick={() => setExpanded(true)}
      onBlur={() => setExpanded(false)}
    />
  );
}

export default function MeetingDetails() {
  const { id } = useParams();
  const { meetings, updateMom, fetchMomByMeetingId, addExtraAttendee, addStickyNote } = useMeetings();
  const navigate = useNavigate();

  const [meeting, setMeeting] = useState(null);
  const [attendees, setAttendees] = useState([]);
  const [notes, setNotes] = useState([]);
  const [rows, setRows] = useState([]);
  const [newAttendee, setNewAttendee] = useState('');
  const [noteInput, setNoteInput] = useState('');
  const [showPanels, setShowPanels] = useState(false);
  const [loading, setLoading] = useState(true);

  const [allAttendees, setAllAttendees] = useState([]);
  const [showSuggest, setShowSuggest] = useState(false);

  const filteredSuggestions = useMemo(() => {
    const q = newAttendee.trim().toLowerCase();
    const existing = new Set(attendees.map((n) => n.toLowerCase()));
    const base = allAttendees.filter((n) => !existing.has(n.toLowerCase()));
    const list = q ? base.filter((n) => n.toLowerCase().includes(q)) : base;
    return list.slice(0, 8); // cap list
  }, [newAttendee, allAttendees, attendees]);

  const splitToArray = (val) =>
    Array.isArray(val)
      ? val
      : typeof val === 'string'
      ? val.split(',').map(s => s.trim()).filter(Boolean)
      : [];

  const toName = (x) =>
    (typeof x === 'string' ? x : (x?.name ?? x?.displayName ?? x?.email ?? '')).trim();

  

  // Fetch meeting data on mount
  useEffect(() => {
    const fetchMeeting = async () => {
      try {
        const res = await fetch(`http://10.36.81.141:5000/api/meetings/${id}`);
        const data = await res.json();

        if (res.ok) {
          setMeeting(data);

          // ⬇️ REPLACE your old setAttendees(...) with this block
          const toName = (x) =>
            (typeof x === 'string'
              ? x
              : (x?.name ?? x?.displayName ?? x?.email ?? '')
            ).trim();

          const merged = [
            ...(data.attendees || []).map(toName),
            ...(data.additionalAttendees || []).map(toName),
          ].filter(Boolean);

          const core = splitToArray(data.attendees).map(toName);
          const extra = [
            ...splitToArray(data.additionalAttendees),
            ...splitToArray(data.additional_attendees),
          ].map(toName);

          // optional: sort; remove if you want to keep original order
          const unique = Array.from(new Set([...core, ...extra]))
            .filter(Boolean)
            .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
            

          setAttendees(unique);
          // ⬆️ END replacement

          setNotes(data.stickyNotes || []);
        } else {
          console.error('Meeting not found');
        }
      } catch (err) {
        console.error('Failed to fetch meeting details', err);
      } finally {
        setLoading(false);
      }
    };

    fetchMeeting();
  }, [id]);

  useEffect(() => {
    try {
      const all = (meetings || []).flatMap((m) => {
        const base = splitToArray(m.attendees);
        const extraA = splitToArray(m.additionalAttendees);
        const extraB = splitToArray(m.additional_attendees);
        const momNames = Array.isArray(m.mom) ? m.mom.map(r => r?.name || '') : [];
        return [...base, ...extraA, ...extraB, ...momNames].map(toName).filter(Boolean);
      });

      // de-dupe case-insensitively but keep original casing
      const seen = new Set();
      const unique = [];
      for (const n of all) {
        const key = n.toLowerCase();
        if (!seen.has(key)) { seen.add(key); unique.push(n); }
      }

      setAllAttendees(prev => mergeUnique(prev, unique));
    } catch (e) {
      console.error('Failed to load past attendees', e);
    }
  }, [meetings]);

  // Show/hide side panels
  useEffect(() => {
    const handleMouseMove = (e) => {
      if (window.innerWidth - e.clientX < 50) {
        setShowPanels(true);
      } else if (e.clientX < window.innerWidth - 250) {
        setShowPanels(false);
      }
    };
    window.addEventListener('mousemove', handleMouseMove);
    return () => window.removeEventListener('mousemove', handleMouseMove);
  }, []);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch(`${API_BASE}/api/users`);
        const users = await res.json(); // [{userId, name, email, ...}]
        const fromUsers = users.map(normalizeUserName).filter(Boolean);
        if (alive) {
          setAllAttendees(prev => mergeUnique(prev, fromUsers));
        }
      } catch (e) {
        console.error('Failed to fetch users for suggestions', e);
      }
    })();
    return () => { alive = false; };
  }, []);

  const addRow = () => {
    setRows((r) => [
      ...r,
      { id: uuid(), name: [],nameQuery: '',nameSearchOpen: false, desc: '', deadline: '', remark: '', assignedBy: '', category: '' },
    ]);
  };

  const delRow = (rid) => setRows((r) => r.filter((x) => x.id !== rid));

  const handleChange = (rid, field, value) =>
    setRows((r) => r.map((x) => (x.id === rid ? { ...x, [field]: value } : x)));



  const { fetchMeetings } = useMeetings();

  const handleSubmit = async () => {
    // Clean attendee list used when ALL is selected
    const people = Array.from(new Set((attendees || []).map(a => String(a).trim()).filter(Boolean)));

    const expanded = [];
    for (const row of rows) {
      const base = {
        job: row.desc,
        deadline: row.deadline,
        remark: row.remark,
        assignedBy: row.assignedBy,
        category: row.category,
      };

      // Backward-compat: if some rows still carry a single 'name'
      const picked = Array.isArray(row.names)
        ? row.names
        : (row.name ? [row.name] : []);

      // Resolve targets
      let targets;
      if (picked.includes(ALL_OPTION)) {
        targets = people;                     // everyone
      } else {
        targets = picked.map(s => String(s).trim()).filter(Boolean);
      }

      // Create one assignment per target
      targets.forEach(person => expanded.push({ ...base, name: person }));
    }

    // Optional: dedupe identical assignments
    const seen = new Set();
    const formattedMom = expanded.filter(r => {
      const key = `${r.name}|${r.job}|${r.deadline}|${r.remark}|${r.assignedBy}|${r.category}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    try {
      await updateMom(id, formattedMom);
      await fetchMomByMeetingId(id);
      await fetchMeetings();
      alert('Minutes submitted!');
      navigate('/');
    } catch (err) {
      console.error('Failed to submit MoM', err);
    }
  };

  const addAttendee = async (nameOverride) => {
    const trimmed = (nameOverride ?? newAttendee).trim();
    // case-insensitive duplicate guard
    if (!trimmed || attendees.some(n => n.toLowerCase() === trimmed.toLowerCase())) return;

    try {
      // Persist via the endpoint you already have
      const resp = await fetch(`http://10.36.81.141:5000/api/meetings/${id}/attendees`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: trimmed }),
      });
      if (!resp.ok) throw new Error('Failed to add extra attendee');

      // Update local merged list immediately
      setAttendees(prev => {
        const set = new Set(prev.map(p => p.toLowerCase()));
        return set.has(trimmed.toLowerCase()) ? prev : [...prev, trimmed];
      });

      // Keep both camelCase and snake_case locally (backend may use either)
      setMeeting(prev => ({
        ...prev,
        attendees: prev?.attendees || prev?.attendees === '' ? prev.attendees : prev?.attendees, // leave CSV as-is
        additionalAttendees: [...(prev?.additionalAttendees || []), trimmed],
        additional_attendees: [...(prev?.additional_attendees || []), trimmed],
      }));

      // Refresh global state so MainPage picks it up
      await fetchMeetings();

      if (!nameOverride) setNewAttendee('');
    } catch (err) {
      console.error('Failed to add attendee:', err);
    }
  };

  

  const addNote = async () => {
    if (noteInput.trim()) {
      const color = noteColors[Math.floor(Math.random() * noteColors.length)];
      const newNote = {
        message: noteInput.trim(),
        color,
        created_by: 'Anonymous',
        created_at: new Date().toISOString(),
      };

      try {
        const response = await fetch(`http://10.36.81.141:5000/api/meetings/${id}/stickynotes`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(newNote),
        });

        if (!response.ok) throw new Error('Failed to add sticky note');

        setNotes((prev) => [...prev, newNote]);
        setNoteInput('');
      } catch (err) {
        console.error('Failed to add sticky note:', err);
      }
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-white p-4 font-sans">
      {loading ? (
        <p className="p-8 text-gray-600">Loading meeting...</p>
      ) : !meeting ? (
        <p className="p-8 text-red-600">Meeting not found.</p>
      ) : (
        <>
          {/* Meeting Header */}
          <header className="flex items-center justify-between bg-blue-600 text-white p-6 rounded shadow mb-4">
            <div>
              <h1 className="text-3xl font-bold tracking-wide">
                {meeting.meetingName || meeting.meeting_name || 'Untitled Meeting'}
              </h1>
              <p className="text-sm text-blue-100 mt-1">
                {meeting.created && !isNaN(new Date(meeting.created)) ? (
                  `${format(new Date(meeting.created), 'PPP p')} · ${attendees.length} attendees`
                ) : (
                  `${attendees.length} attendees`
                )}
              </p>
            </div>
          </header>

          {/* Main Content */}
          <div className="flex space-x-4">
            {/* MoM Table */}
            <div className={`transition-all duration-300 ${showPanels ? 'w-[80%]' : 'w-full'} bg-white p-6 rounded-lg shadow-xl overflow-auto max-h-[80vh]`}>
              <div className="flex justify-between items-center mb-4">
                <h2 className="text-xl font-semibold text-blue-700">Minutes of Meeting</h2>
                <button
                  onClick={addRow}
                  className="text-2xl bg-blue-500 hover:bg-blue-600 text-white w-10 h-10 rounded-full flex items-center justify-center shadow-md"
                >+</button>
              </div>
              <table className="min-w-full text-sm">
                <thead className="bg-blue-100 text-blue-800">
                  <tr>
                    <th className="px-4 py-3 text-left">Name</th>
                    <th className="px-4 py-3 text-left">Job / Activity</th>
                    <th className="px-4 py-3 text-left">Deadline</th>
                    <th className="px-4 py-3 text-left">Remark</th>
                    <th className="px-4 py-3 text-left">Assigned By</th>
                    <th className="px-4 py-3 text-left">Category</th>
                    <th className="px-4 py-3 text-left"> </th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.id} className="border-b border-blue-200 hover:bg-blue-50">
                      <td className="px-4 py-3 align-top">
                        <div className="space-y-2">
                          {/* Top controls: All toggle + (icon -> input) */}
                          <div className="flex items-center gap-3">
                            {/* All (renamed; no "everyone") */}
                            <label className="flex items-center gap-2 text-sm">
                              <input
                                type="checkbox"
                                checked={(row.names || []).includes(ALL_OPTION)}
                                onChange={(e) => {
                                  const checked = e.target.checked;
                                  // Selecting All clears individuals and hides search
                                  handleChange(row.id, 'names', checked ? [ALL_OPTION] : []);
                                  if (checked) {
                                    handleChange(row.id, 'nameSearchOpen', false);
                                    handleChange(row.id, 'nameQuery', '');
                                  }
                                }}
                              />
                              <span>All</span>
                            </label>

                            {/* Icon -> inline search bar (hidden/disabled when All is selected) */}
                            {!(row.names || []).includes(ALL_OPTION) && (
                              row.nameSearchOpen ? (
                                <div className="flex items-center gap-2 w-full">
                                  <input
                                    autoFocus
                                    type="text"
                                    value={row.nameQuery || ''}
                                    onChange={(e) => handleChange(row.id, 'nameQuery', e.target.value)}
                                    placeholder="Search name…"
                                    className="text-sm border border-blue-300 rounded px-2 py-1 w-full focus:outline-none focus:ring-2 focus:ring-blue-400"
                                    onKeyDown={(e) => {
                                      if (e.key === 'Escape') {
                                        handleChange(row.id, 'nameSearchOpen', false);
                                      }
                                    }}
                                  />
                                  <button
                                    type="button"
                                    onClick={() => {
                                      handleChange(row.id, 'nameSearchOpen', false);
                                      if (!(row.names || []).length) {
                                        // optional: clear query when nothing selected
                                        handleChange(row.id, 'nameQuery', '');
                                      }
                                    }}
                                    className="p-1 rounded border border-blue-200 text-blue-600 hover:bg-blue-50"
                                    title="Close search"
                                  >
                                    <X size={16} />
                                  </button>
                                </div>
                              ) : (
                                <button
                                  type="button"
                                  onClick={() => handleChange(row.id, 'nameSearchOpen', true)}
                                  className="p-1 rounded border border-blue-200 text-blue-600 hover:bg-blue-50"
                                  title="Search names"
                                >
                                  <Search size={16} />
                                </button>
                              )
                            )}
                          </div>

                          {/* Filtered list based on query */}
                          <div className="max-h-28 overflow-y-auto pl-1 space-y-1">
                            {(
                              (() => {
                                const q = (row.nameQuery || '').toLowerCase().trim();
                                return q
                                  ? attendees.filter((n) => n.toLowerCase().includes(q))
                                  : attendees;
                              })()
                            ).map((n) => {
                              const allSelected = (row.names || []).includes(ALL_OPTION);
                              const selected = (row.names || []).includes(n);
                              return (
                                <label key={n} className="flex items-center gap-2 text-sm">
                                  <input
                                    type="checkbox"
                                    disabled={allSelected}
                                    checked={selected}
                                    onChange={(e) => {
                                      const checked = e.target.checked;
                                      const cur = new Set(row.names || []);
                                      cur.delete(ALL_OPTION); // never mix with ALL
                                      if (checked) cur.add(n);
                                      else cur.delete(n);
                                      handleChange(row.id, 'names', Array.from(cur));
                                    }}
                                  />
                                  <span>{n}</span>
                                </label>
                              );
                            })}
                          </div>

                          {/* Footer controls */}
                          <div className="flex items-center justify-between text-xs text-gray-500">
                            <button
                              type="button"
                              onClick={() => {
                                handleChange(row.id, 'names', []);
                                handleChange(row.id, 'nameQuery', '');
                                handleChange(row.id, 'nameSearchOpen', false);
                              }}
                              className="text-blue-600 hover:underline"
                            >
                              Clear
                            </button>
                            <span>
                              {(row.names || []).includes(ALL_OPTION)
                                ? 'Everyone selected'
                                : `${(row.names || []).length} selected`}
                            </span>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3 align-middle">
                        <AutoExpandTextArea
                          value={row.desc}
                          onChange={(v) => handleChange(row.id, 'desc', v)}
                          
                          placeholder="Describe task"
                        />
                      </td>
                      <td className="px-4 py-3 align-middle">
                        <input
                          type="date"
                          value={row.deadline}
                          onChange={(e) => handleChange(row.id, 'deadline', e.target.value)}
                          className="border border-blue-300 rounded p-1 focus:outline-none focus:ring-2 focus:ring-blue-400"
                        />
                      </td>
                      <td className="px-4 py-3 align-middle">
                        <AutoExpandTextArea
                          value={row.remark}
                          onChange={(v) => handleChange(row.id, 'remark', v)}
                          
                          placeholder="Optional"
                        />
                      </td>
                      <td className="px-4 py-3 align-middle">
                        <select
                          value={row.assignedBy}
                          onChange={(e) => handleChange(row.id, 'assignedBy', e.target.value)}
                          className="border border-blue-300 rounded w-full p-1 focus:outline-none focus:ring-2 focus:ring-blue-400"
                        >
                          <option value="">Select</option>
                          {attendees.map((n) => (
                            <option key={n} value={n}>{n}</option>
                          ))}
                        </select>
                      </td>
                      <td className="px-4 py-3 align-middle text-center">
                        <AutoExpandTextArea
                          value={row.category}
                          onChange={(v) => handleChange(row.id, 'category', v)}
                          
                          placeholder="Category"
                        />
                      </td>
                      <td className="p-2 text-center">
                        <button
                          onClick={() => delRow(row.id)}
                          className="text-red-600 hover:text-red-800 font-bold"
                        >🗑</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {rows.length > 0 && (
                <div className="flex justify-end mt-6">
                  <button onClick={handleSubmit} className="bg-green-600 hover:bg-green-700 text-white px-6 py-2 rounded-lg shadow-md">
                    Final Submit
                  </button>
                </div>
              )}
            </div>

            {/* Side Panel */}
            {showPanels && (
              <div className="w-[20%] flex flex-col space-y-4 max-h-[80vh] overflow-hidden">
                {/* Attendees */}
                <div className="flex-1 bg-gradient-to-b from-white to-blue-50 p-4 rounded-lg shadow-md overflow-auto">
                  <h2 className="font-bold text-lg text-blue-700 mb-3">Attendees</h2>
                  <ul className="mb-4 text-sm text-gray-700">
                    {attendees.map((name, i) => (
                      <li key={i} className="border-b py-1 border-blue-200">{name}</li>
                    ))}
                  </ul>
                  <div className="relative">
                    <input
                      type="text"
                      value={newAttendee}
                      onChange={(e) => setNewAttendee(e.target.value)}
                      onFocus={() => setShowSuggest(true)}
                      className="border border-blue-300 rounded w-full p-1 mb-2 focus:outline-none focus:ring-2 focus:ring-blue-400"
                      placeholder="Type a name…"
                    />

                    {showSuggest && filteredSuggestions.length > 0 && (
                      <ul className="absolute z-20 mt-0 w-full max-h-52 overflow-auto rounded-md border border-gray-200 bg-white shadow">
                        {filteredSuggestions.map((name) => (
                          <li key={name}>
                            <button
                              type="button"
                              onMouseDown={async (e) => {
                                e.preventDefault();         // keep the input from blurring first
                                await addAttendee(name);    // 🔒 persist + update local state
                                setShowSuggest(false);
                              }}
                              className="block w-full text-left px-3 py-2 text-sm hover:bg-blue-50"
                            >
                              {name}
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>

                  <div className="flex gap-2">
                    <button
                      onClick={addAttendee}
                      className="flex-1 bg-blue-500 hover:bg-blue-600 text-white px-3 py-1 rounded shadow-sm"
                    >
                      Add Attendee
                    </button>
                    <button
                      type="button"
                      onClick={() => { setNewAttendee(''); setShowSuggest(false); }}
                      className="px-3 py-1 rounded border border-gray-300 text-gray-700 hover:bg-gray-50"
                    >
                      Clear
                    </button>
                  </div>
                </div>

                {/* Sticky Notes */}
                <div className="flex-1 bg-gradient-to-b from-yellow-50 to-white p-4 rounded-lg shadow-md overflow-auto">
                  <h2 className="font-bold text-lg text-yellow-700 mb-3">Sticky Notes</h2>
                  <textarea
                    value={noteInput}
                    onChange={(e) => setNoteInput(e.target.value)}
                    rows={3}
                    className="border border-yellow-300 rounded w-full p-2 mb-2 focus:outline-none focus:ring-2 focus:ring-yellow-400"
                    placeholder="Write a note..."
                  />
                  <button onClick={addNote} className="bg-yellow-400 hover:bg-yellow-500 text-black px-3 py-1 rounded w-full mb-4 shadow-sm">
                    Add Note
                  </button>
                  <div className="space-y-2">
                    {notes.map((note, idx) => (
                      <div
                        key={idx}
                        className="p-2 rounded shadow text-sm"
                        style={{
                          backgroundColor: note.color || '#fef3c7',
                          border: `2px solid ${note.color || '#facc15'}`,
                        }}
                      >
                        {note.message || note.text}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
