import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Alert,
  StatusBar,
  Platform,
  ActivityIndicator,
  FlatList,
  Image
} from 'react-native';
import { Icon } from 'react-native-elements';
import { useSelector } from 'react-redux';
import { api } from '../common-local';

const SupportScreen = ({ navigation, route }) => {
  const [selectedTab, setSelectedTab] = useState('chat');
  const [message, setMessage] = useState('');
  const [chatMessages, setChatMessages] = useState([]);
  const [isTyping, setIsTyping] = useState(false);
  const [tickets, setTickets] = useState([]);
  const [faqCategories, setFaqCategories] = useState([]);
  const [expandedFaq, setExpandedFaq] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  
  const auth = useSelector(state => state.auth);
  const currentUser = auth.profile;
  
  const chatRef = useRef(null);

  useEffect(() => {
    loadSupportData();
    connectChat();
  }, []);

  const loadSupportData = async () => {
    try {
      setIsLoading(true);
      
      // Carregar dados de suporte
      const [chatResponse, ticketsResponse, faqResponse] = await Promise.all([
        api.get(`/api/support/chat/${currentUser.id}`),
        api.get(`/api/support/tickets/${currentUser.id}`),
        api.get('/api/support/faq')
      ]);
      
      setChatMessages(chatResponse.data.messages || []);
      setTickets(ticketsResponse.data.tickets || []);
      setFaqCategories(faqResponse.data.categories || []);
      
    } catch (error) {
      console.error('Erro ao carregar dados de suporte:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const connectChat = () => {
    // Implementar WebSocket para chat em tempo real
    console.log('Conectando chat de suporte...');
  };

  const sendMessage = async () => {
    if (!message.trim()) return;
    
    try {
      const newMessage = {
        id: Date.now(),
        text: message,
        sender: 'user',
        timestamp: new Date().toISOString()
      };
      
      setChatMessages(prev => [...prev, newMessage]);
      setMessage('');
      
      // Simular resposta do suporte
      setTimeout(() => {
        const supportMessage = {
          id: Date.now() + 1,
          text: 'Obrigado pela sua mensagem! Nossa equipe está analisando e responderá em breve.',
          sender: 'support',
          timestamp: new Date().toISOString()
        };
        setChatMessages(prev => [...prev, supportMessage]);
      }, 2000);
      
    } catch (error) {
      console.error('Erro ao enviar mensagem:', error);
      Alert.alert('Erro', 'Não foi possível enviar a mensagem');
    }
  };

  const createTicket = () => {
    navigation.navigate('CreateTicketScreen');
  };

  const renderChat = () => (
    <View style={styles.chatContainer}>
      <View style={styles.chatHeader}>
        <View style={styles.supportInfo}>
          <View style={styles.avatarContainer}>
            <Icon name="support-agent" type="material" color="#fff" size={24} />
          </View>
          <View style={styles.supportDetails}>
            <Text style={styles.supportName}>Suporte Leaf</Text>
            <Text style={styles.supportStatus}>Online</Text>
          </View>
        </View>
        
        <TouchableOpacity
          style={styles.createTicketButton}
          onPress={createTicket}
        >
          <Icon name="add" type="material" color="#2E8B57" size={20} />
          <Text style={styles.createTicketText}>Novo Ticket</Text>
        </TouchableOpacity>
      </View>
      
      <FlatList
        ref={chatRef}
        data={chatMessages}
        keyExtractor={(item) => item.id.toString()}
        renderItem={({ item }) => (
          <View style={[
            styles.messageContainer,
            item.sender === 'user' ? styles.userMessage : styles.supportMessage
          ]}>
            <Text style={[
              styles.messageText,
              item.sender === 'user' ? styles.userMessageText : styles.supportMessageText
            ]}>
              {item.text}
            </Text>
            <Text style={styles.messageTime}>
              {new Date(item.timestamp).toLocaleTimeString('pt-BR', { 
                hour: '2-digit', 
                minute: '2-digit' 
              })}
            </Text>
          </View>
        )}
        style={styles.messagesList}
        onContentSizeChange={() => chatRef.current?.scrollToEnd()}
      />
      
      {isTyping && (
        <View style={styles.typingIndicator}>
          <Text style={styles.typingText}>Suporte está digitando...</Text>
        </View>
      )}
      
      <View style={styles.inputContainer}>
        <TextInput
          style={styles.messageInput}
          value={message}
          onChangeText={setMessage}
          placeholder="Digite sua mensagem..."
          multiline
          maxLength={500}
        />
        <TouchableOpacity
          style={[styles.sendButton, !message.trim() && styles.sendButtonDisabled]}
          onPress={sendMessage}
          disabled={!message.trim()}
        >
          <Icon name="send" type="material" color="#fff" size={20} />
        </TouchableOpacity>
      </View>
    </View>
  );

  const renderTickets = () => (
    <View style={styles.ticketsContainer}>
      <View style={styles.ticketsHeader}>
        <Text style={styles.sectionTitle}>Meus Tickets</Text>
        <TouchableOpacity
          style={styles.createTicketButton}
          onPress={createTicket}
        >
          <Icon name="add" type="material" color="#2E8B57" size={20} />
          <Text style={styles.createTicketText}>Novo</Text>
        </TouchableOpacity>
      </View>
      
      {tickets.length > 0 ? (
        <FlatList
          data={tickets}
          keyExtractor={(item) => item.id.toString()}
          renderItem={({ item }) => (
            <TouchableOpacity
              style={styles.ticketCard}
              onPress={() => navigation.navigate('TicketDetails', { ticket: item })}
            >
              <View style={styles.ticketHeader}>
                <Text style={styles.ticketTitle}>{item.title}</Text>
                <View style={[styles.statusBadge, { backgroundColor: getStatusColor(item.status) }]}>
                  <Text style={styles.statusText}>{item.status}</Text>
                </View>
              </View>
              
              <Text style={styles.ticketDescription} numberOfLines={2}>
                {item.description}
              </Text>
              
              <View style={styles.ticketFooter}>
                <Text style={styles.ticketDate}>
                  {new Date(item.created_at).toLocaleDateString('pt-BR')}
                </Text>
                <Text style={styles.ticketNumber}>#{item.ticket_number}</Text>
              </View>
            </TouchableOpacity>
          )}
        />
      ) : (
        <View style={styles.emptyState}>
          <Icon name="support-agent" type="material" color="#ccc" size={64} />
          <Text style={styles.emptyTitle}>Nenhum ticket encontrado</Text>
          <Text style={styles.emptySubtitle}>
            Crie um novo ticket para obter ajuda
          </Text>
          <TouchableOpacity
            style={styles.createTicketButton}
            onPress={createTicket}
          >
            <Text style={styles.createTicketButtonText}>Criar Ticket</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );

  const renderFAQ = () => (
    <View style={styles.faqContainer}>
      <Text style={styles.sectionTitle}>Perguntas Frequentes</Text>
      
      <FlatList
        data={faqCategories}
        keyExtractor={(item) => item.id.toString()}
        renderItem={({ item: category }) => (
          <View style={styles.faqCategory}>
            <Text style={styles.categoryTitle}>{category.title}</Text>
            
            {category.questions.map((question, index) => (
              <TouchableOpacity
                key={index}
                style={styles.faqItem}
                onPress={() => setExpandedFaq(expandedFaq === `${category.id}-${index}` ? null : `${category.id}-${index}`)}
              >
                <View style={styles.faqHeader}>
                  <Text style={styles.faqQuestion}>{question.question}</Text>
                  <Icon 
                    name={expandedFaq === `${category.id}-${index}` ? "expand-less" : "expand-more"} 
                    type="material" 
                    color="#7f8c8d" 
                    size={20} 
                  />
                </View>
                
                {expandedFaq === `${category.id}-${index}` && (
                  <Text style={styles.faqAnswer}>{question.answer}</Text>
                )}
              </TouchableOpacity>
            ))}
          </View>
        )}
      />
    </View>
  );

  const getStatusColor = (status) => {
    switch (status) {
      case 'open': return '#3498db';
      case 'in_progress': return '#f39c12';
      case 'resolved': return '#27ae60';
      case 'closed': return '#95a5a6';
      default: return '#7f8c8d';
    }
  };

  const renderTabs = () => (
    <View style={styles.tabsContainer}>
      <TouchableOpacity
        style={[styles.tab, selectedTab === 'chat' && styles.activeTab]}
        onPress={() => setSelectedTab('chat')}
      >
        <Icon name="chat" type="material" color={selectedTab === 'chat' ? '#2E8B57' : '#7f8c8d'} size={20} />
        <Text style={[styles.tabText, selectedTab === 'chat' && styles.activeTabText]}>
          Chat
        </Text>
      </TouchableOpacity>
      
      <TouchableOpacity
        style={[styles.tab, selectedTab === 'tickets' && styles.activeTab]}
        onPress={() => setSelectedTab('tickets')}
      >
        <Icon name="assignment" type="material" color={selectedTab === 'tickets' ? '#2E8B57' : '#7f8c8d'} size={20} />
        <Text style={[styles.tabText, selectedTab === 'tickets' && styles.activeTabText]}>
          Tickets
        </Text>
      </TouchableOpacity>
      
      <TouchableOpacity
        style={[styles.tab, selectedTab === 'faq' && styles.activeTab]}
        onPress={() => setSelectedTab('faq')}
      >
        <Icon name="help" type="material" color={selectedTab === 'faq' ? '#2E8B57' : '#7f8c8d'} size={20} />
        <Text style={[styles.tabText, selectedTab === 'faq' && styles.activeTabText]}>
          FAQ
        </Text>
      </TouchableOpacity>
    </View>
  );

  if (isLoading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#2E8B57" />
        <Text style={styles.loadingText}>Carregando suporte...</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor="#fff" />
      
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => navigation.goBack()}
        >
          <Icon name="arrow-back" type="material" color="#2c3e50" size={24} />
        </TouchableOpacity>
        
        <Text style={styles.headerTitle}>Suporte</Text>
        
        <TouchableOpacity
          style={styles.helpButton}
          onPress={() => navigation.navigate('HelpScreen')}
        >
          <Icon name="help-outline" type="material" color="#2c3e50" size={24} />
        </TouchableOpacity>
      </View>
      
      {renderTabs()}
      
      <View style={styles.content}>
        {selectedTab === 'chat' && renderChat()}
        {selectedTab === 'tickets' && renderTickets()}
        {selectedTab === 'faq' && renderFAQ()}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f8f9fa',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#f8f9fa',
  },
  loadingText: {
    marginTop: 16,
    fontSize: 16,
    color: '#7f8c8d',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: Platform.OS === 'ios' ? 50 : 20,
    paddingBottom: 20,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#e0e0e0',
  },
  backButton: {
    padding: 8,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#2c3e50',
  },
  helpButton: {
    padding: 8,
  },
  tabsContainer: {
    flexDirection: 'row',
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#e0e0e0',
  },
  tab: {
    flex: 1,
    paddingVertical: 16,
    alignItems: 'center',
  },
  activeTab: {
    borderBottomWidth: 2,
    borderBottomColor: '#2E8B57',
  },
  tabText: {
    fontSize: 12,
    color: '#7f8c8d',
    marginTop: 4,
  },
  activeTabText: {
    color: '#2E8B57',
    fontWeight: 'bold',
  },
  content: {
    flex: 1,
  },
  chatContainer: {
    flex: 1,
    backgroundColor: '#fff',
  },
  chatHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#e0e0e0',
  },
  supportInfo: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  avatarContainer: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#2E8B57',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  supportDetails: {
    flex: 1,
  },
  supportName: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#2c3e50',
  },
  supportStatus: {
    fontSize: 12,
    color: '#4CAF50',
  },
  createTicketButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: '#f8f9fa',
    borderRadius: 6,
  },
  createTicketText: {
    fontSize: 12,
    color: '#2E8B57',
    marginLeft: 4,
  },
  messagesList: {
    flex: 1,
    padding: 16,
  },
  messageContainer: {
    marginBottom: 12,
    maxWidth: '80%',
  },
  userMessage: {
    alignSelf: 'flex-end',
    backgroundColor: '#2E8B57',
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  supportMessage: {
    alignSelf: 'flex-start',
    backgroundColor: '#f8f9fa',
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  messageText: {
    fontSize: 14,
    marginBottom: 4,
  },
  userMessageText: {
    color: '#fff',
  },
  supportMessageText: {
    color: '#2c3e50',
  },
  messageTime: {
    fontSize: 10,
    color: '#7f8c8d',
    alignSelf: 'flex-end',
  },
  typingIndicator: {
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  typingText: {
    fontSize: 12,
    color: '#7f8c8d',
    fontStyle: 'italic',
  },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    borderTopWidth: 1,
    borderTopColor: '#e0e0e0',
  },
  messageInput: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#e0e0e0',
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 8,
    marginRight: 8,
    maxHeight: 100,
  },
  sendButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#2E8B57',
    justifyContent: 'center',
    alignItems: 'center',
  },
  sendButtonDisabled: {
    backgroundColor: '#ccc',
  },
  ticketsContainer: {
    flex: 1,
    padding: 16,
  },
  ticketsHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#2c3e50',
  },
  ticketCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
  },
  ticketHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  ticketTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#2c3e50',
    flex: 1,
  },
  statusBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
  },
  statusText: {
    fontSize: 10,
    color: '#fff',
    fontWeight: 'bold',
  },
  ticketDescription: {
    fontSize: 14,
    color: '#7f8c8d',
    marginBottom: 8,
  },
  ticketFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  ticketDate: {
    fontSize: 12,
    color: '#7f8c8d',
  },
  ticketNumber: {
    fontSize: 12,
    color: '#2E8B57',
    fontWeight: 'bold',
  },
  emptyState: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 60,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#7f8c8d',
    marginTop: 16,
    marginBottom: 8,
  },
  emptySubtitle: {
    fontSize: 14,
    color: '#95a5a6',
    textAlign: 'center',
    marginBottom: 20,
  },
  createTicketButtonText: {
    color: '#2E8B57',
    fontSize: 16,
    fontWeight: 'bold',
  },
  faqContainer: {
    flex: 1,
    padding: 16,
  },
  faqCategory: {
    marginBottom: 24,
  },
  categoryTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#2c3e50',
    marginBottom: 12,
  },
  faqItem: {
    backgroundColor: '#fff',
    borderRadius: 8,
    marginBottom: 8,
    elevation: 1,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
  },
  faqHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
  },
  faqQuestion: {
    fontSize: 14,
    color: '#2c3e50',
    flex: 1,
    marginRight: 8,
  },
  faqAnswer: {
    fontSize: 14,
    color: '#7f8c8d',
    lineHeight: 20,
    paddingHorizontal: 16,
    paddingBottom: 16,
  },
});

export default SupportScreen; 