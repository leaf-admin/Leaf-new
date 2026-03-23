import React, { useCallback, useState } from 'react';
import { StatusBar, StyleSheet, Switch, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { fonts } from '../../common-local/font';
import PrototypeScreenTransition from '../../components/prototype/PrototypeScreenTransition';
import PrototypeDismissibleSheet from '../../components/prototype/PrototypeDismissibleSheet';
import { CardHandle, PrototypeCard, PrototypePrimaryButton } from '../../components/prototype/PrototypeUI';
import robotaxiPrototypeTokens from '../../components/design-system/robotaxiPrototypeTokens';
import { usePrototypeMapOcclusion } from './prototypeMapOcclusion';
import { usePrototypeRideRuntime } from './prototypeRideRuntime';
import useFeatureFlag from '../../hooks/useFeatureFlag';
import featureFlagService from '../../services/FeatureFlagService';

const { color, typography } = robotaxiPrototypeTokens;
const SHEET_BOTTOM_OFFSET = 100;
const FALLBACK_CARD_HEIGHT = 264;

export default function RobotaxiSettingsScreen({ navigation, route }) {
  const insets = useSafeAreaInsets();
  const { notificationsEnabled, trafficLayerEnabled, voiceGuidanceEnabled, updateSettings } = usePrototypeRideRuntime();
  const prototypeUiEnabled = useFeatureFlag('PROTOTYPE_ROBOTAXI_UI_ENABLED', true);
  const [cardHeight, setCardHeight] = useState(FALLBACK_CARD_HEIGHT);
  const sheetBottom = insets.bottom + SHEET_BOTTOM_OFFSET;

  const handleDismiss = () => {
    if (navigation.canGoBack()) {
      navigation.goBack();
      return;
    }
    navigation.navigate('RobotaxiPrototype');
  };

  usePrototypeMapOcclusion({
    routeKey: route?.key,
    layerId: route?.key || 'prototype-settings',
    occludedBottom: sheetBottom + cardHeight
  });

  const handleCardLayout = useCallback(event => {
    const nextHeight = event?.nativeEvent?.layout?.height;
    if (Number.isFinite(nextHeight) && nextHeight > 0) {
      setCardHeight(nextHeight);
    }
  }, []);

  return (
    <PrototypeScreenTransition>
      <View style={styles.container} pointerEvents="box-none">
        <StatusBar translucent backgroundColor="transparent" barStyle="dark-content" />
        <PrototypeDismissibleSheet
          onClose={handleDismiss}
          sheetStyle={[styles.sheetWrap, { bottom: sheetBottom }]}
        >
          <PrototypeCard onLayout={handleCardLayout} style={styles.settingsCard}>
            <CardHandle />

            <Text style={styles.title}>Configurações</Text>

            <View style={styles.optionRow}>
              <View style={styles.optionLabelWrap}>
                <Ionicons name="notifications-outline" size={16} color={color.text.primary} />
                <Text style={styles.optionText}>Alertas de corrida</Text>
              </View>
              <Switch
                value={notificationsEnabled}
                onValueChange={value => updateSettings({ notificationsEnabled: value })}
                trackColor={{ false: '#C7D0DA', true: '#2A4D1D' }}
                thumbColor={notificationsEnabled ? '#1A330E' : '#F7F9FC'}
              />
            </View>

            <View style={styles.optionRow}>
              <View style={styles.optionLabelWrap}>
                <Ionicons name="map-outline" size={16} color={color.text.primary} />
                <Text style={styles.optionText}>Camada de trânsito</Text>
              </View>
              <Switch
                value={trafficLayerEnabled}
                onValueChange={value => updateSettings({ trafficLayerEnabled: value })}
                trackColor={{ false: '#C7D0DA', true: '#2A4D1D' }}
                thumbColor={trafficLayerEnabled ? '#1A330E' : '#F7F9FC'}
              />
            </View>

            <View style={styles.optionRow}>
              <View style={styles.optionLabelWrap}>
                <Ionicons name="volume-high-outline" size={16} color={color.text.primary} />
                <Text style={styles.optionText}>Instruções por voz</Text>
              </View>
              <Switch
                value={voiceGuidanceEnabled}
                onValueChange={value => updateSettings({ voiceGuidanceEnabled: value })}
                trackColor={{ false: '#C7D0DA', true: '#2A4D1D' }}
                thumbColor={voiceGuidanceEnabled ? '#1A330E' : '#F7F9FC'}
              />
            </View>

            <View style={styles.optionRow}>
              <View style={styles.optionLabelWrap}>
                <Ionicons name="layers-outline" size={16} color={color.text.primary} />
                <Text style={styles.optionText}>UI protótipo ativa</Text>
              </View>
              <Switch
                value={prototypeUiEnabled}
                onValueChange={value => {
                  featureFlagService.setFlag('PROTOTYPE_ROBOTAXI_UI_ENABLED', value).catch(() => {});
                }}
                trackColor={{ false: '#C7D0DA', true: '#2A4D1D' }}
                thumbColor={prototypeUiEnabled ? '#1A330E' : '#F7F9FC'}
              />
            </View>

            <Text style={styles.footnote}>Preferências aplicadas em toda a interface do protótipo.</Text>

            <TouchableOpacity
              style={styles.driverShortcut}
              activeOpacity={0.88}
              onPress={() => navigation.navigate('RobotaxiPrototypeDriverPanel')}
            >
              <Ionicons name="speedometer-outline" size={16} color={color.text.primary} />
              <Text style={styles.driverShortcutText}>Abrir painel do motorista</Text>
            </TouchableOpacity>

            <PrototypePrimaryButton
              label="Abrir suporte"
              icon="chatbubble-ellipses-outline"
              onPress={() => navigation.navigate('RobotaxiPrototypeSupport')}
              style={styles.supportButton}
            />
          </PrototypeCard>
        </PrototypeDismissibleSheet>
      </View>
    </PrototypeScreenTransition>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: 'transparent'
  },
  sheetWrap: {
    position: 'absolute',
    left: 10,
    right: 10
  },
  settingsCard: {
    paddingHorizontal: 12,
    paddingTop: 10,
    paddingBottom: 12
  },
  title: {
    color: color.text.primary,
    fontFamily: fonts.SemiBold,
    fontSize: typography.subtitle.size,
    lineHeight: typography.subtitle.lineHeight,
    marginBottom: 4
  },
  optionRow: {
    minHeight: 52,
    borderRadius: 14,
    marginTop: 8,
    paddingHorizontal: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: color.surface.secondary,
    borderWidth: 1,
    borderColor: color.border.subtle
  },
  optionLabelWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8
  },
  optionText: {
    color: color.text.primary,
    fontFamily: fonts.Medium,
    fontSize: typography.body.size,
    lineHeight: typography.body.lineHeight
  },
  footnote: {
    marginTop: 10,
    color: color.text.secondary,
    fontFamily: fonts.Regular,
    fontSize: typography.micro.size,
    lineHeight: typography.micro.lineHeight
  },
  driverShortcut: {
    marginTop: 10,
    minHeight: 48,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: color.border.subtle,
    backgroundColor: color.surface.secondary,
    paddingHorizontal: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8
  },
  driverShortcutText: {
    color: color.text.primary,
    fontFamily: fonts.Medium,
    fontSize: typography.caption.size,
    lineHeight: typography.caption.lineHeight
  },
  supportButton: {
    marginTop: 10
  }
});
