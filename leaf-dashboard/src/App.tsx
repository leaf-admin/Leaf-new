import React from 'react';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import LoginPage from './components/LoginPage';
import Dashboard from './components/Dashboard';
import './index.css';

const AppContent: React.FC = () => {
  const { isAuthenticated } = useAuth();

  return isAuthenticated ? <Dashboard /> : <LoginPage />;
};

const App: React.FC = () => {
  return (
    <AuthProvider>
      <AppContent />
    </AuthProvider>
  );
};

export default App; 