import React, { useEffect, useMemo, useState } from 'react';
import { X, Search, CalendarClock, UserPlus, Mail } from 'lucide-react';

export default function ActionModal({
  type,                 // 'reassign' | 'needTime' | 'rejected' | 'completed'
  onSubmit,
  onClose,
  people = [],          // [{name,email}] full system directory
  currentAssignee = '', // current row’s assignee name
}) {
  const [remark, setRemark] = useState('');
  const [newDeadline, setNewDeadline] = useState('');
  const [query, setQuery] = useState('');

  // multi-select for both REASSIGN and NEED TIME
  const [selected, setSelected] = useState([]); // [{name,email}]

  // add-new inline
  const [customName, setCustomName] = useState('');
  const [customEmail, setCustomEmail] = useState('');

  useEffect(() => {
    setRemark('');
    setNewDeadline('');
    setQuery('');
    setSelected([]);
    setCustomName('');
    setCustomEmail('');
  }, [type]);

  const isNeedTime = type === 'needTime';
  const isReassign = type === 'reassign';
  const showMultiAssign = isNeedTime || isReassign;

  const uniqKey = (p) => (p.email || p.name || '').toLowerCase().trim();
  const emailOk = (s) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(s || '').trim());

  const candidateList = useMemo(() => {
    const base = (people || [])
      .filter((p) => p && (p.name || p.email))
      .filter((p) => (p.name || '').trim() !== (currentAssignee || '').trim());

    const q = query.toLowerCase();
    if (!q) return base;

    return base.filter((p) =>
      (p.name || '').toLowerCase().includes(q) ||
      (p.email || '').toLowerCase().includes(q)
    );
  }, [people, currentAssignee, query]);

  const toggle = (person) => {
    const k = uniqKey(person);
    setSelected((prev) =>
      prev.some((x) => uniqKey(x) === k)
        ? prev.filter((x) => uniqKey(x) !== k)
        : [...prev, person]
    );
  };

  const removeChip = (k) => {
    setSelected((prev) => prev.filter((x) => uniqKey(x) !== k));
  };

  const addCustomPerson = () => {
    const name = customName.trim();
    const email = customEmail.trim();
    if (!name || !email) return alert('Please enter both name and email.');
    if (!emailOk(email)) return alert('Please enter a valid email address.');
    toggle({ name, email });
    setCustomName('');
    setCustomEmail('');
  };

  const today = new Date().toISOString().slice(0, 10);
  const submitDisabled =
    (isNeedTime && !newDeadline) ||
    (isReassign && selected.length === 0);

  const handleSubmit = () => {
    let payload = {};

    if (isReassign) {
      if (selected.length === 0) {
        alert('Please select at least one person to reassign to.');
        return;
      }
      payload = {
        remark: remark.trim(),
        assignList: selected, // [{name,email}]
      };
    } else if (isNeedTime) {
      if (!newDeadline) {
        alert('Please pick a new deadline.');
        return;
      }
      payload = {
        deadline: newDeadline,
        remark: remark.trim(),
        assignList: selected, // optional
      };
    } else if (type === 'rejected' || type === 'completed') {
      payload = { remark: remark.trim() };
    }

    onSubmit(payload);
    onClose();
  };

  const onKeyDown = (e) => {
    if (e.key === 'Escape') onClose();
    if (e.key === 'Enter' && !submitDisabled) handleSubmit();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onKeyDown={onKeyDown}>
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />

      {/* Dialog */}
      <div className="relative w-full max-w-[640px] bg-white dark:bg-gray-900 rounded-2xl shadow-2xl ring-1 ring-black/5 animate-in fade-in zoom-in duration-150">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 dark:border-gray-800">
          <h2 className="text-lg font-semibold capitalize text-gray-900 dark:text-gray-100">
            {type} {isReassign ? 'Task' : 'Details'}
          </h2>
          <button
            onClick={onClose}
            className="p-2 rounded-lg text-gray-500 hover:text-gray-800 hover:bg-gray-100 dark:hover:bg-gray-800"
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="px-5 py-4 space-y-4">
          {isNeedTime && (
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-gray-700 dark:text-gray-300 flex items-center gap-2">
                <CalendarClock size={16} />
                New deadline
              </label>
              <input
                type="date"
                min={today}
                className="w-full rounded-xl border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                value={newDeadline}
                onChange={(e) => setNewDeadline(e.target.value)}
                autoFocus
              />
            </div>
          )}

          <div className="space-y-1.5">
            <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
              {type === 'rejected'
                ? 'Reason for rejection'
                : isNeedTime
                ? 'Reason for delay (optional)'
                : 'Remark (optional)'}
            </label>
            <textarea
              rows={3}
              className="w-full rounded-xl border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder={
                isReassign
                  ? 'Any context for the new assignee(s)…'
                  : type === 'rejected'
                  ? 'Why is this being rejected?'
                  : 'Add any helpful context…'
              }
              value={remark}
              onChange={(e) => setRemark(e.target.value)}
            />
          </div>

          {showMultiAssign && (
            <div className="rounded-2xl border border-gray-200 dark:border-gray-800">
              {/* Card header */}
              <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 dark:border-gray-800">
                <div className="text-sm font-semibold text-gray-800 dark:text-gray-100 flex items-center gap-2">
                  <UserPlus size={16} />
                  {isReassign ? 'Reassign to' : 'Also assign to'} (optional)
                </div>
                <div className="relative">
                  <Search className="absolute left-2 top-2.5" size={16} />
                  <input
                    className="pl-7 pr-3 py-1.5 text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="Search people…"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                  />
                </div>
              </div>

              {/* Card body */}
              <div className="p-4 space-y-4">
                {/* Selected chips */}
                {selected.length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {selected.map((p) => {
                      const k = uniqKey(p);
                      return (
                        <span
                          key={`chip-${k}`}
                          className="inline-flex items-center gap-2 text-xs bg-blue-50 text-blue-700 border border-blue-100 rounded-full px-3 py-1"
                        >
                          <span className="font-medium">{p.name || '(no name)'}</span>
                          {p.email && <span className="text-blue-600/70 break-all">{p.email}</span>}
                          <button
                            onClick={() => removeChip(k)}
                            className="ml-1 text-blue-600/80 hover:text-blue-800"
                            title="Remove"
                          >
                            <X size={14} />
                          </button>
                        </span>
                      );
                    })}
                  </div>
                )}

                {/* Directory list */}
                {candidateList.length === 0 ? (
                  <div className="text-xs text-gray-500">No users found.</div>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-56 overflow-y-auto pr-1">
                    {candidateList.map((p) => {
                      const k = uniqKey(p);
                      const checked = selected.some((s) => uniqKey(s) === k);
                      return (
                        <label
                          key={k}
                          className="flex items-start gap-2 rounded-xl border border-gray-200 dark:border-gray-800 p-2 hover:bg-gray-50 dark:hover:bg-gray-800 cursor-pointer"
                        >
                          <input
                            type="checkbox"
                            className="mt-1"
                            checked={checked}
                            onChange={() => toggle({ name: p.name || '', email: p.email || '' })}
                          />
                          <div className="min-w-0">
                            <div className="text-sm font-medium text-gray-800 dark:text-gray-100">
                              {p.name || '(no name)'}
                            </div>
                            {p.email && (
                              <div className="text-xs text-gray-500 flex items-center gap-1 break-all">
                                <Mail size={12} /> {p.email}
                              </div>
                            )}
                          </div>
                        </label>
                      );
                    })}
                  </div>
                )}

                {/* Add new inline */}
                <div className="border-t border-gray-100 dark:border-gray-800 pt-3">
                  <div className="text-sm font-medium mb-2">Add someone new</div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <div className="relative">
                      <input
                        className="w-full rounded-xl border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                        placeholder="Name"
                        value={customName}
                        onChange={(e) => setCustomName(e.target.value)}
                      />
                    </div>
                    <div className="relative">
                      <input
                        className="w-full rounded-xl border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 break-all"
                        placeholder="Email"
                        value={customEmail}
                        onChange={(e) => setCustomEmail(e.target.value)}
                      />
                    </div>
                  </div>
                  <div className="mt-2">
                    <button
                      type="button"
                      onClick={addCustomPerson}
                      className="text-xs px-3 py-1.5 bg-gray-100 hover:bg-gray-200 dark:bg-gray-800 dark:hover:bg-gray-700 rounded-lg"
                    >
                      + Add to selection
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-4 border-t border-gray-100 dark:border-gray-800 flex items-center justify-end gap-2">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-xl text-sm text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={submitDisabled}
            className={`px-4 py-2 rounded-xl text-sm text-white transition
              ${submitDisabled ? 'bg-blue-400 cursor-not-allowed' : 'bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700'}`}
          >
            Submit
          </button>
        </div>
      </div>
    </div>
  );
}
