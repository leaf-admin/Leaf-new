import { createAxiosInstance } from '../src/utils/axiosInterceptor';
import { shouldFallbackToSmsAfterWhatsAppFailure } from '../src/components/auth/otpDelivery';

jest.mock('../src/utils/Logger', () => ({
    __esModule: true,
    default: { log: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

const responseAdapter = (status, data) => (config) => Promise.reject(Object.assign(
    new Error(`Request failed with status code ${status}`),
    {
        code: status >= 500 ? 'ERR_BAD_RESPONSE' : 'ERR_BAD_REQUEST',
        config,
        isAxiosError: true,
        request: {},
        response: { status, data, headers: {}, config },
    },
));

const networkAdapter = (code, message) => (config) => Promise.reject(Object.assign(
    new Error(message),
    { code, config, isAxiosError: true, request: {} },
));

// The app only ever sees the error after the axios response interceptor wrapped it.
const failureThroughHttpClient = async (adapter) => {
    const client = createAxiosInstance({ baseURL: 'https://api.test', adapter });
    return client.post('/api/custom-otp/request-otp', { phone: '+5521999990000' })
        .then(() => { throw new Error('expected the request to fail'); }, (error) => error);
};

describe('shouldFallbackToSmsAfterWhatsAppFailure through the app http client', () => {
    it.each([
        [502, 'WHATSAPP_OTP_DELIVERY_FAILED'],
        [503, 'OTP_PROVIDER_NOT_CONFIGURED'],
        [504, undefined],
    ])('falls back to SMS on %i', async (status, code) => {
        const error = await failureThroughHttpClient(responseAdapter(status, { code }));
        expect(shouldFallbackToSmsAfterWhatsAppFailure(error)).toBe(true);
    });

    it.each([
        [429, 'OTP_RESEND_COOLDOWN'],
        [429, 'OTP_SEND_LIMIT'],
        [400, undefined],
        [500, undefined],
    ])('stays on WhatsApp on %i %s', async (status, code) => {
        const error = await failureThroughHttpClient(responseAdapter(status, { code }));
        expect(shouldFallbackToSmsAfterWhatsAppFailure(error)).toBe(false);
    });

    it.each([
        ['ECONNABORTED', 'timeout of 30000ms exceeded'],
        ['ERR_NETWORK', 'Network Error'],
    ])('falls back to SMS when the request gets no answer (%s)', async (code, message) => {
        const error = await failureThroughHttpClient(networkAdapter(code, message));
        expect(shouldFallbackToSmsAfterWhatsAppFailure(error)).toBe(true);
    });
});

describe('OTP backend answers through the app http client', () => {
    it.each([
        ['OTP_INVALID', 'Código inválido.'],
        ['OTP_EXPIRED', 'Código expirado. Peça um novo código.'],
    ])('keeps the text on originalError for OTPStep (%s)', async (code, text) => {
        const error = await failureThroughHttpClient(responseAdapter(400, { code, error: text }));
        expect(error.originalError.response.data.error).toBe(text);
    });

    it('shows a rate limit message on 429', async () => {
        const error = await failureThroughHttpClient(responseAdapter(429, {
            code: 'OTP_SEND_LIMIT',
            error: 'Muitos pedidos de código. Tente novamente mais tarde.',
        }));
        expect(error.message).toMatch(/muitas tentativas/i);
    });
});
