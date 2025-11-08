import React, { useState, useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { useMeetings } from '../../context/MeetingContext';
import { useNavigate, useParams } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Search, SortAsc } from 'lucide-react';
import { format } from 'date-fns';

const API_BASE = 'http://10.36.81.141:5000';

export default function NewMeetingModal({ close }) {
  const { id } = useParams(); // Get the meeting ID from URL params
  const {
    meetings,
    createMeeting,
    fetchMeetings,
    meetingNames,
    departments,
    attendeeOptions,
    addMeetingName,
    addDepartment,
    addAttendeeOption,
    getAttendeesByMeetingName,
  } = useMeetings();

  const navigate = useNavigate();
  const { register, handleSubmit, watch } = useForm({
    defaultValues: {
      meetingName: '',
      company: 'Hindalco',
      plant: 'CPP',
      department: '',
      email: '',
      dateOfMeeting: ''
    },
  });

  const selectedMeetingName = watch('meetingName');
  const [attendees, setAttendees] = useState([]);
  const [newMeetingName, setNewMeetingName] = useState('');
  const [newDepartment, setNewDepartment] = useState('');
  const [newAttendee, setNewAttendee] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [filteredOptions, setFilteredOptions] = useState([]);

  const visibleOptions = React.useMemo(() => {
    const q = (searchTerm || '').trim().toLowerCase();
    return (filteredOptions || [])
      .map(n => (n ?? '').toString().trim())
      .filter(Boolean)
      .filter(n => !q || n.toLowerCase().includes(q))
      .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
  }, [filteredOptions, searchTerm]);

  const [attendeeSource, setAttendeeSource] = useState('specific');

  const uniqueMeetingNames = React.useMemo(() => {
    const seen = new Set();
    const out = [];

    // 1) derive from actual meetings (each row may repeat the name)
    (meetings || []).forEach((m) => {
      const v = String(m.meetingName || m.meeting_name || '').trim();
      if (!v) return;
      const key = v.toLowerCase();
      if (!seen.has(key)) { seen.add(key); out.push(v); }
    });

    // 2) merge in any names already in context (optional, keeps manual adds)
    (Array.isArray(meetingNames) ? meetingNames : []).forEach((n) => {
      const v = String(n || '').trim();
      if (!v) return;
      const key = v.toLowerCase();
      if (!seen.has(key)) { seen.add(key); out.push(v); }
    });

    // sort nicely
    return out.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
  }, [meetings, meetingNames]);
  
  
  

  useEffect(() => {
    const fetchMeetingData = async () => {
      try {
        const res = await fetch('http://10.36.81.141:5000/api/meetings');
        const data = await res.json();

        const nameSet = new Set();
        const deptSet = new Set();
        const attendeeSet = new Set();

        (Array.isArray(data) ? data : []).forEach((m) => {
          // meeting names (supports meetingName or meeting_name)
          const n = String(m.meetingName ?? m.meeting_name ?? '').trim();
          if (n) nameSet.add(n);

          // departments
          const d = String(m.department ?? '').trim();
          if (d) deptSet.add(d);

          // attendees: can be array or comma-separated string
          const attList = Array.isArray(m.attendees)
            ? m.attendees
            : String(m.attendees ?? '')
                .split(',')
                .map((x) => x.trim())
                .filter(Boolean);

          attList.forEach((a) => attendeeSet.add(a));
        });

        // Push into context
        nameSet.forEach(addMeetingName);
        deptSet.forEach(addDepartment);
        attendeeSet.forEach(addAttendeeOption);
      } catch (error) {
        console.error('Error fetching data:', error);
      }
    };

    fetchMeetingData();
    // include the context updaters so this effect is stable
  }, [addMeetingName, addDepartment, addAttendeeOption]);

  useEffect(() => {
    const fetchAttendees = async () => {
      try {
        if (attendeeSource === 'all') {
          // 🚀 Pull every user from the DB
          const res = await fetch(`${API_BASE}/api/users`);
          const users = await res.json(); // [{ userId, name, email, ... }]
          // Use name if present, fallback to email
          const names = users
            .map(u => (u.name && u.name.trim()) ? u.name.trim() : (u.email || '').trim())
            .filter(Boolean);

          // Deduplicate + sort
          const allUnique = [...new Set(names)].sort((a, b) =>
            a.localeCompare(b, undefined, { sensitivity: 'base' })
          );
          setFilteredOptions(allUnique);
          return;
        }

        if (attendeeSource === 'specific' && selectedMeetingName) {
          // Keep your existing "specific" logic (from meetings)
          const res = await fetch(`${API_BASE}/api/meetings`);
          const data = await res.json();
          const matched = data.filter(m =>
            m.meeting_name === selectedMeetingName || m.meetingName === selectedMeetingName
          );
          const specific = [...new Set(matched.flatMap(m => (m.attendees || '')
            .split(',').map(a => a.trim()).filter(Boolean)))];

          setFilteredOptions(specific.sort((a, b) =>
            a.localeCompare(b, undefined, { sensitivity: 'base' })
          ));
          return;
        }

        setFilteredOptions([]);
      } catch (err) {
        console.error('Error fetching attendees', err);
        setFilteredOptions([]);
      }
    };

    fetchAttendees();
  }, [attendeeSource, selectedMeetingName]);

  const handleAttendeeToggle = (name) => {
    setAttendees((prev) =>
      prev.includes(name)
        ? prev.filter((n) => n !== name)
        : [...prev, name]
    );
  };

  const handleRemoveAttendee = (index) => {
    setAttendees((prev) => prev.filter((_, i) => i !== index));
  };

  const addAttendee = (name) => {
    if (!attendees.includes(name)) {
      setAttendees((prev) => [...prev, name]);
    }
  };

  const onSubmit = async (data) => {

    const formattedDate = format(new Date(), 'dd MMM yyyy, h:mm a');

    const meetingData = {
      meetingName: data.meetingName,
      organizerEmail: data.email,
      dateOfMeeting: new Date().toISOString(),
      attendees,
      department: data.department,
      company: data.company,
      plant: data.plant,
      presentByDate: {}  // optional
    };

    // Log the data to be sent to the server
    console.log("Sending meeting data:", meetingData); // This will show the data being sent

    try {
      const response = await fetch('http://10.36.81.141:5000/api/meetings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(meetingData), // Make sure 'department' is included here
      });

      if (!response.ok) {
        throw new Error('Failed to create meeting');
      }

      const createdMeeting = await response.json();
      await fetchMeetings();
      console.log('Created Meeting:', createdMeeting); // Log the created meeting response
      console.log('Navigating to meeting ID:', createdMeeting.meeting_id);
      navigate(`/meeting/${createdMeeting.meeting_id}`); // Redirect to the meeting page
      close();  // Close the modal after successfully creating the meeting
    } catch (error) {
      console.error('Error creating meeting:', error);
    }
  };

  return (
    <motion.div
      className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
    >
      <motion.div
        className="bg-white w-full max-w-[90vw] max-h-[92vh] p-6 rounded-xl shadow-2xl overflow-hidden"
        initial={{ y: -30, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
      >
        <h2 className="text-2xl font-bold text-gray-800 text-center mb-4">Create New Meeting</h2>

        <form onSubmit={handleSubmit(onSubmit)} className="flex gap-6 max-h-[70vh] text-sm overflow-y-auto">
          {/* Left Section */}
          <div className="flex-[1.4] p-4 space-y-5 bg-white/60 backdrop-blur-lg rounded-xl shadow-inner">
            {/* Meeting Name */}
            <div>
              <label className="font-medium">Meeting Name</label>
              <div className="flex gap-2 mt-1">
                <select {...register('meetingName')} className="w-1/2 p-2 border rounded-lg">
                  <option value="">Select</option>
                  

                  {uniqueMeetingNames.map((name) => (
                    <option key={name} value={name}>{name}</option>
                  ))}
                </select>
                <input
                  value={newMeetingName}
                  onChange={(e) => setNewMeetingName(e.target.value)}
                  className="flex-grow p-2 border rounded"
                  placeholder="Add new"
                />
                <button
                  type="button"
                  onClick={() => {
                    const val = newMeetingName.trim();
                    if (!val) return;
                    if (!uniqueMeetingNames.some(n => n.toLowerCase() === val.toLowerCase())) {
                      addMeetingName(val);
                    }
                    setNewMeetingName('');
                    
                  }}
                  className="px-3 bg-green-600 text-white rounded"
                >Add</button>
              </div>
            </div>

            {/* Company and Plant */}
            <div className="grid grid-cols-2 gap-3">
              <input {...register('company')} className="p-2 border rounded" placeholder="Company" />
              <input {...register('plant')} className="p-2 border rounded" placeholder="Plant" />
            </div>

            {/* <div>
              <label className="font-medium">Date of Meeting</label>
              <input
                type="date"
                {...register('dateOfMeeting')}
                className="w-full p-2 border rounded mt-1"
                placeholder="Date of Meeting"
              />
            </div> */}

            {/* Department */}
            <div>
              <label className="font-medium">Department</label>
              <div className="flex gap-2 mt-1">
                <select {...register('department')} className="w-1/2 p-2 border rounded-lg">
                  <option value="">Select</option>
                  {departments.map((dept, idx) => (
                    <option key={idx} value={dept}>{dept}</option>
                  ))}
                </select>
                <input
                  value={newDepartment}
                  onChange={(e) => setNewDepartment(e.target.value)}
                  className="flex-grow p-2 border rounded"
                  placeholder="Add new"
                />
                <button
                  type="button"
                  onClick={() => {
                    if (newDepartment.trim()) {
                      addDepartment(newDepartment);
                      setNewDepartment('');
                    }
                  }}
                  className="px-3 bg-green-600 text-white rounded"
                >Add</button>
              </div>
            </div>

            {/* Email */}
            <input {...register('email')} className="w-full p-2 border rounded" placeholder="Organizer Email" />
          </div>

          {/* Middle Section - Attendee Selector */}
          <div className="flex-1 p-4 space-y-4 bg-white/60 backdrop-blur-lg rounded-xl shadow-inner overflow-auto">
            <div className="flex justify-between items-center mb-2">
              <h3 className="font-semibold text-blue-700 text-base">Select Attendees</h3>
              <div className="flex items-center gap-2">
                <span className="text-sm text-gray-600">Specific</span>
                <div
                  className="relative w-9 h-5 bg-gray-300 rounded-full cursor-pointer transition-colors duration-300"
                  onClick={() => setAttendeeSource((prev) => (prev === 'specific' ? 'all' : 'specific'))}
                >
                  <div
                    className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform duration-300 ${
                      attendeeSource === 'specific' ? 'translate-x-1' : 'translate-x-4'
                    }`}/>
                </div>
                <span className="text-sm text-gray-600">All</span>
              </div>
            </div>

            {/* Sort + Search + Select All */}
            <div className="flex items-center gap-2 mb-2">
              <button
                type="button"
                title="Sort A-Z"
                onClick={() =>
                  setFilteredOptions([...filteredOptions].sort((a, b) => a.localeCompare(b)))
                }
                className="p-1 rounded border border-gray-300 bg-white hover:bg-blue-100 transition"
              >
                <SortAsc className="w-5 h-5 text-blue-600" />
              </button>

              <div className="relative w-full">
                <Search className="absolute left-2 top-2.5 w-4 h-4 text-gray-500" />
                <input
                  type="text"
                  placeholder="Search attendee..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-7 pr-2 py-1 border border-gray-300 rounded-md text-sm w-full"
                />
              </div>
            </div>

            {/* Select All Checkbox */}
            <div className="mb-1">
              <label className="flex items-center gap-2 text-sm font-medium text-gray-700">
                <input
                  type="checkbox"
                  checked={
                    visibleOptions.length > 0 &&
                    visibleOptions.every(name => attendees.includes(name))
                  }
                  onChange={(e) => {
                    if (e.target.checked) {
                      setAttendees(prev => [...new Set([...prev, ...visibleOptions])]);
                    } else {
                      setAttendees(prev => prev.filter(name => !visibleOptions.includes(name)));
                    }
                  }}
                />
                Select All Visible
              </label>
            </div>

            {/* Attendee Checkboxes */}
            <div className="space-y-2 max-h-[300px] overflow-y-auto pr-1">
              {visibleOptions.map((name, idx) => (
                <label key={idx} className="flex items-center gap-2 text-gray-700 text-sm">
                  <input
                    type="checkbox"
                    checked={attendees.includes(name)}
                    onChange={() => handleAttendeeToggle(name)}
                  />
                  {name}
                </label>
              ))}
            </div>

            {/* Add Attendee */}
            <div className="mt-4 p-3 border border-gray-200 rounded-lg bg-white/80 shadow-sm">
              <input
                value={newAttendee}
                onChange={(e) => setNewAttendee(e.target.value)}
                placeholder="Add new attendee"
                className="w-full p-2 border rounded mb-2"
              />
              <button
                type="button"
                onClick={() => {
                  if (newAttendee.trim()) {
                    addAttendeeOption(newAttendee);
                    setNewAttendee('');
                    setSearchTerm('');
                    let baseList = [];

                    if (attendeeSource === 'all') {
                      baseList = [
                        ...new Set([
                          ...meetings.flatMap((m) => m.attendees || []),
                          newAttendee,
                        ]),
                      ];
                    } else if (attendeeSource === 'specific' && selectedMeetingName) {
                      const old = getAttendeesByMeetingName(selectedMeetingName) || [];
                      baseList = [...new Set([...old, newAttendee])];
                    } else {
                      baseList = [newAttendee];
                    }

                    setFilteredOptions(baseList);
                    setAttendees((prev) => [...new Set([...prev, newAttendee])]);
                  }
                }}
                className="w-full bg-green-600 text-white py-1 rounded"
              >
                Add Attendee
              </button>
            </div>
          </div>

          {/* Right Section - Selected Attendees */}
          <div className="flex-1 p-4 bg-white/60 backdrop-blur-lg rounded-xl shadow-inner overflow-auto">
            <h3 className="font-semibold text-green-700 mb-2">Available in Meeting</h3>
            <ul className="space-y-2 max-h-[400px] overflow-y-auto pr-1">
              {attendees.map((name, index) => (
                <li key={index} className="flex justify-between items-center bg-gray-100 px-3 py-2 rounded shadow-sm">
                  <span>{name}</span>
                  <button
                    type="button"
                    onClick={() => handleRemoveAttendee(index)}
                    className="text-red-600 hover:text-red-800"
                  >🗑</button>
                </li>
              ))}
            </ul>
          </div>
        </form>

        <div className="flex justify-end gap-4 mt-6">
          <button
            type="button"
            onClick={close}
            className="px-5 py-2 bg-gray-300 hover:bg-gray-400 text-gray-800 rounded-lg"
          >
            Cancel
          </button>
          <form onSubmit={handleSubmit(onSubmit)}>
            <button
              type="submit"
              className="px-6 py-2 bg-blue-600 hover:bg-green-600 text-white rounded-lg"
            >
              Create
            </button>
          </form>
        </div>
      </motion.div>
    </motion.div>
  );
}
