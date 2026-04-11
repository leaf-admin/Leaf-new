import { buildBackendUrl } from '../config/backendBaseUrl';
import { createAxiosInstance } from '../utils/axiosInterceptor';

const httpClient = createAxiosInstance({
  baseURL: buildBackendUrl(''),
  timeout: 30000
});

const normalizeUrl = (url) => {
  if (!url) return '/';
  if (/^https?:\/\//i.test(url)) return url;
  return `/${String(url).replace(/^\/+/, '')}`;
};

const request = (method, url, dataOrConfig, maybeConfig) => {
  if (method === 'get' || method === 'delete') {
    return httpClient.request({
      method,
      url: normalizeUrl(url),
      ...(dataOrConfig || {})
    });
  }

  return httpClient.request({
    method,
    url: normalizeUrl(url),
    data: dataOrConfig,
    ...(maybeConfig || {})
  });
};

export const apiClient = {
  request: (config) => httpClient.request(config),
  get: (url, config = {}) => request('get', url, config),
  post: (url, data = {}, config = {}) => request('post', url, data, config),
  put: (url, data = {}, config = {}) => request('put', url, data, config),
  patch: (url, data = {}, config = {}) => request('patch', url, data, config),
  delete: (url, config = {}) => request('delete', url, config)
};

export default apiClient;
