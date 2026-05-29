function toFiniteMoney(value, fallback = null) {
  if (value === null || value === undefined || String(value).trim() === '') {
    return fallback;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function roundMoney(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return 0;
  }
  return Number(parsed.toFixed(2));
}

function parseCurrencyText(value) {
  const raw = String(value || '').trim();
  if (!raw) {
    return null;
  }

  const sanitized = raw.replace(/[^\d,.-]/g, '');
  if (!sanitized) {
    return null;
  }

  if (sanitized.includes(',') && sanitized.includes('.')) {
    const normalized = sanitized.replace(/\./g, '').replace(',', '.');
    return toFiniteMoney(normalized, null);
  }

  if (sanitized.includes(',')) {
    return toFiniteMoney(sanitized.replace(',', '.'), null);
  }

  return toFiniteMoney(sanitized, null);
}

function pickMoney(...values) {
  for (const value of values) {
    const parsed =
      typeof value === 'string' ? parseCurrencyText(value) : toFiniteMoney(value, null);
    if (parsed !== null && parsed > 0) {
      return roundMoney(parsed);
    }
  }

  for (const value of values) {
    const parsed =
      typeof value === 'string' ? parseCurrencyText(value) : toFiniteMoney(value, null);
    if (parsed !== null) {
      return roundMoney(Math.max(0, parsed));
    }
  }

  return null;
}

function pickCentsAsMoney(...values) {
  for (const value of values) {
    const parsed = toFiniteMoney(value, null);
    if (parsed !== null && parsed > 0) {
      return roundMoney(parsed / 100);
    }
  }

  return null;
}

export function formatCurrencyBRL(value) {
  const numeric = toFiniteMoney(value, 0);
  const absolute = Math.abs(roundMoney(numeric)).toFixed(2);
  const [integerPart, decimalPart] = absolute.split('.');
  const groupedInteger = integerPart.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  const signal = numeric < 0 ? '-' : '';
  return `R$ ${signal}${groupedInteger},${decimalPart}`;
}

export function resolveTripTollAmount(item = {}) {
  const direct = pickMoney(
    item?.tollFee,
    item?.tollAmount,
    item?.tollFeeReais,
    item?.pedagio,
    item?.['pedágio'],
    item?.fareBreakdown?.tollFee,
    item?.paymentBreakdown?.tollFee,
    item?.financialBreakdown?.tollFee,
    item?.calculation?.breakdown?.tollFee,
    item?.fareBreakdown?.calculation?.breakdown?.tollFee,
  );

  if (direct !== null && direct > 0) {
    return direct;
  }

  const cents = pickCentsAsMoney(
    item?.tollFeeCents,
    item?.calculation?.tollFee,
    item?.fareBreakdown?.calculation?.tollFee,
    item?.paymentBreakdown?.calculation?.tollFee,
    item?.financialBreakdown?.calculation?.tollFee,
  );

  return cents ?? direct ?? 0;
}

export function resolveTripPassengerPaidAmount(item = {}) {
  return roundMoney(
    pickMoney(
      item?.grossAmount,
      item?.grossFare,
      item?.totalPaid,
      item?.totalAmount,
      item?.totalFare,
      item?.paymentAmount,
      item?.chargedAmount,
      item?.amountPaid,
      item?.customerPaid,
      item?.customer_paid,
      item?.fare,
      item?.finalFare,
      item?.amount,
      parseCurrencyText(item?.value),
    ) ?? 0,
  );
}

export function resolveTripGrossAmount(item = {}) {
  return roundMoney(
    resolveTripPassengerPaidAmount(item),
  );
}

export function resolveTripFeeAmount(item = {}) {
  const explicitFee =
    toFiniteMoney(item?.totalFees, null) ??
    toFiniteMoney(item?.feeAmount, null);
  if (explicitFee !== null) {
    return roundMoney(Math.max(0, explicitFee));
  }

  const gross = resolveTripGrossAmount(item);
  const explicitNet =
    toFiniteMoney(item?.driverNetAmount, null) ??
    toFiniteMoney(item?.netAmount, null);
  if (explicitNet !== null) {
    return roundMoney(Math.max(0, gross - explicitNet));
  }

  return null;
}

export function resolveTripNetAmountOrNull(item = {}) {
  const explicitNet =
    toFiniteMoney(item?.driverNetAmount, null) ??
    toFiniteMoney(item?.netAmount, null);
  if (explicitNet !== null) {
    return roundMoney(Math.max(0, explicitNet));
  }

  const gross = resolveTripGrossAmount(item);
  const fees = resolveTripFeeAmount(item);
  if (fees !== null) {
    return roundMoney(Math.max(0, gross - fees));
  }

  return null;
}

export function resolveTripNetAmount(item = {}, { fallbackToGross = false } = {}) {
  const resolvedNet = resolveTripNetAmountOrNull(item);
  if (resolvedNet !== null) {
    return resolvedNet;
  }

  if (fallbackToGross) {
    const parsedValue = parseCurrencyText(item?.value);
    if (parsedValue !== null) {
      return roundMoney(Math.max(0, parsedValue));
    }

    return resolveTripGrossAmount(item);
  }

  return 0;
}

export function resolveTripDisplayAmount(item = {}, { role = 'driver' } = {}) {
  if (role === 'driver') {
    return resolveTripNetAmount(item);
  }
  return resolveTripGrossAmount(item);
}

export function resolveTripDisplayLabel(item = {}, { role = 'driver' } = {}) {
  return formatCurrencyBRL(resolveTripDisplayAmount(item, { role }));
}

export function buildTripFinancialTotals(history = [], { role = 'driver' } = {}) {
  const normalizedHistory = Array.isArray(history) ? history.filter(Boolean) : [];

  return normalizedHistory.reduce(
    (summary, item) => {
      const gross = resolveTripGrossAmount(item);
      const net = resolveTripNetAmount(item);
      const fees = resolveTripFeeAmount(item);

      return {
        count: summary.count + 1,
        totalGross: roundMoney(summary.totalGross + gross),
        totalNet: roundMoney(summary.totalNet + net),
        totalFees:
          fees === null ? summary.totalFees : roundMoney(summary.totalFees + fees),
      };
    },
    {
      count: 0,
      role,
      totalGross: 0,
      totalNet: 0,
      totalFees: 0,
    },
  );
}

function parseRuntimeTripDate(rawValue) {
  if (!rawValue && rawValue !== 0) {
    return null;
  }

  if (rawValue instanceof Date) {
    return Number.isNaN(rawValue.getTime()) ? null : rawValue;
  }

  if (typeof rawValue === 'number') {
    const date = new Date(rawValue > 1000000000000 ? rawValue : rawValue * 1000);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  const text = String(rawValue).trim();
  if (!text) {
    return null;
  }

  const directDate = new Date(text);
  if (!Number.isNaN(directDate.getTime())) {
    return directDate;
  }

  const match = text.match(
    /^(\d{2})\/(\d{2})(?:\/(\d{2,4}))?(?:,\s*(\d{2}):(\d{2}))?$/,
  );
  if (!match) {
    return null;
  }

  const [, dayText, monthText, yearText, hourText, minuteText] = match;
  const today = new Date();
  const fullYear = yearText
    ? Number(yearText.length === 2 ? `20${yearText}` : yearText)
    : today.getFullYear();
  const monthIndex = Number(monthText) - 1;
  const day = Number(dayText);
  const hour = Number(hourText || 0);
  const minute = Number(minuteText || 0);
  const parsed = new Date(fullYear, monthIndex, day, hour, minute);

  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function toIsoDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function toDateLabel(date) {
  return `${String(date.getDate()).padStart(2, '0')}/${String(
    date.getMonth() + 1,
  ).padStart(2, '0')}`;
}

export function buildRuntimeHistorySeries(history = []) {
  const normalizedHistory = Array.isArray(history) ? history.filter(Boolean) : [];
  const buckets = new Map();
  const now = new Date();

  normalizedHistory.forEach(item => {
    const parsedDate =
      parseRuntimeTripDate(item?.completedAt) ||
      parseRuntimeTripDate(item?.createdAt) ||
      parseRuntimeTripDate(item?.updatedAt) ||
      parseRuntimeTripDate(item?.date) ||
      now;
    const dayKey = toIsoDate(parsedDate);
    const previous = buckets.get(dayKey) || {
      key: dayKey,
      date: dayKey,
      label: toDateLabel(parsedDate),
      netAmount: 0,
      grossAmount: 0,
      feeAmount: 0,
      completedCount: 0,
      cancelledCount: 0,
    };

    previous.netAmount = roundMoney(previous.netAmount + resolveTripNetAmount(item));
    previous.grossAmount = roundMoney(previous.grossAmount + resolveTripGrossAmount(item));
    previous.feeAmount = roundMoney(previous.feeAmount + (resolveTripFeeAmount(item) || 0));
    previous.completedCount += 1;

    buckets.set(dayKey, previous);
  });

  return Array.from(buckets.values()).sort((left, right) =>
    String(left.date || '').localeCompare(String(right.date || '')),
  );
}
