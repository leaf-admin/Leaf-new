import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { CommonActions } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { LeafObjectIcon } from '../../components/prototype/LeafVisualElements';
import leafTypography from '../../components/prototype/LeafTypography';
import { usePrototypeRideRuntime } from './prototypeRideRuntime';

export default function LeafSavedPlacePickerScreen({ navigation, route }) {
  const insets = useSafeAreaInsets();
  const { profileUid, loadDestinationSuggestions, loadRecentDestinations, resolveDestinationInput } = usePrototypeRideRuntime();
  const [query, setQuery] = useState('');
  const [retry, setRetry] = useState(0);
  const [state, setState] = useState({ uid: profileUid, items: [], loading: true, error: '' });
  const [resolving, setResolving] = useState(false);
  const ownerRef = useRef(profileUid);
  ownerRef.current = profileUid;
  const selectionRef = useRef(null);
  const validOwner = Boolean(profileUid && route?.params?.ownerUid === profileUid && route?.params?.returnRouteKey);
  const visible = state.uid === profileUid && validOwner ? state : { items: [], loading: false, error: 'A sessão mudou. Abra novamente seus endereços.' };
  const search = query.trim();

  useEffect(() => {
    let active = true;
    if (!validOwner) return undefined;
    setState({ uid: profileUid, items: [], loading: search.length === 0 || search.length >= 3, error: '' });
    const timer = setTimeout(async () => {
      if (search.length > 0 && search.length < 3) return;
      try {
        // Reuse Leaf's existing backend search policy and coordinate resolver.
        const items = search ? await loadDestinationSuggestions(search) : await loadRecentDestinations();
        if (active) setState({ uid: profileUid, items: Array.isArray(items) ? items : [], loading: false, error: '' });
      } catch {
        if (active) setState({ uid: profileUid, items: [], loading: false, error: 'Não foi possível buscar os endereços. Tente novamente.' });
      }
    }, search ? 350 : 0);
    return () => { active = false; clearTimeout(timer); };
  }, [validOwner, profileUid, search, retry, loadDestinationSuggestions, loadRecentDestinations]);

  useEffect(() => () => { if (selectionRef.current) selectionRef.current.cancelled = true; }, []);

  const select = async item => {
    if (!validOwner || selectionRef.current) return;
    const request = { uid: profileUid, cancelled: false };
    selectionRef.current = request;
    setResolving(true);
    try {
      // This resolver does not change the current ride or select a trip destination.
      const place = await resolveDestinationInput(item);
      if (!Number.isFinite(place?.coordinate?.latitude) || !Number.isFinite(place?.coordinate?.longitude)) throw new Error('Coordenada indisponível');
      if (request.cancelled || ownerRef.current !== request.uid) return;
      navigation.dispatch({
        ...CommonActions.setParams({ selectedSavedPlace: { ownerUid: request.uid, place } }),
        source: route.params.returnRouteKey,
      });
      navigation.goBack();
    } catch {
      if (!request.cancelled && ownerRef.current === request.uid) setState(current => ({ ...current, error: 'Não foi possível confirmar esse endereço. Escolha novamente.' }));
    } finally {
      if (selectionRef.current === request) selectionRef.current = null;
      if (!request.cancelled && ownerRef.current === request.uid) setResolving(false);
    }
  };

  return <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={[styles.page, { paddingTop: insets.top + 20, paddingBottom: insets.bottom + 20 }]} testID="leaf-saved-place-picker-screen">
    <View style={styles.header}>
      <TouchableOpacity style={styles.back} accessibilityRole="button" accessibilityLabel="Voltar" onPress={() => navigation.goBack()}><Ionicons name="arrow-back" size={22} color="#222222" /></TouchableOpacity>
      <Text style={styles.title}>Buscar endereço</Text>
    </View>
    <View style={styles.search}>
      <Ionicons name="search-outline" size={21} color="#222222" />
      <TextInput style={styles.input} value={query} onChangeText={setQuery} autoFocus placeholder="Rua, local ou endereço" accessibilityLabel="Buscar endereço" testID="leaf-place-search-input" autoCorrect={false} editable={validOwner && !resolving} maxLength={180} />
    </View>
    {visible.error ? <View accessibilityRole="alert"><Text style={styles.error}>{visible.error}</Text>{validOwner ? <TouchableOpacity onPress={() => setRetry(value => value + 1)} style={styles.retry} accessibilityRole="button"><Text style={styles.name}>Tentar novamente</Text></TouchableOpacity> : null}</View> : null}
    {visible.loading || resolving ? <ActivityIndicator style={styles.loading} color="#6A6A6A" accessibilityLabel={resolving ? 'Confirmando endereço' : 'Buscando endereços'} /> : null}
    <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
      {!search && visible.items.length ? <Text style={styles.detail}>Recentes</Text> : null}
      {visible.items.map((item, index) => <TouchableOpacity key={item.id || index} style={styles.row} onPress={() => select(item)} disabled={resolving || !validOwner} accessibilityRole="button" accessibilityLabel={item.address || item.name} testID={`leaf-place-search-result-${index}`}>
        <LeafObjectIcon name="places" size={40} /><View style={styles.copy}><Text style={styles.name}>{item.name || item.address}</Text>{item.address && item.address !== item.name ? <Text style={styles.detail}>{item.address}</Text> : null}</View><Ionicons name="chevron-forward" size={14} color="#6A6A6A" />
      </TouchableOpacity>)}
      {!visible.loading && !visible.error && !visible.items.length ? <Text style={styles.detail}>{search.length >= 3 ? 'Nenhum endereço encontrado. Tente outro nome.' : 'Digite pelo menos 3 caracteres para buscar.'}</Text> : null}
    </ScrollView>
  </KeyboardAvoidingView>;
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: '#FFFFFF', paddingHorizontal: 24 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 24 },
  back: { width: 44, height: 44, borderRadius: 22, backgroundColor: '#F5F5F5', alignItems: 'center', justifyContent: 'center' },
  title: { ...leafTypography.semiBold, fontSize: 22, lineHeight: 28, color: '#222222', flex: 1 },
  search: { minHeight: 54, borderRadius: 16, backgroundColor: '#F5F5F5', flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, gap: 12 },
  input: { ...leafTypography.regular, fontSize: 16, color: '#222222', flex: 1, paddingVertical: 14 },
  content: { paddingVertical: 24, gap: 16 },
  row: { minHeight: 72, flexDirection: 'row', alignItems: 'center', gap: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#E5E5E5', paddingVertical: 12 },
  copy: { flex: 1, gap: 4 },
  name: { ...leafTypography.semiBold, fontSize: 16, lineHeight: 22, color: '#222222' },
  detail: { ...leafTypography.regular, fontSize: 14, lineHeight: 20, color: '#6A6A6A' },
  error: { ...leafTypography.regular, fontSize: 14, lineHeight: 20, color: '#D7153A', marginTop: 16 },
  retry: { minHeight: 44, justifyContent: 'center' },
  loading: { marginTop: 20 },
});
