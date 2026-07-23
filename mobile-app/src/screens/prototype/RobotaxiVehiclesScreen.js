import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { fonts } from '../../theme/runtimeTokens';
import PrototypeDismissibleSheet from '../../components/prototype/PrototypeDismissibleSheet';
import PrototypeScreenTransition from '../../components/prototype/PrototypeScreenTransition';
import {
  PrototypeMenuCloseButton,
  PrototypeMenuSection,
  PrototypeMenuSurface,
} from '../../components/prototype/PrototypeMenuSurface';
import { LeafButton, LeafEmptyState, LeafPill, leafRideColors } from '../../components/prototype/LeafRideUI';
import { usePrototypeMapOcclusion } from './prototypeMapOcclusion';
import MobileVehicleService from '../../services/MobileVehicleService';

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

export default function RobotaxiVehiclesScreen({ navigation, route }) {
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();
  const [panelHeight, setPanelHeight] = useState(windowHeight);
  const [vehicles, setVehicles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState('list');
  const [expandedId, setExpandedId] = useState('');
  const [draft, setDraft] = useState({ plate: '', brand: '', model: '', color: '', year: '' });

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

  const loadVehicles = useCallback(async () => {
    try {
      setLoading(true);
      setError('');
      setVehicles(await MobileVehicleService.listVehicles());
    } catch (loadError) {
      setError(loadError?.message || 'Não foi possível carregar seus veículos.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadVehicles();
    const removeFocus = navigation?.addListener?.('focus', loadVehicles);
    return () => removeFocus?.();
  }, [loadVehicles, navigation]);

  const showMutationError = useCallback((mutationError) => {
    const message = mutationError?.code === 'DRIVER_MUST_BE_OFFLINE'
      ? 'Fique offline antes de alterar os veículos do perfil.'
      : mutationError?.message || 'Não foi possível atualizar o veículo.';
    Alert.alert('Veículos', message);
  }, []);

  const handleAddVehicle = useCallback(async () => {
    try {
      setBusy(true);
      const vehicle = await MobileVehicleService.addVehicle(draft);
      setDraft({ plate: '', brand: '', model: '', color: '', year: '' });
      setMode('list');
      setVehicles(previous => vehicle ? [vehicle, ...previous] : previous);
      await loadVehicles();
    } catch (mutationError) {
      showMutationError(mutationError);
    } finally {
      setBusy(false);
    }
  }, [draft, loadVehicles, showMutationError]);

  const handleSelectVehicle = useCallback(async (vehicleId) => {
    try {
      setBusy(true);
      await MobileVehicleService.selectVehicle(vehicleId);
      setVehicles(previous => previous.map(vehicle => ({ ...vehicle, isActive: vehicle.id === vehicleId })));
      setExpandedId('');
    } catch (mutationError) {
      showMutationError(mutationError);
    } finally {
      setBusy(false);
    }
  }, [showMutationError]);

  const handleRemoveVehicle = useCallback((vehicle) => {
    Alert.alert('Remover veículo', `Remover ${vehicle.model || 'este veículo'} do seu perfil?`, [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Remover',
        style: 'destructive',
        onPress: async () => {
          try {
            setBusy(true);
            await MobileVehicleService.removeVehicle(vehicle.id);
            setVehicles(previous => previous.filter(item => item.id !== vehicle.id));
            setExpandedId('');
          } catch (mutationError) {
            showMutationError(mutationError);
          } finally {
            setBusy(false);
          }
        },
      },
    ]);
  }, [showMutationError]);

  const canSubmit = Boolean(
    draft.plate.trim().length >= 7 &&
    draft.brand.trim() &&
    draft.model.trim() &&
    draft.color.trim() &&
    String(draft.year).trim().length === 4,
  );

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
            subtitle="Cadastre, selecione e acompanhe os carros vinculados ao seu perfil."
            fullScreen
            style={{
              paddingTop: insets.top + SURFACE_TOP_PADDING,
              paddingBottom: Math.max(insets.bottom, SURFACE_BOTTOM_PADDING),
            }}
            headerAccessory={(
              <PrototypeMenuCloseButton
                onPress={handleDismiss}
                testID="robotaxi-vehicles-close-button"
                accessibilityLabel="Fechar veículos"
              />
            )}
          >
            <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
              {loading ? (
                <View style={styles.centerState} testID="robotaxi-vehicles-loading"><ActivityIndicator color={leafRideColors.leaf} /></View>
              ) : error ? (
                <LeafEmptyState
                  icon="cloud-offline-outline"
                  title="Veículos indisponíveis"
                  message={error}
                  actionLabel="Tentar novamente"
                  onAction={loadVehicles}
                  testID="robotaxi-vehicles-error"
                />
              ) : mode === 'add' ? (
                <PrototypeMenuSection title="Novo veículo">
                  {[
                    ['plate', 'Placa', 'ABC1D23'],
                    ['brand', 'Marca', 'Nissan'],
                    ['model', 'Modelo', 'Leaf'],
                    ['color', 'Cor', 'Branco'],
                    ['year', 'Ano', '2025'],
                  ].map(([key, label, placeholder]) => (
                    <View key={key} style={styles.fieldWrap}>
                      <Text style={styles.fieldLabel}>{label}</Text>
                      <TextInput
                        value={String(draft[key] || '')}
                        onChangeText={value => setDraft(previous => ({ ...previous, [key]: value }))}
                        placeholder={placeholder}
                        autoCapitalize={key === 'plate' ? 'characters' : 'words'}
                        keyboardType={key === 'year' ? 'number-pad' : 'default'}
                        style={styles.fieldInput}
                        testID={`robotaxi-vehicle-input-${key}`}
                      />
                    </View>
                  ))}
                  <LeafButton label={busy ? 'Cadastrando...' : 'Cadastrar veículo'} icon="add-outline" tone="primary" disabled={!canSubmit || busy} onPress={handleAddVehicle} />
                  <TouchableOpacity onPress={() => setMode('list')} style={styles.secondaryAction}><Text style={styles.secondaryActionText}>Cancelar</Text></TouchableOpacity>
                </PrototypeMenuSection>
              ) : (
                <>
                  {vehicles.length === 0 ? (
                    <LeafEmptyState icon="car-outline" title="Nenhum veículo cadastrado" message="Adicione o primeiro carro para iniciar a análise documental." testID="robotaxi-vehicles-empty-state" />
                  ) : vehicles.map(vehicle => {
                    const expanded = expandedId === vehicle.id;
                    const status = formatVehicleStatus(vehicle.status);
                    return (
                      <View key={vehicle.id} style={styles.vehicleCard}>
                        <TouchableOpacity style={styles.vehicleHeader} onPress={() => setExpandedId(expanded ? '' : vehicle.id)} testID={`robotaxi-vehicle-${vehicle.id}`}>
                          <View style={styles.carGlyph}><Text style={styles.carGlyphText}>L</Text></View>
                          <View style={styles.vehicleCopy}>
                            <Text style={styles.vehicleModel} numberOfLines={1}>{[vehicle.brand, vehicle.model].filter(Boolean).join(' ') || 'Veículo'}</Text>
                            <Text style={styles.vehiclePlate}>{vehicle.plate || 'Placa pendente'} · {vehicle.year || 'Ano pendente'}</Text>
                          </View>
                          <LeafPill label={vehicle.isActive ? 'Selecionado' : status} tone={vehicle.isActive || status === 'Aprovado' ? 'leaf' : 'warning'} />
                        </TouchableOpacity>
                        {expanded ? (
                          <View style={styles.expandedActions}>
                            {!vehicle.isActive ? <LeafButton label={busy ? 'Selecionando...' : 'Selecionar veículo'} tone="primary" disabled={busy} onPress={() => handleSelectVehicle(vehicle.id)} /> : null}
                            <TouchableOpacity disabled={busy} onPress={() => handleRemoveVehicle(vehicle)} style={styles.secondaryAction}><Text style={styles.removeActionText}>Remover do perfil</Text></TouchableOpacity>
                          </View>
                        ) : null}
                      </View>
                    );
                  })}
                  {!expandedId ? <LeafButton label="Adicionar veículo" icon="add-outline" tone="primary" onPress={() => setMode('add')} style={styles.doneButton} /> : null}
                </>
              )}
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
  centerState: {
    minHeight: 180,
    alignItems: 'center',
    justifyContent: 'center',
  },
  fieldWrap: {
    gap: 7,
  },
  fieldLabel: {
    color: leafRideColors.secondary,
    fontFamily: fonts.Medium,
    fontSize: 12,
    lineHeight: 16,
  },
  fieldInput: {
    minHeight: 52,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: 'rgba(221,232,225,0.95)',
    backgroundColor: '#FFFFFF',
    color: leafRideColors.text,
    fontFamily: fonts.Regular,
    fontSize: 15,
    paddingHorizontal: 16,
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
    fontFamily: fonts.SemiBold,
    fontSize: 20,
    lineHeight: 27,
  },
  vehicleCopy: {
    flex: 1,
    minWidth: 150,
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
  expandedActions: {
    marginTop: 16,
    paddingTop: 16,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(221,232,225,0.95)',
    gap: 8,
  },
  secondaryAction: {
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryActionText: {
    color: leafRideColors.secondary,
    fontFamily: fonts.Medium,
    fontSize: 13,
    lineHeight: 18,
  },
  removeActionText: {
    color: '#9F2424',
    fontFamily: fonts.Medium,
    fontSize: 13,
    lineHeight: 18,
  },
});
