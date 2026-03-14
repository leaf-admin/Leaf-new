"use client";

export default function KpiCard({
  title,
  value,
  subtitle,
  tone = "default",
  onClick,
  selected = false,
}) {
  const toneClass =
    tone === "positive"
      ? "kpi-positive"
      : tone === "warning"
        ? "kpi-warning"
        : tone === "danger"
          ? "kpi-danger"
          : "kpi-default";

  return (
    <article
      className={`card kpi-card ${toneClass} ${onClick ? "kpi-clickable" : ""} ${selected ? "kpi-selected" : ""}`}
      onClick={onClick}
      onKeyDown={(event) => {
        if (!onClick) return;
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onClick();
        }
      }}
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
    >
      <h2>{title}</h2>
      <p className="kpi-value">{value}</p>
      {subtitle ? <p className="kpi-subtitle">{subtitle}</p> : null}
    </article>
  );
}
