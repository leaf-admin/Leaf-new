'use strict';

jest.mock('../../../utils/logger', () => ({ logStructured: jest.fn(), logError: jest.fn() }));

const mockUsers = new Map();
jest.mock('../../../services/user-store', () => {
  const setPath = (target, path, value) => {
    const parts = path.split('/');
    let node = target;
    parts.slice(0, -1).forEach((part) => {
      node[part] = node[part] || {};
      node = node[part];
    });
    const last = parts[parts.length - 1];
    if (value === null) delete node[last];
    else node[last] = value;
  };
  return {
    readUserField: jest.fn(async (_fs, uid, field) => (mockUsers.get(uid) || {})[field] ?? null),
    updateUser: jest.fn(async (_fs, uid, patch) => {
      const user = mockUsers.get(uid) || {};
      Object.entries(patch).forEach(([key, value]) => setPath(user, key, value));
      mockUsers.set(uid, user);
    }),
    queryUsers: jest.fn(async (_fs, field, value) => Object.fromEntries(
      Array.from(mockUsers.entries()).filter(([, user]) => user[field] === value)
    ))
  };
});

const notify = require('../../../services/driver-ready-online-notify');

const READY = { state: 'APPROVED_NEEDS_LIVENESS', liveness: { passed: false }, kyc: {} };
const resolveLiveness = (user) => ({ passed: user?.liveness?.passed === true });

beforeEach(() => {
  mockUsers.clear();
  notify.resetDriverReadyRemindersState();
});

describe('maybeNotifyDriverReady', () => {
  it('avisa uma vez quando o cadastro fica pronto para a primeira validação facial', async () => {
    const sendPush = jest.fn(async () => ({ success: true }));
    const now = () => new Date('2026-11-13T15:00:00Z');
    const first = await notify.maybeNotifyDriverReady({ driverId: 'd1', canonicalState: READY, firestore: {}, env: {}, now, sendPush });
    const again = await notify.maybeNotifyDriverReady({ driverId: 'd1', canonicalState: READY, firestore: {}, env: {}, now, sendPush });

    expect(first).toEqual({ sent: true, status: 'notified' });
    expect(again.status).toBe('already_notified');
    expect(sendPush).toHaveBeenCalledTimes(1);
    expect(sendPush).toHaveBeenCalledWith('d1', 'ready');
    expect(mockUsers.get('d1')).toMatchObject({
      driverReadyReminderPending: true,
      driverReadyReminder: { readyAt: '2026-11-13T15:00:00.000Z', remindersSent: 0 }
    });
  });

  it('não avisa em outros estados, com facial já feita ou em revalidação', async () => {
    const sendPush = jest.fn();
    const cases = [
      { state: 'ACTIVE', liveness: { passed: true } },
      { state: 'DRIVER_DOCS_IN_REVIEW' },
      { ...READY, liveness: { passed: true } },
      { ...READY, kyc: { reverifyRequired: true } }
    ];
    for (const canonicalState of cases) {
      await notify.maybeNotifyDriverReady({ driverId: 'd1', canonicalState, firestore: {}, env: {}, sendPush });
    }
    expect(sendPush).not.toHaveBeenCalled();
  });

  it('desligado pela flag', async () => {
    const sendPush = jest.fn();
    const result = await notify.maybeNotifyDriverReady({
      driverId: 'd1', canonicalState: READY, firestore: {}, env: { DRIVER_READY_ONLINE_NOTIFY_ENABLED: 'false' }, sendPush
    });
    expect(result.status).toBe('not_ready');
    expect(sendPush).not.toHaveBeenCalled();
  });
});

describe('maybeRunDriverReadyReminders', () => {
  const pending = (readyAt, extra = {}) => ({
    driverReadyReminderPending: true,
    driverReadyReminder: { readyAt, remindersSent: 0 },
    driverActivation: { activationState: 'APPROVED_NEEDS_LIVENESS' },
    ...extra
  });
  const run = (iso, sendPush) => {
    notify.resetDriverReadyRemindersState();
    return notify.maybeRunDriverReadyReminders({ firestore: {}, env: {}, now: new Date(iso), sendPush, resolveLiveness });
  };

  it('fora da janela de 10h às 19h de Brasília não faz nada', async () => {
    mockUsers.set('d1', pending('2026-11-10T12:00:00Z'));
    const sendPush = jest.fn();
    expect(await run('2026-11-13T11:00:00Z', sendPush)).toBeNull(); // 8h BRT
    expect(await run('2026-11-13T22:30:00Z', sendPush)).toBeNull(); // 19h30 BRT
    expect(sendPush).not.toHaveBeenCalled();
  });

  it('manda o lembrete de 24 h, depois o de 72 h, e encerra', async () => {
    mockUsers.set('d1', pending('2026-11-12T14:00:00Z'));
    const sendPush = jest.fn(async () => ({ success: true }));

    await run('2026-11-12T20:00:00Z', sendPush); // 6 h depois: nada
    expect(sendPush).not.toHaveBeenCalled();

    await run('2026-11-13T15:00:00Z', sendPush); // 25 h depois
    expect(sendPush).toHaveBeenLastCalledWith('d1', 'reminder_1');

    await run('2026-11-14T15:00:00Z', sendPush); // 49 h: ainda não é o segundo
    expect(sendPush).toHaveBeenCalledTimes(1);

    await run('2026-11-15T15:00:00Z', sendPush); // 73 h
    expect(sendPush).toHaveBeenLastCalledWith('d1', 'reminder_2');
    expect(mockUsers.get('d1').driverReadyReminderPending).toBeUndefined();
    expect(mockUsers.get('d1').driverReadyReminder).toMatchObject({ remindersSent: 2, closedReason: 'reminders_exhausted' });

    await run('2026-11-20T15:00:00Z', sendPush);
    expect(sendPush).toHaveBeenCalledTimes(2);
  });

  it('para de lembrar quem já fez a validação facial ou saiu do estado', async () => {
    mockUsers.set('online', pending('2026-11-11T12:00:00Z', { liveness: { passed: true } }));
    mockUsers.set('docs', pending('2026-11-11T12:00:00Z', { driverActivation: { activationState: 'DRIVER_DOCS_PENDING' } }));
    const sendPush = jest.fn();
    const summary = await run('2026-11-13T15:00:00Z', sendPush);
    expect(summary).toMatchObject({ checked: 2, sent: 0, closed: 2 });
    expect(sendPush).not.toHaveBeenCalled();
    expect(mockUsers.get('online').driverReadyReminder.closedReason).toBe('left_ready_state');
  });

  it('roda no máximo uma vez por hora', async () => {
    mockUsers.set('d1', pending('2026-11-12T14:00:00Z'));
    const sendPush = jest.fn(async () => ({ success: true }));
    await run('2026-11-13T15:00:00Z', sendPush);
    const second = await notify.maybeRunDriverReadyReminders({
      firestore: {}, env: {}, now: new Date('2026-11-13T15:10:00Z'), sendPush, resolveLiveness
    });
    expect(second).toBeNull();
  });
});
