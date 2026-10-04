import leafTypography from '../../components/prototype/LeafTypography';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useIsFocused } from '@react-navigation/native';
import { Alert, ScrollView, StatusBar, StyleSheet, Text, TouchableOpacity, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useSelector } from 'react-redux';
import { LeafAccountCard, LeafObjectIcon } from '../../components/prototype/LeafVisualElements';
import useAccountSummary from '../../hooks/useAccountSummary';
import { useAccountSessionReset } from '../../hooks/useAccountSessionReset';
import { LeafRootTabs } from '../../components/prototype/PrototypeScaffold';
import { resolvePrototypeProfileName } from './prototypeProfileIdentity';
import { Ionicons } from '@expo/vector-icons';
import PrototypeScreenTransition from '../../components/prototype/PrototypeScreenTransition';
import PrototypeDismissibleSheet from '../../components/prototype/PrototypeDismissibleSheet';
import {
  PrototypeMenuCloseButton,
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
  const { activeRole, riderProfile, profileUid, lastReceipt } = usePrototypeRideRuntime();
  const authProfile = useSelector(state => state?.auth?.profile);
  const [selectedGroup, setSelectedGroup] = useState(null);
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

  const groups = useMemo(() => {
    const all = roleMenuSections.flatMap(section => section.items);
    const definitions = isDriverRole ? [
      ['trips', 'Ganhos e corridas', 'Saldo, viagens e recibos', 'wallet-outline', ['driver-earnings', 'driver-history']],
      ['registration', 'Cadastro e veículo', 'Ativação, documentos e cidade', 'document-text-outline', ['driver-activation', 'driver-documents', 'driver-vehicles', 'driver-waitlist-invites']],
      ['profile', 'Dados pessoais', 'Seu perfil e contato', 'person-outline', ['edit-profile', 'achievements']],
      ['help', 'Ajuda e preferências', 'Suporte, configurações e privacidade', 'help-circle-outline', ['privacy-account-deletion', 'settings', 'help']],
    ] : [
      ['trips', 'Viagens e pagamento', 'Histórico, recibos e Pix', 'time-outline', ['trip-history', 'payment-info']],
      ['places', 'Endereços salvos', 'Casa, trabalho e favoritos', 'location-outline', ['saved-places']],
      ['profile', 'Perfil e conquistas', 'Dados, emblemas e convites', 'person-outline', ['edit-profile', 'achievements', 'passenger-invites']],
      ['settings', 'Ajuda e preferências', 'Suporte, configurações e privacidade', 'help-circle-outline', ['help', 'settings', 'privacy-account-deletion']],
    ];
    const covered = new Set(definitions.flatMap(group => group[4]));
    const entries = definitions.map(([key, title, subtitle, icon, keys]) => ({ key, title, subtitle, icon, items: keys.map(itemKey => all.find(item => item.key === itemKey)).filter(Boolean) })).filter(group => group.items.length);
    const remaining = all.filter(item => !covered.has(item.key));
    if (remaining.length) entries.push({ key: 'other', title: 'Mais opções', icon: 'settings-outline', items: remaining });
    return entries;
  }, [roleMenuSections, isDriverRole]);
  const currentGroup = groups.find(group => group.key === selectedGroup);
  const promptLogout = () => Alert.alert('Sair da conta', 'Tem certeza que deseja sair da sua conta Leaf?', [
    { text: 'Cancelar', style: 'cancel' },
    { text: 'Sair', style: 'destructive', onPress: () => resetSessionToStart().catch(() => Alert.alert('Não foi possível sair', 'Tente novamente em alguns instantes.')) },
  ]);

  const handleDismiss = useCallback(() => {
    if (selectedGroup) { setSelectedGroup(null); return; }
    navigation.navigate('RobotaxiPrototype');
  }, [navigation, selectedGroup]);

  useEffect(() => {
    if (!selectedGroup || !navigation?.addListener) return undefined;
    return navigation.addListener('beforeRemove', event => {
      if (!['GO_BACK', 'POP', 'POP_TO_TOP'].includes(event?.data?.action?.type)) return;
      event.preventDefault();
      setSelectedGroup(null);
    });
  }, [navigation, selectedGroup]);

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
            title={currentGroup?.title || 'Conta'}
            pageTitle={!currentGroup}
            fullScreen
            style={[
              styles.panel,
              {
                paddingTop: insets.top + SURFACE_TOP_PADDING,
                paddingBottom: 92 + Math.max(insets.bottom, SURFACE_BOTTOM_PADDING),
              },
            ]}
            bodyStyle={styles.body}
            headerAccessory={(
              <PrototypeMenuCloseButton
                onPress={currentGroup ? handleDismiss : () => navigation.navigate('RobotaxiPrototypeSettings', { returnToAccount: true })}
                icon={currentGroup ? "chevron-back" : "options-outline"}
                testID="robotaxi-menu-close-button"
                accessibilityLabel={currentGroup ? "Voltar à conta" : "Preferências da conta"}
              />
            )}
          >
            <ScrollView style={styles.scroll} showsVerticalScrollIndicator={false} contentContainerStyle={styles.scrollContent}>
              {!currentGroup ? <View style={{ marginBottom: 16 }}><LeafAccountCard name={profileName} role={activeRole} profile={cardProfile} motionEnabled={focused} loadingMetrics={accountSummary.loading && !accountSummary.summary} /></View> : null}
              {!currentGroup && accountSummary.error ? <TouchableOpacity accessibilityRole="button" onPress={() => accountSummary.refresh({ forceRefresh: true })} style={{ paddingBottom: 14 }} testID="leaf-account-summary-retry"><Text style={{ ...leafTypography.regular, fontSize: 12, color: '#6A6A6A' }}>Não foi possível atualizar todos os dados. Tentar novamente.</Text></TouchableOpacity> : null}
              {currentGroup ? currentGroup.items.map((item, index) => (
                <PrototypeMenuRow key={item.key} icon={item.icon} title={item.title} subtitle={item.subtitle}
                  last={index === currentGroup.items.length - 1} onPress={() => handleOpenItem(item)}
                  testID={`robotaxi-menu-item-${item.key}`} accessibilityLabel={item.title} accessibilityHint={item.subtitle} />
              )) : groups.map(group => (
                <PrototypeMenuRow key={group.key} icon={group.icon} title={group.title} subtitle={group.subtitle}
                  compact onPress={() => group.key === 'places' ? handleOpenItem(group.items[0]) : setSelectedGroup(group.key)} testID={`leaf-account-group-${group.key}`} accessibilityLabel={group.title} />
              ))}
              {!currentGroup ? <TouchableOpacity onPress={promptLogout} style={styles.logout} accessibilityRole="button" accessibilityLabel="Sair da conta" testID="leaf-account-logout">
                <LeafObjectIcon name="logout" size={28} /><Text style={styles.logoutText}>Sair da conta</Text>
              </TouchableOpacity> : null}
            </ScrollView>
          </PrototypeMenuSurface>
        </PrototypeDismissibleSheet>
        {!currentGroup ? <LeafRootTabs navigation={navigation} insets={insets} active="account" /> : null}
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
