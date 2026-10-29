import React, { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import LeafTouchable from '../../components/design-system/LeafTouchable';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useIsFocused } from '@react-navigation/native';
import { formatLeafMembership, LeafObjectIcon } from '../../components/prototype/LeafVisualElements';
import useAccountSummary from '../../hooks/useAccountSummary';
import MobileProfileService from '../../services/MobileProfileService';
import { PrototypeMenuRow } from '../../components/prototype/PrototypeMenuSurface';
import leafTypography from '../../components/prototype/LeafTypography';
import { usePrototypeRideRuntime } from './prototypeRideRuntime';

// Account information only. This page cannot create a charge or grant a badge.
export default function LeafAccountInfoScreen({ navigation, route }) {
  const insets = useSafeAreaInsets();
  const { activeRole, profileUid, riderProfile, lastReceipt } = usePrototypeRideRuntime();
  const focused = useIsFocused();
  const payment = route?.params?.kind === 'payment';
  // Same source as the Conta card; payment info does not need it.
  const accountSummary = useAccountSummary({ uid: payment ? null : profileUid || riderProfile?.uid, role: activeRole, revision: lastReceipt?.receiptId || lastReceipt?.id || null, focused: focused && !payment });
  const summaryProfile = { ...(riderProfile || {}), ...(accountSummary.summary?.profile || {}) };
  const rawTrips = summaryProfile.totalTrips ?? summaryProfile.totalRides;
  const trips = Number.isFinite(Number(rawTrips)) && rawTrips !== null && rawTrips !== undefined ? String(Math.floor(Number(rawTrips))) : '—';
  const metricsLoading = accountSummary.loading && !accountSummary.summary;
  const [achievements, setAchievements] = useState(null);
  const [achievementsState, setAchievementsState] = useState('loading');
  useEffect(() => {
    if (payment || !focused) return undefined;
    let alive = true;
    MobileProfileService.getAchievements()
      .then((result) => { if (alive) { setAchievements(result); setAchievementsState(result ? 'ready' : 'empty'); } })
      .catch(() => { if (alive) setAchievementsState(achievements ? 'ready' : 'error'); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focused, payment]);
  const badges = Array.isArray(achievements?.badges) ? achievements.badges : [];
  const earnedBadges = badges.filter((badge) => badge.earned);
  const nextBadges = badges.filter((badge) => !badge.earned);
  const title = payment ? 'Pagamento' : 'Conquistas';
  const back = () => navigation.canGoBack() ? navigation.goBack() : navigation.navigate('RobotaxiPrototypeMenu');
  return <View style={[styles.page, { paddingTop: insets.top + 20, paddingBottom: insets.bottom }]} testID={`leaf-account-${payment ? 'payment' : 'achievements'}`}>
    <View style={styles.header}>
      <LeafTouchable onPress={back} style={styles.back} accessibilityRole="button" accessibilityLabel="Voltar">
        <Ionicons name="arrow-back" size={20} color="#222222" />
      </LeafTouchable><Text style={styles.title} accessibilityRole="header">{title}</Text>
    </View>
    <ScrollView contentContainerStyle={styles.content}>
      <View style={styles.notice}>
        <LeafObjectIcon name={payment ? 'payment' : 'achievements'} size={64} />
        <View style={styles.noticeCopy}>
          <Text style={styles.section}>{payment ? 'Pix na Leaf' : 'Sua história na Leaf'}</Text>
          <Text style={styles.support}>{payment ? 'O pagamento é confirmado antes do embarque.' : activeRole === 'driver' ? 'Trajetos e tempo de parceria.' : 'Viagens e tempo de casa.'}</Text>
        </View>
      </View>
      {payment ? <>
        <View style={styles.facts}>
          <View style={styles.fact}><Text style={styles.support}>Forma de pagamento</Text><Text style={styles.value}>Pix</Text></View>
          <View style={styles.fact}><Text style={styles.support}>Cobrança</Text><Text style={styles.value}>Por viagem</Text></View>
        </View>
        <Text style={styles.body}>Antes de confirmar, você vê o valor total. Depois, o recibo reúne o valor pago e seu detalhamento.</Text>
        <View>
          <PrototypeMenuRow icon="time-outline" title="Pagamentos e recibos" subtitle="Encontre no histórico" onPress={() => navigation.navigate('RobotaxiMenuTripHistory', { returnToAccount: true })} testID="leaf-account-payment-history" />
          <PrototypeMenuRow icon="help-circle-outline" title="Ajuda com pagamento" subtitle="Pix, comprovante ou cobrança" onPress={() => navigation.navigate('RobotaxiPrototypeSupport', { returnToAccount: true })} testID="leaf-account-payment-help" last />
        </View>
      </> : <>
        {/* The header promises "viagens e tempo de casa": show the real values. */}
        <View style={styles.facts} testID="leaf-achievements-metrics">
          <View style={styles.fact}><Text style={styles.support}>{activeRole === 'driver' ? 'Corridas' : 'Viagens'}</Text><Text style={styles.value}>{metricsLoading ? '…' : trips}</Text></View>
          <View style={styles.fact}><Text style={styles.support}>Na Leaf</Text><Text style={styles.value}>{formatLeafMembership(summaryProfile.createdAt)}</Text></View>
        </View>
        <View style={styles.badges} testID="leaf-achievements-badges">
          {achievementsState === 'loading' && !achievements ? <Text style={styles.support}>Carregando conquistas…</Text> : null}
          {achievementsState === 'error' ? <Text style={styles.support}>Não foi possível carregar as conquistas agora.</Text> : null}
          {earnedBadges.length ? <>
            <Text style={styles.groupTitle}>{`CONQUISTADAS · ${earnedBadges.length}`}</Text>
            {earnedBadges.map((badge) => <AchievementRow key={badge.id} badge={badge} />)}
          </> : null}
          {nextBadges.length ? <>
            <Text style={styles.groupTitle}>PRÓXIMAS</Text>
            {nextBadges.map((badge) => <AchievementRow key={badge.id} badge={badge} />)}
          </> : null}
        </View>
      </>}
    </ScrollView>
  </View>;
}

function AchievementRow({ badge }) {
  const target = Number(badge?.progress?.target) || 0;
  const current = Math.min(Number(badge?.progress?.current) || 0, target);
  const ratio = target > 0 ? current / target : 0;
  const missing = Math.max(0, target - current);
  const detail = badge.earned
    ? badge.description || 'Conquistada'
    : badge.description || (missing > 0 ? `Faltam ${missing}` : '');
  return <View style={styles.badgeRow} testID={`leaf-achievement-${badge.id}`} accessible accessibilityLabel={`${badge.title}. ${badge.earned ? 'Conquistada' : detail}`}>
    <View style={[styles.badgeIcon, badge.earned ? styles.badgeIconEarned : null]}>
      <Ionicons name={badge.earned ? (badge.kind === 'quality' ? 'star' : 'ribbon') : 'lock-closed-outline'} size={18} color={badge.earned ? '#003002' : '#8A8A8A'} />
    </View>
    <View style={styles.badgeCopy}>
      <Text style={styles.badgeTitle}>{badge.title}</Text>
      {detail ? <Text style={styles.support}>{detail}</Text> : null}
      {!badge.earned && target > 1 ? <View style={styles.progressTrack}><View style={[styles.progressFill, { width: `${Math.round(ratio * 100)}%` }]} /></View> : null}
    </View>
    {!badge.earned && target > 1 ? <Text style={styles.badgeCount}>{`${current}/${target}`}</Text> : null}
  </View>;
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: '#FFFFFF', paddingHorizontal: 24 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 20, minHeight: 44 },
  back: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: '#F5F5F5' },
  title: { ...leafTypography.semiBold, fontSize: 22, lineHeight: 28, color: '#222222', flex: 1 },
  content: { gap: 24, paddingBottom: 38 },
  notice: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  noticeCopy: { flex: 1, gap: 8 },
  section: { ...leafTypography.semiBold, fontSize: 18, lineHeight: 24, color: '#222222' },
  support: { ...leafTypography.regular, fontSize: 14, lineHeight: 20, color: '#6A6A6A' },
  body: { ...leafTypography.regular, fontSize: 16, lineHeight: 24, color: '#222222' },
  facts: { borderTopWidth: StyleSheet.hairlineWidth, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: '#E5E5E5', paddingVertical: 20, gap: 16 },
  fact: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  badges: { gap: 4 },
  groupTitle: { ...leafTypography.semiBold, fontSize: 12, lineHeight: 16, letterSpacing: 0.6, color: '#6A6A6A', marginTop: 12, marginBottom: 4 },
  badgeRow: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: '#E5E5E5' },
  badgeIcon: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: '#F2F2F2' },
  badgeIconEarned: { backgroundColor: '#D4E84A' },
  badgeCopy: { flex: 1, gap: 4 },
  badgeTitle: { ...leafTypography.medium, fontSize: 16, lineHeight: 22, color: '#222222' },
  badgeCount: { ...leafTypography.medium, fontSize: 13, color: '#6A6A6A' },
  progressTrack: { height: 4, borderRadius: 2, backgroundColor: '#EEEEEE', overflow: 'hidden', marginTop: 4 },
  progressFill: { height: 4, borderRadius: 2, backgroundColor: '#1A330E' },
  value: { ...leafTypography.medium, fontSize: 16, lineHeight: 22, color: '#222222' },
});
