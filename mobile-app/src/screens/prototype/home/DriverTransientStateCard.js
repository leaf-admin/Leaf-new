import React from "react";
import LeafActionBanner from "../../../components/design-system/LeafActionBanner";

// Banner com ação (estudo 5.3): tipo do aviso -> tom e ícone.
function resolveBannerTone(type) {
  const normalized = String(type || "").trim().toLowerCase();
  if (normalized === "rider_cancelled_before_accept") return { tone: "warning", icon: "close-circle-outline" };
  if (normalized === "driver_online_daily_limit_reached") return { tone: "warning", icon: "time-outline" };
  if (normalized === "session_terminated") return { tone: "warning", icon: "log-out-outline" };
  if (normalized === "accepted_by_other_driver_competitive") return { tone: "info", icon: "swap-horizontal-outline" };
  if (normalized === "night_surcharge_started") return { tone: "info", icon: "moon" };
  if (normalized === "night_surcharge_ended") return { tone: "info", icon: "sunny-outline" };
  if (normalized === "offer_expired") return { tone: "info", icon: "time-outline" };
  return { tone: "info", icon: "information-circle-outline" };
}

function normalizeAlertText(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function isActivationStatusCard(card = {}) {
  const combined = normalizeAlertText(
    `${card?.type || ""} ${card?.title || ""} ${card?.message || ""}`,
  );

  if (!combined) {
    return false;
  }

  return (
    combined.includes("ativacao") ||
    combined.includes("ativar seu status") ||
    combined.includes("veiculo valido") ||
    combined.includes("veiculo ativo") ||
    combined.includes("driver_not_eligible") ||
    combined.includes("vehicle_required")
  );
}

export default function DriverTransientStateCard({
  card = null,
  insetsTop = 0,
  suppressActivationStatusAlerts = false,
}) {
  const cardId = String(card?.id || "").trim();
  if (!cardId) {
    return null;
  }

  if (suppressActivationStatusAlerts && isActivationStatusCard(card)) {
    return null;
  }

  const { tone, icon } = resolveBannerTone(card?.type);

  return (
    <LeafActionBanner
      key={cardId}
      tone={tone}
      icon={icon}
      top={insetsTop}
      title={card?.title || "Atualização"}
      message={card?.message || "O estado da solicitação foi atualizado."}
      testID="driver-transient-state-card"
    />
  );
}
