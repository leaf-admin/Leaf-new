function withoutContentType(headers = {}) {
  return Object.fromEntries(
    Object.entries(headers || {}).filter(([key]) => String(key).toLowerCase() !== 'content-type')
  );
}

function createHttpError(response, payload = {}) {
  const message =
    payload?.message ||
    payload?.error ||
    `A solicitação falhou com status ${Number(response?.status || 0) || 'desconhecido'}.`;
  const error = new Error(String(message));
  error.status = response?.status || null;
  error.code = payload?.code || null;
  error.response = {
    status: response?.status || null,
    data: payload
  };
  return error;
}

export async function postMultipartJson(
  url,
  formData,
  { headers = {}, timeoutMs = 60000 } = {}
) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), Math.max(1000, Number(timeoutMs) || 60000));
  const requestHeaders = {
    ...withoutContentType(headers),
    Accept: headers?.Accept || headers?.accept || 'application/json'
  };

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: requestHeaders,
      body: formData,
      signal: controller.signal
    });
    const payload = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw createHttpError(response, payload);
    }

    return payload;
  } catch (error) {
    if (error?.name === 'AbortError') {
      const timeoutError = new Error('Tempo de espera esgotado. Tente novamente.');
      timeoutError.code = 'ECONNABORTED';
      throw timeoutError;
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

export { withoutContentType, createHttpError };
