const {
  WaitlistNotificationService,
  WAITLIST_EVENTS,
  buildWaitlistNotification,
} = require('../../../services/waitlist-notification-service');

function createFirestoreMock() {
  const set = jest.fn().mockResolvedValue(undefined);
  const doc = jest.fn(() => ({ set }));
  const collection = jest.fn(() => ({ doc }));
  return {
    firestore: { collection },
    set,
    doc,
    collection,
  };
}

function createRealtimeDbMock() {
  const set = jest.fn().mockResolvedValue(undefined);
  const ref = jest.fn(() => ({ set }));
  return {
    realtimeDB: { ref },
    set,
    ref,
  };
}

function createAdminMock() {
  return {
    firestore: {
      FieldValue: {
        serverTimestamp: jest.fn(() => 'SERVER_TIMESTAMP'),
      },
    },
  };
}

describe('waitlist-notification-service', () => {
  it('builds a priority waitlist push that opens the isolated waitlist route', () => {
    const notification = buildWaitlistNotification('driver_1', WAITLIST_EVENTS.APPROVED, {
      status: 'approved',
      cityKey: 'rio-de-janeiro-rj',
      cityLabel: 'Rio de Janeiro',
    });

    expect(notification).toEqual(expect.objectContaining({
      priority: 'high',
      channelId: 'driver_waitlist',
      data: expect.objectContaining({
        type: 'driver_waitlist_update',
        waitlistEvent: 'approved',
        screen: 'RobotaxiPrototypeDriverWaitlistStatus',
        routeName: 'RobotaxiPrototypeDriverWaitlistStatus',
        userType: 'driver',
      }),
    }));
  });

  it('persists the notification and sends push to the driver', async () => {
    const firestore = createFirestoreMock();
    const realtime = createRealtimeDbMock();
    const fcmService = {
      sendNotificationToUser: jest.fn().mockResolvedValue({
        success: true,
        summary: { total: 1, success: 1, failed: 0 },
      }),
    };
    const service = new WaitlistNotificationService({
      adminModule: createAdminMock(),
      firestore: firestore.firestore,
      realtimeDB: realtime.realtimeDB,
      fcmService,
      now: () => new Date('2026-05-27T12:00:00.000Z'),
    });

    const result = await service.dispatch('driver_1', WAITLIST_EVENTS.JOINED, {
      status: 'pending',
      position: 4,
      cityLabel: 'Rio de Janeiro',
    });

    expect(result.success).toBe(true);
    expect(fcmService.sendNotificationToUser).toHaveBeenCalledWith(
      'driver_1',
      expect.objectContaining({
        title: 'Voce entrou na lista da Leaf',
        priority: 'high',
        data: expect.objectContaining({
          waitlistEvent: 'joined',
          position: '4',
        }),
      })
    );
    expect(firestore.collection).toHaveBeenCalledWith('notificationHistory');
    expect(firestore.set).toHaveBeenCalledWith(
      expect.objectContaining({
        driverId: 'driver_1',
        type: 'waitlist',
        notificationType: 'driver_waitlist_update',
        deliveryStatus: 'queued',
      }),
      { merge: true }
    );
    expect(realtime.ref).toHaveBeenCalledWith(expect.stringMatching(/^notifications\/driver_1\/waitlist_/));
    expect(realtime.set).toHaveBeenCalled();
  });

  it('keeps the persistent notification even when push delivery fails', async () => {
    const firestore = createFirestoreMock();
    const realtime = createRealtimeDbMock();
    const service = new WaitlistNotificationService({
      adminModule: createAdminMock(),
      firestore: firestore.firestore,
      realtimeDB: realtime.realtimeDB,
      fcmService: {
        sendNotificationToUser: jest.fn().mockResolvedValue({
          success: false,
          error: 'Nenhum token FCM encontrado',
        }),
      },
      now: () => new Date('2026-05-27T12:00:00.000Z'),
    });

    const result = await service.dispatch('driver_2', WAITLIST_EVENTS.POSITION_UPDATED, {
      status: 'pending',
      previousPosition: 8,
      position: 7,
    });

    expect(result.success).toBe(true);
    expect(result.push.success).toBe(false);
    expect(firestore.set).toHaveBeenCalledWith(
      expect.objectContaining({ deliveryStatus: 'queued' }),
      { merge: true }
    );
    expect(firestore.set).toHaveBeenCalledWith(
      expect.objectContaining({
        deliveryStatus: 'failed',
        delivery: expect.objectContaining({
          status: 'failed',
          error: 'Nenhum token FCM encontrado',
        }),
      }),
      { merge: true }
    );
  });
});
