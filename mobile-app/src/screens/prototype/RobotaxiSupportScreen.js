import React, { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, StatusBar, StyleSheet, Text, TouchableOpacity, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { fonts } from '../../theme/runtimeTokens';
import PrototypeScreenTransition from '../../components/prototype/PrototypeScreenTransition';
import PrototypeDismissibleSheet from '../../components/prototype/PrototypeDismissibleSheet';
import { PrototypePrimaryButton } from '../../components/prototype/PrototypeUI';
import {
  PrototypeMenuCloseButton,
  PrototypeMenuRow,
  PrototypeMenuSection,
  PrototypeMenuSurface,
} from '../../components/prototype/PrototypeMenuSurface';
import robotaxiPrototypeTokens from '../../components/design-system/robotaxiPrototypeTokens';
import { usePrototypeMapOcclusion } from './prototypeMapOcclusion';
import { usePrototypeRideRuntime } from './prototypeRideRuntime';

const { color, typography } = robotaxiPrototypeTokens;
const SURFACE_TOP_PADDING = 16;
const SURFACE_BOTTOM_PADDING = 18;
const BACKDROP_COLOR = 'transparent';

const SUPPORT_OPTIONS = [
  { id: 's1', title: 'Alterar ponto de embarque', subtitle: 'Atualize a origem sem cancelar a corrida', icon: 'pin-outline' },
  { id: 's2', title: 'Problema com pagamento', subtitle: 'Revisao de cobranca e recibo da viagem', icon: 'card-outline' },
  { id: 's3', title: 'Objetos perdidos', subtitle: 'Abrir chamado rapido para itens esquecidos', icon: 'briefcase-outline' },
];

function SupportOptionRow({ item, active, onPress, rowTestID, last = false }) {
  return (
    <TouchableOpacity
      style={[styles.optionRow, active && styles.optionRowActive, last && styles.optionRowLast]}
      activeOpacity={0.78}
      onPress={onPress}
      testID={rowTestID}
      accessibilityLabel={rowTestID}
    >
      <View style={styles.optionIconSlot}>
        <Ionicons name={item.icon} size={18} color={active ? color.accent.strong : color.text.primary} />
      </View>
      <View style={styles.optionCopyWrap}>
        <Text style={[styles.optionTitle, active && styles.optionTitleActive]}>{item.title}</Text>
        <Text style={styles.optionSubtitle}>{item.subtitle}</Text>
      </View>
      <Ionicons name="chevron-forward" size={15} color={color.text.muted} />
    </TouchableOpacity>
  );
}

export default function RobotaxiSupportScreen({ navigation, route }) {
  const { reportIncident, supportLoading, supportError, supportLastTicket, supportLastIncident } =
    usePrototypeRideRuntime();
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();
  const [panelHeight, setPanelHeight] = useState(windowHeight);
  const [selectedOptionId, setSelectedOptionId] = useState(SUPPORT_OPTIONS[0].id);
  const selectedOption = useMemo(() => SUPPORT_OPTIONS.find(item => item.id === selectedOptionId) || SUPPORT_OPTIONS[0], [selectedOptionId]);

  usePrototypeMapOcclusion({
    routeKey: route?.key,
    layerId: route?.key || 'prototype-support',
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

  const handleCreateTicket = useCallback(() => {
    navigation.navigate('RobotaxiPrototypeSupportTicket', {
      type: selectedOption.id,
      subject: selectedOption.title,
      description: selectedOption.subtitle,
    });
  }, [navigation, selectedOption.id, selectedOption.subtitle, selectedOption.title]);

  const handleReportIncident = useCallback(async () => {
    try {
      await reportIncident({
        type: selectedOption.id,
        description: selectedOption.title,
      });
      Alert.alert('Incidente registrado', 'Recebemos sua sinalizacao de seguranca.');
    } catch (error) {
      Alert.alert('Nao foi possivel registrar', error?.message || 'Tente novamente em instantes.');
    }
  }, [reportIncident, selectedOption.id, selectedOption.title]);

  return (
    <PrototypeScreenTransition>
      <View
        style={styles.container}
        pointerEvents="box-none"
        testID="robotaxi-support-screen"
        accessibilityLabel="robotaxi-support-screen"
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
            eyebrow="Ajuda e seguranca"
            title="Suporte"
            subtitle="Escolha como deseja ajuda nesta corrida e siga para o canal certo."
            fullScreen
            style={{
              paddingTop: insets.top + SURFACE_TOP_PADDING,
              paddingBottom: Math.max(insets.bottom, SURFACE_BOTTOM_PADDING),
            }}
            bodyStyle={styles.body}
            headerAccessory={(
              <PrototypeMenuCloseButton
                onPress={handleDismiss}
                testID="robotaxi-support-close-button"
                accessibilityLabel="robotaxi-support-close-button"
              />
            )}
          >
            <ScrollView
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={styles.content}
            >
              <PrototypeMenuSection title="Assuntos">
                {SUPPORT_OPTIONS.map((item, index) => (
                  <SupportOptionRow
                    key={item.id}
                    item={item}
                    active={item.id === selectedOptionId}
                    onPress={() => setSelectedOptionId(item.id)}
                    rowTestID={`robotaxi-support-option-${item.id}`}
                    last={index === SUPPORT_OPTIONS.length - 1}
                  />
                ))}
              </PrototypeMenuSection>

              <PrototypeMenuSection title="Canais">
                <PrototypeMenuRow
                  icon="chatbubble-ellipses-outline"
                  title="Falar no chat"
                  subtitle="Abrir conversa em tempo real com motorista ou suporte."
                  onPress={() => navigation.replace('RobotaxiPrototypeChat')}
                  testID="robotaxi-support-open-chat"
                  accessibilityLabel="robotaxi-support-open-chat"
                />
                <PrototypeMenuRow
                  icon="warning-outline"
                  title="Abrir reclamacao"
                  subtitle="Registrar um relato mais completo com evidências."
                  last
                  onPress={() => navigation.replace('RobotaxiPrototypeComplain')}
                  testID="robotaxi-support-open-complain"
                  accessibilityLabel="robotaxi-support-open-complain"
                />
              </PrototypeMenuSection>

              <View style={styles.actionsBlock}>
                <PrototypePrimaryButton
                  label={supportLoading ? 'Enviando...' : 'Registrar incidente'}
                  icon="alert-circle-outline"
                  onPress={supportLoading ? undefined : handleReportIncident}
                  style={styles.primaryButton}
                  testID="robotaxi-support-report-incident"
                  accessibilityLabel="robotaxi-support-report-incident"
                />
                <PrototypePrimaryButton
                  label={supportLoading ? 'Enviando...' : 'Abrir ticket'}
                  icon="document-text-outline"
                  onPress={supportLoading ? undefined : handleCreateTicket}
                  style={styles.primaryButton}
                  testID="robotaxi-support-open-ticket"
                  accessibilityLabel="robotaxi-support-open-ticket"
                />
              </View>

              {supportLoading ? (
                <View style={styles.feedbackRow}>
                  <ActivityIndicator size="small" color={color.accent.primary} />
                  <Text style={styles.feedbackText}>Sincronizando com suporte...</Text>
                </View>
              ) : null}
              {supportLastTicket?.id ? <Text style={styles.feedbackText}>Ticket recente: #{supportLastTicket.id}</Text> : null}
              {supportLastIncident?.id ? <Text style={styles.feedbackText}>Incidente recente: #{supportLastIncident.id}</Text> : null}
              {supportError ? <Text style={styles.errorText}>{supportError}</Text> : null}
            </ScrollView>
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
  body: {
    flex: 1,
  },
  content: {
    paddingTop: 18,
    paddingBottom: 34,
    gap: 18,
  },
  optionRow: {
    minHeight: 58,
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(17,26,39,0.08)',
  },
  optionRowActive: {
    backgroundColor: 'rgba(42,77,29,0.05)',
  },
  optionRowLast: {
    borderBottomWidth: 0,
    paddingBottom: 4,
  },
  optionIconSlot: {
    width: 28,
    alignItems: 'flex-start',
  },
  optionCopyWrap: {
    flex: 1,
    paddingRight: 10,
  },
  optionTitle: {
    color: color.text.primary,
    fontFamily: fonts.SemiBold,
    fontSize: 16,
    lineHeight: 22,
  },
  optionTitleActive: {
    color: color.accent.strong,
  },
  optionSubtitle: {
    marginTop: 1,
    color: color.text.secondary,
    fontFamily: fonts.Regular,
    fontSize: typography.micro.size,
    lineHeight: typography.micro.lineHeight,
  },
  actionsBlock: {
    marginTop: 4,
    gap: 8,
  },
  primaryButton: {
    marginTop: 0,
  },
  feedbackRow: {
    marginTop: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  feedbackText: {
    marginTop: 8,
    color: color.text.secondary,
    fontFamily: fonts.Regular,
    fontSize: typography.caption.size,
    lineHeight: typography.caption.lineHeight,
  },
  errorText: {
    marginTop: 8,
    color: color.feedback.danger,
    fontFamily: fonts.Medium,
    fontSize: typography.caption.size,
    lineHeight: typography.caption.lineHeight,
  },
});
