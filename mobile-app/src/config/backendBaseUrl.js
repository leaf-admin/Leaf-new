const DEFAULT_BACKEND_BASE_URL = 'https://api.62.169.31.231.sslip.io';

export const normalizeBackendBaseUrl = (url) => {
  const raw = String(url || '').trim();
  if (!raw) return DEFAULT_BACKEND_BASE_URL;
  const withoutTrailingSlash = raw.replace(/\/+$/, '');
  return withoutTrailingSlash.replace(/\/api$/i, '');
};

export const BACKEND_BASE_URL = normalizeBackendBaseUrl(
  process.env.EXPO_PUBLIC_API_URL ||
    process.env.EXPO_PUBLIC_BACKEND_URL ||
    DEFAULT_BACKEND_BASE_URL
);

export const buildBackendUrl = (path = '') => {
  const normalizedPath = String(path || '').trim();
  if (!normalizedPath) return BACKEND_BASE_URL;
  return `${BACKEND_BASE_URL}${normalizedPath.startsWith('/') ? normalizedPath : `/${normalizedPath}`}`;
};

export default BACKEND_BASE_URL;
