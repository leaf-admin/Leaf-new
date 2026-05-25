import Logger from '../utils/Logger';
import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Alert,
  ActivityIndicator,
  StatusBar,
  Platform,
  Modal,
  FlatList
} from 'react-native';
import { Icon } from 'react-native-elements';
import { useSelector } from 'react-redux';
import { GiftedChat, Bubble, InputToolbar, Composer, Send } from 'react-native-gifted-chat';
import SupportTicketService from '../services/SupportTicketService';
import AuthService from '../services/AuthService';
import { fonts } from '../theme/runtimeTokens';
import { SkeletonLoader, LoadingSpinner } from '../components/LoadingStates';
import { useResponsiveLayout } from '../components/ResponsiveLayout';
import robotaxiPrototypeTokens from '../components/design-system/robotaxiPrototypeTokens';

const { color, typography } = robotaxiPrototypeTokens;

const SupportTicketScreen = ({ navigation, route }) => {
  const [tickets, setTickets] = useState([]);
  const [selectedTicket, setSelectedTicket] = useState(null);
  const [messages, setMessages] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isCreatingTicket, setIsCreatingTicket] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showTicketModal, setShowTicketModal] = useState(false);
  const hasAutoOpenedTicketRef = useRef(false);
  
  // Loading states adicionais
  const [isLoadingTickets, setIsLoadingTickets] = useState(false);
  const [isLoadingMessages, setIsLoadingMessages] = useState(false);
  const [isSendingMessage, setIsSendingMessage] = useState(false);
  
  const auth = useSelector(state => state.auth);
  const currentUser = auth.profile;
  
  // Responsive layout hook
  const { config: responsiveConfig, isTablet, isMobile } = useResponsiveLayout();

  // Estados para criação de ticket
  const [newTicket, setNewTicket] = useState({
    subject: '',
    description: '',
    category: 'general',
    priority: 'N3'
  });

  const categories = [
    { id: 'technical', label: 'Problema Técnico', icon: 'bug' },
    { id: 'payment', label: 'Pagamento', icon: 'credit-card' },
    { id: 'account', label: 'Conta', icon: 'user' },
    { id: 'general', label: 'Geral', icon: 'help-circle' }
  ];

  const priorities = [
    { id: 'N3', label: 'Normal', color: '#4CAF50' },
    { id: 'N2', label: 'Alto', color: '#FF9800' },
    { id: 'N1', label: 'Crítico', color: '#F44336' }
  ];

  useEffect(() => {
    loadUserTickets();
  }, []);

  useEffect(() => {
    if (hasAutoOpenedTicketRef.current) return;

    const paramTicket = route?.params?.ticket;
    const paramTicketId = route?.params?.ticketId || paramTicket?.id;
    if (!paramTicketId) return;
    if (!tickets.length && !paramTicket) return;

    const ticketToOpen = tickets.find((ticket) => ticket.id === paramTicketId) || paramTicket;
    if (!ticketToOpen) return;

    hasAutoOpenedTicketRef.current = true;
    openTicket(ticketToOpen);
  }, [tickets, route?.params?.ticket, route?.params?.ticketId]);

  const loadUserTickets = async () => {
    try {
      setIsLoading(true);
      
      // Verificar se usuário está autenticado
      const isAuthenticated = await AuthService.isAuthenticated();
      if (!isAuthenticated) {
        Alert.alert('Erro', 'Sessão expirada. Faça login novamente.');
        navigation.navigate('PhoneInputScreen');
        return;
      }
      
      const userTickets = await SupportTicketService.getUserTickets();
      setTickets(userTickets);
    } catch (error) {
      Logger.error('Erro ao carregar tickets:', error);
      Alert.alert('Erro', 'Não foi possível carregar seus tickets');
    } finally {
      setIsLoading(false);
    }
  };

  const createTicket = async () => {
    if (!newTicket.subject.trim() || !newTicket.description.trim()) {
      Alert.alert('Atenção', 'Por favor, preencha todos os campos obrigatórios');
      return;
    }

    try {
      setIsCreatingTicket(true);
      
      // Verificar se usuário está autenticado
      const isAuthenticated = await AuthService.isAuthenticated();
      if (!isAuthenticated) {
        Alert.alert('Erro', 'Sessão expirada. Faça login novamente.');
        return;
      }
      
      const ticketData = {
        subject: newTicket.subject,
        description: newTicket.description,
        category: newTicket.category,
        priority: newTicket.priority,
        appVersion: '1.0.0' // Obter da versão real do app
      };

      const ticket = await SupportTicketService.createTicket(ticketData);
      
      setTickets(prev => [ticket, ...prev]);
      setShowCreateModal(false);
      setNewTicket({ subject: '', description: '', category: 'general', priority: 'N3' });
      
      Alert.alert('Sucesso', 'Ticket criado com sucesso! Você receberá uma resposta em breve.');
      
    } catch (error) {
      Logger.error('Erro ao criar ticket:', error);
      Alert.alert('Erro', 'Não foi possível criar o ticket');
    } finally {
      setIsCreatingTicket(false);
    }
  };

  const openTicket = async (ticket) => {
    try {
      setSelectedTicket(ticket);
      setShowTicketModal(true);
      
      const ticketMessages = await SupportTicketService.getTicketMessages(ticket.id);
      
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
      Logger.error('Erro ao abrir ticket:', error);
      Alert.alert('Erro', 'Não foi possível carregar as mensagens do ticket');
    }
  };

  const sendMessage = async (newMessages = []) => {
    if (!selectedTicket) return;

    try {
      const message = newMessages[0];
      
      await SupportTicketService.addMessage(selectedTicket.id, {
        message: message.text,
        messageType: 'text'
      });

      // Atualizar lista de mensagens localmente
      setMessages(prev => GiftedChat.append(prev, newMessages));
      
    } catch (error) {
      Logger.error('Erro ao enviar mensagem:', error);
      Alert.alert('Erro', 'Não foi possível enviar a mensagem');
    }
  };

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

  const getPriorityColor = (priority) => {
    const colors = {
      N1: '#F44336',
      N2: '#FF9800',
      N3: '#4CAF50'
    };
    return colors[priority] || '#4CAF50';
  };

  const formatDate = (dateString) => {
    const date = new Date(dateString);
    return date.toLocaleDateString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const renderTicket = ({ item: ticket }) => (
    <TouchableOpacity
      style={styles.ticketCard}
      onPress={() => openTicket(ticket)}
      testID={`support-ticket-detail-card-${ticket.id}`}
      accessibilityLabel={`support-ticket-detail-card-${ticket.id}`}
    >
      <View style={styles.ticketHeader}>
        <Text style={styles.ticketSubject} numberOfLines={1}>
          {ticket.subject}
        </Text>
        <View style={styles.ticketBadges}>
          <View style={[styles.priorityBadge, { backgroundColor: getPriorityColor(ticket.priority) }]}>
            <Text style={styles.priorityText}>{ticket.priority}</Text>
          </View>
          <View style={[styles.statusBadge, { backgroundColor: getStatusColor(ticket.status) }]}>
            <Text style={styles.statusText}>{getStatusLabel(ticket.status)}</Text>
          </View>
        </View>
      </View>
      
      <Text style={styles.ticketDescription} numberOfLines={2}>
        {ticket.description}
      </Text>
      
      <View style={styles.ticketFooter}>
        <Text style={styles.ticketCategory}>
          {categories.find(c => c.id === ticket.category)?.label || ticket.category}
        </Text>
        <Text style={styles.ticketDate}>
          {formatDate(ticket.createdAt)}
        </Text>
      </View>
    </TouchableOpacity>
  );

  const renderCreateModal = () => (
    <Modal
      visible={showCreateModal}
      animationType="slide"
      presentationStyle="pageSheet"
    >
      <View style={styles.modalContainer}>
        <View style={styles.modalHeader}>
          <TouchableOpacity
            onPress={() => setShowCreateModal(false)}
            testID="support-ticket-create-close-button"
            accessibilityLabel="support-ticket-create-close-button"
          >
            <Icon name="close" size={24} color={color.text.primary} />
          </TouchableOpacity>
          <Text style={styles.modalTitle}>Novo Ticket</Text>
          <TouchableOpacity
            onPress={createTicket}
            disabled={isCreatingTicket}
            style={styles.saveButton}
            testID="support-ticket-create-submit-button"
            accessibilityLabel="support-ticket-create-submit-button"
          >
            {isCreatingTicket ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <Text style={styles.saveButtonText}>Criar</Text>
            )}
          </TouchableOpacity>
        </View>

        <ScrollView style={styles.modalContent}>
          <View style={styles.inputGroup}>
            <Text style={styles.inputLabel}>Assunto *</Text>
            <TextInput
              style={styles.textInput}
              value={newTicket.subject}
              onChangeText={(text) => setNewTicket(prev => ({ ...prev, subject: text }))}
              placeholder="Descreva brevemente o problema"
              maxLength={100}
              testID="support-ticket-subject-input"
              accessibilityLabel="support-ticket-subject-input"
            />
          </View>

          <View style={styles.inputGroup}>
            <Text style={styles.inputLabel}>Categoria</Text>
            <View style={styles.categoryGrid}>
              {categories.map(category => (
                <TouchableOpacity
                  key={category.id}
                  style={[
                    styles.categoryButton,
                    newTicket.category === category.id && styles.categoryButtonSelected
                  ]}
                  onPress={() => setNewTicket(prev => ({ ...prev, category: category.id }))}
                  testID={`support-ticket-category-${category.id}`}
                  accessibilityLabel={`support-ticket-category-${category.id}`}
                >
                  <Icon name={category.icon} size={20} color={newTicket.category === category.id ? '#fff' : color.accent.primary} />
                  <Text style={[
                    styles.categoryButtonText,
                    newTicket.category === category.id && styles.categoryButtonTextSelected
                  ]}>
                    {category.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          <View style={styles.inputGroup}>
            <Text style={styles.inputLabel}>Prioridade</Text>
            <View style={styles.priorityContainer}>
              {priorities.map(priority => (
                <TouchableOpacity
                  key={priority.id}
                  style={[
                    styles.priorityButton,
                    { borderColor: priority.color },
                    newTicket.priority === priority.id && { backgroundColor: priority.color }
                  ]}
                  onPress={() => setNewTicket(prev => ({ ...prev, priority: priority.id }))}
                  testID={`support-ticket-priority-${priority.id}`}
                  accessibilityLabel={`support-ticket-priority-${priority.id}`}
                >
                  <Text style={[
                    styles.priorityButtonText,
                    { color: newTicket.priority === priority.id ? '#fff' : priority.color }
                  ]}>
                    {priority.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          <View style={styles.inputGroup}>
            <Text style={styles.inputLabel}>Descrição *</Text>
            <TextInput
              style={[styles.textInput, styles.textArea]}
              value={newTicket.description}
              onChangeText={(text) => setNewTicket(prev => ({ ...prev, description: text }))}
              placeholder="Descreva detalhadamente o problema ou dúvida"
              multiline
              numberOfLines={6}
              textAlignVertical="top"
              testID="support-ticket-description-input"
              accessibilityLabel="support-ticket-description-input"
            />
          </View>
        </ScrollView>
      </View>
    </Modal>
  );

  const renderTicketModal = () => (
    <Modal
      visible={showTicketModal}
      animationType="slide"
      presentationStyle="pageSheet"
    >
      <View style={styles.modalContainer}>
        <View style={styles.modalHeader}>
          <TouchableOpacity
            onPress={() => setShowTicketModal(false)}
            testID="support-ticket-chat-close-button"
            accessibilityLabel="support-ticket-chat-close-button"
          >
            <Icon name="close" size={24} color={color.text.primary} />
          </TouchableOpacity>
          <Text style={styles.modalTitle} numberOfLines={1}>
            {selectedTicket?.subject}
          </Text>
          <View style={styles.ticketInfo}>
            <View style={[styles.priorityBadge, { backgroundColor: getPriorityColor(selectedTicket?.priority) }]}>
              <Text style={styles.priorityText}>{selectedTicket?.priority}</Text>
            </View>
          </View>
        </View>

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
                    backgroundColor: color.accent.primary
                  },
                  left: {
                    backgroundColor: color.surface.secondary
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
          />
        </View>
      </View>
    </Modal>
  );

  if (isLoading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={color.accent.primary} />
        <Text style={styles.loadingText}>Carregando tickets...</Text>
      </View>
    );
  }

  return (
    <View
      style={styles.container}
      testID="support-ticket-screen"
      accessibilityLabel="support-ticket-screen"
    >
      <StatusBar barStyle="dark-content" backgroundColor="transparent" translucent={Platform.OS === 'android'} />
      
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.headerButton}
          onPress={() => navigation.goBack()}
          testID="support-ticket-back-button"
          accessibilityLabel="support-ticket-back-button"
        >
          <Icon name="arrow-back" size={18} color={color.text.primary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Suporte</Text>
        <TouchableOpacity
          style={styles.headerButton}
          onPress={() => setShowCreateModal(true)}
          testID="support-ticket-open-create-button"
          accessibilityLabel="support-ticket-open-create-button"
        >
          <Icon name="add" size={18} color={color.text.primary} />
        </TouchableOpacity>
      </View>

      {isLoading ? (
        <View style={styles.skeletonContainer}>
          <LoadingSpinner 
            message="Carregando tickets de suporte..." 
            color={color.accent.primary} 
          />
          <SkeletonLoader width="100%" height={80} style={styles.skeletonTicket} />
          <SkeletonLoader width="100%" height={80} style={styles.skeletonTicket} />
          <SkeletonLoader width="100%" height={80} style={styles.skeletonTicket} />
          <SkeletonLoader width="100%" height={80} style={styles.skeletonTicket} />
        </View>
      ) : tickets.length === 0 ? (
        <View style={styles.emptyContainer}>
          <Icon name="help-circle" size={64} color="#ccc" />
          <Text style={styles.emptyTitle}>Nenhum ticket encontrado</Text>
          <Text style={styles.emptyDescription}>
            Você ainda não criou nenhum ticket de suporte
          </Text>
          <TouchableOpacity
            style={styles.createButton}
            onPress={() => setShowCreateModal(true)}
            testID="support-ticket-empty-create-button"
            accessibilityLabel="support-ticket-empty-create-button"
          >
            <Text style={styles.createButtonText}>Criar Primeiro Ticket</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          data={tickets}
          renderItem={renderTicket}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.ticketsList}
          showsVerticalScrollIndicator={false}
        />
      )}

      {renderCreateModal()}
      {renderTicketModal()}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: color.bg.app
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: color.bg.app
  },
  loadingText: {
    marginTop: 10,
    fontFamily: fonts.Regular,
    fontSize: typography.caption.size,
    lineHeight: typography.caption.lineHeight,
    color: color.text.secondary
  },
  skeletonContainer: {
    flex: 1,
    padding: 16,
  },
  skeletonTicket: {
    marginBottom: 12,
    borderRadius: 8,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingTop: Platform.OS === 'ios' ? 54 : 34,
    paddingBottom: 10,
    backgroundColor: color.bg.app,
    borderBottomWidth: 1,
    borderBottomColor: color.border.subtle
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
    fontSize: typography.subtitle.size,
    lineHeight: typography.subtitle.lineHeight,
    color: color.text.primary,
    fontFamily: fonts.SemiBold
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 32
  },
  emptyTitle: {
    fontSize: 20,
    fontWeight: '600',
    color: '#333',
    marginTop: 16,
    marginBottom: 8
  },
  emptyDescription: {
    fontSize: 16,
    color: '#666',
    textAlign: 'center',
    marginBottom: 24
  },
  createButton: {
    backgroundColor: color.accent.primary,
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 12
  },
  createButtonText: {
    color: '#fff',
    fontSize: typography.caption.size,
    lineHeight: typography.caption.lineHeight,
    fontFamily: fonts.SemiBold
  },
  ticketsList: {
    padding: 14
  },
  ticketCard: {
    backgroundColor: color.surface.primary,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: color.border.subtle,
    padding: 12,
    marginBottom: 10
  },
  ticketHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 8
  },
  ticketSubject: {
    fontSize: typography.body.size,
    lineHeight: typography.body.lineHeight,
    color: color.text.primary,
    fontFamily: fonts.SemiBold,
    flex: 1,
    marginRight: 8
  },
  ticketBadges: {
    flexDirection: 'row',
    gap: 8
  },
  priorityBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999
  },
  priorityText: {
    color: '#fff',
    fontSize: typography.micro.size,
    lineHeight: typography.micro.lineHeight,
    fontFamily: fonts.SemiBold
  },
  statusBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999
  },
  statusText: {
    color: '#fff',
    fontSize: typography.micro.size,
    lineHeight: typography.micro.lineHeight,
    fontFamily: fonts.SemiBold
  },
  ticketDescription: {
    fontSize: typography.caption.size,
    lineHeight: typography.caption.lineHeight,
    color: color.text.secondary,
    fontFamily: fonts.Regular,
    marginBottom: 12,
    minHeight: 34
  },
  ticketFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center'
  },
  ticketCategory: {
    fontSize: typography.micro.size,
    lineHeight: typography.micro.lineHeight,
    color: color.text.primary,
    fontFamily: fonts.Medium
  },
  ticketDate: {
    fontSize: typography.micro.size,
    lineHeight: typography.micro.lineHeight,
    color: color.text.muted,
    fontFamily: fonts.Regular
  },
  modalContainer: {
    flex: 1,
    backgroundColor: color.bg.app
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 10,
    paddingTop: Platform.OS === 'ios' ? 18 : 10,
    borderBottomWidth: 1,
    borderBottomColor: color.border.subtle
  },
  modalTitle: {
    fontSize: typography.subtitle.size,
    lineHeight: typography.subtitle.lineHeight,
    color: color.text.primary,
    fontFamily: fonts.SemiBold,
    flex: 1,
    marginHorizontal: 16
  },
  saveButton: {
    backgroundColor: color.accent.primary,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 10
  },
  saveButtonText: {
    color: '#fff',
    fontSize: typography.micro.size,
    lineHeight: typography.micro.lineHeight,
    fontFamily: fonts.SemiBold
  },
  modalContent: {
    flex: 1,
    padding: 16
  },
  inputGroup: {
    marginBottom: 20
  },
  inputLabel: {
    fontSize: typography.caption.size,
    lineHeight: typography.caption.lineHeight,
    color: color.text.primary,
    fontFamily: fonts.SemiBold,
    marginBottom: 8
  },
  textInput: {
    borderWidth: 1,
    borderColor: color.border.subtle,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 12,
    fontSize: typography.caption.size,
    lineHeight: typography.caption.lineHeight,
    fontFamily: fonts.Regular,
    backgroundColor: color.surface.primary,
    color: color.text.primary
  },
  textArea: {
    height: 120,
    textAlignVertical: 'top'
  },
  categoryGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8
  },
  categoryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: color.border.strong,
    backgroundColor: color.surface.primary
  },
  categoryButtonSelected: {
    backgroundColor: color.accent.primary,
    borderColor: color.accent.primary
  },
  categoryButtonText: {
    marginLeft: 6,
    fontSize: 12,
    color: color.text.primary,
    fontFamily: fonts.Medium
  },
  categoryButtonTextSelected: {
    color: '#fff'
  },
  priorityContainer: {
    flexDirection: 'row',
    gap: 8
  },
  priorityButton: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
    backgroundColor: color.surface.primary
  },
  priorityButtonText: {
    fontSize: 12,
    fontFamily: fonts.SemiBold
  },
  ticketInfo: {
    flexDirection: 'row',
    alignItems: 'center'
  },
  chatContainer: {
    flex: 1
  },
  inputToolbar: {
    backgroundColor: color.surface.primary,
    borderTopWidth: 1,
    borderTopColor: color.border.subtle
  },
  composerText: {
    fontSize: typography.caption.size,
    lineHeight: typography.caption.lineHeight,
    fontFamily: fonts.Regular,
    color: color.text.primary
  },
  sendButton: {
    backgroundColor: color.accent.primary,
    borderRadius: 17,
    width: 34,
    height: 34,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 8,
    marginBottom: 8
  }
});

export default SupportTicketScreen;
