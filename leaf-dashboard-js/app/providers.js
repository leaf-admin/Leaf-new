"use client";

import { AuthProvider } from "@/src/contexts/AuthContext";

export default function Providers({ children }) {
  return <AuthProvider>{children}</AuthProvider>;
}
