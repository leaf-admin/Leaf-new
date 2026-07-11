"use client";

import { useId } from "react";

export default function Panel({ title, subtitle, actions, children, className = "" }) {
  const titleId = useId();
  const panelClassName = `card panel ${className}`.trim();
  return (
    <article className={panelClassName} aria-labelledby={titleId}>
      <div className="panel-head">
        <div>
          <h2 id={titleId}>{title}</h2>
          {subtitle ? <p className="panel-subtitle">{subtitle}</p> : null}
        </div>
        {actions ? <div className="panel-actions">{actions}</div> : null}
      </div>
      <div className="panel-body">{children}</div>
    </article>
  );
}
