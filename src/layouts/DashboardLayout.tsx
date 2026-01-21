import React, { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { LogOut, Menu, X } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

interface DashboardLayoutProps {
  children: React.ReactNode;
}

export default function DashboardLayout({ children }: DashboardLayoutProps) {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const [showUserMenu, setShowUserMenu] = useState(false);

  const handleSignOut = async () => {
    try {
      await signOut();
      navigate('/login');
    } catch (error) {
      console.error('Sign out failed:', error);
    }
  };

  return (
    <div className="min-h-screen bg-gray-100 flex flex-col">
      {/* Top Navigation */}
      <nav className="bg-white shadow-sm border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            {/* Logo */}
            <div className="flex items-center gap-3">
              <div className="text-2xl font-bold text-utak-darkseagreen">UTAK</div>
              <span className="hidden sm:inline text-gray-600">Reports Dashboard</span>
            </div>

            {/* User Menu */}
            <div className="relative">
              <button
                onClick={() => setShowUserMenu(!showUserMenu)}
                className="flex items-center gap-2 px-4 py-2 rounded-lg bg-gray-100 hover:bg-gray-200 transition-colors">
                <div className="text-right hidden sm:block">
                  <p className="text-sm font-medium text-gray-900">{user?.email}</p>
                </div>
                <div className="w-8 h-8 bg-utak-darkseagreen rounded-full flex items-center justify-center text-white text-sm font-semibold">
                  {user?.email?.charAt(0).toUpperCase()}
                </div>
              </button>

              {/* Dropdown Menu */}
              {showUserMenu && (
                <div className="absolute right-0 mt-2 w-48 bg-white rounded-lg shadow-lg border border-gray-200 z-50">
                  <div className="p-3 border-b border-gray-100">
                    <p className="text-sm font-medium text-gray-900">{user?.email}</p>
                    <p className="text-xs text-gray-500">User ID: {user?.uid.substring(0, 8)}</p>
                  </div>
                  <button
                    onClick={() => {
                      setShowUserMenu(false);
                      handleSignOut();
                    }}
                    className="w-full flex items-center gap-2 px-4 py-3 text-red-600 hover:bg-red-50 transition-colors">
                    <LogOut size={18} />
                    <span className="text-sm font-medium">Sign Out</span>
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      </nav>

      {/* Main Content */}
      <main className="flex-1 overflow-auto">
        <div className="max-w-7xl mx-auto">
          {children}
        </div>
      </main>
    </div>
  );
}
