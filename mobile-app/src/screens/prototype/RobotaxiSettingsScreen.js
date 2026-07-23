import React, { useCallback, useEffect, useState } from 'react';
import { Alert, ScrollView, StatusBar, StyleSheet, Text, TouchableOpacity, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useSelector } from 'react-redux';
import { Ionicons } from '@expo/vector-icons';
import { fonts } from '../../theme/runtimeTokens';
import PrototypeScreenTransition from '../../components/prototype/PrototypeScreenTransition';
import PrototypeDismissibleSheet from '../../components/prototype/PrototypeDismissibleSheet';
import { usePrototypeMapOcclusion } from './prototypeMapOcclusion';
import { usePrototypeRideRuntime } from './prototypeRideRuntime';
import { useAccountDeletionFlow } from '../../hooks/useAccountDeletionFlow';
import { useAccountSessionReset } from '../../hooks/useAccountSessionReset';
import Logger from '../../utils/Logger';
import { isCurrentSurfaceUnavailable } from './currentSurfaceStatus';
import { ROBOTAXI_SETTINGS_ITEMS } from './robotaxiSettingsConfig';

const SURFACE_TOP_PADDING = 28;
const SURFACE_BOTTOM_PADDING = 18;
const BACKDROP_COLOR = 'transparent';
const SETTINGS_COLOR = {
  bg: '#F8F6F1',
  text: '#171412',
  title: '#171412',
  secondary: '#756F68',
  line: '#E9E2D8',
  danger: '#9F2424',
  icon: '#514B45',
  chevron: '#827B73',
};

function SettingRow({
  icon,
  title,
  subtitle,
  onPress,
  rowTestID,
  switchTestID,
  showChevron = false,
  tone = 'default',
  last = false,
}) {
  return (
    <TouchableOpacity
      style={[styles.settingRow, last && styles.settingRowLast]}
      onPress={onPress}
      activeOpacity={0.78}
      testID={rowTestID}
      accessibilityLabel={title}
      accessibilityHint={subtitle}
      accessibilityRole="button"
      accessibilityState={{ disabled: false }}
    >
      <View style={styles.rowIconSlot}>
        <Ionicons
          name={icon || 'ellipse-outline'}
          size={17}
          color={tone === 'danger' ? SETTINGS_COLOR.danger : SETTINGS_COLOR.icon}
        />
      </View>
      <View style={styles.settingTextWrap}>
        <Text style={[styles.settingTitle, tone === 'danger' && styles.settingTitleDanger]}>
          {title}
        </Text>
        <Text style={styles.settingSubtitle}>{subtitle}</Text>
      </View>
      <View testID={switchTestID} accessible={false} style={styles.hiddenSwitchTarget} />
      {showChevron ? (
        <Ionicons
          name="chevron-forward"
          size={15}
          color={tone === 'danger' ? SETTINGS_COLOR.danger : SETTINGS_COLOR.chevron}
        />
      ) : null}
    </TouchableOpacity>
  );
}

export default function RobotaxiSettingsScreen({ navigation, route }) {
  const authProfile = useSelector(state => state?.auth?.profile);
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();
  const { riderProfile } = usePrototypeRideRuntime();
  const [panelHeight, setPanelHeight] = useState(windowHeight);
  const deletionProfile = authProfile || riderProfile;
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
    const hideStatusBar = () => StatusBar.setHidden(true, 'fade');
    const showStatusBar = () => StatusBar.setHidden(false, 'fade');

    hideStatusBar();
    const removeFocusListener = navigation?.addListener?.('focus', hideStatusBar);
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
    navigation.navigate('RobotaxiPrototype');
  }, [navigation]);

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
      subtitle: 'Viagens, pagamentos e segurança',
      rowTestID: 'robotaxi-settings-row-notifications',
      switchTestID: 'robotaxi-settings-switch-notifications',
    },
    {
      item: ROBOTAXI_SETTINGS_ITEMS.language,
      icon: 'language-outline',
      title: 'Idioma',
      subtitle: 'Português do Brasil',
      rowTestID: 'robotaxi-settings-row-language',
    },
    {
      item: ROBOTAXI_SETTINGS_ITEMS.traffic,
      icon: 'map-outline',
      title: 'Trânsito no mapa',
      subtitle: 'Condições de trânsito',
      rowTestID: 'robotaxi-settings-row-traffic',
      switchTestID: 'robotaxi-settings-switch-traffic',
    },
    {
      item: ROBOTAXI_SETTINGS_ITEMS.voice,
      icon: 'volume-medium-outline',
      title: 'Instruções por voz',
      subtitle: 'Orientações de áudio',
      rowTestID: 'robotaxi-settings-row-voice',
      switchTestID: 'robotaxi-settings-switch-voice',
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
  ].filter(({ item }) => !isCurrentSurfaceUnavailable(item.status));

  return (
    <PrototypeScreenTransition>
      <View
        style={styles.container}
        pointerEvents="box-none"
        testID="robotaxi-settings-screen"
        accessibilityLabel="robotaxi-settings-screen"
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
              <View style={styles.headerCopy}>
                <Text style={styles.screenTitle}>Configurações</Text>
                <Text style={styles.screenSubtitle}>
                  Conta, privacidade e suporte.
                </Text>
              </View>
              <TouchableOpacity
                style={styles.closeButton}
                onPress={handleDismiss}
                activeOpacity={0.78}
                testID="robotaxi-settings-close-button"
                accessibilityLabel="Fechar configurações"
              >
                <Ionicons name="close" size={18} color={SETTINGS_COLOR.text} />
              </TouchableOpacity>
            </View>

            <ScrollView
              showsVerticalScrollIndicator={false}
              contentContainerStyle={styles.rowsContent}
            >
              {visibleSettingRows.map(({ item, ...row }) => (
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
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 14,
  },
  headerCopy: {
    flex: 1,
    paddingRight: 4,
  },
  closeButton: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: SETTINGS_COLOR.line,
  },
  screenTitle: {
    color: SETTINGS_COLOR.title,
    fontFamily: fonts.SemiBold,
    fontSize: 20,
    lineHeight: 26,
  },
  screenSubtitle: {
    marginTop: 8,
    color: SETTINGS_COLOR.secondary,
    fontFamily: fonts.Regular,
    fontSize: 13,
    lineHeight: 18,
  },
  rowsContent: {
    paddingTop: 18,
    paddingBottom: 28,
  },
  settingRow: {
    minHeight: 60,
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
    fontFamily: fonts.Medium,
    fontSize: 13,
    lineHeight: 17,
  },
  settingTitleDanger: {
    color: SETTINGS_COLOR.danger,
  },
  settingSubtitle: {
    marginTop: 3,
    color: SETTINGS_COLOR.secondary,
    fontFamily: fonts.Regular,
    fontSize: 10,
    lineHeight: 13,
  },
  rowIconSlot: {
    width: 28,
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
