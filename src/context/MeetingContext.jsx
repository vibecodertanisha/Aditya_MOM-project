import React, { createContext, useContext, useState, useEffect } from 'react';
import { v4 as uuid } from 'uuid';

const MeetingCtx = createContext(null);

export const MeetingProvider = ({ children }) => {
  const [meetings, setMeetings] = useState([]);
  const [meetingNames, setMeetingNames] = useState([
    'Daily Review Meeting',
    'Monthly Performance Review- Cluster',
    'Core Committee Meeting',
  ]);
  const [departments, setDepartments] = useState([
    'CPP Operation',
    'CPP Mechanical',
    'CPP Technical Services',
  ]);
  const [attendeeOptions, setAttendeeOptions] = useState([
    'Anand Keshri', 'Abhishek Kumar'
  ]);

  // 🔄 Load meetings from backend on mount
  const fetchMeetings = async () => {
    try {
      const res = await fetch('http://10.36.81.141:5000/api/meetings');
      const data = await res.json();
      const normalized = data.map(m => ({
        ...m,
        id: m.meeting_id,
        meetingName: m.meetingName || m.meeting_name || 'Untitled',
        stickyNotes: m.stickyNotes || [],
        organizerEmail: m.organizerEmail || m.organizer_email,
        dateOfMeeting: m.dateOfMeeting || m.date_of_meeting,
        attendees: Array.isArray(m.attendees)
          ? m.attendees
          : (m.attendees || '').split(',').map(a => a.trim()).filter(Boolean),
      }));
      setMeetings(normalized);
      setMeetingNames(normalized.map(m => m.meetingName));
    } catch (err) {
      console.error('Failed to fetch meetings', err);
    }
  };

  useEffect(() => {
    fetchMeetings();
  }, []);

  // 🟢 Create a new meeting
  const createMeeting = async (data) => {
    try {
      // Step 1: Create the meeting
      const response = await fetch('http://10.36.81.141:5000/api/meetings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });

      if (!response.ok) {
        throw new Error('Failed to create meeting');
      }

      const { meeting_id } = await response.json();

      // Step 2: Fetch full meeting details
      const fullRes = await fetch(`http://10.36.81.141:5000/api/meetings/${meeting_id}`);
      if (!fullRes.ok) {
        throw new Error('Failed to fetch full meeting');
      }

      const fullMeeting = await fullRes.json();

      // Step 3: Normalize for frontend consistency
      const normalized = {
        ...fullMeeting,
        id: fullMeeting.meeting_id,
        meetingName: fullMeeting.meetingName || fullMeeting.meeting_name || 'Untitled',
        organizerEmail: fullMeeting.organizerEmail || fullMeeting.organizer_email,
        dateOfMeeting: fullMeeting.dateOfMeeting || fullMeeting.date_of_meeting,
        attendees: Array.isArray(fullMeeting.attendees)
          ? fullMeeting.attendees
          : (fullMeeting.attendees || '').split(',').map((a) => a.trim()).filter(Boolean),
        stickyNotes: fullMeeting.stickyNotes || [],
      };

      // Step 4: Add to top of meeting list
      setMeetings((prev) => [normalized, ...prev]);

      return normalized;
    } catch (err) {
      console.error('Failed to create meeting:', err);
      return null;
    }
  };

  // 🔵 Update MoM
  const updateMom = async (id, mom) => {
    try {
      const response = await fetch(`http://10.36.81.141:5000/api/meetings/${id}/mom`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mom }),
      });

      if (!response.ok) {
        throw new Error('Failed to update MoM');
      }

      const updatedMeeting = await response.json();
      setMeetings((prev) =>
        prev.map((m) => (m.id === Number(id) ? { ...m, mom } : m))
      );
    } catch (err) {
      console.error('Failed to update MoM', err);
    }
  };

  // 🟡 Finalize MoM with duration
  const finalizeMom = async (id, mom) => {
    try {
      const res = await fetch(`http://10.36.81.141:5000/api/meetings/${id}/finalize`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mom }),
      });
      const updated = await res.json();
      setMeetings(prev =>
        prev.map(m => (m.id === Number(id) ? updated : m))
      );
    } catch (err) {
      console.error('Failed to finalize MoM', err);
    }
  };

  // 🧱 Update status for individual MoM row
  const updateMomStatus = async (momId, payload, meetingId = null) => {
    try {
      const res = await fetch(`http://10.36.81.141:5000/api/mom/${momId}/update-status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error('Failed to update status');
 
      // Refresh the specific meeting's MoM if we know it; otherwise refresh all
      if (meetingId) {
        await fetchMomByMeetingId(meetingId);
      } else {
        await fetchMeetings();
      }
    } catch (err) {
      console.error('Failed to update status:', err);
      throw err;
    }
  };
  // ❌ Delete meeting (frontend-only for now)
  const deleteMeeting = async (id) => {
    try {
      const response = await fetch(`http://10.36.81.141:5000/api/meetings/${id}`, {
        method: 'DELETE',
      });

      if (!response.ok) {
        throw new Error('Failed to delete meeting');
      }

      // Remove from local state after successful deletion
      setMeetings((prev) => prev.filter((meeting) => meeting.id !== id));
    } catch (err) {
      console.error('Failed to delete meeting:', err);
    }
  };

  const addMeetingName = (name) => {
    if (name && !meetingNames.includes(name)) {
      setMeetingNames(prev => [...prev, name]);
    }
  };

  const addDepartment = (dept) => {
    if (dept && !departments.includes(dept)) {
      setDepartments(prev => [...prev, dept]);
    }
  };

  const addAttendeeOption = (attendee) => {
    if (attendee && !attendeeOptions.includes(attendee)) {
      setAttendeeOptions(prev => [...prev, attendee]);
    }
  };

  // ➕ Add attendee to existing meeting
  const addExtraAttendee = async (meetingId, name) => {
    try {
      const response = await fetch(`http://10.36.81.141:5000/api/meetings/${meetingId}/attendees`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });

      if (!response.ok) {
        throw new Error('Failed to add extra attendee');
      }

      const updatedMeeting = await response.json();
      setMeetings((prev) =>
        prev.map((m) =>
          m.id === meetingId
            ? { ...m, additionalAttendees: [...new Set([...(m.additionalAttendees || []), name])] }
            : m
        )
      );
    } catch (err) {
      console.error('Failed to add extra attendee:', err);
    }
  };

  // 📌 Sticky note
  const addStickyNote = async (meetingId, note) => {
    try {
      const response = await fetch(`http://10.36.81.141:5000/api/meetings/${meetingId}/stickynotes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ note }),
      });

      if (!response.ok) {
        throw new Error('Failed to add sticky note');
      }

      const updatedMeeting = await response.json();
      setMeetings((prev) =>
        prev.map((m) =>
          m.id === meetingId ? { ...m, stickyNotes: [...(m.stickyNotes || []), note] } : m
        )
      );
    } catch (err) {
      console.error('Failed to add sticky note:', err);
    }
  };

  // 🔍 Get all attendees of a specific meeting name
  const getAttendeesByMeetingName = (name) => {
    const unique = new Set();
    meetings.forEach(m => {
      if (m.meetingName === name) {
        m.attendees.forEach(a => unique.add(a));
      }
    });
    return Array.from(unique);
  };

  const addMomRows = async (meetingId, rows) => {
    const res = await fetch(`http://10.36.81.141:5000/api/meetings/${meetingId}/mom`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mom: rows }),
    });
    if (!res.ok) throw new Error('Failed to add MoM rows');

    // refresh local cache
    await fetchMomByMeetingId(meetingId);
  };

  const fetchMomByMeetingId = async (meetingId) => {
    try {
      const res = await fetch(`http://10.36.81.141:5000/api/meetings/${meetingId}/mom`);
      if (!res.ok) throw new Error('Failed to fetch MoM');
      const mom = await res.json();

      setMeetings((prev) =>
        prev.map((m) =>
          m.id === Number(meetingId) ? { ...m, mom } : m
        )
      );
    } catch (err) {
      console.error('Error fetching MoM:', err);
    }
  };

  return (
    <MeetingCtx.Provider
      value={{
        meetings,
        createMeeting,
        updateMom,
        finalizeMom,
        updateMomStatus,
        deleteMeeting,
        meetingNames,
        departments,
        attendeeOptions,
        addMeetingName,
        addDepartment,
        addAttendeeOption,
        addExtraAttendee,
        addStickyNote,
        getAttendeesByMeetingName,
        fetchMomByMeetingId,
        fetchMeetings,
        addMomRows
      }}
    >
      {children}
    </MeetingCtx.Provider>
  );
};

export const useMeetings = () => useContext(MeetingCtx);
