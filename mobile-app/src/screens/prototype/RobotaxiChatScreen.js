import React, { useCallback, useEffect, useState } from 'react';
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
import robotaxiPrototypeTokens from '../../components/design-system/robotaxiPrototypeTokens';
import { usePrototypeMapOcclusion } from './prototypeMapOcclusion';
import { usePrototypeRideRuntime } from './prototypeRideRuntime';

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

export default function RobotaxiChatScreen({ navigation, route }) {
  const { loadChatSession, sendChatMessage, chatMessages, chatLoading, chatSending, chatError } = usePrototypeRideRuntime();
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();
  const [panelHeight, setPanelHeight] = useState(windowHeight);
  const [draft, setDraft] = useState('');
  const messages = Array.isArray(chatMessages) ? chatMessages : [];

  usePrototypeMapOcclusion({
    routeKey: route?.key,
    layerId: route?.key || 'prototype-chat',
    occludedBottom: panelHeight,
  });

  useEffect(() => {
    loadChatSession().catch(() => {});
  }, [loadChatSession]);

  const handleDismiss = useCallback(() => {
    navigation.navigate('RobotaxiPrototype');
  }, [navigation]);

  const handlePanelLayout = useCallback(event => {
    const nextHeight = event?.nativeEvent?.layout?.height;
    if (Number.isFinite(nextHeight) && nextHeight > 0) {
      setPanelHeight(nextHeight);
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
      Alert.alert('Nao foi possivel enviar', error?.message || 'Falha ao enviar mensagem.');
      setDraft(text);
    }
  }, [draft, sendChatMessage]);

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
              headerAccessory={<PrototypeMenuCloseButton onPress={handleDismiss} />}
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
                  <View style={styles.emptyWrap}>
                    {chatLoading ? <ActivityIndicator size="small" color={color.accent.primary} /> : null}
                    <Text style={styles.emptyText}>{chatLoading ? 'Carregando mensagens...' : 'Sem mensagens para esta corrida.'}</Text>
                  </View>
                }
              />

              <View style={styles.inputRow}>
                <View style={styles.inputWrap}>
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

                <TouchableOpacity style={[styles.sendButton, chatSending && styles.sendButtonDisabled]} activeOpacity={0.82} onPress={handleSend} disabled={chatSending}>
                  {chatSending ? (
                    <ActivityIndicator size="small" color={color.accent.contrast} />
                  ) : (
                    <Ionicons name="send" size={16} color={color.accent.contrast} />
                  )}
                </TouchableOpacity>
              </View>

              {chatError ? <Text style={styles.errorText}>{chatError}</Text> : null}
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
    backgroundColor: 'rgba(255,255,255,0.72)',
    borderColor: 'rgba(17,26,39,0.08)',
  },
  bubbleYou: {
    backgroundColor: 'rgba(218,232,210,0.5)',
    borderColor: 'rgba(42,77,29,0.18)',
  },
  bubbleText: {
    color: color.text.primary,
    fontFamily: fonts.Medium,
    fontSize: typography.caption.size,
    lineHeight: typography.caption.lineHeight,
  },
  bubbleMeta: {
    marginTop: 3,
    color: color.text.secondary,
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
    color: color.text.secondary,
    fontFamily: fonts.Regular,
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
    borderBottomColor: 'rgba(17,26,39,0.12)',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 2,
  },
  inputText: {
    flex: 1,
    color: color.text.primary,
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
    backgroundColor: color.accent.primary,
  },
  sendButtonDisabled: {
    opacity: 0.72,
  },
  errorText: {
    marginTop: 8,
    color: color.feedback.danger,
    fontFamily: fonts.Medium,
    fontSize: typography.caption.size,
    lineHeight: typography.caption.lineHeight,
  },
});
