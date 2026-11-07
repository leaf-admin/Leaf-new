const {
  createDriverEntryWaitlistService,
  isDriverEntryWaitlistGateEnabled,
  isEntryReady,
  resolveCityConfigFromActivation
} = require('../../../services/driver-entry-waitlist-service');

function fakeFirestore(initialEntries = []) {
  const entries = initialEntries.map((data, index) => ({ id: `w${index}`, data }));
  const users = {};
  function query(filters) {
    return {
      where(field, op, value) { return query([...filters, [field, value]]); },
      async get() {
        const docs = entries
          .filter((entry) => filters.every(([field, value]) => entry.data[field] === value))
          .map((entry) => ({ id: entry.id, data: () => entry.data }));
        return { empty: docs.length === 0, docs };
      }
    };
  }
  return {
    entries,
    users,
    collection(name) {
      if (name === 'waitList') {
        return {
          ...query([]),
          async add(data) { entries.push({ id: `w${entries.length}`, data }); return { id: `w${entries.length - 1}` }; }
        };
      }
      return {
        doc(id) {
          return { async set(data) { users[id] = { ...(users[id] || {}), ...data }; } };
        }
      };
    }
  };
}

function build(firestore) {
  const notifier = { dispatch: jest.fn().mockResolvedValue({ push: { success: true } }) };
  const service = createDriverEntryWaitlistService({
    getFirestore: () => firestore,
    serverTimestamp: () => 'ts',
    loadCityConfig: async () => ({ states: { RJ: { enabled: true, cities: { 'rio-de-janeiro': { label: 'Rio de Janeiro', maxActiveDrivers: 10 } } } } }),
    getNotifier: () => notifier
  });
  return { service, notifier };
}

describe('driver entry waitlist', () => {
  it('reads the gate flag strictly', () => {
    expect(isDriverEntryWaitlistGateEnabled({ DRIVER_ENTRY_WAITLIST_GATE: 'true' })).toBe(true);
    expect(isDriverEntryWaitlistGateEnabled({})).toBe(false);
    expect(isDriverEntryWaitlistGateEnabled({ DRIVER_ENTRY_WAITLIST_GATE: 'false' })).toBe(false);
  });

  it('puts a ready driver at the end of the city queue and notifies', async () => {
    const firestore = fakeFirestore([
      { driverId: 'a', status: 'pending', cityKey: 'rio-de-janeiro', position: 1 },
      { driverId: 'b', status: 'pending', cityKey: 'rio-de-janeiro', position: 2 },
      { driverId: 'c', status: 'approved', cityKey: 'rio-de-janeiro', position: 9 }
    ]);
    const { service, notifier } = build(firestore);
    const result = await service.enqueueReadyDriver({ driverId: 'd1', user: {} });

    expect(result).toEqual(expect.objectContaining({ queued: true, created: true, position: 3, cityKey: 'rio-de-janeiro' }));
    expect(firestore.entries.at(-1).data).toEqual(expect.objectContaining({ driverId: 'd1', status: 'pending', position: 3, source: 'registration_complete' }));
    expect(firestore.users.d1).toEqual(expect.objectContaining({ waitListStatus: 'pending', waitListPosition: 3 }));
    expect(notifier.dispatch).toHaveBeenCalledWith('d1', 'joined', expect.objectContaining({ position: 3, registrationComplete: true }));
  });

  it('is idempotent for a driver already waiting', async () => {
    const firestore = fakeFirestore([{ driverId: 'd1', status: 'pending', cityKey: 'rio-de-janeiro', position: 4 }]);
    const { service, notifier } = build(firestore);
    const result = await service.enqueueReadyDriver({ driverId: 'd1', user: {} });

    expect(result).toEqual(expect.objectContaining({ created: false, position: 4 }));
    expect(firestore.entries).toHaveLength(1);
    expect(notifier.dispatch).not.toHaveBeenCalled();
  });

  it('knows when an account is waiting only for the release', () => {
    expect(isEntryReady({ autoApproval: { status: 'waitlisted' } })).toBe(true);
    expect(isEntryReady({ autoApproval: { status: 'approved' } })).toBe(false);
    expect(isEntryReady({})).toBe(false);
  });

  it('resolves unknown cities to their slug with the default cap', () => {
    expect(resolveCityConfigFromActivation({}, 'Niterói', 'rj')).toEqual(expect.objectContaining({ cityKey: 'niteroi', stateCode: 'RJ' }));
  });
});
