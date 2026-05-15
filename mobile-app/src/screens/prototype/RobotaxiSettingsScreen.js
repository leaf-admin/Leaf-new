import React, { useCallback, useState } from 'react';
import { StatusBar, StyleSheet, Switch, Text, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useSelector } from 'react-redux';
import { Ionicons } from '@expo/vector-icons';
import { fonts } from '../../theme/runtimeTokens';
import PrototypeScreenTransition from '../../components/prototype/PrototypeScreenTransition';
import PrototypeDismissibleSheet from '../../components/prototype/PrototypeDismissibleSheet';
import {
  PrototypeMenuCloseButton,
  PrototypeMenuRow,
  PrototypeMenuSection,
  PrototypeMenuSurface,
} from '../../components/prototype/PrototypeMenuSurface';
import robotaxiPrototypeTokens from '../../components/design-system/robotaxiPrototypeTokens';
import { usePrototypeMapOcclusion } from './prototypeMapOcclusion';
import { usePrototypeRideRuntime } from './prototypeRideRuntime';
import { resolvePrototypeProfileName } from './prototypeProfileIdentity';

const { color, typography } = robotaxiPrototypeTokens;
const SURFACE_TOP_PADDING = 16;
const SURFACE_BOTTOM_PADDING = 18;
const BACKDROP_COLOR = 'transparent';
const SWITCH_TRACK_COLORS = { false: '#D9DFE6', true: '#9BB38E' };
const SWITCH_THUMB_COLOR = '#FFFFFF';

function SettingRow({
  icon,
  title,
  subtitle,
  value,
  onValueChange,
  rowTestID,
  switchTestID,
  last = false
}) {
  return (
    <View
      style={[styles.settingRow, last && styles.settingRowLast]}
      testID={rowTestID}
      accessibilityLabel={rowTestID}
    >
      <View style={styles.settingCopyWrap}>
        <View style={styles.settingIconSlot}>
          <Ionicons name={icon} size={18} color={color.text.primary} />
        </View>
        <View style={styles.settingTextWrap}>
          <Text style={styles.settingTitle}>{title}</Text>
          <Text style={styles.settingSubtitle}>{subtitle}</Text>
        </View>
      </View>

      <Switch
        value={value}
        onValueChange={onValueChange}
        trackColor={SWITCH_TRACK_COLORS}
        thumbColor={SWITCH_THUMB_COLOR}
        ios_backgroundColor={SWITCH_TRACK_COLORS.false}
        style={styles.toggleSwitch}
        testID={switchTestID}
      />
    </View>
  );
}

export default function RobotaxiSettingsScreen({ navigation, route }) {
  const authProfile = useSelector(state => state?.auth?.profile);
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();
  const { riderProfile, activeRole, notificationsEnabled, trafficLayerEnabled, voiceGuidanceEnabled, updateSettings } =
    usePrototypeRideRuntime();
  const [panelHeight, setPanelHeight] = useState(windowHeight);
  const isDriverRole = activeRole === 'driver';
  const profileName =
    resolvePrototypeProfileName(authProfile) ||
    resolvePrototypeProfileName(riderProfile) ||
    (isDriverRole ? 'Motorista Leaf' : 'Passageiro Leaf');

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
          <PrototypeMenuSurface
            onLayout={handlePanelLayout}
            eyebrow={isDriverRole ? 'Ajustes do motorista' : 'Ajustes da conta'}
            title="Configuracoes"
            subtitle={
              isDriverRole
                ? `Preferencias operacionais para ${profileName}.`
                : `Preferencias de notificacao, mapa e acessibilidade para ${profileName}.`
            }
            fullScreen
            style={{
              paddingTop: insets.top + SURFACE_TOP_PADDING,
              paddingBottom: Math.max(insets.bottom, SURFACE_BOTTOM_PADDING),
            }}
            headerAccessory={(
              <PrototypeMenuCloseButton
                onPress={handleDismiss}
                testID="robotaxi-settings-close-button"
                accessibilityLabel="robotaxi-settings-close-button"
              />
            )}
          >
            <PrototypeMenuSection title="Preferencias">
              <SettingRow
                icon="notifications-outline"
                title="Alertas de corrida"
                subtitle={
                  isDriverRole
                    ? 'Avisos de novas solicitacoes, aceite e atualizacoes de rota.'
                    : 'Avisos sobre motorista, chegada e status da viagem.'
                }
                value={notificationsEnabled}
                onValueChange={value => updateSettings({ notificationsEnabled: value })}
                rowTestID="robotaxi-settings-row-notifications"
                switchTestID="robotaxi-settings-switch-notifications"
              />
              <SettingRow
                icon="map-outline"
                title="Camada de transito"
                subtitle="Mostra trafego no mapa para facilitar leitura da rota."
                value={trafficLayerEnabled}
                onValueChange={value => updateSettings({ trafficLayerEnabled: value })}
                rowTestID="robotaxi-settings-row-traffic"
                switchTestID="robotaxi-settings-switch-traffic"
              />
              <SettingRow
                icon="volume-high-outline"
                title="Instrucoes por voz"
                subtitle="Ativa orientacoes de audio durante deslocamento."
                value={voiceGuidanceEnabled}
                onValueChange={value => updateSettings({ voiceGuidanceEnabled: value })}
                rowTestID="robotaxi-settings-row-voice"
                switchTestID="robotaxi-settings-switch-voice"
                last
              />
            </PrototypeMenuSection>

            <PrototypeMenuSection title="Ajuda">
              <PrototypeMenuRow
                icon="chatbubble-ellipses-outline"
                title="Falar com suporte"
                subtitle="Abra o canal de ajuda sem sair do fluxo atual."
                last
                onPress={() => navigation.replace('RobotaxiPrototypeSupport')}
                testID="robotaxi-settings-open-support"
                accessibilityLabel="robotaxi-settings-open-support"
              />
            </PrototypeMenuSection>
          </PrototypeMenuSurface>
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
  settingRow: {
    minHeight: 64,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(17,26,39,0.08)',
  },
  settingRowLast: {
    borderBottomWidth: 0,
    paddingBottom: 4,
  },
  settingCopyWrap: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    paddingRight: 12,
  },
  settingIconSlot: {
    width: 28,
    alignItems: 'flex-start',
  },
  settingTextWrap: {
    flex: 1,
  },
  settingTitle: {
    color: color.text.primary,
    fontFamily: fonts.SemiBold,
    fontSize: 16,
    lineHeight: 22,
  },
  settingSubtitle: {
    marginTop: 1,
    color: color.text.secondary,
    fontFamily: fonts.Regular,
    fontSize: typography.micro.size,
    lineHeight: typography.micro.lineHeight,
  },
  toggleSwitch: {
    transform: [{ scaleX: 0.82 }, { scaleY: 0.82 }],
  },
});
