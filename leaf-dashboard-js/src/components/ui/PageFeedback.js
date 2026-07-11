"use client";

export function ErrorText({ message }) {
  if (!message) return null;
  return (
    <article className="error-banner" role="alert" aria-live="assertive">
      <p>{message}</p>
    </article>
  );
}

export function EmptyState({ message = "Sem dados disponíveis." }) {
  return (
    <article className="card state-card state-card-empty" role="status">
      <p>{message}</p>
    </article>
  );
}

export function LoadingState({ message = "Carregando..." }) {
  return (
    <article className="card state-card state-card-loading" role="status" aria-live="polite" aria-busy="true">
      <span className="state-loading-indicator" aria-hidden="true" />
      <p>{message}</p>
    </article>
  );
}
