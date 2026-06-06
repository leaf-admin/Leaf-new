import { RequestPushMsg } from '../src/services/canonical/pushNotificationFunction';

jest.mock('../src/utils/Logger', () => ({
  log: jest.fn(),
}));

jest.mock('../src/services/canonical/sessionService', () => ({
  firebase: {
    config: {
      projectId: 'leaf-reactnative',
    },
  },
}));

jest.mock('../src/state/appStore', () => ({
  __esModule: true,
  default: {
    getState: jest.fn(() => ({
      settingsdata: {
        settings: {
          CompanyWebsite: 'https://app.leaf.test',
        },
      },
    })),
  },
}));

describe('pushNotificationFunction', () => {
  const originalWindow = global.window;

  beforeEach(() => {
    global.fetch = jest.fn(() => Promise.resolve({ ok: true }));
    global.window = {
      location: {
        origin: 'https://app.leaf.test',
      },
    };
  });

  afterEach(() => {
    jest.clearAllMocks();
    global.window = originalWindow;
  });

  it('posts push notification payload to the configured app host', () => {
    RequestPushMsg('push-token-1', {
      title: 'Nova corrida',
      msg: 'Voce recebeu uma nova corrida',
      screen: 'DriverTrips',
    });

    expect(global.fetch).toHaveBeenCalledWith(
      'https://app.leaf.test/send_notification',
      expect.objectContaining({
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          token: 'push-token-1',
          title: 'Nova corrida',
          msg: 'Voce recebeu uma nova corrida',
          screen: 'DriverTrips',
        }),
      }),
    );
  });
});
