import React from 'react';
import {
  Routes,
  Route,
  Navigate,
  useLocation,
} from 'react-router-dom';
import { AnimatePresence } from 'framer-motion';

/* context providers */
import { AuthProvider, useAuth } from './context/AuthContext';
import { MeetingProvider } from './context/MeetingContext';

/* pages / views */
import Login from './components/Auth/Login';
import Register from './components/Auth/Register';
import MainPage from './components/Dashboard/MainPage';
import MeetingDetails from './components/Meeting/MeetingDetails';

/* ──────────────────────────────────────────
   PrivateRoute – gate pages that need auth
   ────────────────────────────────────────── */
const PrivateRoute = ({ children }) => {
  const { isAuthenticated } = useAuth();
  return isAuthenticated ? children : <Navigate to="/login" replace />;
};

/* ──────────────────────────────────────────
   AnimatedRoutes – enables page-slide transitions
   Wraps <Routes> in <AnimatePresence>
   ────────────────────────────────────────── */
const AnimatedRoutes = () => {
  const location = useLocation();

  return (
    <AnimatePresence mode="wait">
      <Routes location={location} key={location.pathname}>
        {/* public routes */}
        <Route path="/login" element={<Login />} />
        <Route path="/register" element={<Register />} />

        {/* protected dashboard */}
        <Route
          path="/"
          element={
            <PrivateRoute>
              <MainPage />
            </PrivateRoute>
          }
        />

        {/* meeting details */}
        <Route
          path="/meeting/:id"
          element={
            <PrivateRoute>
              <MeetingDetails />
            </PrivateRoute>
          }
        />

        {/* fallback */}
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    </AnimatePresence>
  );
};

/* ──────────────────────────────────────────
   App – root component with all providers
   ────────────────────────────────────────── */
export default function App() {
  return (
    <AuthProvider>
      <MeetingProvider>
        <AnimatedRoutes />
      </MeetingProvider>
    </AuthProvider>
  );
}
