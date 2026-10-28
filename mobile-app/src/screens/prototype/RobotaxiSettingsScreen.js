import leafTypography from '../../components/prototype/LeafTypography';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, AppState, Linking, Platform, ScrollView, StatusBar, StyleSheet, Switch, Text, TouchableOpacity, View, useWindowDimensions } from 'react-native';
import * as Application from 'expo-application';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useSelector } from 'react-redux';
import { Feather } from '@expo/vector-icons';
import { LeafObjectIcon } from '../../components/prototype/LeafVisualElements';
import PrototypeScreenTransition from '../../components/prototype/PrototypeScreenTransition';
import PrototypeDismissibleSheet from '../../components/prototype/PrototypeDismissibleSheet';
import { usePrototypeMapOcclusion } from './prototypeMapOcclusion';
import { usePrototypeRideRuntime } from './prototypeRideRuntime';
import { useAccountDeletionFlow } from '../../hooks/useAccountDeletionFlow';
import Logger from '../../utils/Logger';
import { isCurrentSurfaceUnavailable } from './currentSurfaceStatus';
import { ROBOTAXI_SETTINGS_ITEMS } from './robotaxiSettingsConfig';
import { useMobilePreferences } from '../../components/MobilePreferencesProvider';
import FCMNotificationService from '../../services/FCMNotificationService';
import { isLeafVoiceAvailable, stopLeafNavigationVoice } from '../../services/LeafVoiceGuidanceService';
import {
  NAVIGATION_APP_LABELS,
  choosePreferredNavigationApp,
  getPreferredNavigationApp,
  isAutoNavigationEnabled,
  setAutoNavigationEnabled,
} from '../../services/driverNavigationPreference';
import { loadAnalyticsPreference, setAnalyticsEnabled } from '../../services/observability/AppObservability';
import {
  getRideOverlayStatus,
  isRideOverlayAvailable,
  isRideOverlayEnabled,
  openRideOverlaySettings,
  setRideOverlayEnabled,
} from '../../services/LeafRideOverlay';

const SURFACE_TOP_PADDING = 20;
const SURFACE_BOTTOM_PADDING = 18;
const BACKDROP_COLOR = 'transparent';
const SETTINGS_COLOR = {
  bg: '#FFFFFF',
  text: '#222222',
  title: '#222222',
  secondary: '#6A6A6A',
  line: '#E5E5E5',
  danger: '#9F2424',
  icon: '#514B45',
  chevron: '#767676',
};

// Três grupos fixos (2026-10-28); Sair e Ajuda ficam na Conta, não aqui.
const SETTINGS_SECTIONS = [
  { key: 'ride', title: 'Corrida' },
  { key: 'general', title: 'Geral' },
  { key: 'account', title: 'Conta' },
];

function SettingRow({
  icon,
  title,
  subtitle,
  onPress,
  rowTestID,
  switchTestID,
  switchValue,
  onValueChange,
  disabled = false,
  showChevron = false,
  tone = 'default',
  last = false,
}) {
  const informational = !onValueChange && !onPress;
  const Container = onValueChange || informational ? View : TouchableOpacity;
  return (
    <Container
      style={[styles.settingRow, last && styles.settingRowLast]}
      onPress={onPress}
      disabled={disabled}
      activeOpacity={0.78}
      testID={rowTestID}
      accessible={informational ? true : undefined}
      accessibilityLabel={onValueChange ? undefined : title}
      accessibilityHint={onValueChange ? undefined : subtitle}
      accessibilityRole={onValueChange ? undefined : informational ? 'text' : 'button'}
      accessibilityState={{ disabled }}
    >
      <View style={styles.rowIconSlot}>
        <LeafObjectIcon symbol={icon} size={22} />
      </View>
      <View style={styles.settingTextWrap}>
        <Text style={[styles.settingTitle, tone === 'danger' && styles.settingTitleDanger]}>
          {title}
        </Text>
        <Text style={styles.settingSubtitle}>{subtitle}</Text>
      </View>
      {onValueChange ? <Switch
        testID={switchTestID}
        value={Boolean(switchValue)}
        onValueChange={onValueChange}
        disabled={disabled}
        accessibilityLabel={title}
        accessibilityHint={subtitle}
        accessibilityState={{ disabled, checked: Boolean(switchValue) }}
        trackColor={{ false: '#D7D7D7', true: '#1A330E' }}
        thumbColor="#FFFFFF"
        ios_backgroundColor="#D7D7D7"
      /> : null}
      {showChevron ? (
        <Feather
          name="chevron-right"
          size={18}
          color={tone === 'danger' ? SETTINGS_COLOR.danger : SETTINGS_COLOR.chevron}
        />
      ) : null}
    </Container>
  );
}

export default function RobotaxiSettingsScreen({ navigation, route }) {
  const authProfile = useSelector(state => state?.auth?.profile);
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();
  const { riderProfile, activeRole } = usePrototypeRideRuntime();
  const [panelHeight, setPanelHeight] = useState(windowHeight);
  const deletionProfile = authProfile || riderProfile;
  const isDriver = activeRole ? activeRole === 'driver' : deletionProfile?.userType === 'driver' || deletionProfile?.usertype === 'driver';
  const { preferences, ready, loading, saving, error, refresh, update } = useMobilePreferences();
  const [notificationPermission, setNotificationPermission] = useState(null);
  const previousPermission = useRef(null);
  const [permissionBusy, setPermissionBusy] = useState(false);
  const [voiceAvailable, setVoiceAvailable] = useState(null);
  const [navigationApp, setNavigationApp] = useState(undefined);
  const [autoNavigation, setAutoNavigation] = useState(null);

  useEffect(() => {
    let live = true;
    getPreferredNavigationApp().then(app => { if (live) setNavigationApp(app); });
    isAutoNavigationEnabled().then(enabled => { if (live) setAutoNavigation(enabled); });
    return () => { live = false; };
  }, []);

  const chooseNavigationApp = useCallback(async () => {
    const chosen = await choosePreferredNavigationApp({ allowAskEveryTime: true });
    if (chosen !== undefined) setNavigationApp(chosen);
  }, []);

  const toggleAutoNavigation = useCallback(value => {
    setAutoNavigation(value);
    setAutoNavigationEnabled(value).then(setAutoNavigation);
  }, []);

  // Balão da corrida por cima do Waze/Maps (Android, build 1.0.9+). Ligado = preferência
  // ativa e permissão "Sobrepor a outros apps" concedida.
  const [rideOverlayOn, setRideOverlayOn] = useState(null);
  const refreshRideOverlay = useCallback(async () => {
    if (!isRideOverlayAvailable()) return;
    const [enabled, status] = await Promise.all([isRideOverlayEnabled(), getRideOverlayStatus()]);
    setRideOverlayOn(Boolean(enabled && status.canDrawOverlays));
  }, []);
  useEffect(() => {
    refreshRideOverlay();
    const subscription = AppState.addEventListener('change', next => {
      if (next === 'active') refreshRideOverlay();
    });
    return () => subscription?.remove?.();
  }, [refreshRideOverlay]);
  const toggleRideOverlay = useCallback(async value => {
    setRideOverlayOn(value);
    await setRideOverlayEnabled(value);
    if (value) {
      const status = await getRideOverlayStatus();
      if (!status.canDrawOverlays) {
        await openRideOverlaySettings();
      }
    }
    refreshRideOverlay();
  }, [refreshRideOverlay]);
  const [usageDataEnabled, setUsageDataEnabled] = useState(null);

  useEffect(() => {
    let live = true;
    loadAnalyticsPreference().then(enabled => { if (live) setUsageDataEnabled(enabled); });
    return () => { live = false; };
  }, []);

  const toggleUsageData = useCallback(value => {
    setUsageDataEnabled(value);
    setAnalyticsEnabled(value).then(setUsageDataEnabled);
  }, []);

  const receivePermission = useCallback(granted => {
    const newlyGranted = granted && previousPermission.current === false;
    previousPermission.current = granted;
    setNotificationPermission(granted);
    if (newlyGranted) FCMNotificationService.getFCMToken().catch(failure => Logger.warn('Registro push pendente:', failure.message));
  }, []);

  useEffect(() => {
    let live = true;
    const syncPermission = () => FCMNotificationService.hasNotificationPermission()
      .then(granted => { if (live) receivePermission(granted); });
    syncPermission();
    if (isDriver) isLeafVoiceAvailable().then(available => { if (live) setVoiceAvailable(available); });
    const focus = navigation?.addListener?.('focus', () => { syncPermission(); refresh({ forceRefresh: true }); });
    const subscription = AppState.addEventListener('change', state => { if (state === 'active') syncPermission(); });
    return () => { live = false; focus?.(); subscription?.remove(); };
  }, [navigation, isDriver, refresh, receivePermission]);

  // Android: go straight to this app's notification screen instead of the
  // generic "App info" page; fall back to it if the intent is unavailable.
  const openNotificationSettings = useCallback(async () => {
    if (Platform.OS === 'android' && Application.applicationId) {
      try {
        await Linking.sendIntent('android.settings.APP_NOTIFICATION_SETTINGS', [
          { key: 'android.provider.extra.APP_PACKAGE', value: Application.applicationId },
        ]);
        return;
      } catch { /* fall back to app settings */ }
    }
    await Linking.openSettings();
  }, []);

  const configureNotifications = useCallback(async () => {
    if (permissionBusy) return;
    setPermissionBusy(true);
    try {
      const granted = await FCMNotificationService.hasNotificationPermission();
      if (granted) await openNotificationSettings();
      else {
        const enabled = await FCMNotificationService.requestUserPermission();
        receivePermission(enabled);
        if (!enabled) Alert.alert('Notificações desativadas', 'Ative as notificações da Leaf nos ajustes do dispositivo.', [
          { text: 'Agora não', style: 'cancel' },
          { text: 'Abrir ajustes', onPress: () => openNotificationSettings().catch(() => Alert.alert('Ajustes indisponíveis', 'Abra os ajustes do dispositivo e selecione Leaf.')) },
        ]);
      }
    } catch { Alert.alert('Não foi possível abrir os ajustes', 'Tente novamente.'); }
    finally { setPermissionBusy(false); }
  }, [openNotificationSettings, permissionBusy, receivePermission]);

  const savePreference = useCallback(async (key, value) => {
    try {
      if (key === 'voiceGuidanceEnabled' && value) {
        const available = await isLeafVoiceAvailable();
        setVoiceAvailable(available);
        if (!available) {
          Alert.alert('Voz indisponível', 'Instale uma voz em português do Brasil nos ajustes do dispositivo. Para versões anteriores do app, instale a atualização da Leaf.');
          return;
        }
      }
      if (key === 'voiceGuidanceEnabled' && !value) await stopLeafNavigationVoice();
      await update({ [key]: value });
    } catch (failure) { Alert.alert('Configuração não salva', failure.message); }
  }, [update]);
  const { promptAccountDeletion } = useAccountDeletionFlow({
    navigation,
    profile: deletionProfile,
    source: 'mobile-app-settings-screen',
    additionalInfo: 'Solicitação enviada pela tela de configurações do app',
  });

  useEffect(() => {
    const showStatusBar = () => StatusBar.setHidden(false, 'fade');

    showStatusBar();
    const removeFocusListener = navigation?.addListener?.('focus', showStatusBar);
    const removeBlurListener = navigation?.addListener?.('blur', showStatusBar);

    return () => {
      removeFocusListener?.();
      removeBlurListener?.();
      showStatusBar();
    };
  }, [navigation]);

  usePrototypeMapOcclusion({
    routeKey: route?.key,
    layerId: route?.key || 'prototype-settings',
    occludedBottom: panelHeight,
  });

  const handleDismiss = useCallback(() => {
    if (route?.params?.returnToAccount && navigation.canGoBack()) {
      navigation.goBack();
      return;
    }
    navigation.navigate('RobotaxiPrototype');
  }, [navigation, route?.params?.returnToAccount]);

  const handlePanelLayout = useCallback(event => {
    const nextHeight = event?.nativeEvent?.layout?.height;
    if (Number.isFinite(nextHeight) && nextHeight > 0) {
      setPanelHeight(nextHeight);
    }
  }, []);

  const visibleSettingRows = [
    {
      section: 'ride',
      item: ROBOTAXI_SETTINGS_ITEMS.navigationApp,
      icon: 'navigate-outline',
      title: 'App de navegação',
      subtitle: navigationApp ? NAVIGATION_APP_LABELS[navigationApp] : 'Perguntar na próxima corrida',
      onPress: chooseNavigationApp,
      disabled: navigationApp === undefined,
      showChevron: true,
      rowTestID: 'robotaxi-settings-row-navigation-app',
      driverOnly: true,
    },
    {
      section: 'ride',
      item: ROBOTAXI_SETTINGS_ITEMS.autoNavigation,
      icon: 'car-outline',
      title: 'Abrir navegação na corrida',
      subtitle: 'Ao aceitar e ao iniciar a corrida',
      rowTestID: 'robotaxi-settings-row-auto-navigation',
      switchTestID: 'robotaxi-settings-switch-auto-navigation',
      switchValue: autoNavigation,
      onValueChange: toggleAutoNavigation,
      disabled: autoNavigation === null,
      driverOnly: true,
    },
    ...(isRideOverlayAvailable() ? [{
      section: 'ride',
      item: ROBOTAXI_SETTINGS_ITEMS.rideOverlay,
      icon: 'layers-outline',
      title: 'Corrida por cima da navegação',
      subtitle: 'Tempo, destino e botões num balão sobre o Waze ou o Maps',
      rowTestID: 'robotaxi-settings-row-ride-overlay',
      switchTestID: 'robotaxi-settings-switch-ride-overlay',
      switchValue: rideOverlayOn,
      onValueChange: toggleRideOverlay,
      disabled: rideOverlayOn === null,
      driverOnly: true,
    }] : []),
    {
      section: 'ride',
      item: ROBOTAXI_SETTINGS_ITEMS.voice,
      icon: 'volume-medium-outline',
      title: 'Instruções por voz',
      subtitle: voiceAvailable === false ? 'Configure a voz do dispositivo' : 'Orientações durante a navegação',
      rowTestID: 'robotaxi-settings-row-voice',
      switchTestID: 'robotaxi-settings-switch-voice',
      switchValue: preferences.voiceGuidanceEnabled,
      onValueChange: value => savePreference('voiceGuidanceEnabled', value),
      disabled: !ready || loading || saving,
      driverOnly: true,
    },
    {
      section: 'ride',
      item: ROBOTAXI_SETTINGS_ITEMS.traffic,
      icon: 'map-outline',
      title: 'Trânsito no mapa',
      subtitle: 'Condições de trânsito',
      rowTestID: 'robotaxi-settings-row-traffic',
      switchTestID: 'robotaxi-settings-switch-traffic',
      switchValue: preferences.trafficLayerEnabled,
      onValueChange: value => savePreference('trafficLayerEnabled', value),
      disabled: !ready || loading || saving,
      driverOnly: true,
    },
    {
      section: 'general',
      item: ROBOTAXI_SETTINGS_ITEMS.notifications,
      icon: 'notifications-outline',
      title: 'Notificações',
      subtitle: notificationPermission === null ? 'Verificando permissão' : notificationPermission ? 'Ativadas no dispositivo' : 'Desativadas no dispositivo',
      onPress: configureNotifications,
      disabled: permissionBusy,
      showChevron: true,
      rowTestID: 'robotaxi-settings-row-notifications',
      switchTestID: 'robotaxi-settings-switch-notifications',
    },
    {
      section: 'general',
      item: ROBOTAXI_SETTINGS_ITEMS.password,
      icon: 'lock-closed-outline',
      title: 'Senha de acesso',
      subtitle: 'Entrar sem esperar o código',
      onPress: () => navigation.navigate('LeafAccountPassword'),
      rowTestID: 'robotaxi-settings-row-password',
      showChevron: true,
    },
    {
      section: 'general',
      item: ROBOTAXI_SETTINGS_ITEMS.usageData,
      icon: 'analytics-outline',
      title: 'Dados de uso',
      subtitle: 'Ajuda a melhorar o app, sem dados pessoais',
      rowTestID: 'robotaxi-settings-row-usage-data',
      switchTestID: 'robotaxi-settings-switch-usage-data',
      switchValue: usageDataEnabled,
      onValueChange: toggleUsageData,
      disabled: usageDataEnabled === null,
    },
    {
      section: 'account',
      item: ROBOTAXI_SETTINGS_ITEMS.privacy,
      icon: 'shield-checkmark-outline',
      title: 'Privacidade',
      subtitle: 'Dados, permissões e exclusão',
      onPress: () => navigation.navigate('PrivacyPolicy'),
      rowTestID: 'robotaxi-settings-row-privacy',
      showChevron: true,
    },
    {
      section: 'account',
      item: ROBOTAXI_SETTINGS_ITEMS.deleteAccount,
      icon: 'trash-outline',
      title: 'Excluir conta',
      subtitle: 'Iniciar exclusão permanente',
      onPress: promptAccountDeletion,
      rowTestID: 'robotaxi-settings-row-delete-account',
      showChevron: true,
      tone: 'danger',
    },
  ].filter(({ item, driverOnly }) => !isCurrentSurfaceUnavailable(item.status) && (!driverOnly || isDriver));

  return (
    <PrototypeScreenTransition>
      <View
        style={styles.container}
        pointerEvents="box-none"
        testID="robotaxi-settings-screen"
      >
        <StatusBar translucent backgroundColor="transparent" barStyle="dark-content" />
        <PrototypeDismissibleSheet
          onClose={handleDismiss}
          backdropColor={BACKDROP_COLOR}
          dragEnabled={false}
          sheetStyle={styles.sheetWrap}
        >
          <View
            onLayout={handlePanelLayout}
            style={[
              styles.surface,
              {
              paddingTop: insets.top + SURFACE_TOP_PADDING,
              paddingBottom: Math.max(insets.bottom, SURFACE_BOTTOM_PADDING),
              },
            ]}
          >
            <View style={styles.headerRow}>
              <TouchableOpacity
                style={styles.closeButton}
                onPress={handleDismiss}
                activeOpacity={0.78}
                testID="robotaxi-settings-close-button"
                accessibilityLabel="Voltar"
              >
                <Feather name="arrow-left" size={20} color={SETTINGS_COLOR.text} />
              </TouchableOpacity>
              <View style={styles.headerCopy}>
                <Text style={styles.screenTitle}>Configurações</Text>
              </View>
              {/* Rows render from cache immediately; refresh/save status lives in
                  the header so the list never shifts when it appears or clears. */}
              {loading || saving ? <View testID={loading ? 'robotaxi-settings-loading' : 'robotaxi-settings-saving'}
                accessibilityLabel={loading ? 'Carregando configurações' : 'Salvando configuração'} accessibilityLiveRegion="polite">
                <ActivityIndicator size="small" color="#1A330E" />
              </View> : null}
            </View>

            <ScrollView
              showsVerticalScrollIndicator={false}
              contentContainerStyle={styles.rowsContent}
            >
              {error ? <TouchableOpacity testID="robotaxi-settings-retry" style={styles.feedback} onPress={() => refresh({ forceRefresh: true })}><Text style={styles.settingSubtitle}>Configurações não atualizadas · Tentar novamente</Text></TouchableOpacity> : null}
              {SETTINGS_SECTIONS.filter(section => visibleSettingRows.some(row => row.section === section.key)).map((section, sectionIndex) => {
                const rows = visibleSettingRows.filter(row => row.section === section.key);
                return <View key={section.key} testID={`robotaxi-settings-section-${section.key}`}>
                  <Text style={[styles.sectionTitle, sectionIndex === 0 && { marginTop: 0 }]} accessibilityRole="header">{section.title}</Text>
                  {rows.map(({ item, driverOnly, section: _section, ...row }, index) => (
                    <SettingRow key={item.key} {...row} last={index === rows.length - 1} />
                  ))}
                </View>;
              })}
            </ScrollView>
          </View>
        </PrototypeDismissibleSheet>
      </View>
    </PrototypeScreenTransition>
  );
}

const styles = StyleSheet.create({
  sectionTitle: { ...leafTypography.semiBold, fontSize: 13, lineHeight: 18, color: SETTINGS_COLOR.secondary, marginTop: 20, marginBottom: 2 },
  feedback: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 12 },
  container: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  sheetWrap: {
    ...StyleSheet.absoluteFillObject,
  },
  surface: {
    flex: 1,
    backgroundColor: SETTINGS_COLOR.bg,
    paddingHorizontal: 24,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    minHeight: 44,
    marginBottom: 20,
  },
  headerCopy: {
    flex: 1,
    paddingRight: 4,
  },
  closeButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F5F5F5',
  },
  screenTitle: {
    color: SETTINGS_COLOR.title,
    ...leafTypography.semiBold,
    fontSize: 22,
    lineHeight: 28,
    letterSpacing: -0.4,
  },
  screenSubtitle: {
    marginTop: 8,
    color: SETTINGS_COLOR.secondary,
    ...leafTypography.regular,
    fontSize: 14,
    lineHeight: 20,
  },
  rowsContent: {
    paddingTop: 4,
    paddingBottom: 28,
  },
  settingRow: {
    minHeight: 68,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: SETTINGS_COLOR.line,
  },
  settingRowLast: {
    borderBottomWidth: 0,
  },
  settingTextWrap: {
    flex: 1,
    minWidth: 0,
    paddingRight: 12,
  },
  settingTitle: {
    color: SETTINGS_COLOR.text,
    ...leafTypography.medium,
    fontSize: 16,
    lineHeight: 22,
  },
  settingTitleDanger: {
    color: SETTINGS_COLOR.danger,
  },
  settingSubtitle: {
    marginTop: 3,
    color: SETTINGS_COLOR.secondary,
    ...leafTypography.regular,
    fontSize: 13,
    lineHeight: 18,
  },
  rowIconSlot: {
    width: 40,
    alignItems: 'flex-start',
    justifyContent: 'center',
  },
  hiddenSwitchTarget: {
    position: 'absolute',
    width: 1,
    height: 1,
    opacity: 0,
  },
});
