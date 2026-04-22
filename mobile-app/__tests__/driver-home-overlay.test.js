import React from "react";
import { fireEvent, render } from "@testing-library/react-native";

import DriverHomeOverlay from "../src/screens/prototype/home/DriverHomeOverlay";

describe("DriverHomeOverlay", () => {
  it('shows "Ativando..." while the driver is pending and still offline', () => {
    const { getByLabelText, getByText } = render(
      <DriverHomeOverlay
        driverId="driver_1"
        driverOnline={false}
        driverOnlinePending
        driverCanGoOnline
        onToggleOnline={() => {}}
        onOpenActivation={() => {}}
      />,
    );

    expect(getByText("Ativando...")).toBeTruthy();
    expect(getByLabelText("driver-home-toggle-online-pending")).toBeTruthy();
  });

  it('keeps "Online" while the driver is already online even if pending flag is stale', () => {
    const { getByLabelText, getByText } = render(
      <DriverHomeOverlay
        driverId="driver_1"
        driverOnline
        driverOnlinePending
        driverCanGoOnline
        driverActivationResolved
        onToggleOnline={() => {}}
        onOpenActivation={() => {}}
      />,
    );

    expect(getByText("Online")).toBeTruthy();
    expect(getByLabelText("driver-home-toggle-online-online")).toBeTruthy();
  });

  it('does not flash "Ativação pendente" while activation is still resolving', () => {
    const { getByLabelText, getByText, queryByText } = render(
      <DriverHomeOverlay
        driverId="driver_1"
        driverOnline
        driverOnlinePending
        driverCanGoOnline={false}
        driverActivationResolved={false}
        onToggleOnline={() => {}}
        onOpenActivation={() => {}}
      />,
    );

    expect(getByText("Online")).toBeTruthy();
    expect(queryByText("Ativação pendente")).toBeNull();
    expect(getByLabelText("driver-home-toggle-online-online")).toBeTruthy();
  });

  it("exposes stable offline and online toggle states for automation", () => {
    const offline = render(
      <DriverHomeOverlay
        driverId="driver_1"
        driverOnline={false}
        driverCanGoOnline
        driverActivationResolved
        onToggleOnline={() => {}}
        onOpenActivation={() => {}}
      />,
    );

    expect(offline.getByLabelText("driver-home-toggle-online-offline")).toBeTruthy();

    const online = render(
      <DriverHomeOverlay
        driverId="driver_1"
        driverOnline
        driverCanGoOnline
        driverActivationResolved
        onToggleOnline={() => {}}
        onOpenActivation={() => {}}
      />,
    );

    expect(online.getByLabelText("driver-home-toggle-online-online")).toBeTruthy();
  });

  it('routes blocked drivers to activation instead of trying to go online', () => {
    const onToggleOnline = jest.fn();
    const onOpenActivation = jest.fn();

    const { getByLabelText, getByText } = render(
      <DriverHomeOverlay
        driverId="driver_1"
        driverOnline={false}
        driverCanGoOnline={false}
        driverActivationResolved
        onToggleOnline={onToggleOnline}
        onOpenActivation={onOpenActivation}
      />,
    );

    expect(getByText('Ativação pendente')).toBeTruthy();

    fireEvent.press(getByLabelText('driver-home-toggle-online-blocked'));

    expect(onOpenActivation).toHaveBeenCalledTimes(1);
    expect(onToggleOnline).not.toHaveBeenCalled();
  });

  it("keeps the online toggle interactive while activation is still resolving", () => {
    const onToggleOnline = jest.fn();
    const onOpenActivation = jest.fn();

    const { getByLabelText, getByText, queryByText } = render(
      <DriverHomeOverlay
        driverId="driver_1"
        driverOnline={false}
        driverCanGoOnline={false}
        driverActivationResolved={false}
        onToggleOnline={onToggleOnline}
        onOpenActivation={onOpenActivation}
      />,
    );

    expect(getByText("Ficar online")).toBeTruthy();
    expect(queryByText("Ativação pendente")).toBeNull();

    fireEvent.press(getByLabelText("driver-home-toggle-online-offline"));

    expect(onToggleOnline).toHaveBeenCalledTimes(1);
    expect(onOpenActivation).not.toHaveBeenCalled();
  });
});
