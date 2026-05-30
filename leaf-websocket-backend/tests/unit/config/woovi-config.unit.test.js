const CONFIG_PATH = '../../../config/woovi-config';

const WOOVI_ENV_KEYS = [
  'NODE_ENV',
  'WOOVI_ENVIRONMENT',
  'WOOVI_BASE_URL',
  'WOOVI_AUTHORIZATION_APP_ID',
  'WOOVI_APP_ID_TOKEN',
  'WOOVI_API_TOKEN',
  'WOOVI_APP_ID',
  'WOOVI_CLIENT_ID',
  'WOOVI_CLIENT_SECRET',
  'WOOVI_MASTER_AUTHORIZATION_APP_ID',
  'WOOVI_MASTER_APP_ID_TOKEN',
  'WOOVI_MASTER_API_TOKEN',
  'WOOVI_MASTER_APP_ID',
  'WOOVI_MASTER_CLIENT_ID',
  'WOOVI_SEND_APP_ID',
  'LEAF_PIX_KEY'
];

describe('woovi-config', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
    for (const key of WOOVI_ENV_KEYS) {
      delete process.env[key];
    }
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  function loadConfig() {
    return require(CONFIG_PATH);
  }

  it('uses Woovi AppID/token as Authorization and keeps Client_Id as client id', () => {
    process.env.WOOVI_API_TOKEN = 'authorization-app-id-token';
    process.env.WOOVI_APP_ID = 'Client_Id_demo';

    const { getWooviConfig, getWooviAuthHeaders } = loadConfig();
    const config = getWooviConfig();

    expect(config.apiToken).toBe('authorization-app-id-token');
    expect(config.authorizationAppId).toBe('authorization-app-id-token');
    expect(config.clientId).toBe('Client_Id_demo');
    expect(config.appId).toBe('Client_Id_demo');
    expect(getWooviAuthHeaders(config)).toEqual({
      'Content-Type': 'application/json',
      Authorization: 'authorization-app-id-token'
    });
  });

  it('prioritizes explicit authorization app id over legacy token names', () => {
    process.env.WOOVI_AUTHORIZATION_APP_ID = 'new-explicit-app-id';
    process.env.WOOVI_APP_ID_TOKEN = 'app-id-token-alias';
    process.env.WOOVI_API_TOKEN = 'legacy-api-token';
    process.env.WOOVI_CLIENT_ID = 'Client_Id_demo';

    const { getWooviConfig } = loadConfig();

    expect(getWooviConfig().apiToken).toBe('new-explicit-app-id');
  });

  it('derives Authorization from Client_Id and client secret only when no token is explicit', () => {
    process.env.WOOVI_CLIENT_ID = 'Client_Id_demo';
    process.env.WOOVI_CLIENT_SECRET = 'Client_Secret_demo';

    const { getWooviConfig } = loadConfig();
    const expected = Buffer.from('Client_Id_demo:Client_Secret_demo').toString('base64');

    expect(getWooviConfig().apiToken).toBe(expected);
  });

  it('keeps backward compatibility when WOOVI_APP_ID is a legacy token instead of Client_Id', () => {
    process.env.WOOVI_APP_ID = 'legacy-authorization-app-id';

    const { getWooviConfig } = loadConfig();
    const config = getWooviConfig();

    expect(config.apiToken).toBe('legacy-authorization-app-id');
    expect(config.clientId).toBe('');
  });

  it('sends x-app-id only when explicitly enabled', () => {
    process.env.WOOVI_API_TOKEN = 'authorization-app-id-token';
    process.env.WOOVI_CLIENT_ID = 'Client_Id_demo';
    process.env.WOOVI_SEND_APP_ID = 'true';

    const { getWooviConfig, getWooviAuthHeaders } = loadConfig();

    expect(getWooviAuthHeaders(getWooviConfig())).toEqual({
      'Content-Type': 'application/json',
      Authorization: 'authorization-app-id-token',
      'x-app-id': 'Client_Id_demo'
    });
  });

  it('normalizes sandbox base url and protects sandbox from production host drift', () => {
    process.env.WOOVI_ENVIRONMENT = 'sandbox';
    process.env.WOOVI_BASE_URL = 'https://api.woovi.com/';

    const { getWooviConfig } = loadConfig();

    expect(getWooviConfig().baseUrl).toBe('https://api.woovi-sandbox.com/api/v1');
  });
});
