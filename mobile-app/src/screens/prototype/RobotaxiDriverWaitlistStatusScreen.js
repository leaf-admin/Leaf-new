import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
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
  PrototypeMenuSection,
  PrototypeMenuStatRow,
  PrototypeMenuSurface,
} from '../../components/prototype/PrototypeMenuSurface';
import { LeafButton, LeafEmptyState, leafRideColors } from '../../components/prototype/LeafRideUI';
import { usePrototypeMapOcclusion } from './prototypeMapOcclusion';
import {
  joinDriverWaitlist,
  leaveDriverWaitlist,
  loadDriverWaitlistStatus,
} from '../../services/runtime/driverWaitlistService';

const SURFACE_TOP_PADDING = 16;
const SURFACE_BOTTOM_PADDING = 18;
const DEFAULT_CITY = 'Rio de Janeiro';

function normalizeStatus(status) {
  return String(status || 'none').trim().toLowerCase();
}

function resolveStatusCopy(status) {
  const normalized = normalizeStatus(status);
  if (normalized === 'pending') {
    return {
      label: 'Na fila',
      title: 'Sua vaga está na fila',
      subtitle: 'Avisamos assim que sua cidade liberar novos motoristas.',
      tone: 'leaf',
    };
  }
  if (normalized === 'approved') {
    return {
      label: 'Liberado',
      title: 'Tudo certo para dirigir',
      subtitle: 'Seu cadastro está aprovado. Você já pode seguir para ficar online.',
      tone: 'dark',
    };
  }
  if (normalized === 'rejected') {
    return {
      label: 'Revisar',
      title: 'Precisamos revisar alguns dados',
      subtitle: 'Confira as pendências e envie o que estiver faltando para continuar.',
      tone: 'warning',
    };
  }
  return {
    label: 'Disponível',
    title: 'Entre na lista da sua cidade',
    subtitle: 'Informe onde você quer operar para entrar na próxima leva de motoristas.',
    tone: 'ghost',
  };
}

function formatPosition(position) {
  const value = Number(position);
  return Number.isFinite(value) && value > 0 ? `#${value}` : '--';
}

function formatWaitTime(days) {
  const value = Number(days);
  if (!Number.isFinite(value) || value <= 0) return '--';
  if (value === 1) return '1 dia';
  return `${Math.round(value)} dias`;
}

function formatAvailableSlots(maxActiveDrivers, currentActiveDrivers) {
  const max = Number(maxActiveDrivers);
  const current = Number(currentActiveDrivers);
  if (!Number.isFinite(max) || !Number.isFinite(current)) return '--';
  return String(Math.max(0, max - current));
}

function formatCriteriaValue(value) {
  if (value === true) return 'ok';
  if (value === false) return 'pendente';
  return '--';
}

function buildStatusFromRouteParams(params = {}) {
  const waitListStatus = params.waitListStatus || params.status || null;
  const position = params.position || params.waitListPosition || null;
  const estimatedWaitTime = params.estimatedWaitTime || params.waitDays || null;
  const cityLabel = params.cityLabel || params.city || null;
  const cityKey = params.cityKey || cityLabel || null;

  if (!waitListStatus && !position && !estimatedWaitTime && !cityLabel) {
    return null;
  }

  return {
    waitListStatus: waitListStatus || 'none',
    position,
    estimatedWaitTime,
    city: cityLabel || cityKey ? { cityLabel: cityLabel || cityKey, cityKey: cityKey || cityLabel } : undefined,
    notificationType: params.notificationType || null,
    waitlistEvent: params.waitlistEvent || params.event || null,
  };
}

export default function RobotaxiDriverWaitlistStatusScreen({ navigation, route }) {
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();
  const [panelHeight, setPanelHeight] = useState(windowHeight);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState(() => buildStatusFromRouteParams(route?.params));
  const [city, setCity] = useState(route?.params?.city || DEFAULT_CITY);

  usePrototypeMapOcclusion({
    routeKey: route?.key,
    layerId: route?.key || 'driver-waitlist-status',
    occludedBottom: panelHeight,
  });

  const statusCopy = useMemo(
    () => resolveStatusCopy(status?.waitListStatus),
    [status?.waitListStatus],
  );
  const normalizedStatus = normalizeStatus(status?.waitListStatus);
  const cityLabel =
    status?.city?.cityLabel ||
    status?.city?.cityKey ||
    city ||
    DEFAULT_CITY;
  const canJoin = !busy && !loading && !['pending', 'approved'].includes(normalizedStatus);
  const canLeave = !busy && !loading && normalizedStatus === 'pending';

  const handleDismiss = useCallback(() => {
    if (navigation.canGoBack?.()) {
      navigation.goBack();
      return;
    }
    navigation.navigate('RobotaxiPrototype');
  }, [navigation]);

  const handlePanelLayout = useCallback((event) => {
    const nextHeight = event?.nativeEvent?.layout?.height;
    if (Number.isFinite(nextHeight) && nextHeight > 0) {
      setPanelHeight(nextHeight);
    }
  }, []);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const result = await loadDriverWaitlistStatus();
      setStatus(result || {});
      const nextCity =
        result?.city?.cityLabel ||
        result?.city?.cityKey ||
        result?.waitListCityLabel ||
        result?.waitListCityKey ||
        DEFAULT_CITY;
      setCity(nextCity);
    } catch (error) {
      Alert.alert('Lista de espera', error?.message || 'Não conseguimos carregar sua fila agora.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  useEffect(() => {
    const routeStatus = buildStatusFromRouteParams(route?.params);
    if (!routeStatus) {
      return;
    }

    setStatus((current) => ({
      ...(current || {}),
      ...routeStatus,
      city: routeStatus.city || current?.city,
    }));

    const nextCity = routeStatus.city?.cityLabel || routeStatus.city?.cityKey;
    if (nextCity) {
      setCity(nextCity);
    }
  }, [route?.params]);

  const handleJoin = useCallback(async () => {
    setBusy(true);
    try {
      const result = await joinDriverWaitlist({ city });
      setStatus((current) => ({
        ...(current || {}),
        ...result,
        waitListStatus: 'pending',
        position: result.position || current?.position || null,
        estimatedWaitTime: result.estimatedWaitTime || current?.estimatedWaitTime || null,
        city: result.city || current?.city || { cityLabel: city },
      }));
    } catch (error) {
      Alert.alert('Lista de espera', error?.message || 'Não conseguimos entrar na fila agora.');
    } finally {
      setBusy(false);
    }
  }, [city]);

  const handleLeave = useCallback(() => {
    Alert.alert(
      'Sair da lista?',
      'Você perde sua posição atual se sair agora.',
      [
        { text: 'Voltar', style: 'cancel' },
        {
          text: 'Sair',
          style: 'destructive',
          onPress: async () => {
            setBusy(true);
            try {
              await leaveDriverWaitlist();
              setStatus((current) => ({
                ...(current || {}),
                waitListStatus: 'none',
                position: null,
                estimatedWaitTime: null,
              }));
            } catch (error) {
              Alert.alert('Lista de espera', error?.message || 'Não conseguimos sair da fila agora.');
            } finally {
              setBusy(false);
            }
          },
        },
      ],
    );
  }, []);

  return (
    <PrototypeScreenTransition>
      <View style={styles.container} pointerEvents="box-none" testID="robotaxi-driver-waitlist-status-screen">
        <StatusBar translucent backgroundColor="transparent" barStyle="dark-content" />
        <PrototypeDismissibleSheet
          onClose={handleDismiss}
          backdropColor="transparent"
          dragEnabled={false}
          sheetStyle={styles.sheetWrap}
        >
          <PrototypeMenuSurface
            onLayout={handlePanelLayout}
            eyebrow="Motorista"
            title="Lista de espera"
            subtitle={statusCopy.subtitle}
            fullScreen
            style={{
              paddingTop: insets.top + SURFACE_TOP_PADDING,
              paddingBottom: Math.max(insets.bottom, SURFACE_BOTTOM_PADDING),
            }}
            headerAccessory={(
              <PrototypeMenuCloseButton
                onPress={handleDismiss}
                testID="robotaxi-driver-waitlist-status-close-button"
                accessibilityLabel="robotaxi-driver-waitlist-status-close-button"
              />
            )}
          >
            <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
              <PrototypeMenuStatRow
                items={[
                  { key: 'status', label: 'status', value: statusCopy.label, loading },
                  { key: 'position', label: 'posição', value: formatPosition(status?.position), loading },
                  { key: 'wait', label: 'estimativa', value: formatWaitTime(status?.estimatedWaitTime), loading },
                ]}
              />

              <View style={styles.statusCard}>
                <View style={styles.statusPill}>
                  <Text style={styles.statusPillText}>{statusCopy.label}</Text>
                </View>
                <Text style={styles.statusTitle}>{statusCopy.title}</Text>
                <Text style={styles.statusText}>
                  {normalizedStatus === 'approved'
                    ? 'Quando quiser, volte para a tela inicial do motorista e fique online.'
                    : 'A liberação considera cidade, capacidade operacional e revisão do cadastro.'}
                </Text>
                {status?.notificationType ? (
                  <Text style={styles.pushContextText}>
                    Aberto por notificação: {status.waitlistEvent || status.notificationType}
                  </Text>
                ) : null}
              </View>

              <View style={styles.inputBlock}>
                <Text style={styles.inputLabel}>Cidade de operação</Text>
                <TextInput
                  value={city}
                  onChangeText={setCity}
                  editable={canJoin}
                  placeholder={DEFAULT_CITY}
                  placeholderTextColor="rgba(93,106,99,0.55)"
                  style={[styles.input, !canJoin && styles.inputDisabled]}
                  testID="robotaxi-driver-waitlist-status-city-input"
                  accessibilityLabel="robotaxi-driver-waitlist-status-city-input"
                />
                {canJoin ? (
                  <LeafButton
                    label={busy ? 'Entrando...' : 'Entrar na lista'}
                    icon="time-outline"
                    tone="primary"
                    onPress={handleJoin}
                    disabled={busy}
                    style={styles.fullButton}
                    testID="robotaxi-driver-waitlist-status-join-button"
                    accessibilityLabel="robotaxi-driver-waitlist-status-join-button"
                  />
                ) : canLeave ? (
                  <LeafButton
                    label={busy ? 'Atualizando...' : 'Sair da lista'}
                    icon="close-circle-outline"
                    tone="ghost"
                    onPress={handleLeave}
                    disabled={busy}
                    style={styles.fullButton}
                    testID="robotaxi-driver-waitlist-status-leave-button"
                    accessibilityLabel="robotaxi-driver-waitlist-status-leave-button"
                  />
                ) : null}
              </View>

              <PrototypeMenuSection title="Status da cidade">
                <PrototypeMenuInfoRow label="Cidade" value={cityLabel} loading={loading} />
                <PrototypeMenuInfoRow
                  label="Na fila"
                  value={String(status?.city?.pendingDrivers ?? '--')}
                  loading={loading}
                />
                <PrototypeMenuInfoRow
                  label="Motoristas ativos"
                  value={String(status?.city?.approvedDrivers ?? status?.currentActiveDrivers ?? '--')}
                  loading={loading}
                />
                <PrototypeMenuInfoRow
                  label="Vagas disponíveis"
                  value={formatAvailableSlots(status?.maxActiveDrivers, status?.currentActiveDrivers)}
                  loading={loading}
                  last
                />
              </PrototypeMenuSection>

              <PrototypeMenuSection title="Critérios">
                <PrototypeMenuInfoRow
                  label="Cidade ativa"
                  value={formatCriteriaValue(status?.criteria?.cityActive ?? status?.city?.cityActive)}
                  loading={loading}
                />
                <PrototypeMenuInfoRow
                  label="Fila habilitada"
                  value={formatCriteriaValue(status?.criteria?.waitListEnabled ?? status?.waitListEnabled)}
                  loading={loading}
                />
                <PrototypeMenuInfoRow
                  label="CNH enviada"
                  value={formatCriteriaValue(status?.criteria?.cnhUploaded ?? status?.documentsStatus?.cnhUploaded)}
                  loading={loading}
                />
                <PrototypeMenuInfoRow
                  label="Veículo cadastrado"
                  value={formatCriteriaValue(status?.criteria?.vehicleRegistered ?? status?.documentsStatus?.vehicleRegistered)}
                  loading={loading}
                  last
                />
              </PrototypeMenuSection>

              {normalizedStatus === 'approved' ? (
                <LeafButton
                  label="Voltar para ficar online"
                  icon="car-outline"
                  tone="primary"
                  onPress={() => navigation.navigate('RobotaxiPrototype')}
                  style={styles.fullButton}
                  testID="robotaxi-driver-waitlist-status-online-button"
                  accessibilityLabel="robotaxi-driver-waitlist-status-online-button"
                />
              ) : null}

              {normalizedStatus === 'none' ? (
                <LeafEmptyState
                  icon="car-outline"
                  title="Sua cidade primeiro"
                  message="Entre na lista pelo app para acompanhar sua posição sem depender da landing."
                  testID="robotaxi-driver-waitlist-status-empty-state"
                />
              ) : null}
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
    paddingBottom: 30,
    gap: 18,
  },
  statusCard: {
    borderRadius: 24,
    borderWidth: 1,
    borderColor: 'rgba(221,232,225,0.85)',
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 18,
    paddingVertical: 18,
  },
  statusPill: {
    alignSelf: 'flex-start',
    borderRadius: 999,
    backgroundColor: leafRideColors.leafLight,
    paddingHorizontal: 11,
    paddingVertical: 6,
  },
  statusPillText: {
    color: leafRideColors.leaf,
    fontFamily: fonts.SemiBold,
    fontSize: 11,
    lineHeight: 14,
  },
  statusTitle: {
    marginTop: 14,
    color: leafRideColors.text,
    fontFamily: fonts.SemiBold,
    fontSize: 20,
    lineHeight: 26,
  },
  statusText: {
    marginTop: 8,
    color: leafRideColors.secondary,
    fontFamily: fonts.Regular,
    fontSize: 14,
    lineHeight: 20,
  },
  pushContextText: {
    marginTop: 10,
    color: leafRideColors.leaf,
    fontFamily: fonts.Medium,
    fontSize: 12,
    lineHeight: 17,
  },
  inputBlock: {
    borderRadius: 24,
    borderWidth: 1,
    borderColor: 'rgba(221,232,225,0.85)',
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 18,
    paddingVertical: 16,
  },
  inputLabel: {
    color: leafRideColors.secondary,
    fontFamily: fonts.Medium,
    fontSize: 11,
    lineHeight: 15,
  },
  input: {
    marginTop: 8,
    minHeight: 46,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#E9E2D8',
    paddingHorizontal: 13,
    color: leafRideColors.text,
    fontFamily: fonts.Medium,
    fontSize: 14,
  },
  inputDisabled: {
    backgroundColor: '#F7F8F4',
    color: leafRideColors.secondary,
  },
  fullButton: {
    marginTop: 12,
  },
});
