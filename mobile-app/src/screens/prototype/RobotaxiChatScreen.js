import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, KeyboardAvoidingView, Platform, StatusBar, StyleSheet, Text, TextInput, TouchableOpacity, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { fonts } from '../../theme/runtimeTokens';
import PrototypeScreenTransition from '../../components/prototype/PrototypeScreenTransition';
import PrototypeDismissibleSheet from '../../components/prototype/PrototypeDismissibleSheet';
import {
  PrototypeMenuCloseButton,
  PrototypeMenuSurface,
} from '../../components/prototype/PrototypeMenuSurface';
import { leafRideColors } from '../../components/prototype/LeafRideUI';
import robotaxiPrototypeTokens from '../../components/design-system/robotaxiPrototypeTokens';
import { usePrototypeMapOcclusion } from './prototypeMapOcclusion';
import { usePrototypeRideRuntime } from './prototypeRideRuntime';
import { normalizeRuntimeRideStatus } from './rideLifecycleContract';

const { color, typography } = robotaxiPrototypeTokens;
const SURFACE_TOP_PADDING = 16;
const SURFACE_BOTTOM_PADDING = 18;
const BACKDROP_COLOR = 'transparent';

function formatTimestamp(timestamp) {
  if (!timestamp) {
    return '--:--';
  }

  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) {
    return '--:--';
  }

  return date.toLocaleTimeString('pt-BR', {
    hour: '2-digit',
    minute: '2-digit',
  });
}

function resolveChatReturnRoute(context = {}) {
  const source = String(context.source || '').toLowerCase();
  const status = normalizeRuntimeRideStatus(context.bookingStatus);

  if (source === 'receipt' || status === 'completed') {
    return 'RobotaxiPrototypeReceipt';
  }
  if (source === 'driver-trip') {
    return 'RobotaxiPrototypeDriverTrip';
  }
  if (context.bookingId || context.rideId || context.tripId) {
    return 'RobotaxiPrototypeTrip';
  }
  return 'RobotaxiPrototype';
}

export default function RobotaxiChatScreen({ navigation, route }) {
  const { loadChatSession, sendChatMessage, chatMessages, chatLoading, chatSending, chatError } = usePrototypeRideRuntime();
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();
  const [panelHeight, setPanelHeight] = useState(windowHeight);
  const [draft, setDraft] = useState('');
  const messages = Array.isArray(chatMessages) ? chatMessages : [];
  const hasListError = Boolean(chatError) && !chatLoading && messages.length === 0;
  const chatScope = useMemo(() => {
    const params = route?.params || {};
    const bookingId = String(params.bookingId || params.rideId || params.tripId || '').trim();
    const bookingStatus = normalizeRuntimeRideStatus(params.bookingStatus);
    return {
      ...(bookingId ? { bookingId, rideId: bookingId, tripId: bookingId } : {}),
      ...(bookingStatus ? { bookingStatus } : {}),
      source: params.source || 'prototype-chat',
    };
  }, [
    route?.params?.bookingId,
    route?.params?.bookingStatus,
    route?.params?.rideId,
    route?.params?.source,
    route?.params?.tripId,
  ]);

  usePrototypeMapOcclusion({
    routeKey: route?.key,
    layerId: route?.key || 'prototype-chat',
    occludedBottom: panelHeight,
  });

  useEffect(() => {
    loadChatSession(chatScope).catch(() => {});
  }, [chatScope, loadChatSession]);

  const handleDismiss = useCallback(() => {
    navigation.navigate(resolveChatReturnRoute(chatScope), chatScope);
  }, [chatScope, navigation]);

  const handlePanelLayout = useCallback(event => {
    const nextHeight = event?.nativeEvent?.layout?.height;
    if (Number.isFinite(nextHeight) && nextHeight > 0) {
      setPanelHeight(nextHeight);
    }
  }, []);

  const handleRetryLoad = useCallback(() => {
    loadChatSession({ ...chatScope, forceReload: true }).catch(() => {});
  }, [chatScope, loadChatSession]);

  const handleSend = useCallback(async () => {
    const text = String(draft || '').trim();
    if (!text) {
      return;
    }

    setDraft('');
    try {
      await sendChatMessage(text, chatScope);
    } catch (error) {
      Alert.alert('Não foi possível enviar', error?.message || 'Falha ao enviar mensagem.');
      setDraft(text);
    }
  }, [chatScope, draft, sendChatMessage]);

  return (
    <PrototypeScreenTransition>
      <View style={styles.container} pointerEvents="box-none">
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
              eyebrow="Canal direto"
              title="Chat"
              subtitle="Converse com motorista e suporte sem sair do contexto da viagem."
              fullScreen
              style={{
                paddingTop: insets.top + SURFACE_TOP_PADDING,
                paddingBottom: Math.max(insets.bottom, SURFACE_BOTTOM_PADDING),
              }}
              bodyStyle={styles.body}
              headerAccessory={(
                <PrototypeMenuCloseButton
                  onPress={handleDismiss}
                  testID="robotaxi-chat-close-button"
                  accessibilityLabel="robotaxi-chat-close-button"
                />
              )}
            >
              <FlatList
                data={messages}
                keyExtractor={(item, index) => String(item?.id || item?.messageId || `chat-${index}`)}
                style={styles.list}
                contentContainerStyle={styles.listContent}
                showsVerticalScrollIndicator={false}
                renderItem={({ item }) => {
                  const fromYou = item.author === 'you';
                  return (
                    <View style={[styles.messageRow, fromYou ? styles.messageRowRight : styles.messageRowLeft]}>
                      <View style={[styles.bubble, fromYou ? styles.bubbleYou : styles.bubbleDriver]}>
                        <Text style={styles.bubbleText}>{item.text}</Text>
                        <Text style={styles.bubbleMeta}>{formatTimestamp(item.timestamp)}</Text>
                      </View>
                    </View>
                  );
                }}
                ListEmptyComponent={
                  <View
                    style={styles.emptyWrap}
                    testID={hasListError ? 'prototype-chat-error-state' : 'prototype-chat-empty-state'}
                    accessibilityLabel={hasListError ? 'Erro ao carregar chat da corrida' : 'Estado vazio do chat da corrida'}
                  >
                    {chatLoading ? <ActivityIndicator size="small" color={leafRideColors.leaf} /> : null}
                    {hasListError ? <Ionicons name="warning-outline" size={18} color={leafRideColors.dangerText} /> : null}
                    <Text style={[styles.emptyText, hasListError && styles.emptyErrorText]}>
                      {chatLoading
                        ? 'Carregando mensagens...'
                        : hasListError
                          ? chatError
                          : 'Sem mensagens para esta corrida.'}
                    </Text>
                    {hasListError ? (
                      <TouchableOpacity
                        activeOpacity={0.82}
                        onPress={handleRetryLoad}
                        style={styles.retryButton}
                        testID="prototype-chat-retry-button"
                        accessibilityLabel="Tentar novamente carregar chat"
                      >
                        <Text style={styles.retryButtonText}>Tentar novamente</Text>
                      </TouchableOpacity>
                    ) : null}
                  </View>
                }
              />

              <View style={styles.inputRow}>
                <View style={styles.inputWrap}>
                  <Ionicons name="chatbubble-ellipses-outline" size={16} color={leafRideColors.muted} />
                  <TextInput
                    style={styles.inputText}
                    value={draft}
                    onChangeText={setDraft}
                    placeholder="Enviar mensagem..."
                    placeholderTextColor={leafRideColors.muted}
                    editable={!chatSending}
                    returnKeyType="send"
                    onSubmitEditing={handleSend}
                  />
                </View>

                <TouchableOpacity style={[styles.sendButton, chatSending && styles.sendButtonDisabled]} activeOpacity={0.82} onPress={handleSend} disabled={chatSending}>
                  {chatSending ? (
                    <ActivityIndicator size="small" color={color.accent.contrast} />
                  ) : (
                    <Ionicons name="send" size={16} color={color.accent.contrast} />
                  )}
                </TouchableOpacity>
              </View>

              {chatError && !hasListError ? <Text style={styles.errorText}>{chatError}</Text> : null}
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
  list: {
    flex: 1,
  },
  listContent: {
    paddingBottom: 8,
    gap: 8,
  },
  messageRow: {
    flexDirection: 'row',
  },
  messageRowLeft: {
    justifyContent: 'flex-start',
  },
  messageRowRight: {
    justifyContent: 'flex-end',
  },
  bubble: {
    maxWidth: '88%',
    borderRadius: 18,
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderWidth: 1,
  },
  bubbleDriver: {
    backgroundColor: 'rgba(255,255,255,0.92)',
    borderColor: leafRideColors.line,
  },
  bubbleYou: {
    backgroundColor: leafRideColors.bg,
    borderColor: 'rgba(26,51,14,0.14)',
  },
  bubbleText: {
    color: leafRideColors.text,
    fontFamily: fonts.Medium,
    fontSize: typography.caption.size,
    lineHeight: typography.caption.lineHeight,
  },
  bubbleMeta: {
    marginTop: 3,
    color: leafRideColors.secondary,
    fontFamily: fonts.Regular,
    fontSize: typography.micro.size,
    lineHeight: typography.micro.lineHeight,
  },
  emptyWrap: {
    paddingVertical: 18,
    alignItems: 'center',
    gap: 8,
  },
  emptyText: {
    color: leafRideColors.secondary,
    fontFamily: fonts.Regular,
    fontSize: typography.caption.size,
    lineHeight: typography.caption.lineHeight,
    textAlign: 'center',
  },
  emptyErrorText: {
    color: leafRideColors.dangerText,
    fontFamily: fonts.Medium,
  },
  retryButton: {
    minHeight: 38,
    borderRadius: 19,
    paddingHorizontal: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: leafRideColors.bg,
    borderWidth: 1,
    borderColor: 'rgba(26,51,14,0.14)',
  },
  retryButtonText: {
    color: leafRideColors.text,
    fontFamily: fonts.Medium,
    fontSize: typography.caption.size,
    lineHeight: typography.caption.lineHeight,
  },
  inputRow: {
    marginTop: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  inputWrap: {
    flex: 1,
    minHeight: 50,
    borderBottomWidth: 1,
    borderBottomColor: leafRideColors.line,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 2,
  },
  inputText: {
    flex: 1,
    color: leafRideColors.text,
    fontFamily: fonts.Regular,
    fontSize: typography.caption.size,
    lineHeight: typography.caption.lineHeight,
    paddingVertical: 0,
  },
  sendButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: leafRideColors.leaf,
  },
  sendButtonDisabled: {
    opacity: 0.72,
  },
  errorText: {
    marginTop: 8,
    color: leafRideColors.dangerText,
    fontFamily: fonts.Medium,
    fontSize: typography.caption.size,
    lineHeight: typography.caption.lineHeight,
  },
});
