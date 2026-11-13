'use strict';

jest.mock('../../../utils/logger', () => ({ logStructured: jest.fn(), logError: jest.fn() }));

const push = require('../../../services/transactional-push');
const onboarding = require('../../../services/driver-onboarding-stalled-notify');
const { buildReviewQueueFields } = require('../../../services/driver-review-queue');

const ok = () => ({ sendNotificationToUser: jest.fn(async () => ({ success: true })) });

describe('textos', () => {
  it('valores em reais no formato brasileiro', () => {
    expect(push.brl(12345)).toBe('R$ 123,45');
    expect(push.buildWithdrawalProcessedPush({ withdrawalId: 'w1', amountCents: 5000 }).body)
      .toBe('R$ 50,00 foram enviados para sua chave Pix.');
    expect(push.buildRefundProcessedPush({ bookingId: 'b1', amountCents: 1990 }).body)
      .toContain('R$ 19,90');
  });

  it('resposta do suporte abre a conversa do chamado', () => {
    const payload = push.buildSupportReplyPush({ ticketId: 'T1', userType: 'driver' });
    expect(payload.data).toMatchObject({ type: 'support_reply', screen: 'RobotaxiPrototypeSupportThread' });
    expect(JSON.parse(payload.data.params)).toEqual({ ticketId: 'T1' });
  });
});

describe('notifySupportReply', () => {
  const makeRedis = () => {
    const keys = new Set();
    return { set: jest.fn(async (key) => (keys.has(key) ? null : (keys.add(key), 'OK'))) };
  };

  it('avisa o dono do chamado e agrupa respostas seguidas', async () => {
    const fcmService = ok();
    const redis = makeRedis();
    const ticket = { id: 'T1', userId: 'u1', userType: 'passenger' };
    await push.notifySupportReply(ticket, { redis, fcmService, env: {} });
    const second = await push.notifySupportReply(ticket, { redis, fcmService, env: {} });
    expect(fcmService.sendNotificationToUser).toHaveBeenCalledTimes(1);
    expect(fcmService.sendNotificationToUser).toHaveBeenCalledWith('u1', expect.objectContaining({ title: 'A equipe Leaf respondeu' }));
    expect(second.coalesced).toBe(true);
  });

  it('sandbox e chamado sem dono não recebem push', async () => {
    const fcmService = ok();
    await push.notifySupportReply({ id: 'T1', userId: 'u1', financialNamespace: 'sandbox' }, { redis: makeRedis(), fcmService, env: {} });
    await push.notifySupportReply({ id: 'T2' }, { redis: makeRedis(), fcmService, env: {} });
    expect(fcmService.sendNotificationToUser).not.toHaveBeenCalled();
  });
});

describe('saque e reembolso', () => {
  it('envia para o motorista e para o passageiro', async () => {
    const fcmService = ok();
    await push.notifyWithdrawalProcessed({ driverId: 'd1', withdrawalId: 'w1', amountCents: 100 }, { fcmService, env: {} });
    await push.notifyWithdrawalDelayed({ driverId: 'd1', withdrawalId: 'w1' }, { fcmService, env: {} });
    await push.notifyRefundProcessed({ passengerId: 'p1', bookingId: 'b1', amountCents: 100 }, { fcmService, env: {} });
    const types = fcmService.sendNotificationToUser.mock.calls.map(([, payload]) => payload.data.type);
    expect(types).toEqual(['withdrawal_processed', 'withdrawal_delayed', 'refund_processed']);
  });

  it('reembolso de sandbox, sem passageiro ou com a flag desligada não envia', async () => {
    const fcmService = ok();
    await push.notifyRefundProcessed({ passengerId: 'p1', bookingId: 'b1', amountCents: 100, namespace: 'sandbox' }, { fcmService, env: {} });
    await push.notifyRefundProcessed({ passengerId: null, bookingId: 'b1', amountCents: 100 }, { fcmService, env: {} });
    await push.notifyWithdrawalProcessed({ driverId: 'd1', withdrawalId: 'w1', amountCents: 1 }, { fcmService, env: { TRANSACTIONAL_PUSH_ENABLED: 'false' } });
    expect(fcmService.sendNotificationToUser).not.toHaveBeenCalled();
  });

  it('falha do FCM não lança', async () => {
    const fcmService = { sendNotificationToUser: jest.fn(async () => { throw new Error('fcm down'); }) };
    await expect(push.notifyWithdrawalProcessed({ driverId: 'd1', withdrawalId: 'w1', amountCents: 1 }, { fcmService, env: {} }))
      .resolves.toMatchObject({ success: false });
  });
});

describe('onboardingSince na fila', () => {
  const stalled = { documents: { all_documents: [] } };
  it('marca quando o cadastro para com o motorista e mantém enquanto continua parado', () => {
    const first = buildReviewQueueFields(stalled, {}, '2026-11-13T10:00:00.000Z');
    expect(first).toMatchObject({ reviewBucket: 'onboarding', onboardingSince: '2026-11-13T10:00:00.000Z' });
    const again = buildReviewQueueFields(stalled, first, '2026-11-14T10:00:00.000Z');
    expect(again.onboardingSince).toBe('2026-11-13T10:00:00.000Z');
    const review = buildReviewQueueFields({ activation: { canGoOnline: true } }, again);
    expect(review.onboardingSince).toBeNull();
  });
});

describe('lembrete de cadastro parado', () => {
  const now = Date.parse('2026-11-13T15:00:00Z');
  const hoursAgo = (h) => new Date(now - h * 3600000).toISOString();

  it('24 h e 72 h, no máximo 2, com 24 h entre eles', () => {
    expect(onboarding.planReminder({ onboardingSince: hoursAgo(10) }, now)).toBeNull();
    expect(onboarding.planReminder({ onboardingSince: hoursAgo(30) }, now)).toMatchObject({ kind: 'reminder_1', sent: 1 });

    const since = hoursAgo(80);
    // Antigo sem nenhum lembrete: manda só o primeiro agora, não os dois juntos.
    expect(onboarding.planReminder({ onboardingSince: since }, now)).toMatchObject({ kind: 'reminder_1' });
    expect(onboarding.planReminder({ onboardingSince: since, onboardingReminder: { since, sent: 1, lastSentAt: hoursAgo(2) } }, now)).toBeNull();
    expect(onboarding.planReminder({ onboardingSince: since, onboardingReminder: { since, sent: 1, lastSentAt: hoursAgo(25) } }, now))
      .toMatchObject({ kind: 'reminder_2', sent: 2 });
    expect(onboarding.planReminder({ onboardingSince: since, onboardingReminder: { since, sent: 2, lastSentAt: hoursAgo(30) } }, now)).toBeNull();
  });

  it('recomeça quando o motorista avança e volta a parar', () => {
    const plan = onboarding.planReminder({
      onboardingSince: hoursAgo(30),
      onboardingReminder: { since: hoursAgo(200), sent: 2, lastSentAt: hoursAgo(100) }
    }, now);
    expect(plan).toMatchObject({ kind: 'reminder_1', sent: 1 });
  });

  it('fica de fora: pronto para a facial, reprovado, aprovado, sandbox e parado há mais de 30 dias', () => {
    const base = { onboardingSince: hoursAgo(30) };
    expect(onboarding.planReminder({ ...base, activation: { state: 'APPROVED_NEEDS_LIVENESS' } }, now)).toBeNull();
    expect(onboarding.planReminder({ ...base, activation: { state: 'REJECTED' } }, now)).toBeNull();
    expect(onboarding.planReminder({ ...base, driver: { approved: true } }, now)).toBeNull();
    expect(onboarding.planReminder({ ...base, persistenceScope: { namespace: 'sandbox' } }, now)).toBeNull();
    expect(onboarding.planReminder({ onboardingSince: hoursAgo(31 * 24) }, now)).toBeNull();
  });

  it('sem onboardingSince usa a data do cadastro', () => {
    expect(onboarding.planReminder({ updatedAt: hoursAgo(30) }, now)).toMatchObject({ kind: 'reminder_1' });
  });

  it('ciclo: janela, consulta enxuta, grava antes de enviar e roda 1 vez por hora', async () => {
    const writes = [];
    const calls = {};
    const docs = [
      { id: 'd1', data: () => ({ onboardingSince: hoursAgo(30) }), ref: { set: jest.fn(async (v) => writes.push(['d1', v])) } },
      { id: 'd2', data: () => ({ onboardingSince: hoursAgo(5) }), ref: { set: jest.fn() } }
    ];
    const firestore = {
      collection: (name) => {
        calls.collection = name;
        return {
          where: (...args) => {
            calls.where = args;
            return { select: (...fields) => { calls.select = fields; return { limit: (n) => { calls.limit = n; return { get: async () => ({ docs }) }; } }; } };
          }
        };
      }
    };
    const sendPush = jest.fn(async () => ({ success: true }));
    onboarding.resetDriverOnboardingRemindersState();

    expect(await onboarding.maybeRunDriverOnboardingReminders({ firestore, env: {}, now: new Date('2026-11-13T11:00:00Z'), sendPush })).toBeNull();

    const summary = await onboarding.maybeRunDriverOnboardingReminders({ firestore, env: {}, now: new Date(now), sendPush });
    expect(summary).toEqual({ checked: 2, sent: 1 });
    expect(calls).toMatchObject({ collection: 'driver_applications', where: ['reviewBucket', '==', 'onboarding'], limit: 300 });
    expect(calls.select).toContain('onboardingSince');
    expect(writes[0][1].onboardingReminder).toMatchObject({ sent: 1, lastKind: 'reminder_1' });
    expect(sendPush).toHaveBeenCalledWith('d1', expect.objectContaining({ title: 'Seu cadastro está quase pronto' }));

    expect(await onboarding.maybeRunDriverOnboardingReminders({ firestore, env: {}, now: new Date(now + 10 * 60000), sendPush })).toBeNull();
  });
});
