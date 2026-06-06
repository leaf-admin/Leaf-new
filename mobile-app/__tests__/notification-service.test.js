import { normalizeNotificationSnapshot } from '../src/services/canonical/notificationService';

const createSnapshot = (entries) => ({
  exists: () => entries.length > 0,
  forEach: (callback) => {
    entries.forEach(([key, value]) => callback({ key, val: () => value }));
  },
});

describe('notificationService', () => {
  it('normalizes notifications from newest to oldest', () => {
    const snapshot = createSnapshot([
      ['old', { title: 'Old', createdAt: '2026-05-01T10:00:00.000Z' }],
      ['new', { title: 'New', createdAt: '2026-05-01T11:00:00.000Z' }],
    ]);

    expect(normalizeNotificationSnapshot(snapshot)).toEqual([
      { id: 'new', title: 'New', createdAt: '2026-05-01T11:00:00.000Z' },
      { id: 'old', title: 'Old', createdAt: '2026-05-01T10:00:00.000Z' },
    ]);
  });

  it('returns an empty list when there is no snapshot data', () => {
    expect(normalizeNotificationSnapshot({ exists: () => false })).toEqual([]);
    expect(normalizeNotificationSnapshot(null)).toEqual([]);
  });
});
