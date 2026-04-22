function stripDiacritics(value) {
    return String(value || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '');
}

function normalizeOperationalCarType(value, fallback = '') {
    const normalized = stripDiacritics(value)
        .toLowerCase()
        .trim()
        .replace(/[_-]+/g, ' ')
        .replace(/\s+/g, ' ');

    if (!normalized) return fallback;

    if (
        normalized.includes('moto') ||
        normalized.includes('motorcycle') ||
        normalized === 'type moto' ||
        normalized === 'type_moto'
    ) {
        return 'leaf_moto';
    }

    if (
        normalized.includes('model s') ||
        normalized.includes('elite') ||
        normalized === 'premium' ||
        normalized === 'type3' ||
        normalized === 'type 3'
    ) {
        return 'leaf_elite';
    }

    if (
        normalized.includes('model 3') ||
        normalized.includes('model y') ||
        normalized.includes('plus') ||
        normalized.includes('standard') ||
        normalized.includes('basic') ||
        normalized === 'type1' ||
        normalized === 'type 1' ||
        normalized === 'plus'
    ) {
        return 'leaf_plus';
    }

    return normalized;
}

function toOperationalCarTypeLabel(value, fallback = null) {
    const normalized = normalizeOperationalCarType(value);

    if (normalized === 'leaf_plus') return 'Leaf Plus';
    if (normalized === 'leaf_elite') return 'Leaf Elite';
    if (normalized === 'leaf_moto') return 'Leaf Moto';

    return fallback;
}

function resolveOperationalCarTypeLabel(candidate, fallback = null) {
    const direct = toOperationalCarTypeLabel(candidate, null);
    if (direct) {
        return direct;
    }

    return fallback;
}

module.exports = {
    normalizeOperationalCarType,
    resolveOperationalCarTypeLabel
};
