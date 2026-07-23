"use client";

export default function Panel({ title, subtitle, actions, children, className = "" }) {
  const panelClassName = `card panel ${className}`.trim();
  return (
    <article className={panelClassName}>
      <div className="panel-head">
        <div>
          <h2>{title}</h2>
          {subtitle ? <p className="panel-subtitle">{subtitle}</p> : null}
        </div>
        {actions ? <div className="panel-actions">{actions}</div> : null}
      </div>
      <div className="panel-body">{children}</div>
    </article>
  );
}
