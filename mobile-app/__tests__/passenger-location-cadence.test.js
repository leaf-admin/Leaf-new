jest.mock("expo-notifications", () => ({
  setNotificationHandler: jest.fn(),
  addNotificationReceivedListener: jest.fn(() => ({ remove: jest.fn() })),
  addNotificationResponseReceivedListener: jest.fn(() => ({ remove: jest.fn() })),
  removeNotificationSubscription: jest.fn(),
  getPermissionsAsync: jest.fn(() => Promise.resolve({ status: "granted" })),
  requestPermissionsAsync: jest.fn(() => Promise.resolve({ status: "granted" })),
  getExpoPushTokenAsync: jest.fn(() => Promise.resolve({ data: "ExpoPushToken[test]" })),
  setNotificationChannelAsync: jest.fn(() => Promise.resolve()),
  scheduleNotificationAsync: jest.fn(() => Promise.resolve("notification-id")),
}));
jest.mock("@react-native-firebase/auth", () => () => ({ currentUser: null }));

import { shouldHoldPassengerLocationPush } from "../src/screens/prototype/prototypeRideRuntime";

// ~11 m per 0.0001 degree of latitude.
const at = (offset, heading = 0) => ({ lat: -22.97 - offset, lng: -43.18, heading });
const lastSent = (status, overrides = {}) => ({
  sentAt: 1_000_000,
  bookingId: "booking_1",
  status,
  location: { latitude: -22.97, longitude: -43.18 },
  heading: 0,
  ...overrides,
});

describe("passenger location cadence during a ride", () => {
  it("holds a still phone for 15 s while waiting and 10 s in the trip", () => {
    const hold = (status, elapsedMs) => shouldHoldPassengerLocationPush({
      last: lastSent(status),
      bookingId: "booking_1",
      bookingStatus: status,
      location: at(0),
      nowMs: 1_000_000 + elapsedMs,
    });
    expect(hold("accepted", 4_600)).toBe(true);
    expect(hold("accepted", 14_000)).toBe(true);
    expect(hold("accepted", 15_000)).toBe(false);
    expect(hold("started", 9_000)).toBe(true);
    expect(hold("started", 10_000)).toBe(false);
  });

  it("ignores GPS jitter and a drifting compass on a still phone", () => {
    expect(shouldHoldPassengerLocationPush({
      last: lastSent("started"),
      bookingId: "booking_1",
      bookingStatus: "started",
      location: at(0.00005, 90),
      nowMs: 1_002_000,
    })).toBe(true);
  });

  it("sends early when the passenger really moves", () => {
    expect(shouldHoldPassengerLocationPush({
      last: lastSent("started"),
      bookingId: "booking_1",
      bookingStatus: "started",
      location: at(0.0005),
      nowMs: 1_002_000,
    })).toBe(false);
  });

  it("always sends on a new booking, a status change or a forced push", () => {
    const base = { bookingStatus: "started", location: at(0), nowMs: 1_001_000 };
    expect(shouldHoldPassengerLocationPush({ ...base, last: lastSent("started"), bookingId: "booking_2" })).toBe(false);
    expect(shouldHoldPassengerLocationPush({ ...base, last: lastSent("arrived"), bookingId: "booking_1" })).toBe(false);
    expect(shouldHoldPassengerLocationPush({ ...base, last: lastSent("started"), bookingId: "booking_1", force: true })).toBe(false);
    expect(shouldHoldPassengerLocationPush({ ...base, last: null, bookingId: "booking_1" })).toBe(false);
  });
});
