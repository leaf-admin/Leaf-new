/**
 * @param {number} value
 * @param {number} [min=0]
 * @param {number} [max=1]
 * @returns {number}
 */
function clamp(value, min = 0, max = 1) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return min;
  }
  return Math.min(Math.max(numeric, min), max);
}

/**
 * @param {number} x0
 * @param {number} y0
 * @param {number} x1
 * @param {number} y1
 * @param {number} x
 * @returns {number}
 */
function linearInterpolation(x0, y0, x1, y1, x) {
  if (!Number.isFinite(x0) || !Number.isFinite(y0) || !Number.isFinite(x1) || !Number.isFinite(y1)) {
    return 0;
  }

  if (x1 === x0) {
    return y1;
  }

  return y0 + (((x - x0) / (x1 - x0)) * (y1 - y0));
}

/**
 * @param {number} value
 * @param {{x:number, y:number}[]} breakpoints
 * @returns {number}
 */
function normalizeRange(value, breakpoints = []) {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue) || !Array.isArray(breakpoints) || breakpoints.length === 0) {
    return 0;
  }

  const sorted = breakpoints
    .map((point) => ({ x: Number(point.x), y: clamp(point.y) }))
    .filter((point) => Number.isFinite(point.x))
    .sort((left, right) => left.x - right.x);

  if (sorted.length === 0) {
    return 0;
  }

  if (numericValue <= sorted[0].x) {
    return sorted[0].y;
  }

  for (let index = 1; index < sorted.length; index += 1) {
    const previous = sorted[index - 1];
    const current = sorted[index];
    if (numericValue <= current.x) {
      return clamp(linearInterpolation(previous.x, previous.y, current.x, current.y, numericValue));
    }
  }

  return sorted[sorted.length - 1].y;
}

/**
 * @param {number} numerator
 * @param {number} denominator
 * @param {number} [fallback=0]
 * @returns {number}
 */
function safeDivide(numerator, denominator, fallback = 0) {
  const top = Number(numerator);
  const bottom = Number(denominator);
  if (!Number.isFinite(top) || !Number.isFinite(bottom) || bottom === 0) {
    return fallback;
  }
  return top / bottom;
}

/**
 * @param {number} value
 * @returns {number}
 */
function roundCurrency(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return 0;
  }
  return Math.round(numeric * 100) / 100;
}

module.exports = {
  clamp,
  linearInterpolation,
  normalizeRange,
  safeDivide,
  roundCurrency
};
