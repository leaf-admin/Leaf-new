"use client";

export function ErrorText({ message }) {
  if (!message) return null;
  return <p className="error">{message}</p>;
}

export function EmptyState({ message = "Sem dados disponíveis." }) {
  return (
    <article className="card">
      <p>{message}</p>
    </article>
  );
}

export function LoadingState({ message = "Carregando..." }) {
  return (
    <article className="card">
      <p>{message}</p>
    </article>
  );
}
