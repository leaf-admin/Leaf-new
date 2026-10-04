import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { LeafObjectIcon } from '../../components/prototype/LeafVisualElements';
import { LeafButton, LeafEmptyState } from '../../components/prototype/LeafRideUI';
import leafTypography from '../../components/prototype/LeafTypography';
import { usePrototypeRideRuntime } from './prototypeRideRuntime';
import { getSavedPlacesSnapshot, savePlace, removeSavedPlace, syncLocalSavedPlaces } from '../../services/SavedPlacesService';

export default function LeafSavedPlacesScreen({ navigation, route }) {
  const insets = useSafeAreaInsets();
  const { profileUid, loadRecentDestinations } = usePrototypeRideRuntime();
  const [state, setState] = useState({ uid: profileUid, places: [], localOnly: [], recent: [], busy: true, error: '', synced: false });
  const [selected, setSelected] = useState(null);
  const [label, setLabel] = useState('');
  const [editingId, setEditingId] = useState(null);
  const [adding, setAdding] = useState(false);
  const ownerRef = useRef(profileUid);
  ownerRef.current = profileUid;
  const mountedRef = useRef(false);
  const loadSequence = useRef(0);
  const visible = state.uid === profileUid ? state : { places: [], localOnly: [], recent: [], busy: true, error: '', synced: false };
  const { places, localOnly, recent, busy, error, synced } = visible;
  const load = useCallback(async () => {
    const owner = profileUid;
    const sequence = ++loadSequence.current;
    setState(current => ({ ...(current.uid === owner ? current : { places: [], recent: [], localOnly: [] }), uid: owner, busy: true, error: '' }));
    try {
      const [snapshot, destinations] = await Promise.all([getSavedPlacesSnapshot(owner), loadRecentDestinations()]);
      if (mountedRef.current && ownerRef.current === owner && loadSequence.current === sequence) setState({ uid: owner, ...snapshot, recent: destinations, busy: false });
    } catch (failure) {
      if (mountedRef.current && ownerRef.current === owner && loadSequence.current === sequence) setState(current => ({ ...current, error: failure.message || 'Não foi possível carregar os endereços.', busy: false }));
    }
  }, [profileUid, loadRecentDestinations]);
  useEffect(() => {
    mountedRef.current = true; setSelected(null); setAdding(false); setEditingId(null); load();
    return () => { mountedRef.current = false; };
  }, [load]);
  useEffect(() => {
    const selection = route?.params?.selectedSavedPlace;
    if (selection?.ownerUid === profileUid && selection.place?.coordinate) {
      setSelected(selection.place); setAdding(true);
      if (!editingId) setLabel(selection.place.name || '');
      navigation.setParams?.({ selectedSavedPlace: null });
    }
  }, [route?.params?.selectedSavedPlace, profileUid, navigation, editingId]);
  const mutate = async operation => {
    const owner = profileUid;
    loadSequence.current += 1;
    setState(current => ({ ...current, busy: true, error: '' }));
    try {
      const next = await operation();
      if (mountedRef.current && ownerRef.current === owner) {
        setState(current => ({ ...current, places: next, busy: false, localOnly: [], synced: true }));
        setSelected(null); setLabel(''); setEditingId(null); setAdding(false);
        await load();
      }
    } catch (failure) {
      if (mountedRef.current && ownerRef.current === owner) setState(current => ({ ...current, busy: false, error: failure.message }));
    }
  };
  const chooseAddress = () => navigation.push('LeafSavedPlacePicker', { ownerUid: profileUid, returnRouteKey: route?.key });
  const choose = place => { setSelected(place); setLabel(place.name || ''); };
  const edit = place => { choose(place); setEditingId(localOnly.some(item => item.id === place.id) ? null : place.id); setAdding(true); };
  const row = (place, index, saved) => <View key={place.id || index} style={styles.row}>
    <LeafObjectIcon name="places" size={40} />
    <TouchableOpacity style={styles.copy} accessibilityRole="button" accessibilityLabel={place.name || place.address} testID={`leaf-place-open-${index}`} disabled={busy} onPress={() => saved ? navigation.navigate('RobotaxiPrototypeDestination', { initialSelectedDestination: place }) : choose(place)}>
      <Text style={styles.name}>{place.name || place.address}</Text><Text style={styles.detail}>{place.address}</Text>
    </TouchableOpacity>
    {saved ? <View style={styles.actions}>
      <TouchableOpacity onPress={() => edit(place)} disabled={busy} style={styles.smallAction} accessibilityRole="button" accessibilityLabel={`Editar endereço ${place.name}`} testID={`leaf-place-edit-${index}`}><Ionicons name="pencil-outline" size={18} color="#6A6A6A" /></TouchableOpacity>
      <TouchableOpacity onPress={() => mutate(() => removeSavedPlace(profileUid, place.id))} disabled={busy} style={styles.smallAction} accessibilityRole="button" accessibilityLabel={`Remover endereço ${place.name}`} testID={`leaf-place-remove-${index}`}><Ionicons name="close" size={18} color="#6A6A6A" /></TouchableOpacity>
    </View> : <Ionicons name="chevron-forward" size={13} color="#6A6A6A" />}
  </View>;
  return <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={[styles.page, { paddingTop: insets.top + 20, paddingBottom: insets.bottom + 20 }]} testID="leaf-saved-places-screen">
    <View style={styles.header}><TouchableOpacity onPress={() => { if (selected || adding) { setSelected(null); setAdding(false); setEditingId(null); } else navigation.goBack(); }} style={styles.back} accessibilityRole="button" accessibilityLabel="Voltar"><Ionicons name="arrow-back" size={22} color="#222222" /></TouchableOpacity><Text style={styles.title}>Endereços salvos</Text></View>
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <Text style={styles.detail}>{synced ? 'Sincronizados com sua conta' : 'Salvos neste aparelho'}</Text>
      {error ? <View accessibilityRole="alert"><Text style={styles.error}>{error}</Text><LeafButton label="Tentar novamente" onPress={load} disabled={busy} /></View> : null}
      {busy && places.length ? <ActivityIndicator color="#6A6A6A" accessibilityLabel="Atualizando endereços" /> : null}
      {selected ? <>
        <Text style={styles.name}>{editingId ? 'Editar endereço' : 'Salvar endereço'}</Text>
        <View style={styles.row}><LeafObjectIcon name="places" size={48} /><Text style={[styles.detail, { flex: 1 }]}>{selected.address || selected.name}</Text></View>
        <TextInput value={label} onChangeText={setLabel} maxLength={80} placeholder="Casa, trabalho ou outro nome" style={styles.input} accessibilityLabel="Nome do endereço" testID="leaf-place-name-input" />
        <LeafButton label="Alterar endereço" tone="secondary" onPress={chooseAddress} disabled={busy} />
        <LeafButton label={busy ? 'Salvando…' : 'Salvar endereço'} onPress={() => mutate(() => savePlace(profileUid, selected, label, { id: editingId }))} disabled={busy || !label.trim()} />
      </> : adding ? <>
        <LeafButton label="Buscar endereço" onPress={chooseAddress} disabled={busy} />
        <Text style={styles.name}>Destinos recentes</Text>
        {recent.length ? recent.map((item, index) => row(item, index, false)) : <LeafEmptyState icon="location-outline" title="Nenhum destino recente" message="Busque um endereço para começar." />}
      </> : <>
        {places.map((item, index) => row(item, index, true))}
        {!places.length ? <LeafEmptyState icon="location-outline" loading={busy} title={busy ? 'Carregando endereços…' : 'Seus lugares, por perto'} message="Guarde os endereços que você usa com frequência." /> : null}
        {synced && localOnly.length ? <LeafButton label="Sincronizar endereços deste aparelho" tone="secondary" onPress={() => mutate(() => syncLocalSavedPlaces(profileUid))} disabled={busy} /> : null}
        <LeafButton label="Adicionar endereço" onPress={() => setAdding(true)} disabled={busy} />
      </>}
    </ScrollView>
  </KeyboardAvoidingView>;
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: '#FFFFFF', paddingHorizontal: 24 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 20 },
  back: { width: 44, height: 44, borderRadius: 22, backgroundColor: '#F5F5F5', alignItems: 'center', justifyContent: 'center' },
  title: { ...leafTypography.semiBold, fontSize: 22, lineHeight: 28, color: '#222222', flex: 1 },
  content: { gap: 24, paddingBottom: 32 },
  row: { minHeight: 68, flexDirection: 'row', gap: 10, alignItems: 'center', borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#E5E5E5' },
  copy: { flex: 1, gap: 5 }, name: { ...leafTypography.semiBold, fontSize: 16, lineHeight: 22, color: '#222222' },
  detail: { ...leafTypography.regular, fontSize: 14, lineHeight: 20, color: '#6A6A6A' },
  actions: { flexDirection: 'row' }, smallAction: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  input: { ...leafTypography.regular, fontSize: 16, color: '#222222', minHeight: 54, borderRadius: 14, backgroundColor: '#F5F5F5', paddingHorizontal: 16 },
  error: { ...leafTypography.regular, color: '#D7153A', fontSize: 14, lineHeight: 20 },
});
