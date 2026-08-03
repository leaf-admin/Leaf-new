import React from 'react';
import { act } from 'react-test-renderer';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Alert } from 'react-native';

import WooviPaymentModal, {
  getQaPaymentProgressLabel,
} from '../src/components/payment/WooviPaymentModal';
import WooviService from '../src/services/WooviService';
import Logger from '../src/utils/Logger';
import {
  buildRidePaymentContextKey,
  getOrCreateRidePaymentSession,
  saveRidePaymentSessionData,
} from '../src/services/RidePaymentSessionService';

jest.useFakeTimers();

let mockFirebaseCurrentUserUid = 'passenger_1';

jest.mock('../src/utils/Logger', () => ({
  log: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

jest.mock('expo-clipboard', () => ({
  setStringAsync: jest.fn(),
}));

jest.mock('react-native-elements', () => ({
  Icon: () => null,
}));

jest.mock('react-native-qrcode-svg', () => 'QRCode');

jest.mock('@react-native-firebase/auth', () => () => ({
  currentUser: mockFirebaseCurrentUserUid
    ? { uid: mockFirebaseCurrentUserUid }
    : null,
}));

jest.mock('../src/components/design-system/robotaxiPrototypeTokens', () => ({
  color: {
    bg: { panel: '#fff', canvas: '#f6f6f6' },
    text: { primary: '#111', secondary: '#666', muted: '#999' },
    accent: { primary: '#0a0' },
    surface: { primary: '#fff', secondary: '#f8f8f8', elevated: '#fff', panel: '#fff' },
    border: { subtle: '#ddd', separator: '#e5e5e5' },
    semantic: { success: '#0a0', danger: '#a00', warning: '#aa0' },
    feedback: { success: '#0a0', danger: '#a00' },
    shadow: { base: '#000' },
  },
  typography: {
    subtitle: { size: 18, lineHeight: 24 },
    body: { size: 14, lineHeight: 20 },
    caption: { size: 12, lineHeight: 16 },
    micro: { size: 10, lineHeight: 14 },
  },
  radius: { lg: 18, md: 14, sm: 10, pill: 999 },
  spacing: { xxs: 4, xs: 6, sm: 8, md: 12, lg: 16, xl: 20 },
  elevation: {
    card: { shadowOpacity: 0, shadowRadius: 0, shadowOffset: { width: 0, height: 0 }, elevation: 0 },
    panel: { shadowOpacity: 0, shadowRadius: 0, shadowOffset: { width: 0, height: 0 }, elevation: 0 },
    soft: { shadowOpacity: 0, shadowRadius: 0, shadowOffset: { width: 0, height: 0 }, elevation: 0 },
  },
}));

jest.mock('../src/theme/runtimeTokens', () => ({
  fonts: {
    Regular: 'System',
    Medium: 'System',
    SemiBold: 'System',
    Bold: 'System',
  },
}));

jest.mock('../src/services/WebSocketManager', () => ({
  getInstance: jest.fn(() => ({
    on: jest.fn(),
    off: jest.fn(),
  })),
}));

jest.mock('../src/services/PaymentBypassService', () => ({
  shouldUseBypass: jest.fn().mockResolvedValue(false),
}));

jest.mock('../src/config/runtimeAccessPolicy', () => ({
  allowForcedPaymentBypass: jest.fn(() => false),
  allowTestUserTools: jest.fn(() => true),
  isE2ETestBuild: jest.fn(() => true),
  isSimulatorBuild: jest.fn(() => true),
}));

jest.mock('../src/services/WooviService', () => ({
  simulateTestWebhook: jest.fn(),
  getPaymentStatus: jest.fn(),
  processAdvancePayment: jest.fn(),
  resolvePaymentRuntimeProfile: jest.fn(),
  cancelPayment: jest.fn(),
}));

describe('WooviPaymentModal qaAutoConfirm', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    jest.clearAllTimers();
    const runtimeAccessPolicy = jest.requireMock('../src/config/runtimeAccessPolicy');
    runtimeAccessPolicy.allowTestUserTools.mockReturnValue(true);
    runtimeAccessPolicy.isE2ETestBuild.mockReturnValue(true);
    runtimeAccessPolicy.isSimulatorBuild.mockReturnValue(true);
    mockFirebaseCurrentUserUid = 'passenger_1';
    WooviService.resolvePaymentRuntimeProfile.mockResolvedValue({
      success: true,
      provider: 'woovi',
      defaultEnvironment: 'production',
      canarySandboxEnabled: true,
      globalSandboxEnabled: false,
      effectiveProfile: {
        profileId: 'qa-test-users-sandbox-durable',
        environment: 'sandbox',
        scope: 'users',
      },
    });
    await AsyncStorage.clear();
  });

  afterEach(() => {
    jest.clearAllTimers();
  });

  const buildTestJwt = (payload = {}) => {
    const encode = (value) =>
      Buffer.from(JSON.stringify(value))
        .toString('base64')
        .replace(/=/g, '')
        .replace(/\+/g, '-')
        .replace(/\//g, '_');
    return `${encode({ alg: 'RS256', typ: 'JWT' })}.${encode(payload)}.signature`;
  };

  it('maps internal QA payment states to user-facing copy', () => {
    expect(getQaPaymentProgressLabel('awaiting_backend')).toBe('Confirmando pagamento');
    expect(getQaPaymentProgressLabel('webhook_error')).toBe('Aguardando confirmação');
    expect(getQaPaymentProgressLabel('unknown_internal_state')).toBe('Aguardando pagamento');
    expect(getQaPaymentProgressLabel('awaiting_backend')).not.toContain('awaiting_backend');
  });

  it('reopens the persisted charge without creating a second Pix charge', async () => {
    WooviService.processAdvancePayment.mockResolvedValue({
      success: true,
      chargeId: 'charge_persisted_1',
      paymentIntentId: 'intent_persisted_1',
      rideId: 'temp_ride_canonical_1',
      paymentSessionId: 'pay_session_persisted_1',
      qrCodeText: 'pix-code',
      paymentLink: 'https://pay.local/persisted',
    });
    WooviService.getPaymentStatus.mockResolvedValue({
      success: true,
      status: 'ACTIVE',
    });

    const props = {
      visible: true,
      onClose: jest.fn(),
      onPaymentConfirmed: jest.fn(),
      tripData: {
        pickup: { add: 'Origem', lat: -22.920775, lng: -43.406003 },
        drop: { add: 'Destino', lat: -22.9673111, lng: -43.1789541 },
        carType: 'Leaf Plus',
        estimatedFare: 76.9,
        grossEstimatedFare: 76.9,
      },
      estimates: { estimateFare: 76.9 },
      passengerId: 'passenger_1',
	      passengerName: 'Passageira Leaf',
	      passengerEmail: 'passageira@leaf.app.br',
	      quoteSessionId: 'quote_session_1',
	      quoteLockId: 'ql_persisted_1',
	    };

    const firstRender = render(<WooviPaymentModal {...props} />);
    await act(async () => {
      jest.advanceTimersByTime(200);
      await Promise.resolve();
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(WooviService.processAdvancePayment).toHaveBeenCalledTimes(1);
    });
    expect(WooviService.processAdvancePayment).toHaveBeenCalledWith(
      expect.objectContaining({
        pickupLocation: { add: 'Origem', lat: -22.920775, lng: -43.406003 },
        destinationLocation: { add: 'Destino', lat: -22.9673111, lng: -43.1789541 },
        carType: 'Leaf Plus',
        vehicle: 'Leaf Plus',
	        rideDetails: expect.objectContaining({
	          pickupLocation: { add: 'Origem', lat: -22.920775, lng: -43.406003 },
	          destinationLocation: { add: 'Destino', lat: -22.9673111, lng: -43.1789541 },
	          carType: 'Leaf Plus',
	          quoteLockId: 'ql_persisted_1',
	        }),
	        quoteLockId: 'ql_persisted_1',
	      })
	    );
    firstRender.unmount();

    render(<WooviPaymentModal {...props} />);
    await act(async () => {
      jest.advanceTimersByTime(200);
      await Promise.resolve();
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(WooviService.getPaymentStatus).toHaveBeenCalledWith('charge_persisted_1');
    });
    expect(WooviService.processAdvancePayment).toHaveBeenCalledTimes(1);
  });

  it('advances with a confirmed persisted charge after the app missed the socket event', async () => {
    WooviService.processAdvancePayment.mockResolvedValue({
      success: true,
      chargeId: 'charge_confirmed_recovery',
      paymentIntentId: 'intent_confirmed_recovery',
      rideId: 'temp_ride_confirmed_recovery',
      paymentSessionId: 'pay_session_confirmed_recovery',
      paymentLink: 'https://pay.local/confirmed-recovery',
    });
    WooviService.getPaymentStatus.mockResolvedValue({
      success: true,
      status: 'in_holding',
    });
    const onPaymentConfirmed = jest.fn();
    const props = {
      visible: true,
      onClose: jest.fn(),
      onPaymentConfirmed,
      tripData: {
        pickup: { add: 'Origem', lat: -22.920775, lng: -43.406003 },
        drop: { add: 'Destino', lat: -22.9673111, lng: -43.1789541 },
        carType: 'Leaf Plus',
        estimatedFare: 76.9,
        grossEstimatedFare: 76.9,
      },
      estimates: { estimateFare: 76.9 },
      passengerId: 'passenger_1',
	      passengerName: 'Passageira Leaf',
	      passengerEmail: 'passageira@leaf.app.br',
	      quoteSessionId: 'quote_session_1',
	      quoteLockId: 'ql_confirmed_recovery',
	    };

    const firstRender = render(<WooviPaymentModal {...props} />);
    await act(async () => {
      jest.advanceTimersByTime(200);
      await Promise.resolve();
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(WooviService.processAdvancePayment).toHaveBeenCalledTimes(1);
    });
    firstRender.unmount();

    render(<WooviPaymentModal {...props} />);
    await act(async () => {
      jest.advanceTimersByTime(700);
      await Promise.resolve();
      await Promise.resolve();
    });
    await waitFor(() => {
        expect(onPaymentConfirmed).toHaveBeenCalledWith(
          expect.objectContaining({
            chargeId: 'charge_confirmed_recovery',
            rideId: 'temp_ride_confirmed_recovery',
            paymentSessionId: expect.stringMatching(/^pay_/),
            quoteSessionId: 'quote_session_1',
            quoteLockId: 'ql_confirmed_recovery',
          }),
        );
    });
    expect(WooviService.processAdvancePayment).toHaveBeenCalledTimes(1);
  });

  it('waits for backend payment confirmation before advancing the ride flow', async () => {
    WooviService.simulateTestWebhook.mockResolvedValue({
      success: true,
      message: 'Webhook de teste processado com sucesso',
    });
    WooviService.getPaymentStatus
      .mockResolvedValueOnce({
        success: true,
        status: 'ACTIVE',
      })
      .mockResolvedValueOnce({
        success: true,
        status: 'in_holding',
      });

    const onPaymentConfirmed = jest.fn();
    const onClose = jest.fn();

    const screen = render(
      <WooviPaymentModal
        visible
        onClose={onClose}
        onPaymentConfirmed={onPaymentConfirmed}
        tripData={{
          rideId: 'temp_ride_123',
          pickup: { add: 'Origem' },
          drop: { add: 'Destino' },
          carType: 'Leaf Plus',
          estimatedFare: 13.42,
        }}
        estimates={{ estimateFare: 13.42 }}
        passengerId="passenger_1"
        passengerName="Passageira Leaf"
        passengerEmail="passageira@leaf.app.br"
        prefilledPaymentData={{
          chargeId: 'charge_123',
          paymentIntentId: 'intent_123',
          rideId: 'temp_ride_123',
          paymentSessionId: 'pay_session_prefilled_123',
          paymentContextKey: 'ride-payment-v1|prefilled',
          quoteSessionId: 'quote_session_prefilled_123',
          quoteLockId: 'ql_prefilled_123',
          amount: 13.42,
          amountInCents: 1342,
          qrCodeText: 'pix-code',
        }}
        qaAutoConfirm
      />,
    );

    await waitFor(() => {
      expect(WooviService.simulateTestWebhook).not.toHaveBeenCalled();
    });

    await act(async () => {
      jest.advanceTimersByTime(900);
    });

    await waitFor(() => {
      expect(WooviService.simulateTestWebhook).toHaveBeenCalledWith(
        expect.objectContaining({
          chargeId: 'charge_123',
          paymentIntentId: 'intent_123',
          rideId: 'temp_ride_123',
          passengerId: 'passenger_1',
          amountInCents: 1342,
        }),
      );
      expect(WooviService.getPaymentStatus).toHaveBeenCalledWith('charge_123');
      expect(screen.UNSAFE_getByProps({ testID: 'payment-modal-qa-debug' }).props.children).toMatch(
        /^(Confirmando pagamento|Pagamento confirmado)$/,
      );
    });
    expect(
      screen.UNSAFE_getByProps({ testID: 'payment-modal-qa-debug' }).props.accessibilityLabel,
    ).toMatch(
      /^(Confirmando pagamento|Pagamento confirmado)$/,
    );
    expect(screen.queryByText(/awaiting_backend/i)).toBeNull();
    expect(screen.queryByText(/^QA\b/i)).toBeNull();

    expect(onPaymentConfirmed).not.toHaveBeenCalled();

    await act(async () => {
      jest.advanceTimersByTime(3000);
    });

    await waitFor(() => {
      expect(WooviService.getPaymentStatus).toHaveBeenCalledTimes(2);
      expect(WooviService.getPaymentStatus).not.toHaveBeenCalledWith('temp_ride_123');
      expect(onPaymentConfirmed).toHaveBeenCalledWith(
        expect.objectContaining({
          chargeId: 'charge_123',
          rideId: 'temp_ride_123',
          paymentSessionId: 'pay_session_prefilled_123',
          paymentContextKey: 'ride-payment-v1|prefilled',
          quoteSessionId: 'quote_session_prefilled_123',
          quoteLockId: 'ql_prefilled_123',
          amount: 13.42,
          amountInCents: 1342,
        }),
      );
    });

    await act(async () => {
      jest.advanceTimersByTime(2500);
    });

    expect(onClose).toHaveBeenCalledWith({
      reason: 'confirmed',
      chargeId: 'charge_123',
      rideId: 'temp_ride_123',
    });
  });

  it('keeps status polling failures silent while payment remains pending', async () => {
    WooviService.getPaymentStatus.mockRejectedValue(new Error('status unavailable'));

    render(
      <WooviPaymentModal
        visible
        onClose={jest.fn()}
        onPaymentConfirmed={jest.fn()}
        tripData={{
          pickup: { add: 'Origem' },
          drop: { add: 'Destino' },
          carType: 'Leaf Plus',
          estimatedFare: 13.42,
        }}
        estimates={{ estimateFare: 13.42 }}
        passengerId="passenger_1"
        passengerName="Passageira Leaf"
        passengerEmail="passageira@leaf.app.br"
        prefilledPaymentData={{
          chargeId: 'charge_polling_unavailable',
          paymentIntentId: 'intent_polling_unavailable',
          rideId: 'temp_ride_polling_unavailable',
          amount: 13.42,
          amountInCents: 1342,
          qrCodeText: 'pix-code',
        }}
      />,
    );

    await waitFor(() => {
      expect(WooviService.getPaymentStatus).toHaveBeenCalledWith(
        'charge_polling_unavailable',
      );
    });

    expect(Logger.error).not.toHaveBeenCalled();
    expect(Logger.debug).toHaveBeenCalledWith(
      expect.stringContaining('Verificação silenciosa indisponível'),
      expect.objectContaining({
        chargeId: 'charge_polling_unavailable',
        paymentStatus: 'pending',
      }),
    );
  });

  it('retries transient Pix creation failures with the same payment session', async () => {
    const transientError = new Error('Network Error');
    transientError.code = 'ERR_NETWORK';
    WooviService.processAdvancePayment
      .mockRejectedValueOnce(transientError)
      .mockResolvedValueOnce({
        success: true,
        chargeId: 'charge_retry_success',
        paymentIntentId: 'intent_retry_success',
        rideId: 'temp_ride_retry_success',
        qrCodeText: 'pix-code-retry',
        paymentLink: 'https://pay.local/retry',
      });

    const screen = render(
      <WooviPaymentModal
        visible
        onClose={jest.fn()}
        onPaymentConfirmed={jest.fn()}
        tripData={{
          pickup: { add: 'Origem', lat: -22.920775, lng: -43.406003 },
          drop: { add: 'Destino', lat: -22.9673111, lng: -43.1789541 },
          carType: 'Leaf Plus',
          estimatedFare: 52.22,
          grossEstimatedFare: 52.22,
        }}
        estimates={{ estimateFare: 52.22 }}
        passengerId="passenger_1"
        passengerName="Passageira Leaf"
        passengerEmail="passageira@leaf.app.br"
        quoteSessionId="quote_session_retry"
        quoteLockId="ql_retry"
      />,
    );

    await act(async () => {
      jest.advanceTimersByTime(200);
      await Promise.resolve();
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(WooviService.processAdvancePayment).toHaveBeenCalledTimes(1);
    });

    await act(async () => {
      jest.advanceTimersByTime(700);
      await Promise.resolve();
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(WooviService.processAdvancePayment).toHaveBeenCalledTimes(2);
      expect(screen.getByText('Pague com PIX')).toBeTruthy();
    });

    const [firstPayload] = WooviService.processAdvancePayment.mock.calls[0];
    const [secondPayload] = WooviService.processAdvancePayment.mock.calls[1];
    expect(secondPayload.paymentSessionId).toBe(firstPayload.paymentSessionId);
    expect(secondPayload.rideId).toBe(firstPayload.rideId);
    expect(secondPayload.quoteLockId).toBe('ql_retry');
  });

  it('advances an open Pix modal as soon as the backend status is already in holding', async () => {
    WooviService.processAdvancePayment.mockResolvedValue({
      success: true,
      chargeId: 'charge_open_confirmed',
      paymentIntentId: 'intent_open_confirmed',
      rideId: 'temp_ride_open_confirmed',
      qrCodeText: 'pix-code-open-confirmed',
      paymentLink: 'https://pay.local/open-confirmed',
    });
    WooviService.getPaymentStatus.mockResolvedValue({
      success: true,
      status: 'in_holding',
      source: 'payment_status_cache',
      amount: 5115,
    });
    const onPaymentConfirmed = jest.fn();

    render(
      <WooviPaymentModal
        visible
        onClose={jest.fn()}
        onPaymentConfirmed={onPaymentConfirmed}
        tripData={{
          pickup: { add: 'Origem', lat: -22.920775, lng: -43.406003 },
          drop: { add: 'Destino', lat: -22.9673111, lng: -43.1789541 },
          carType: 'Leaf Plus',
          estimatedFare: 51.15,
          grossEstimatedFare: 51.15,
        }}
        estimates={{ estimateFare: 51.15 }}
        passengerId="passenger_1"
        passengerName="Passageira Leaf"
        passengerEmail="passageira@leaf.app.br"
        quoteSessionId="quote_session_open_confirmed"
        quoteLockId="ql_open_confirmed"
      />,
    );

    await act(async () => {
      jest.advanceTimersByTime(200);
      await Promise.resolve();
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(WooviService.getPaymentStatus).toHaveBeenCalledWith('charge_open_confirmed');
    });

    await act(async () => {
      jest.advanceTimersByTime(400);
      await Promise.resolve();
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(onPaymentConfirmed).toHaveBeenCalledWith(
        expect.objectContaining({
          chargeId: 'charge_open_confirmed',
          rideId: 'temp_ride_open_confirmed',
          amount: 51.15,
          amountInCents: 5115,
          quoteSessionId: 'quote_session_open_confirmed',
          quoteLockId: 'ql_open_confirmed',
        }),
      );
    });
  });

  it('shows the Pix timeout alert only once when timeout callbacks overlap', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    const onPaymentExpired = jest.fn();
    WooviService.getPaymentStatus.mockResolvedValue({
      success: true,
      status: 'ACTIVE',
    });
    WooviService.processAdvancePayment.mockResolvedValue({
      success: true,
      chargeId: 'charge_timeout_once',
      paymentIntentId: 'intent_timeout_once',
      rideId: 'temp_ride_timeout_once',
      qrCodeText: 'pix-code-timeout',
      paymentLink: 'https://pay.local/timeout',
    });

    const screen = render(
      <WooviPaymentModal
        visible
        onClose={jest.fn()}
        onPaymentExpired={onPaymentExpired}
        onPaymentConfirmed={jest.fn()}
        tripData={{
          pickup: { add: 'Origem', lat: -22.920775, lng: -43.406003 },
          drop: { add: 'Destino', lat: -22.9673111, lng: -43.1789541 },
          carType: 'Leaf Plus',
          estimatedFare: 52.22,
          grossEstimatedFare: 52.22,
        }}
        estimates={{ estimateFare: 52.22 }}
        passengerId="passenger_1"
        passengerName="Passageira Leaf"
        passengerEmail="passageira@leaf.app.br"
        quoteSessionId="quote_session_timeout_once"
        quoteLockId="ql_timeout_once"
      />,
    );

    await act(async () => {
      jest.advanceTimersByTime(200);
      await Promise.resolve();
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(WooviService.processAdvancePayment).toHaveBeenCalledTimes(1);
    });

    await act(async () => {
      jest.advanceTimersByTime(300000);
      await Promise.resolve();
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(alertSpy).toHaveBeenCalledTimes(1);
      expect(alertSpy).toHaveBeenCalledWith(
        '⏰ Tempo Esgotado',
        'O tempo para realizar o pagamento expirou. Faça uma nova cotação para continuar.',
        expect.any(Array),
      );
    });
    expect(onPaymentExpired).toHaveBeenCalledTimes(1);
    expect(onPaymentExpired).toHaveBeenCalledWith(
      expect.objectContaining({
        reason: 'timeout',
        chargeId: 'charge_timeout_once',
      }),
    );

    const [, , actions] = alertSpy.mock.calls[0];
    await act(async () => {
      actions[0].onPress();
      await Promise.resolve();
    });

    expect(onPaymentExpired).toHaveBeenCalledTimes(1);
    expect(WooviService.processAdvancePayment).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('Gerando cobrança PIX...')).toBeNull();

    alertSpy.mockRestore();
  });

  it('does not show a stale Pix timeout alert after the modal closes', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    WooviService.getPaymentStatus.mockResolvedValue({
      success: true,
      status: 'ACTIVE',
    });
    WooviService.processAdvancePayment.mockResolvedValue({
      success: true,
      chargeId: 'charge_timeout_closed',
      paymentIntentId: 'intent_timeout_closed',
      rideId: 'temp_ride_timeout_closed',
      qrCodeText: 'pix-code-timeout-closed',
      paymentLink: 'https://pay.local/timeout-closed',
    });

    const props = {
      visible: true,
      onClose: jest.fn(),
      onPaymentConfirmed: jest.fn(),
      tripData: {
        pickup: { add: 'Origem', lat: -22.920775, lng: -43.406003 },
        drop: { add: 'Destino', lat: -22.9673111, lng: -43.1789541 },
        carType: 'Leaf Plus',
        estimatedFare: 52.22,
        grossEstimatedFare: 52.22,
      },
      estimates: { estimateFare: 52.22 },
      passengerId: 'passenger_1',
      passengerName: 'Passageira Leaf',
      passengerEmail: 'passageira@leaf.app.br',
      quoteSessionId: 'quote_session_timeout_closed',
      quoteLockId: 'ql_timeout_closed',
    };

    const screen = render(<WooviPaymentModal {...props} />);

    await act(async () => {
      jest.advanceTimersByTime(200);
      await Promise.resolve();
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(WooviService.processAdvancePayment).toHaveBeenCalledTimes(1);
    });

    screen.rerender(<WooviPaymentModal {...props} visible={false} />);

    await act(async () => {
      jest.advanceTimersByTime(301000);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(alertSpy).not.toHaveBeenCalled();
    alertSpy.mockRestore();
  });

  it('does not resurrect a locally expired persisted Pix charge', async () => {
    const tripData = {
      pickup: { add: 'Origem', lat: -22.920775, lng: -43.406003 },
      drop: { add: 'Destino', lat: -22.9673111, lng: -43.1789541 },
      carType: 'Leaf Plus',
      estimatedFare: 52.22,
      grossEstimatedFare: 52.22,
    };
    const contextKey = buildRidePaymentContextKey({
      tripData,
      amountInCents: 5222,
      grossAmountInCents: 5222,
    });
    const expiredSession = await getOrCreateRidePaymentSession({
      passengerId: 'passenger_1',
      contextKey,
    });
    await saveRidePaymentSessionData({
      passengerId: 'passenger_1',
      contextKey,
      paymentSessionId: expiredSession.paymentSessionId,
      paymentData: {
        chargeId: 'charge_expired_local',
        paymentIntentId: 'intent_expired_local',
        rideId: 'temp_ride_expired_local',
        amount: 52.22,
        amountInCents: 5222,
        grossAmountInCents: 5222,
        quoteLockId: 'ql_expired_local',
        expiresAt: new Date(Date.now() - 1000).toISOString(),
      },
    });
    WooviService.getPaymentStatus.mockResolvedValue({
      success: true,
      status: 'ACTIVE',
    });
    WooviService.processAdvancePayment.mockResolvedValue({
      success: true,
      chargeId: 'charge_new_after_expired_local',
      paymentIntentId: 'intent_new_after_expired_local',
      rideId: 'temp_ride_new_after_expired_local',
      qrCodeText: 'pix-code-new',
      paymentLink: 'https://pay.local/new-after-expired',
    });

    render(
      <WooviPaymentModal
        visible
        onClose={jest.fn()}
        onPaymentConfirmed={jest.fn()}
        tripData={tripData}
        estimates={{ estimateFare: 52.22 }}
        passengerId="passenger_1"
        passengerName="Passageira Leaf"
        passengerEmail="passageira@leaf.app.br"
        quoteSessionId="quote_session_after_expired"
        quoteLockId="ql_after_expired"
      />,
    );

    await act(async () => {
      jest.advanceTimersByTime(200);
      await Promise.resolve();
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(WooviService.getPaymentStatus).toHaveBeenCalledWith('charge_expired_local');
      expect(WooviService.processAdvancePayment).toHaveBeenCalledTimes(1);
    });

    const [payload] = WooviService.processAdvancePayment.mock.calls[0];
    expect(payload.paymentSessionId).not.toBe(expiredSession.paymentSessionId);
    expect(payload.rideId).not.toBe('temp_ride_expired_local');
    expect(payload.quoteLockId).toBe('ql_after_expired');
  });

  it('fails closed before creating Pix when authenticated user does not match the passenger', async () => {
    const runtimeAccessPolicy = jest.requireMock('../src/config/runtimeAccessPolicy');
    runtimeAccessPolicy.allowTestUserTools.mockReturnValue(false);
    runtimeAccessPolicy.isE2ETestBuild.mockReturnValue(false);
    runtimeAccessPolicy.isSimulatorBuild.mockReturnValue(false);
    await AsyncStorage.setItem('@test_mode', 'true');
    await AsyncStorage.setItem('@auth_uid', 'other_passenger');
    await AsyncStorage.setItem(
      '@qa_socket_id_token',
      buildTestJwt({
        sub: 'other_passenger',
        user_id: 'other_passenger',
        exp: Math.floor(Date.now() / 1000) + 3600,
      }),
    );

    const screen = render(
      <WooviPaymentModal
        visible
        onClose={jest.fn()}
        onPaymentConfirmed={jest.fn()}
        tripData={{
          pickup: { add: 'Origem', lat: -22.920775, lng: -43.406003 },
          drop: { add: 'Destino', lat: -22.9673111, lng: -43.1789541 },
          carType: 'Leaf Plus',
          estimatedFare: 52.22,
          grossEstimatedFare: 52.22,
        }}
        estimates={{ estimateFare: 52.22 }}
        passengerId="other_passenger"
        passengerName="Passageira Leaf"
        passengerEmail="passageira@leaf.app.br"
        quoteSessionId="quote_session_identity"
        quoteLockId="ql_identity"
      />,
    );

    await act(async () => {
      jest.advanceTimersByTime(200);
      await Promise.resolve();
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(screen.getByText('Sua sessão mudou. Entre novamente para gerar o Pix desta corrida.')).toBeTruthy();
    });
    expect(WooviService.processAdvancePayment).not.toHaveBeenCalled();
    expect(screen.getByLabelText(/code=PAYMENT_PASSENGER_SCOPE_MISMATCH/)).toBeTruthy();
  });

  it('uses signed QA identity when Firebase currentUser belongs to another simulator profile', async () => {
    mockFirebaseCurrentUserUid = 'driver_1';
    await AsyncStorage.setItem('@test_mode', 'true');
    await AsyncStorage.setItem('@auth_uid', 'passenger_qa_1');
    await AsyncStorage.setItem(
      '@qa_socket_id_token',
      buildTestJwt({
        sub: 'passenger_qa_1',
        user_id: 'passenger_qa_1',
        exp: Math.floor(Date.now() / 1000) + 3600,
      }),
    );

    WooviService.processAdvancePayment.mockResolvedValue({
      success: true,
      chargeId: 'charge_qa_identity_1',
      paymentIntentId: 'intent_qa_identity_1',
      rideId: 'temp_ride_qa_identity_1',
      paymentSessionId: 'pay_session_qa_identity_1',
      qrCodeText: 'pix-code',
      paymentLink: 'https://pay.local/qa-identity',
    });

    render(
      <WooviPaymentModal
        visible
        onClose={jest.fn()}
        onPaymentConfirmed={jest.fn()}
        tripData={{
          pickup: { add: 'Origem', lat: -22.857, lng: -43.309 },
          drop: { add: 'Destino', lat: -22.9976583, lng: -43.3581268 },
          carType: 'Leaf Plus',
          estimatedFare: 55.23,
          grossEstimatedFare: 55.23,
        }}
        estimates={{ estimateFare: 55.23 }}
        passengerId="passenger_qa_1"
        passengerName="Passageira QA"
        passengerEmail="passageira.qa@leaf.app.br"
        quoteSessionId="quote_session_qa_identity"
        quoteLockId="ql_qa_identity"
      />,
    );

    await act(async () => {
      jest.advanceTimersByTime(200);
      await Promise.resolve();
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(WooviService.processAdvancePayment).toHaveBeenCalledTimes(1);
    });
    expect(WooviService.processAdvancePayment).toHaveBeenCalledWith(
      expect.objectContaining({
        passengerId: 'passenger_qa_1',
        amount: 5523,
        quoteLockId: 'ql_qa_identity',
      }),
    );
  });

  it('uses Woovi sandbox instead of payment bypass when QA payment runtime profile is sandbox', async () => {
    const paymentBypassService = jest.requireMock('../src/services/PaymentBypassService');
    const runtimeAccessPolicy = jest.requireMock('../src/config/runtimeAccessPolicy');
    mockFirebaseCurrentUserUid = 'passenger_qa_1';
    await AsyncStorage.setItem('@test_mode', 'true');
    await AsyncStorage.setItem('@auth_uid', 'passenger_qa_1');
    await AsyncStorage.setItem(
      '@qa_socket_id_token',
      buildTestJwt({
        sub: 'passenger_qa_1',
        user_id: 'passenger_qa_1',
        exp: Math.floor(Date.now() / 1000) + 3600,
      }),
    );
    runtimeAccessPolicy.allowForcedPaymentBypass.mockReturnValueOnce(true);
    paymentBypassService.shouldUseBypass.mockResolvedValueOnce(true);
    WooviService.processAdvancePayment.mockResolvedValue({
      success: true,
      chargeId: 'charge_qa_sandbox_real_1',
      paymentIntentId: 'intent_qa_sandbox_real_1',
      rideId: 'temp_ride_qa_sandbox_real_1',
      paymentSessionId: 'pay_session_qa_sandbox_real_1',
      qrCodeText: 'pix-code',
      paymentLink: 'https://pay.local/qa-sandbox-real',
    });

    render(
      <WooviPaymentModal
        visible
        onClose={jest.fn()}
        onPaymentConfirmed={jest.fn()}
        tripData={{
          pickup: { add: 'Origem', lat: -22.857, lng: -43.309 },
          drop: { add: 'Destino', lat: -22.9976583, lng: -43.3581268 },
          carType: 'Leaf Plus',
          estimatedFare: 55.23,
          grossEstimatedFare: 55.23,
        }}
        estimates={{ estimateFare: 55.23 }}
        passengerId="passenger_qa_1"
        passengerName="Passageira QA"
        passengerEmail="passageira.qa@leaf.app.br"
        quoteSessionId="quote_session_qa_sandbox_real"
        quoteLockId="ql_qa_sandbox_real"
      />,
    );

    await act(async () => {
      jest.advanceTimersByTime(200);
      await Promise.resolve();
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(WooviService.processAdvancePayment).toHaveBeenCalledTimes(1);
    });
    expect(runtimeAccessPolicy.allowForcedPaymentBypass).not.toHaveBeenCalled();
    expect(paymentBypassService.shouldUseBypass).not.toHaveBeenCalled();
    expect(WooviService.processAdvancePayment).toHaveBeenCalledWith(
      expect.objectContaining({
        passengerId: 'passenger_qa_1',
        amount: 5523,
        quoteLockId: 'ql_qa_sandbox_real',
      }),
    );
  });

  it('fails closed before creating Pix when QA payment runtime profile is not sandbox', async () => {
    mockFirebaseCurrentUserUid = 'passenger_qa_1';
    await AsyncStorage.setItem('@test_mode', 'true');
    await AsyncStorage.setItem('@auth_uid', 'passenger_qa_1');
    await AsyncStorage.setItem(
      '@qa_socket_id_token',
      buildTestJwt({
        sub: 'passenger_qa_1',
        user_id: 'passenger_qa_1',
        exp: Math.floor(Date.now() / 1000) + 3600,
      }),
    );
    WooviService.resolvePaymentRuntimeProfile.mockResolvedValueOnce({
      success: true,
      provider: 'woovi',
      defaultEnvironment: 'production',
      canarySandboxEnabled: true,
      globalSandboxEnabled: false,
      effectiveProfile: {
        profileId: 'env-default',
        environment: 'production',
        scope: 'global',
      },
    });

    const screen = render(
      <WooviPaymentModal
        visible
        onClose={jest.fn()}
        onPaymentConfirmed={jest.fn()}
        tripData={{
          pickup: { add: 'Origem', lat: -22.857, lng: -43.309 },
          drop: { add: 'Destino', lat: -22.9976583, lng: -43.3581268 },
          carType: 'Leaf Plus',
          estimatedFare: 55.23,
          grossEstimatedFare: 55.23,
        }}
        estimates={{ estimateFare: 55.23 }}
        passengerId="passenger_qa_1"
        passengerName="Passageira QA"
        passengerEmail="passageira.qa@leaf.app.br"
        quoteSessionId="quote_session_qa_runtime"
        quoteLockId="ql_qa_runtime"
      />,
    );

    await act(async () => {
      jest.advanceTimersByTime(200);
      await Promise.resolve();
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(WooviService.resolvePaymentRuntimeProfile).toHaveBeenCalledWith(
        expect.objectContaining({
          passengerId: 'passenger_qa_1',
        }),
      );
      expect(WooviService.processAdvancePayment).not.toHaveBeenCalled();
      expect(screen.getByText(
        'Ambiente de pagamento QA não está em sandbox para este usuário. Verifique o perfil de pagamento antes de gerar o Pix.',
      )).toBeTruthy();
    });
    expect(screen.getByLabelText(/code=PAYMENT_QA_SANDBOX_PROFILE_REQUIRED/)).toBeTruthy();
  });

  it('fails closed before creating Pix when the locked quote is missing', async () => {
    const onPaymentAborted = jest.fn();
	    const screen = render(
	      <WooviPaymentModal
	        visible
	        onClose={jest.fn()}
	        onPaymentAborted={onPaymentAborted}
	        onPaymentConfirmed={jest.fn()}
	        tripData={{
	          rideId: 'temp_ride_missing_quote',
	          pickup: { add: 'Origem' },
	          drop: { add: 'Destino' },
	          carType: 'Leaf Plus',
	          estimatedFare: 13.42,
	        }}
	        estimates={{ estimateFare: 13.42 }}
	        passengerId="passenger_1"
	        passengerName="Passageira Leaf"
	        passengerEmail="passageira@leaf.app.br"
	        quoteSessionId="quote_session_missing_lock"
	      />,
	    );

	    await act(async () => {
	      jest.advanceTimersByTime(200);
	      await Promise.resolve();
	      await Promise.resolve();
	    });

	    await waitFor(() => {
	      expect(
	        WooviService.processAdvancePayment,
	      ).not.toHaveBeenCalled();
	      expect(screen.getByText(
	        'Cotação expirada ou ausente. Recalcule a tarifa antes de pagar.',
	      )).toBeTruthy();
	    });

	    fireEvent.press(screen.getByText('Fechar'));

	    expect(onPaymentAborted).toHaveBeenCalledWith(
	      expect.objectContaining({
	        reason: 'generation_failed',
	        error: 'Cotação expirada ou ausente. Recalcule a tarifa antes de pagar.',
	      }),
	    );
	  });

	  it('fails closed before creating Pix when the locked quote amount is missing', async () => {
	    const screen = render(
	      <WooviPaymentModal
	        visible
	        onClose={jest.fn()}
	        onPaymentConfirmed={jest.fn()}
	        tripData={{
	          rideId: 'temp_ride_missing_amount',
	          pickup: { add: 'Origem' },
	          drop: { add: 'Destino' },
	          carType: 'Leaf Plus',
	        }}
	        estimates={{}}
	        passengerId="passenger_1"
	        passengerName="Passageira Leaf"
	        passengerEmail="passageira@leaf.app.br"
	        quoteSessionId="quote_session_missing_amount"
	        quoteLockId="ql_missing_amount"
	      />,
	    );

	    await act(async () => {
	      jest.advanceTimersByTime(200);
	      await Promise.resolve();
	      await Promise.resolve();
	    });

	    await waitFor(() => {
	      expect(
	        WooviService.processAdvancePayment,
	      ).not.toHaveBeenCalled();
	      expect(screen.getByText(
	        'Valor da cotação indisponível. Recalcule a tarifa antes de pagar.',
	      )).toBeTruthy();
	    });
	  });

    it('keeps the Robotaxi Pix card to one visible decision before expansion', async () => {
      WooviService.getPaymentStatus.mockResolvedValue({ success: true, status: 'ACTIVE' });
      const screen = render(
        <WooviPaymentModal
          visible
          onClose={jest.fn()}
          onPaymentConfirmed={jest.fn()}
          tripData={{
            rideId: 'temp_ride_robotaxi_card',
            pickup: { add: 'Origem' },
            drop: { add: 'Destino' },
            carType: 'Leaf Plus',
            estimatedFare: 13.42,
          }}
          estimates={{ estimateFare: 13.42 }}
          passengerId="passenger_1"
          passengerName="Passageira Leaf"
          passengerEmail="passageira@leaf.app.br"
          prefilledPaymentData={{
            chargeId: 'charge_robotaxi_card',
            rideId: 'temp_ride_robotaxi_card',
            amount: 13.42,
            amountInCents: 1342,
            qrCodeText: 'pix-code',
          }}
          robotaxiLifecycleCard
        />,
      );

      await waitFor(() => {
        expect(screen.getByTestId('payment-modal-copy-code-button')).toBeTruthy();
      });
      expect(screen.queryByTestId('payment-modal-open-bank-button')).toBeNull();

      fireEvent.press(screen.getByTestId('payment-modal-more-options-button'));
      expect(screen.getByTestId('payment-modal-open-bank-button')).toBeTruthy();
    });
	});
