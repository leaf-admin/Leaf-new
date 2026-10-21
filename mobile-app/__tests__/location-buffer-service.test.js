import AsyncStorage from '@react-native-async-storage/async-storage';
import locationBufferService, { pruneStaleLocations } from '../src/services/LocationBufferService';
import WebSocketManager from '../src/services/WebSocketManager';

jest.mock('../src/services/WebSocketManager', () => ({
  __esModule: true,
  default: {
    getInstance: jest.fn(),
  },
}));

describe('LocationBufferService', () => {
  let socketManager;
  const NOW = Date.now();

  beforeEach(async () => {
    await AsyncStorage.clear();
    jest.clearAllMocks();
    locationBufferService.activeTripContextCache = null;
    locationBufferService.bufferCache = null;
    locationBufferService.isOnline = true;
    socketManager = {
      authenticatedUserId: 'driver_1',
      getConnectionStatus: jest.fn(() => ({ authenticated: true })),
      isConnected: jest.fn(() => true),
      updateLocationBatch: jest.fn().mockResolvedValue({
        success: true,
        acceptedCount: 2,
      }),
      emitToServer: jest.fn(),
    };
    WebSocketManager.getInstance.mockReturnValue(socketManager);
  });

  it('flushes buffered driver locations as an ordered batch with sequence metadata', async () => {
    await locationBufferService.setActiveTripContext({
      bookingId: 'booking_1',
      driverId: 'driver_1',
      tripStatus: 'started',
    });
    await locationBufferService.addLocation(
      'booking_1',
      {
        lat: -22.92,
        lng: -43.18,
        seq: 2,
        capturedAt: NOW - 5000,
        source: 'background_task',
      },
      'driver',
      { attemptImmediateSend: false, driverId: 'driver_1' },
    );
    await locationBufferService.addLocation(
      'booking_1',
      {
        lat: -22.91,
        lng: -43.17,
        seq: 1,
        capturedAt: NOW - 10000,
        source: 'background_task',
      },
      'driver',
      { attemptImmediateSend: false, driverId: 'driver_1' },
    );

    await locationBufferService.syncBufferedLocations();

    expect(socketManager.updateLocationBatch).toHaveBeenCalledWith(
      expect.objectContaining({
        driverId: 'driver_1',
        bookingId: 'booking_1',
        tripStatus: 'started',
        isInTrip: true,
        source: 'location_buffer_batch',
        locations: [
          expect.objectContaining({ seq: 1, capturedAt: NOW - 10000 }),
          expect.objectContaining({ seq: 2, capturedAt: NOW - 5000 }),
        ],
      }),
    );
    await expect(locationBufferService.getBuffer()).resolves.toEqual([]);
  });

  it('keeps buffered driver locations when batch sync fails', async () => {
    socketManager.updateLocationBatch.mockRejectedValueOnce(new Error('network_down'));
    await locationBufferService.setActiveTripContext({
      bookingId: 'booking_2',
      driverId: 'driver_1',
      tripStatus: 'started',
    });
    await locationBufferService.addLocation(
      'booking_2',
      {
        lat: -22.93,
        lng: -43.19,
        seq: 1,
        capturedAt: NOW - 1000,
      },
      'driver',
      { attemptImmediateSend: false, driverId: 'driver_1' },
    );

    await locationBufferService.syncBufferedLocations();

    const buffer = await locationBufferService.getBuffer();
    expect(buffer).toHaveLength(1);
    expect(buffer[0]).toEqual(expect.objectContaining({
      bookingId: 'booking_2',
      seq: 1,
    }));
  });

  it('sends a background fix right away when the driver is connected', async () => {
    await locationBufferService.setActiveTripContext({
      bookingId: 'booking_1',
      driverId: 'driver_1',
      tripStatus: 'started',
    });

    const result = await locationBufferService.addDriverLocationFromBackground({
      lat: -22.92,
      lng: -43.18,
      timestamp: 1710000005000,
    });

    expect(result).toMatchObject({ buffered: true, bookingId: 'booking_1' });
    expect(socketManager.emitToServer).toHaveBeenCalledWith(
      'updateLocation',
      expect.objectContaining({
        bookingId: 'booking_1',
        lat: -22.92,
        lng: -43.18,
        source: 'background_task',
      }),
    );
  });

  it('passes the Android mocked flag of a background fix to the server', async () => {
    await locationBufferService.setActiveTripContext({
      bookingId: 'booking_1',
      driverId: 'driver_1',
      tripStatus: 'started',
    });

    await locationBufferService.addDriverLocationFromBackground({ lat: -22.92, lng: -43.18, mocked: true });
    await locationBufferService.addDriverLocationFromBackground({ lat: -22.93, lng: -43.19 });

    const sent = socketManager.emitToServer.mock.calls.map(([, payload]) => payload);
    expect(sent[0]).toMatchObject({ lat: -22.92, mocked: true });
    expect(sent[1]).not.toHaveProperty('mocked');
  });

  it('keeps the mocked flag on buffered fixes sent later as a batch', async () => {
    socketManager.isConnected.mockReturnValue(false);
    await locationBufferService.addLocation(
      'booking_1',
      { lat: -22.92, lng: -43.18, capturedAt: NOW, seq: 1, mocked: true },
      'driver',
      { driverId: 'driver_1' },
    );

    const [stored] = await locationBufferService.getBuffer();
    expect(stored.mocked).toBe(true);
  });

  it('drops a background fix only when no ride is active', async () => {
    const result = await locationBufferService.addDriverLocationFromBackground({ lat: -22.92, lng: -43.18 });

    expect(result).toEqual({ buffered: false, reason: 'no_active_trip' });
    expect(socketManager.emitToServer).not.toHaveBeenCalled();
  });

  it('sends a connected fix without touching storage', async () => {
    await locationBufferService.addLocation(
      'booking_1',
      { lat: -22.92, lng: -43.18, capturedAt: NOW },
      'driver',
      { driverId: 'driver_1' },
    );

    expect(socketManager.emitToServer).toHaveBeenCalledWith('updateLocation', expect.objectContaining({ lat: -22.92 }));
    expect(AsyncStorage.setItem.mock.calls.filter(([key]) => key === '@location_buffer')).toEqual([]);
    await expect(locationBufferService.getBuffer()).resolves.toEqual([]);
  });

  it('keeps a fix that could not be sent, and drops fixes older than two hours', async () => {
    socketManager.isConnected.mockReturnValue(false);
    await AsyncStorage.setItem('@location_buffer', JSON.stringify([
      { eventId: 'old', bookingId: 'booking_days_ago', userType: 'driver', lat: -22.9, lng: -43.1, capturedAt: NOW - 3 * 24 * 60 * 60 * 1000 },
    ]));

    await locationBufferService.addLocation(
      'booking_1',
      { lat: -22.92, lng: -43.18, capturedAt: NOW },
      'driver',
      { driverId: 'driver_1' },
    );

    const buffer = await locationBufferService.getBuffer();
    expect(buffer.map((item) => item.bookingId)).toEqual(['booking_1']);
    expect(pruneStaleLocations([{ capturedAt: NOW - 3 * 60 * 60 * 1000 }, { timestamp: NOW - 60000 }], NOW)).toHaveLength(1);
  });

  it('writes the buffer at most every few seconds while the socket is down', async () => {
    socketManager.isConnected.mockReturnValue(false);
    for (let index = 0; index < 50; index += 1) {
      await locationBufferService.addLocation(
        'booking_1',
        { lat: -22.92 + index / 10000, lng: -43.18, capturedAt: NOW + index },
        'driver',
        { driverId: 'driver_1' },
      );
    }

    const writes = AsyncStorage.setItem.mock.calls.filter(([key]) => key === '@location_buffer');
    expect(writes.length).toBeLessThanOrEqual(1);
    await expect(locationBufferService.getBuffer()).resolves.toHaveLength(50);
    await locationBufferService.persistBufferNow();
    expect(JSON.parse(await AsyncStorage.getItem('@location_buffer'))).toHaveLength(50);
  });
});
