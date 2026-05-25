import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, ScrollView, StatusBar, StyleSheet, Switch, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useSelector } from 'react-redux';
import { Ionicons } from '@expo/vector-icons';
import { fonts } from '../../theme/runtimeTokens';
import robotaxiPrototypeTokens from '../../components/design-system/robotaxiPrototypeTokens';
import PrototypeScreenTransition from '../../components/prototype/PrototypeScreenTransition';
import PrototypeDismissibleSheet from '../../components/prototype/PrototypeDismissibleSheet';
import { CardHandle, PrototypeCard, PrototypePrimaryButton } from '../../components/prototype/PrototypeUI';
import { leafButtonMetrics } from '../../components/prototype/LeafRideUI';
import { getMenuItemByRoute } from './robotaxiMenuConfig';
import { usePrototypeMapOcclusion } from './prototypeMapOcclusion';
import { usePrototypeRideRuntime } from './prototypeRideRuntime';
import {
  resolvePrototypeProfileEmail,
  resolvePrototypeProfileName,
  resolvePrototypeProfilePhone,
} from './prototypeProfileIdentity';

const { color, typography } = robotaxiPrototypeTokens;
const SHEET_TOP_OFFSET = 56;
const SHEET_BOTTOM_OFFSET = 24;
const FALLBACK_CARD_HEIGHT = 420;
const SWITCH_TRACK_COLORS = { false: '#D9DFE6', true: '#9BB38E' };
const SWITCH_THUMB_COLOR = '#FFFFFF';

export default function RobotaxiMenuDetailScreen({ navigation, route }) {
  const authProfile = useSelector(state => state?.auth?.profile);
  const insets = useSafeAreaInsets();
  const {
    riderProfile,
    activeRole,
    updateRiderProfile,
    tripHistory,
    chatSending,
    chatError,
    supportLoading,
    supportError,
    supportLastTicket,
    supportLastIncident,
    loadChatSession,
    sendChatMessage,
    openSupportTicket,
    reportIncident,
    notificationsEnabled,
    trafficLayerEnabled,
    voiceGuidanceEnabled,
    updateSettings
  } = usePrototypeRideRuntime();

  const [cardHeight, setCardHeight] = useState(FALLBACK_CARD_HEIGHT);
  const [draftName, setDraftName] = useState('');
  const [draftPhone, setDraftPhone] = useState('');
  const [draftEmail, setDraftEmail] = useState('');
  const [draftPreference, setDraftPreference] = useState('');
  const [quickMessage, setQuickMessage] = useState('');
  const [helpDescription, setHelpDescription] = useState('');
  const [formBusy, setFormBusy] = useState('');
  const [feedback, setFeedback] = useState('');

  const targetRoute = route?.name;
  const item = getMenuItemByRoute(targetRoute, activeRole);
  const title = item?.title || 'Detalhes';
  const subtitle = item?.subtitle || 'Informações da seção';
  const sections = item?.sections || [];
  const sheetTop = insets.top + SHEET_TOP_OFFSET;
  const sheetBottom = insets.bottom + SHEET_BOTTOM_OFFSET;

  const isProfileDetail = item?.key === 'edit-profile';
  const isHistoryDetail = item?.key === 'trip-history' || item?.key === 'driver-history';
  const isMessagesDetail = item?.key === 'messages';
  const isSettingsDetail = item?.key === 'settings';
  const isHelpDetail = item?.key === 'help';

  usePrototypeMapOcclusion({
    routeKey: route?.key,
    layerId: route?.key || 'prototype-menu-detail',
    occludedBottom: sheetBottom + cardHeight
  });

  const compactTripHistory = useMemo(() => {
    if (Array.isArray(tripHistory) && tripHistory.length > 0) {
      return tripHistory.slice(0, 3);
    }
    return [];
  }, [tripHistory]);

  useEffect(() => {
    setDraftName(resolvePrototypeProfileName(authProfile) || resolvePrototypeProfileName(riderProfile));
    setDraftPhone(resolvePrototypeProfilePhone(authProfile) || resolvePrototypeProfilePhone(riderProfile));
    setDraftEmail(resolvePrototypeProfileEmail(authProfile) || resolvePrototypeProfileEmail(riderProfile));
    setDraftPreference(riderProfile?.preference || '');
  }, [authProfile, riderProfile]);

  useEffect(() => {
    if (isMessagesDetail) {
      loadChatSession().catch(() => {});
    }
  }, [isMessagesDetail, loadChatSession]);

  const handleDismiss = useCallback(() => {
    if (navigation.canGoBack()) {
      navigation.goBack();
      return;
    }
    navigation.navigate('RobotaxiPrototypeMenu');
  }, [navigation]);

  const handleCardLayout = useCallback(event => {
    const nextHeight = event?.nativeEvent?.layout?.height;
    if (Number.isFinite(nextHeight) && nextHeight > 0) {
      setCardHeight(nextHeight);
    }
  }, []);

  const handleOpenFullModule = useCallback(() => {
    if (!item?.route) {
      return;
    }
    if (item.key === 'driver-earnings') {
      navigation.navigate(item.route, {
        source: 'driver-menu-detail',
        defaultRangeDays: 1,
        maxRangeDays: 30
      });
      return;
    }
    navigation.navigate(item.route);
  }, [item, navigation]);

  const handleSaveProfile = useCallback(() => {
    updateRiderProfile({
      name: draftName,
      phone: draftPhone,
      email: draftEmail,
      preference: draftPreference
    });
    setFeedback('Dados de perfil salvos com sucesso.');
  }, [draftEmail, draftName, draftPhone, draftPreference, updateRiderProfile]);

  const handleSendQuickMessage = useCallback(async () => {
    const message = String(quickMessage || '').trim();
    if (!message) {
      setFeedback('Digite uma mensagem para enviar.');
      return;
    }

    try {
      setFormBusy('message');
      await sendChatMessage(message);
      setQuickMessage('');
      setFeedback('Mensagem enviada com sucesso.');
    } catch (error) {
      Alert.alert('Não foi possível enviar', error?.message || 'Falha ao enviar mensagem.');
    } finally {
      setFormBusy('');
    }
  }, [quickMessage, sendChatMessage]);

  const handleOpenTicket = useCallback(async () => {
    const description = String(helpDescription || '').trim();
    if (!description) {
      setFeedback('Descreva o que aconteceu antes de abrir ticket.');
      return;
    }

    try {
      setFormBusy('ticket');
      await openSupportTicket({
        type: 'menu-help',
        priority: 'N3',
        description
      });
      setFeedback('Ticket enviado para o suporte.');
    } catch (error) {
      Alert.alert('Não foi possível abrir ticket', error?.message || 'Falha de comunicação.');
    } finally {
      setFormBusy('');
    }
  }, [helpDescription, openSupportTicket]);

  const handleReportIncident = useCallback(async () => {
    const description = String(helpDescription || '').trim();
    if (!description) {
      setFeedback('Descreva o incidente antes de continuar.');
      return;
    }

    try {
      setFormBusy('incident');
      await reportIncident({
        type: 'menu-help',
        description
      });
      setFeedback('Incidente registrado com sucesso.');
    } catch (error) {
      Alert.alert('Não foi possível registrar', error?.message || 'Falha de comunicação.');
    } finally {
      setFormBusy('');
    }
  }, [helpDescription, reportIncident]);

  const renderBody = () => {
    if (isProfileDetail) {
      const profileRows = [
        { key: 'name', label: 'Nome', value: draftName, setter: setDraftName, keyboardType: 'default' },
        { key: 'phone', label: 'Telefone', value: draftPhone, setter: setDraftPhone, keyboardType: 'phone-pad' },
        { key: 'email', label: 'Email', value: draftEmail, setter: setDraftEmail, keyboardType: 'email-address' },
        { key: 'preference', label: 'Preferência', value: draftPreference, setter: setDraftPreference, keyboardType: 'default' }
      ];

      return (
        <View style={styles.formBlock}>
          {profileRows.map((field, index) => (
            <View key={field.key} style={[styles.formFieldRow, index === profileRows.length - 1 && styles.formFieldRowLast]}>
              <Text style={styles.formLabel}>{field.label}</Text>
              <TextInput
                value={field.value}
                onChangeText={field.setter}
                style={styles.formInput}
                placeholder={field.label}
                placeholderTextColor={color.text.muted}
                autoCapitalize={field.key === 'email' ? 'none' : 'words'}
                keyboardType={field.keyboardType}
              />
            </View>
          ))}

          <PrototypePrimaryButton label="Salvar perfil" icon="checkmark-outline" onPress={handleSaveProfile} style={styles.inlinePrimaryButton} />
          <TouchableOpacity style={styles.inlineGhostButton} activeOpacity={0.86} onPress={handleOpenFullModule}>
            <Ionicons name="person-outline" size={15} color={color.text.primary} />
            <Text style={styles.inlineGhostButtonText}>Abrir perfil completo</Text>
          </TouchableOpacity>
        </View>
      );
    }

    if (isHistoryDetail) {
      return (
        <View style={styles.formBlock}>
          {compactTripHistory.length > 0 ? (
            compactTripHistory.map((historyItem, index) => (
              <View key={historyItem.id || `history-${index}`} style={[styles.detailRow, index === compactTripHistory.length - 1 && styles.detailRowLast]}>
                <View style={styles.detailRowIcon}>
                  <Ionicons name="ellipse" size={8} color={color.accent.strong} />
                </View>
                <View style={styles.detailRowText}>
                  <Text style={styles.detailRowLabel}>{historyItem.date || 'Registro'}</Text>
                  <Text style={styles.detailRowValue}>{historyItem.route || 'Trajeto indisponível'}</Text>
                </View>
                <Text style={styles.detailBadge}>{historyItem.value || '--'}</Text>
              </View>
            ))
          ) : (
            <View style={styles.emptyWrap}>
              <Text style={styles.metaText}>Ainda não há corridas concluídas para esta conta.</Text>
            </View>
          )}

          <PrototypePrimaryButton label="Abrir recibos completos" icon="document-text-outline" onPress={handleOpenFullModule} style={styles.inlinePrimaryButton} />
        </View>
      );
    }

    if (isMessagesDetail) {
      return (
        <View style={styles.formBlock}>
          <View style={[styles.formFieldRow, styles.formFieldRowLast]}>
            <Text style={styles.formLabel}>Mensagem rápida</Text>
            <TextInput
              value={quickMessage}
              onChangeText={setQuickMessage}
              style={styles.formInput}
              placeholder="Ex: Estou no portão principal"
              placeholderTextColor={color.text.muted}
            />
          </View>

          <View style={styles.dualActionRow}>
            <TouchableOpacity
              style={styles.halfGhostButton}
              activeOpacity={0.86}
              onPress={formBusy === 'message' || chatSending ? undefined : handleSendQuickMessage}
            >
              <Ionicons name="send-outline" size={15} color={color.text.primary} />
              <Text style={styles.inlineGhostButtonText}>{formBusy === 'message' || chatSending ? 'Enviando...' : 'Enviar'}</Text>
            </TouchableOpacity>

            <PrototypePrimaryButton label="Abrir chat" icon="chatbubble-ellipses-outline" onPress={handleOpenFullModule} style={styles.halfPrimaryButton} />
          </View>

          {chatError ? <Text style={styles.errorText}>{chatError}</Text> : null}
        </View>
      );
    }

    if (isSettingsDetail) {
      return (
        <View style={styles.formBlock}>
          <View style={styles.preferenceRow}>
            <View style={styles.preferenceLeft}>
              <View style={styles.preferenceIconWrap}>
                <Ionicons name="notifications-outline" size={15} color={color.text.primary} />
              </View>
              <View style={styles.preferenceTextWrap}>
                <Text style={styles.preferenceTitle}>Alertas de corrida</Text>
                <Text style={styles.preferenceSubtitle}>Acompanhe cada atualização da viagem.</Text>
              </View>
            </View>
            <View style={styles.toggleSlot}>
              <Switch
                value={notificationsEnabled}
                onValueChange={value => updateSettings({ notificationsEnabled: value })}
                trackColor={SWITCH_TRACK_COLORS}
                thumbColor={SWITCH_THUMB_COLOR}
                ios_backgroundColor={SWITCH_TRACK_COLORS.false}
                style={styles.toggleSwitch}
              />
            </View>
          </View>

          <View style={styles.preferenceRow}>
            <View style={styles.preferenceLeft}>
              <View style={styles.preferenceIconWrap}>
                <Ionicons name="map-outline" size={15} color={color.text.primary} />
              </View>
              <View style={styles.preferenceTextWrap}>
                <Text style={styles.preferenceTitle}>Camada de trânsito</Text>
                <Text style={styles.preferenceSubtitle}>Visualize fluxo viário direto no mapa.</Text>
              </View>
            </View>
            <View style={styles.toggleSlot}>
              <Switch
                value={trafficLayerEnabled}
                onValueChange={value => updateSettings({ trafficLayerEnabled: value })}
                trackColor={SWITCH_TRACK_COLORS}
                thumbColor={SWITCH_THUMB_COLOR}
                ios_backgroundColor={SWITCH_TRACK_COLORS.false}
                style={styles.toggleSwitch}
              />
            </View>
          </View>

          <View style={styles.preferenceRow}>
            <View style={styles.preferenceLeft}>
              <View style={styles.preferenceIconWrap}>
                <Ionicons name="volume-high-outline" size={15} color={color.text.primary} />
              </View>
              <View style={styles.preferenceTextWrap}>
                <Text style={styles.preferenceTitle}>Instruções por voz</Text>
                <Text style={styles.preferenceSubtitle}>Receba orientações por áudio durante o trajeto.</Text>
              </View>
            </View>
            <View style={styles.toggleSlot}>
              <Switch
                value={voiceGuidanceEnabled}
                onValueChange={value => updateSettings({ voiceGuidanceEnabled: value })}
                trackColor={SWITCH_TRACK_COLORS}
                thumbColor={SWITCH_THUMB_COLOR}
                ios_backgroundColor={SWITCH_TRACK_COLORS.false}
                style={styles.toggleSwitch}
              />
            </View>
          </View>

          <PrototypePrimaryButton label="Abrir configurações completas" icon="settings-outline" onPress={handleOpenFullModule} style={styles.inlinePrimaryButton} />
        </View>
      );
    }

    if (isHelpDetail) {
      return (
        <View style={styles.formBlock}>
          <View style={[styles.formFieldRow, styles.formFieldRowLast]}>
            <Text style={styles.formLabel}>Descrição</Text>
            <TextInput
              value={helpDescription}
              onChangeText={setHelpDescription}
              style={[styles.formInput, styles.multilineInput]}
              placeholder="Conte o que aconteceu"
              placeholderTextColor={color.text.muted}
              multiline
              textAlignVertical="top"
            />
          </View>

          <View style={styles.dualActionRow}>
            <TouchableOpacity style={styles.halfGhostButton} activeOpacity={0.86} onPress={supportLoading ? undefined : handleOpenTicket}>
              <Ionicons name="document-text-outline" size={15} color={color.text.primary} />
              <Text style={styles.inlineGhostButtonText}>{formBusy === 'ticket' ? 'Enviando...' : 'Ticket'}</Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.halfGhostButton} activeOpacity={0.86} onPress={supportLoading ? undefined : handleReportIncident}>
              <Ionicons name="alert-circle-outline" size={15} color={color.text.primary} />
              <Text style={styles.inlineGhostButtonText}>{formBusy === 'incident' ? 'Enviando...' : 'Incidente'}</Text>
            </TouchableOpacity>
          </View>

          <PrototypePrimaryButton label="Abrir central de suporte" icon="help-circle-outline" onPress={handleOpenFullModule} style={styles.inlinePrimaryButton} />

          {supportLastTicket?.id ? <Text style={styles.metaText}>Ticket recente: #{supportLastTicket.id}</Text> : null}
          {supportLastIncident?.id ? <Text style={styles.metaText}>Incidente recente: #{supportLastIncident.id}</Text> : null}
          {supportError ? <Text style={styles.errorText}>{supportError}</Text> : null}
        </View>
      );
    }

    if (sections.length > 0) {
      return (
        <View style={styles.listWrap}>
          {sections.map((section, index) => (
            <View key={`${section.label}-${index}`} style={[styles.rowItem, index === sections.length - 1 && styles.rowItemLast]}>
              <View style={styles.rowIconWrap}>
                <Ionicons name="ellipse" size={8} color={color.accent.strong} />
              </View>
              <View style={styles.rowTextWrap}>
                <Text style={styles.rowLabel}>{section.label}</Text>
                <Text style={styles.rowValue}>{section.value}</Text>
              </View>
            </View>
          ))}
        </View>
      );
    }

    return (
      <View style={styles.emptyWrap}>
        <Text style={styles.metaText}>Essa seção usa uma tela dedicada do produto.</Text>
      </View>
    );
  };

  return (
    <PrototypeScreenTransition>
      <View style={styles.container} pointerEvents="box-none">
        <StatusBar translucent backgroundColor="transparent" barStyle="dark-content" />
        <PrototypeDismissibleSheet
          onClose={handleDismiss}
          backdropColor="rgba(244,247,250,0.9)"
          sheetStyle={[styles.sheetWrap, { top: sheetTop, bottom: sheetBottom }]}
        >
          <PrototypeCard onLayout={handleCardLayout} style={styles.detailCard}>
            <CardHandle />
            <View style={styles.heroHeader}>
              <View style={styles.heroHeaderTopRow}>
                <View style={styles.heroHeaderTextWrap}>
                  <Text style={styles.title}>{title}</Text>
                  <Text style={styles.subtitle}>{subtitle}</Text>
                  <View style={styles.summaryPill}>
                    <Ionicons name={isProfileDetail ? 'person-outline' : isSettingsDetail ? 'settings-outline' : 'layers-outline'} size={14} color={color.accent.strong} />
                    <Text style={styles.summaryPillText}>
                      {isProfileDetail
                        ? 'Conta e preferências'
                        : isHistoryDetail
                          ? 'Últimos registros'
                          : isMessagesDetail
                            ? 'Canal rápido'
                            : isSettingsDetail
                              ? 'Ajustes do app'
                              : isHelpDetail
                                ? 'Suporte e segurança'
                                : 'Resumo da seção'}
                    </Text>
                  </View>
                </View>
                <TouchableOpacity style={styles.headerBackButton} activeOpacity={0.86} onPress={handleDismiss}>
                  <Ionicons name="arrow-back" size={18} color={color.text.primary} />
                </TouchableOpacity>
              </View>
            </View>

            <ScrollView
              style={styles.scroll}
              contentContainerStyle={styles.scrollContent}
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
            >
              {renderBody()}
              {feedback ? <Text style={styles.feedbackText}>{feedback}</Text> : null}
            </ScrollView>
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
  detailCard: {
    flex: 1,
    zIndex: 22,
    backgroundColor: color.bg.panelSoft,
    borderColor: color.border.strong,
    shadowColor: '#0F1723',
    shadowOffset: { width: 0, height: 14 },
    shadowOpacity: 0.14,
    shadowRadius: 24,
    elevation: 11,
    paddingHorizontal: 12,
    paddingTop: 10,
    paddingBottom: 12
  },
  heroHeader: {
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(18,26,38,0.08)',
    backgroundColor: 'rgba(255,255,255,0.74)',
    paddingHorizontal: 12,
    paddingVertical: 12
  },
  heroHeaderTopRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10
  },
  heroHeaderTextWrap: {
    flex: 1
  },
  headerBackButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: color.surface.tertiary
  },
  summaryPill: {
    marginTop: 10,
    minHeight: 30,
    borderRadius: 999,
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(232,240,226,0.86)',
    borderWidth: 1,
    borderColor: 'rgba(42,77,29,0.14)',
    paddingHorizontal: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6
  },
  summaryPillText: {
    color: color.accent.strong,
    fontFamily: fonts.Medium,
    fontSize: typography.micro.size,
    lineHeight: typography.micro.lineHeight
  },
  title: {
    color: color.text.dark,
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
  scroll: {
    marginTop: 10,
    flex: 1
  },
  scrollContent: {
    paddingBottom: 8
  },
  formBlock: {
    gap: 10
  },
  formFieldRow: {
    minHeight: 74,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(18,26,38,0.08)',
    backgroundColor: 'rgba(255,255,255,0.8)'
  },
  formFieldRowLast: {
    borderBottomWidth: 0
  },
  formLabel: {
    color: color.text.secondary,
    fontFamily: fonts.Medium,
    fontSize: typography.micro.size,
    lineHeight: typography.micro.lineHeight
  },
  formInput: {
    marginTop: 4,
    minHeight: 36,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: color.border.subtle,
    backgroundColor: color.surface.secondary,
    paddingHorizontal: 10,
    color: color.text.primary,
    fontFamily: fonts.Medium,
    fontSize: typography.caption.size,
    lineHeight: typography.caption.lineHeight
  },
  multilineInput: {
    minHeight: 74,
    paddingTop: 10,
    paddingBottom: 8
  },
  inlinePrimaryButton: {
    marginTop: 2
  },
  inlineGhostButton: {
    minHeight: leafButtonMetrics.height,
    borderRadius: leafButtonMetrics.radius,
    borderWidth: 1,
    borderColor: color.border.strong,
    backgroundColor: color.surface.secondary,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: leafButtonMetrics.iconGap
  },
  inlineGhostButtonText: {
    color: color.text.primary,
    fontFamily: fonts.Medium,
    fontSize: typography.caption.size,
    lineHeight: typography.caption.lineHeight
  },
  dualActionRow: {
    flexDirection: 'row',
    gap: 8
  },
  halfGhostButton: {
    flex: 1,
    minHeight: leafButtonMetrics.height,
    borderRadius: leafButtonMetrics.radius,
    borderWidth: 1,
    borderColor: color.border.strong,
    backgroundColor: color.surface.secondary,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: leafButtonMetrics.iconGap
  },
  halfPrimaryButton: {
    flex: 1,
    marginTop: 0,
    minHeight: leafButtonMetrics.height
  },
  preferenceRow: {
    minHeight: 68,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: color.border.subtle,
    backgroundColor: 'rgba(255,255,255,0.8)',
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between'
  },
  preferenceLeft: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center'
  },
  preferenceIconWrap: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: color.surface.tertiary
  },
  preferenceTextWrap: {
    flex: 1,
    marginLeft: 8,
    marginRight: 8
  },
  preferenceTitle: {
    color: color.text.primary,
    fontFamily: fonts.Medium,
    fontSize: typography.caption.size,
    lineHeight: typography.caption.lineHeight
  },
  preferenceSubtitle: {
    marginTop: 1,
    color: color.text.secondary,
    fontFamily: fonts.Regular,
    fontSize: typography.micro.size,
    lineHeight: typography.micro.lineHeight
  },
  toggleSlot: {
    width: 54,
    alignItems: 'center',
    justifyContent: 'center'
  },
  toggleSwitch: {
    transform: [{ scaleX: 0.82 }, { scaleY: 0.82 }]
  },
  listWrap: {
    gap: 10
  },
  rowItem: {
    minHeight: 64,
    paddingHorizontal: 12,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(18,26,38,0.08)',
    backgroundColor: 'rgba(255,255,255,0.8)'
  },
  rowItemLast: {
    borderBottomWidth: 0
  },
  rowIconWrap: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: color.surface.tertiary
  },
  rowTextWrap: {
    flex: 1,
    marginLeft: 10
  },
  rowLabel: {
    color: color.text.secondary,
    fontFamily: fonts.Medium,
    fontSize: typography.micro.size,
    lineHeight: typography.micro.lineHeight
  },
  rowValue: {
    marginTop: 1,
    color: color.text.dark,
    fontFamily: fonts.Medium,
    fontSize: typography.caption.size,
    lineHeight: typography.caption.lineHeight
  },
  detailRow: {
    minHeight: 60,
    paddingHorizontal: 12,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(18,26,38,0.08)',
    backgroundColor: 'rgba(255,255,255,0.8)',
    marginBottom: 8
  },
  detailRowLast: {
    marginBottom: 0
  },
  detailRowIcon: {
    width: 28,
    alignItems: 'center',
    justifyContent: 'center'
  },
  detailRowText: {
    flex: 1,
    marginLeft: 8
  },
  detailRowLabel: {
    color: color.text.secondary,
    fontFamily: fonts.Medium,
    fontSize: typography.micro.size,
    lineHeight: typography.micro.lineHeight
  },
  detailRowValue: {
    marginTop: 1,
    color: color.text.dark,
    fontFamily: fonts.Medium,
    fontSize: typography.caption.size,
    lineHeight: typography.caption.lineHeight
  },
  detailBadge: {
    color: color.text.primary,
    fontFamily: fonts.SemiBold,
    fontSize: typography.caption.size,
    lineHeight: typography.caption.lineHeight
  },
  emptyWrap: {
    minHeight: 84,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(18,26,38,0.08)',
    backgroundColor: 'rgba(255,255,255,0.8)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 14
  },
  metaText: {
    marginTop: 6,
    color: color.text.secondary,
    fontFamily: fonts.Regular,
    fontSize: typography.micro.size,
    lineHeight: typography.micro.lineHeight
  },
  feedbackText: {
    marginTop: 10,
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
