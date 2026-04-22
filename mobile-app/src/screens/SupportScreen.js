import Logger from '../utils/Logger';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  StatusBar,
  Platform,
  ActivityIndicator,
  FlatList,
  Alert,
  ScrollView
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSelector } from 'react-redux';
import { fonts } from '../theme/runtimeTokens';
import WebSocketManager from '../services/WebSocketManager';
import SupportService from '../services/SupportService';
import SupportChatService from '../services/SupportChatService';
import robotaxiPrototypeTokens from '../components/design-system/robotaxiPrototypeTokens';

const { color, typography } = robotaxiPrototypeTokens;

const FALLBACK_FAQ = [
  {
    id: 'fallback-1',
    question: 'Como entrar em contato com o suporte?',
    answer: 'Use o chat em tempo real, tickets ou envie e-mail para suporte@leaf.com.br.'
  },
  {
    id: 'fallback-2',
    question: 'Qual o horário de atendimento?',
    answer: 'Nosso suporte operacional funciona 24h por dia, 7 dias por semana.'
  },
  {
    id: 'fallback-3',
    question: 'Como abrir um ticket?',
    answer: 'Na aba Tickets, toque no ticket desejado ou abra um novo chamado pelo suporte.'
  }
];

function getCurrentUserId(profile) {
  return profile?.uid || profile?.id || null;
}

function normalizeMessage(msg) {
  return {
    id: String(msg?.id || `msg-${Date.now()}`),
    text: String(msg?.message || msg?.text || ''),
    sender: msg?.senderType === 'user' || msg?.sender === 'user' ? 'user' : 'support',
    timestamp: msg?.timestamp || new Date().toISOString()
  };
}

function formatTimestamp(value) {
  try {
    return new Date(value).toLocaleTimeString('pt-BR', {
      hour: '2-digit',
      minute: '2-digit'
    });
  } catch (error) {
    return '--:--';
  }
}

export default function SupportScreen({ navigation }) {
  const [selectedTab, setSelectedTab] = useState('chat');
  const [message, setMessage] = useState('');
  const [chatMessages, setChatMessages] = useState([]);
  const [tickets, setTickets] = useState([]);
  const [faqs, setFaqs] = useState([]);
  const [expandedFaq, setExpandedFaq] = useState(null);
  const [isLoading, setIsLoading] = useState(false);

  const auth = useSelector(state => state.auth);
  const currentUser = auth?.profile;
  const wsManager = WebSocketManager.getInstance();
  const chatRef = useRef(null);

  const faqItems = useMemo(() => {
    if (Array.isArray(faqs) && faqs.length) {
      return faqs.map((item, index) => ({
        id: String(item?.id || `faq-${index}`),
        question: String(item?.question || item?.title || 'Pergunta frequente'),
        answer: String(item?.answer || item?.description || 'Resposta indisponível no momento.')
      }));
    }
    return FALLBACK_FAQ;
  }, [faqs]);

  useEffect(() => {
    let unsubscribe = null;
    let isMounted = true;

    const bootstrap = async () => {
      await loadSupportData();
      await connectChat();
      unsubscribe = await initializeSupportChat();
    };

    bootstrap().catch(error => {
      Logger.error('❌ [SupportScreen] Falha ao inicializar suporte:', error);
    });

    return () => {
      isMounted = false;
      if (typeof unsubscribe === 'function') {
        unsubscribe();
      }
      SupportChatService.disconnect();
    };

    async function connectChat() {
      try {
        if (!wsManager.isConnected()) {
          await wsManager.connect();
        }
      } catch (error) {
        Logger.error('Erro ao conectar chat de suporte:', error);
      }
    }

    async function initializeSupportChat() {
      try {
        const userId = getCurrentUserId(currentUser);
        if (!userId || !isMounted) {
          return null;
        }

        await SupportChatService.initialize(userId);

        const existingMessages = await SupportChatService.getMessages(userId);
        if (isMounted && Array.isArray(existingMessages)) {
          setChatMessages(existingMessages.map(normalizeMessage));
        }

        return SupportChatService.onNewMessage(newMessage => {
          if (!isMounted) {
            return;
          }

          setChatMessages(previous => {
            const normalized = normalizeMessage(newMessage);
            if (previous.some(item => item.id === normalized.id)) {
              return previous;
            }
            return [...previous, normalized];
          });
        }, userId);
      } catch (error) {
        Logger.error('❌ Erro ao inicializar chat de suporte:', error);
        return null;
      }
    }

    async function loadSupportData() {
      try {
        setIsLoading(true);

        const userId = getCurrentUserId(currentUser);
        if (!userId) {
          return;
        }

        const [ticketsResult, faqResult] = await Promise.all([
          SupportService.getTickets(userId),
          SupportService.getFAQ()
        ]);

        if (ticketsResult?.success) {
          setTickets(Array.isArray(ticketsResult.tickets) ? ticketsResult.tickets : []);
        }

        if (faqResult?.success) {
          setFaqs(Array.isArray(faqResult.faqs) ? faqResult.faqs : []);
        }
      } catch (error) {
        Logger.error('❌ Erro ao carregar dados de suporte:', error);
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    }
  }, [currentUser?.uid, currentUser?.id]);

  useEffect(() => {
    if (!chatRef.current || !chatMessages.length) {
      return;
    }

    const timeout = setTimeout(() => {
      chatRef.current?.scrollToEnd?.({ animated: true });
    }, 50);

    return () => clearTimeout(timeout);
  }, [chatMessages]);

  const sendMessage = async () => {
    const messageText = message.trim();
    if (!messageText) {
      return;
    }

    const userId = getCurrentUserId(currentUser);
    if (!userId) {
      Alert.alert('Erro', 'Usuário não identificado.');
      return;
    }

    const tempMessage = {
      id: `temp-${Date.now()}`,
      text: messageText,
      sender: 'user',
      timestamp: new Date().toISOString()
    };

    setMessage('');
    setChatMessages(previous => [...previous, tempMessage]);

    try {
      const result = await SupportChatService.sendMessage(messageText, userId);

      if (!result?.success) {
        throw new Error(result?.error || 'Não foi possível enviar a mensagem.');
      }

      setChatMessages(previous => {
        const withoutTemp = previous.filter(item => item.id !== tempMessage.id);
        const normalized = normalizeMessage({ ...result.message, id: result.messageId, senderType: 'user' });
        return [...withoutTemp, normalized];
      });

      await SupportChatService.markAsRead(userId);
    } catch (error) {
      setChatMessages(previous => previous.filter(item => item.id !== tempMessage.id));
      setMessage(messageText);
      Logger.error('❌ Erro ao enviar mensagem de suporte:', error);
      Alert.alert('Falha no envio', error?.message || 'Tente novamente em instantes.');
    }
  };

  const renderHeader = () => (
    <View style={styles.header}>
      <TouchableOpacity style={styles.headerButton} onPress={() => navigation.goBack()} activeOpacity={0.86}>
        <Ionicons name="arrow-back" color={color.text.primary} size={18} />
      </TouchableOpacity>
      <Text style={styles.headerTitle}>Suporte</Text>
      <TouchableOpacity style={styles.headerButton} onPress={() => navigation.navigate('Help')} activeOpacity={0.86}>
        <Ionicons name="help-circle-outline" color={color.text.primary} size={18} />
      </TouchableOpacity>
    </View>
  );

  const renderSummaryCard = () => (
    <View style={styles.summaryCard}>
      <View style={styles.summaryIcon}>
        <Ionicons name="headset-outline" size={16} color={color.text.primary} />
      </View>
      <View style={styles.summaryTextWrap}>
        <Text style={styles.summaryTitle}>Central de atendimento Leaf</Text>
        <Text style={styles.summarySubtitle}>Chat em tempo real, tickets e base de respostas em um só lugar.</Text>
      </View>
    </View>
  );

  const renderTabs = () => (
    <View style={styles.tabsRow}>
      {[
        { id: 'chat', label: 'Chat', icon: 'chatbubble-ellipses-outline' },
        { id: 'tickets', label: 'Tickets', icon: 'document-text-outline' },
        { id: 'faq', label: 'FAQ', icon: 'help-circle-outline' }
      ].map(tab => {
        const active = selectedTab === tab.id;
        return (
          <TouchableOpacity
            key={tab.id}
            style={[styles.tabButton, active && styles.tabButtonActive]}
            onPress={() => setSelectedTab(tab.id)}
            activeOpacity={0.86}
          >
            <Ionicons name={tab.icon} size={15} color={active ? '#FFFFFF' : color.text.secondary} />
            <Text style={[styles.tabText, active && styles.tabTextActive]}>{tab.label}</Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );

  const renderChatTab = () => (
    <View style={styles.tabPanel}>
      <View style={styles.chatHeaderCard}>
        <View style={styles.chatBadge}>
          <Ionicons name="chatbubbles-outline" size={14} color={color.text.primary} />
        </View>
        <View style={styles.chatHeaderTextWrap}>
          <Text style={styles.chatHeaderTitle}>Atendimento online</Text>
          <Text style={styles.chatHeaderSubtitle}>Respostas rápidas para ocorrências de corrida e conta.</Text>
        </View>
      </View>

      <View style={styles.chatMessagesWrap}>
        <FlatList
          ref={chatRef}
          data={chatMessages}
          keyExtractor={item => item.id}
          contentContainerStyle={styles.messagesContent}
          renderItem={({ item }) => {
            const isUser = item.sender === 'user';
            return (
              <View style={[styles.messageBubble, isUser ? styles.messageBubbleUser : styles.messageBubbleSupport]}>
                <Text style={[styles.messageText, isUser ? styles.messageTextUser : styles.messageTextSupport]}>{item.text}</Text>
                <Text style={styles.messageTimestamp}>{formatTimestamp(item.timestamp)}</Text>
              </View>
            );
          }}
          ListEmptyComponent={
            <View style={styles.emptyChatWrap}>
              <Ionicons name="chatbox-ellipses-outline" size={24} color={color.text.muted} />
              <Text style={styles.emptyChatText}>Nenhuma mensagem ainda. Escreva para começar.</Text>
            </View>
          }
          showsVerticalScrollIndicator={false}
        />
      </View>

      <View style={styles.inputRow}>
        <TextInput
          value={message}
          onChangeText={setMessage}
          placeholder="Digite sua mensagem"
          placeholderTextColor={color.text.muted}
          style={styles.input}
          multiline
          maxLength={500}
        />
        <TouchableOpacity
          style={[styles.sendButton, !message.trim() && styles.sendButtonDisabled]}
          onPress={sendMessage}
          disabled={!message.trim()}
          activeOpacity={0.86}
        >
          <Ionicons name="send" size={14} color="#FFFFFF" />
        </TouchableOpacity>
      </View>
    </View>
  );

  const renderTicketsTab = () => (
    <ScrollView style={styles.tabPanel} contentContainerStyle={styles.scrollBody} showsVerticalScrollIndicator={false}>
      {!tickets.length ? (
        <View style={styles.emptyStateCard}>
          <Ionicons name="document-text-outline" size={24} color={color.text.muted} />
          <Text style={styles.emptyStateTitle}>Nenhum ticket encontrado</Text>
          <Text style={styles.emptyStateSubtitle}>Quando houver chamados, eles aparecem aqui para acompanhamento.</Text>
        </View>
      ) : (
        tickets.map((ticket, index) => {
          const title = ticket?.title || `Ticket #${ticket?.id || index + 1}`;
          const description = ticket?.description || 'Sem descrição detalhada.';
          const statusLabel = ticket?.status || 'Aberto';
          return (
            <TouchableOpacity
              key={String(ticket?.id || index)}
              style={styles.ticketCard}
              activeOpacity={0.86}
              onPress={() => navigation.navigate('SupportTicket', { ticket })}
            >
              <View style={styles.ticketHeader}>
                <Text style={styles.ticketTitle}>{title}</Text>
                <View style={styles.ticketStatusBadge}>
                  <Text style={styles.ticketStatusText}>{statusLabel}</Text>
                </View>
              </View>
              <Text style={styles.ticketDescription}>{description}</Text>
              <View style={styles.ticketFooter}>
                <Text style={styles.ticketActionText}>Ver detalhes</Text>
                <Ionicons name="chevron-forward" size={15} color={color.text.secondary} />
              </View>
            </TouchableOpacity>
          );
        })
      )}
    </ScrollView>
  );

  const renderFaqTab = () => (
    <ScrollView style={styles.tabPanel} contentContainerStyle={styles.scrollBody} showsVerticalScrollIndicator={false}>
      {faqItems.map((item, index) => {
        const expanded = expandedFaq === item.id;
        return (
          <View key={item.id} style={styles.faqCard}>
            <TouchableOpacity
              style={styles.faqHeader}
              onPress={() => setExpandedFaq(expanded ? null : item.id)}
              activeOpacity={0.86}
            >
              <Text style={styles.faqQuestion}>{item.question}</Text>
              <Ionicons name={expanded ? 'chevron-up' : 'chevron-down'} size={15} color={color.text.secondary} />
            </TouchableOpacity>
            {expanded ? <Text style={styles.faqAnswer}>{item.answer}</Text> : null}
          </View>
        );
      })}
    </ScrollView>
  );

  return (
    <View style={styles.container}>
      <StatusBar
        barStyle="dark-content"
        backgroundColor="transparent"
        translucent={Platform.OS === 'android'}
      />

      {renderHeader()}
      {renderSummaryCard()}
      {renderTabs()}

      {isLoading ? (
        <View style={styles.loadingWrap}>
          <ActivityIndicator size="large" color={color.accent.primary} />
          <Text style={styles.loadingText}>Carregando suporte...</Text>
        </View>
      ) : (
        <View style={styles.body}>
          {selectedTab === 'chat' ? renderChatTab() : null}
          {selectedTab === 'tickets' ? renderTicketsTab() : null}
          {selectedTab === 'faq' ? renderFaqTab() : null}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: color.bg.app,
    paddingTop: Platform.OS === 'ios' ? 54 : 34
  },
  header: {
    paddingHorizontal: 14,
    paddingBottom: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between'
  },
  headerButton: {
    width: 38,
    height: 38,
    borderRadius: 19,
    borderWidth: 1,
    borderColor: color.border.subtle,
    backgroundColor: color.surface.primary,
    alignItems: 'center',
    justifyContent: 'center'
  },
  headerTitle: {
    color: color.text.primary,
    fontFamily: fonts.SemiBold,
    fontSize: typography.subtitle.size,
    lineHeight: typography.subtitle.lineHeight
  },
  summaryCard: {
    marginHorizontal: 14,
    marginBottom: 10,
    minHeight: 74,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: color.border.subtle,
    backgroundColor: color.surface.primary,
    paddingHorizontal: 12,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center'
  },
  summaryIcon: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: color.surface.secondary,
    borderWidth: 1,
    borderColor: color.border.subtle
  },
  summaryTextWrap: {
    flex: 1,
    marginLeft: 10
  },
  summaryTitle: {
    color: color.text.primary,
    fontFamily: fonts.SemiBold,
    fontSize: typography.body.size,
    lineHeight: typography.body.lineHeight
  },
  summarySubtitle: {
    marginTop: 1,
    color: color.text.secondary,
    fontFamily: fonts.Regular,
    fontSize: typography.micro.size,
    lineHeight: typography.micro.lineHeight
  },
  tabsRow: {
    marginHorizontal: 14,
    marginBottom: 10,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: color.border.subtle,
    backgroundColor: color.surface.primary,
    padding: 6,
    flexDirection: 'row',
    gap: 6
  },
  tabButton: {
    flex: 1,
    minHeight: 36,
    borderRadius: 11,
    borderWidth: 1,
    borderColor: color.border.subtle,
    backgroundColor: color.surface.secondary,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6
  },
  tabButtonActive: {
    borderColor: color.accent.primary,
    backgroundColor: color.accent.primary
  },
  tabText: {
    color: color.text.secondary,
    fontFamily: fonts.Medium,
    fontSize: typography.caption.size,
    lineHeight: typography.caption.lineHeight
  },
  tabTextActive: {
    color: '#FFFFFF',
    fontFamily: fonts.SemiBold
  },
  body: {
    flex: 1,
    paddingHorizontal: 14,
    paddingBottom: 12
  },
  tabPanel: {
    flex: 1,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: color.border.subtle,
    backgroundColor: color.surface.primary,
    overflow: 'hidden'
  },
  chatHeaderCard: {
    minHeight: 62,
    borderBottomWidth: 1,
    borderBottomColor: color.border.subtle,
    paddingHorizontal: 12,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center'
  },
  chatBadge: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: color.surface.secondary,
    borderWidth: 1,
    borderColor: color.border.subtle
  },
  chatHeaderTextWrap: {
    flex: 1,
    marginLeft: 10
  },
  chatHeaderTitle: {
    color: color.text.primary,
    fontFamily: fonts.Medium,
    fontSize: typography.body.size,
    lineHeight: typography.body.lineHeight
  },
  chatHeaderSubtitle: {
    marginTop: 1,
    color: color.text.secondary,
    fontFamily: fonts.Regular,
    fontSize: typography.micro.size,
    lineHeight: typography.micro.lineHeight
  },
  chatMessagesWrap: {
    flex: 1,
    minHeight: 260,
    backgroundColor: color.surface.secondary
  },
  messagesContent: {
    paddingHorizontal: 10,
    paddingVertical: 10,
    gap: 8
  },
  messageBubble: {
    maxWidth: '84%',
    borderRadius: 14,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 8
  },
  messageBubbleUser: {
    alignSelf: 'flex-end',
    backgroundColor: color.accent.primary,
    borderColor: 'rgba(0,0,0,0.08)'
  },
  messageBubbleSupport: {
    alignSelf: 'flex-start',
    backgroundColor: color.surface.primary,
    borderColor: color.border.subtle
  },
  messageText: {
    fontFamily: fonts.Regular,
    fontSize: typography.caption.size,
    lineHeight: typography.caption.lineHeight
  },
  messageTextUser: {
    color: '#FFFFFF'
  },
  messageTextSupport: {
    color: color.text.primary
  },
  messageTimestamp: {
    marginTop: 3,
    color: color.text.muted,
    fontFamily: fonts.Regular,
    fontSize: typography.micro.size,
    lineHeight: typography.micro.lineHeight,
    alignSelf: 'flex-end'
  },
  emptyChatWrap: {
    paddingVertical: 24,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6
  },
  emptyChatText: {
    color: color.text.muted,
    fontFamily: fonts.Regular,
    fontSize: typography.caption.size,
    lineHeight: typography.caption.lineHeight
  },
  inputRow: {
    borderTopWidth: 1,
    borderTopColor: color.border.subtle,
    backgroundColor: color.surface.primary,
    paddingHorizontal: 10,
    paddingVertical: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8
  },
  input: {
    flex: 1,
    minHeight: 38,
    maxHeight: 110,
    borderRadius: 11,
    borderWidth: 1,
    borderColor: color.border.subtle,
    backgroundColor: color.surface.secondary,
    paddingHorizontal: 10,
    paddingVertical: 8,
    color: color.text.primary,
    fontFamily: fonts.Regular,
    fontSize: typography.caption.size,
    lineHeight: typography.caption.lineHeight
  },
  sendButton: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: color.accent.primary
  },
  sendButtonDisabled: {
    opacity: 0.4
  },
  scrollBody: {
    padding: 10,
    gap: 8
  },
  ticketCard: {
    borderRadius: 14,
    borderWidth: 1,
    borderColor: color.border.subtle,
    backgroundColor: color.surface.secondary,
    paddingHorizontal: 11,
    paddingVertical: 10,
    gap: 6
  },
  ticketHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between'
  },
  ticketTitle: {
    flex: 1,
    marginRight: 8,
    color: color.text.primary,
    fontFamily: fonts.SemiBold,
    fontSize: typography.caption.size,
    lineHeight: typography.caption.lineHeight
  },
  ticketStatusBadge: {
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 3,
    backgroundColor: 'rgba(17,98,41,0.14)',
    borderWidth: 1,
    borderColor: 'rgba(17,98,41,0.28)'
  },
  ticketStatusText: {
    color: '#116229',
    fontFamily: fonts.SemiBold,
    fontSize: typography.micro.size,
    lineHeight: typography.micro.lineHeight
  },
  ticketDescription: {
    color: color.text.secondary,
    fontFamily: fonts.Regular,
    fontSize: typography.micro.size,
    lineHeight: typography.micro.lineHeight
  },
  ticketFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between'
  },
  ticketActionText: {
    color: color.text.primary,
    fontFamily: fonts.Medium,
    fontSize: typography.micro.size,
    lineHeight: typography.micro.lineHeight
  },
  faqCard: {
    borderRadius: 14,
    borderWidth: 1,
    borderColor: color.border.subtle,
    backgroundColor: color.surface.secondary,
    paddingHorizontal: 11,
    paddingVertical: 10
  },
  faqHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between'
  },
  faqQuestion: {
    flex: 1,
    marginRight: 8,
    color: color.text.primary,
    fontFamily: fonts.Medium,
    fontSize: typography.caption.size,
    lineHeight: typography.caption.lineHeight
  },
  faqAnswer: {
    marginTop: 6,
    color: color.text.secondary,
    fontFamily: fonts.Regular,
    fontSize: typography.micro.size,
    lineHeight: typography.micro.lineHeight
  },
  emptyStateCard: {
    minHeight: 180,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: color.border.subtle,
    backgroundColor: color.surface.secondary,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
    paddingVertical: 18,
    gap: 6
  },
  emptyStateTitle: {
    color: color.text.primary,
    fontFamily: fonts.SemiBold,
    fontSize: typography.caption.size,
    lineHeight: typography.caption.lineHeight
  },
  emptyStateSubtitle: {
    textAlign: 'center',
    color: color.text.secondary,
    fontFamily: fonts.Regular,
    fontSize: typography.micro.size,
    lineHeight: typography.micro.lineHeight
  },
  loadingWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8
  },
  loadingText: {
    color: color.text.secondary,
    fontFamily: fonts.Regular,
    fontSize: typography.caption.size,
    lineHeight: typography.caption.lineHeight
  }
});
