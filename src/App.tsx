import React from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './contexts/AuthContext';
import { ProtectedRoute } from './components/ProtectedRoute';
import LoginPage from './pages/LoginPage';
import ReportsPage from './modules/reports/ReportsPage';
import DashboardLayout from './layouts/DashboardLayout';

export default function App() {
  return (
    <AuthProvider>
      <Routes>
        {/* Public Routes */}
        <Route path="/login" element={<LoginPage />} />

        {/* Protected Routes */}
        <Route
          path="/*"
          element={
            <ProtectedRoute>
              <DashboardLayout>
                <Routes>
                  <Route path="/reports/*" element={<ReportsPage />} />
                  <Route path="/" element={<Navigate to="/reports/daily" replace />} />
                </Routes>
              </DashboardLayout>
            </ProtectedRoute>
          }
        />

        {/* Fallback */}
        <Route path="/" element={<Navigate to="/reports/daily" replace />} />
      </Routes>
    </AuthProvider>
  );
}
