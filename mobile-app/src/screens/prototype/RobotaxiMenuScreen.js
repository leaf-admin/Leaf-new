import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, ScrollView, StatusBar, StyleSheet, Switch, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import Animated, { Easing, FadeIn, FadeOut, SlideInLeft, SlideInRight, SlideOutLeft, SlideOutRight } from 'react-native-reanimated';
import { fonts } from '../../common-local/font';
import robotaxiPrototypeTokens from '../../components/design-system/robotaxiPrototypeTokens';
import PrototypeScreenTransition from '../../components/prototype/PrototypeScreenTransition';
import PrototypeDismissibleSheet from '../../components/prototype/PrototypeDismissibleSheet';
import { CardHandle, PrototypeCard, PrototypePrimaryButton } from '../../components/prototype/PrototypeUI';
import { ROBOTAXI_MENU_ITEMS } from './robotaxiMenuConfig';
import { usePrototypeMapOcclusion } from './prototypeMapOcclusion';
import { usePrototypeRideRuntime } from './prototypeRideRuntime';

const { color, typography, touch, motion } = robotaxiPrototypeTokens;
const FIXED_MENU_HEIGHT = 404;
const SHEET_BOTTOM_OFFSET = 96;
const slideEasing = Easing.bezier(...motion.bezier.snappy);
const fadeEasing = Easing.bezier(...motion.bezier.smoothIn);

function resolveMenuRouteByKey(item) {
  if (!item?.key) {
    return 'RobotaxiPrototype';
  }

  if (item.key === 'edit-profile') {
    return 'RobotaxiPrototypeProfile';
  }
  if (item.key === 'trip-history') {
    return 'RobotaxiPrototypeReceipt';
  }
  if (item.key === 'messages') {
    return 'RobotaxiPrototypeChat';
  }
  if (item.key === 'settings') {
    return 'RobotaxiPrototypeSettings';
  }
  if (item.key === 'help') {
    return 'RobotaxiPrototypeSupport';
  }
  if (item.key === 'driver-panel') {
    return 'RobotaxiPrototypeDriverPanel';
  }
  if (item.key === 'driver-activation') {
    return 'RobotaxiPrototypeDriverActivation';
  }

  return item.route || 'RobotaxiPrototype';
}

const FALLBACK_HISTORY = [
  { id: 'h1', date: 'Hoje 14:20', route: 'Mission St -> Castro St', value: 'R$ 22,43' },
  { id: 'h2', date: 'Ontem 09:05', route: 'Market St -> Ferry Building', value: 'R$ 14,10' },
  { id: 'h3', date: 'Dom 20:41', route: 'SoMa -> Marina District', value: 'R$ 18,35' }
];

export default function RobotaxiMenuScreen({ navigation, route }) {
  const insets = useSafeAreaInsets();
  const {
    riderProfile,
    updateRiderProfile,
    tripHistory,
    chatSending,
    chatError,
    supportLoading,
    supportError,
    supportLastTicket,
    supportLastIncident,
    notifications,
    unreadNotificationCount,
    loadChatSession,
    sendChatMessage,
    openSupportTicket,
    reportIncident,
    notificationsEnabled,
    trafficLayerEnabled,
    voiceGuidanceEnabled,
    updateSettings,
    driverOnline,
    setDriverOnline,
    paymentState,
    markNotificationRead,
    markAllNotificationsRead
  } = usePrototypeRideRuntime();
  const [activeItemKey, setActiveItemKey] = useState(null);
  const [slideDirection, setSlideDirection] = useState('none');
  const [cardHeight, setCardHeight] = useState(FIXED_MENU_HEIGHT);
  const [profileDraft, setProfileDraft] = useState({
    name: '',
    phone: '',
    email: '',
    preference: ''
  });
  const [quickMessage, setQuickMessage] = useState('');
  const [helpDescription, setHelpDescription] = useState('');
  const [formBusy, setFormBusy] = useState('');
  const [feedback, setFeedback] = useState('');

  const sheetBottom = insets.bottom + SHEET_BOTTOM_OFFSET;

  usePrototypeMapOcclusion({
    routeKey: route?.key,
    layerId: route?.key || 'prototype-menu',
    occludedBottom: sheetBottom + cardHeight
  });

  const activeItem = useMemo(() => {
    if (!activeItemKey) {
      return null;
    }
    return ROBOTAXI_MENU_ITEMS.find(item => item.key === activeItemKey) || null;
  }, [activeItemKey]);

  const isDetailLevel = Boolean(activeItem);
  const detailSections = activeItem?.sections || [];
  const compactTripHistory = useMemo(() => {
    if (Array.isArray(tripHistory) && tripHistory.length > 0) {
      return tripHistory.slice(0, 3);
    }
    return FALLBACK_HISTORY;
  }, [tripHistory]);
  const recentNotifications = useMemo(() => {
    if (!Array.isArray(notifications)) {
      return [];
    }

    return notifications.slice(0, 10);
  }, [notifications]);

  useEffect(() => {
    if (!activeItem) {
      return;
    }

    if (activeItem.key === 'edit-profile') {
      setProfileDraft({
        name: riderProfile?.name || '',
        phone: riderProfile?.phone || '',
        email: riderProfile?.email || '',
        preference: riderProfile?.preference || ''
      });
    }

    if (activeItem.key === 'messages') {
      loadChatSession().catch(() => {});
    }
  }, [activeItem, loadChatSession, riderProfile?.email, riderProfile?.name, riderProfile?.phone, riderProfile?.preference]);

  const handleDismiss = () => {
    if (navigation.canGoBack()) {
      navigation.goBack();
      return;
    }
    navigation.navigate('RobotaxiPrototype');
  };

  const handleOpenItem = item => {
    if (item?.openDirect) {
      handleNavigateToModule(item);
      return;
    }
    setSlideDirection('forward');
    setFeedback('');
    setActiveItemKey(item.key);
    if (item?.key === 'notifications') {
      markAllNotificationsRead();
    }
  };

  const handleBackLevel = () => {
    setSlideDirection('back');
    setFeedback('');
    setActiveItemKey(null);
  };

  const enteringTransition =
    slideDirection === 'forward'
      ? SlideInRight.duration(motion.timing.slow).easing(slideEasing)
      : slideDirection === 'back'
        ? SlideInLeft.duration(motion.timing.slow).easing(slideEasing)
        : FadeIn.duration(motion.timing.quick).easing(slideEasing);

  const exitingTransition =
    slideDirection === 'forward'
      ? SlideOutLeft.duration(motion.timing.standard).easing(fadeEasing)
      : slideDirection === 'back'
        ? SlideOutRight.duration(motion.timing.standard).easing(fadeEasing)
        : FadeOut.duration(motion.timing.quick).easing(fadeEasing);

  const handleCardLayout = useCallback(event => {
    const nextHeight = event?.nativeEvent?.layout?.height;
    if (Number.isFinite(nextHeight) && nextHeight > 0) {
      setCardHeight(nextHeight);
    }
  }, []);

  const handleNavigateToModule = useCallback(
    item => {
      const targetRoute = resolveMenuRouteByKey(item);
      navigation.navigate(targetRoute);
    },
    [navigation]
  );

  const handleSaveProfile = useCallback(() => {
    updateRiderProfile(profileDraft);
    setFeedback('Dados de perfil salvos no protótipo.');
  }, [profileDraft, updateRiderProfile]);

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

  const handleToggleDriverOnline = useCallback(
    value => {
      setDriverOnline(value).catch(() => {});
    },
    [setDriverOnline]
  );

  const renderDetailBody = () => {
    if (!activeItem) {
      return null;
    }

    if (activeItem.key === 'edit-profile') {
      return (
        <View style={styles.formBlock}>
          <View style={styles.formFieldRow}>
            <Text style={styles.formLabel}>Nome</Text>
            <TextInput
              value={profileDraft.name}
              onChangeText={value => setProfileDraft(previous => ({ ...previous, name: value }))}
              style={styles.formInput}
              placeholder="Nome completo"
              placeholderTextColor={color.text.muted}
            />
          </View>
          <View style={styles.formFieldRow}>
            <Text style={styles.formLabel}>Telefone</Text>
            <TextInput
              value={profileDraft.phone}
              onChangeText={value => setProfileDraft(previous => ({ ...previous, phone: value }))}
              style={styles.formInput}
              keyboardType="phone-pad"
              placeholder="+55 11 9 9999-9999"
              placeholderTextColor={color.text.muted}
            />
          </View>
          <View style={styles.formFieldRow}>
            <Text style={styles.formLabel}>Email</Text>
            <TextInput
              value={profileDraft.email}
              onChangeText={value => setProfileDraft(previous => ({ ...previous, email: value }))}
              style={styles.formInput}
              autoCapitalize="none"
              keyboardType="email-address"
              placeholder="email@exemplo.com"
              placeholderTextColor={color.text.muted}
            />
          </View>
          <View style={[styles.formFieldRow, styles.formFieldRowLast]}>
            <Text style={styles.formLabel}>Preferência</Text>
            <TextInput
              value={profileDraft.preference}
              onChangeText={value => setProfileDraft(previous => ({ ...previous, preference: value }))}
              style={styles.formInput}
              placeholder="Corridas silenciosas"
              placeholderTextColor={color.text.muted}
            />
          </View>

          <PrototypePrimaryButton label="Salvar perfil" icon="checkmark-outline" onPress={handleSaveProfile} style={styles.inlinePrimaryButton} />
          <TouchableOpacity style={styles.inlineGhostButton} activeOpacity={0.86} onPress={() => handleNavigateToModule(activeItem)}>
            <Ionicons name="person-outline" size={15} color={color.text.primary} />
            <Text style={styles.inlineGhostButtonText}>Abrir tela de perfil</Text>
          </TouchableOpacity>
        </View>
      );
    }

    if (activeItem.key === 'trip-history') {
      return (
        <View style={styles.formBlock}>
          {compactTripHistory.map((item, index) => (
            <View key={item.id || `history-${index}`} style={[styles.detailRow, index === compactTripHistory.length - 1 && styles.detailRowLast]}>
              <View style={styles.detailRowText}>
                <Text style={styles.detailRowLabel}>{item.date || 'Registro'}</Text>
                <Text style={styles.detailRowValue}>{item.route || 'Trajeto indisponível'}</Text>
              </View>
              <Text style={styles.detailBadge}>{item.value || '--'}</Text>
            </View>
          ))}

          <PrototypePrimaryButton
            label="Abrir recibos completos"
            icon="document-text-outline"
            onPress={() => handleNavigateToModule(activeItem)}
            style={styles.inlinePrimaryButton}
          />
        </View>
      );
    }

    if (activeItem.key === 'messages') {
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

            <PrototypePrimaryButton
              label="Abrir chat"
              icon="chatbubble-ellipses-outline"
              onPress={() => handleNavigateToModule(activeItem)}
              style={styles.halfPrimaryButton}
            />
          </View>

          {chatError ? <Text style={styles.errorText}>{chatError}</Text> : null}
        </View>
      );
    }

    if (activeItem.key === 'notifications') {
      return (
        <View style={styles.formBlock}>
          {recentNotifications.length > 0 ? (
            <>
              {recentNotifications.map((item, index) => {
                const isUnread = !item.read;
                const isLast = index === recentNotifications.length - 1;
                return (
                  <TouchableOpacity
                    key={item.id || `notif-${index}`}
                    activeOpacity={0.86}
                    style={[styles.notificationRow, isUnread && styles.notificationRowUnread, isLast && styles.notificationRowLast]}
                    onPress={() => markNotificationRead(item.id)}
                  >
                    <View style={styles.notificationIconWrap}>
                      <Ionicons name="notifications-outline" size={14} color={color.text.primary} />
                    </View>

                    <View style={styles.notificationTextWrap}>
                      <Text numberOfLines={1} style={styles.notificationTitle}>
                        {item.title || 'Notificação'}
                      </Text>
                      <Text numberOfLines={2} style={styles.notificationMessage}>
                        {item.message || 'Sem detalhes'}
                      </Text>
                    </View>

                    {isUnread ? <View style={styles.notificationUnreadDot} /> : null}
                  </TouchableOpacity>
                );
              })}

              <TouchableOpacity style={styles.inlineGhostButton} activeOpacity={0.86} onPress={markAllNotificationsRead}>
                <Ionicons name="checkmark-done-outline" size={15} color={color.text.primary} />
                <Text style={styles.inlineGhostButtonText}>Marcar todas como lidas</Text>
              </TouchableOpacity>
            </>
          ) : (
            <View style={styles.emptyWrap}>
              <Text style={styles.metaText}>Sem notificações no momento.</Text>
            </View>
          )}
        </View>
      );
    }

    if (activeItem.key === 'settings') {
      return (
        <View style={styles.formBlock}>
          <View style={styles.switchRow}>
            <Text style={styles.switchLabel}>Alertas de corrida</Text>
            <Switch
              value={notificationsEnabled}
              onValueChange={value => updateSettings({ notificationsEnabled: value })}
              trackColor={{ false: '#C7D0DA', true: '#2A4D1D' }}
              thumbColor={notificationsEnabled ? '#1A330E' : '#F7F9FC'}
            />
          </View>
          <View style={styles.switchRow}>
            <Text style={styles.switchLabel}>Camada de trânsito</Text>
            <Switch
              value={trafficLayerEnabled}
              onValueChange={value => updateSettings({ trafficLayerEnabled: value })}
              trackColor={{ false: '#C7D0DA', true: '#2A4D1D' }}
              thumbColor={trafficLayerEnabled ? '#1A330E' : '#F7F9FC'}
            />
          </View>
          <View style={styles.switchRow}>
            <Text style={styles.switchLabel}>Instruções por voz</Text>
            <Switch
              value={voiceGuidanceEnabled}
              onValueChange={value => updateSettings({ voiceGuidanceEnabled: value })}
              trackColor={{ false: '#C7D0DA', true: '#2A4D1D' }}
              thumbColor={voiceGuidanceEnabled ? '#1A330E' : '#F7F9FC'}
            />
          </View>

          <PrototypePrimaryButton
            label="Abrir configurações completas"
            icon="settings-outline"
            onPress={() => handleNavigateToModule(activeItem)}
            style={styles.inlinePrimaryButton}
          />
        </View>
      );
    }

    if (activeItem.key === 'help') {
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

          <PrototypePrimaryButton
            label="Abrir central de suporte"
            icon="help-circle-outline"
            onPress={() => handleNavigateToModule(activeItem)}
            style={styles.inlinePrimaryButton}
          />

          {supportLastTicket?.id ? <Text style={styles.metaText}>Ticket recente: #{supportLastTicket.id}</Text> : null}
          {supportLastIncident?.id ? <Text style={styles.metaText}>Incidente recente: #{supportLastIncident.id}</Text> : null}
          {supportError ? <Text style={styles.errorText}>{supportError}</Text> : null}
        </View>
      );
    }

    if (activeItem.key === 'driver-panel') {
      return (
        <View style={styles.formBlock}>
          <View style={styles.switchRow}>
            <Text style={styles.switchLabel}>Motorista online</Text>
            <Switch
              value={driverOnline}
              onValueChange={handleToggleDriverOnline}
              trackColor={{ false: '#C7D0DA', true: '#2A4D1D' }}
              thumbColor={driverOnline ? '#1A330E' : '#F7F9FC'}
            />
          </View>
          <View style={styles.driverMetaRow}>
            <Text style={styles.metaText}>Pagamento: {paymentState?.status || 'idle'}</Text>
            <Text style={styles.metaText}>Método: {paymentState?.method || 'pix'}</Text>
          </View>

          <PrototypePrimaryButton
            label="Abrir painel do motorista"
            icon="speedometer-outline"
            onPress={() => handleNavigateToModule(activeItem)}
            style={styles.inlinePrimaryButton}
          />
        </View>
      );
    }

    return (
      <View>
        {detailSections.length > 0 ? (
          detailSections.map((section, index) => {
            const isLast = index === detailSections.length - 1;

            return (
              <View key={`${section.label}-${index}`} style={[styles.detailRow, isLast && styles.detailRowLast]}>
                <View style={styles.detailRowIcon}>
                  <Ionicons name="ellipse" size={8} color={color.accent.strong} />
                </View>
                <View style={styles.detailRowText}>
                  <Text style={styles.detailRowLabel}>{section.label}</Text>
                  <Text style={styles.detailRowValue}>{section.value}</Text>
                </View>
              </View>
            );
          })
        ) : (
          <View style={styles.detailRow}>
            <View style={styles.detailRowIcon}>
              <Ionicons name="information-circle-outline" size={16} color={color.text.dark} />
            </View>
            <View style={styles.detailRowText}>
              <Text style={styles.detailRowValue}>Sem campos disponíveis para esta seção.</Text>
            </View>
          </View>
        )}
      </View>
    );
  };

  return (
    <PrototypeScreenTransition>
      <View style={styles.container} pointerEvents="box-none">
        <StatusBar translucent backgroundColor="transparent" barStyle="dark-content" />
        <PrototypeDismissibleSheet onClose={handleDismiss} sheetStyle={[styles.sheetWrap, { bottom: sheetBottom }]}>
          <PrototypeCard onLayout={handleCardLayout} style={[styles.menuCard, isDetailLevel && styles.menuCardDetail]}>
            <CardHandle />
            <Animated.View
              key={isDetailLevel ? `detail-${activeItem.key}` : 'main-menu'}
              entering={enteringTransition}
              exiting={exitingTransition}
              style={styles.contentViewport}
            >
              {isDetailLevel ? (
                <>
                  <View style={styles.detailHeader}>
                    <TouchableOpacity style={styles.levelBackButton} activeOpacity={0.85} onPress={handleBackLevel}>
                      <Ionicons name="arrow-back" size={18} color={color.text.dark} />
                    </TouchableOpacity>

                    <View style={styles.detailHeaderTextWrap}>
                      <Text style={styles.detailTitle}>{activeItem.title}</Text>
                      <Text style={styles.detailSubtitle}>{activeItem.subtitle}</Text>
                    </View>
                  </View>

                  <View style={styles.detailList}>
                    <ScrollView contentContainerStyle={styles.detailScrollContent} showsVerticalScrollIndicator={false}>
                      {renderDetailBody()}
                    </ScrollView>
                  </View>

                  {feedback ? <Text style={styles.feedbackText}>{feedback}</Text> : null}
                </>
              ) : (
                <>
                  <Text style={styles.title}>Menu</Text>
                  <Text style={styles.subtitle}>Acesse todas as seções do passageiro</Text>

                  <View style={styles.menuList}>
                    {ROBOTAXI_MENU_ITEMS.map(item => {
                      const isNotificationItem = item.key === 'notifications';
                      const showUnreadBadge = isNotificationItem && unreadNotificationCount > 0;
                      return (
                        <TouchableOpacity key={item.key} style={styles.menuItem} activeOpacity={0.86} onPress={() => handleOpenItem(item)}>
                          <View style={styles.iconWrap}>
                            <Ionicons name={item.icon} size={16} color={color.text.primary} />
                            {showUnreadBadge ? <View style={styles.menuBadgeDot} /> : null}
                          </View>

                          <View style={styles.textWrap}>
                            <Text style={styles.itemTitle}>{item.title}</Text>
                            <Text numberOfLines={1} style={styles.itemSubtitle}>
                              {item.subtitle}
                            </Text>
                          </View>

                          <View style={styles.trailingWrap}>
                            {showUnreadBadge ? (
                              <View style={styles.menuBadgeCount}>
                                <Text style={styles.menuBadgeCountText}>{Math.min(99, unreadNotificationCount)}</Text>
                              </View>
                            ) : null}
                            <Ionicons name="chevron-forward" size={16} color={color.text.secondary} />
                          </View>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                </>
              )}
            </Animated.View>
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
  menuCard: {
    height: FIXED_MENU_HEIGHT,
    paddingHorizontal: 12,
    paddingTop: 10,
    paddingBottom: 12,
    overflow: 'hidden'
  },
  menuCardDetail: {
    backgroundColor: color.bg.panel,
    borderColor: color.border.strong,
    shadowColor: color.shadow.base,
    shadowOffset: { width: 0, height: 14 },
    shadowOpacity: 0.2,
    shadowRadius: 24,
    elevation: 13
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
  menuList: {
    marginTop: 8,
    gap: 8,
    flex: 1
  },
  menuItem: {
    minHeight: 56,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: color.border.subtle,
    backgroundColor: color.surface.secondary,
    paddingHorizontal: 10,
    flexDirection: 'row',
    alignItems: 'center'
  },
  iconWrap: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: color.surface.tertiary,
    position: 'relative'
  },
  menuBadgeDot: {
    position: 'absolute',
    top: -2,
    right: -2,
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#D61F2D',
    borderWidth: 1,
    borderColor: '#FFFFFF'
  },
  trailingWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6
  },
  menuBadgeCount: {
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    paddingHorizontal: 5,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#D61F2D'
  },
  menuBadgeCountText: {
    color: '#FFFFFF',
    fontFamily: fonts.SemiBold,
    fontSize: 10,
    lineHeight: 12
  },
  textWrap: {
    flex: 1,
    marginLeft: 10,
    marginRight: 8
  },
  itemTitle: {
    color: color.text.primary,
    fontFamily: fonts.SemiBold,
    fontSize: typography.body.size,
    lineHeight: typography.body.lineHeight
  },
  itemSubtitle: {
    marginTop: 1,
    color: color.text.secondary,
    fontFamily: fonts.Regular,
    fontSize: typography.micro.size,
    lineHeight: typography.micro.lineHeight
  },
  detailHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start'
  },
  levelBackButton: {
    width: touch.min,
    height: touch.min,
    borderRadius: touch.min / 2,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: color.surface.primary,
    borderWidth: 1,
    borderColor: color.border.strong
  },
  detailHeaderTextWrap: {
    flex: 1,
    marginLeft: 8
  },
  detailTitle: {
    color: color.text.dark,
    fontFamily: fonts.SemiBold,
    fontSize: typography.subtitle.size,
    lineHeight: typography.subtitle.lineHeight
  },
  detailSubtitle: {
    marginTop: 1,
    color: color.text.secondary,
    fontFamily: fonts.Regular,
    fontSize: typography.caption.size,
    lineHeight: typography.caption.lineHeight
  },
  detailList: {
    marginTop: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: color.border.separator,
    flex: 1
  },
  detailScrollContent: {
    paddingBottom: 2
  },
  formBlock: {
    paddingTop: 4
  },
  notificationRow: {
    minHeight: 62,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: color.border.subtle,
    backgroundColor: color.surface.secondary,
    paddingHorizontal: 10,
    paddingVertical: 8,
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8
  },
  notificationRowUnread: {
    borderColor: color.border.strong,
    backgroundColor: color.surface.primary
  },
  notificationRowLast: {
    marginBottom: 0
  },
  notificationIconWrap: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: color.surface.tertiary
  },
  notificationTextWrap: {
    flex: 1,
    marginLeft: 8,
    marginRight: 8
  },
  notificationTitle: {
    color: color.text.dark,
    fontFamily: fonts.SemiBold,
    fontSize: typography.caption.size,
    lineHeight: typography.caption.lineHeight
  },
  notificationMessage: {
    marginTop: 1,
    color: color.text.secondary,
    fontFamily: fonts.Regular,
    fontSize: typography.micro.size,
    lineHeight: typography.micro.lineHeight
  },
  notificationUnreadDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#D61F2D'
  },
  emptyWrap: {
    minHeight: 64,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: color.border.subtle,
    backgroundColor: color.surface.secondary,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 10
  },
  formFieldRow: {
    minHeight: 58,
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: color.border.separator
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
    marginTop: 10
  },
  inlineGhostButton: {
    marginTop: 8,
    minHeight: 44,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: color.border.strong,
    backgroundColor: color.surface.secondary,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 6
  },
  inlineGhostButtonText: {
    color: color.text.primary,
    fontFamily: fonts.Medium,
    fontSize: typography.caption.size,
    lineHeight: typography.caption.lineHeight
  },
  dualActionRow: {
    marginTop: 10,
    flexDirection: 'row',
    gap: 8
  },
  halfGhostButton: {
    flex: 1,
    minHeight: 44,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: color.border.strong,
    backgroundColor: color.surface.secondary,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 6
  },
  halfPrimaryButton: {
    flex: 1,
    marginTop: 0,
    minHeight: 44
  },
  switchRow: {
    minHeight: 56,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: color.border.separator,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between'
  },
  switchLabel: {
    color: color.text.dark,
    fontFamily: fonts.Medium,
    fontSize: typography.caption.size,
    lineHeight: typography.caption.lineHeight
  },
  detailRow: {
    minHeight: 54,
    paddingHorizontal: 4,
    paddingVertical: 8,
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: color.border.separator
  },
  detailRowLast: {
    borderBottomWidth: 0
  },
  detailRowIcon: {
    width: 20,
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
  metaText: {
    marginTop: 6,
    color: color.text.secondary,
    fontFamily: fonts.Regular,
    fontSize: typography.micro.size,
    lineHeight: typography.micro.lineHeight
  },
  driverMetaRow: {
    marginTop: 8,
    gap: 2
  },
  feedbackText: {
    marginTop: 8,
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
  },
  contentViewport: {
    flex: 1
  }
});
