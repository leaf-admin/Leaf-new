import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import leafTypography from '../../../components/prototype/LeafTypography';
import { LeafObjectIcon } from '../../../components/prototype/LeafVisualElements';

// Presentation only. Destination selection, voice and pickup keep the existing
// operational handlers; the map below is the existing Google Maps SDK instance.
export default function LeafPassengerLanding({ insets, pickupLabel, onDestinationPress, onVoicePress, onPickupPress, onSettingsPress, onRecenterPress, onMapFrame }) {
  return <View pointerEvents="box-none" style={[styles.container, { paddingTop: insets.top + 16, paddingBottom: insets.bottom + 84 }]} testID="leaf-passenger-landing">
    <View style={styles.header}>
      <Text style={styles.title} accessibilityRole="header">Viajar</Text>
      <TouchableOpacity style={styles.iconButton} onPress={onSettingsPress} accessibilityRole="button" accessibilityLabel="Preferências da viagem" testID="leaf-home-preferences">
        <Ionicons name="options-outline" size={22} color="#222222" />
      </TouchableOpacity>
    </View>
    <TouchableOpacity onPress={onDestinationPress} onLongPress={onVoicePress} activeOpacity={0.88}
      accessibilityRole="button" accessibilityLabel="Escolher destino da viagem" accessibilityHint="Toque e segure para ditar o destino por voz"
      testID="passenger-home-destination-input" style={styles.searchShadow}>
      <LinearGradient colors={['#FFFFFF', '#FFFFFF', '#F5F5F5']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.search}>
        <LinearGradient colors={['#545454', '#252525']} style={styles.lens}>
          <Ionicons name="search-outline" size={24} color="#FFFFFF" />
        </LinearGradient>
        <Text style={styles.searchTitle}>Para onde?</Text>
        <Text style={styles.now}>Agora</Text>
      </LinearGradient>
    </TouchableOpacity>
    <View pointerEvents="box-none" style={styles.mapFrame} testID="leaf-home-map-frame" onLayout={event => {
      const layout = event.nativeEvent.layout;
      onMapFrame?.({ left: layout.x, top: layout.y, width: layout.width, height: Math.max(0, layout.height - 58) });
    }}>
      <TouchableOpacity onPress={onRecenterPress} style={[styles.iconButton, styles.recenter]} accessibilityRole="button" accessibilityLabel="Centralizar mapa" testID="prototype-top-left-control">
        <Ionicons name="navigate" size={22} color="#222222" />
      </TouchableOpacity>
      <TouchableOpacity onPress={onPickupPress} style={styles.pickup} accessibilityRole="button" accessibilityLabel={`Alterar local de partida, ${pickupLabel || 'Local atual'}`} testID="passenger-home-pickup-input">
        <LeafObjectIcon name="places" size={30} />
        <View style={styles.pickupCopy}><Text style={styles.pickupDetail}>Seu embarque</Text><Text style={styles.pickupTitle} numberOfLines={1}>{pickupLabel || 'Local atual'}</Text></View>
        <Ionicons name="chevron-forward" size={13} color="#6A6A6A" />
      </TouchableOpacity>
    </View>
  </View>;
}

const styles = StyleSheet.create({
  container: { ...StyleSheet.absoluteFillObject, paddingHorizontal: 24, gap: 20 },
  header: { height: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { ...leafTypography.semiBold, fontSize: 26, lineHeight: 33, letterSpacing: -0.6, color: '#222222' },
  iconButton: { width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(255,255,255,0.94)', alignItems: 'center', justifyContent: 'center', shadowColor: '#000000', shadowOpacity: 0.07, shadowOffset: { width: 0, height: 8 }, shadowRadius: 18 },
  searchShadow: { borderRadius: 34, shadowColor: '#000000', shadowOpacity: 0.07, shadowOffset: { width: 0, height: 8 }, shadowRadius: 18, elevation: 3 },
  search: { minHeight: 64, borderRadius: 34, borderWidth: 0.7, borderColor: '#E5E5E5', paddingHorizontal: 12, paddingVertical: 11, flexDirection: 'row', gap: 12, alignItems: 'center' },
  lens: { width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#777777' },
  searchTitle: { ...leafTypography.semiBold, fontSize: 22, lineHeight: 28, letterSpacing: -0.45, color: '#222222', flex: 1 },
  now: { ...leafTypography.regular, fontSize: 12, lineHeight: 17, paddingHorizontal: 12, paddingVertical: 9, borderRadius: 20, backgroundColor: '#FFFFFF', color: '#222222' },
  mapFrame: { flex: 1, minHeight: 0, borderRadius: 24, borderWidth: 0.7, borderColor: '#E5E5E5', overflow: 'hidden' },
  recenter: { position: 'absolute', right: 12, top: 12 },
  pickup: { position: 'absolute', bottom: 0, left: 0, right: 0, minHeight: 58, paddingHorizontal: 15, flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: '#FFFFFF', borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#E5E5E5' },
  pickupCopy: { flex: 1, minWidth: 0, gap: 3 },
  pickupDetail: { ...leafTypography.regular, fontSize: 13, lineHeight: 18, color: '#6A6A6A' },
  pickupTitle: { ...leafTypography.medium, fontSize: 14, lineHeight: 19, color: '#222222' },
});
