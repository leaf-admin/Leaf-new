"use client";

export default function Panel({ title, actions, children }) {
  return (
    <article className="card">
      <div className="panel-head">
        <h2>{title}</h2>
        {actions ? <div className="panel-actions">{actions}</div> : null}
      </div>
      {children}
    </article>
  );
}
