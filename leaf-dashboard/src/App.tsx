import React from 'react'
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider, useAuth } from './contexts/AuthContext'
import Dashboard from './pages/Dashboard'
import Login from './pages/Login'
import VPSDetails from './pages/VPSDetails'
import RedisDetails from './pages/RedisDetails'
import WebSocketDetails from './pages/WebSocketDetails'
import FirebaseDetails from './pages/FirebaseDetails'
import Layout from './components/Layout'

// Componente para proteger rotas
const ProtectedRoute: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { isAuthenticated, loading } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-100 flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500"></div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  return <>{children}</>;
};

// Componente principal do app
const AppContent: React.FC = () => {
  const { isAuthenticated } = useAuth();

  return (
    <Router>
      <Routes>
        {/* Rota pública */}
        <Route 
          path="/login" 
          element={isAuthenticated ? <Navigate to="/" replace /> : <Login />} 
        />
        
        {/* Rotas protegidas */}
        <Route path="/" element={
          <ProtectedRoute>
            <Layout>
              <Dashboard />
            </Layout>
          </ProtectedRoute>
        } />
        
        <Route path="/vps/:id" element={
          <ProtectedRoute>
            <Layout>
              <VPSDetails />
            </Layout>
          </ProtectedRoute>
        } />
        
        <Route path="/redis" element={
          <ProtectedRoute>
            <Layout>
              <RedisDetails />
            </Layout>
          </ProtectedRoute>
        } />
        
        <Route path="/websocket" element={
          <ProtectedRoute>
            <Layout>
              <WebSocketDetails />
            </Layout>
          </ProtectedRoute>
        } />
        
        <Route path="/firebase" element={
          <ProtectedRoute>
            <Layout>
              <FirebaseDetails />
            </Layout>
          </ProtectedRoute>
        } />
        
        {/* Redirecionar para login se não autenticado */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Router>
  );
};

// App principal com provider de autenticação
function App() {
  return (
    <AuthProvider>
      <AppContent />
    </AuthProvider>
  );
}

export default App 