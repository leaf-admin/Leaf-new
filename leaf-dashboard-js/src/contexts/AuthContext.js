"use client";

import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { authService } from "@/src/services/auth-service";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    const bootstrap = async () => {
      if (!authService.isAuthenticated()) {
        if (mounted) setLoading(false);
        return;
      }
      const verifiedUser = await authService.verifyToken();
      if (!mounted) return;
      setUser(verifiedUser);
      setLoading(false);
    };
    bootstrap();
    return () => {
      mounted = false;
    };
  }, []);

  const value = useMemo(
    () => ({
      user,
      loading,
      signIn: async (email, password) => {
        const loggedUser = await authService.login(email, password);
        setUser(loggedUser);
        return loggedUser;
      },
      signOut: async () => {
        await authService.logout();
        setUser(null);
      },
    }),
    [user, loading],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used inside AuthProvider");
  return context;
}
