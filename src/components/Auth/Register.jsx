import React, { useState, useRef, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { motion } from 'framer-motion';
import * as XLSX from 'xlsx';
import registerVideo from '../../assets/register-bg.mp4';
import { UploadCloud, Image as ImageIcon, X, FileSpreadsheet, Loader2 } from 'lucide-react';

export default function Register() {
  const { register, handleSubmit } = useForm();
  const navigate = useNavigate();

  const [photoData, setPhotoData] = useState(null);
  const [alertMsg, setAlertMsg] = useState('');
  const [photoError, setPhotoError] = useState('');

  // Bulk upload state
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkMsg, setBulkMsg] = useState('');
  const [bulkErrors, setBulkErrors] = useState([]);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef(null);

  // Slide panel state/refs
  const [open, setOpen] = useState(false);
  const panelRef = useRef(null);
  const edgeRef = useRef(null);
  const hideTimer = useRef(null);

  const API_BASE = 'http://10.36.81.141:5000';

  // ---------- Auto-collapse watcher ----------
  useEffect(() => {
    if (!open) return;
    const onMove = (e) => {
      const p = panelRef.current?.getBoundingClientRect();
      const r = edgeRef.current?.getBoundingClientRect();
      const insidePanel =
        p && e.clientX >= p.left && e.clientX <= p.right && e.clientY >= p.top && e.clientY <= p.bottom;
      const insideEdge =
        r && e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;

      if (!insidePanel && !insideEdge) {
        clearTimeout(hideTimer.current);
        hideTimer.current = setTimeout(() => setOpen(false), 250);
      } else {
        clearTimeout(hideTimer.current);
      }
    };
    window.addEventListener('mousemove', onMove);
    return () => {
      clearTimeout(hideTimer.current);
      window.removeEventListener('mousemove', onMove);
    };
  }, [open]);

  // ---------- Photo upload ----------
  const handlePhotoUpload = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setPhotoError('');

    const okType = /image\/(png|jpe?g)$/i.test(file.type);
    const okSize = file.size <= 2 * 1024 * 1024;
    if (!okType) return setPhotoError('Please upload a PNG or JPG image.');
    if (!okSize) return setPhotoError('Image is too large. Max size is 2MB.');

    const reader = new FileReader();
    reader.onloadend = () => {
      const img = new Image();
      img.onload = () => {
        if (img.width < 256 || img.height < 256) {
          setPhotoError('Image is too small. Minimum 256×256 pixels.');
          return;
        }
        setPhotoData(reader.result);
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  };
  const handleRemovePhoto = () => { setPhotoData(null); setPhotoError(''); };

  // ---------- Single Register submit ----------
  const onSubmit = async (data) => {
    setAlertMsg('');
    const newUser = {
      name: data.name,
      department: data.department,
      manager_name: data.manager,
      email: data.email,
      password: data.password,
      photo: photoData || '/avatar.png',
    };
    try {
      const res = await fetch(`${API_BASE}/api/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newUser),
      });
      if (res.status === 201) {
        alert('Registration successful!');
        navigate('/login');
      } else if (res.status === 409) {
        setAlertMsg('User already exists with this email.');
      } else {
        setAlertMsg('Registration failed. Please try again.');
      }
    } catch {
      setAlertMsg('Cannot connect to server. Is backend running?');
    }
  };

  // ---------- Bulk Upload Helpers ----------
  const isExcel = (t) => /\.xlsx?$/i.test(t) || /sheet|excel/i.test(t);
  const isCsv = (t) => /\.csv$/i.test(t) || /csv/i.test(t);

  const excelToCsvBlob = async (file) => {
    const data = await file.arrayBuffer();
    const wb = XLSX.read(data, { type: 'array' });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const csv = XLSX.utils.sheet_to_csv(ws, { FS: ',', RS: '\n' });
    return new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  };

  const postCsvToBackend = async (csvBlob, originalName = 'employees.csv') => {
    const formData = new FormData();
    const filename = originalName.toLowerCase().endsWith('.csv')
      ? originalName
      : originalName.replace(/\.(xlsx?|xls)$/i, '.csv');
    formData.append('file', csvBlob, filename);
    const res = await fetch(`${API_BASE}/api/users/import`, { method: 'POST', body: formData });
    return res.json();
  };

  const handleBulkFile = async (file) => {
    setBulkMsg(''); setBulkErrors([]); setBulkBusy(true);
    try {
      let csvBlob;
      if (isExcel(file.name) || isExcel(file.type)) csvBlob = await excelToCsvBlob(file);
      else if (isCsv(file.name) || isCsv(file.type)) csvBlob = file;
      else throw new Error('Please upload a CSV or Excel file (.csv, .xlsx, .xls).');

      const result = await postCsvToBackend(csvBlob, file.name);
      const parts = [];
      if (result.inserted != null) parts.push(`Affected: ${result.inserted}`);
      if (result.updated != null) parts.push(`Updated: ${result.updated}`);
      if (result.skipped != null) parts.push(`Skipped: ${result.skipped}`);
      setBulkMsg(parts.length ? parts.join(' • ') : 'Upload complete.');
      if (Array.isArray(result.errors) && result.errors.length) setBulkErrors(result.errors.slice(0, 20));
    } catch (e) {
      setBulkMsg(''); setBulkErrors([e.message || 'Upload failed']);
    } finally {
      setBulkBusy(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const onBulkInputChange = (e) => { const f = e.target.files?.[0]; if (f) handleBulkFile(f); };
  const onDrop = (e) => { e.preventDefault(); setDragOver(false); const f = e.dataTransfer.files?.[0]; if (f) handleBulkFile(f); };
  const onDragOver = (e) => { e.preventDefault(); setDragOver(true); };
  const onDragLeave = () => setDragOver(false);

  return (
    <div className="relative min-h-screen w-full">
      {/* Background video */}
      <div className="absolute inset-0">
        <video src={registerVideo} autoPlay muted loop playsInline className="absolute inset-0 w-full h-full object-cover" />
        <div className="absolute inset-0 bg-gradient-to-br from-black/70 via-black/40 to-transparent" />
        <div className="relative z-0 flex items-center justify-center w-full h-full px-10 text-center pointer-events-none">
          <motion.h2
            className="text-white text-3xl md:text-5xl font-extrabold leading-snug drop-shadow-xl"
            initial={{ y: 40, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ duration: 1 }}
          >
            Empower <br /> Your Collaboration
          </motion.h2>
        </div>
      </div>

      {/* Hot edge to reveal (desktop) */}
      <div
        ref={edgeRef}
        className="fixed right-0 top-0 h-screen w-2 md:w-3 z-40"
        onMouseEnter={() => setOpen(true)}
        aria-hidden
      />

      {/* Mobile toggle FAB */}
      <button
        className="md:hidden fixed right-4 bottom-4 z-50 rounded-full shadow-lg bg-white/90 border border-gray-200 px-3 py-1.5 text-xs"
        onClick={() => setOpen((v) => !v)}
      >
        {open ? 'Hide' : 'Register'}
      </button>

      {/* Sliding panel (overlay) */}
      <motion.aside
        ref={panelRef}
        className="fixed right-0 top-0 z-50 h-screen w-[92vw] md:w-[520px] md:min-w-[400px] bg-gradient-to-br from-blue-200/80 to-green-200/90 border-l border-white/40 shadow-2xl"
        initial={false}
        animate={{ x: open ? 0 : '100%' }}
        transition={{ type: 'tween', duration: 0.35, ease: [0.4, 0, 0.2, 1] }}
      >
        <div className="h-full max-h-screen overflow-y-auto px-4 md:px-6 py-6 md:py-8">
          <motion.div
            className="mx-auto w-full max-w-[520px] bg-white/30 backdrop-blur-3xl rounded-2xl shadow-2xl p-5 md:p-6 space-y-5 border border-white/20 text-sm"
            initial={{ opacity: 0.7 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.25 }}
          >
            <h1 className="text-2xl md:text-3xl font-bold text-center text-gray-800">
              Create Account
            </h1>

            {alertMsg && (
              <motion.p className="text-center text-red-600 font-medium text-sm" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
                {alertMsg}
              </motion.p>
            )}

            {/* ---------- Single User Registration ---------- */}
            <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
              <input
                type="text"
                placeholder="Name"
                {...register('name', { required: true })}
                className="w-full p-3 text-sm border border-gray-300 rounded-xl bg-white hover:border-blue-500 transition-all"
              />
              <input
                type="text"
                placeholder="Department"
                {...register('department', { required: true })}
                className="w-full p-3 text-sm border border-gray-300 rounded-xl bg-white hover:border-blue-500 transition-all"
              />
              <input
                type="text"
                placeholder="Manager Name"
                {...register('manager', { required: true })}
                className="w-full p-3 text-sm border border-gray-300 rounded-xl bg-white hover:border-blue-500 transition-all"
              />

              {/* Photo uploader */}
              <fieldset className="space-y-2">
                <legend className="block text-xs font-semibold text-gray-800">
                  Profile photo <span className="text-gray-500 font-normal">(optional)</span>
                </legend>

                <div className={`rounded-2xl border ${photoError ? 'border-red-300' : 'border-gray-200'} bg-white/70 backdrop-blur-sm`}>
                  {photoData ? (
                    <div className="p-3 flex items-center justify-between gap-3">
                      <div className="flex items-center gap-3">
                        <img src={photoData} alt="Profile preview" className="w-12 h-12 rounded-full object-cover border border-gray-200 shadow-sm" />
                        <div className="text-xs">
                          <p className="font-medium text-gray-800">Photo selected</p>
                          <p className="text-gray-500">Looks good! You can change it anytime.</p>
                        </div>
                      </div>

                      <div className="flex items-center gap-2">
                        <label htmlFor="photoInput" className="px-2.5 py-1.5 text-xs rounded-lg border border-gray-300 hover:border-gray-400 bg-white cursor-pointer">
                          Change
                        </label>
                        <button
                          type="button"
                          onClick={handleRemovePhoto}
                          className="p-1.5 rounded-lg border border-gray-300 hover:border-gray-400 bg-white"
                          aria-label="Remove photo"
                          title="Remove photo"
                        >
                          <X size={14} />
                        </button>
                        <input id="photoInput" type="file" accept="image/*" onChange={handlePhotoUpload} className="hidden" />
                      </div>
                    </div>
                  ) : (
                    <label htmlFor="photoInput" className="block p-5 text-center cursor-pointer">
                      <div className="mx-auto w-12 h-12 rounded-2xl border border-dashed border-gray-300 flex items-center justify-center mb-2.5">
                        <ImageIcon className="text-gray-500" size={18} />
                      </div>
                      <p className="text-sm font-medium text-gray-800">Upload profile photo</p>
                      <p className="text-[11px] text-gray-500 mt-1">PNG or JPG, up to 2MB (min 256×256). Click to browse.</p>
                      <div className="mt-2 inline-flex items-center gap-2 px-2.5 py-1.5 rounded-lg border border-gray-300 bg-white text-xs">
                        <UploadCloud size={14} />
                        <span>Choose file</span>
                      </div>
                      <input id="photoInput" type="file" accept="image/*" onChange={handlePhotoUpload} className="hidden" />
                    </label>
                  )}
                </div>

                {photoError && <p className="text-[11px] text-red-600 font-medium">{photoError}</p>}
                {!photoData && !photoError && (
                  <p className="text-[11px] text-gray-500">You can skip this now — we’ll use a default avatar and you can update it later.</p>
                )}
              </fieldset>

              <input
                type="email"
                placeholder="Email"
                {...register('email', { required: true })}
                className="w-full p-3 text-sm border border-gray-300 rounded-xl bg-white hover:border-blue-500 transition-all"
              />
              <input
                type="password"
                placeholder="Password"
                {...register('password', { required: true })}
                className="w-full p-3 text-sm border border-gray-300 rounded-xl bg-white hover:border-blue-500 transition-all"
              />

              <motion.button
                type="submit"
                whileHover={{ scale: 1.04 }}
                whileTap={{ scale: 0.98 }}
                className="w-full bg-gradient-to-r from-blue-600 to-green-500 hover:from-green-500 hover:to-blue-600 text-white font-semibold py-2.5 text-sm rounded-xl shadow-lg transition-all"
              >
                Register
              </motion.button>

              <p className="text-center text-gray-700 text-xs">
                Already have an account? <Link to="/login" className="text-blue-700 font-semibold hover:underline">Login here</Link>
              </p>
            </form>

            {/* ---------- Bulk Upload Employees ---------- */}
            <div className="pt-3 border-t border-white/40">
              <h2 className="text-lg font-semibold text-gray-800 flex items-center gap-2">
                <FileSpreadsheet size={18} />
                Bulk upload employees
              </h2>
              <p className="text-xs text-gray-600 mt-1">
                Upload <strong>.xlsx / .xls / .csv</strong>. We’ll auto-map headers like
                <em> Name, Email, Department, Manager, Photo, Password</em>.
              </p>

              <div
                onDrop={onDrop}
                onDragOver={onDragOver}
                onDragLeave={onDragLeave}
                className={`mt-2.5 rounded-2xl border-2 border-dashed ${
                  dragOver ? 'border-blue-400 bg-blue-50/50' : 'border-gray-300 bg-white/70'
                } p-4 text-center transition-all`}
              >
                <div className="mx-auto w-12 h-12 rounded-2xl border border-dashed border-gray-300 flex items-center justify-center mb-2.5">
                  {bulkBusy ? <Loader2 className="animate-spin" /> : <UploadCloud size={18} />}
                </div>
                <p className="text-sm font-medium text-gray-800">Drag & drop your employee file here</p>
                <p className="text-[11px] text-gray-500 mt-1">or</p>
                <div className="mt-2">
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={bulkBusy}
                    className="inline-flex items-center gap-2 px-2.5 py-1.5 rounded-lg border border-gray-300 bg-white text-xs hover:border-gray-400 disabled:opacity-60"
                  >
                    <UploadCloud size={14} />
                    Choose file
                  </button>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".csv, application/vnd.ms-excel, application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                    className="hidden"
                    onChange={onBulkInputChange}
                  />
                </div>

                {bulkBusy && <p className="mt-2 text-xs text-blue-700 font-medium">Uploading & processing…</p>}
                {!bulkBusy && bulkMsg && <p className="mt-2 text-xs text-green-700 font-medium">{bulkMsg}</p>}
                {!bulkBusy && !!bulkErrors.length && (
                  <div className="mt-2 text-left max-h-28 overflow-auto bg-red-50 border border-red-200 rounded-lg p-2.5">
                    <p className="text-xs text-red-700 font-semibold mb-1">Some rows had issues:</p>
                    <ul className="list-disc pl-5 text-[11px] text-red-700 space-y-1">
                      {bulkErrors.map((e, i) => (<li key={i}>{e}</li>))}
                    </ul>
                  </div>
                )}
              </div>

              <div className="mt-2 text-[11px] text-gray-600">
                Tip: Required columns are <strong>Name</strong> and <strong>Email</strong>.
                Others are optional. Password defaults to <code>changeme123</code> if missing.
              </div>
            </div>
          </motion.div>
        </div>
      </motion.aside>
    </div>
  );
}
