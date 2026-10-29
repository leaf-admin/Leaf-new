"use client";

import { useMemo, useState } from "react";

// Corridas por dia (barras) e GMV (linha) dos últimos dias, em SVG puro.
// `days`: [{ date: "YYYY-MM-DD", requests, completed, cancelled, gmv }], mais antigo primeiro.

const WIDTH = 1100;
const HEIGHT = 220;
const PAD = { top: 16, right: 12, bottom: 28, left: 12 };

function formatBRL(value) {
  return Number(value || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function shortDay(date) {
  const [, month, day] = String(date || "").split("-");
  return day && month ? `${day}/${month}` : "";
}

export default function RidesTrendChart({ days = [], loading = false, error = "" }) {
  const [hovered, setHovered] = useState(null);
  const summary = useMemo(() => {
    const totals = days.reduce(
      (acc, day) => ({
        requests: acc.requests + Number(day.requests || 0),
        completed: acc.completed + Number(day.completed || 0),
        gmv: acc.gmv + Number(day.gmv || 0),
      }),
      { requests: 0, completed: 0, gmv: 0 },
    );
    return {
      ...totals,
      maxRides: Math.max(1, ...days.map((day) => Number(day.requests || 0))),
      maxGmv: Math.max(1, ...days.map((day) => Number(day.gmv || 0))),
    };
  }, [days]);

  const innerWidth = WIDTH - PAD.left - PAD.right;
  const innerHeight = HEIGHT - PAD.top - PAD.bottom;
  const slot = days.length ? innerWidth / days.length : innerWidth;
  const barWidth = Math.max(6, Math.min(28, slot * 0.5));
  const x = (index) => PAD.left + slot * index + slot / 2;
  const yRides = (value) => PAD.top + innerHeight - (Number(value || 0) / summary.maxRides) * innerHeight;
  const yGmv = (value) => PAD.top + innerHeight - (Number(value || 0) / summary.maxGmv) * innerHeight;
  const gmvPath = days.map((day, index) => `${index === 0 ? "M" : "L"}${x(index).toFixed(1)},${yGmv(day.gmv).toFixed(1)}`).join(" ");
  const active = hovered !== null ? days[hovered] : null;

  return (
    <section className="card trend-card" aria-label="Corridas e GMV por dia">
      <div className="trend-head">
        <div>
          <h2>Últimos {days.length || 14} dias</h2>
          <p className="panel-subtitle">Corridas pedidas, finalizadas e GMV das finalizadas.</p>
        </div>
        <dl className="trend-totals">
          <div>
            <dt>GMV</dt>
            <dd>{formatBRL(summary.gmv)}</dd>
          </div>
          <div>
            <dt>Finalizadas</dt>
            <dd>{summary.completed}</dd>
          </div>
          <div>
            <dt>Pedidas</dt>
            <dd>{summary.requests}</dd>
          </div>
        </dl>
      </div>

      {error ? <p className="text-muted">{error}</p> : null}
      {!error && loading && !days.length ? <p className="text-muted">Carregando série...</p> : null}
      {!error && days.length ? (
        <div className="trend-plot">
          <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="img" aria-label="Gráfico de corridas e GMV por dia">
            {[0.25, 0.5, 0.75, 1].map((ratio) => (
              <line
                key={ratio}
                x1={PAD.left}
                x2={WIDTH - PAD.right}
                y1={PAD.top + innerHeight * (1 - ratio)}
                y2={PAD.top + innerHeight * (1 - ratio)}
                className="trend-grid"
              />
            ))}
            {days.map((day, index) => (
              <g key={day.date} onMouseEnter={() => setHovered(index)} onMouseLeave={() => setHovered(null)}>
                <rect
                  x={x(index) - slot / 2}
                  y={PAD.top}
                  width={slot}
                  height={innerHeight}
                  className={hovered === index ? "trend-hover trend-hover-active" : "trend-hover"}
                />
                <rect
                  x={x(index) - barWidth / 2}
                  y={yRides(day.requests)}
                  width={barWidth}
                  height={PAD.top + innerHeight - yRides(day.requests)}
                  rx={4}
                  className="trend-bar-requests"
                />
                <rect
                  x={x(index) - barWidth / 2}
                  y={yRides(day.completed)}
                  width={barWidth}
                  height={PAD.top + innerHeight - yRides(day.completed)}
                  rx={4}
                  className="trend-bar-completed"
                />
                {index % 2 === days.length % 2 ? null : (
                  <text x={x(index)} y={HEIGHT - 8} textAnchor="middle" className="trend-axis">
                    {shortDay(day.date)}
                  </text>
                )}
              </g>
            ))}
            {days.length > 1 ? <path d={gmvPath} className="trend-line" /> : null}
            {days.map((day, index) => (
              <circle key={`dot-${day.date}`} cx={x(index)} cy={yGmv(day.gmv)} r={hovered === index ? 4 : 2.5} className="trend-dot" />
            ))}
          </svg>
          <div className="trend-legend" aria-hidden="true">
            <span><i className="trend-key trend-key-completed" />Finalizadas</span>
            <span><i className="trend-key trend-key-requests" />Pedidas</span>
            <span><i className="trend-key trend-key-gmv" />GMV</span>
          </div>
          {active ? (
            <div className="trend-tooltip" role="status">
              <strong>{shortDay(active.date)}</strong>
              <span>{active.completed} finalizadas de {active.requests}</span>
              <span>{formatBRL(active.gmv)}</span>
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
