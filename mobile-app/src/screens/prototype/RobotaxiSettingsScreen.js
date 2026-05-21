import React, { useCallback, useState } from 'react';
import { Alert, ScrollView, StatusBar, StyleSheet, Text, TouchableOpacity, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useSelector } from 'react-redux';
import { fonts } from '../../theme/runtimeTokens';
import PrototypeScreenTransition from '../../components/prototype/PrototypeScreenTransition';
import PrototypeDismissibleSheet from '../../components/prototype/PrototypeDismissibleSheet';
import { usePrototypeMapOcclusion } from './prototypeMapOcclusion';
import { usePrototypeRideRuntime } from './prototypeRideRuntime';
import { useAccountDeletionFlow } from '../../hooks/useAccountDeletionFlow';
import { useAccountSessionReset } from '../../hooks/useAccountSessionReset';
import Logger from '../../utils/Logger';

const SURFACE_TOP_PADDING = 16;
const SURFACE_BOTTOM_PADDING = 18;
const BACKDROP_COLOR = 'transparent';
const SETTINGS_COLOR = {
  bg: '#F6FAF6',
  text: '#101C14',
  title: '#102018',
  secondary: '#66756B',
  line: '#DFE8E1',
  dot: '#26A66A',
  danger: '#9F2424',
};

function SettingRow({
  title,
  subtitle,
  onPress,
  rowTestID,
  switchTestID,
  showChevron = false,
  tone = 'default',
  last = false
}) {
  return (
    <TouchableOpacity
      style={[styles.settingRow, last && styles.settingRowLast]}
      onPress={onPress}
      activeOpacity={0.78}
      testID={rowTestID}
      accessibilityLabel={rowTestID}
    >
      <View style={[styles.rowDot, tone === 'danger' && styles.rowDotDanger]} />
      <View style={styles.settingTextWrap}>
        <Text style={[styles.settingTitle, tone === 'danger' && styles.settingTitleDanger]}>
          {title}
        </Text>
        <Text style={styles.settingSubtitle}>{subtitle}</Text>
      </View>
      <View testID={switchTestID} accessibilityLabel={switchTestID} style={styles.hiddenSwitchTarget} />
      {showChevron ? <Text style={styles.chevron}>›</Text> : null}
    </TouchableOpacity>
  );
}

export default function RobotaxiSettingsScreen({ navigation, route }) {
  const authProfile = useSelector(state => state?.auth?.profile);
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();
  const { riderProfile, notificationsEnabled, trafficLayerEnabled, voiceGuidanceEnabled, updateSettings } =
    usePrototypeRideRuntime();
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

  const toggleNotifications = useCallback(() => {
    updateSettings({ notificationsEnabled: !notificationsEnabled });
  }, [notificationsEnabled, updateSettings]);

  const toggleTrafficAndVoice = useCallback(() => {
    updateSettings({
      trafficLayerEnabled: !trafficLayerEnabled,
      voiceGuidanceEnabled: !voiceGuidanceEnabled,
    });
  }, [trafficLayerEnabled, updateSettings, voiceGuidanceEnabled]);

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
            <View style={styles.statusRow}>
              <Text style={styles.statusText}>9:41</Text>
              <Text style={styles.statusText}>100%</Text>
            </View>

            <TouchableOpacity
              style={styles.closeHit}
              onPress={handleDismiss}
              activeOpacity={0.78}
              testID="robotaxi-settings-close-button"
              accessibilityLabel="robotaxi-settings-close-button"
            />

            <Text style={styles.screenTitle}>Configurações</Text>
            <Text style={styles.screenSubtitle}>
              Ajuste acesso, privacidade e saída da conta.
            </Text>

            <ScrollView
              showsVerticalScrollIndicator={false}
              contentContainerStyle={styles.rowsContent}
            >
              <SettingRow
                title="Notificacoes"
                subtitle={
                  notificationsEnabled
                    ? 'Viagens, pagamentos e seguranca · ligadas'
                    : 'Viagens, pagamentos e seguranca · desligadas'
                }
                onPress={toggleNotifications}
                rowTestID="robotaxi-settings-row-notifications"
                switchTestID="robotaxi-settings-switch-notifications"
              />
              <SettingRow
                title="Idioma"
                subtitle="Português do Brasil"
                onPress={() => Alert.alert('Idioma', 'Português do Brasil está ativo.')}
                rowTestID="robotaxi-settings-row-language"
              />
              <SettingRow
                title="Mapa e voz"
                subtitle={
                  trafficLayerEnabled || voiceGuidanceEnabled
                    ? 'Transito e instrucoes de rota ativos'
                    : 'Transito e instrucoes de rota pausados'
                }
                onPress={toggleTrafficAndVoice}
                rowTestID="robotaxi-settings-row-traffic"
                switchTestID="robotaxi-settings-switch-traffic"
              />
              <SettingRow
                title="Métodos de pagamento"
                subtitle="PIX, recibo e próximos métodos"
                onPress={() => navigation.navigate('RobotaxiPrototypePaymentMethods')}
                rowTestID="robotaxi-settings-row-payment-methods"
                showChevron
              />
              <SettingRow
                title="Instrucoes por voz"
                subtitle={voiceGuidanceEnabled ? 'Orientacoes de audio ligadas' : 'Orientacoes de audio desligadas'}
                onPress={() => updateSettings({ voiceGuidanceEnabled: !voiceGuidanceEnabled })}
                rowTestID="robotaxi-settings-row-voice"
                switchTestID="robotaxi-settings-switch-voice"
              />
              <SettingRow
                title="Privacidade"
                subtitle="Dados, permissões e exclusão"
                onPress={() => navigation.navigate('PrivacyPolicy')}
                rowTestID="robotaxi-settings-row-privacy"
              />
              <SettingRow
                title="Sair da conta"
                subtitle="Voltar para inserir telefone"
                onPress={promptLogout}
                rowTestID="robotaxi-settings-row-logout"
              />
              <SettingRow
                title="Excluir conta"
                subtitle="Iniciar exclusão permanente"
                onPress={promptAccountDeletion}
                rowTestID="robotaxi-settings-row-delete-account"
                showChevron
                tone="danger"
              />
              <SettingRow
                title="Falar com suporte"
                subtitle="Ajuda sem sair do fluxo atual"
                last
                onPress={() => navigation.replace('RobotaxiPrototypeSupport')}
                rowTestID="robotaxi-settings-open-support"
                showChevron
              />
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
    paddingHorizontal: 31,
  },
  statusRow: {
    minHeight: 18,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  statusText: {
    color: SETTINGS_COLOR.text,
    fontFamily: fonts.Medium,
    fontSize: 11,
    lineHeight: 15,
  },
  closeHit: {
    position: 'absolute',
    top: 0,
    right: 0,
    width: 72,
    height: 88,
  },
  screenTitle: {
    marginTop: 28,
    color: SETTINGS_COLOR.title,
    fontFamily: fonts.Medium,
    fontSize: 19,
    lineHeight: 25,
  },
  screenSubtitle: {
    marginTop: 8,
    color: SETTINGS_COLOR.secondary,
    fontFamily: fonts.Regular,
    fontSize: 13,
    lineHeight: 18,
  },
  rowsContent: {
    paddingTop: 38,
    paddingBottom: 28,
  },
  settingRow: {
    minHeight: 74,
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
  rowDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: SETTINGS_COLOR.dot,
    marginRight: 12,
  },
  rowDotDanger: {
    backgroundColor: SETTINGS_COLOR.danger,
  },
  chevron: {
    width: 18,
    color: SETTINGS_COLOR.text,
    fontFamily: fonts.Medium,
    fontSize: 14,
    lineHeight: 18,
    textAlign: 'right',
  },
  hiddenSwitchTarget: {
    position: 'absolute',
    width: 1,
    height: 1,
    opacity: 0,
  },
});
