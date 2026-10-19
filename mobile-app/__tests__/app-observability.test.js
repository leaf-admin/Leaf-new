import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  createRageTapDetector,
  maskPii,
  sanitizeProperties,
  scrubSentryEvent,
} from '../src/services/observability/observabilityPrivacy';

const mockSentry = {
  init: jest.fn(),
  setTags: jest.fn(),
  setTag: jest.fn(),
  setUser: jest.fn(),
  addBreadcrumb: jest.fn(),
  captureException: jest.fn(),
  wrap: jest.fn((Component) => Component),
};
const mockPosthog = {
  register: jest.fn(),
  capture: jest.fn(),
  screen: jest.fn(),
  identify: jest.fn(),
  reset: jest.fn(),
  optIn: jest.fn(),
  optOut: jest.fn(),
};

jest.mock('@sentry/react-native', () => mockSentry, { virtual: true });
jest.mock('posthog-react-native', () => ({ __esModule: true, default: jest.fn(() => mockPosthog) }), { virtual: true });

describe('observability privacy', () => {
  it('masks CPF, e-mail, phone and tokens in text', () => {
    expect(maskPii('cpf 123.456.789-09 mail ana@x.com tel +55 21 99999-1234 Bearer abcdefghijklmnop'))
      .toBe('cpf [CPF] mail [EMAIL] tel [PHONE] Bearer[TOKEN]');
  });

  it('keeps only the user id and drops request bodies in Sentry events', () => {
    const event = scrubSentryEvent({
      message: 'falha para ana@x.com',
      user: { id: 'uid-1', email: 'ana@x.com', ip_address: '1.2.3.4' },
      request: { data: { cpf: '123' }, headers: { Authorization: 'x' }, url: 'https://api' },
    });
    expect(event.message).toBe('falha para [EMAIL]');
    expect(event.user).toEqual({ id: 'uid-1' });
    expect(event.request).toEqual({ url: 'https://api' });
  });

  it('drops personal keys and non-primitive values from event properties', () => {
    expect(sanitizeProperties({
      step: 'credentials',
      role: 'driver',
      phone: '21999991234',
      nome: 'Ana',
      pickupLat: -22.9,
      nested: { a: 1 },
      note: 'fale com ana@x.com',
    })).toEqual({ step: 'credentials', role: 'driver', note: 'fale com [EMAIL]' });
  });

  it('detects three taps on the same spot within a second, once', () => {
    const register = createRageTapDetector();
    expect(register(100, 100, 0)).toBe(false);
    expect(register(105, 102, 300)).toBe(false);
    expect(register(102, 98, 600)).toBe(true);
    expect(register(102, 98, 700)).toBe(false);
    expect(register(300, 300, 800)).toBe(false);
    expect(register(100, 100, 5000)).toBe(false);
  });
});

describe('AppObservability', () => {
  const ORIGINAL_ENV = process.env;
  let observability;

  beforeEach(async () => {
    jest.clearAllMocks();
    await AsyncStorage.clear();
    process.env = {
      ...ORIGINAL_ENV,
      EXPO_PUBLIC_OBSERVABILITY_IN_DEV: 'true',
      EXPO_PUBLIC_SENTRY_DSN: 'https://public@o1.ingest.sentry.io/1',
      EXPO_PUBLIC_POSTHOG_API_KEY: 'phc_test',
    };
    jest.isolateModules(() => {
      observability = require('../src/services/observability/AppObservability');
    });
    observability.initObservability();
    await new Promise((resolve) => setImmediate(resolve));
  });

  afterAll(() => {
    process.env = ORIGINAL_ENV;
  });

  it('starts Sentry without PII or tracing and PostHog on the EU host', () => {
    expect(mockSentry.init).toHaveBeenCalledWith(expect.objectContaining({
      dsn: 'https://public@o1.ingest.sentry.io/1',
      sendDefaultPii: false,
      tracesSampleRate: 0,
    }));
    const PostHog = require('posthog-react-native').default;
    expect(PostHog).toHaveBeenCalledWith('phc_test', expect.objectContaining({ host: 'https://eu.i.posthog.com' }));
  });

  it('identifies by uid and role only, and resets on logout', () => {
    observability.identifyUser({ uid: 'uid-1', role: 'driver' });
    expect(mockSentry.setUser).toHaveBeenCalledWith({ id: 'uid-1' });
    expect(mockPosthog.identify).toHaveBeenCalledWith('uid-1', { role: 'driver' });

    observability.resetUser();
    expect(mockSentry.setUser).toHaveBeenLastCalledWith(null);
    expect(mockPosthog.reset).toHaveBeenCalled();
  });

  it('sends sanitized events with the current screen and turns a rage tap into $rageclick', () => {
    observability.trackScreen('RobotaxiPrototype');
    observability.track('onboarding_step_viewed', { step: 'credentials', phone: '21999991234' });
    expect(mockPosthog.capture).toHaveBeenCalledWith('onboarding_step_viewed', { screen: 'RobotaxiPrototype', step: 'credentials' });

    observability.trackTouch(10, 10);
    observability.trackTouch(12, 11);
    observability.trackTouch(11, 9);
    expect(mockPosthog.capture).toHaveBeenLastCalledWith('$rageclick', { screen: 'RobotaxiPrototype' });
  });

  it('stops usage events after the person opts out, and remembers it', async () => {
    await observability.setAnalyticsEnabled(false);
    observability.track('anything');
    expect(mockPosthog.optOut).toHaveBeenCalled();
    expect(mockPosthog.capture).not.toHaveBeenCalled();
    expect(await AsyncStorage.getItem('leaf:analytics-opt-out:v1')).toBe('true');
    expect(await observability.loadAnalyticsPreference()).toBe(false);

    await observability.setAnalyticsEnabled(true);
    expect(mockPosthog.optIn).toHaveBeenCalled();
    expect(await observability.loadAnalyticsPreference()).toBe(true);
  });
});
