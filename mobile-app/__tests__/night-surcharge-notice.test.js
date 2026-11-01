import fs from 'fs';
import path from 'path';
import {
  buildNightSurchargeNotice,
  buildNightSurchargeSchedule,
  cancelOrphanNightSurchargeNotifications,
  claimNightSurchargeNotice,
  isNightSurchargeActive,
  isNightSurchargeNotification,
  nextNightSurchargeTransition,
  NIGHT_SURCHARGE_END_HOUR,
  NIGHT_SURCHARGE_NOTIFICATION_ID,
  NIGHT_SURCHARGE_RATE,
  NIGHT_SURCHARGE_START_HOUR,
  nightSurchargeNoticeSlot,
} from '../src/screens/prototype/nightSurchargeNotice';

// 23h em Brasília = 02h UTC.
const at = (iso) => new Date(iso);

describe('night surcharge notice', () => {
  it('uses the same rule as the server', () => {
    const server = fs.readFileSync(
      path.join(__dirname, '../../leaf-websocket-backend/services/pricing/nightSurcharge.js'),
      'utf8',
    );
    expect(server).toContain(`const NIGHT_SURCHARGE_RATE = ${NIGHT_SURCHARGE_RATE};`);
    expect(server).toContain(`const NIGHT_SURCHARGE_START_HOUR = ${NIGHT_SURCHARGE_START_HOUR};`);
    expect(server).toContain(`const NIGHT_SURCHARGE_END_HOUR = ${NIGHT_SURCHARGE_END_HOUR};`);
  });

  it('is active from 23h to 4h in Brasília', () => {
    expect(isNightSurchargeActive(at('2026-10-14T01:59:00Z'))).toBe(false); // 22:59
    expect(isNightSurchargeActive(at('2026-10-14T02:00:00Z'))).toBe(true); // 23:00
    expect(isNightSurchargeActive(at('2026-10-14T06:59:00Z'))).toBe(true); // 03:59
    expect(isNightSurchargeActive(at('2026-10-14T07:00:00Z'))).toBe(false); // 04:00
  });

  it('finds the next start and end', () => {
    expect(nextNightSurchargeTransition(at('2026-10-14T15:00:00Z'))).toEqual({
      kind: 'start',
      at: at('2026-10-15T02:00:00Z'),
    });
    expect(nextNightSurchargeTransition(at('2026-10-14T03:30:00Z'))).toEqual({
      kind: 'end',
      at: at('2026-10-14T07:00:00Z'),
    });
  });

  it('lands exactly on the hour even from an odd second', () => {
    expect(nextNightSurchargeTransition(at('2026-10-14T15:00:37Z')).at).toEqual(at('2026-10-15T02:00:00Z'));
  });

  it('tells the driver what changes', () => {
    expect(buildNightSurchargeNotice('start')).toEqual({
      type: 'night_surcharge_started',
      title: 'Adicional noturno começou',
      message: 'Corridas até as 4h valem +15%.',
    });
    expect(buildNightSurchargeNotice('end').title).toBe('Adicional noturno terminou');
    expect(buildNightSurchargeNotice('active').title).toBe('Adicional noturno ativo');
  });

  it('keeps one night together across midnight and the end at 4h', () => {
    const start = nightSurchargeNoticeSlot('start', at('2026-10-14T02:00:00Z')); // 23:00
    expect(nightSurchargeNoticeSlot('active', at('2026-10-14T06:59:00Z'))).toBe(start); // 03:59
    expect(nightSurchargeNoticeSlot('start', at('2026-10-15T02:00:00Z'))).not.toBe(start);
    expect(nightSurchargeNoticeSlot('end', at('2026-10-14T07:00:00Z'))).toBe(
      start.replace(':start', ':end'),
    );
  });

  it('announces once per night even after the app reopens', async () => {
    const values = {};
    const storage = {
      getItem: jest.fn(async (key) => values[key] ?? null),
      setItem: jest.fn(async (key, value) => {
        values[key] = value;
      }),
    };
    let claim;
    jest.isolateModules(() => {
      claim = require('../src/screens/prototype/nightSurchargeNotice').claimNightSurchargeNotice;
    });
    expect(await claim('start', storage, at('2026-10-20T02:00:00Z'))).toBe(true);
    expect(await claim('active', storage, at('2026-10-20T03:00:00Z'))).toBe(false);
    expect(await claim('end', storage, at('2026-10-20T07:00:00Z'))).toBe(true);

    // App reaberto: a memória zera e vale o que ficou salvo.
    jest.isolateModules(() => {
      claim = require('../src/screens/prototype/nightSurchargeNotice').claimNightSurchargeNotice;
    });
    expect(await claim('active', storage, at('2026-10-20T05:00:00Z'))).toBe(false);
    expect(await claim('start', storage, at('2026-10-21T02:00:00Z'))).toBe(true);
  });

  it('does not repeat when storage fails', async () => {
    const storage = { getItem: jest.fn().mockRejectedValue(new Error('off')), setItem: jest.fn() };
    const moment = at('2026-10-25T02:00:00Z');
    expect(await claimNightSurchargeNotice('start', storage, moment)).toBe(true);
    expect(await claimNightSurchargeNotice('active', storage, moment)).toBe(false);
  });

  it('schedules under a fixed id so a new schedule replaces the previous one', () => {
    const next = { kind: 'start', at: at('2026-10-15T02:00:00Z') };
    expect(buildNightSurchargeSchedule(next)).toEqual({
      identifier: NIGHT_SURCHARGE_NOTIFICATION_ID,
      content: {
        title: 'Adicional noturno começou',
        body: 'Corridas até as 4h valem +15%.',
        data: { type: 'night_surcharge_started' },
      },
      trigger: { type: 'date', date: next.at },
    });
  });

  it('cancels old schedules and leaves other notifications alone', async () => {
    const Notifications = {
      getAllScheduledNotificationsAsync: jest.fn().mockResolvedValue([
        { identifier: 'old-1', content: { data: { type: 'night_surcharge_started' } } },
        { identifier: 'old-2', content: { data: { type: 'night_surcharge_ended' } } },
        { identifier: NIGHT_SURCHARGE_NOTIFICATION_ID, content: { data: { type: 'night_surcharge_started' } } },
        { identifier: 'ride', content: { data: { type: 'ride_status' } } },
      ]),
      cancelScheduledNotificationAsync: jest.fn().mockResolvedValue(undefined),
    };
    await cancelOrphanNightSurchargeNotifications(Notifications);
    expect(Notifications.cancelScheduledNotificationAsync.mock.calls.map(([id]) => id)).toEqual([
      'old-1',
      'old-2',
    ]);
  });

  it('recognises its own notifications', () => {
    expect(isNightSurchargeNotification({ data: { type: 'night_surcharge_ended' } })).toBe(true);
    expect(isNightSurchargeNotification({ data: { type: 'new_ride' } })).toBe(false);
    expect(isNightSurchargeNotification(undefined)).toBe(false);
  });
});
