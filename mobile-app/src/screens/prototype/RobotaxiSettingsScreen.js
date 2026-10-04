import leafTypography from '../../components/prototype/LeafTypography';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, AppState, Linking, ScrollView, StatusBar, StyleSheet, Switch, Text, TouchableOpacity, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useSelector } from 'react-redux';
import { Ionicons } from '@expo/vector-icons';
import { LeafObjectIcon } from '../../components/prototype/LeafVisualElements';
import PrototypeScreenTransition from '../../components/prototype/PrototypeScreenTransition';
import PrototypeDismissibleSheet from '../../components/prototype/PrototypeDismissibleSheet';
import { usePrototypeMapOcclusion } from './prototypeMapOcclusion';
import { usePrototypeRideRuntime } from './prototypeRideRuntime';
import { useAccountDeletionFlow } from '../../hooks/useAccountDeletionFlow';
import { useAccountSessionReset } from '../../hooks/useAccountSessionReset';
import Logger from '../../utils/Logger';
import { isCurrentSurfaceUnavailable } from './currentSurfaceStatus';
import { ROBOTAXI_SETTINGS_ITEMS } from './robotaxiSettingsConfig';
import { useMobilePreferences } from '../../components/MobilePreferencesProvider';
import FCMNotificationService from '../../services/FCMNotificationService';
import { isLeafVoiceAvailable, stopLeafNavigationVoice } from '../../services/LeafVoiceGuidanceService';

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
  const Container = onValueChange ? View : TouchableOpacity;
  return (
    <Container
      style={[styles.settingRow, last && styles.settingRowLast]}
      onPress={onPress}
      disabled={disabled}
      activeOpacity={0.78}
      testID={rowTestID}
      accessibilityLabel={onValueChange ? undefined : title}
      accessibilityHint={onValueChange ? undefined : subtitle}
      accessibilityRole={onValueChange ? undefined : 'button'}
      accessibilityState={{ disabled }}
    >
      <View style={styles.rowIconSlot}>
        <LeafObjectIcon symbol={icon} size={40} />
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
        <Ionicons
          name="chevron-forward"
          size={15}
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

  const configureNotifications = useCallback(async () => {
    if (permissionBusy) return;
    setPermissionBusy(true);
    try {
      const granted = await FCMNotificationService.hasNotificationPermission();
      if (granted) await Linking.openSettings();
      else {
        const enabled = await FCMNotificationService.requestUserPermission();
        receivePermission(enabled);
        if (!enabled) Alert.alert('Notificações desativadas', 'Ative as notificações da Leaf nos ajustes do dispositivo.', [
          { text: 'Agora não', style: 'cancel' },
          { text: 'Abrir ajustes', onPress: () => Linking.openSettings().catch(() => Alert.alert('Ajustes indisponíveis', 'Abra os ajustes do dispositivo e selecione Leaf.')) },
        ]);
      }
    } catch { Alert.alert('Não foi possível abrir os ajustes', 'Tente novamente.'); }
    finally { setPermissionBusy(false); }
  }, [permissionBusy, receivePermission]);

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
  const { resetSessionToStart } = useAccountSessionReset({
    navigation,
    profile: deletionProfile,
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

  const promptLogout = useCallback(() => {
    Alert.alert(
      'Sair da conta',
      'Tem certeza que deseja voltar para a entrada por telefone?',
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Sair',
          style: 'destructive',
          onPress: () => {
            resetSessionToStart().catch((error) => {
              Logger.error('Erro ao sair da conta pelos ajustes:', error);
              Alert.alert('Não foi possível sair', 'Tente novamente em alguns instantes.');
            });
          },
        },
      ],
    );
  }, [resetSessionToStart]);

  const visibleSettingRows = [
    {
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
      item: ROBOTAXI_SETTINGS_ITEMS.language,
      icon: 'language-outline',
      title: 'Idioma',
      subtitle: 'Português do Brasil',
      onPress: () => Alert.alert('Idioma do aplicativo', 'Português do Brasil está disponível nesta versão da Leaf.'),
      showChevron: true,
      rowTestID: 'robotaxi-settings-row-language',
    },
    {
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
      item: ROBOTAXI_SETTINGS_ITEMS.privacy,
      icon: 'shield-checkmark-outline',
      title: 'Privacidade',
      subtitle: 'Dados, permissões e exclusão',
      onPress: () => navigation.navigate('PrivacyPolicy'),
      rowTestID: 'robotaxi-settings-row-privacy',
      showChevron: true,
    },
    {
      item: ROBOTAXI_SETTINGS_ITEMS.logout,
      icon: 'log-out-outline',
      title: 'Sair da conta',
      subtitle: 'Voltar para inserir telefone',
      onPress: promptLogout,
      rowTestID: 'robotaxi-settings-row-logout',
      showChevron: true,
    },
    {
      item: ROBOTAXI_SETTINGS_ITEMS.deleteAccount,
      icon: 'trash-outline',
      title: 'Excluir conta',
      subtitle: 'Iniciar exclusão permanente',
      onPress: promptAccountDeletion,
      rowTestID: 'robotaxi-settings-row-delete-account',
      showChevron: true,
      tone: 'danger',
    },
    {
      item: ROBOTAXI_SETTINGS_ITEMS.support,
      icon: 'help-circle-outline',
      title: 'Falar com suporte',
      subtitle: 'Ajuda sem sair do fluxo atual',
      onPress: () => navigation.replace('RobotaxiPrototypeSupport'),
      rowTestID: 'robotaxi-settings-open-support',
      showChevron: true,
      last: true,
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
                <Ionicons name="arrow-back" size={20} color={SETTINGS_COLOR.text} />
              </TouchableOpacity>
              <View style={styles.headerCopy}>
                <Text style={styles.screenTitle}>Configurações</Text>
              </View>
            </View>

            <ScrollView
              showsVerticalScrollIndicator={false}
              contentContainerStyle={styles.rowsContent}
            >
              {loading ? <View testID="robotaxi-settings-loading" style={styles.feedback}><ActivityIndicator size="small" color="#1A330E" /><Text style={styles.settingSubtitle}>Carregando configurações</Text></View> : null}
              {error ? <TouchableOpacity testID="robotaxi-settings-retry" style={styles.feedback} onPress={() => refresh({ forceRefresh: true })}><Text style={styles.settingSubtitle}>Configurações não atualizadas · Tentar novamente</Text></TouchableOpacity> : null}
              {saving ? <Text testID="robotaxi-settings-saving" style={styles.settingSubtitle}>Salvando configuração</Text> : null}
              {visibleSettingRows.map(({ item, driverOnly, ...row }) => (
                <SettingRow key={item.key} {...row} />
              ))}
            </ScrollView>
          </View>
        </PrototypeDismissibleSheet>
      </View>
    </PrototypeScreenTransition>
  );
}

const styles = StyleSheet.create({
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
    width: 52,
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
