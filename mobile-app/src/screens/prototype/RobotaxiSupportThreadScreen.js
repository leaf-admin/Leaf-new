import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { fonts } from '../../theme/runtimeTokens';
import PrototypeDismissibleSheet from '../../components/prototype/PrototypeDismissibleSheet';
import PrototypeScreenTransition from '../../components/prototype/PrototypeScreenTransition';
import {
  PrototypeMenuCloseButton,
  PrototypeMenuSurface,
} from '../../components/prototype/PrototypeMenuSurface';
import { LeafButton, leafRideColors } from '../../components/prototype/LeafRideUI';
import { ListSkeleton } from '../../components/LoadingStates';
import SupportTicketService from '../../services/SupportTicketService';
import { usePrototypeMapOcclusion } from './prototypeMapOcclusion';
import { normalizeRuntimeRideStatus } from './rideLifecycleContract';

const SURFACE_TOP_PADDING = 16;
const SURFACE_BOTTOM_PADDING = 18;
const BACKDROP_COLOR = 'transparent';
export const SUPPORT_TICKET_POLL_MS = 12000;

function pickText(...values) {
  return values.map(value => String(value || '').trim()).find(Boolean) || '';
}

function normalizeTicketStatus(status) {
  const normalized = String(status || '').trim().toLowerCase();
  if (['resolved', 'closed', 'completed'].includes(normalized)) {
    return { label: 'Resolvido', tone: 'success' };
  }
  if (['assigned', 'in_progress', 'in-progress'].includes(normalized)) {
    return { label: 'Em atendimento', tone: 'active' };
  }
  return { label: 'Aberto', tone: 'open' };
}

function normalizeThreadMessage(message, index) {
  const text = pickText(message?.message, message?.text);
  if (!text || message?.isInternal === true) {
    return null;
  }

  const createdAt = pickText(message?.createdAt, message?.timestamp, message?.sentAt) || new Date().toISOString();
  return {
    id: pickText(message?.id, message?.messageId) || `support-message-${index}-${createdAt}`,
    text,
    senderType: String(message?.senderType || message?.sender || 'user').trim().toLowerCase(),
    createdAt,
  };
}

function normalizeThreadMessages(messages) {
  const byId = new Map();
  (Array.isArray(messages) ? messages : []).forEach((message, index) => {
    const normalized = normalizeThreadMessage(message, index);
    if (normalized) {
      byId.set(normalized.id, normalized);
    }
  });

  return Array.from(byId.values()).sort((left, right) => {
    const leftTime = new Date(left.createdAt).getTime();
    const rightTime = new Date(right.createdAt).getTime();
    return (Number.isFinite(leftTime) ? leftTime : 0) - (Number.isFinite(rightTime) ? rightTime : 0);
  });
}

function formatMessageTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '--:--';
  }
  return date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

function resolveThreadReturnRoute(context = {}) {
  const source = String(context.source || '').trim().toLowerCase();
  const bookingStatus = normalizeRuntimeRideStatus(context.bookingStatus);
  if (source === 'receipt' || bookingStatus === 'completed') {
    return 'RobotaxiPrototypeReceipt';
  }
  if (source === 'driver-trip') {
    return 'RobotaxiPrototype';
  }
  if (context.bookingId || context.rideId || context.tripId) {
    return 'RobotaxiPrototypeTrip';
  }
  return 'RobotaxiPrototypeSupport';
}

export default function RobotaxiSupportThreadScreen({ navigation, route }) {
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();
  const [panelHeight, setPanelHeight] = useState(windowHeight);
  const [ticket, setTicket] = useState(route?.params?.ticket || null);
  const [messages, setMessages] = useState([]);
  const [draft, setDraft] = useState('');
  const [initialLoading, setInitialLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const mountedRef = useRef(true);
  const listRef = useRef(null);
  const silentPollCountRef = useRef(1);
  const ticketId = pickText(route?.params?.ticketId, route?.params?.ticket?.id);
  const bookingId = pickText(route?.params?.bookingId, route?.params?.rideId, route?.params?.tripId);
  const bookingStatus = normalizeRuntimeRideStatus(route?.params?.bookingStatus);
  const threadContext = useMemo(
    () => ({
      ...(bookingId ? { bookingId, rideId: bookingId, tripId: bookingId } : {}),
      ...(bookingStatus ? { bookingStatus } : {}),
      source: route?.params?.source || 'support-ticket-thread',
    }),
    [bookingId, bookingStatus, route?.params?.source],
  );
  const status = normalizeTicketStatus(ticket?.status);

  usePrototypeMapOcclusion({
    routeKey: route?.key,
    layerId: route?.key || 'prototype-support-thread',
    occludedBottom: panelHeight,
  });

  const loadThread = useCallback(async ({ mode = 'silent' } = {}) => {
    if (!ticketId) {
      if (mountedRef.current) {
        setInitialLoading(false);
        setRefreshing(false);
        setError('Não encontramos o ticket para acompanhar.');
      }
      return false;
    }

    if (mode === 'refresh' && mountedRef.current) {
      setRefreshing(true);
    }

    const shouldRefreshTicket = mode !== 'silent' || silentPollCountRef.current % 5 === 0;
    if (mode === 'silent') {
      silentPollCountRef.current += 1;
    }

    const [ticketResult, messagesResult] = await Promise.allSettled([
      shouldRefreshTicket ? SupportTicketService.getTicket(ticketId) : Promise.resolve(null),
      SupportTicketService.getTicketMessages(ticketId),
    ]);

    if (!mountedRef.current) {
      return false;
    }

    if (ticketResult.status === 'fulfilled' && ticketResult.value) {
      setTicket(ticketResult.value);
    }

    if (messagesResult.status === 'rejected') {
      setError(messagesResult.reason?.message || 'Não foi possível atualizar as mensagens do ticket.');
      setInitialLoading(false);
      setRefreshing(false);
      return false;
    }

    setMessages(normalizeThreadMessages(messagesResult.value));
    setError('');
    setInitialLoading(false);
    setRefreshing(false);
    return true;
  }, [ticketId]);

  useEffect(() => {
    mountedRef.current = true;
    loadThread({ mode: 'initial' });
    const pollingTimer = setInterval(() => {
      loadThread({ mode: 'silent' });
    }, SUPPORT_TICKET_POLL_MS);

    return () => {
      mountedRef.current = false;
      clearInterval(pollingTimer);
    };
  }, [loadThread]);

  useEffect(() => {
    if (!messages.length) {
      return undefined;
    }
    const scrollTimer = setTimeout(() => {
      listRef.current?.scrollToEnd?.({ animated: true });
    }, 60);
    return () => clearTimeout(scrollTimer);
  }, [messages]);

  const handlePanelLayout = useCallback(event => {
    const nextHeight = event?.nativeEvent?.layout?.height;
    if (Number.isFinite(nextHeight) && nextHeight > 0) {
      setPanelHeight(nextHeight);
    }
  }, []);

  const handleDismiss = useCallback(() => {
    if (navigation.canGoBack?.()) {
      navigation.goBack();
      return;
    }
    navigation.navigate(resolveThreadReturnRoute(threadContext), threadContext);
  }, [navigation, threadContext]);

  const handleSend = useCallback(async () => {
    const message = String(draft || '').trim();
    if (!message || sending || !ticketId) {
      return;
    }

    try {
      setSending(true);
      setError('');
      await SupportTicketService.addMessage(ticketId, {
        message,
        messageType: 'text',
        attachments: [],
      });
      if (mountedRef.current) {
        setDraft('');
      }
      await loadThread({ mode: 'silent' });
    } catch (sendError) {
      if (mountedRef.current) {
        setError(sendError?.message || 'Não foi possível enviar sua resposta.');
        Alert.alert('Não foi possível enviar', sendError?.message || 'Tente novamente em instantes.');
      }
    } finally {
      if (mountedRef.current) {
        setSending(false);
      }
    }
  }, [draft, loadThread, sending, ticketId]);

  return (
    <PrototypeScreenTransition>
      <View style={styles.container} pointerEvents="box-none" testID="robotaxi-support-thread-screen">
        <StatusBar translucent backgroundColor="transparent" barStyle="dark-content" />
        <PrototypeDismissibleSheet
          onClose={handleDismiss}
          backdropColor={BACKDROP_COLOR}
          dragEnabled={false}
          sheetStyle={styles.sheetWrap}
        >
          <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
            keyboardVerticalOffset={Math.max(0, insets.top - 4)}
            style={styles.keyboardAvoiding}
          >
            <PrototypeMenuSurface
              onLayout={handlePanelLayout}
              eyebrow="Suporte"
              title={ticketId ? `Ticket #${ticketId}` : 'Ticket de suporte'}
              subtitle="Acompanhe a resposta da operação e mantenha a conversa neste chamado."
              fullScreen
              style={{
                paddingTop: insets.top + SURFACE_TOP_PADDING,
                paddingBottom: Math.max(insets.bottom, SURFACE_BOTTOM_PADDING),
              }}
              bodyStyle={styles.body}
              headerAccessory={(
                <PrototypeMenuCloseButton
                  onPress={handleDismiss}
                  testID="robotaxi-support-thread-close-button"
                  accessibilityLabel="Fechar ticket de suporte"
                />
              )}
            >
              <View style={styles.threadMeta}>
                <View style={[styles.statusPill, styles[`statusPill_${status.tone}`]]}>
                  <Text style={[styles.statusText, styles[`statusText_${status.tone}`]]}>{status.label}</Text>
                </View>
                <Text style={styles.threadMetaText}>Atualização automática ativa</Text>
              </View>

              <FlatList
                ref={listRef}
                testID="robotaxi-support-thread-list"
                accessibilityLabel="Mensagens do ticket de suporte"
                data={messages}
                keyExtractor={item => item.id}
                style={styles.list}
                contentContainerStyle={[styles.listContent, messages.length === 0 && styles.listContentEmpty]}
                refreshing={refreshing}
                onRefresh={() => loadThread({ mode: 'refresh' })}
                renderItem={({ item }) => {
                  const fromUser = item.senderType === 'user';
                  return (
                    <View style={[styles.messageRow, fromUser ? styles.messageRowUser : styles.messageRowAgent]}>
                      <View style={[styles.messageBubble, fromUser ? styles.messageBubbleUser : styles.messageBubbleAgent]}>
                        <Text style={styles.messageAuthor}>{fromUser ? 'Você' : 'Suporte Leaf'}</Text>
                        <Text style={styles.messageText}>{item.text}</Text>
                        <Text style={styles.messageTime}>{formatMessageTime(item.createdAt)}</Text>
                      </View>
                    </View>
                  );
                }}
                ListEmptyComponent={(
                  <View style={styles.emptyState}>
                    {initialLoading ? (
                      <ListSkeleton rows={3} rowHeight={44} gap={10} />
                    ) : (
                      <Ionicons
                        name={error ? 'warning-outline' : 'chatbubble-ellipses-outline'}
                        size={24}
                        color={error ? leafRideColors.dangerText : leafRideColors.muted}
                      />
                    )}
                    <Text style={[styles.emptyTitle, error && styles.errorText]}>
                      {initialLoading
                        ? 'Carregando conversa...'
                        : error || 'Sua conversa aparecerá aqui.'}
                    </Text>
                    {error && !initialLoading ? (
                      <LeafButton
                        label="Tentar novamente"
                        icon="refresh-outline"
                        onPress={() => loadThread({ mode: 'refresh' })}
                        testID="robotaxi-support-thread-retry-button"
                        accessibilityLabel="Tentar novamente carregar ticket"
                        style={styles.retryButton}
                      />
                    ) : null}
                  </View>
                )}
              />

              {error && messages.length > 0 ? <Text style={styles.inlineError}>{error}</Text> : null}

              <View style={styles.composer}>
                <TextInput
                  value={draft}
                  onChangeText={setDraft}
                  placeholder="Escreva uma resposta"
                  placeholderTextColor={leafRideColors.muted}
                  style={styles.input}
                  multiline
                  maxLength={1000}
                  editable={!sending && Boolean(ticketId)}
                  testID="robotaxi-support-thread-input"
                  accessibilityLabel="Resposta do ticket"
                />
                <LeafButton
                  label={sending ? 'Enviando...' : 'Enviar resposta'}
                  icon="send-outline"
                  tone="primary"
                  onPress={handleSend}
                  disabled={sending || !ticketId || !String(draft || '').trim()}
                  testID="robotaxi-support-thread-send-button"
                  accessibilityLabel="Enviar resposta no ticket"
                  style={styles.sendButton}
                />
              </View>
            </PrototypeMenuSurface>
          </KeyboardAvoidingView>
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
  keyboardAvoiding: {
    flex: 1,
  },
  body: {
    flex: 1,
  },
  threadMeta: {
    minHeight: 42,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    marginBottom: 10,
  },
  statusPill: {
    minHeight: 28,
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  statusPill_open: {
    backgroundColor: '#F4F0E7',
    borderColor: '#E4D8BD',
  },
  statusPill_active: {
    backgroundColor: '#EEF3EA',
    borderColor: '#D9E3D3',
  },
  statusPill_success: {
    backgroundColor: '#EAF5ED',
    borderColor: '#CBE5D2',
  },
  statusText: {
    fontFamily: fonts.SemiBold,
    fontSize: 11,
    lineHeight: 15,
  },
  statusText_open: {
    color: '#765B23',
  },
  statusText_active: {
    color: leafRideColors.leaf,
  },
  statusText_success: {
    color: '#1A6A35',
  },
  threadMetaText: {
    color: leafRideColors.muted,
    fontFamily: fonts.Regular,
    fontSize: 11,
    lineHeight: 15,
  },
  list: {
    flex: 1,
  },
  listContent: {
    paddingVertical: 8,
    gap: 10,
  },
  listContentEmpty: {
    flexGrow: 1,
    justifyContent: 'center',
  },
  messageRow: {
    width: '100%',
  },
  messageRowUser: {
    alignItems: 'flex-end',
  },
  messageRowAgent: {
    alignItems: 'flex-start',
  },
  messageBubble: {
    maxWidth: '86%',
    borderRadius: 20,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 11,
  },
  messageBubbleUser: {
    backgroundColor: '#EEF3EA',
    borderColor: '#D9E3D3',
    borderBottomRightRadius: 7,
  },
  messageBubbleAgent: {
    backgroundColor: '#FFFFFF',
    borderColor: leafRideColors.line,
    borderBottomLeftRadius: 7,
  },
  messageAuthor: {
    color: leafRideColors.secondary,
    fontFamily: fonts.SemiBold,
    fontSize: 10,
    lineHeight: 14,
    marginBottom: 3,
  },
  messageText: {
    color: leafRideColors.text,
    fontFamily: fonts.Regular,
    fontSize: 13,
    lineHeight: 19,
  },
  messageTime: {
    marginTop: 5,
    color: leafRideColors.muted,
    fontFamily: fonts.Regular,
    fontSize: 10,
    lineHeight: 13,
    alignSelf: 'flex-end',
  },
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    paddingHorizontal: 24,
    paddingVertical: 30,
  },
  emptyTitle: {
    color: leafRideColors.secondary,
    fontFamily: fonts.Regular,
    fontSize: 13,
    lineHeight: 19,
    textAlign: 'center',
  },
  errorText: {
    color: leafRideColors.dangerText,
  },
  retryButton: {
    alignSelf: 'center',
    minWidth: 180,
  },
  inlineError: {
    marginBottom: 8,
    color: leafRideColors.dangerText,
    fontFamily: fonts.Medium,
    fontSize: 11,
    lineHeight: 15,
  },
  composer: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: leafRideColors.line,
    paddingTop: 12,
    gap: 10,
  },
  input: {
    minHeight: 58,
    maxHeight: 110,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: leafRideColors.line,
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 14,
    paddingTop: 11,
    paddingBottom: 10,
    color: leafRideColors.text,
    fontFamily: fonts.Regular,
    fontSize: 13,
    lineHeight: 18,
    textAlignVertical: 'top',
  },
  sendButton: {
    alignSelf: 'stretch',
  },
});
