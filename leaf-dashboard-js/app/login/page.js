"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/src/contexts/AuthContext";

export default function LoginPage() {
  const router = useRouter();
  const { user, signIn } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (user) router.replace("/dashboard");
  }, [user, router]);

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError("");
    setLoading(true);
    try {
      await signIn(email, password);
      router.replace("/dashboard");
    } catch (err) {
      setError(err?.message || "Falha no login");
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="page-center">
      <form className="card" onSubmit={handleSubmit}>
        <h1>Leaf Dashboard</h1>
        <p>Acesso administrativo</p>
        <input
          type="email"
          placeholder="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
        <input
          type="password"
          placeholder="senha"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />
        {error ? <span className="error">{error}</span> : null}
        <button type="submit" disabled={loading}>
          {loading ? "Entrando..." : "Entrar"}
        </button>
      </form>
    </main>
  );
}
