import React, { useState } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Svg, { Defs, Image as SvgImage, LinearGradient as SvgLinearGradient, Mask, Rect, Stop } from 'react-native-svg';
import { LinearGradient } from 'expo-linear-gradient';
import leafTypography from './LeafTypography';
import LeafCardMaterial from './LeafCardMaterial';

// Ícones de traço no lugar dos objetos 3D (decisão de 2026-10-14: o 3D não combina
// com o app). Mesmos nomes de antes, então os 28 usos mudam juntos.
const objects = {
  account: 'person-outline',
  activity: 'time-outline',
  payment: 'wallet-outline',
  help: 'help-circle-outline',
  settings: 'settings-outline',
  privacy: 'shield-checkmark-outline',
  documents: 'document-text-outline',
  vehicle: 'car-outline',
  places: 'location-outline',
  invites: 'people-outline',
  notifications: 'notifications-outline',
  logout: 'log-out-outline',
  home: 'home-outline',
  tabActivity: 'time-outline',
  tabAccount: 'person-outline',
};

const symbols = {
  'person-outline': 'account', 'person-circle-outline': 'account',
  'time-outline': 'activity', 'wallet-outline': 'payment',
  'help-circle-outline': 'help', 'shield-checkmark-outline': 'privacy',
  'settings-outline': 'settings', 'document-text-outline': 'documents',
  'car-outline': 'vehicle', 'people-outline': 'invites',
  'notifications-outline': 'notifications', 'log-out-outline': 'logout',
  'trash-outline': 'privacy', 'language-outline': 'settings',
  'volume-medium-outline': 'settings',
  'information-circle-outline': 'help', 'server-outline': 'documents',
  'options-outline': 'settings', 'share-social-outline': 'invites',
  'lock-closed-outline': 'privacy', 'shield-outline': 'privacy',
  'card-outline': 'payment', 'business-outline': 'payment',
  'car-sport-outline': 'vehicle', 'refresh-outline': 'documents',
  'download-outline': 'documents', 'mail-outline': 'notifications',
  'location-outline': 'places',
  'receipt-outline': 'activity', 'map-outline': 'activity',
  'chatbubble-ellipses-outline': 'help', 'clipboard-outline': 'documents',
  'analytics-outline': 'activity', 'calendar-outline': 'activity',
  'cloud-offline-outline': 'help', 'leaf-outline': 'account',
  'cloud-upload-outline': 'documents', 'sync-outline': 'documents',
  'id-card-outline': 'documents', 'scan-outline': 'privacy',
  'checkmark-circle-outline': 'help',
};

export function LeafObjectIcon({ name, symbol, size = 44 }) {
  const glyph = objects[name || symbols[symbol]];
  if (!glyph) return <Ionicons name={symbol || 'ellipse-outline'} size={20} color="#555B55" />;
  const iconSize = Math.round(size * 0.46);
  // Duas camadas: a forma cheia em verde claro, levemente deslocada, sob o traço.
  const filledGlyph = glyph.replace(/-outline$/, '');
  return (
    <LinearGradient
      colors={['#FBFCF9', '#EAF0E4']}
      start={{ x: 0.2, y: 0 }}
      end={{ x: 0.8, y: 1 }}
      style={[styles.lineIcon, { width: size, height: size, borderRadius: size / 2 }]}
    >
      <View accessible={false} style={styles.lineIconStack}>
        <Ionicons
          name={filledGlyph}
          size={iconSize}
          color="rgba(132,201,76,0.5)"
          style={[styles.lineIconFill, { left: 1.5, top: 1.5 }]}
        />
        <Ionicons name={glyph} size={iconSize} color="#1A330E" />
      </View>
    </LinearGradient>
  );
}

function LeafBrandMark() {
  return <Svg width={62} height={32} viewBox="0 0 62 32" accessible={false}>
    <Defs>
      <SvgLinearGradient id="leafBrandColor" x1="0" y1="0" x2="1" y2="0">
        <Stop offset="0" stopColor="#00B410" /><Stop offset="1" stopColor="#75D83B" />
      </SvgLinearGradient>
      <Mask id="leafBrandShape" x="0" y="0" width="62" height="32" maskUnits="userSpaceOnUse">
        <SvgImage href={require('../../../assets/leaf-ui/leafBrandTransparent.png')} x={-10} y={-25} width={82} height={82} />
      </Mask>
    </Defs>
    <Rect width={62} height={32} fill="url(#leafBrandColor)" mask="url(#leafBrandShape)" />
  </Svg>;
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
  return (
    <View style={styles.cardShadow}>
    <View onLayout={event => { setSize(event.nativeEvent.layout); onLayout?.(event); }} style={styles.card}>
      <LeafCardMaterial width={size.width} height={size.height} motionEnabled={motionEnabled} />
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
    </View>
  );
}

const styles = StyleSheet.create({
  lineIcon: {
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(26,51,14,0.1)',
  },
  lineIconStack: { alignItems: 'center', justifyContent: 'center' },
  lineIconFill: { position: 'absolute' },
  cardShadow: { borderRadius: 24, backgroundColor: '#F5F5F5', shadowColor: '#000000', shadowOffset: { width: 0, height: 9 }, shadowRadius: 20, shadowOpacity: 0.1, elevation: 4 },
  card: { borderRadius: 24, padding: 22, borderWidth: 1, borderColor: 'rgba(255,255,255,0.8)', overflow: 'hidden' },
  cardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 },
  brand: { width: 62, height: 32, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
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
