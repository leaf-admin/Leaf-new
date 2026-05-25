const {
  clearPrototypeHomeAutomationPayload,
  getLatestPrototypeHomeAutomationPayload,
  publishPrototypeHomeAutomationPayload,
  subscribePrototypeHomeAutomationPayload,
} = require("../src/screens/prototype/prototypeHomeAutomationBus");

describe("prototype home automation bus", () => {
  beforeEach(() => {
    clearPrototypeHomeAutomationPayload();
  });

  it("publishes deeplink payloads to active subscribers", () => {
    const received = [];
    const unsubscribe = subscribePrototypeHomeAutomationPayload((snapshot) => {
      received.push(snapshot);
    });

    publishPrototypeHomeAutomationPayload({
      qaRouteParams: {
        qaAutomation: "1",
        qaDriverAction: "accept_offer",
        qaBookingId: "booking_123",
        qaNonce: "nonce_123",
      },
      driverAutomationCommand: {
        role: "driver",
        action: "accept_offer",
        bookingId: "booking_123",
        nonce: "nonce_123",
      },
    });

    unsubscribe();

    expect(received).toHaveLength(1);
    expect(received[0]).toEqual({
      qaRouteParams: {
        qaAutomation: "1",
        qaDriverAction: "accept_offer",
        qaBookingId: "booking_123",
        qaNonce: "nonce_123",
      },
      driverAutomationCommand: {
        role: "driver",
        action: "accept_offer",
        bookingId: "booking_123",
        nonce: "nonce_123",
      },
    });
  });

  it("retains the latest payload for a focused screen that subscribes later", () => {
    publishPrototypeHomeAutomationPayload({
      qaRouteParams: {
        qaAutomation: "1",
        qaDriverAction: "reject_offer",
      },
      driverAutomationCommand: {
        role: "driver",
        action: "reject_offer",
        bookingId: "booking_789",
      },
    });

    expect(getLatestPrototypeHomeAutomationPayload()).toEqual({
      qaRouteParams: {
        qaAutomation: "1",
        qaDriverAction: "reject_offer",
      },
      driverAutomationCommand: {
        role: "driver",
        action: "reject_offer",
        bookingId: "booking_789",
        nonce: "prototype-home-automation",
      },
    });
  });

  it("clears the retained payload when an automation run starts", () => {
    publishPrototypeHomeAutomationPayload({
      qaRouteParams: {
        qaAutomation: "1",
        qaDriverAction: "set_online",
      },
      driverAutomationCommand: {
        role: "driver",
        action: "set_online",
      },
    });

    clearPrototypeHomeAutomationPayload();

    expect(getLatestPrototypeHomeAutomationPayload()).toEqual({
      qaRouteParams: null,
      driverAutomationCommand: null,
    });
  });
});
