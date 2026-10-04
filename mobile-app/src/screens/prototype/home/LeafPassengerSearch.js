import React from 'react';
import { ActivityIndicator, Dimensions, Platform, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import leafTypography from '../../../components/prototype/LeafTypography';
import { LeafObjectIcon } from '../../../components/prototype/LeafVisualElements';

// Layout for the existing home search. All query, result and voice handlers are
// supplied by PassengerHomeOverlay; this component does not call providers.
export default function LeafPassengerSearch({ kind, pickupLabel, query, results, searching, inputRef, onChange, onSubmit, onClose, onSelect, onVoice, onMap, onLayout, keyboardHeight = 0 }) {
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const screenHeight = Dimensions.get('screen').height;
  const resized = Platform.OS === 'android' ? Math.max(0, screenHeight - height - insets.top - insets.bottom) : 0;
  const keyboardOverlap = Math.max(0, keyboardHeight - resized);
  const available = Math.max(220, height - insets.top - 16 - keyboardOverlap);
  const pickup = kind === 'pickup';
  const trimmedQuery = query.trim();
  const showingRecents = !pickup && !trimmedQuery && !searching && results.length > 0;
  const visibleRows = searching ? 1 : results.length + (pickup && onMap ? 1 : 0);
  const contentHeight = Math.max(300, 224 + insets.bottom + visibleRows * 78 + (showingRecents ? 22 : 0));
  const restingHeight = Math.min(Math.max(300, height * 0.58), contentHeight);
  const sheetHeight = Math.min(available, restingHeight);
  const prefix = `passenger-home-${pickup ? 'pickup' : 'destination'}`;
  return <View onLayout={onLayout} testID={`${prefix}-search-sheet`} style={[styles.sheet, { bottom: keyboardOverlap, height: sheetHeight, paddingBottom: keyboardOverlap ? 12 : 24 + insets.bottom }]}>
    <View style={styles.handle} pointerEvents="none" />
    <View style={styles.heading}>
      <Text style={styles.title} accessibilityRole="header">{pickup ? 'Seu embarque' : 'Para onde?'}</Text>
      <TouchableOpacity onPress={onClose} style={styles.close} accessibilityRole="button" accessibilityLabel={`Fechar busca de ${pickup ? 'partida' : 'destino'}`} testID={`${prefix}-search-close`}>
        <Ionicons name="close" size={18} color="#222222" />
      </TouchableOpacity>
    </View>
    <Text style={styles.support} numberOfLines={1}>{pickup ? 'Escolha seu ponto de partida.' : `Embarque em ${pickupLabel || 'Local atual'}`}</Text>
    <View style={styles.field} testID={`${prefix}-input`} accessible={false}>
      <Ionicons name="search-outline" size={23} color="#222222" />
      <TextInput ref={inputRef} value={query} onChangeText={onChange} onSubmitEditing={onSubmit} autoFocus autoCorrect={false}
        autoCapitalize="none" blurOnSubmit={false} returnKeyType="search" submitBehavior="submit"
        style={styles.input} placeholder="Endereço ou lugar" placeholderTextColor="#9A9A9A"
        testID={`${prefix}-search-input`} accessibilityLabel={pickup ? 'Buscar partida' : 'Buscar destino'} />
      {!pickup ? <TouchableOpacity onPress={onVoice} style={styles.voice} accessibilityRole="button" accessibilityLabel="Ditar destino por voz" testID="passenger-home-destination-mic">
        <Ionicons name="mic-outline" size={20} color="#6A6A6A" />
      </TouchableOpacity> : null}
    </View>
    <ScrollView style={styles.results} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} testID={`${prefix}-dropdown`}>
      {showingRecents ? <Text style={styles.sectionTitle} accessibilityRole="header" testID="passenger-home-destination-recents-heading">Destinos recentes</Text> : null}
      {searching ? <View style={styles.feedback}><ActivityIndicator color="#1A330E" /><Text style={styles.support}>Buscando…</Text></View> : results.map(({ item, display, distance }, index) =>
        <TouchableOpacity key={item.id || index} onPress={() => onSelect?.(item)} style={styles.row} activeOpacity={0.84}
          testID={`${prefix}-result-${index}`} accessibilityRole="button" accessibilityLabel={`${showingRecents ? 'Destino recente' : `Resultado de ${pickup ? 'partida' : 'destino'} ${index + 1}`}: ${display.title}`} accessibilityHint={display.address}>
          <LeafObjectIcon name={showingRecents ? 'activity' : 'places'} size={36} />
          <View style={styles.copy}><View style={styles.resultTitleRow}><Text numberOfLines={1} style={styles.resultTitle}>{display.title}</Text>
            {distance ? <Text style={styles.distance}>{distance}</Text> : null}</View>
            {display.address ? <Text numberOfLines={2} style={styles.support}>{display.address}</Text> : null}</View>
          <Ionicons name="arrow-up-outline" size={16} color="#6A6A6A" style={{ transform: [{ rotate: '-45deg' }] }} />
        </TouchableOpacity>)}
      {pickup && onMap ? <TouchableOpacity onPress={onMap} style={styles.row} accessibilityRole="button" accessibilityLabel="Ajustar partida no mapa" testID="passenger-home-pickup-map-option">
        <LeafObjectIcon name="places" size={36} /><Text style={styles.resultTitle}>Ajustar no mapa</Text>
      </TouchableOpacity> : null}
      {!searching && !results.length && (trimmedQuery || !pickup) ? <View style={styles.empty}>
        {trimmedQuery.length >= 3 ? <>
          <Text style={styles.resultTitle}>Nenhum lugar encontrado</Text>
          <Text style={styles.support}>Confira o nome ou tente outro endereço.</Text>
        </> : <Text style={styles.support}>{trimmedQuery ? 'Continue digitando para buscar.' : 'Busque um endereço ou lugar.'}</Text>}
      </View> : null}
    </ScrollView>
  </View>;
}

const styles = StyleSheet.create({
  sheet: { position: 'absolute', left: 0, right: 0, backgroundColor: '#FFFFFF', borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingHorizontal: 24, paddingTop: 14, shadowColor: '#000000', shadowOpacity: 0.08, shadowOffset: { width: 0, height: -6 }, shadowRadius: 24, elevation: 8 },
  handle: { width: 32, height: 3, borderRadius: 2, backgroundColor: '#E5E5E5', alignSelf: 'center', marginBottom: 16 },
  heading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { ...leafTypography.semiBold, fontSize: 22, lineHeight: 28, color: '#222222', flex: 1, letterSpacing: -0.45 },
  close: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  support: { ...leafTypography.regular, fontSize: 14, lineHeight: 20, color: '#6A6A6A' },
  field: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 54, paddingHorizontal: 15, marginTop: 16, marginBottom: 16, backgroundColor: '#F5F5F5', borderRadius: 15 },
  input: { ...leafTypography.regular, fontSize: 16, lineHeight: 22, color: '#222222', flex: 1, minWidth: 0, paddingVertical: 14 },
  voice: { width: 44, height: 44, justifyContent: 'center', alignItems: 'center' },
  results: { flex: 1, minHeight: 0 },
  sectionTitle: { ...leafTypography.medium, fontSize: 13, lineHeight: 18, color: '#6A6A6A', marginBottom: 4 },
  row: { minHeight: 78, paddingVertical: 13, flexDirection: 'row', alignItems: 'center', gap: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#E5E5E5' },
  copy: { flex: 1, minWidth: 0, gap: 5 },
  resultTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  resultTitle: { ...leafTypography.semiBold, fontSize: 16, lineHeight: 22, color: '#222222', flexShrink: 1 },
  distance: { ...leafTypography.regular, fontSize: 12, lineHeight: 17, color: '#6A6A6A' },
  feedback: { minHeight: 78, flexDirection: 'row', gap: 12, alignItems: 'center' },
  empty: { alignItems: 'flex-start', gap: 8, paddingVertical: 16 },
});
