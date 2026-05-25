import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { PrototypeCard } from "../../../components/prototype/PrototypeUI";
import robotaxiPrototypeTokens from "../../../components/design-system/robotaxiPrototypeTokens";
import { fonts } from "../../../theme/runtimeTokens";

const { color } = robotaxiPrototypeTokens;

function resolveIcon(type) {
  const normalized = String(type || "").trim().toLowerCase();
  if (normalized === "rider_cancelled_before_accept") {
    return { name: "close-circle-outline", color: "#8A1F2B", tone: styles.cancelIconWrap };
  }
  if (normalized === "accepted_by_other_driver_competitive") {
    return { name: "swap-horizontal-outline", color: "#365A6D", tone: styles.competitiveIconWrap };
  }
  return { name: "information-circle-outline", color: color.text.primary, tone: styles.defaultIconWrap };
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
  insetsBottom = 0,
  bottomOffset = 0,
  suppressActivationStatusAlerts = false,
}) {
  const cardId = String(card?.id || "").trim();
  if (!cardId) {
    return null;
  }

  if (suppressActivationStatusAlerts && isActivationStatusCard(card)) {
    return null;
  }

  const icon = resolveIcon(card?.type);

  return (
    <View
      pointerEvents="none"
      style={[styles.wrap, { bottom: insetsBottom + bottomOffset }]}
      testID="driver-transient-state-card"
      accessibilityLabel="driver-transient-state-card"
    >
      <PrototypeCard style={styles.card}>
        <View style={styles.row}>
          <View style={[styles.iconWrap, icon.tone]}>
            <Ionicons name={icon.name} size={18} color={icon.color} />
          </View>

          <View style={styles.copy}>
            <Text style={styles.title}>{card?.title || "Atualização"}</Text>
            <Text style={styles.message}>
              {card?.message || "O estado da solicitação foi atualizado."}
            </Text>
          </View>
        </View>
      </PrototypeCard>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: "absolute",
    left: 0,
    right: 0,
    alignItems: "center",
    zIndex: 19,
  },
  card: {
    width: "88%",
    borderRadius: 24,
    paddingHorizontal: 16,
    paddingVertical: 14,
    backgroundColor: "rgba(249,250,247,0.98)",
  },
  row: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
  },
  iconWrap: {
    width: 38,
    height: 38,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  cancelIconWrap: {
    backgroundColor: "rgba(138,31,43,0.12)",
  },
  competitiveIconWrap: {
    backgroundColor: "rgba(208,225,236,0.56)",
  },
  defaultIconWrap: {
    backgroundColor: "rgba(68,85,93,0.08)",
  },
  copy: {
    flex: 1,
  },
  title: {
    fontFamily: fonts.SemiBold,
    fontSize: 16,
    lineHeight: 20,
    color: color.text.primary,
  },
  message: {
    marginTop: 4,
    fontFamily: fonts.Medium,
    fontSize: 13,
    lineHeight: 17,
    color: color.text.secondary,
  },
});
