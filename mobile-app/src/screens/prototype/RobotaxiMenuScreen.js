import leafTypography from '../../components/prototype/LeafTypography';
import React, { useCallback, useMemo, useState } from 'react';
import { useIsFocused } from '@react-navigation/native';
import { Alert, ScrollView, StatusBar, StyleSheet, Text, TouchableOpacity, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useSelector } from 'react-redux';
import * as Application from 'expo-application';
import { Feather } from '@expo/vector-icons';
import { resolveLeafAccountMetrics } from '../../components/prototype/LeafVisualElements';
import useAccountSummary from '../../hooks/useAccountSummary';
import { useAccountSessionReset } from '../../hooks/useAccountSessionReset';
import { LeafRootTabs } from '../../components/prototype/PrototypeScaffold';
import { navigateLeafRootTab } from '../../navigation/leafRootTabNavigation';
import { resolvePrototypeProfileName } from './prototypeProfileIdentity';
import PrototypeScreenTransition from '../../components/prototype/PrototypeScreenTransition';
import PrototypeDismissibleSheet from '../../components/prototype/PrototypeDismissibleSheet';
import {
  PrototypeMenuGroup,
  PrototypeMenuGroupRow,
  PrototypeMenuSurface,
} from '../../components/prototype/PrototypeMenuSurface';
import { DRIVER_DOCS, resolveDocStatus } from './RobotaxiDriverDocumentsScreen';
import robotaxiPrototypeTokens from '../../components/design-system/robotaxiPrototypeTokens';
import { getPilotLaunchFeatureSnapshot } from '../../config/pilotLaunchProfile';
import { isCurrentSurfaceUnavailable } from './currentSurfaceStatus';
import { getMenuSectionsByRole, resolveMenuTargetRoute } from './robotaxiMenuConfig';
import { usePrototypeMapOcclusion } from './prototypeMapOcclusion';
import { usePrototypeRideRuntime } from './prototypeRideRuntime';

const { color, typography } = robotaxiPrototypeTokens;
const SURFACE_TOP_PADDING = 20;
const SURFACE_BOTTOM_PADDING = 18;
const BACKDROP_COLOR = 'transparent';
const TEXT_SCALE_CAP = 1.35;

export default function RobotaxiMenuScreen({ navigation, route }) {
  const insets = useSafeAreaInsets();
  const focused = useIsFocused();
  const { height: windowHeight } = useWindowDimensions();
  const { activeRole, riderProfile, profileUid, lastReceipt, driverCanGoOnline, driverActivationRemote, documentAnalysisState } = usePrototypeRideRuntime();
  const authProfile = useSelector(state => state?.auth?.profile);
  const accountUid = profileUid || authProfile?.uid;
  const accountSummary = useAccountSummary({ uid: accountUid, role: activeRole, revision: lastReceipt?.receiptId || lastReceipt?.id || null, focused });
  const visibleAuthProfile = authProfile?.uid === accountUid ? authProfile : null;
  const visibleRiderProfile = riderProfile?.uid === accountUid ? riderProfile : null;
  const cardProfile = { ...(visibleRiderProfile || {}), ...(visibleAuthProfile || {}), ...(accountSummary.summary?.profile || {}) };
  const profileName = resolvePrototypeProfileName(visibleAuthProfile) || resolvePrototypeProfileName(visibleRiderProfile);
  const { resetSessionToStart } = useAccountSessionReset({ navigation, profile: authProfile || riderProfile });
  const [panelHeight, setPanelHeight] = useState(windowHeight);
  const isDriverRole = activeRole === 'driver';
  const referralProgramsEnabled = getPilotLaunchFeatureSnapshot().referralProgramsEnabled;

  usePrototypeMapOcclusion({
    routeKey: route?.key,
    layerId: route?.key || 'prototype-menu',
    occludedBottom: panelHeight,
  });

  const roleMenuSections = useMemo(
    () => getMenuSectionsByRole(activeRole, { referralProgramsEnabled })
      .map(section => ({
        ...section,
        items: section.items.filter(item => !isCurrentSurfaceUnavailable(item.status)),
      }))
      .filter(section => section.items.length > 0),
    [activeRole, referralProgramsEnabled]
  );

  // Um nível só, em blocos por assunto (2026-10-28): cada linha abre a tela final.
  // Ativação aparece só enquanto o motorista ainda não pode ficar online.
  const activationPending = isDriverRole && !(driverCanGoOnline || driverActivationRemote?.canAttemptOnline === true);
  const groups = useMemo(() => {
    const all = roleMenuSections.flatMap(section => section.items);
    const definitions = isDriverRole
      ? [['work', ['driver-earnings', 'driver-history']], ['registration', [...(activationPending ? ['driver-activation'] : []), 'driver-documents', 'driver-vehicles']], ['support', ['help', 'settings']]]
      : [['trips', ['trip-history', 'saved-places', 'passenger-invites']], ['support', ['help', 'settings']]];
    return definitions.map(([key, keys]) => ({ key, items: keys.map(itemKey => all.find(item => item.key === itemKey)).filter(Boolean) }))
      .filter(group => group.items.length);
  }, [roleMenuSections, isDriverRole, activationPending]);
  // Estado à direita, só com dados que o runtime já tem (sem chamada nova).
  const documentsBadge = useMemo(() => {
    if (!isDriverRole) return null;
    const statuses = DRIVER_DOCS.map(doc => resolveDocStatus(driverActivationRemote?.documents, documentAnalysisState?.byType, doc.id));
    if (statuses.every(status => status === 'aprovado')) return { label: 'Em dia', tone: 'success' };
    if (statuses.some(status => status === 'revisar')) return { label: 'Revisar', tone: 'warning' };
    if (statuses.some(status => status === 'em análise')) return { label: 'Em análise', tone: 'warning' };
    return driverActivationRemote ? { label: 'Pendente', tone: 'warning' } : null;
  }, [documentAnalysisState?.byType, driverActivationRemote, isDriverRole]);
  const vehiclePlate = String(driverActivationRemote?.vehicle?.plate || driverActivationRemote?.vehicle?.placa || '').trim().toUpperCase();
  const metrics = resolveLeafAccountMetrics(cardProfile, profileName);
  const metricsLoading = accountSummary.loading && !accountSummary.summary;
  const appVersion = Application.nativeApplicationVersion;
  const promptLogout = () => Alert.alert('Sair da conta', 'Tem certeza que deseja sair da sua conta Leaf?', [
    { text: 'Cancelar', style: 'cancel' },
    { text: 'Sair', style: 'destructive', onPress: () => resetSessionToStart().catch(() => Alert.alert('Não foi possível sair', 'Tente novamente em alguns instantes.')) },
  ]);

  const handleDismiss = useCallback(() => {
    navigateLeafRootTab(navigation, 'home');
  }, [navigation]);

  const handlePanelLayout = useCallback(event => {
    const nextHeight = event?.nativeEvent?.layout?.height;
    if (Number.isFinite(nextHeight) && nextHeight > 0) {
      setPanelHeight(nextHeight);
    }
  }, []);

  const handleOpenItem = useCallback(
    item => {
      const targetRoute = resolveMenuTargetRoute(item);
      if (targetRoute === 'EarningsReport') {
        navigation.navigate(targetRoute, {
          source: 'driver-menu',
          defaultRangeDays: 1,
          maxRangeDays: 30,
          returnToAccount: true,
        });
        return;
      }

      navigation.navigate(targetRoute, {
        returnToAccount: true,
        editProfile: item.key === 'edit-profile',
        ...(targetRoute === 'LeafAccountInfo' ? { kind: item.key === 'payment-info' ? 'payment' : 'achievements' } : {}),
      });
    },
    [navigation]
  );

  return (
    <PrototypeScreenTransition>
      <View
        style={styles.container}
        pointerEvents="box-none"
        testID="robotaxi-menu-screen"
      >
        <StatusBar translucent backgroundColor="transparent" barStyle="dark-content" />
        <PrototypeDismissibleSheet
          onClose={handleDismiss}
          backdropColor={BACKDROP_COLOR}
          dragEnabled={false}
          sheetStyle={styles.sheetWrap}
        >
          <PrototypeMenuSurface
            onLayout={handlePanelLayout}
            eyebrow={isDriverRole ? 'Conta do motorista' : 'Conta do passageiro'}
            title="Conta"
            pageTitle
            fullScreen
            style={[
              styles.panel,
              {
                paddingTop: insets.top + SURFACE_TOP_PADDING,
                paddingBottom: 92 + Math.max(insets.bottom, SURFACE_BOTTOM_PADDING),
              },
            ]}
            bodyStyle={styles.body}
          >
            <ScrollView style={styles.scroll} showsVerticalScrollIndicator={false} contentContainerStyle={styles.scrollContent}>
              <TouchableOpacity style={styles.profileHeader} activeOpacity={0.7} onPress={() => navigation.navigate('LeafMemberCard')}
                accessibilityRole="button" accessibilityLabel={profileName || 'Sua conta'} accessibilityHint="Abre o cartão de membro" testID="leaf-account-card">
                <View style={styles.avatar}><Text style={styles.avatarText}>{metrics.initials}</Text></View>
                <View style={styles.profileCopy}>
                  <Text style={styles.profileName} numberOfLines={1}>{profileName || 'Sua conta'}</Text>
                  <Text style={styles.profileHint}>Ver cartão de membro</Text>
                </View>
                <Feather name="chevron-right" size={18} color="#B3B3B3" />
              </TouchableOpacity>
              <TouchableOpacity style={styles.metrics} activeOpacity={0.7} onPress={() => navigation.navigate('LeafMemberCard')} accessibilityRole="button"
                accessibilityLabel={`Avaliação ${metrics.rating || 'não disponível'}, ${metrics.trips ?? 'sem'} ${isDriverRole ? 'corridas' : 'viagens'}, ${metrics.membership} na Leaf`} testID="leaf-account-metrics">
                {[[metrics.rating ? `${metrics.rating} ★` : '—', 'avaliação', true], [metrics.trips ?? '—', isDriverRole ? 'corridas' : 'viagens', true], [metrics.membership, 'na Leaf', false]].map(([value, label, remote]) => (
                  <View key={label} style={styles.metricTile}>
                    <Text style={[styles.metricValue, remote && metricsLoading && styles.metricValueLoading]} numberOfLines={1}>{remote && metricsLoading ? '…' : value}</Text>
                    <Text style={styles.metricLabel}>{label}</Text>
                  </View>
                ))}
              </TouchableOpacity>
              {accountSummary.error ? <TouchableOpacity accessibilityRole="button" onPress={() => accountSummary.refresh({ forceRefresh: true })} style={{ paddingBottom: 14 }} testID="leaf-account-summary-retry"><Text style={{ ...leafTypography.regular, fontSize: 12, color: '#6A6A6A' }}>Não foi possível atualizar todos os dados. Tentar novamente.</Text></TouchableOpacity> : null}
              {groups.map(group => (
                <PrototypeMenuGroup key={group.key} style={styles.group} testID={`leaf-account-group-${group.key}`}>
                  {group.items.map(item => (
                    <PrototypeMenuGroupRow key={item.key} icon={item.icon} title={item.title}
                      value={item.key === 'driver-vehicles' ? vehiclePlate : undefined}
                      badge={item.key === 'driver-documents' ? documentsBadge?.label : undefined}
                      badgeTone={documentsBadge?.tone}
                      onPress={() => handleOpenItem(item)}
                      testID={`robotaxi-menu-item-${item.key}`} accessibilityHint={item.subtitle} />
                  ))}
                </PrototypeMenuGroup>
              ))}
              <TouchableOpacity onPress={promptLogout} style={styles.logout} accessibilityRole="button" accessibilityLabel="Sair da conta" testID="leaf-account-logout">
                <Text style={styles.logoutText}>Sair da conta</Text>
              </TouchableOpacity>
              {appVersion ? <Text style={styles.version}>Leaf {appVersion}</Text> : null}
            </ScrollView>
          </PrototypeMenuSurface>
        </PrototypeDismissibleSheet>
        <LeafRootTabs navigation={navigation} insets={insets} active="account" />
      </View>
    </PrototypeScreenTransition>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
  sheetWrap: {
    ...StyleSheet.absoluteFillObject,
  },
  panel: {
    paddingBottom: 10,
  },
  body: {
    flex: 1,
    paddingTop: 14,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: 16,
  },
  profileHeader: { flexDirection: 'row', alignItems: 'center', gap: 14, minHeight: 64, marginBottom: 16 },
  avatar: { width: 56, height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center', backgroundColor: '#E5F1DC' },
  avatarText: { ...leafTypography.semiBold, fontSize: 19, lineHeight: 24, color: '#1A330E' },
  profileCopy: { flex: 1, minWidth: 0 },
  profileName: { ...leafTypography.semiBold, fontSize: 20, lineHeight: 26, color: '#222222' },
  profileHint: { ...leafTypography.regular, fontSize: 14, lineHeight: 19, color: '#6A6A6A', marginTop: 2 },
  metrics: { flexDirection: 'row', gap: 8, marginBottom: 24 },
  metricTile: { flex: 1, minWidth: 0, borderRadius: 14, backgroundColor: '#F4F4F2', paddingHorizontal: 12, paddingVertical: 12 },
  metricValue: { ...leafTypography.semiBold, fontSize: 17, lineHeight: 22, color: '#222222', fontVariant: ['tabular-nums'] },
  metricValueLoading: { color: '#A6A6A6' },
  metricLabel: { ...leafTypography.regular, fontSize: 12, lineHeight: 16, color: '#6A6A6A', marginTop: 2 },
  group: { marginBottom: 20 },
  logout: { minHeight: 48, marginTop: 4, alignItems: 'center', justifyContent: 'center' },
  logoutText: { ...leafTypography.medium, fontSize: 16, lineHeight: 21, color: '#B42318' },
  version: { ...leafTypography.regular, fontSize: 12, lineHeight: 16, color: '#A6A6A6', textAlign: 'center', marginTop: 4 },
  menuSection: {
    marginBottom: 10,
  },
  menuSectionLast: {
    marginBottom: 2,
  },
  footerNote: {
    color: color.text.muted,
    ...leafTypography.medium,
    fontSize: typography.micro.size,
    lineHeight: typography.micro.lineHeight,
  },
});
