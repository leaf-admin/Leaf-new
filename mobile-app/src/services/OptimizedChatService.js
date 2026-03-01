import Logger from '../utils/Logger';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { store } from '../common-local/store';


// Configurações do chat otimizado
const CHAT_CONFIG = {
  maxMessages: 100, // Máximo de mensagens por chat
  maxStorageSize: 50 * 1024 * 1024, // 50MB máximo de storage
  messageTTL: 30 * 24 * 60 * 60 * 1000, // 30 dias
  typingTimeout: 1000, // 1 segundo para indicador de digitação
  retryAttempts: 3, // Tentativas de reenvio
  retryDelay: 1000, // Delay entre tentativas
  batchSize: 20, // Tamanho do lote para carregamento
  cacheExpiry: 5 * 60 * 1000 // 5 minutos para cache
};

class OptimizedChatService {
  constructor() {
    this.messageCache = new Map();
    this.typingUsers = new Map();
    this.connectionStatus = 'disconnected';
    this.retryQueue = [];
    this.isInitialized = false;
    this.websocketManager = null;
  }

  // Inicializar o serviço
  async initialize(websocketManager) {
    try {
      this.websocketManager = websocketManager;
      
      // Configurar listeners do WebSocket
      this.setupWebSocketListeners();
      
      // Limpar cache antigo
      await this.cleanupOldCache();
      
      // Processar fila de retry
      this.processRetryQueue();
      
      this.isInitialized = true;
      Logger.log('✅ Chat Service inicializado com sucesso');
      
    } catch (error) {
      Logger.error('❌ Erro ao inicializar Chat Service:', error);
      throw error;
    }
  }

  // Configurar listeners do WebSocket
  setupWebSocketListeners() {
    if (!this.websocketManager) return;

    // Listener para novas mensagens
    this.websocketManager.on('new_message', this.handleNewMessage.bind(this));
    
    // Listener para indicador de digitação
    this.websocketManager.on('user_typing', this.handleUserTyping.bind(this));
    
    // Listener para status de conexão
    this.websocketManager.on('connect', () => {
      this.connectionStatus = 'connected';
      this.processRetryQueue();
    });
    
    this.websocketManager.on('disconnect', () => {
      this.connectionStatus = 'disconnected';
    });
  }

  // Criar ou buscar chat existente
  async createOrGetChat(chatData) {
    try {
      const { tripId, driverId, passengerId } = chatData;
      const chatId = `trip_${tripId}_${driverId}_${passengerId}`;
      
      // Verificar se chat já existe no cache
      if (this.messageCache.has(chatId)) {
        return { chatId, exists: true };
      }
      
      // Verificar se chat existe no backend
      const existingChat = await this.getChatFromBackend(chatId);
      
      if (existingChat) {
        // Carregar mensagens no cache
        await this.loadChatMessages(chatId);
        return { chatId, exists: true };
      }
      
      // Criar novo chat
      const newChat = {
        chatId,
        tripId,
        driverId,
        passengerId,
        status: 'active',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        messages: []
      };
      
      await this.createChatInBackend(newChat);
      await this.saveChatLocally(newChat);
      
      return { chatId, exists: false };
      
    } catch (error) {
      Logger.error('Erro ao criar/buscar chat:', error);
      throw error;
    }
  }

  // Enviar mensagem
  async sendMessage(messageData) {
    try {
      const { chatId, text, userId, timestamp } = messageData;
      
      // Criar objeto de mensagem
      const message = {
        _id: this.generateMessageId(),
        text,
        createdAt: new Date(timestamp),
        user: {
          _id: userId,
          name: await this.getUserName(userId),
          avatar: await this.getUserAvatar(userId)
        },
        status: 'sending',
        retryCount: 0
      };
      
      // Adicionar ao cache local
      this.addMessageToCache(chatId, message);
      
      // Enviar via WebSocket
      if (this.connectionStatus === 'connected') {
        await this.sendMessageViaWebSocket(chatId, message);
        message.status = 'sent';
      } else {
        // Adicionar à fila de retry
        this.addToRetryQueue(chatId, message);
        message.status = 'pending';
      }
      
      // Salvar localmente
      await this.saveMessageLocally(chatId, message);
      
      // Atualizar timestamp do chat
      await this.updateChatTimestamp(chatId);
      
      return message;
      
    } catch (error) {
      Logger.error('Erro ao enviar mensagem:', error);
      throw error;
    }
  }

  // Carregar mensagens do chat
  async loadChatMessages(chatId, page = 0, limit = CHAT_CONFIG.batchSize) {
    try {
      // Verificar cache primeiro
      if (this.messageCache.has(chatId)) {
        const cachedMessages = this.messageCache.get(chatId);
        const startIndex = page * limit;
        const endIndex = startIndex + limit;
        
        if (cachedMessages.length >= startIndex) {
          return cachedMessages.slice(startIndex, endIndex);
        }
      }
      
      // Carregar do backend
      const messages = await this.loadMessagesFromBackend(chatId, page, limit);
      
      // Adicionar ao cache
      if (page === 0) {
        this.messageCache.set(chatId, messages);
      } else {
        const existingMessages = this.messageCache.get(chatId) || [];
        this.messageCache.set(chatId, [...existingMessages, ...messages]);
      }
      
      // Salvar localmente
      await this.saveChatMessagesLocally(chatId, messages);
      
      return messages;
      
    } catch (error) {
      Logger.error('Erro ao carregar mensagens:', error);
      
      // Tentar carregar do storage local
      try {
        return await this.loadMessagesFromLocalStorage(chatId, page, limit);
      } catch (localError) {
        Logger.error('Erro ao carregar do storage local:', localError);
        return [];
      }
    }
  }

  // Marcar mensagens como lidas
  async markMessagesAsRead(chatId, userId) {
    try {
      const messages = this.messageCache.get(chatId) || [];
      const unreadMessages = messages.filter(msg => 
        msg.user._id !== userId && !msg.readBy?.includes(userId)
      );
      
      if (unreadMessages.length > 0) {
        // Atualizar status local
        unreadMessages.forEach(msg => {
          if (!msg.readBy) msg.readBy = [];
          if (!msg.readBy.includes(userId)) {
            msg.readBy.push(userId);
          }
        });
        
        // Salvar localmente
        await this.saveChatMessagesLocally(chatId, messages);
        
        // Notificar backend
        await this.notifyMessagesRead(chatId, unreadMessages.map(msg => msg._id));
      }
      
    } catch (error) {
      Logger.error('Erro ao marcar mensagens como lidas:', error);
    }
  }

  // Indicador de digitação
  async setTypingStatus(chatId, userId, isTyping) {
    try {
      if (isTyping) {
        this.typingUsers.set(`${chatId}_${userId}`, Date.now());
        
        // Enviar evento de digitação
        if (this.websocketManager) {
          await this.websocketManager.emit('typing_start', { chatId, userId });
        }
        
        // Limpar timeout automaticamente
        setTimeout(() => {
          this.clearTypingStatus(chatId, userId);
        }, CHAT_CONFIG.typingTimeout);
        
      } else {
        this.clearTypingStatus(chatId, userId);
      }
      
    } catch (error) {
      Logger.error('Erro ao definir status de digitação:', error);
    }
  }

  // Limpar status de digitação
  clearTypingStatus(chatId, userId) {
    this.typingUsers.delete(`${chatId}_${userId}`);
    
    if (this.websocketManager) {
      this.websocketManager.emit('typing_stop', { chatId, userId });
    }
  }

  // Verificar se usuário está digitando
  isUserTyping(chatId, userId) {
    return this.typingUsers.has(`${chatId}_${userId}`);
  }

  // Obter usuários digitando
  getTypingUsers(chatId) {
    const typingUsers = [];
    
    for (const [key, timestamp] of this.typingUsers.entries()) {
      if (key.startsWith(chatId + '_')) {
        const userId = key.split('_')[1];
        const timeSinceTyping = Date.now() - timestamp;
        
        if (timeSinceTyping < CHAT_CONFIG.typingTimeout) {
          typingUsers.push(userId);
        } else {
          // Remover usuário que parou de digitar
          this.typingUsers.delete(key);
        }
      }
    }
    
    return typingUsers;
  }

  // Processar fila de retry
  async processRetryQueue() {
    if (this.retryQueue.length === 0 || this.connectionStatus !== 'connected') {
      return;
    }
    
    Logger.log(`🔄 Processando ${this.retryQueue.length} mensagens na fila de retry`);
    
    for (const queuedMessage of this.retryQueue) {
      try {
        await this.sendMessageViaWebSocket(queuedMessage.chatId, queuedMessage.message);
        
        // Atualizar status da mensagem
        queuedMessage.message.status = 'sent';
        await this.saveMessageLocally(queuedMessage.chatId, queuedMessage.message);
        
        // Remover da fila
        const index = this.retryQueue.findIndex(item => 
          item.chatId === queuedMessage.chatId && 
          item.message._id === queuedMessage.message._id
        );
        
        if (index > -1) {
          this.retryQueue.splice(index, 1);
        }
        
      } catch (error) {
        Logger.error('Erro ao processar mensagem da fila de retry:', error);
        
        // Incrementar contador de tentativas
        queuedMessage.message.retryCount++;
        
        if (queuedMessage.message.retryCount >= CHAT_CONFIG.retryAttempts) {
          queuedMessage.message.status = 'failed';
          await this.saveMessageLocally(queuedMessage.chatId, queuedMessage.message);
          
          // Remover da fila
          const index = this.retryQueue.findIndex(item => 
            item.chatId === queuedMessage.chatId && 
            item.message._id === queuedMessage.message._id
          );
          
          if (index > -1) {
            this.retryQueue.splice(index, 1);
          }
        }
      }
      
      // Delay entre tentativas
      await new Promise(resolve => setTimeout(resolve, CHAT_CONFIG.retryDelay));
    }
  }

  // Adicionar à fila de retry
  addToRetryQueue(chatId, message) {
    this.retryQueue.push({ chatId, message });
    Logger.log(`📝 Mensagem adicionada à fila de retry: ${message._id}`);
  }

  // Handlers de eventos WebSocket
  handleNewMessage(data) {
    try {
      const { chatId, message } = data;
      
      // Adicionar ao cache
      this.addMessageToCache(chatId, message);
      
      // Salvar localmente
      this.saveMessageLocally(chatId, message);
      
      // Notificar componentes
      this.notifyMessageReceived(chatId, message);
      
    } catch (error) {
      Logger.error('Erro ao processar nova mensagem:', error);
    }
  }

  handleUserTyping(data) {
    try {
      const { chatId, userId, isTyping } = data;
      
      if (isTyping) {
        this.typingUsers.set(`${chatId}_${userId}`, Date.now());
      } else {
        this.typingUsers.delete(`${chatId}_${userId}`);
      }
      
      // Notificar componentes
      this.notifyTypingStatusChanged(chatId, userId, isTyping);
      
    } catch (error) {
      Logger.error('Erro ao processar status de digitação:', error);
    }
  }

  // Métodos auxiliares
  generateMessageId() {
    return `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  addMessageToCache(chatId, message) {
    if (!this.messageCache.has(chatId)) {
      this.messageCache.set(chatId, []);
    }
    
    const messages = this.messageCache.get(chatId);
    messages.push(message);
    
    // Manter limite de mensagens no cache
    if (messages.length > CHAT_CONFIG.maxMessages) {
      messages.splice(0, messages.length - CHAT_CONFIG.maxMessages);
    }
  }

  async getUserName(userId) {
    // Implementar busca do nome do usuário
    // Pode vir do Redux store ou API
    return 'Usuário';
  }

  async getUserAvatar(userId) {
    // Implementar busca do avatar do usuário
    // Pode vir do Redux store ou API
    return null;
  }

  // Métodos de comunicação com backend (implementar conforme necessário)
  async sendMessageViaWebSocket(chatId, message) {
    if (this.websocketManager) {
      await this.websocketManager.emit('send_message', { chatId, message });
    }
  }

  async getChatFromBackend(chatId) {
    // Implementar busca no backend
    return null;
  }

  async createChatInBackend(chatData) {
    // Implementar criação no backend
    return null;
  }

  async loadMessagesFromBackend(chatId, page, limit) {
    // Implementar carregamento do backend
    return [];
  }

  async notifyMessagesRead(chatId, messageIds) {
    if (this.websocketManager) {
      await this.websocketManager.emit('messages_read', { chatId, messageIds });
    }
  }

  // Métodos de storage local
  async saveChatLocally(chatData) {
    try {
      const key = `chat_${chatData.chatId}`;
      await AsyncStorage.setItem(key, JSON.stringify(chatData));
    } catch (error) {
      Logger.error('Erro ao salvar chat localmente:', error);
    }
  }

  async saveMessageLocally(chatId, message) {
    try {
      const key = `chat_messages_${chatId}`;
      const existingMessages = await this.getMessagesFromLocalStorage(chatId);
      
      existingMessages.push(message);
      
      // Manter limite de mensagens
      if (existingMessages.length > CHAT_CONFIG.maxMessages) {
        existingMessages.splice(0, existingMessages.length - CHAT_CONFIG.maxMessages);
      }
      
      await AsyncStorage.setItem(key, JSON.stringify(existingMessages));
      
    } catch (error) {
      Logger.error('Erro ao salvar mensagem localmente:', error);
    }
  }

  async saveChatMessagesLocally(chatId, messages) {
    try {
      const key = `chat_messages_${chatId}`;
      await AsyncStorage.setItem(key, JSON.stringify(messages));
    } catch (error) {
      Logger.error('Erro ao salvar mensagens localmente:', error);
    }
  }

  async getMessagesFromLocalStorage(chatId) {
    try {
      const key = `chat_messages_${chatId}`;
      const data = await AsyncStorage.getItem(key);
      return data ? JSON.parse(data) : [];
    } catch (error) {
      Logger.error('Erro ao buscar mensagens do storage local:', error);
      return [];
    }
  }

  async loadMessagesFromLocalStorage(chatId, page, limit) {
    try {
      const messages = await this.getMessagesFromLocalStorage(chatId);
      const startIndex = page * limit;
      const endIndex = startIndex + limit;
      
      return messages.slice(startIndex, endIndex);
    } catch (error) {
      Logger.error('Erro ao carregar mensagens do storage local:', error);
      return [];
    }
  }

  async updateChatTimestamp(chatId) {
    try {
      const key = `chat_${chatId}`;
      const chatData = await AsyncStorage.getItem(key);
      
      if (chatData) {
        const chat = JSON.parse(chatData);
        chat.updatedAt = new Date().toISOString();
        await AsyncStorage.setItem(key, JSON.stringify(chat));
      }
    } catch (error) {
      Logger.error('Erro ao atualizar timestamp do chat:', error);
    }
  }

  // Limpeza de cache
  async cleanupOldCache() {
    try {
      const now = Date.now();
      
      // Limpar mensagens antigas do cache
      for (const [chatId, messages] of this.messageCache.entries()) {
        const recentMessages = messages.filter(msg => 
          now - msg.createdAt.getTime() < CHAT_CONFIG.messageTTL
        );
        
        if (recentMessages.length !== messages.length) {
          this.messageCache.set(chatId, recentMessages);
        }
      }
      
      // Limpar usuários digitando antigos
      for (const [key, timestamp] of this.typingUsers.entries()) {
        if (now - timestamp > CHAT_CONFIG.typingTimeout) {
          this.typingUsers.delete(key);
        }
      }
      
      Logger.log('🧹 Cache limpo com sucesso');
      
    } catch (error) {
      Logger.error('Erro ao limpar cache:', error);
    }
  }

  // Notificações para componentes
  notifyMessageReceived(chatId, message) {
    // Implementar sistema de notificações
    // Pode usar EventEmitter ou Redux
  }

  notifyTypingStatusChanged(chatId, userId, isTyping) {
    // Implementar sistema de notificações
    // Pode usar EventEmitter ou Redux
  }

  // Destruir serviço
  destroy() {
    this.messageCache.clear();
    this.typingUsers.clear();
    this.retryQueue = [];
    this.isInitialized = false;
    Logger.log('🗑️ Chat Service destruído');
  }
}

export default new OptimizedChatService();
