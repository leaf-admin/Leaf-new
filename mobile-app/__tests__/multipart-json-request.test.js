import {
  createHttpError,
  postMultipartJson,
  withoutContentType
} from '../src/utils/multipartJsonRequest';

describe('multipartJsonRequest', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  test('lets React Native generate the multipart boundary', async () => {
    const body = { append: jest.fn() };
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: jest.fn().mockResolvedValue({ success: true })
    });

    await expect(postMultipartJson('https://api.leaf.app.br/upload', body, {
      headers: {
        Authorization: 'Bearer token',
        'Content-Type': 'multipart/form-data'
      }
    })).resolves.toEqual({ success: true });

    expect(global.fetch).toHaveBeenCalledWith(
      'https://api.leaf.app.br/upload',
      expect.objectContaining({
        method: 'POST',
        body,
        headers: {
          Authorization: 'Bearer token',
          Accept: 'application/json'
        }
      })
    );
  });

  test('preserves backend status and safe error payload', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 422,
      json: jest.fn().mockResolvedValue({
        error: 'Documento inválido',
        code: 'INVALID_DOCUMENT',
        source: 'document_identity_mismatch'
      })
    });

    await expect(postMultipartJson('https://api.leaf.app.br/upload', {})).rejects.toMatchObject({
      message: 'Documento inválido',
      code: 'INVALID_DOCUMENT',
      status: 422,
      response: {
        status: 422,
        data: expect.objectContaining({ source: 'document_identity_mismatch' })
      }
    });
  });

  test('normalizes header casing and HTTP errors', () => {
    expect(withoutContentType({ accept: 'application/json', 'content-type': 'multipart/form-data' }))
      .toEqual({ accept: 'application/json' });
    expect(createHttpError({ status: 503 }, { error: 'Indisponível' })).toMatchObject({
      message: 'Indisponível',
      status: 503
    });
  });
});
