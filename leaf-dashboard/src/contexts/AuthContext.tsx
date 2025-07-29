import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';

interface User {
  id: number;
  username: string;
  role: string;
  name: string;
}

interface AuthContextType {
  user: User | null;
  token: string | null;
  login: (token: string, user: User) => void;
  logout: () => void;
  isAuthenticated: boolean;
  loading: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};

interface AuthProviderProps {
  children: ReactNode;
}

export const AuthProvider: React.FC<AuthProviderProps> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Verificar se há token salvo
    const savedToken = localStorage.getItem('token');
    const savedUser = localStorage.getItem('user');

    if (savedToken && savedUser) {
      try {
        const userData = JSON.parse(savedUser);
        setToken(savedToken);
        setUser(userData);
        
        // Verificar se o token ainda é válido
        verifyToken(savedToken);
      } catch (error) {
        console.error('Erro ao carregar dados de autenticação:', error);
        logout();
      }
    }
    
    setLoading(false);
  }, []);

  const verifyToken = async (tokenToVerify: string) => {
    try {
      const response = await fetch('https://api.leaf.app.br/auth/verify', {
        headers: {
          'Authorization': `Bearer ${tokenToVerify}`,
        },
      });

      if (!response.ok) {
        throw new Error('Token inválido');
      }

      const data = await response.json();
      setUser(data.user);
    } catch (error) {
      console.error('Token inválido:', error);
      logout();
    }
  };

  const login = (newToken: string, userData: User) => {
    setToken(newToken);
    setUser(userData);
    localStorage.setItem('token', newToken);
    localStorage.setItem('user', JSON.stringify(userData));
  };

  const logout = () => {
    setToken(null);
    setUser(null);
    localStorage.removeItem('token');
    localStorage.removeItem('user');
  };

  const isAuthenticated = !!token && !!user;

  return (
    <AuthContext.Provider value={{
      user,
      token,
      login,
      logout,
      isAuthenticated,
      loading
    }}>
      {children}
    </AuthContext.Provider>
  );
}; 