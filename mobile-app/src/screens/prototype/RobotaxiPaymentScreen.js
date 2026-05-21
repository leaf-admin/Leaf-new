import React, { useCallback, useEffect, useState } from "react";
import { Alert, StatusBar, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { fonts } from "../../theme/runtimeTokens";
import PrototypeScreenTransition from "../../components/prototype/PrototypeScreenTransition";
import PrototypeDismissibleSheet from "../../components/prototype/PrototypeDismissibleSheet";
import {
  LeafButton,
  LeafDivider,
  LeafInfoRow,
  LeafMetricRow,
  LeafRideSheet,
  LeafStateHeader,
  leafRideColors,
} from "../../components/prototype/LeafRideUI";
import WooviPaymentModal from "../../components/payment/WooviPaymentModal";
import SecurePaymentBadge from "../../components/payment/SecurePaymentBadge";
import { usePrototypeMapOcclusion } from "./prototypeMapOcclusion";
import { usePrototypeRideRuntime } from "./prototypeRideRuntime";
import { resolveMeaningfulAddress } from "./addressLabelUtils";

const SHEET_BOTTOM_OFFSET = 16;
const FALLBACK_CARD_HEIGHT = 356;

function formatCurrency(value) {
  return `R$ ${Number(value || 0)
    .toFixed(2)
    .replace(".", ",")}`;
}

function resolveLeafFee(fare) {
  const numeric = Number(fare);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return null;
  }
  if (numeric > 50) {
    return numeric * 0.03;
  }
  return numeric > 25 ? 1.49 : 0.99;
}

export default function RobotaxiPaymentScreen({ navigation, route }) {
  const {
    selectedDestination,
    currentAddress,
    currentCoordinate,
    profileUid,
    riderProfile,
    checkRideAvailability,
    paymentState,
    requestRide,
  } = usePrototypeRideRuntime();
  const insets = useSafeAreaInsets();
  const [cardHeight, setCardHeight] = useState(FALLBACK_CARD_HEIGHT);
  const [isPixModalVisible, setPixModalVisible] = useState(
    Boolean(route?.params?.autoOpenPix),
  );
  const [checkingAvailability, setCheckingAvailability] = useState(false);
  const [availabilityNotice, setAvailabilityNotice] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const sheetBottom = insets.bottom + SHEET_BOTTOM_OFFSET;

  const destination = route?.params?.destination || "Destino";
  const destinationAddress =
    route?.params?.destinationAddress || selectedDestination?.address || "";
  const destinationCoordinate =
    route?.params?.destinationCoordinate ||
    selectedDestination?.coordinate ||
    null;
  const originAddress =
    resolveMeaningfulAddress(route?.params?.originAddress, currentAddress) ||
    "Origem atual";
  const vehicle = route?.params?.vehicle || "Leaf Plus";
  const fare = route?.params?.fare || 22.43;
  const canRequestRide = Boolean(
    destinationCoordinate &&
    Number.isFinite(destinationCoordinate?.latitude) &&
    Number.isFinite(destinationCoordinate?.longitude),
  );
  const leafFee = resolveLeafFee(fare);
  const qaAutoConfirmPix = true;

  usePrototypeMapOcclusion({
    routeKey: route?.key,
    layerId: route?.key || "prototype-payment",
    occludedBottom: sheetBottom + cardHeight,
  });

  const handleDismiss = () => {
    if (navigation.canGoBack()) {
      navigation.goBack();
      return;
    }
    navigation.navigate("RobotaxiPrototype");
  };

  const handleCardLayout = useCallback((event) => {
    const nextHeight = event?.nativeEvent?.layout?.height;
    if (Number.isFinite(nextHeight) && nextHeight > 0) {
      setCardHeight(nextHeight);
    }
  }, []);

  useEffect(() => {
    if (!route?.params?.autoOpenPix) {
      return;
    }

    if (!canRequestRide) {
      return;
    }

    setPixModalVisible(true);
  }, [canRequestRide, route?.params?.autoOpenPix]);

  const handleOpenPixModal = useCallback(async () => {
    if (!canRequestRide) {
      Alert.alert(
        "Selecione um destino",
        "Defina um destino válido antes de confirmar o pagamento.",
      );
      return;
    }

    if (checkingAvailability || submitting) {
      return;
    }

    try {
      setCheckingAvailability(true);
      setAvailabilityNotice("");

      const availability = await checkRideAvailability({
        destination: {
          name: destination,
          address: destinationAddress,
          coordinate: destinationCoordinate,
        },
        vehicle,
      });

      if (!availability?.available) {
        setAvailabilityNotice("Não há motoristas disponíveis");
        return;
      }

      setPixModalVisible(true);
    } catch (error) {
      setAvailabilityNotice(
        error?.message || "Não foi possível validar disponibilidade agora.",
      );
    } finally {
      setCheckingAvailability(false);
    }
  }, [
    canRequestRide,
    checkRideAvailability,
    checkingAvailability,
    destination,
    destinationAddress,
    destinationCoordinate,
    submitting,
    vehicle,
  ]);

  const handleClosePixModal = useCallback(() => {
    if (submitting) {
      return;
    }
    setPixModalVisible(false);
  }, [submitting]);

  const handlePixPaymentConfirmed = useCallback(
    async (paymentConfirmation = null) => {
      if (!canRequestRide) {
        Alert.alert(
          "Selecione um destino",
          "Defina um destino válido antes de confirmar o pagamento.",
        );
        return;
      }

      try {
        setSubmitting(true);
        setPixModalVisible(false);
        await requestRide({
          destination: {
            name: destination,
            address: destinationAddress,
            coordinate: destinationCoordinate,
          },
          originAddress,
          vehicle,
          fare,
          paymentMethod: "pix",
          paymentConfirmation,
        });

        navigation.replace("RobotaxiPrototypePaymentSuccess", {
          destination,
          destinationAddress,
          originAddress,
          vehicle,
          autoAdvance: true,
        });
      } catch (error) {
        const normalizedCode = String(error?.code || "")
          .trim()
          .toUpperCase();
        const normalizedMessage = String(error?.message || "").toLowerCase();
        if (
          normalizedCode === "NO_DRIVERS_AVAILABLE" ||
          normalizedMessage.includes("não há motoristas") ||
          normalizedMessage.includes("nao ha motoristas")
        ) {
          const refundPayload = error?.payload || {};
          navigation.replace("RobotaxiPrototypeNoDrivers", {
            reason: error?.message || "Nenhum motorista disponível no momento.",
            refundStatus: refundPayload?.refundStatus || null,
            refundAmount: Number(refundPayload?.refundAmount || 0),
            cancellationFee: Number(refundPayload?.cancellationFee || 0),
            chargeId: refundPayload?.chargeId || null,
          });
          return;
        }

        navigation.replace("RobotaxiPrototypePaymentFailed", {
          errorMessage:
            error?.message || "Falha ao enviar a corrida para o servidor.",
          retryRouteName: "RobotaxiPrototypePayment",
          retryParams: {
            ...route?.params,
            destination,
            destinationAddress,
            destinationCoordinate,
            originAddress,
            vehicle,
            fare,
            autoOpenPix: true,
          },
        });
      } finally {
        setSubmitting(false);
      }
    },
    [
      canRequestRide,
      destination,
      destinationAddress,
      destinationCoordinate,
      fare,
      navigation,
      originAddress,
      requestRide,
      route?.params,
      vehicle,
    ],
  );

  return (
    <PrototypeScreenTransition>
      <View style={styles.container} pointerEvents="box-none">
        <StatusBar
          translucent
          backgroundColor="transparent"
          barStyle="dark-content"
        />
        <LeafStateHeader
          insetsTop={insets.top}
          title="Confirmar corrida"
          subtitle="Revise valor, tempo e pagamento antes de pedir."
        />

        <PrototypeDismissibleSheet
          onClose={handleDismiss}
          sheetStyle={[styles.sheetWrap, { bottom: sheetBottom }]}
        >
          <LeafRideSheet onLayout={handleCardLayout} style={styles.paymentCard}>
            <View style={styles.headerRow}>
              <Text style={styles.title}>Sua corrida</Text>
              <Text style={styles.price}>{formatCurrency(fare)}</Text>
            </View>

            <LeafDivider style={styles.divider} />

            <LeafMetricRow
              metrics={[
                { value: "4 min", label: "buscar" },
                { value: "2,8 km", label: "distancia" },
                {
                  value: leafFee == null ? "--" : formatCurrency(leafFee),
                  label: "taxa Leaf",
                },
              ]}
            />

            <LeafDivider style={styles.dividerLarge} />

            <LeafInfoRow
              marker="$"
              title="Pagamento via PIX"
              subtitle="QR Code no próximo passo"
              style={styles.paymentRow}
            />
            <SecurePaymentBadge style={styles.securePaymentBadge} />

            <Text style={styles.hiddenText}>{destination}</Text>
            <Text style={styles.hiddenText}>{vehicle}</Text>

            <View style={styles.actionsRow}>
              <LeafButton
                label="Editar"
                tone="ghost"
                onPress={handleDismiss}
                style={styles.editButton}
              />
              <LeafButton
                label={
                  submitting
                    ? "Enviando..."
                    : checkingAvailability
                      ? "Verificando..."
                      : canRequestRide
                        ? "Confirmar"
                        : "Sem destino"
                }
                tone="primary"
                testID="passenger-payment-pay-pix-button"
                accessibilityLabel="passenger-payment-pay-pix-button"
                disabled={submitting || checkingAvailability}
                onPress={handleOpenPixModal}
                style={styles.ctaButton}
              />
            </View>

            {!canRequestRide ? (
              <Text style={styles.pendingText}>
                Abra Para onde? e escolha o destino antes de pagar.
              </Text>
            ) : null}
            {availabilityNotice ? (
              <Text style={styles.pendingText}>{availabilityNotice}</Text>
            ) : null}

            {paymentState?.status === "pending" && paymentState?.error ? (
              <Text style={styles.pendingText}>
                Pagamento pendente de confirmação: {paymentState.error}
              </Text>
            ) : null}
          </LeafRideSheet>
        </PrototypeDismissibleSheet>

        <WooviPaymentModal
          visible={isPixModalVisible}
          onClose={handleClosePixModal}
          onPaymentConfirmed={handlePixPaymentConfirmed}
          tripData={{
            pickup: {
              add: originAddress,
              lat: currentCoordinate?.latitude,
              lng: currentCoordinate?.longitude,
            },
            drop: {
              add: destinationAddress || destination,
              lat: destinationCoordinate?.latitude,
              lng: destinationCoordinate?.longitude,
            },
            carType: vehicle,
            estimatedFare: Number(fare),
          }}
          estimates={{ estimateFare: Number(fare) }}
          passengerId={profileUid || "prototype-passenger"}
          passengerName={riderProfile?.name || "Passageira Leaf"}
          passengerEmail={riderProfile?.email || "passageiro@leaf.app.br"}
          qaAutoConfirm={qaAutoConfirmPix}
        />
      </View>
    </PrototypeScreenTransition>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "transparent",
  },
  sheetWrap: {
    position: "absolute",
    left: 0,
    right: 0,
  },
  paymentCard: {
    minHeight: 356,
    borderTopLeftRadius: 32,
    borderTopRightRadius: 32,
    borderBottomLeftRadius: 0,
    borderBottomRightRadius: 0,
    paddingHorizontal: 28,
    paddingTop: 16,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  title: {
    color: leafRideColors.text,
    fontFamily: fonts.Medium,
    fontSize: 20,
    lineHeight: 26,
  },
  price: {
    color: leafRideColors.text,
    fontFamily: fonts.Medium,
    fontSize: 22,
    lineHeight: 29,
  },
  divider: {
    marginTop: 16,
    marginBottom: 22,
  },
  dividerLarge: {
    marginTop: 28,
    marginBottom: 20,
  },
  paymentRow: {
    minHeight: 44,
  },
  securePaymentBadge: {
    marginTop: 4,
  },
  actionsRow: {
    marginTop: 22,
    flexDirection: "row",
    gap: 16,
  },
  editButton: {
    flex: 1,
    height: 46,
    borderRadius: 23,
  },
  ctaButton: {
    flex: 1.08,
    height: 46,
    borderRadius: 23,
  },
  pendingText: {
    marginTop: 10,
    color: leafRideColors.dangerText,
    fontFamily: fonts.Regular,
    fontSize: 11,
    lineHeight: 15,
    textAlign: "center",
  },
  hiddenText: {
    position: "absolute",
    width: 1,
    height: 1,
    opacity: 0,
  },
});
