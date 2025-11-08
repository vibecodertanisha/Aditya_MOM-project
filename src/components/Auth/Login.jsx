import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { useForm } from 'react-hook-form';
import { motion } from 'framer-motion';
import loginVideo from '../../assets/login-bg.mp4'; // 10-sec attractive background video

export default function Login() {
  const { register, handleSubmit } = useForm();
  const { login } = useAuth();
  const navigate = useNavigate();

  const [error, setError] = useState('');
  const [revealed, setReveal] = useState(false);
  const [loading, setLoading] = useState(false); // Added loading state

  const handlePoint = (x) => {
    const vw = window.innerWidth;
    const threshold = vw * 0.6666;
    setReveal(x > threshold);
  };

  const imgWidth = revealed ? '66.66%' : '100%';
  const formWidth = revealed ? '33.33%' : '0%';
  const formOpac = revealed ? 1 : 0;

  const onSubmit = async ({ email, password }) => {
    setError('');
    setLoading(true); // Start loading

    try {
      const res = await fetch('http://10.36.81.141:5000/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });

      const user = await res.json();

      if (res.ok) {
        const userObject = {
          name: user.name,
          email: user.email,
          department: user.department,
          manager_name: user.manager_name,
          photo: user.photo || '/avatar.png', // fallback
        };

        login(userObject);         // ✅ save in AuthContext
        navigate('/');             // ✅ redirect to dashboard
      } else {
        setError(user.message || 'Invalid credentials');
      }
    } catch (err) {
      console.error(err);
      setError('Cannot reach server. Is backend running?');
    } finally {
      setLoading(false); // Stop loading
    }
  };

  return (
    <div
      className="relative flex min-h-screen w-full overflow-hidden font-sans"
      onMouseMove={(e) => handlePoint(e.clientX)}
      onTouchMove={(e) => {
        const t = e.touches[0];
        if (t) handlePoint(t.clientX);
      }}
      onMouseLeave={() => setReveal(false)}
    >
      {/* Left / video panel */}
      <motion.div
        className="hidden md:flex relative overflow-hidden flex-shrink-0"
        animate={{ flexBasis: imgWidth }}
        initial={{ flexBasis: '100%' }}
        transition={{ duration: 0.5, ease: [0.4, 0, 0.2, 1] }}
      >
        <video
          src={loginVideo}
          autoPlay
          muted
          loop
          playsInline
          className="absolute inset-0 w-full h-full object-cover scale-110 transition-all duration-1000 ease-in-out"
        />
        <motion.div className="absolute inset-0 bg-gradient-to-br from-black/70 via-black/40 to-transparent z-10 animate-pulse" />
        <div className="relative z-20 flex items-center justify-center w-full h-full px-10 text-center">
          <motion.h2
            className="text-white text-4xl lg:text-6xl font-extrabold leading-snug drop-shadow-xl"
            initial={{ y: 40, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ duration: 1 }}
          >
            Organize. Track. <br /> Optimize.
          </motion.h2>
        </div>
      </motion.div>

      {/* Right / login form */}
      <motion.div
        className="flex items-center justify-center flex-shrink-0 overflow-hidden bg-gradient-to-br from-blue-200/80 to-green-200/90 px-6 py-12 md:py-0"
        animate={{ flexBasis: formWidth, opacity: formOpac }}
        initial={{ flexBasis: '0%', opacity: 0 }}
        transition={{ duration: 0.5, ease: [0.4, 0, 0.2, 1] }}
      >
        <motion.div
          className="w-full max-w-lg bg-white/30 backdrop-blur-3xl rounded-3xl shadow-2xl p-10 space-y-6 border border-white/20"
          initial={{ scale: 0.95, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ duration: 0.8, delay: 0.2 }}
        >
          <h1 className="text-4xl font-bold text-center text-gray-800">
            Welcome Back
          </h1>
          <p className="text-center text-gray-700 text-sm font-medium">
            Sign in to your Meeting Management System
          </p>

          {error && (
            <motion.p
              className="text-red-600 text-center font-medium"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
            >
              {error}
            </motion.p>
          )}

          <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
            <input
              type="email"
              placeholder="Email"
              {...register('email', { required: true })}
              className="w-full p-4 border border-gray-300 rounded-xl bg-white hover:border-blue-500 transition-all duration-200"
            />
            <input
              type="password"
              placeholder="Password"
              {...register('password', { required: true })}
              className="w-full p-4 border border-gray-300 rounded-xl bg-white hover:border-green-500 transition-all duration-200"
            />

            <motion.button
              type="submit"
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.98 }}
              className="w-full bg-gradient-to-r from-blue-600 to-green-500 hover:from-green-500 hover:to-blue-600 text-white font-semibold py-3 rounded-xl shadow-lg transition-all duration-300"
              disabled={loading} // Disable button while loading
            >
              {loading ? 'Logging In...' : 'Login'}
            </motion.button>

            <p className="text-center text-gray-700 text-sm">
              Don’t have an account?{' '}
              <Link
                to="/register"
                className="text-blue-700 font-semibold hover:underline"
              >
                Register here
              </Link>
            </p>
          </form>
        </motion.div>
      </motion.div>
    </div>
  );
}
