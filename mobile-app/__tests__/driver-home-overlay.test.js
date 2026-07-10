import React from "react";
import { act, fireEvent, render, waitFor } from "@testing-library/react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";

import DriverHomeOverlay from "../src/screens/prototype/home/DriverHomeOverlay";

describe("DriverHomeOverlay", () => {
  beforeEach(() => {
    jest.spyOn(AsyncStorage, "getItem").mockImplementation(() => new Promise(() => {}));
  });

  afterEach(async () => {
    await act(async () => {});
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

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

  it('shows reconnecting instead of a zeroed timer when online is not authenticated by realtime', () => {
    const { getByLabelText, getByText, queryByText } = render(
      <DriverHomeOverlay
        driverId="driver_1"
        driverOnline
        driverRealtimeAuthenticated={false}
        driverCanGoOnline
        driverActivationResolved
        onToggleOnline={() => {}}
        onOpenActivation={() => {}}
      />,
    );

    expect(getByText("Reconectando")).toBeTruthy();
    expect(getByText("--")).toBeTruthy();
    expect(queryByText("0min")).toBeNull();
    expect(getByLabelText("driver-home-toggle-online-pending")).toBeTruthy();
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

  it("shows the welcome campaign only before the driver's first activity of the day", () => {
    const firstSession = render(
      <DriverHomeOverlay
        driverId="driver_1"
        driverOnline={false}
        driverCanGoOnline
        driverActivationResolved
        ridesCount={0}
        onToggleOnline={() => {}}
        onOpenActivation={() => {}}
      />,
    );

    expect(firstSession.getByTestId("driver-home-promo-carousel")).toBeTruthy();

    const activeDay = render(
      <DriverHomeOverlay
        driverId="driver_1"
        driverOnline={false}
        driverCanGoOnline
        driverActivationResolved
        ridesCount={1}
        onToggleOnline={() => {}}
        onOpenActivation={() => {}}
      />,
    );

    expect(activeDay.queryByTestId("driver-home-promo-carousel")).toBeNull();
  });

  it("shows cumulative daily online time without warning before 10h", () => {
    jest.spyOn(Date, "now").mockReturnValue(100_000_000);

    const { getByText, queryByText } = render(
      <DriverHomeOverlay
        driverId="driver_1"
        driverOnline
        driverCanGoOnline
        driverActivationResolved
        driverOnlineDaily={{
          totalMs: 9 * 60 * 60 * 1000,
          sessionStartedAtMs: 100_000_000 - 50 * 60 * 1000,
          warningMs: 10 * 60 * 60 * 1000,
          limitMs: 12 * 60 * 60 * 1000,
        }}
        onToggleOnline={() => {}}
        onOpenActivation={() => {}}
      />,
    );

    expect(getByText("9h50")).toBeTruthy();
    expect(queryByText("Próximo ao limite")).toBeNull();
  });

  it("shows a low-noise warning when daily online time reaches 10h", () => {
    jest.spyOn(Date, "now").mockReturnValue(100_000_000);

    const { getByText } = render(
      <DriverHomeOverlay
        driverId="driver_1"
        driverOnline
        driverCanGoOnline
        driverActivationResolved
        driverOnlineDaily={{
          totalMs: 9 * 60 * 60 * 1000,
          sessionStartedAtMs: 100_000_000 - 60 * 60 * 1000,
          warningMs: 10 * 60 * 60 * 1000,
          limitMs: 12 * 60 * 60 * 1000,
        }}
        onToggleOnline={() => {}}
        onOpenActivation={() => {}}
      />,
    );

    expect(getByText("10h00")).toBeTruthy();
    expect(getByText("Próximo ao limite")).toBeTruthy();
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

  it("does not show the day summary every time the driver goes offline", async () => {
    jest.spyOn(Date, "now").mockReturnValue(new Date(2026, 5, 25, 18, 0, 0).getTime());

    const { queryByText, rerender } = render(
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
      expect(queryByText("Resumo do dia")).toBeNull();
    });
  });

  it("shows the day summary near midnight when the driver was online today", async () => {
    jest.spyOn(Date, "now").mockReturnValue(new Date(2026, 5, 25, 23, 55, 0).getTime());
    AsyncStorage.getItem.mockResolvedValue(null);
    jest.spyOn(AsyncStorage, "setItem").mockResolvedValue(undefined);

    const { getByText, queryByText } = render(
      <DriverHomeOverlay
        driverId="driver_1"
        driverOnline={false}
        driverCanGoOnline
        driverActivationResolved
        ridesCount={3}
        formattedDriverEarnings="R$ 80,00"
        driverGrossAmount={100}
        driverFeeAmount={20}
        driverOnlineDaily={{
          totalMs: 60 * 60 * 1000,
          effectiveMs: 60 * 60 * 1000,
          sessionStartedAtMs: null,
        }}
        onToggleOnline={() => {}}
        onOpenActivation={() => {}}
      />,
    );

    await waitFor(() => {
      expect(getByText("Resumo do dia")).toBeTruthy();
      expect(getByText("Você recebeu")).toBeTruthy();
      expect(getByText("Comparativo direto")).toBeTruthy();
      expect(getByText("Sequência de meta")).toBeTruthy();
      expect(getByText("Fechamento do dia disponível para acompanhar seus ganhos.")).toBeTruthy();
      expect(queryByText(/uber/i)).toBeNull();
    });
    expect(AsyncStorage.setItem).toHaveBeenCalledWith(
      "@prototype_driver_day_summary_seen_driver_1",
      "2026-06-25",
    );
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
