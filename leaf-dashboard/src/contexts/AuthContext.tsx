import React, { createContext, useContext, useReducer, useEffect } from 'react';
import { User, LoginCredentials, AuthState } from '../types/metrics';

// Usuários mock para demonstração
const MOCK_USERS = [
  { id: '1', username: 'admin', password: 'admin123', role: 'admin' as const },
  { id: '2', username: 'operator', password: 'op123', role: 'operator' as const },
  { id: '3', username: 'viewer', password: 'view123', role: 'viewer' as const },
];

interface AuthContextType extends AuthState {
  login: (credentials: LoginCredentials) => Promise<void>;
  logout: () => void;
  clearError: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

type AuthAction =
  | { type: 'LOGIN_START' }
  | { type: 'LOGIN_SUCCESS'; payload: User }
  | { type: 'LOGIN_FAILURE'; payload: string }
  | { type: 'LOGOUT' }
  | { type: 'CLEAR_ERROR' };

const authReducer = (state: AuthState, action: AuthAction): AuthState => {
  switch (action.type) {
    case 'LOGIN_START':
      return {
        ...state,
        isLoading: true,
        error: null,
      };
    case 'LOGIN_SUCCESS':
      return {
        ...state,
        user: action.payload,
        isAuthenticated: true,
        isLoading: false,
        error: null,
      };
    case 'LOGIN_FAILURE':
      return {
        ...state,
        user: null,
        isAuthenticated: false,
        isLoading: false,
        error: action.payload,
      };
    case 'LOGOUT':
      return {
        ...state,
        user: null,
        isAuthenticated: false,
        isLoading: false,
        error: null,
      };
    case 'CLEAR_ERROR':
      return {
        ...state,
        error: null,
      };
    default:
      return state;
  }
};

const initialState: AuthState = {
  user: null,
  isAuthenticated: false,
  isLoading: false,
  error: null,
};

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [state, dispatch] = useReducer(authReducer, initialState);

  // Verificar se há usuário salvo no localStorage
  useEffect(() => {
    const savedUser = localStorage.getItem('leaf_dashboard_user');
    if (savedUser) {
      try {
        const user = JSON.parse(savedUser);
        dispatch({ type: 'LOGIN_SUCCESS', payload: user });
      } catch (error) {
        localStorage.removeItem('leaf_dashboard_user');
      }
    }
  }, []);

  const login = async (credentials: LoginCredentials): Promise<void> => {
    dispatch({ type: 'LOGIN_START' });

    try {
      // Simular delay de API
      await new Promise(resolve => setTimeout(resolve, 1000));

      // Verificar credenciais mock
      const user = MOCK_USERS.find(
        u => u.username === credentials.username && u.password === credentials.password
      );

      if (user) {
        const { password, ...userWithoutPassword } = user;
        localStorage.setItem('leaf_dashboard_user', JSON.stringify(userWithoutPassword));
        dispatch({ type: 'LOGIN_SUCCESS', payload: userWithoutPassword });
      } else {
        dispatch({ type: 'LOGIN_FAILURE', payload: 'Credenciais inválidas' });
      }
    } catch (error) {
      dispatch({ type: 'LOGIN_FAILURE', payload: 'Erro ao fazer login' });
    }
  };

  const logout = (): void => {
    localStorage.removeItem('leaf_dashboard_user');
    dispatch({ type: 'LOGOUT' });
  };

  const clearError = (): void => {
    dispatch({ type: 'CLEAR_ERROR' });
  };

  const value: AuthContextType = {
    ...state,
    login,
    logout,
    clearError,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = (): AuthContextType => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth deve ser usado dentro de um AuthProvider');
  }
  return context;
}; 