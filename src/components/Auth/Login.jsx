import React, { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { useForm } from 'react-hook-form';
import { motion } from 'framer-motion';
import loginVideo from '../../assets/login-bg.mp4';

export default function Login() {
  const { register, handleSubmit } = useForm();
  const { login } = useAuth();
  const navigate = useNavigate();

  const [error, setError] = useState('');
  const [showLogin, setShowLogin] = useState(false);
  const [loading, setLoading] = useState(false);

  // ⏳ Show login after 3 seconds
  useEffect(() => {
    const timer = setTimeout(() => setShowLogin(true), 3000);
    return () => clearTimeout(timer);
  }, []);

  const onSubmit = async ({ email, password }) => {
    setError('');
    setLoading(true);
    try {
      const res = await fetch('http://192.168.0.106:5000/api/login', {
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
          photo: user.photo || '/avatar.png',
        };

        login(userObject);
        navigate('/');
      } else {
        setError(user.message || 'Invalid credentials');
      }
    } catch (err) {
      console.error(err);
      setError('Cannot reach server. Is backend running?');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="relative min-h-screen w-full overflow-hidden font-sans bg-black flex items-center justify-center">
      {/* Background Video */}
      <motion.video
        src={loginVideo}
        autoPlay
        muted
        loop
        playsInline
        className="absolute inset-0 w-full h-full object-cover scale-110 opacity-90"
        initial={{ scale: 1.1 }}
        animate={{ scale: 1 }}
        transition={{ duration: 3 }}
      />

      {/* Overlay */}
      <div className="absolute inset-0 bg-gradient-to-br from-black/80 via-black/40 to-transparent z-10" />

      {/* Title Section (above panel) */}
      <div className="absolute top-20 z-20 w-full flex flex-col items-center text-center text-white px-6">
        <motion.h2
          className="text-5xl lg:text-7xl font-extrabold leading-tight drop-shadow-xl"
          initial={{ y: 60, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ duration: 1 }}
        >
          Organize. Track. Optimize.
        </motion.h2>
        <motion.p
          className="mt-4 text-lg text-gray-200 max-w-xl"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.5 }}
        >
          Streamline your meetings with ease and efficiency.
        </motion.p>
      </div>

      {/* Centered Login Panel */}
      <motion.div
        className="relative z-30 w-full max-w-md bg-white/30 backdrop-blur-3xl rounded-3xl shadow-2xl p-10 border border-white/20 mt-10 md:mt-0"
        initial={{ opacity: 0, y: 100 }}
        animate={showLogin ? { opacity: 1, y: 40 } : { opacity: 0, y: 100 }}
        transition={{ duration: 1, ease: [0.4, 0, 0.2, 1] }}
      >
        <h1 className="text-4xl font-bold text-center text-gray-900 mb-2">
          Welcome Back
        </h1>

        <p className="text-center text-gray-700 text-sm mb-6">
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
            disabled={loading}
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
    </div>
  );
}
