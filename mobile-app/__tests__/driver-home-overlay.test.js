import React from "react";
import { fireEvent, render, waitFor } from "@testing-library/react-native";

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
    const { getAllByText, getByLabelText } = render(
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

    expect(getAllByText("Online").length).toBeGreaterThan(0);
    expect(getByLabelText("driver-home-toggle-online-online")).toBeTruthy();
  });

  it('does not flash "Ativação pendente" while activation is still resolving', () => {
    const { getAllByText, getByLabelText, queryByText } = render(
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

    expect(getAllByText("Online").length).toBeGreaterThan(0);
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

    expect(getByText('Em análise')).toBeTruthy();

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

  it("keeps the driver card focused on stats and preferences access", () => {
    const { getByTestId, getByText, queryByText } = render(
      <DriverHomeOverlay
        driverId="driver_1"
        driverOnline={false}
        driverCanGoOnline
        driverActivationResolved
        ridesCount={7}
        formattedDriverEarnings="R$ 184,20"
        onToggleOnline={() => {}}
        onOpenActivation={() => {}}
      />,
    );

    expect(getByText("Meus ganhos")).toBeTruthy();
    expect(getByText("R$ 184,20")).toBeTruthy();
    expect(getByText("92%")).toBeTruthy();
    expect(getByText("Progresso da meta")).toBeTruthy();
    expect(queryByText("92% da meta")).toBeNull();
    expect(getByText("7")).toBeTruthy();
    expect(getByText("corridas")).toBeTruthy();
    expect(getByText("online")).toBeTruthy();
    expect(getByTestId("driver-home-preferences-button")).toBeTruthy();
    expect(queryByText("Área aquecida")).toBeNull();
    expect(queryByText("Preferências ativas")).toBeNull();
    expect(queryByText("Central de segurança")).toBeNull();
  });

  it("saves driver destination mode from the preferences modal", async () => {
    const onSaveDestinationMode = jest.fn().mockResolvedValue({ success: true });

    const { getByTestId } = render(
      <DriverHomeOverlay
        driverId="driver_1"
        driverOnline
        driverCanGoOnline
        driverActivationResolved
        onToggleOnline={() => {}}
        onOpenActivation={() => {}}
        onSaveDestinationMode={onSaveDestinationMode}
      />,
    );

    fireEvent.press(getByTestId("driver-home-preferences-button"));
    fireEvent.press(getByTestId("driver-destination-mode-toggle"));
    fireEvent.changeText(
      getByTestId("driver-destination-mode-input"),
      "Shopping Leblon",
    );
    fireEvent.press(getByTestId("driver-preferences-save"));

    await waitFor(() => {
      expect(onSaveDestinationMode).toHaveBeenCalledWith({
        enabled: true,
        query: "Shopping Leblon",
      });
    });
  });

  it("shows the day summary when the driver goes offline", async () => {
    const { getByText, queryByText, rerender } = render(
      <DriverHomeOverlay
        driverId="driver_1"
        driverOnline
        driverCanGoOnline
        driverActivationResolved
        ridesCount={3}
        formattedDriverEarnings="R$ 80,00"
        driverGrossAmount={100}
        driverFeeAmount={20}
        onToggleOnline={() => {}}
        onOpenActivation={() => {}}
      />,
    );

    expect(queryByText("Resumo do dia")).toBeNull();

    rerender(
      <DriverHomeOverlay
        driverId="driver_1"
        driverOnline={false}
        driverCanGoOnline
        driverActivationResolved
        ridesCount={3}
        formattedDriverEarnings="R$ 80,00"
        driverGrossAmount={100}
        driverFeeAmount={20}
        onToggleOnline={() => {}}
        onOpenActivation={() => {}}
      />,
    );

    await waitFor(() => {
      expect(getByText("Resumo do dia")).toBeTruthy();
      expect(getByText("Você recebeu")).toBeTruthy();
      expect(getByText("Comparativo direto")).toBeTruthy();
      expect(getByText("Sequência de meta")).toBeTruthy();
      expect(queryByText(/uber/i)).toBeNull();
    });
  });

  it("suppresses offline summary and activation CTA while a driver ride is active", async () => {
    const onToggleOnline = jest.fn();
    const { getByLabelText, getByText, queryByText, rerender } = render(
      <DriverHomeOverlay
        driverId="driver_1"
        driverOnline
        driverCanGoOnline={false}
        driverActivationResolved
        driverWorkInProgress
        suppressDaySummary
        onToggleOnline={onToggleOnline}
        onOpenActivation={() => {}}
      />,
    );

    expect(getByText("Em corrida")).toBeTruthy();
    fireEvent.press(getByLabelText("driver-home-toggle-online-ride"));
    expect(onToggleOnline).not.toHaveBeenCalled();

    rerender(
      <DriverHomeOverlay
        driverId="driver_1"
        driverOnline={false}
        driverCanGoOnline={false}
        driverActivationResolved
        driverWorkInProgress
        suppressDaySummary
        onToggleOnline={onToggleOnline}
        onOpenActivation={() => {}}
      />,
    );

    await waitFor(() => {
      expect(queryByText("Resumo do dia")).toBeNull();
      expect(queryByText("Em análise")).toBeNull();
    });
  });
});
