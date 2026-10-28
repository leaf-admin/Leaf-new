import leafTypography from '../../components/prototype/LeafTypography';
import React, { useCallback, useMemo, useState } from 'react';
import { useIsFocused } from '@react-navigation/native';
import { Alert, ScrollView, StatusBar, StyleSheet, Text, TouchableOpacity, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useSelector } from 'react-redux';
import { LeafAccountCard, LeafObjectIcon } from '../../components/prototype/LeafVisualElements';
import useAccountSummary from '../../hooks/useAccountSummary';
import { useAccountSessionReset } from '../../hooks/useAccountSessionReset';
import { LeafRootTabs } from '../../components/prototype/PrototypeScaffold';
import { navigateLeafRootTab } from '../../navigation/leafRootTabNavigation';
import { resolvePrototypeProfileName } from './prototypeProfileIdentity';
import PrototypeScreenTransition from '../../components/prototype/PrototypeScreenTransition';
import PrototypeDismissibleSheet from '../../components/prototype/PrototypeDismissibleSheet';
import {
  PrototypeMenuRow,
  PrototypeMenuSection,
  PrototypeMenuSurface,
} from '../../components/prototype/PrototypeMenuSurface';
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
  const { activeRole, riderProfile, profileUid, lastReceipt, driverCanGoOnline, driverActivationRemote } = usePrototypeRideRuntime();
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

  // Um nível só (2026-10-28): cada linha abre a tela final, sem subtelas de grupo.
  // Ativação aparece só enquanto o motorista ainda não pode ficar online.
  const activationPending = isDriverRole && !(driverCanGoOnline || driverActivationRemote?.canAttemptOnline === true);
  const items = useMemo(() => {
    const all = roleMenuSections.flatMap(section => section.items);
    const keys = isDriverRole
      ? ['driver-earnings', 'driver-history', ...(activationPending ? ['driver-activation'] : []), 'driver-documents', 'driver-vehicles', 'help', 'settings']
      : ['trip-history', 'saved-places', 'passenger-invites', 'help', 'settings'];
    return keys.map(key => all.find(item => item.key === key)).filter(Boolean);
  }, [roleMenuSections, isDriverRole, activationPending]);
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
              <TouchableOpacity style={{ marginBottom: 16 }} activeOpacity={0.9} onPress={() => handleOpenItem({ key: 'edit-profile', route: 'RobotaxiPrototypeProfile' })}
                accessibilityRole="button" accessibilityLabel="Dados pessoais" accessibilityHint="Nome, e-mail e telefone" testID="leaf-account-card">
                <LeafAccountCard name={profileName} role={activeRole} profile={cardProfile} motionEnabled={focused} loadingMetrics={accountSummary.loading && !accountSummary.summary} />
              </TouchableOpacity>
              {accountSummary.error ? <TouchableOpacity accessibilityRole="button" onPress={() => accountSummary.refresh({ forceRefresh: true })} style={{ paddingBottom: 14 }} testID="leaf-account-summary-retry"><Text style={{ ...leafTypography.regular, fontSize: 12, color: '#6A6A6A' }}>Não foi possível atualizar todos os dados. Tentar novamente.</Text></TouchableOpacity> : null}
              {items.map((item, index) => (
                <PrototypeMenuRow key={item.key} icon={item.icon} title={item.title}
                  compact last={index === items.length - 1} onPress={() => handleOpenItem(item)}
                  testID={`robotaxi-menu-item-${item.key}`} accessibilityLabel={item.title} accessibilityHint={item.subtitle} />
              ))}
              <TouchableOpacity onPress={promptLogout} style={styles.logout} accessibilityRole="button" accessibilityLabel="Sair da conta" testID="leaf-account-logout">
                <LeafObjectIcon name="logout" size={22} /><Text style={styles.logoutText}>Sair da conta</Text>
              </TouchableOpacity>
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
  logout: { minHeight: 44, marginTop: 16, flexDirection: 'row', alignItems: 'center', gap: 12 },
  logoutText: { ...leafTypography.medium, fontSize: 14, lineHeight: 20, color: '#222222' },
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
