"use client";

export function ErrorText({ message }) {
  if (!message) return null;
  return (
    <article className="error-banner">
      <p>{message}</p>
    </article>
  );
}

export function EmptyState({ message = "Sem dados disponíveis." }) {
  return (
    <article className="card state-card state-card-empty">
      <p>{message}</p>
    </article>
  );
}

export function LoadingState({ message = "Carregando..." }) {
  return (
    <article className="card state-card state-card-loading">
      <p>{message}</p>
    </article>
  );
}
