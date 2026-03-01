import Logger from '../utils/Logger';
import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  StatusBar,
  Platform,
  Alert,
  ActivityIndicator,
  TouchableOpacity
} from 'react-native';
import { GiftedChat, Bubble, InputToolbar, Composer, Send } from 'react-native-gifted-chat';
import { Icon } from 'react-native-elements';
import { useSelector } from 'react-redux';
import SupportTicketService from '../services/SupportTicketService';
import AuthService from '../services/AuthService';
import { colors } from '../common-local/theme';


const SupportChatScreen = ({ navigation, route }) => {
  const { ticketId } = route.params || {};
  const [ticket, setTicket] = useState(null);
  const [messages, setMessages] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isTyping, setIsTyping] = useState(false);
  
  const auth = useSelector(state => state.auth);
  const currentUser = auth.profile;

  useEffect(() => {
    if (ticketId) {
      loadTicketAndMessages();
    }
  }, [ticketId]);

  const loadTicketAndMessages = async () => {
    try {
      setIsLoading(true);
      
      // Verificar se usuário está autenticado
      const isAuthenticated = await AuthService.isAuthenticated();
      if (!isAuthenticated) {
        Alert.alert('Erro', 'Sessão expirada. Faça login novamente.');
        navigation.navigate('Login');
        return;
      }
      
      // Carregar ticket
      const userTickets = await SupportTicketService.getUserTickets();
      const foundTicket = userTickets.find(t => t.id === ticketId);
      
      if (!foundTicket) {
        Alert.alert('Erro', 'Ticket não encontrado');
        navigation.goBack();
        return;
      }
      
      setTicket(foundTicket);
      
      // Carregar mensagens
      const ticketMessages = await SupportTicketService.getTicketMessages(ticketId);
      
      // Converter para formato do GiftedChat
      const formattedMessages = ticketMessages.map(msg => ({
        _id: msg.id,
        text: msg.message,
        createdAt: new Date(msg.createdAt),
        user: {
          _id: msg.senderId,
          name: msg.senderType === 'user' ? 'Você' : 'Suporte',
          avatar: msg.senderType === 'user' ? null : 'https://via.placeholder.com/40'
        },
        system: msg.messageType === 'system'
      }));

      setMessages(formattedMessages);
      
    } catch (error) {
      Logger.error('Erro ao carregar ticket e mensagens:', error);
      Alert.alert('Erro', 'Não foi possível carregar o chat');
    } finally {
      setIsLoading(false);
    }
  };

  const sendMessage = useCallback(async (newMessages = []) => {
    if (!ticket) return;

    try {
      const message = newMessages[0];
      
      await SupportTicketService.addMessage(ticket.id, {
        message: message.text,
        messageType: 'text'
      });

      // Atualizar lista de mensagens localmente
      setMessages(prev => GiftedChat.append(prev, newMessages));
      
    } catch (error) {
      Logger.error('Erro ao enviar mensagem:', error);
      Alert.alert('Erro', 'Não foi possível enviar a mensagem');
    }
  }, [ticket]);

  const getStatusColor = (status) => {
    const colors = {
      open: '#FF9800',
      assigned: '#2196F3',
      in_progress: '#9C27B0',
      resolved: '#4CAF50',
      closed: '#9E9E9E',
      escalated: '#F44336'
    };
    return colors[status] || '#9E9E9E';
  };

  const getPriorityColor = (priority) => {
    const colors = {
      N1: '#F44336',
      N2: '#FF9800',
      N3: '#4CAF50'
    };
    return colors[priority] || '#4CAF50';
  };

  const getStatusLabel = (status) => {
    const labels = {
      open: 'Aberto',
      assigned: 'Atribuído',
      in_progress: 'Em Andamento',
      resolved: 'Resolvido',
      closed: 'Fechado',
      escalated: 'Escalado'
    };
    return labels[status] || status;
  };

  if (isLoading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={colors.primary} />
        <Text style={styles.loadingText}>Carregando chat...</Text>
      </View>
    );
  }

  if (!ticket) {
    return (
      <View style={styles.errorContainer}>
        <Icon name="error" size={64} color="#ccc" />
        <Text style={styles.errorTitle}>Ticket não encontrado</Text>
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => navigation.goBack()}
        >
          <Text style={styles.backButtonText}>Voltar</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor="#fff" />
      
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Icon name="arrow-back" size={24} color={colors.primary} />
        </TouchableOpacity>
        <View style={styles.headerInfo}>
          <Text style={styles.ticketId}>{ticket.id}</Text>
          <Text style={styles.ticketSubject} numberOfLines={1}>
            {ticket.subject}
          </Text>
        </View>
        <View style={styles.headerBadges}>
          <View style={[styles.priorityBadge, { backgroundColor: getPriorityColor(ticket.priority) }]}>
            <Text style={styles.priorityText}>{ticket.priority}</Text>
          </View>
          <View style={[styles.statusBadge, { backgroundColor: getStatusColor(ticket.status) }]}>
            <Text style={styles.statusText}>{getStatusLabel(ticket.status)}</Text>
          </View>
        </View>
      </View>

      {/* Chat */}
      <View style={styles.chatContainer}>
        <GiftedChat
          messages={messages}
          onSend={sendMessage}
          user={{
            _id: currentUser.uid,
            name: 'Você'
          }}
          renderBubble={(props) => (
            <Bubble
              {...props}
              wrapperStyle={{
                right: {
                  backgroundColor: colors.primary
                },
                left: {
                  backgroundColor: '#f0f0f0'
                }
              }}
              textStyle={{
                right: {
                  color: '#fff'
                },
                left: {
                  color: '#333'
                }
              }}
            />
          )}
          renderInputToolbar={(props) => (
            <InputToolbar
              {...props}
              containerStyle={styles.inputToolbar}
            />
          )}
          renderComposer={(props) => (
            <Composer
              {...props}
              textInputStyle={styles.composerText}
              placeholder="Digite sua mensagem..."
            />
          )}
          renderSend={(props) => (
            <Send {...props}>
              <View style={styles.sendButton}>
                <Icon name="send" size={20} color="#fff" />
              </View>
            </Send>
          )}
          renderSystemMessage={(props) => (
            <View style={styles.systemMessage}>
              <Text style={styles.systemMessageText}>{props.currentMessage.text}</Text>
            </View>
          )}
          renderTime={(props) => (
            <Text style={styles.timeText}>
              {new Date(props.currentMessage.createdAt).toLocaleTimeString('pt-BR', {
                hour: '2-digit',
                minute: '2-digit'
              })}
            </Text>
          )}
          renderAvatar={(props) => {
            if (props.currentMessage.system) return null;
            
            return (
              <View style={[
                styles.avatar,
                { backgroundColor: props.currentMessage.user._id === currentUser.uid ? colors.primary : '#ccc' }
              ]}>
                <Text style={styles.avatarText}>
                  {props.currentMessage.user.name.charAt(0)}
                </Text>
              </View>
            );
          }}
          showUserAvatar={true}
          showAvatarForEveryMessage={true}
          renderFooter={() => {
            if (isTyping) {
              return (
                <View style={styles.typingContainer}>
                  <Text style={styles.typingText}>Suporte está digitando...</Text>
                </View>
              );
            }
            return null;
          }}
        />
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff'
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#f5f5f5'
  },
  loadingText: {
    marginTop: 16,
    fontSize: 16,
    color: '#666'
  },
  errorContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#f5f5f5',
    paddingHorizontal: 32
  },
  errorTitle: {
    fontSize: 20,
    fontWeight: '600',
    color: '#333',
    marginTop: 16,
    marginBottom: 24
  },
  backButton: {
    backgroundColor: colors.primary,
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 8
  },
  backButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600'
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#e0e0e0',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3
  },
  headerInfo: {
    flex: 1,
    marginHorizontal: 12
  },
  ticketId: {
    fontSize: 16,
    fontWeight: '600',
    color: '#333'
  },
  ticketSubject: {
    fontSize: 14,
    color: '#666',
    marginTop: 2
  },
  headerBadges: {
    flexDirection: 'row',
    gap: 8
  },
  priorityBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12
  },
  priorityText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '600'
  },
  statusBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12
  },
  statusText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '600'
  },
  chatContainer: {
    flex: 1
  },
  inputToolbar: {
    backgroundColor: '#fff',
    borderTopWidth: 1,
    borderTopColor: '#e0e0e0',
    paddingHorizontal: 8,
    paddingVertical: 8
  },
  composerText: {
    fontSize: 16,
    color: '#333',
    lineHeight: 20
  },
  sendButton: {
    backgroundColor: colors.primary,
    borderRadius: 20,
    width: 40,
    height: 40,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 8,
    marginBottom: 8
  },
  systemMessage: {
    backgroundColor: '#f0f0f0',
    paddingHorizontal: 16,
    paddingVertical: 8,
    marginVertical: 8,
    marginHorizontal: 16,
    borderRadius: 8,
    alignItems: 'center'
  },
  systemMessageText: {
    fontSize: 14,
    color: '#666',
    fontStyle: 'italic'
  },
  timeText: {
    fontSize: 12,
    color: '#999',
    marginHorizontal: 8,
    marginVertical: 4
  },
  avatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center'
  },
  avatarText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600'
  },
  typingContainer: {
    paddingHorizontal: 16,
    paddingVertical: 8
  },
  typingText: {
    fontSize: 14,
    color: '#666',
    fontStyle: 'italic'
  }
});

export default SupportChatScreen;
