import Logger from '../utils/Logger';
import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  StyleSheet,
  StatusBar,
  Platform,
  Alert,
  ActivityIndicator,
  Text
} from 'react-native';
import { GiftedChat, Bubble, InputToolbar, Composer, Send } from 'react-native-gifted-chat';
import { Icon } from 'react-native-elements';
import { TouchableOpacity } from 'react-native-gesture-handler';
import { useSelector } from 'react-redux';
import WebSocketManager from '../services/WebSocketManager';


const ChatScreen = ({ navigation, route }) => {
  const { tripId, driverInfo, passengerInfo } = route.params || {};
  const [messages, setMessages] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isTyping, setIsTyping] = useState(false);
  const [chatId, setChatId] = useState(null);
  
  const auth = useSelector(state => state.auth);
  const currentUser = auth.profile;
  const currentUserId = currentUser?.uid || currentUser?.id;
  const isDriver = currentUser?.userType === 'driver';
  const wsManager = WebSocketManager.getInstance();

  // Inicializar chat
  useEffect(() => {
    initializeChat();
  }, []);

  const initializeChat = async () => {
    try {
      setIsLoading(true);
      
      // Conectar WebSocket se não estiver conectado
      if (!wsManager.isConnected()) {
        await wsManager.connect();
      }
      
      // USAR NOVO EVENTO: createChat via WebSocket
      const chatData = await wsManager.createChat({
        bookingId: tripId,
        tripId: tripId,
        participants: [driverInfo?.id, passengerInfo?.id],
        type: 'trip_chat'
      });
      
      if (chatData.success) {
        setChatId(chatData.chatId);
        Logger.log(`✅ Chat criado: ${chatData.chatId}`);
        
        // Configurar listeners para mensagens em tempo real
        setupChatListeners(chatData.chatId);
        
        // Carregar mensagens existentes
        await loadMessages(chatData.chatId);
      }
      
    } catch (error) {
      Logger.error('Erro ao inicializar chat:', error);
      Alert.alert('Erro', 'Não foi possível carregar o chat');
    } finally {
      setIsLoading(false);
    }
  };

  const setupChatListeners = (chatId) => {
    // Listener para novas mensagens em tempo real (mensagens do outro participante)
    wsManager.on('newMessage', (data) => {
      if (data.success && (data.chatId === chatId || data.bookingId === chatId)) {
        const newMessage = {
          _id: data.messageId,
          text: data.message || data.text || '',
          createdAt: new Date(data.timestamp),
          user: {
            _id: data.senderId,
            name: data.senderId === currentUserId ? 'Você' : (isDriver ? passengerInfo?.name : driverInfo?.name),
            avatar: data.senderId === currentUserId ? currentUser?.avatar : (isDriver ? passengerInfo?.avatar : driverInfo?.avatar)
          }
        };
        
        setMessages(prev => [newMessage, ...prev]);
        Logger.log('💬 Nova mensagem recebida em tempo real');
      }
    });

    // Listener para status de digitação
    wsManager.on('typingStatusChanged', (data) => {
      if ((data.chatId === chatId || data.bookingId === chatId) && data.userId !== currentUserId) {
        setIsTyping(data.isTyping);
      }
    });
  };

  const loadMessages = async (chatId) => {
    try {
      const response = await wsManager.loadChatMessages(chatId, 0, 50);
      const chatMessages = response?.messages || [];
      
      // Converter para formato do GiftedChat
      const formattedMessages = chatMessages.map(msg => ({
        _id: msg.messageId || msg.id,
        text: msg.message || msg.text || '',
        createdAt: new Date(msg.timestamp || msg.createdAt || Date.now()),
        user: {
          _id: msg.senderId,
          name: msg.senderId === currentUserId ? 'Você' : (isDriver ? passengerInfo?.name : driverInfo?.name),
          avatar: msg.senderId === currentUserId ? currentUser?.avatar : (isDriver ? passengerInfo?.avatar : driverInfo?.avatar)
        },
        system: msg.system || false
      }));
      
      setMessages(formattedMessages);
    } catch (error) {
      Logger.error('Erro ao carregar mensagens:', error);
    }
  };

  const onSend = useCallback(async (newMessages = []) => {
    try {
      const message = newMessages[0];
      
      // Adicionar mensagem localmente
      setMessages(previousMessages => 
        GiftedChat.append(previousMessages, newMessages)
      );
      
      // Enviar para o backend
      await sendMessage(message);
      
    } catch (error) {
      Logger.error('Erro ao enviar mensagem:', error);
      Alert.alert('Erro', 'Não foi possível enviar a mensagem');
    }
  }, []);

  const sendMessage = async (message) => {
    try {
      if (!currentUserId) {
        throw new Error('Usuário não autenticado');
      }
      // USAR NOVO EVENTO: sendMessage via WebSocket
      const result = await wsManager.sendMessage({
        chatId: chatId || tripId,
        bookingId: tripId,
        tripId: tripId,
        message: message.text,
        senderId: currentUserId,
        receiverId: isDriver ? passengerInfo?.id : driverInfo?.id,
        senderType: isDriver ? 'driver' : 'passenger',
        timestamp: new Date().toISOString(),
        messageType: 'text'
      });
      
      if (result.success) {
        Logger.log(`✅ Mensagem enviada via WebSocket: ${result.messageId}`);
      }
      
    } catch (error) {
      Logger.error('Erro ao enviar mensagem via WebSocket:', error);
      throw error;
    }
  };

  const renderBubble = (props) => (
    <Bubble
      {...props}
      wrapperStyle={{
        left: {
          backgroundColor: '#f1f2f6',
          borderRadius: 16,
          paddingHorizontal: 12,
          paddingVertical: 8
        },
        right: {
          backgroundColor: '#2E8B57',
          borderRadius: 16,
          paddingHorizontal: 12,
          paddingVertical: 8
        }
      }}
      textStyle={{
        left: { color: '#2c3e50', fontSize: 16 },
        right: { color: '#fff', fontSize: 16 }
      }}
    />
  );

  const renderInputToolbar = (props) => (
    <InputToolbar
      {...props}
      containerStyle={{
        backgroundColor: '#fff',
        borderTopColor: '#e1e8ed',
        borderTopWidth: 1,
        paddingHorizontal: 10,
        paddingVertical: 5
      }}
    />
  );

  const renderComposer = (props) => (
    <Composer
      {...props}
      textInputStyle={{
        backgroundColor: '#f8f9fa',
        borderRadius: 20,
        paddingHorizontal: 15,
        paddingVertical: 8,
        fontSize: 16,
        color: '#2c3e50'
      }}
      placeholder="Digite sua mensagem..."
      placeholderTextColor="#95a5a6"
    />
  );

  const renderSend = (props) => (
    <Send {...props}>
      <View style={styles.sendButton}>
        <Icon name="send" type="material" color="#2E8B57" size={24} />
      </View>
    </Send>
  );

  const renderHeader = () => (
    <View style={styles.header}>
      <TouchableOpacity
        style={styles.backButton}
        onPress={() => navigation.goBack()}
      >
        <Icon name="arrow-back" type="material" color="#fff" size={24} />
      </TouchableOpacity>
      
      <View style={styles.headerInfo}>
        <Text style={styles.headerTitle}>
          {isDriver ? passengerInfo?.name : driverInfo?.name}
        </Text>
        <Text style={styles.headerSubtitle}>
          {isDriver ? 'Passageiro' : 'Motorista'}
        </Text>
      </View>
      
      <TouchableOpacity
        style={styles.callButton}
        onPress={() => handleCall()}
      >
        <Icon name="phone" type="material" color="#fff" size={24} />
      </TouchableOpacity>
    </View>
  );

  const handleCall = () => {
    const phoneNumber = isDriver ? passengerInfo?.phone : driverInfo?.phone;
    if (phoneNumber) {
      // Implementar chamada telefônica
      Alert.alert('Ligar', `Deseja ligar para ${phoneNumber}?`);
    }
  };

  if (isLoading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#2E8B57" />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="#2E8B57" />
      
      {renderHeader()}
      
      <GiftedChat
        messages={messages}
        onSend={onSend}
        user={{
          _id: currentUserId,
          name: currentUser?.name,
          avatar: currentUser?.photo || currentUser?.avatar
        }}
        renderBubble={renderBubble}
        renderInputToolbar={renderInputToolbar}
        renderComposer={renderComposer}
        renderSend={renderSend}
        showUserAvatar={true}
        showAvatarForEveryMessage={false}
        alwaysShowSend={true}
        scrollToBottom={true}
        infiniteScroll={true}
        maxComposerHeight={100}
        minComposerHeight={50}
        textInputProps={{
          multiline: true,
          maxLength: 1000
        }}
        placeholder="Digite sua mensagem..."
        timeFormat="HH:mm"
        dateFormat="DD/MM/YYYY"
        renderAvatarOnTop={true}
        renderUsernameOnMessage={true}
        isTyping={isTyping}
        renderTicks={() => null}
        renderTime={() => null}
        renderDay={() => null}
      />
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
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#2E8B57',
    paddingHorizontal: 20,
    paddingTop: Platform.OS === 'ios' ? 50 : 20,
    paddingBottom: 15,
    elevation: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
  },
  backButton: {
    padding: 8,
  },
  headerInfo: {
    flex: 1,
    alignItems: 'center',
  },
  headerTitle: {
    color: '#fff',
    fontSize: 18,
    fontWeight: 'bold',
  },
  headerSubtitle: {
    color: '#fff',
    fontSize: 14,
    opacity: 0.8,
  },
  callButton: {
    padding: 8,
  },
  sendButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#f1f2f6',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 10,
  },
});

export default ChatScreen; 
