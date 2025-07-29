import React from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';

const Layout: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user, logout } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  const isActive = (path: string) => {
    return location.pathname === path;
  };

  return (
    <div className="min-h-screen bg-gray-100">
      {/* Header */}
      <header className="bg-white shadow-sm border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <div className="flex items-center">
              <h1 className="text-xl font-semibold text-gray-900">
                Leaf Dashboard
              </h1>
            </div>
            
            <div className="flex items-center space-x-4">
              <div className="text-sm text-gray-700">
                <span className="font-medium">{user?.name}</span>
                <span className="mx-2">•</span>
                <span className="text-gray-500">{user?.role}</span>
              </div>
              
              <button
                onClick={handleLogout}
                className="text-sm text-gray-700 hover:text-gray-900 px-3 py-2 rounded-md"
              >
                Sair
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* Navigation */}
      <nav className="bg-white shadow-sm border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex space-x-8">
            <Link
              to="/"
              className={`py-4 px-1 border-b-2 font-medium text-sm ${
                isActive('/')
                  ? 'border-blue-500 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              Visão Geral
            </Link>
            
            <Link
              to="/vps/vultr"
              className={`py-4 px-1 border-b-2 font-medium text-sm ${
                isActive('/vps/vultr')
                  ? 'border-blue-500 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              VPS
            </Link>
            
            <Link
              to="/redis"
              className={`py-4 px-1 border-b-2 font-medium text-sm ${
                isActive('/redis')
                  ? 'border-blue-500 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              Redis
            </Link>
            
            <Link
              to="/websocket"
              className={`py-4 px-1 border-b-2 font-medium text-sm ${
                isActive('/websocket')
                  ? 'border-blue-500 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              WebSocket
            </Link>
            
            {user?.role === 'admin' && (
              <Link
                to="/firebase"
                className={`py-4 px-1 border-b-2 font-medium text-sm ${
                  isActive('/firebase')
                    ? 'border-blue-500 text-blue-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                }`}
              >
                Firebase
              </Link>
            )}
          </div>
        </div>
      </nav>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto py-6 sm:px-6 lg:px-8">
        {children}
      </main>
    </div>
  );
};

export default Layout; 