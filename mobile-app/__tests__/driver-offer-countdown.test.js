import React from "react";
import { AppState, Text } from "react-native";
import { act, render } from "@testing-library/react-native";

import {
  formatDriverOfferCountdown,
  getDriverOfferRemainingSeconds,
  resolveDriverOfferDeadlineMs,
  toDriverOfferIsoTimestamp,
  useDriverOfferCountdown,
} from "../src/screens/prototype/driverOfferCountdown";

function CountdownProbe({ offer }) {
  const countdown = useDriverOfferCountdown(offer);
  return <Text testID="countdown-probe">{countdown.label}</Text>;
}

describe("driver offer countdown", () => {
  const nowMs = Date.parse("2026-07-10T20:00:00.000Z");

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it("prefers the authoritative absolute deadline and formats MM:SS", () => {
    const deadlineMs = resolveDriverOfferDeadlineMs(
      {
        expiresAt: "2026-07-10T20:00:20.000Z",
        timestamp: "2026-07-10T20:00:00.000Z",
        timeout: 300,
      },
      nowMs,
    );

    expect(deadlineMs).toBe(nowMs + 20000);
    expect(getDriverOfferRemainingSeconds(deadlineMs, nowMs)).toBe(20);
    expect(formatDriverOfferCountdown(20)).toBe("00:20");
    expect(formatDriverOfferCountdown(0)).toBe("00:00");
  });

  it("falls back to the authoritative event timestamp plus timeout", () => {
    expect(
      resolveDriverOfferDeadlineMs({
        timestamp: "2026-07-10T20:00:00.000Z",
        expiresInSec: 20,
      }),
    ).toBe(nowMs + 20000);
  });

  it("drops invalid timestamps instead of throwing during offer normalization", () => {
    expect(toDriverOfferIsoTimestamp("not-a-timestamp")).toBeNull();
    expect(toDriverOfferIsoTimestamp(null)).toBeNull();
    expect(toDriverOfferIsoTimestamp(nowMs)).toBe(
      "2026-07-10T20:00:00.000Z",
    );
  });

  it("recomputes from the deadline after returning active instead of drifting", () => {
    jest.useFakeTimers();
    jest.setSystemTime(nowMs);
    let appStateListener = null;
    jest.spyOn(AppState, "addEventListener").mockImplementation((event, listener) => {
      if (event === "change") {
        appStateListener = listener;
      }
      return { remove: jest.fn() };
    });

    const screen = render(
      <CountdownProbe
        offer={{
          bookingId: "booking_countdown",
          expiresAt: "2026-07-10T20:00:20.000Z",
        }}
      />,
    );

    expect(screen.getByTestId("countdown-probe").props.children).toBe("00:20");

    act(() => {
      jest.setSystemTime(nowMs + 20000);
      appStateListener?.("active");
    });

    expect(screen.getByTestId("countdown-probe").props.children).toBe("00:00");
  });
});
