import React, { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, StatusBar, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { fonts } from '../../common-local/font';
import PrototypeScreenTransition from '../../components/prototype/PrototypeScreenTransition';
import PrototypeDismissibleSheet from '../../components/prototype/PrototypeDismissibleSheet';
import { CardHandle, PrototypeCard, PrototypePrimaryButton } from '../../components/prototype/PrototypeUI';
import robotaxiPrototypeTokens from '../../components/design-system/robotaxiPrototypeTokens';
import { usePrototypeMapOcclusion } from './prototypeMapOcclusion';
import { usePrototypeRideRuntime } from './prototypeRideRuntime';

const { color, typography } = robotaxiPrototypeTokens;
const SHEET_BOTTOM_OFFSET = 96;
const FALLBACK_CARD_HEIGHT = 346;

const SUPPORT_OPTIONS = [
  { id: 's1', title: 'Alterar ponto de embarque', subtitle: 'Atualize origem sem cancelar corrida', icon: 'pin-outline' },
  { id: 's2', title: 'Problema com pagamento', subtitle: 'Revisao de cobranca e recibo', icon: 'card-outline' },
  { id: 's3', title: 'Objetos perdidos', subtitle: 'Abrir chamado rapido', icon: 'briefcase-outline' }
];

export default function RobotaxiSupportScreen({ navigation, route }) {
  const { openSupportTicket, reportIncident, supportLoading, supportError, supportLastTicket, supportLastIncident } =
    usePrototypeRideRuntime();
  const insets = useSafeAreaInsets();
  const [cardHeight, setCardHeight] = useState(FALLBACK_CARD_HEIGHT);
  const [selectedOptionId, setSelectedOptionId] = useState(SUPPORT_OPTIONS[0].id);
  const sheetBottom = insets.bottom + SHEET_BOTTOM_OFFSET;
  const selectedOption = useMemo(() => {
    return SUPPORT_OPTIONS.find(item => item.id === selectedOptionId) || SUPPORT_OPTIONS[0];
  }, [selectedOptionId]);

  usePrototypeMapOcclusion({
    routeKey: route?.key,
    layerId: route?.key || 'prototype-support',
    occludedBottom: sheetBottom + cardHeight
  });

  const handleDismiss = () => {
    if (navigation.canGoBack()) {
      navigation.goBack();
      return;
    }
    navigation.navigate('RobotaxiPrototype');
  };

  const handleCardLayout = useCallback(event => {
    const nextHeight = event?.nativeEvent?.layout?.height;
    if (Number.isFinite(nextHeight) && nextHeight > 0) {
      setCardHeight(nextHeight);
    }
  }, []);

  const handleCreateTicket = useCallback(async () => {
    try {
      const description = `${selectedOption.title}: ${selectedOption.subtitle}`;
      await openSupportTicket({
        type: selectedOption.id,
        priority: 'N3',
        description
      });
      Alert.alert('Ticket criado', 'Sua solicitação foi enviada para o suporte.');
    } catch (error) {
      Alert.alert('Não foi possível abrir ticket', error?.message || 'Tente novamente em instantes.');
    }
  }, [openSupportTicket, selectedOption.id, selectedOption.subtitle, selectedOption.title]);

  const handleReportIncident = useCallback(async () => {
    try {
      await reportIncident({
        type: selectedOption.id,
        description: selectedOption.title
      });
      Alert.alert('Incidente registrado', 'Recebemos sua sinalização de segurança.');
    } catch (error) {
      Alert.alert('Não foi possível registrar', error?.message || 'Tente novamente em instantes.');
    }
  }, [reportIncident, selectedOption.id, selectedOption.title]);

  return (
    <PrototypeScreenTransition>
      <View style={styles.container} pointerEvents="box-none">
        <StatusBar translucent backgroundColor="transparent" barStyle="dark-content" />

        <PrototypeDismissibleSheet onClose={handleDismiss} sheetStyle={[styles.sheetWrap, { bottom: sheetBottom }]}>
          <PrototypeCard onLayout={handleCardLayout} style={styles.supportCard}>
            <CardHandle />
            <Text style={styles.title}>Suporte</Text>
            <Text style={styles.subtitle}>Escolha como deseja ajuda nesta corrida</Text>

            <View style={styles.optionList}>
              {SUPPORT_OPTIONS.map(item => {
                const isActive = item.id === selectedOptionId;
                return (
                  <TouchableOpacity
                    key={item.id}
                    activeOpacity={0.88}
                    style={[styles.optionRow, isActive && styles.optionRowActive]}
                    onPress={() => setSelectedOptionId(item.id)}
                  >
                    <View style={styles.optionIconWrap}>
                      <Ionicons name={item.icon} size={16} color={color.text.primary} />
                    </View>
                    <View style={styles.optionTextWrap}>
                      <Text style={styles.optionTitle}>{item.title}</Text>
                      <Text style={styles.optionSubtitle}>{item.subtitle}</Text>
                    </View>
                    <Ionicons name="chevron-forward" size={16} color={color.text.secondary} />
                  </TouchableOpacity>
                );
              })}
            </View>

            <View style={styles.actionsRow}>
              <TouchableOpacity
                style={styles.secondaryButton}
                activeOpacity={0.86}
                onPress={() => navigation.navigate('RobotaxiPrototypeChat')}
              >
                <Ionicons name="chatbubble-ellipses-outline" size={15} color={color.text.primary} />
                <Text style={styles.secondaryButtonText}>Falar no chat</Text>
              </TouchableOpacity>

              <PrototypePrimaryButton
                label={supportLoading ? 'Enviando...' : 'Registrar incidente'}
                icon="alert-circle-outline"
                onPress={supportLoading ? undefined : handleReportIncident}
                style={styles.primaryInlineButton}
              />
            </View>

            <PrototypePrimaryButton
              label={supportLoading ? 'Enviando...' : 'Abrir ticket'}
              icon="document-text-outline"
              onPress={supportLoading ? undefined : handleCreateTicket}
              style={styles.primaryFullButton}
            />

            <TouchableOpacity
              style={styles.complainButton}
              activeOpacity={0.86}
              onPress={() => navigation.navigate('RobotaxiPrototypeComplain')}
            >
              <Ionicons name="warning-outline" size={15} color={color.text.primary} />
              <Text style={styles.complainButtonText}>Abrir reclamacao</Text>
            </TouchableOpacity>

            {supportLoading ? (
              <View style={styles.loadingWrap}>
                <ActivityIndicator size="small" color={color.accent.primary} />
                <Text style={styles.feedbackText}>Sincronizando com suporte...</Text>
              </View>
            ) : null}

            {supportLastTicket?.id ? (
              <Text style={styles.feedbackText}>Ticket recente: #{supportLastTicket.id}</Text>
            ) : null}
            {supportLastIncident?.id ? (
              <Text style={styles.feedbackText}>Incidente recente: #{supportLastIncident.id}</Text>
            ) : null}
            {supportError ? <Text style={styles.errorText}>{supportError}</Text> : null}
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
  supportCard: {
    paddingHorizontal: 12,
    paddingTop: 10,
    paddingBottom: 12
  },
  title: {
    color: color.text.primary,
    fontFamily: fonts.SemiBold,
    fontSize: typography.subtitle.size,
    lineHeight: typography.subtitle.lineHeight
  },
  subtitle: {
    marginTop: 1,
    color: color.text.secondary,
    fontFamily: fonts.Regular,
    fontSize: typography.caption.size,
    lineHeight: typography.caption.lineHeight
  },
  optionList: {
    marginTop: 10,
    gap: 8
  },
  optionRow: {
    minHeight: 58,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: color.border.subtle,
    backgroundColor: color.surface.secondary,
    paddingHorizontal: 10,
    flexDirection: 'row',
    alignItems: 'center'
  },
  optionRowActive: {
    borderColor: 'rgba(26,51,14,0.34)',
    backgroundColor: color.surface.activeSoft
  },
  optionIconWrap: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(26,51,14,0.12)'
  },
  optionTextWrap: {
    flex: 1,
    marginLeft: 10,
    marginRight: 8
  },
  optionTitle: {
    color: color.text.primary,
    fontFamily: fonts.SemiBold,
    fontSize: typography.body.size,
    lineHeight: typography.body.lineHeight
  },
  optionSubtitle: {
    marginTop: 1,
    color: color.text.secondary,
    fontFamily: fonts.Regular,
    fontSize: typography.micro.size,
    lineHeight: typography.micro.lineHeight
  },
  actionsRow: {
    marginTop: 10,
    flexDirection: 'row',
    gap: 8
  },
  secondaryButton: {
    flex: 1,
    minHeight: 48,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: color.border.strong,
    backgroundColor: color.surface.secondary,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingHorizontal: 10
  },
  secondaryButtonText: {
    color: color.text.primary,
    fontFamily: fonts.Medium,
    fontSize: typography.caption.size,
    lineHeight: typography.caption.lineHeight
  },
  primaryInlineButton: {
    flex: 1,
    minHeight: 48,
    marginTop: 0
  },
  primaryFullButton: {
    marginTop: 8
  },
  complainButton: {
    marginTop: 8,
    minHeight: 44,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: color.border.strong,
    backgroundColor: color.surface.secondary,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6
  },
  complainButtonText: {
    color: color.text.primary,
    fontFamily: fonts.Medium,
    fontSize: typography.caption.size,
    lineHeight: typography.caption.lineHeight
  },
  loadingWrap: {
    marginTop: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8
  },
  feedbackText: {
    marginTop: 6,
    color: color.text.secondary,
    fontFamily: fonts.Regular,
    fontSize: typography.micro.size,
    lineHeight: typography.micro.lineHeight
  },
  errorText: {
    marginTop: 6,
    color: '#8A1F2B',
    fontFamily: fonts.Medium,
    fontSize: typography.caption.size,
    lineHeight: typography.caption.lineHeight
  }
});
