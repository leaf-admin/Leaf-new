import Logger from '../utils/Logger';
import api from '../common-local/api';
import { useState, useEffect } from 'react';


// Configurações do chat
const CHAT_CONFIG = {
  maxMessages: 100, // Máximo de mensagens por chat
  messageRetention: 30, // Dias para manter mensagens
  typingTimeout: 3000, // Timeout para typing indicator
};

export const chatService = {
  // Criar novo chat
  async createChat(chatData) {
    try {
      const response = await api.post('/api/chat/create', chatData);
      return response.data;
    } catch (error) {
      Logger.error('Erro ao criar chat:', error);
      throw new Error('Falha ao criar chat');
    }
  },

  // Buscar chat existente
  async getChat(chatId) {
    try {
      const response = await api.get(`/api/chat/${chatId}`);
      return response.data;
    } catch (error) {
      Logger.error('Erro ao buscar chat:', error);
      throw new Error('Chat não encontrado');
    }
  },

  // Buscar mensagens do chat
  async getChatMessages(chatId, limit = 50, offset = 0) {
    try {
      const response = await api.get(`/api/chat/${chatId}/messages`, {
        params: { limit, offset }
      });
      return response.data.messages;
    } catch (error) {
      Logger.error('Erro ao buscar mensagens:', error);
      throw new Error('Falha ao carregar mensagens');
    }
  },

  // Enviar mensagem
  async sendMessage(messageData) {
    try {
      const response = await api.post('/api/chat/message/send', messageData);
      return response.data;
    } catch (error) {
      Logger.error('Erro ao enviar mensagem:', error);
      throw new Error('Falha ao enviar mensagem');
    }
  },

  // Marcar mensagens como lidas
  async markAsRead(chatId, messageIds) {
    try {
      const response = await api.post(`/api/chat/${chatId}/read`, {
        messageIds
      });
      return response.data;
    } catch (error) {
      Logger.error('Erro ao marcar como lida:', error);
      throw new Error('Falha ao marcar mensagens');
    }
  },

  // Buscar chats ativos do usuário
  async getUserChats(userId) {
    try {
      const response = await api.get(`/api/user/${userId}/chats`);
      return response.data.chats;
    } catch (error) {
      Logger.error('Erro ao buscar chats do usuário:', error);
      throw new Error('Falha ao carregar chats');
    }
  },

  // Finalizar chat (quando viagem termina)
  async endChat(chatId) {
    try {
      const response = await api.post(`/api/chat/${chatId}/end`);
      return response.data;
    } catch (error) {
      Logger.error('Erro ao finalizar chat:', error);
      throw new Error('Falha ao finalizar chat');
    }
  },

  // Deletar chat (após período de retenção)
  async deleteChat(chatId) {
    try {
      const response = await api.delete(`/api/chat/${chatId}`);
      return response.data;
    } catch (error) {
      Logger.error('Erro ao deletar chat:', error);
      throw new Error('Falha ao deletar chat');
    }
  },

  // Buscar estatísticas do chat
  async getChatStats(chatId) {
    try {
      const response = await api.get(`/api/chat/${chatId}/stats`);
      return response.data;
    } catch (error) {
      Logger.error('Erro ao buscar estatísticas:', error);
      throw new Error('Falha ao carregar estatísticas');
    }
  }
};

// WebSocket para mensagens em tempo real
export class ChatWebSocket {
  constructor(chatId, onMessage, onTyping, onError) {
    this.chatId = chatId;
    this.onMessage = onMessage;
    this.onTyping = onTyping;
    this.onError = onError;
    this.ws = null;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 5;
  }

  connect() {
    try {
      // Substitua pela URL do seu WebSocket backend
      const wsUrl = `wss://leaf-websocket-backend.com/chat/${this.chatId}`;
      
      this.ws = new WebSocket(wsUrl);
      
      this.ws.onopen = () => {
        Logger.log('WebSocket conectado para chat:', this.chatId);
        this.reconnectAttempts = 0;
      };
      
      this.ws.onmessage = (event) => {
        const data = JSON.parse(event.data);
        
        switch (data.type) {
          case 'message':
            this.onMessage(data.message);
            break;
          case 'typing':
            this.onTyping(data.userId, data.isTyping);
            break;
          case 'read':
            // Marcar mensagens como lidas
            break;
          default:
            Logger.log('Mensagem WebSocket desconhecida:', data);
        }
      };
      
      this.ws.onerror = (error) => {
        Logger.error('Erro WebSocket:', error);
        this.onError(error);
      };
      
      this.ws.onclose = () => {
        Logger.log('WebSocket desconectado');
        this.reconnect();
      };
      
    } catch (error) {
      Logger.error('Erro ao conectar WebSocket:', error);
      this.onError(error);
    }
  }

  reconnect() {
    if (this.reconnectAttempts < this.maxReconnectAttempts) {
      this.reconnectAttempts++;
      Logger.log(`Tentativa de reconexão ${this.reconnectAttempts}/${this.maxReconnectAttempts}`);
      
      setTimeout(() => {
        this.connect();
      }, 1000 * this.reconnectAttempts); // Backoff exponencial
    } else {
      Logger.error('Máximo de tentativas de reconexão atingido');
      this.onError(new Error('Falha na conexão WebSocket'));
    }
  }

  sendMessage(message) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({
        type: 'message',
        chatId: this.chatId,
        message: message
      }));
    }
  }

  sendTyping(isTyping) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({
        type: 'typing',
        chatId: this.chatId,
        isTyping: isTyping
      }));
    }
  }

  disconnect() {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }
}

// Hook personalizado para chat
export const useChat = (chatId, userId) => {
  const [messages, setMessages] = useState([]);
  const [isTyping, setIsTyping] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    let ws = null;

    const initializeChat = async () => {
      try {
        // Carregar mensagens iniciais
        const initialMessages = await chatService.getChatMessages(chatId);
        setMessages(initialMessages);

        // Conectar WebSocket
        ws = new ChatWebSocket(
          chatId,
          (message) => {
            setMessages(prev => [...prev, message]);
          },
          (userId, isTyping) => {
            setIsTyping(isTyping);
          },
          (error) => {
            setError(error);
            setIsConnected(false);
          }
        );

        ws.connect();
        setIsConnected(true);

      } catch (error) {
        setError(error);
      }
    };

    initializeChat();

    return () => {
      if (ws) {
        ws.disconnect();
      }
    };
  }, [chatId]);

  const sendMessage = async (text) => {
    try {
      const messageData = {
        chatId,
        text,
        userId,
        createdAt: new Date().toISOString()
      };

      const newMessage = await chatService.sendMessage(messageData);
      setMessages(prev => [...prev, newMessage]);

      // Enviar via WebSocket se conectado
      if (ws) {
        ws.sendMessage(newMessage);
      }

    } catch (error) {
      setError(error);
    }
  };

  return {
    messages,
    isTyping,
    isConnected,
    error,
    sendMessage
  };
};

export default chatService; 