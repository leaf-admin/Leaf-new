import React from 'react';
import { ActivityIndicator, Dimensions, Platform, ScrollView, StyleSheet, Text, TextInput, View, useWindowDimensions } from 'react-native';
import LeafTouchable from '../../../components/design-system/LeafTouchable';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import Animated, { Easing, FadeIn, FadeInDown, useReducedMotion } from 'react-native-reanimated';
import leafTypography from '../../../components/prototype/LeafTypography';
import { LeafObjectIcon } from '../../../components/prototype/LeafVisualElements';
import robotaxiPrototypeTokens from '../../../components/design-system/robotaxiPrototypeTokens';

const { motion } = robotaxiPrototypeTokens;
// The field keeps the landing pill's exact position, so the surface only fades
// in; it leaves instantly (a fade-out flashed the landing under the pickup map).
// The result list is the only element that travels in.
const surfaceEnter = FadeIn.duration(motion.timing.quick).easing(Easing.bezier(...motion.bezier.snappy));
const listEnter = FadeInDown.duration(motion.timing.standard).easing(Easing.bezier(...motion.bezier.snappy)).withInitialValues({ transform: [{ translateY: 12 }] });

// Layout for the existing home search. All query, result and voice handlers are
// supplied by PassengerHomeOverlay; this component does not call providers.
// Geometry mirrors LeafPassengerLanding (paddingTop, 44pt header, 20pt gap).
export default function LeafPassengerSearch({ kind, pickupLabel, query, results, searching, inputRef, onChange, onSubmit, onClose, onSelect, onVoice, onMap, keyboardHeight = 0 }) {
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const screenHeight = Dimensions.get('screen').height;
  // Android adjustResize already shrinks the window; only pad what still overlaps.
  const resized = Platform.OS === 'android' ? Math.max(0, screenHeight - height - insets.top - insets.bottom) : 0;
  const keyboardOverlap = Math.max(0, keyboardHeight - resized);
  const pickup = kind === 'pickup';
  const trimmedQuery = query.trim();
  const showingRecents = !pickup && !trimmedQuery && !searching && results.length > 0;
  // "No results" is only true once a search for this exact text has settled;
  // while the debounce is pending the honest state is "searching".
  const [settledQuery, setSettledQuery] = React.useState(null);
  const wasSearchingRef = React.useRef(false);
  React.useEffect(() => {
    if (wasSearchingRef.current && !searching) setSettledQuery(trimmedQuery);
    wasSearchingRef.current = searching;
  }, [searching, trimmedQuery]);
  const searchPending = trimmedQuery.length >= 3 && !searching && !results.length && settledQuery !== trimmedQuery;
  React.useEffect(() => {
    if (!searchPending) return undefined;
    // A search that never toggles `searching` (cache hit, error) must still settle.
    const timer = setTimeout(() => setSettledQuery(trimmedQuery), 2500);
    return () => clearTimeout(timer);
  }, [searchPending, trimmedQuery]);
  const showSearching = searching || searchPending;
  const prefix = `passenger-home-${pickup ? 'pickup' : 'destination'}`;
  const reduceMotion = useReducedMotion();
  return <Animated.View testID={`${prefix}-search-sheet`}
    entering={reduceMotion ? undefined : surfaceEnter}
    style={[styles.surface, { paddingTop: insets.top + 16, paddingBottom: keyboardOverlap || insets.bottom }]}>
    <View style={styles.heading}>
      <Text style={styles.title} accessibilityRole="header">{pickup ? 'Seu embarque' : 'Viajar'}</Text>
      <LeafTouchable onPress={onClose} style={styles.close} accessibilityRole="button" accessibilityLabel={`Fechar busca de ${pickup ? 'partida' : 'destino'}`} testID={`${prefix}-search-close`}>
        <Ionicons name="close" size={22} color="#222222" />
      </LeafTouchable>
    </View>
    <View style={styles.fieldShadow}>
      <View style={styles.field} testID={`${prefix}-input`} accessible={false}>
        <LinearGradient colors={['#545454', '#252525']} style={styles.lens}>
          <Ionicons name={pickup ? 'location-outline' : 'search-outline'} size={22} color="#FFFFFF" />
        </LinearGradient>
        <TextInput ref={inputRef} value={query} onChangeText={onChange} onSubmitEditing={onSubmit} autoFocus autoCorrect={false}
          autoCapitalize="none" blurOnSubmit={false} returnKeyType="search" submitBehavior="submit"
          style={styles.input} placeholder={pickup ? 'Endereço de partida' : 'Para onde?'} placeholderTextColor="#9A9A9A"
          testID={`${prefix}-search-input`} accessibilityLabel={pickup ? 'Buscar partida' : 'Buscar destino'} />
        {!pickup ? <LeafTouchable onPress={onVoice} style={styles.voice} accessibilityRole="button" accessibilityLabel="Ditar destino por voz" testID="passenger-home-destination-mic">
          <Ionicons name="mic-outline" size={20} color="#6A6A6A" />
        </LeafTouchable> : null}
      </View>
    </View>
    <Animated.View style={styles.body} entering={reduceMotion ? undefined : listEnter}>
      <Text style={styles.support} numberOfLines={1}>{pickup ? `Atual: ${pickupLabel || 'Local atual'}` : `Embarque em ${pickupLabel || 'Local atual'}`}</Text>
      <ScrollView style={styles.results} contentContainerStyle={styles.resultsContent} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" showsVerticalScrollIndicator={false} testID={`${prefix}-dropdown`}>
        {showingRecents ? <Text style={styles.sectionTitle} accessibilityRole="header" testID="passenger-home-destination-recents-heading">Destinos recentes</Text> : null}
        {showSearching ? <View style={styles.feedback}><ActivityIndicator color="#1A330E" /><Text style={styles.support}>Buscando…</Text></View> : results.map(({ item, display, distance }, index) =>
          <LeafTouchable key={item.id || index} onPress={() => onSelect?.(item)} style={styles.row} activeOpacity={0.84}
            testID={`${prefix}-result-${index}`} accessibilityRole="button" accessibilityLabel={`${showingRecents ? 'Destino recente' : `Resultado de ${pickup ? 'partida' : 'destino'} ${index + 1}`}: ${display.title}`} accessibilityHint={display.address}>
            <LeafObjectIcon name={showingRecents ? 'activity' : 'places'} size={36} />
            <View style={styles.copy}><View style={styles.resultTitleRow}><Text numberOfLines={1} style={styles.resultTitle}>{display.title}</Text>
              {distance ? <Text style={styles.distance}>{distance}</Text> : null}</View>
              {display.address ? <Text numberOfLines={2} style={styles.support}>{display.address}</Text> : null}</View>
            <Ionicons name="arrow-up-outline" size={16} color="#6A6A6A" style={{ transform: [{ rotate: '-45deg' }] }} />
          </LeafTouchable>)}
        {pickup && onMap ? <LeafTouchable onPress={onMap} style={styles.row} accessibilityRole="button" accessibilityLabel="Ajustar partida no mapa" testID="passenger-home-pickup-map-option">
          <LeafObjectIcon name="places" size={36} /><Text style={styles.resultTitle}>Ajustar no mapa</Text>
        </LeafTouchable> : null}
        {!showSearching && !results.length && (trimmedQuery || !pickup) ? <View style={styles.empty}>
          {trimmedQuery.length >= 3 ? <>
            <Text style={styles.resultTitle}>Nenhum lugar encontrado</Text>
            <Text style={styles.support}>Confira o nome ou tente outro endereço.</Text>
          </> : <Text style={styles.support}>{trimmedQuery ? 'Continue digitando para buscar.' : 'Busque um endereço ou lugar.'}</Text>}
        </View> : null}
      </ScrollView>
    </Animated.View>
  </Animated.View>;
}

const styles = StyleSheet.create({
  surface: { ...StyleSheet.absoluteFillObject, backgroundColor: '#FFFFFF', paddingHorizontal: 24, gap: 20 },
  heading: { height: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { ...leafTypography.semiBold, fontSize: 26, lineHeight: 33, letterSpacing: -0.6, color: '#222222', flex: 1 },
  close: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: '#F5F5F5' },
  fieldShadow: { borderRadius: 34, shadowColor: '#000000', shadowOpacity: 0.07, shadowOffset: { width: 0, height: 8 }, shadowRadius: 18, elevation: 3, backgroundColor: '#FFFFFF' },
  field: { minHeight: 64, borderRadius: 34, borderWidth: 0.7, borderColor: '#E5E5E5', paddingHorizontal: 12, paddingVertical: 11, flexDirection: 'row', gap: 12, alignItems: 'center', backgroundColor: '#FFFFFF' },
  lens: { width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#777777' },
  input: { ...leafTypography.medium, fontSize: 20, lineHeight: 26, color: '#222222', flex: 1, minWidth: 0, paddingVertical: 8 },
  voice: { width: 44, height: 44, justifyContent: 'center', alignItems: 'center' },
  body: { flex: 1, minHeight: 0, gap: 8 },
  support: { ...leafTypography.regular, fontSize: 14, lineHeight: 20, color: '#6A6A6A' },
  results: { flex: 1, minHeight: 0 },
  resultsContent: { paddingBottom: 16 },
  sectionTitle: { ...leafTypography.medium, fontSize: 13, lineHeight: 18, color: '#6A6A6A', marginTop: 8, marginBottom: 4 },
  row: { minHeight: 78, paddingVertical: 13, flexDirection: 'row', alignItems: 'center', gap: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#E5E5E5' },
  copy: { flex: 1, minWidth: 0, gap: 5 },
  resultTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  resultTitle: { ...leafTypography.semiBold, fontSize: 16, lineHeight: 22, color: '#222222', flexShrink: 1 },
  distance: { ...leafTypography.regular, fontSize: 12, lineHeight: 17, color: '#6A6A6A' },
  feedback: { minHeight: 78, flexDirection: 'row', gap: 12, alignItems: 'center' },
  empty: { alignItems: 'flex-start', gap: 8, paddingVertical: 16 },
});
