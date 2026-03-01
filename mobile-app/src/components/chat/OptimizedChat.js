import Logger from '../../utils/Logger';
import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View,
  StyleSheet,
  Platform,
  Alert,
  ActivityIndicator,
  Text,
  KeyboardAvoidingView,
  SafeAreaView,
  StatusBar
} from 'react-native';
import { GiftedChat, Bubble, InputToolbar, Composer, Send, MessageText } from 'react-native-gifted-chat';
import { Icon } from 'react-native-elements';
import { TouchableOpacity } from 'react-native-gesture-handler';
import { useSelector, useDispatch } from 'react-redux';
import { colors } from '../../common-local/theme';
import { useTranslation } from 'react-i18next';


// Componente de chat otimizado para resolver problemas comuns do GiftedChat
const OptimizedChat = ({ 
  navigation, 
  route,
  onSendMessage,
  onLoadMessages,
  chatId,
  currentUser,
  otherUser,
  isTyping = false,
  isLoading = false
}) => {
  const { t } = useTranslation();
  const [messages, setMessages] = useState([]);
  const [isLoadingMessages, setIsLoadingMessages] = useState(false);
  const [hasMoreMessages, setHasMoreMessages] = useState(true);
  const [page, setPage] = useState(0);
  const messagesRef = useRef(null);
  const typingTimeoutRef = useRef(null);

  // Estados para otimização
  const [isScrolling, setIsScrolling] = useState(false);
  const [keyboardHeight, setKeyboardHeight] = useState(0);

  // Carregar mensagens iniciais
  useEffect(() => {
    if (chatId) {
      loadInitialMessages();
    }
  }, [chatId]);

  // Cleanup de timeouts
  useEffect(() => {
    return () => {
      if (typingTimeoutRef.current) {
        clearTimeout(typingTimeoutRef.current);
      }
    };
  }, []);

  const loadInitialMessages = async () => {
    try {
      setIsLoadingMessages(true);
      const initialMessages = await onLoadMessages(chatId, 0, 20);
      
      if (initialMessages && initialMessages.length > 0) {
        setMessages(initialMessages);
        setHasMoreMessages(initialMessages.length === 20);
        setPage(1);
      }
    } catch (error) {
      Logger.error('Erro ao carregar mensagens iniciais:', error);
      Alert.alert(t('error'), t('chat_load_error'));
    } finally {
      setIsLoadingMessages(false);
    }
  };

  const loadMoreMessages = async () => {
    if (!hasMoreMessages || isLoadingMessages) return;

    try {
      setIsLoadingMessages(true);
      const moreMessages = await onLoadMessages(chatId, page, 20);
      
      if (moreMessages && moreMessages.length > 0) {
        setMessages(prevMessages => [...moreMessages, ...prevMessages]);
        setHasMoreMessages(moreMessages.length === 20);
        setPage(prevPage => prevPage + 1);
      } else {
        setHasMoreMessages(false);
      }
    } catch (error) {
      Logger.error('Erro ao carregar mais mensagens:', error);
    } finally {
      setIsLoadingMessages(false);
    }
  };

  const handleSend = useCallback(async (newMessages = []) => {
    try {
      const message = newMessages[0];
      
      // Adicionar mensagem localmente imediatamente
      setMessages(prevMessages => GiftedChat.append(prevMessages, newMessages));
      
      // Enviar para o backend
      await onSendMessage({
        chatId,
        text: message.text,
        userId: currentUser.id,
        timestamp: new Date().toISOString()
      });

      // Limpar timeout de digitação
      if (typingTimeoutRef.current) {
        clearTimeout(typingTimeoutRef.current);
      }

    } catch (error) {
      Logger.error('Erro ao enviar mensagem:', error);
      Alert.alert(t('error'), t('message_send_error'));
      
      // Remover mensagem local em caso de erro
      setMessages(prevMessages => prevMessages.filter(msg => msg._id !== newMessages[0]._id));
    }
  }, [chatId, currentUser.id, onSendMessage, t]);

  const handleTyping = useCallback((text) => {
    // Implementar indicador de digitação
    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current);
    }
    
    typingTimeoutRef.current = setTimeout(() => {
      // Enviar evento de parada de digitação
    }, 1000);
  }, []);

  const renderBubble = useCallback((props) => {
    const isOwnMessage = props.currentMessage.user._id === currentUser.id;
    
    return (
      <Bubble
        {...props}
        wrapperStyle={{
          left: {
            backgroundColor: colors.ONLINE_CHAT_BACKGROUND || '#f0f0f0',
            marginBottom: 8,
            marginLeft: 8,
            borderRadius: 18,
            paddingHorizontal: 12,
            paddingVertical: 8
          },
          right: {
            backgroundColor: colors.primary || '#007AFF',
            marginBottom: 8,
            marginRight: 8,
            borderRadius: 18,
            paddingHorizontal: 12,
            paddingVertical: 8
          }
        }}
        textStyle={{
          left: {
            color: '#000',
            fontSize: 16
          },
          right: {
            color: '#fff',
            fontSize: 16
          }
        }}
        renderMessageText={(messageTextProps) => (
          <MessageText
            {...messageTextProps}
            textStyle={{
              left: {
                color: '#000',
                fontSize: 16
              },
              right: {
                color: '#fff',
                fontSize: 16
              }
            }}
          />
        )}
      />
    );
  }, [currentUser.id, colors]);

  const renderInputToolbar = useCallback((props) => {
    return (
      <InputToolbar
        {...props}
        containerStyle={{
          backgroundColor: '#fff',
          borderTopWidth: 1,
          borderTopColor: '#e0e0e0',
          paddingHorizontal: 8,
          paddingVertical: 4
        }}
        primaryStyle={{
          alignItems: 'center'
        }}
      />
    );
  }, []);

  const renderComposer = useCallback((props) => {
    return (
      <Composer
        {...props}
        textInputStyle={{
          backgroundColor: '#f8f8f8',
          borderRadius: 20,
          paddingHorizontal: 16,
          paddingVertical: 8,
          fontSize: 16,
          maxHeight: 100,
          minHeight: 40
        }}
        placeholder={t('type_message')}
        placeholderTextColor="#999"
        multiline={true}
        textInputProps={{
          onFocus: () => setIsScrolling(false),
          onBlur: () => setIsScrolling(true)
        }}
      />
    );
  }, [t]);

  const renderSend = useCallback((props) => {
    return (
      <Send
        {...props}
        containerStyle={{
          justifyContent: 'center',
          alignItems: 'center',
          alignSelf: 'center',
          marginRight: 8
        }}
      >
        <Icon
          name="send"
          type="material"
          size={24}
          color={colors.primary || '#007AFF'}
        />
      </Send>
    );
  }, [colors]);

  const renderFooter = useCallback(() => {
    if (isTyping) {
      return (
        <View style={styles.typingIndicator}>
          <Text style={styles.typingText}>{t('typing')}...</Text>
        </View>
      );
    }
    return null;
  }, [isTyping, t]);

  const renderLoading = useCallback(() => {
    if (isLoadingMessages && hasMoreMessages) {
      return (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="small" color={colors.primary || '#007AFF'} />
          <Text style={styles.loadingText}>{t('loading_messages')}</Text>
        </View>
      );
    }
    return null;
  }, [isLoadingMessages, hasMoreMessages, colors, t]);

  const onScrollBeginDrag = useCallback(() => {
    setIsScrolling(true);
  }, []);

  const onScrollEndDrag = useCallback(() => {
    setIsScrolling(false);
  }, []);

  const onEndReached = useCallback(() => {
    if (!isScrolling && hasMoreMessages && !isLoadingMessages) {
      loadMoreMessages();
    }
  }, [isScrolling, hasMoreMessages, isLoadingMessages, loadMoreMessages]);

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor="#fff" />
      
      <KeyboardAvoidingView
        style={styles.keyboardAvoidingView}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}
      >
        <GiftedChat
          ref={messagesRef}
          messages={messages}
          onSend={handleSend}
          user={{
            _id: currentUser.id,
            name: currentUser.name,
            avatar: currentUser.avatar
          }}
          renderBubble={renderBubble}
          renderInputToolbar={renderInputToolbar}
          renderComposer={renderComposer}
          renderSend={renderSend}
          renderFooter={renderFooter}
          renderLoading={renderLoading}
          onScrollBeginDrag={onScrollBeginDrag}
          onScrollEndDrag={onScrollEndDrag}
          onEndReached={onEndReached}
          onEndReachedThreshold={0.1}
          onInputTextChanged={handleTyping}
          alwaysShowSend={true}
          scrollToBottom={true}
          scrollToBottomComponent={() => (
            <TouchableOpacity
              style={styles.scrollToBottomButton}
              onPress={() => messagesRef.current?.scrollToBottom()}
            >
              <Icon name="keyboard-arrow-down" size={24} color="#fff" />
            </TouchableOpacity>
          )}
          infiniteScroll={true}
          loadEarlier={hasMoreMessages}
          isLoadingEarlier={isLoadingMessages}
          renderLoadEarlier={() => (
            <TouchableOpacity
              style={styles.loadEarlierButton}
              onPress={loadMoreMessages}
              disabled={isLoadingMessages}
            >
              <Text style={styles.loadEarlierText}>
                {isLoadingMessages ? t('loading') : t('load_earlier')}
              </Text>
            </TouchableOpacity>
          )}
          maxComposerHeight={100}
          minComposerHeight={40}
          maxInputLength={1000}
          textInputProps={{
            autoCorrect: false,
            autoCapitalize: 'sentences',
            multiline: true,
            returnKeyType: 'default'
          }}
          listViewProps={{
            showsVerticalScrollIndicator: false,
            removeClippedSubviews: Platform.OS === 'android',
            initialNumToRender: 20,
            maxToRenderPerBatch: 10,
            windowSize: 10,
            getItemLayout: (data, index) => ({
              length: 80,
              offset: 80 * index,
              index
            })
          }}
        />
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff'
  },
  keyboardAvoidingView: {
    flex: 1
  },
  typingIndicator: {
    padding: 10,
    marginLeft: 10,
    marginBottom: 10
  },
  typingText: {
    color: '#666',
    fontSize: 14,
    fontStyle: 'italic'
  },
  loadingContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20
  },
  loadingText: {
    marginLeft: 10,
    color: '#666',
    fontSize: 14
  },
  scrollToBottomButton: {
    backgroundColor: 'rgba(0,0,0,0.5)',
    borderRadius: 20,
    padding: 8,
    marginBottom: 10
  },
  loadEarlierButton: {
    padding: 15,
    alignItems: 'center',
    backgroundColor: '#f0f0f0',
    marginHorizontal: 20,
    marginVertical: 10,
    borderRadius: 8
  },
  loadEarlierText: {
    color: '#666',
    fontSize: 14
  }
});

export default OptimizedChat;
