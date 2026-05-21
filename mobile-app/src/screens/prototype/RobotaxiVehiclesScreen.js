import React, { useCallback, useMemo, useState } from 'react';
import {
  Alert,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { fonts } from '../../theme/runtimeTokens';
import PrototypeDismissibleSheet from '../../components/prototype/PrototypeDismissibleSheet';
import PrototypeScreenTransition from '../../components/prototype/PrototypeScreenTransition';
import {
  PrototypeMenuCloseButton,
  PrototypeMenuInfoRow,
  PrototypeMenuRow,
  PrototypeMenuSection,
  PrototypeMenuSurface,
} from '../../components/prototype/PrototypeMenuSurface';
import { LeafButton, LeafEmptyState, LeafPill, leafRideColors } from '../../components/prototype/LeafRideUI';
import { usePrototypeMapOcclusion } from './prototypeMapOcclusion';
import { usePrototypeRideRuntime } from './prototypeRideRuntime';

const SURFACE_TOP_PADDING = 16;
const SURFACE_BOTTOM_PADDING = 18;
const BACKDROP_COLOR = 'transparent';

function formatVehicleStatus(status) {
  const normalized = String(status || '').trim().toLowerCase();
  if (normalized === 'approved' || normalized === 'aprovado') return 'Aprovado';
  if (normalized === 'failed' || normalized === 'rejected' || normalized === 'revisar') return 'Revisar';
  if (normalized === 'in_review' || normalized === 'review' || normalized === 'em validação') return 'Em validação';
  return 'Pendente';
}

function resolveVehicle(runtime) {
  const remoteVehicle =
    runtime.driverActivationRemote?.vehicle ||
    runtime.driverActivationRemote?.summary?.vehicle ||
    runtime.driverActivationRemote?.documents?.crlv?.data ||
    runtime.driverActivationRemote?.documents?.crlv?.extractedData ||
    {};
  const activeRide = runtime.driverActiveRide || {};
  const rawVehicleStatus =
    remoteVehicle.status ||
    runtime.driverActivationRemote?.documents?.crlv?.status ||
    runtime.documentAnalysisState?.byType?.crlv?.status ||
    runtime.driverActivationRemote?.vehicleStatus;
  return {
    model:
      remoteVehicle.modelo ||
      remoteVehicle.model ||
      activeRide.vehicleModel ||
      runtime.selectedVehicle ||
      'Veículo principal',
    plate:
      remoteVehicle.placa ||
      remoteVehicle.plate ||
      activeRide.vehiclePlate ||
      activeRide.plate ||
      'Placa pendente',
    year: remoteVehicle.anoModelo || remoteVehicle.ano || remoteVehicle.year || 'Ano pendente',
    status: formatVehicleStatus(rawVehicleStatus),
  };
}

export default function RobotaxiVehiclesScreen({ navigation, route }) {
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();
  const [panelHeight, setPanelHeight] = useState(windowHeight);
  const runtime = usePrototypeRideRuntime();
  const vehicle = useMemo(() => resolveVehicle(runtime), [runtime]);
  const vehicleApproved = vehicle.status === 'Aprovado';

  usePrototypeMapOcclusion({
    routeKey: route?.key,
    layerId: route?.key || 'prototype-vehicles',
    occludedBottom: panelHeight,
  });

  const handleDismiss = useCallback(() => {
    if (navigation.canGoBack?.()) {
      navigation.goBack();
      return;
    }
    navigation.navigate('RobotaxiPrototype');
  }, [navigation]);

  const handlePanelLayout = useCallback(event => {
    const nextHeight = event?.nativeEvent?.layout?.height;
    if (Number.isFinite(nextHeight) && nextHeight > 0) {
      setPanelHeight(nextHeight);
    }
  }, []);

  const handleAddVehicle = useCallback(() => {
    Alert.alert(
      'Cadastro de veículo',
      'Para evitar dados divergentes, o cadastro e a revisão do veículo entram pelo fluxo de ativação do motorista.',
      [
        { text: 'Voltar', style: 'cancel' },
        { text: 'Abrir ativação', onPress: () => navigation.navigate('RobotaxiPrototypeDriverActivation') },
      ],
    );
  }, [navigation]);

  return (
    <PrototypeScreenTransition>
      <View style={styles.container} pointerEvents="box-none" testID="robotaxi-vehicles-screen">
        <StatusBar translucent backgroundColor="transparent" barStyle="dark-content" />
        <PrototypeDismissibleSheet
          onClose={handleDismiss}
          backdropColor={BACKDROP_COLOR}
          dragEnabled={false}
          sheetStyle={styles.sheetWrap}
        >
          <PrototypeMenuSurface
            onLayout={handlePanelLayout}
            eyebrow="Motorista"
            title="Veículos"
            subtitle="Consulte o carro autorizado para operar na Leaf."
            fullScreen
            style={{
              paddingTop: insets.top + SURFACE_TOP_PADDING,
              paddingBottom: Math.max(insets.bottom, SURFACE_BOTTOM_PADDING),
            }}
            headerAccessory={(
              <PrototypeMenuCloseButton
                onPress={handleDismiss}
                testID="robotaxi-vehicles-close-button"
                accessibilityLabel="robotaxi-vehicles-close-button"
              />
            )}
          >
            <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
              <View style={styles.vehicleCard}>
                <View style={styles.vehicleHeader}>
                  <View style={styles.carGlyph}>
                    <Text style={styles.carGlyphText}>L</Text>
                  </View>
                  <View style={styles.vehicleCopy}>
                    <Text style={styles.vehicleModel} numberOfLines={1}>
                      {vehicle.model}
                    </Text>
                    <Text style={styles.vehiclePlate} numberOfLines={1}>
                      {vehicle.plate}
                    </Text>
                  </View>
                  <View style={styles.vehicleStatusWrap}>
                    <LeafPill label={vehicle.status} tone={vehicleApproved ? 'leaf' : 'warning'} />
                  </View>
                </View>
              </View>

              <PrototypeMenuSection title="Dados do veículo">
                <PrototypeMenuInfoRow label="Modelo" value={vehicle.model} />
                <PrototypeMenuInfoRow label="Placa" value={vehicle.plate} />
                <PrototypeMenuInfoRow label="Ano" value={String(vehicle.year)} />
                <PrototypeMenuInfoRow label="Documento" value={vehicle.status} last />
              </PrototypeMenuSection>

              <PrototypeMenuSection title="Gestão">
                <PrototypeMenuRow
                  icon="document-text-outline"
                  title="Revisar CRLV"
                  subtitle="Atualize documento pela ativação"
                  onPress={() => navigation.navigate('RobotaxiPrototypeDriverActivation')}
                />
                <PrototypeMenuRow
                  icon="shield-checkmark-outline"
                  title="Regras do veículo"
                  subtitle="Placa e modelo precisam estar aprovados antes de ficar online"
                  last
                  trailing={null}
                />
              </PrototypeMenuSection>

              {!vehicleApproved ? (
                <LeafEmptyState
                  icon="car-outline"
                  title="Veículo em validação"
                  message="Assim que CRLV e dados forem aprovados, o carro fica pronto para operar."
                  testID="robotaxi-vehicles-empty-state"
                />
              ) : null}

              <LeafButton
                label="Adicionar ou trocar veículo"
                icon="add-outline"
                tone="primary"
                onPress={handleAddVehicle}
                style={styles.doneButton}
              />
            </ScrollView>
          </PrototypeMenuSurface>
        </PrototypeDismissibleSheet>
      </View>
    </PrototypeScreenTransition>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  sheetWrap: {
    ...StyleSheet.absoluteFillObject,
  },
  content: {
    paddingTop: 18,
    paddingBottom: 34,
    gap: 18,
  },
  vehicleCard: {
    borderRadius: 26,
    borderWidth: 1,
    borderColor: 'rgba(221,232,225,0.85)',
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 18,
    paddingVertical: 18,
  },
  vehicleHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 14,
  },
  carGlyph: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: leafRideColors.leafLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  carGlyphText: {
    color: leafRideColors.leaf,
    fontFamily: fonts.Bold,
    fontSize: 20,
    lineHeight: 27,
  },
  vehicleCopy: {
    flex: 1,
    minWidth: 150,
  },
  vehicleStatusWrap: {
    alignSelf: 'flex-start',
  },
  vehicleModel: {
    color: leafRideColors.text,
    fontFamily: fonts.SemiBold,
    fontSize: 16,
    lineHeight: 22,
  },
  vehiclePlate: {
    marginTop: 2,
    color: leafRideColors.secondary,
    fontFamily: fonts.Medium,
    fontSize: 12,
    lineHeight: 16,
  },
  doneButton: {
    alignSelf: 'stretch',
  },
});
