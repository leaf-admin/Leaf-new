import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, StatusBar, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { fonts } from '../../common-local/font';
import PrototypeScreenTransition from '../../components/prototype/PrototypeScreenTransition';
import PrototypeDismissibleSheet from '../../components/prototype/PrototypeDismissibleSheet';
import { CardHandle, PrototypeCard } from '../../components/prototype/PrototypeUI';
import robotaxiPrototypeTokens from '../../components/design-system/robotaxiPrototypeTokens';
import { usePrototypeMapOcclusion } from './prototypeMapOcclusion';
import { usePrototypeRideRuntime } from './prototypeRideRuntime';

const { color, typography } = robotaxiPrototypeTokens;
const SHEET_BOTTOM_OFFSET = 96;
const FALLBACK_CARD_HEIGHT = 386;

const FALLBACK_CHAT_MESSAGES = [
  { id: 'm1', author: 'driver', text: 'Oi! Estou a 4 min do embarque.', timestamp: new Date().toISOString() },
  { id: 'm2', author: 'you', text: 'Perfeito, estou na entrada principal.', timestamp: new Date().toISOString() }
];

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
    minute: '2-digit'
  });
}

export default function RobotaxiChatScreen({ navigation, route }) {
  const { loadChatSession, sendChatMessage, chatMessages, chatLoading, chatSending, chatError } = usePrototypeRideRuntime();
  const insets = useSafeAreaInsets();
  const [cardHeight, setCardHeight] = useState(FALLBACK_CARD_HEIGHT);
  const [draft, setDraft] = useState('');
  const sheetBottom = insets.bottom + SHEET_BOTTOM_OFFSET;

  usePrototypeMapOcclusion({
    routeKey: route?.key,
    layerId: route?.key || 'prototype-chat',
    occludedBottom: sheetBottom + cardHeight
  });

  useEffect(() => {
    loadChatSession().catch(() => {});
  }, [loadChatSession]);

  const messages = useMemo(() => {
    if (Array.isArray(chatMessages) && chatMessages.length > 0) {
      return chatMessages;
    }
    return FALLBACK_CHAT_MESSAGES;
  }, [chatMessages]);

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

  const handleSend = useCallback(async () => {
    const text = String(draft || '').trim();
    if (!text) {
      return;
    }

    setDraft('');
    try {
      await sendChatMessage(text);
    } catch (error) {
      Alert.alert('Não foi possível enviar', error?.message || 'Falha ao enviar mensagem.');
      setDraft(text);
    }
  }, [draft, sendChatMessage]);

  return (
    <PrototypeScreenTransition>
      <View style={styles.container} pointerEvents="box-none">
        <StatusBar translucent backgroundColor="transparent" barStyle="dark-content" />

        <PrototypeDismissibleSheet onClose={handleDismiss} sheetStyle={[styles.sheetWrap, { bottom: sheetBottom }]}>
          <PrototypeCard onLayout={handleCardLayout} style={styles.chatCard}>
            <CardHandle />
            <Text style={styles.title}>Chat da viagem</Text>
            <Text style={styles.subtitle}>Canal direto com motorista e suporte</Text>

            <FlatList
              data={messages}
              keyExtractor={item => item.id}
              style={styles.list}
              contentContainerStyle={styles.listContent}
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
                <View style={styles.emptyWrap}>
                  {chatLoading ? <ActivityIndicator size="small" color={color.accent.primary} /> : null}
                  <Text style={styles.emptyText}>
                    {chatLoading ? 'Carregando mensagens...' : 'Sem mensagens para esta corrida.'}
                  </Text>
                </View>
              }
            />

            <View style={styles.inputRow}>
              <View style={styles.inputMock}>
                <Ionicons name="chatbubble-ellipses-outline" size={16} color={color.text.muted} />
                <TextInput
                  style={styles.inputText}
                  value={draft}
                  onChangeText={setDraft}
                  placeholder="Enviar mensagem..."
                  placeholderTextColor={color.text.muted}
                  editable={!chatSending}
                  returnKeyType="send"
                  onSubmitEditing={handleSend}
                />
              </View>

              <TouchableOpacity
                style={[styles.sendButton, chatSending && styles.sendButtonDisabled]}
                activeOpacity={0.88}
                onPress={handleSend}
                disabled={chatSending}
              >
                {chatSending ? (
                  <ActivityIndicator size="small" color={color.accent.contrast} />
                ) : (
                  <Ionicons name="send" size={16} color={color.accent.contrast} />
                )}
              </TouchableOpacity>
            </View>

            {chatError ? <Text style={styles.errorText}>{chatError}</Text> : null}
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
  chatCard: {
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
  list: {
    marginTop: 8,
    maxHeight: 232
  },
  listContent: {
    paddingBottom: 6,
    gap: 8
  },
  messageRow: {
    flexDirection: 'row'
  },
  messageRowLeft: {
    justifyContent: 'flex-start'
  },
  messageRowRight: {
    justifyContent: 'flex-end'
  },
  bubble: {
    maxWidth: '86%',
    borderRadius: 14,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 8
  },
  bubbleDriver: {
    backgroundColor: color.surface.primary,
    borderColor: color.border.subtle
  },
  bubbleYou: {
    backgroundColor: color.surface.activeSoft,
    borderColor: 'rgba(26,51,14,0.28)'
  },
  bubbleText: {
    color: color.text.primary,
    fontFamily: fonts.Medium,
    fontSize: typography.caption.size,
    lineHeight: typography.caption.lineHeight
  },
  bubbleMeta: {
    marginTop: 2,
    color: color.text.secondary,
    fontFamily: fonts.Regular,
    fontSize: typography.micro.size,
    lineHeight: typography.micro.lineHeight
  },
  inputRow: {
    marginTop: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8
  },
  inputMock: {
    flex: 1,
    minHeight: 48,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: color.border.subtle,
    backgroundColor: color.surface.secondary,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8
  },
  inputText: {
    flex: 1,
    color: color.text.primary,
    fontFamily: fonts.Regular,
    fontSize: typography.caption.size,
    lineHeight: typography.caption.lineHeight,
    paddingVertical: 0
  },
  sendButton: {
    width: 48,
    height: 48,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: color.accent.primary
  },
  sendButtonDisabled: {
    opacity: 0.75
  },
  errorText: {
    marginTop: 8,
    color: '#8A1F2B',
    fontFamily: fonts.Medium,
    fontSize: typography.caption.size,
    lineHeight: typography.caption.lineHeight
  },
  emptyWrap: {
    minHeight: 52,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6
  },
  emptyText: {
    color: color.text.secondary,
    fontFamily: fonts.Regular,
    fontSize: typography.caption.size,
    lineHeight: typography.caption.lineHeight
  }
});
