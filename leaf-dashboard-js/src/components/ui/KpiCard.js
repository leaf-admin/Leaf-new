"use client";

export default function KpiCard({ title, value, subtitle, tone = "default" }) {
  const toneClass =
    tone === "positive"
      ? "kpi-positive"
      : tone === "warning"
        ? "kpi-warning"
        : tone === "danger"
          ? "kpi-danger"
          : "kpi-default";

  return (
    <article className={`card kpi-card ${toneClass}`}>
      <h2>{title}</h2>
      <p className="kpi-value">{value}</p>
      {subtitle ? <p className="kpi-subtitle">{subtitle}</p> : null}
    </article>
  );
}
