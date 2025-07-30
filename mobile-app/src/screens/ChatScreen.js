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
import { api } from '../common-local';

const ChatScreen = ({ navigation, route }) => {
  const { tripId, driverInfo, passengerInfo } = route.params || {};
  const [messages, setMessages] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isTyping, setIsTyping] = useState(false);
  const [chatId, setChatId] = useState(null);
  
  const auth = useSelector(state => state.auth);
  const currentUser = auth.profile;
  const isDriver = currentUser?.userType === 'driver';

  // Inicializar chat
  useEffect(() => {
    initializeChat();
  }, []);

  const initializeChat = async () => {
    try {
      setIsLoading(true);
      
      // Criar ou buscar chat existente
      const chatData = await createOrGetChat();
      setChatId(chatData.chatId);
      
      // Carregar mensagens
      await loadMessages(chatData.chatId);
      
      // Conectar WebSocket
      connectWebSocket(chatData.chatId);
      
    } catch (error) {
      console.error('Erro ao inicializar chat:', error);
      Alert.alert('Erro', 'Não foi possível carregar o chat');
    } finally {
      setIsLoading(false);
    }
  };

  const createOrGetChat = async () => {
    const chatId = `trip_${tripId}_${isDriver ? 'driver' : 'passenger'}`;
    
    try {
      // Verificar se chat já existe
      const existingChat = await api.getChat(chatId);
      return existingChat;
    } catch (error) {
      // Criar novo chat
      const newChat = {
        chatId,
        tripId,
        driverId: driverInfo?.id || currentUser?.id,
        passengerId: passengerInfo?.id || currentUser?.id,
        status: 'active',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        messages: []
      };
      
      await api.createChat(newChat);
      return newChat;
    }
  };

  const loadMessages = async (chatId) => {
    try {
      const chatMessages = await api.getChatMessages(chatId);
      
      // Converter para formato do GiftedChat
      const formattedMessages = chatMessages.map(msg => ({
        _id: msg._id,
        text: msg.text,
        createdAt: new Date(msg.createdAt),
        user: {
          _id: msg.user._id,
          name: msg.user.name,
          avatar: msg.user.avatar
        },
        system: msg.system || false
      }));
      
      setMessages(formattedMessages);
    } catch (error) {
      console.error('Erro ao carregar mensagens:', error);
    }
  };

  const connectWebSocket = (chatId) => {
    // Implementar conexão WebSocket para mensagens em tempo real
    // Esta é uma simulação - você implementaria com seu WebSocket backend
    console.log('Conectando WebSocket para chat:', chatId);
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
      console.error('Erro ao enviar mensagem:', error);
      Alert.alert('Erro', 'Não foi possível enviar a mensagem');
    }
  }, []);

  const sendMessage = async (message) => {
    const messageData = {
      chatId,
      text: message.text,
      user: {
        _id: currentUser.id,
        name: currentUser.name,
        avatar: currentUser.photo
      },
      createdAt: new Date().toISOString()
    };
    
    await api.sendChatMessage(messageData);
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
          _id: currentUser?.id,
          name: currentUser?.name,
          avatar: currentUser?.photo
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