"use client";

function prettifyKey(rawKey) {
  return String(rawKey || "")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^./, (letter) => letter.toUpperCase());
}

function isIsoDateString(value) {
  return typeof value === "string" && /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(value);
}

export function formatDataValue(value) {
  if (value === null || value === undefined || value === "") return "-";

  if (typeof value === "boolean") {
    return value ? "Sim" : "Não";
  }

  if (typeof value === "number") {
    if (!Number.isFinite(value)) return "-";
    return value.toLocaleString("pt-BR");
  }

  if (Array.isArray(value)) {
    return `${value.length} ${value.length === 1 ? "item" : "itens"}`;
  }

  if (typeof value === "object") {
    if (typeof value.status === "string" && value.status.trim()) {
      return value.status;
    }
    if (typeof value.name === "string" && value.name.trim()) {
      return value.name;
    }
    const count = Object.keys(value).length;
    return `${count} ${count === 1 ? "campo" : "campos"}`;
  }

  if (isIsoDateString(value)) {
    const date = new Date(value);
    if (!Number.isNaN(date.getTime())) {
      return date.toLocaleString("pt-BR");
    }
  }

  if (typeof value === "string") {
    return value.length > 90 ? `${value.slice(0, 87)}...` : value;
  }

  return String(value);
}

export function KeyValueGrid({
  data,
  includeKeys,
  excludeKeys = [],
  labels = {},
  maxItems = 16,
  emptyMessage = "Sem dados disponíveis.",
  valueFormatter,
}) {
  const source = data && typeof data === "object" ? data : {};
  const includeSet = Array.isArray(includeKeys) && includeKeys.length > 0 ? new Set(includeKeys) : null;
  const excludeSet = new Set(excludeKeys);

  const entries = Object.entries(source)
    .filter(([key]) => (includeSet ? includeSet.has(key) : true))
    .filter(([key]) => !excludeSet.has(key))
    .slice(0, maxItems)
    .map(([key, rawValue]) => {
      const nextValue = valueFormatter ? valueFormatter(key, rawValue) : formatDataValue(rawValue);
      return {
        key,
        label: labels[key] || prettifyKey(key),
        value: nextValue,
      };
    });

  if (entries.length === 0) {
    return <p className="text-muted">{emptyMessage}</p>;
  }

  return (
    <div className="metric-list">
      {entries.map((entry) => (
        <div key={entry.key} className="row">
          <div className="label">{entry.label}</div>
          <div className="value">{entry.value}</div>
        </div>
      ))}
    </div>
  );
}

export function TechnicalDetails({ title = "Detalhes técnicos", data, defaultOpen = false }) {
  const hasData = data !== null && data !== undefined;
  return (
    <details className="technical-details" open={defaultOpen}>
      <summary>{title}</summary>
      {hasData ? <pre>{JSON.stringify(data, null, 2)}</pre> : <p className="text-muted">Sem dados técnicos.</p>}
    </details>
  );
}
