const Redis = require('ioredis');
const { logger } = require('../utils/logger');

// Configurações do chat
const CHAT_CONFIG = {
  maxMessages: 100, // Máximo de mensagens por chat
  messageTTL: 30 * 24 * 60 * 60, // 30 dias em segundos
  typingTimeout: 10, // 10 segundos para indicador de digitação
  maxChatsPerUser: 50, // Máximo de chats por usuário
  cleanupInterval: 60 * 60 * 1000 // 1 hora para limpeza automática
};

class ChatService {
  constructor() {
    this.redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');
    this.typingUsers = new Map();
    this.isInitialized = false;
    this.cleanupInterval = null;
  }

  // Inicializar o serviço
  async initialize() {
    try {
      // Testar conexão Redis
      await this.redis.ping();
      
      // Configurar limpeza automática
      this.setupAutoCleanup();
      
      this.isInitialized = true;
      logger.info('✅ Chat Service inicializado com sucesso');
      
    } catch (error) {
      logger.error('❌ Erro ao inicializar Chat Service:', error);
      throw error;
    }
  }

  // Criar novo chat
  async createChat(chatData) {
    try {
      const { chatId, tripId, driverId, passengerId } = chatData;
      
      // Verificar se chat já existe
      const exists = await this.redis.exists(`chat:${chatId}`);
      if (exists) {
        logger.warn(`Chat ${chatId} já existe`);
        return await this.getChat(chatId);
      }
      
      // Criar estrutura do chat
      const chat = {
        chatId,
        tripId,
        driverId,
        passengerId,
        status: 'active',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        messageCount: 0,
        lastMessage: null
      };
      
      // Salvar no Redis
      await this.redis.hset(`chat:${chatId}`, chat);
      
      // Adicionar aos chats do usuário
      await this.redis.sadd(`user_chats:${driverId}`, chatId);
      await this.redis.sadd(`user_chats:${passengerId}`, chatId);
      
      // Definir TTL
      await this.redis.expire(`chat:${chatId}`, CHAT_CONFIG.messageTTL);
      await this.redis.expire(`user_chats:${driverId}`, CHAT_CONFIG.messageTTL);
      await this.redis.expire(`user_chats:${passengerId}`, CHAT_CONFIG.messageTTL);
      
      logger.info(`✅ Chat ${chatId} criado com sucesso`);
      return chat;
      
    } catch (error) {
      logger.error('❌ Erro ao criar chat:', error);
      throw error;
    }
  }

  // Buscar chat existente
  async getChat(chatId) {
    try {
      const chatData = await this.redis.hgetall(`chat:${chatId}`);
      
      if (!chatData || Object.keys(chatData).length === 0) {
        return null;
      }
      
      return chatData;
      
    } catch (error) {
      logger.error('❌ Erro ao buscar chat:', error);
      return null;
    }
  }

  // Enviar mensagem
  async sendMessage(messageData) {
    try {
      const { chatId, text, userId, timestamp } = messageData;
      
      // Verificar se chat existe
      const chat = await this.getChat(chatId);
      if (!chat) {
        throw new Error(`Chat ${chatId} não encontrado`);
      }
      
      // Criar mensagem
      const message = {
        _id: this.generateMessageId(),
        chatId,
        text,
        userId,
        timestamp: timestamp || new Date().toISOString(),
        status: 'sent',
        readBy: [userId] // Remetente já leu
      };
      
      // Salvar mensagem
      await this.redis.lpush(`chat_messages:${chatId}`, JSON.stringify(message));
      
      // Manter limite de mensagens
      await this.redis.ltrim(`chat_messages:${chatId}`, 0, CHAT_CONFIG.maxMessages - 1);
      
      // Atualizar chat
      await this.redis.hset(`chat:${chatId}`, {
        updatedAt: new Date().toISOString(),
        messageCount: await this.redis.llen(`chat_messages:${chatId}`),
        lastMessage: JSON.stringify(message)
      });
      
      // Definir TTL para mensagens
      await this.redis.expire(`chat_messages:${chatId}`, CHAT_CONFIG.messageTTL);
      
      // Notificar outros usuários
      const otherUsers = [chat.driverId, chat.passengerId].filter(id => id !== userId);
      
      logger.info(`✅ Mensagem enviada no chat ${chatId}: ${message._id}`);
      
      return {
        message,
        chat,
        otherUsers
      };
      
    } catch (error) {
      logger.error('❌ Erro ao enviar mensagem:', error);
      throw error;
    }
  }

  // Carregar mensagens do chat
  async loadChatMessages(chatId, page = 0, limit = 20) {
    try {
      const start = page * limit;
      const end = start + limit - 1;
      
      // Buscar mensagens do Redis
      const messageStrings = await this.redis.lrange(`chat_messages:${chatId}`, start, end);
      
      // Converter para objetos
      const messages = messageStrings
        .map(msgStr => {
          try {
            return JSON.parse(msgStr);
          } catch (e) {
            logger.warn(`Mensagem inválida no chat ${chatId}:`, msgStr);
            return null;
          }
        })
        .filter(msg => msg !== null);
      
      return messages;
      
    } catch (error) {
      logger.error('❌ Erro ao carregar mensagens:', error);
      return [];
    }
  }

  // Marcar mensagens como lidas
  async markMessagesAsRead(chatId, userId, messageIds) {
    try {
      if (!messageIds || messageIds.length === 0) return;
      
      const messages = await this.loadChatMessages(chatId, 0, 1000);
      let updated = false;
      
      for (const message of messages) {
        if (messageIds.includes(message._id) && message.userId !== userId) {
          if (!message.readBy) message.readBy = [];
          
          if (!message.readBy.includes(userId)) {
            message.readBy.push(userId);
            updated = true;
            
            // Atualizar no Redis
            const messageIndex = await this.redis.lpos(`chat_messages:${chatId}`, JSON.stringify({
              ...message,
              readBy: message.readBy.filter(id => id !== userId)
            }));
            
            if (messageIndex !== null) {
              await this.redis.lset(`chat_messages:${chatId}`, messageIndex, JSON.stringify(message));
            }
          }
        }
      }
      
      if (updated) {
        logger.info(`✅ Mensagens marcadas como lidas no chat ${chatId} por ${userId}`);
      }
      
    } catch (error) {
      logger.error('❌ Erro ao marcar mensagens como lidas:', error);
    }
  }

  // Indicador de digitação
  async setTypingStatus(chatId, userId, isTyping) {
    try {
      const key = `typing:${chatId}:${userId}`;
      
      if (isTyping) {
        // Definir status de digitação
        await this.redis.setex(key, CHAT_CONFIG.typingTimeout, '1');
        
        // Adicionar ao mapa local
        this.typingUsers.set(`${chatId}_${userId}`, Date.now());
        
      } else {
        // Remover status de digitação
        await this.redis.del(key);
        this.typingUsers.delete(`${chatId}_${userId}`);
      }
      
    } catch (error) {
      logger.error('❌ Erro ao definir status de digitação:', error);
    }
  }

  // Verificar usuários digitando
  async getTypingUsers(chatId) {
    try {
      const typingUsers = [];
      
      // Verificar no Redis
      const keys = await this.redis.keys(`typing:${chatId}:*`);
      
      for (const key of keys) {
        const userId = key.split(':')[2];
        const ttl = await this.redis.ttl(key);
        
        if (ttl > 0) {
          typingUsers.push(userId);
        } else {
          // Remover chave expirada
          await this.redis.del(key);
        }
      }
      
      return typingUsers;
      
    } catch (error) {
      logger.error('❌ Erro ao verificar usuários digitando:', error);
      return [];
    }
  }

  // Buscar chats do usuário
  async getUserChats(userId, limit = 20) {
    try {
      const chatIds = await this.redis.smembers(`user_chats:${userId}`);
      const chats = [];
      
      for (const chatId of chatIds.slice(0, limit)) {
        const chat = await this.getChat(chatId);
        if (chat) {
          chats.push(chat);
        }
      }
      
      // Ordenar por última mensagem
      chats.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
      
      return chats;
      
    } catch (error) {
      logger.error('❌ Erro ao buscar chats do usuário:', error);
      return [];
    }
  }

  // Deletar chat
  async deleteChat(chatId) {
    try {
      const chat = await this.getChat(chatId);
      if (!chat) return false;
      
      // Remover mensagens
      await this.redis.del(`chat_messages:${chatId}`);
      
      // Remover chat
      await this.redis.del(`chat:${chatId}`);
      
      // Remover dos usuários
      await this.redis.srem(`user_chats:${chat.driverId}`, chatId);
      await this.redis.srem(`user_chats:${chat.passengerId}`, chatId);
      
      // Remover indicadores de digitação
      const typingKeys = await this.redis.keys(`typing:${chatId}:*`);
      if (typingKeys.length > 0) {
        await this.redis.del(...typingKeys);
      }
      
      logger.info(`🗑️ Chat ${chatId} deletado com sucesso`);
      return true;
      
    } catch (error) {
      logger.error('❌ Erro ao deletar chat:', error);
      return false;
    }
  }

  // Configurar limpeza automática
  setupAutoCleanup() {
    this.cleanupInterval = setInterval(async () => {
      try {
        await this.cleanupOldData();
      } catch (error) {
        logger.error('❌ Erro na limpeza automática:', error);
      }
    }, CHAT_CONFIG.cleanupInterval);
  }

  // Limpar dados antigos
  async cleanupOldData() {
    try {
      const now = Date.now();
      const cutoff = now - (CHAT_CONFIG.messageTTL * 1000);
      
      // Limpar usuários digitando antigos
      for (const [key, timestamp] of this.typingUsers.entries()) {
        if (now - timestamp > CHAT_CONFIG.typingTimeout * 1000) {
          this.typingUsers.delete(key);
        }
      }
      
      // Limpar chats inativos
      const allChats = await this.redis.keys('chat:*');
      
      for (const chatKey of allChats) {
        const chatId = chatKey.split(':')[1];
        const chat = await this.getChat(chatId);
        
        if (chat && new Date(chat.updatedAt).getTime() < cutoff) {
          await this.deleteChat(chatId);
        }
      }
      
      logger.info('🧹 Limpeza automática concluída');
      
    } catch (error) {
      logger.error('❌ Erro na limpeza de dados antigos:', error);
    }
  }

  // Gerar ID único para mensagem
  generateMessageId() {
    return `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  // Obter estatísticas do serviço
  async getServiceStats() {
    try {
      const stats = {
        totalChats: await this.redis.dbsize(),
        totalMessages: 0,
        activeUsers: this.typingUsers.size,
        uptime: process.uptime()
      };
      
      // Contar mensagens totais
      const chatKeys = await this.redis.keys('chat_messages:*');
      for (const key of chatKeys) {
        stats.totalMessages += await this.redis.llen(key);
      }
      
      return stats;
      
    } catch (error) {
      logger.error('❌ Erro ao obter estatísticas:', error);
      return {};
    }
  }

  // Destruir serviço
  destroy() {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }
    
    this.typingUsers.clear();
    this.isInitialized = false;
    
    logger.info('🗑️ Chat Service destruído');
  }
}

module.exports = ChatService;
