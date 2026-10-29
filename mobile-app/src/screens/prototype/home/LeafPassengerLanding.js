import React, { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Pressable, StyleSheet, Text, View } from 'react-native';
import LeafTouchable from '../../../components/design-system/LeafTouchable';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import leafTypography from '../../../components/prototype/LeafTypography';

// O mapa é o fundo da tela (2026-10-14). Título e busca flutuam por cima com um véu
// branco no topo para leitura; "Seu embarque" fica preso ao ponto de embarque no
// mapa, logo abaixo dele. Seleção de destino, voz e embarque usam os handlers de antes.
const PICKUP_LABEL_GAP = 18;

function PickupMapLabel({ anchor, moving, label, onPress }) {
  const [width, setWidth] = useState(0);
  const opacity = useRef(new Animated.Value(0)).current;
  const lift = useRef(new Animated.Value(6)).current;
  const visible = Boolean(anchor) && !moving;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(opacity, { toValue: visible ? 1 : 0, duration: visible ? 220 : 120, useNativeDriver: true }),
      Animated.timing(lift, {
        toValue: visible ? 0 : 6,
        duration: visible ? 260 : 120,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
    ]).start();
  }, [lift, opacity, visible]);

  if (!anchor) return null;
  return (
    <Animated.View
      pointerEvents={visible ? 'box-none' : 'none'}
      style={[
        styles.pickupLabelWrap,
        { left: anchor.x - width / 2, top: anchor.y + PICKUP_LABEL_GAP, opacity, transform: [{ translateY: lift }] },
      ]}
      onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
    >
      <Pressable
        onPress={() => {
          Haptics.selectionAsync().catch(() => {});
          onPress?.();
        }}
        accessibilityRole="button"
        accessibilityLabel={`Alterar local de partida, ${label || 'Local atual'}`}
        testID="passenger-home-pickup-input"
        style={({ pressed }) => [styles.pickupLabel, pressed && styles.pickupLabelPressed]}
      >
        <Text style={styles.pickupDetail}>Seu embarque</Text>
        <View style={styles.pickupRow}>
          <Text style={styles.pickupTitle} numberOfLines={1}>{label || 'Local atual'}</Text>
          <Ionicons name="chevron-forward" size={12} color="#6A6A6A" />
        </View>
      </Pressable>
    </Animated.View>
  );
}

export default function LeafPassengerLanding({
  insets,
  pickupLabel,
  pickupAnchor = null,
  mapMoving = false,
  onDestinationPress,
  onVoicePress,
  onPickupPress,
  onSettingsPress,
  onRecenterPress,
}) {
  return <View pointerEvents="box-none" style={StyleSheet.absoluteFill} testID="leaf-passenger-landing">
    <LinearGradient
      pointerEvents="none"
      colors={['rgba(255,255,255,0.96)', 'rgba(255,255,255,0.82)', 'rgba(255,255,255,0)']}
      locations={[0, 0.62, 1]}
      style={[styles.topVeil, { height: insets.top + 190 }]}
    />
    <View pointerEvents="box-none" style={[styles.top, { paddingTop: insets.top + 16 }]}>
      <View style={styles.header}>
        <Text style={styles.title} accessibilityRole="header">Viajar</Text>
        <LeafTouchable style={styles.iconButton} onPress={onSettingsPress} accessibilityRole="button" accessibilityLabel="Configurações" testID="leaf-home-preferences">
          {/* Configurações do app (notificações, idioma, privacidade): engrenagem, não filtros. */}
          <Ionicons name="settings-outline" size={22} color="#222222" />
        </LeafTouchable>
      </View>
      <LeafTouchable onPress={onDestinationPress} onLongPress={onVoicePress} activeOpacity={0.88}
        accessibilityRole="button" accessibilityLabel="Escolher destino da viagem" accessibilityHint="Toque e segure para ditar o destino por voz"
        testID="passenger-home-destination-input" style={styles.searchShadow}>
        <View style={styles.search}>
          <View style={styles.lens}>
            <Ionicons name="search-outline" size={22} color="#FFFFFF" />
          </View>
          <Text style={styles.searchTitle}>Para onde?</Text>
          <Text style={styles.now}>Agora</Text>
        </View>
      </LeafTouchable>
    </View>

    <PickupMapLabel anchor={pickupAnchor} moving={mapMoving} label={pickupLabel} onPress={onPickupPress} />

    <LeafTouchable
      onPress={onRecenterPress}
      style={[styles.iconButton, styles.recenter, { bottom: insets.bottom + 96 }]}
      accessibilityRole="button"
      accessibilityLabel="Centralizar mapa"
      testID="prototype-top-left-control"
    >
      <Ionicons name="navigate-outline" size={21} color="#222222" />
    </LeafTouchable>
  </View>;
}

const styles = StyleSheet.create({
  topVeil: { position: 'absolute', top: 0, left: 0, right: 0 },
  top: { paddingHorizontal: 24, gap: 18 },
  header: { height: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { ...leafTypography.semiBold, fontSize: 26, lineHeight: 33, letterSpacing: -0.6, color: '#222222' },
  iconButton: {
    width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(255,255,255,0.97)',
    alignItems: 'center', justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(17,20,16,0.08)',
    shadowColor: '#0E1F12', shadowOpacity: 0.18, shadowOffset: { width: 0, height: 8 }, shadowRadius: 18, elevation: 9,
  },
  searchShadow: { borderRadius: 32, shadowColor: '#0E1F12', shadowOpacity: 0.16, shadowOffset: { width: 0, height: 10 }, shadowRadius: 22, elevation: 10 },
  search: {
    minHeight: 60, borderRadius: 32, backgroundColor: 'rgba(255,255,255,0.98)',
    borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(17,20,16,0.08)',
    paddingHorizontal: 10, paddingVertical: 9, flexDirection: 'row', gap: 12, alignItems: 'center',
  },
  lens: { width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center', backgroundColor: '#222222' },
  searchTitle: { ...leafTypography.semiBold, fontSize: 21, lineHeight: 27, letterSpacing: -0.4, color: '#222222', flex: 1 },
  now: { ...leafTypography.regular, fontSize: 12, lineHeight: 17, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 18, backgroundColor: '#F2F4EF', color: '#222222' },
  recenter: { position: 'absolute', right: 20 },
  pickupLabelWrap: { position: 'absolute', maxWidth: 260 },
  pickupLabel: {
    paddingHorizontal: 12, paddingVertical: 7, borderRadius: 14, backgroundColor: 'rgba(255,255,255,0.98)',
    borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(17,20,16,0.08)',
    shadowColor: '#12261A', shadowOpacity: 0.12, shadowOffset: { width: 0, height: 3 }, shadowRadius: 10, elevation: 4,
    alignItems: 'center',
  },
  pickupLabelPressed: { transform: [{ scale: 0.97 }] },
  pickupDetail: { ...leafTypography.regular, fontSize: 11, lineHeight: 14, color: '#6A6A6A' },
  pickupRow: { flexDirection: 'row', alignItems: 'center', gap: 4, maxWidth: 236 },
  pickupTitle: { ...leafTypography.semiBold, fontSize: 13, lineHeight: 18, color: '#222222', flexShrink: 1 },
});
