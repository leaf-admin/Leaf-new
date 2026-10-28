import React, { useState } from 'react';
import { Image, Platform, StyleSheet, Text, View } from 'react-native';
import { Feather, Ionicons } from '@expo/vector-icons';
import MaskedView from '@react-native-masked-view/masked-view';
import Svg, { Circle, Defs, Image as SvgImage, LinearGradient as SvgLinearGradient, Mask, Path, Rect, Stop } from 'react-native-svg';
import { LinearGradient } from 'expo-linear-gradient';
import leafTypography from './LeafTypography';
import LeafCardMaterial, { useLeafCardTilt } from './LeafCardMaterial';
import Animated, { useAnimatedStyle } from 'react-native-reanimated';

// Ícones de traço fino numa família só (Feather, a base da Lucide), uma cor, sem
// círculo nem preenchimento (2026-10-28: o círculo verde com sombra cheia ficava
// "candy"). Mesmos nomes de antes, então todos os usos mudam juntos.
export const LEAF_GLYPH_COLOR = '#222222';

const objects = {
  account: 'user',
  activity: 'clock',
  payment: 'credit-card',
  help: 'help-circle',
  settings: 'settings',
  privacy: 'shield',
  documents: 'file-text',
  vehicle: 'car',
  places: 'map-pin',
  invites: 'users',
  achievements: 'award',
  language: 'globe',
  lock: 'lock',
  trash: 'trash-2',
  map: 'map',
  navigate: 'navigation',
  voice: 'volume-2',
  layers: 'layers',
  analytics: 'bar-chart-2',
  notifications: 'bell',
  logout: 'log-out',
  home: 'home',
  tabActivity: 'clock',
  tabAccount: 'user',
};

// Nomes do Ionicons que as telas ainda passam em `symbol`.
const symbols = {
  'person-outline': 'user', 'person-circle-outline': 'user',
  'time-outline': 'clock', 'wallet-outline': 'credit-card',
  'help-circle-outline': 'help-circle', 'shield-checkmark-outline': 'shield',
  'settings-outline': 'settings', 'document-text-outline': 'file-text',
  'car-outline': 'car', 'people-outline': 'users',
  'notifications-outline': 'bell', 'log-out-outline': 'log-out',
  'trash-outline': 'trash-2', 'language-outline': 'globe',
  'volume-medium-outline': 'volume-2',
  'information-circle-outline': 'info', 'server-outline': 'database',
  'options-outline': 'sliders', 'share-social-outline': 'share-2',
  'lock-closed-outline': 'lock', 'shield-outline': 'shield',
  'card-outline': 'credit-card', 'business-outline': 'briefcase',
  'car-sport-outline': 'car', 'refresh-outline': 'refresh-cw',
  'download-outline': 'download', 'mail-outline': 'mail',
  'location-outline': 'map-pin',
  'receipt-outline': 'file-text', 'map-outline': 'map',
  'chatbubble-ellipses-outline': 'message-circle', 'clipboard-outline': 'clipboard',
  'analytics-outline': 'bar-chart-2', 'calendar-outline': 'calendar',
  'cloud-offline-outline': 'cloud-off', 'leaf-outline': 'user',
  'cloud-upload-outline': 'upload-cloud', 'sync-outline': 'refresh-cw',
  'id-card-outline': 'credit-card', 'scan-outline': 'maximize',
  'checkmark-circle-outline': 'check-circle',
  'ribbon-outline': 'award',
  'navigate-outline': 'navigation',
  'layers-outline': 'layers',
  'call-outline': 'phone', 'briefcase-outline': 'briefcase',
  'warning-outline': 'alert-triangle',
};

// O Feather não tem carro: desenho no mesmo grid de 24 e traço 2 da família.
function LeafCarGlyph({ size, color }) {
  return <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    <Path d="M19 17h2c.6 0 1-.4 1-1v-3c0-.9-.7-1.7-1.5-1.9C18.7 10.6 16 10 16 10s-1.3-1.4-2.2-2.3c-.5-.4-1.1-.7-1.8-.7H5c-.6 0-1.1.4-1.4.9l-1.4 2.9A3.7 3.7 0 0 0 2 12v4c0 .6.4 1 1 1h2" />
    <Circle cx={7} cy={17} r={2} />
    <Path d="M9 17h6" />
    <Circle cx={17} cy={17} r={2} />
  </Svg>;
}

export function LeafGlyph({ name, size = 20, color = LEAF_GLYPH_COLOR }) {
  if (name === 'car') return <LeafCarGlyph size={size} color={color} />;
  return <Feather name={name} size={size} color={color} />;
}

// `size` é a caixa que a tela reserva; o traço fica centrado nela.
export function LeafObjectIcon({ name, symbol, size = 44, color = LEAF_GLYPH_COLOR }) {
  const glyph = objects[name] || symbols[symbol];
  const iconSize = Math.max(20, Math.round(size * 0.5));
  return (
    <View accessible={false} style={[styles.lineIcon, { width: size, height: size }]}>
      {glyph
        ? <LeafGlyph name={glyph} size={iconSize} color={color} />
        : <Ionicons name={symbol || 'ellipse-outline'} size={iconSize} color={color} />}
    </View>
  );
}

const LEAF_BRAND_IMAGE = require('../../../assets/leaf-ui/leafBrandTransparent.png');

// Cada plataforma com a técnica que ela desenha: no iOS a máscara de SVG com imagem
// não aparecia (o cartão do passageiro ficava sem logo); no Android a MaskedView some
// dentro do cartão inclinado em 3D.
function LeafBrandMark() {
  if (Platform.OS === 'android') {
    return <Svg width={62} height={32} viewBox="0 0 62 32" accessible={false}>
      <Defs>
        <SvgLinearGradient id="leafBrandColor" x1="0" y1="0" x2="1" y2="0">
          <Stop offset="0" stopColor="#00B410" /><Stop offset="1" stopColor="#75D83B" />
        </SvgLinearGradient>
        <Mask id="leafBrandShape" x="0" y="0" width="62" height="32" maskUnits="userSpaceOnUse">
          <SvgImage href={LEAF_BRAND_IMAGE} x={-10} y={-25} width={82} height={82} />
        </Mask>
      </Defs>
      <Rect width={62} height={32} fill="url(#leafBrandColor)" mask="url(#leafBrandShape)" />
    </Svg>;
  }
  return <MaskedView
    style={styles.brandMark}
    accessible={false}
    maskElement={<Image source={LEAF_BRAND_IMAGE} style={styles.brandMarkImage} />}
  >
    <LinearGradient colors={['#00B410', '#75D83B']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={StyleSheet.absoluteFill} />
  </MaskedView>;
}

// Time since account creation ("4 meses", "1 ano", "Novo"); "—" when unknown.
export function formatLeafMembership(joined) {
  const rawDate = joined?.toDate ? joined.toDate() : typeof joined === 'number' ? new Date(joined < 100000000000 ? joined * 1000 : joined) : typeof joined === 'string' ? new Date(joined) : joined?.seconds ? new Date(joined.seconds * 1000) : null;
  const validDate = rawDate && !Number.isNaN(rawDate.getTime()) && rawDate <= new Date();
  const months = validDate ? Math.max(0, (new Date().getFullYear() - rawDate.getFullYear()) * 12 + new Date().getMonth() - rawDate.getMonth()) : null;
  return months === null ? '—' : months < 1 ? 'Novo' : months < 12 ? `${months} ${months === 1 ? 'mês' : 'meses'}` : `${Math.floor(months / 12)} ${months < 24 ? 'ano' : 'anos'}`;
}

// Values remain absent when the authenticated profile does not supply them.
// A paginated trip history is never presented as a lifetime total.
export function LeafAccountCard({ name, role, profile = {}, detail, onLayout, motionEnabled = false, loadingMetrics = false }) {
  const [size, setSize] = useState({ width: 330, height: 228 });
  const ratingValue = profile.rating ?? profile.averageRating;
  const rating = ratingValue !== null && ratingValue !== undefined && Number(ratingValue) > 0 && Number(ratingValue) <= 5
    ? Number(ratingValue).toFixed(2).replace('.', ',') : null;
  const rawTrips = profile.totalTrips ?? profile.totalRides;
  const trips = rawTrips !== null && rawTrips !== undefined && Number.isFinite(Number(rawTrips)) && Number(rawTrips) >= 0 ? Math.floor(Number(rawTrips)) : null;
  const membership = formatLeafMembership(profile.createdAt);
  const initials = String(name || 'L').trim().split(/\s+/).filter(Boolean).slice(0, 2).map(part => part.charAt(0)).join('').toUpperCase();
  const { tilt, sensor } = useLeafCardTilt(motionEnabled);
  // O cartão inclina de leve com o celular e a sombra corre para o lado oposto,
  // como um cartão de verdade erguido sobre a tela.
  const liftStyle = useAnimatedStyle(() => ({
    shadowOffset: { width: -tilt.value.x * 10, height: 16 - tilt.value.y * 6 },
    transform: [
      { perspective: 900 },
      { rotateY: `${tilt.value.x * 7}deg` },
      { rotateX: `${-tilt.value.y * 6}deg` },
      { translateX: tilt.value.x * 3 },
    ],
  }));
  return (
    <Animated.View style={[styles.cardShadow, liftStyle]}>
    {sensor}
    <View onLayout={event => { setSize(event.nativeEvent.layout); onLayout?.(event); }} style={styles.card}>
      <LeafCardMaterial width={size.width} height={size.height} tilt={tilt} />
      <View style={styles.cardTop}>
        <Text style={styles.detail}>Seu perfil Leaf</Text>
        <View style={styles.brand}><LeafBrandMark /></View>
      </View>
      <View style={styles.identity}>
        <View style={styles.initial}><Text style={styles.initialText}>{initials}</Text></View>
        <View style={styles.copy}>
          <Text style={styles.name}>{name || 'Sua conta'}</Text>
          <Text style={styles.role}>{role === 'driver' ? 'Motorista' : 'Passageiro'}</Text>
          {detail ? <Text style={styles.detail}>{detail}</Text> : null}
        </View>
      </View>
      <View style={styles.cardBottom}>
        {[[rating ? `${rating} ★` : '—', 'avaliação'], [trips ?? '—', 'viagens'], [membership, 'na Leaf']].map(([value, label], index) =>
          <View key={label} style={[styles.metric, index > 0 && styles.metricDivider]} accessible accessibilityLabel={`${label}: ${loadingMetrics && label !== 'na Leaf' ? 'carregando' : value === '—' ? 'não disponível' : value}`}>
            <Text style={[styles.metricValue, loadingMetrics && label !== 'na Leaf' && { color: '#A6A6A6' }]}>{loadingMetrics && label !== 'na Leaf' ? '…' : value}</Text><Text style={styles.metricLabel}>{label}</Text>
          </View>)}
      </View>
    </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  lineIcon: { alignItems: 'center', justifyContent: 'center' },
  cardShadow: { borderRadius: 24, backgroundColor: '#F5F5F5', shadowColor: '#0B1A06', shadowOffset: { width: 0, height: 16 }, shadowRadius: 26, shadowOpacity: 0.22, elevation: 14 },
  card: { borderRadius: 24, padding: 22, borderWidth: 1, borderColor: 'rgba(255,255,255,0.8)', overflow: 'hidden' },
  cardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 },
  brand: { width: 62, height: 32, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  brandMark: { width: 62, height: 32 },
  brandMarkImage: { position: 'absolute', left: -10, top: -25, width: 82, height: 82 },
  role: { ...leafTypography.regular, fontSize: 14, lineHeight: 20, color: '#6A6A6A', marginTop: 5 },
  identity: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  initial: { width: 62, height: 62, borderRadius: 31, backgroundColor: 'rgba(255,255,255,0.65)', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: 'rgba(255,255,255,0.8)' },
  initialText: { ...leafTypography.semiBold, fontSize: 20, color: '#222222' },
  copy: { flex: 1 }, name: { ...leafTypography.semiBold, fontSize: 18, lineHeight: 23, color: '#222222' },
  detail: { ...leafTypography.regular, fontSize: 12, lineHeight: 17, color: '#6A6A6A' },
  cardBottom: { marginTop: 18, paddingTop: 18, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#D6D9D6', flexDirection: 'row' },
  metric: { flex: 1, minWidth: 0, justifyContent: 'center' },
  metricDivider: { borderLeftWidth: StyleSheet.hairlineWidth, borderLeftColor: '#D6D9D6', paddingLeft: 12 },
  metricValue: { ...leafTypography.semiBold, fontSize: 20, lineHeight: 25, fontVariant: ['tabular-nums'], color: '#222222' },
  metricLabel: { ...leafTypography.regular, fontSize: 12, lineHeight: 17, color: '#6A6A6A', marginTop: 4 },
});
