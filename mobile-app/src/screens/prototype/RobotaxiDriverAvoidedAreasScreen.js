import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Easing,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import MapView, { Circle, Polygon, PROVIDER_GOOGLE } from 'react-native-maps';
import * as Location from 'expo-location';
import * as Haptics from 'expo-haptics';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import leafTypography from '../../components/prototype/LeafTypography';
import mapStyleAppleLike from '../../components/prototype/mapStyleAppleLike';
import { RobotaxiLifecycleButton } from '../../components/prototype/RobotaxiLifecycleUI';
import { robotaxiPrototypeTokens } from '../../components/design-system/robotaxiPrototypeTokens';
import { usePrototypeRideRuntime } from './prototypeRideRuntime';
import {
  fetchDriverAvoidedAreas,
  saveDriverAvoidedAreas,
} from '../../services/DriverAvoidedAreasService';
import {
  AVOIDED_AREA_SIZES,
  DEFAULT_AVOIDED_AREA_LIMITS,
  buildAvoidedAreaLabel,
  buildAvoidedAreasSummary,
  canAddAvoidedArea,
  describeAvoidedAreaLimit,
  resolveAvoidedAreaSize,
} from './driverAvoidedAreas';

const { color } = robotaxiPrototypeTokens;
const AVOID_FILL = 'rgba(215,21,58,0.16)';
const AVOID_STROKE = 'rgba(215,21,58,0.85)';
const PREVIEW_FILL = 'rgba(26,51,14,0.10)';
const PREVIEW_STROKE = 'rgba(26,51,14,0.55)';
// Rio de Janeiro, usado só enquanto a posição do motorista não é conhecida.
const FALLBACK_CENTER = { latitude: -22.9068, longitude: -43.1729 };

function cameraAt(center, zoom) {
  return { center, zoom, pitch: 0, heading: 0 };
}

function haptic(kind) {
  try {
    if (kind === 'success') {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } else if (kind === 'warning') {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    } else {
      Haptics.selectionAsync();
    }
  } catch (_error) {
    // sem retorno tátil neste aparelho
  }
}

export default function RobotaxiDriverAvoidedAreasScreen({ navigation }) {
  const insets = useSafeAreaInsets();
  const { currentCoordinate, driverCoordinate } = usePrototypeRideRuntime();
  const startCenter = useMemo(() => {
    const candidate = driverCoordinate || currentCoordinate;
    return Number.isFinite(Number(candidate?.latitude)) && Number.isFinite(Number(candidate?.longitude))
      ? { latitude: Number(candidate.latitude), longitude: Number(candidate.longitude) }
      : FALLBACK_CENTER;
    // A tela abre onde o motorista está; depois o mapa é dele.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const mapRef = useRef(null);
  const [center, setCenter] = useState(startCenter);
  const [ringSize, setRingSize] = useState(1);
  const [areas, setAreas] = useState([]);
  const [limits, setLimits] = useState(DEFAULT_AVOIDED_AREA_LIMITS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [moving, setMoving] = useState(false);
  const pinLift = useRef(new Animated.Value(0)).current;
  const mountedRef = useRef(true);
  const settleTimerRef = useRef(null);

  useEffect(() => () => {
    mountedRef.current = false;
    clearTimeout(settleTimerRef.current);
  }, []);

  // No Android o mapa nem sempre avisa que parou; sem o temporizador o pino ficava
  // "no ar" e o botão desabilitado.
  const settleAt = useCallback((region) => {
    clearTimeout(settleTimerRef.current);
    if (!mountedRef.current) return;
    setMoving(false);
    if (Number.isFinite(region?.latitude) && Number.isFinite(region?.longitude)) {
      setCenter({ latitude: region.latitude, longitude: region.longitude });
    }
  }, []);
  const handleRegionChange = useCallback((region) => {
    setMoving(true);
    clearTimeout(settleTimerRef.current);
    settleTimerRef.current = setTimeout(() => settleAt(region), 260);
  }, [settleAt]);

  const applyServerState = useCallback((payload) => {
    setAreas(Array.isArray(payload?.areas) ? payload.areas : []);
    setLimits({
      maxCells: Number(payload?.maxCells) || DEFAULT_AVOIDED_AREA_LIMITS.maxCells,
      maxAreas: Number(payload?.maxAreas) || DEFAULT_AVOIDED_AREA_LIMITS.maxAreas,
    });
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setMessage('');
    const payload = await fetchDriverAvoidedAreas();
    if (!mountedRef.current) return;
    if (payload?.success) {
      applyServerState(payload);
    } else {
      setMessage('Não foi possível carregar suas áreas. Verifique a conexão e tente novamente.');
    }
    setLoading(false);
  }, [applyServerState]);

  useEffect(() => { load(); }, [load]);

  // O pino levanta enquanto o mapa se move e assenta quando ele para.
  useEffect(() => {
    Animated.timing(pinLift, {
      toValue: moving ? 1 : 0,
      duration: moving ? 120 : 220,
      easing: moving ? Easing.out(Easing.quad) : Easing.out(Easing.back(2)),
      useNativeDriver: true,
    }).start();
  }, [moving, pinLift]);

  const selectedSize = resolveAvoidedAreaSize(ringSize);
  const addCheck = canAddAvoidedArea(areas, ringSize, limits);
  const busy = loading || saving;

  const persist = useCallback(async (nextAreas, successMessage) => {
    setSaving(true);
    setMessage('');
    const payload = await saveDriverAvoidedAreas(nextAreas);
    if (!mountedRef.current) return false;
    setSaving(false);
    if (payload?.success) {
      applyServerState(payload);
      setMessage(successMessage);
      haptic('success');
      return true;
    }
    setMessage(describeAvoidedAreaLimit(payload?.code));
    haptic('warning');
    return false;
  }, [applyServerState]);

  const handleAdd = useCallback(async () => {
    if (busy) return;
    if (!addCheck.ok) {
      setMessage(describeAvoidedAreaLimit(addCheck.reason));
      haptic('warning');
      return;
    }
    let label = `Área ${areas.length + 1}`;
    try {
      const reverse = await Location.reverseGeocodeAsync(center);
      label = buildAvoidedAreaLabel(reverse, areas.length + 1);
    } catch (_error) {
      // sem nome do lugar: fica o rótulo numerado
    }
    await persist(
      [
        ...areas,
        {
          id: `area_${Date.now().toString(36)}`,
          label,
          center: { lat: center.latitude, lng: center.longitude },
          ringSize,
        },
      ],
      `${label} marcada. Você não recebe corridas com embarque ou destino aí.`,
    );
  }, [addCheck, areas, busy, center, persist, ringSize]);

  const handleRemove = useCallback((area) => {
    if (busy) return;
    persist(
      areas.filter((item) => item.id !== area.id),
      `${area.label || 'Área'} removida.`,
    );
  }, [areas, busy, persist]);

  const handleFocusArea = useCallback((area) => {
    const lat = Number(area?.center?.lat);
    const lng = Number(area?.center?.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
    haptic('selection');
    mapRef.current?.animateCamera?.(
      cameraAt({ latitude: lat, longitude: lng }, resolveAvoidedAreaSize(area.ringSize).mapZoom),
      { duration: 420 },
    );
  }, []);

  const handleSelectSize = useCallback((nextRing) => {
    if (nextRing === ringSize) return;
    haptic('selection');
    setRingSize(nextRing);
    mapRef.current?.animateCamera?.(
      cameraAt(center, resolveAvoidedAreaSize(nextRing).mapZoom),
      { duration: 320 },
    );
  }, [center, ringSize]);

  const pinStyle = {
    transform: [
      { translateY: pinLift.interpolate({ inputRange: [0, 1], outputRange: [0, -10] }) },
      { scale: pinLift.interpolate({ inputRange: [0, 1], outputRange: [1, 1.08] }) },
    ],
  };
  const pinShadowStyle = {
    opacity: pinLift.interpolate({ inputRange: [0, 1], outputRange: [0.28, 0.14] }),
    transform: [{ scale: pinLift.interpolate({ inputRange: [0, 1], outputRange: [1, 1.5] }) }],
  };

  return (
    <View style={styles.page} testID="driver-avoided-areas-screen">
      <MapView
        ref={mapRef}
        style={StyleSheet.absoluteFill}
        provider={PROVIDER_GOOGLE}
        customMapStyle={mapStyleAppleLike}
        initialCamera={cameraAt(startCenter, selectedSize.mapZoom)}
        onRegionChange={handleRegionChange}
        onRegionChangeComplete={settleAt}
        rotateEnabled={false}
        pitchEnabled={false}
        toolbarEnabled={false}
        showsCompass={false}
        showsBuildings={false}
        showsTraffic={false}
        showsIndoors={false}
        showsUserLocation
        showsMyLocationButton={false}
        mapPadding={{ top: insets.top + 64, right: 0, bottom: 300, left: 0 }}
      >
        {areas.flatMap((area) =>
          (Array.isArray(area.outline) ? area.outline : []).map((ring, index) => (
            <Polygon
              key={`${area.id}-${index}`}
              coordinates={ring}
              fillColor={AVOID_FILL}
              strokeColor={AVOID_STROKE}
              strokeWidth={2}
            />
          )),
        )}
        {moving ? null : (
          <Circle
            center={center}
            radius={selectedSize.previewRadiusMeters}
            fillColor={PREVIEW_FILL}
            strokeColor={PREVIEW_STROKE}
            strokeWidth={1.5}
          />
        )}
      </MapView>

      <View
        pointerEvents="none"
        style={[styles.pinLayer, { paddingTop: insets.top + 64, paddingBottom: 300 }]}
      >
        <View style={styles.pinBox}>
          <Animated.View style={[styles.pinShadow, pinShadowStyle]} />
          <Animated.View style={pinStyle}>
            <Ionicons name="remove-circle" size={34} color={color.feedback.danger} />
          </Animated.View>
        </View>
      </View>

      <View style={[styles.header, { top: insets.top + 12 }]}>
        <TouchableOpacity
          style={styles.back}
          accessibilityRole="button"
          accessibilityLabel="Voltar"
          testID="driver-avoided-areas-back"
          onPress={() => navigation.goBack()}
        >
          <Ionicons name="arrow-back" size={22} color={color.text.primary} />
        </TouchableOpacity>
        <View style={styles.headerPill}>
          <Text style={styles.headerPillText} numberOfLines={1}>
            {loading ? 'Carregando…' : buildAvoidedAreasSummary(areas)}
          </Text>
        </View>
      </View>

      <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, 12) + 12 }]}>
        <Text style={styles.title}>Áreas a evitar</Text>
        <Text style={styles.subtitle}>
          Mova o mapa até o lugar e marque. Você não recebe corridas com embarque ou destino nessas áreas.
        </Text>

        <View style={styles.sizes} accessibilityRole="radiogroup">
          {AVOIDED_AREA_SIZES.map((size) => {
            const selected = size.ringSize === ringSize;
            return (
              <TouchableOpacity
                key={size.ringSize}
                activeOpacity={0.86}
                style={[styles.size, selected && styles.sizeSelected]}
                onPress={() => handleSelectSize(size.ringSize)}
                accessibilityRole="radio"
                accessibilityState={{ selected }}
                accessibilityLabel={`${size.label}, ${size.detail}`}
                testID={`driver-avoided-areas-size-${size.ringSize}`}
              >
                <Text style={[styles.sizeLabel, selected && styles.sizeLabelSelected]}>{size.label}</Text>
                <Text style={[styles.sizeDetail, selected && styles.sizeDetailSelected]} numberOfLines={1}>
                  {size.detail}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>

        <RobotaxiLifecycleButton
          label={saving ? 'Salvando…' : 'Evitar esta área'}
          icon={saving ? undefined : 'remove-circle-outline'}
          tone="primary"
          disabled={busy || moving}
          onPress={handleAdd}
          testID="driver-avoided-areas-add"
          style={styles.addButton}
        />

        {message ? (
          <Text style={styles.message} accessibilityLiveRegion="polite" testID="driver-avoided-areas-message">
            {message}
          </Text>
        ) : null}

        {loading ? (
          <ActivityIndicator style={styles.loading} color={color.text.secondary} />
        ) : areas.length ? (
          <ScrollView
            style={styles.list}
            contentContainerStyle={styles.listContent}
            showsVerticalScrollIndicator={false}
          >
            {areas.map((area) => (
              <View key={area.id} style={styles.row}>
                <TouchableOpacity
                  style={styles.rowMain}
                  activeOpacity={0.8}
                  onPress={() => handleFocusArea(area)}
                  accessibilityRole="button"
                  accessibilityLabel={`Ver ${area.label || 'área'} no mapa`}
                >
                  <View style={styles.rowDot} />
                  <View style={styles.rowCopy}>
                    <Text style={styles.rowTitle} numberOfLines={1}>{area.label || 'Área'}</Text>
                    <Text style={styles.rowDetail} numberOfLines={1}>
                      {resolveAvoidedAreaSize(area.ringSize).label} · {resolveAvoidedAreaSize(area.ringSize).detail}
                    </Text>
                  </View>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.rowRemove}
                  onPress={() => handleRemove(area)}
                  disabled={busy}
                  accessibilityRole="button"
                  accessibilityLabel={`Remover ${area.label || 'área'}`}
                  testID={`driver-avoided-areas-remove-${area.id}`}
                >
                  <Ionicons name="close" size={18} color={color.text.secondary} />
                </TouchableOpacity>
              </View>
            ))}
          </ScrollView>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: color.bg.map },
  pinLayer: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
  pinBox: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  pinShadow: {
    position: 'absolute',
    bottom: 0,
    width: 14,
    height: 5,
    borderRadius: 7,
    backgroundColor: '#000000',
  },
  header: { position: 'absolute', left: 16, right: 16, flexDirection: 'row', alignItems: 'center', gap: 12 },
  back: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: color.surface.primary,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000000',
    shadowOpacity: 0.12,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,
  },
  headerPill: {
    minHeight: 36,
    paddingHorizontal: 14,
    borderRadius: 18,
    backgroundColor: color.surface.primary,
    justifyContent: 'center',
    shadowColor: '#000000',
    shadowOpacity: 0.1,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 3,
  },
  headerPillText: { ...leafTypography.semiBold, fontSize: 13, lineHeight: 18, color: color.text.primary },
  sheet: {
    position: 'absolute',
    left: 12,
    right: 12,
    bottom: 12,
    borderRadius: 28,
    backgroundColor: color.surface.primary,
    paddingHorizontal: 20,
    paddingTop: 20,
    shadowColor: '#000000',
    shadowOpacity: 0.14,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 10 },
    elevation: 12,
  },
  title: { ...leafTypography.semiBold, fontSize: 20, lineHeight: 26, color: color.text.primary },
  subtitle: { ...leafTypography.regular, fontSize: 13, lineHeight: 19, color: color.text.secondary, marginTop: 4 },
  sizes: { flexDirection: 'row', gap: 8, marginTop: 16 },
  size: {
    flex: 1,
    minHeight: 54,
    borderRadius: 16,
    backgroundColor: color.surface.secondary,
    paddingHorizontal: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sizeSelected: { backgroundColor: color.accent.primary },
  sizeLabel: { ...leafTypography.semiBold, fontSize: 14, lineHeight: 18, color: color.text.primary },
  sizeLabelSelected: { color: color.accent.contrast },
  sizeDetail: { ...leafTypography.regular, fontSize: 11, lineHeight: 15, color: color.text.secondary, marginTop: 1 },
  sizeDetailSelected: { color: 'rgba(255,255,255,0.78)' },
  addButton: { marginTop: 12 },
  message: { ...leafTypography.regular, fontSize: 12, lineHeight: 17, color: color.text.secondary, marginTop: 10 },
  loading: { marginTop: 14, marginBottom: 6 },
  list: { maxHeight: 132, marginTop: 10 },
  listContent: { gap: 2 },
  row: { minHeight: 52, flexDirection: 'row', alignItems: 'center' },
  rowMain: { flex: 1, minHeight: 52, flexDirection: 'row', alignItems: 'center', gap: 12 },
  rowDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: color.feedback.danger },
  rowCopy: { flex: 1, minWidth: 0 },
  rowTitle: { ...leafTypography.semiBold, fontSize: 14, lineHeight: 19, color: color.text.primary },
  rowDetail: { ...leafTypography.regular, fontSize: 12, lineHeight: 16, color: color.text.secondary },
  rowRemove: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
