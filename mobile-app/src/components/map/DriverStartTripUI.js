import Logger from '../../utils/Logger';
import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Alert,
  TextInput,
  KeyboardAvoidingView,
  ScrollView,
  Platform
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSelector } from 'react-redux';
import { fonts } from '../../common-local/font';
import { useTheme } from '../../common-local/theme';
import Typography from '../design-system/Typography';
import AnimatedButton from '../design-system/AnimatedButton';
import BottomSheet, { BottomSheetView, BottomSheetBackdrop } from '@gorhom/bottom-sheet';
import WebSocketManager from '../../services/WebSocketManager';
import TripDataService from '../../services/TripDataService';
import NetworkStatusBanner from '../NetworkStatusBanner';


const LEAF_GREEN = '#003002';

const translations = {
  start_trip: 'Iniciar Viagem',
  confirm_start_trip: 'Tem certeza que deseja iniciar a viagem?',
  no: 'Não',
  yes: 'Sim',
  passenger: 'Passageiro',
  confirm_passenger_boarding: 'Confirme que o passageiro embarcou antes de iniciar a viagem.',
  starting_trip: 'Iniciando...',
  cancel_ride: 'Cancelar'
};

export default function DriverStartTripUI({ booking, onStartTrip }) {
  const t = (key) => translations[key] || key;
  const theme = useTheme();
  const auth = useSelector(state => state.auth);
  const [isStarting, setIsStarting] = useState(false);

  // Estados para chat
  const [messageText, setMessageText] = useState('');
  const [chatMessages, setChatMessages] = useState([]);
  const [unreadMessagesCount, setUnreadMessagesCount] = useState(0);
  const [isChatBottomSheetOpen, setIsChatBottomSheetOpen] = useState(false);

  // ✅ Timer de 2 minutos (120 segundos)
  const [boardingTimer, setBoardingTimer] = useState(120); // 2 minutos em segundos
  const [canCancelWithoutPenalty, setCanCancelWithoutPenalty] = useState(false);

  // Ref para BottomSheet de chat
  const chatBottomSheetRef = useRef(null);
  const chatSnapPoints = ['45%', '64%'];

  // Ref para ScrollView de mensagens
  const messagesScrollViewRef = useRef(null);

  // ✅ Timer decrescente de 2 minutos
  useEffect(() => {
    if (boardingTimer <= 0) {
      setCanCancelWithoutPenalty(true);
      return;
    }

    const timerInterval = setInterval(() => {
      setBoardingTimer(prev => {
        if (prev <= 1) {
          setCanCancelWithoutPenalty(true);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timerInterval);
  }, [boardingTimer]);

  // Carregar mensagens do chat quando o BottomSheet abrir
  useEffect(() => {
    if (!isChatBottomSheetOpen || !booking?.id) {
      return;
    }

    let tripRef = null;
    let wsCleanup = null;

    const initializeChat = async () => {
      // Carregar mensagens existentes
      await loadChatMessages();

      // Setup WebSocket listeners
      wsCleanup = setupWebSocketListeners();

      // Listener em tempo real do Firebase
      const database = require('@react-native-firebase/database').default;
      tripRef = database().ref(`trip_data/${booking.id}/chat`);

      const handleNewMessage = (snapshot) => {
        if (snapshot.exists()) {
          const newMessage = {
            id: snapshot.key,
            ...snapshot.val(),
            isOwn: snapshot.val().senderId === (auth?.profile?.uid || auth?.uid)
          };

          setChatMessages(prev => {
            // Verificar se a mensagem já existe
            if (prev.find(m => m.id === newMessage.id)) {
              return prev;
            }
            return [...prev, newMessage].sort((a, b) => {
              const timeA = new Date(a.timestamp || 0).getTime();
              const timeB = new Date(b.timestamp || 0).getTime();
              return timeA - timeB;
            });
          });

          // Incrementar contador de mensagens não lidas se for do passageiro e o chat estiver fechado
          if (!newMessage.isOwn && !isChatBottomSheetOpen) {
            setUnreadMessagesCount(prev => prev + 1);
          }

          // Scroll para a última mensagem
          setTimeout(() => {
            messagesScrollViewRef.current?.scrollToEnd({ animated: true });
          }, 100);
        }
      };

      tripRef.on('child_added', handleNewMessage);
    };

    initializeChat();

    return () => {
      // Cleanup
      if (wsCleanup) {
        wsCleanup();
      }
      if (tripRef) {
        tripRef.off();
      }
    };
  }, [isChatBottomSheetOpen, booking?.id, auth?.profile?.uid, auth?.uid]);

  const loadChatMessages = async () => {
    if (!booking?.id) return;

    try {
      // Buscar mensagens do Firebase Realtime Database
      const database = require('@react-native-firebase/database').default;
      const tripRef = database().ref(`trip_data/${booking.id}/chat`);

      tripRef.once('value', (snapshot) => {
        if (snapshot.exists()) {
          const messagesData = snapshot.val();
          const messages = Object.keys(messagesData).map(key => ({
            id: key,
            ...messagesData[key],
            isOwn: messagesData[key].senderId === (auth?.profile?.uid || auth?.uid)
          })).sort((a, b) => {
            // Ordenar por timestamp
            const timeA = new Date(a.timestamp || 0).getTime();
            const timeB = new Date(b.timestamp || 0).getTime();
            return timeA - timeB;
          });

          setChatMessages(messages);

          // Scroll para a última mensagem
          setTimeout(() => {
            messagesScrollViewRef.current?.scrollToEnd({ animated: false });
          }, 100);
        } else {
          setChatMessages([]);
        }
      });
    } catch (error) {
      Logger.error('Erro ao carregar mensagens:', error);
      setChatMessages([]);
    }
  };

  const setupWebSocketListeners = () => {
    const webSocketManager = WebSocketManager.getInstance();

    const handleNewMessage = (data) => {
      if (data.bookingId === booking?.id) {
        const newMessage = {
          id: data.messageId || `msg_${Date.now()}`,
          text: data.message,
          senderId: data.senderId,
          senderType: data.senderType || 'passenger',
          timestamp: data.timestamp || new Date().toISOString(),
          isOwn: data.senderId === auth?.profile?.uid || data.senderId === auth?.uid
        };

        setChatMessages(prev => [...prev, newMessage]);

        // Incrementar contador de mensagens não lidas se for do passageiro e o chat estiver fechado
        if (!newMessage.isOwn && !isChatBottomSheetOpen) {
          setUnreadMessagesCount(prev => prev + 1);
        }

        // Scroll para a última mensagem
        setTimeout(() => {
          messagesScrollViewRef.current?.scrollToEnd({ animated: true });
        }, 100);
      }
    };

    webSocketManager.on('newMessage', handleNewMessage);

    return () => {
      webSocketManager.off('newMessage', handleNewMessage);
    };
  };

  const handleSendMessage = async () => {
    if (!messageText.trim() || !booking?.id) {
      return;
    }

    const passengerId = booking?.customer_id || booking?.passenger_id;
    if (!passengerId) {
      Alert.alert('Erro', 'ID do passageiro não encontrado');
      return;
    }

    try {
      const webSocketManager = WebSocketManager.getInstance();

      if (!webSocketManager.isConnected()) {
        Alert.alert('Erro', 'Não conectado ao servidor. Tente novamente.');
        return;
      }

      // Enviar mensagem via WebSocket
      webSocketManager.emitToServer('sendMessage', {
        bookingId: booking.id,
        message: messageText.trim(),
        senderId: auth?.profile?.uid || auth?.uid,
        receiverId: passengerId,
        senderType: 'driver'
      });

      // Adicionar mensagem localmente (otimista)
      const newMessage = {
        id: `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        text: messageText.trim(),
        senderId: auth?.profile?.uid || auth?.uid,
        senderType: 'driver',
        timestamp: new Date().toISOString(),
        isOwn: true
      };

      setChatMessages(prev => [...prev, newMessage]);
      setMessageText('');

      // Salvar mensagem no TripDataService
      await TripDataService.addChatMessage(booking.id, {
        senderId: newMessage.senderId,
        senderType: 'driver',
        message: newMessage.text,
        timestamp: newMessage.timestamp
      });

      // Scroll para a última mensagem
      setTimeout(() => {
        messagesScrollViewRef.current?.scrollToEnd({ animated: true });
      }, 100);

    } catch (error) {
      Logger.error('Erro ao enviar mensagem:', error);
      Alert.alert('Erro', 'Não foi possível enviar a mensagem.');
    }
  };

  const renderChatBackdrop = useCallback(
    (props) => (
      <BottomSheetBackdrop
        {...props}
        disappearsOnIndex={-1}
        appearsOnIndex={0}
        opacity={0.5}
        onPress={() => {
          chatBottomSheetRef.current?.close();
          setIsChatBottomSheetOpen(false);
        }}
      />
    ),
    []
  );

  const handleStartTrip = () => {
    Alert.alert(
      t('start_trip'),
      t('confirm_start_trip'),
      [
        { text: t('no'), style: 'cancel' },
        {
          text: t('yes'),
          onPress: () => {
            setIsStarting(true);
            if (onStartTrip) {
              onStartTrip();
            }
          }
        }
      ]
    );
  };

  const formatTimer = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const handleCancelRide = async () => {
    const cancelMessage = canCancelWithoutPenalty
      ? 'Tem certeza que deseja cancelar esta corrida? Você pode cancelar sem penalização pois o tempo de espera expirou.'
      : 'Tem certeza que deseja cancelar esta corrida?';

    Alert.alert(
      'Cancelar Corrida',
      cancelMessage,
      [
        { text: 'Não', style: 'cancel' },
        {
          text: 'Sim, Cancelar',
          style: 'destructive',
          onPress: async () => {
            try {
              const bookingId = booking?.id || booking?.bookingId;
              if (!bookingId) {
                Alert.alert('Erro', 'ID da corrida não encontrado');
                return;
              }

              const webSocketManager = WebSocketManager.getInstance();

              // Conectar se não estiver conectado
              if (!webSocketManager.isConnected()) {
                await webSocketManager.connect();
              }

              // Cancelar corrida
              const result = await webSocketManager.cancelRide(bookingId, 'Cancelado pelo motorista');

              if (result.success) {
                Alert.alert(
                  'Corrida Cancelada',
                  'A corrida foi cancelada com sucesso.',
                  [{ text: 'OK' }]
                );
              } else {
                Alert.alert('Erro', result.error || 'Erro ao cancelar corrida');
              }
            } catch (error) {
              Logger.error('❌ Erro ao cancelar corrida:', error);
              Alert.alert('Erro', 'Erro ao cancelar corrida. Tente novamente.');
            }
          }
        }
      ]
    );
  };

  return (
    <>
      {/* ✅ NOVO: Banner de status de conexão */}
      <NetworkStatusBanner />

      <View style={[styles.container, { backgroundColor: theme.card }]}>
        {/* ✅ Timer de embarque */}
        <View style={[
          styles.timerContainer,
          { backgroundColor: theme.card === '#1A1A1A' ? 'rgba(65, 210, 116, 0.1)' : '#F0F9F0', borderColor: theme.leafGreen || '#41D274' },
          canCancelWithoutPenalty && { backgroundColor: theme.card === '#1A1A1A' ? 'rgba(255, 59, 48, 0.1)' : '#FFF0F0', borderColor: '#FF3B30' }
        ]}>
          <Ionicons
            name={canCancelWithoutPenalty ? "time-outline" : "time"}
            size={20}
            color={canCancelWithoutPenalty ? "#FF3B30" : (theme.leafGreen || '#41D274')}
          />
          <Typography variant="label" weight="bold" color={canCancelWithoutPenalty ? "#FF3B30" : (theme.leafGreen || '#41D274')} style={{ marginLeft: 8 }}>
            {canCancelWithoutPenalty
              ? 'Tempo de espera expirado - Pode cancelar sem penalização'
              : `Tempo de embarque: ${formatTimer(boardingTimer)}`
            }
          </Typography>
        </View>

        {/* Texto de confirmação */}
        <View style={styles.confirmationTextContainer}>
          <Typography variant="caption" align="center" color={theme.textSecondary}>
            {t('confirm_passenger_boarding')}
          </Typography>
        </View>

        {/* Destino - Centralizado, maior e em negrito */}
        <View style={styles.destinationContainer}>
          <Typography variant="label" color={theme.textSecondary} style={{ marginBottom: 8 }}>Destino</Typography>
          <Typography variant="h2" align="center" color={theme.text}>{booking?.drop_address || '--'}</Typography>
        </View>

        {/* Valor da corrida */}
        <View style={[styles.fareContainer, { backgroundColor: theme.card === '#1A1A1A' ? 'rgba(255,255,255,0.02)' : '#F8F9FA' }]}>
          <Typography variant="h1" color={theme.leafGreen || '#41D274'} weight="bold">
            {(() => {
              const fare = booking?.estimated_fare || booking?.fare;
              if (!fare || fare === '--') return 'R$ --';
              // Formatar com 2 casas decimais
              const fareNumber = typeof fare === 'string' ? parseFloat(fare.replace(',', '.')) : fare;
              if (isNaN(fareNumber)) return 'R$ --';
              return `R$ ${fareNumber.toFixed(2).replace('.', ',')}`;
            })()}
          </Typography>
        </View>

        {/* Botão de mensagem */}
        <TouchableOpacity
          style={[styles.messageButton, { backgroundColor: theme.card === '#1A1A1A' ? 'rgba(255,255,255,0.05)' : '#F5F5F5', borderColor: theme.border }]}
          onPress={() => {
            setIsChatBottomSheetOpen(true);
            setUnreadMessagesCount(0);
            chatBottomSheetRef.current?.expand();
          }}
        >
          <Ionicons name="chatbubble-outline" size={20} color={theme.leafGreen || '#41D274'} />
          <Typography variant="body" color={theme.text} style={{ marginLeft: 8 }}>Enviar mensagem</Typography>
          {unreadMessagesCount > 0 && (
            <View style={styles.unreadBadge}>
              <Typography variant="caption" weight="bold" color="#FFFFFF">
                {unreadMessagesCount > 9 ? '9+' : unreadMessagesCount}
              </Typography>
            </View>
          )}
        </TouchableOpacity>

        {/* Botão principal - Iniciar Viagem */}
        <AnimatedButton
          title={t('start_trip')}
          onPress={handleStartTrip}
          isLoading={isStarting}
          style={{ marginBottom: 12 }}
        />

        {/* Botão de cancelar */}
        <AnimatedButton
          title={t('cancel_ride')}
          variant="danger-outline"
          onPress={handleCancelRide}
        />
      </View>

      {/* BottomSheet de Chat */}
      <BottomSheet
        ref={chatBottomSheetRef}
        index={-1}
        snapPoints={chatSnapPoints}
        enablePanDownToClose={true}
        backdropComponent={renderChatBackdrop}
        handleIndicatorStyle={{ backgroundColor: theme.textSecondary }}
        backgroundStyle={{ backgroundColor: theme.card }}
        onChange={(index) => {
          setIsChatBottomSheetOpen(index >= 0);
          if (index >= 0) {
            setUnreadMessagesCount(0);
          }
        }}
      >
        <BottomSheetView style={styles.chatBottomSheetContent}>
          <View style={[styles.chatHeader, { borderBottomColor: theme.border }]}>
            <Typography variant="h2" color={theme.text}>Conversa com {booking?.customer_name || 'Passageiro'}</Typography>
            <TouchableOpacity
              onPress={() => {
                chatBottomSheetRef.current?.close();
                setIsChatBottomSheetOpen(false);
              }}
            >
              <Ionicons name="close" size={24} color={theme.text} />
            </TouchableOpacity>
          </View>

          <ScrollView
            ref={messagesScrollViewRef}
            style={styles.messagesContainer}
            contentContainerStyle={styles.messagesContent}
            onContentSizeChange={() => {
              messagesScrollViewRef.current?.scrollToEnd({ animated: true });
            }}
          >
            {chatMessages.length === 0 ? (
              <View style={styles.emptyMessagesContainer}>
                <Ionicons name="chatbubbles-outline" size={48} color={theme.textSecondary} />
                <Typography variant="h2" color={theme.textSecondary} style={{ marginTop: 16 }}>Nenhuma mensagem ainda</Typography>
                <Typography variant="body" color={theme.textSecondary} style={{ marginTop: 8 }}>Envie uma mensagem para o passageiro</Typography>
              </View>
            ) : (
              chatMessages.map((message) => (
                <View
                  key={message.id}
                  style={[
                    styles.messageBubble,
                    message.isOwn ? { backgroundColor: theme.leafGreen || '#41D274', alignSelf: 'flex-end', borderBottomRightRadius: 4 } : { backgroundColor: theme.card === '#1A1A1A' ? 'rgba(255,255,255,0.05)' : '#F0F0F0', alignSelf: 'flex-start', borderBottomLeftRadius: 4 }
                  ]}
                >
                  <Typography variant="body" color={message.isOwn ? '#FFFFFF' : theme.text}>
                    {message.text}
                  </Typography>
                  <Typography variant="caption" color={message.isOwn ? 'rgba(255, 255, 255, 0.7)' : theme.textSecondary} style={{ marginTop: 4 }}>
                    {new Date(message.timestamp).toLocaleTimeString('pt-BR', {
                      hour: '2-digit',
                      minute: '2-digit'
                    })}
                  </Typography>
                </View>
              ))
            )}
          </ScrollView>

          <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
            style={[styles.chatInputContainer, { borderTopColor: theme.border }]}
          >
            <View style={[styles.chatInputWrapper, { backgroundColor: theme.card === '#1A1A1A' ? 'rgba(255,255,255,0.05)' : '#F5F5F5' }]}>
              <TextInput
                style={[styles.chatInput, { color: theme.text }]}
                placeholder="Digite sua mensagem..."
                placeholderTextColor={theme.textSecondary}
                value={messageText}
                onChangeText={setMessageText}
                multiline
                maxLength={500}
              />
              <TouchableOpacity
                style={[
                  styles.sendButton,
                  { backgroundColor: theme.leafGreen || '#41D274' },
                  !messageText.trim() && { backgroundColor: theme.card === '#1A1A1A' ? 'rgba(255,255,255,0.1)' : '#E0E0E0' }
                ]}
                onPress={handleSendMessage}
                disabled={!messageText.trim()}
              >
                <Ionicons
                  name="send"
                  size={20}
                  color={messageText.trim() ? '#FFFFFF' : '#CCC'}
                />
              </TouchableOpacity>
            </View>
          </KeyboardAvoidingView>
        </BottomSheetView>
      </BottomSheet>
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 10,
  },
  timerContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F0F9F0',
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 12,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: LEAF_GREEN,
  },
  timerContainerExpired: {
    backgroundColor: '#FFF0F0',
    borderColor: '#FF3B30',
  },
  timerText: {
    fontSize: 14,
    fontFamily: fonts.Bold,
    fontWeight: 'bold',
    color: LEAF_GREEN,
    marginLeft: 8,
  },
  timerTextExpired: {
    color: '#FF3B30',
  },
  confirmationTextContainer: {
    marginBottom: 20,
  },
  confirmationText: {
    fontSize: 13,
    fontFamily: fonts.Regular,
    color: '#666',
    lineHeight: 18,
    textAlign: 'center',
  },
  destinationContainer: {
    alignItems: 'center',
    marginBottom: 20,
  },
  destinationLabel: {
    fontSize: 12,
    fontFamily: fonts.Regular,
    color: '#999',
    marginBottom: 8,
  },
  destinationAddress: {
    fontSize: 18,
    fontFamily: fonts.Bold,
    fontWeight: 'bold',
    color: '#333',
    textAlign: 'center',
    lineHeight: 24,
  },
  fareContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
    paddingVertical: 12,
    paddingHorizontal: 20,
    backgroundColor: '#F8F9FA',
    borderRadius: 12,
  },
  fareText: {
    fontSize: 24,
    fontFamily: fonts.Bold,
    fontWeight: '700',
    color: LEAF_GREEN,
  },
  messageButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F5F5F5',
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#E0E0E0',
    position: 'relative',
  },
  messageButtonText: {
    marginLeft: 8,
    fontSize: 14,
    fontFamily: fonts.Regular,
    color: '#333',
  },
  startTripButton: {
    backgroundColor: LEAF_GREEN,
    paddingVertical: 15,
    paddingHorizontal: 30,
    borderRadius: 25,
    alignItems: 'center',
    marginBottom: 8,
  },
  startTripButtonDisabled: {
    backgroundColor: '#CCC',
  },
  startTripButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontFamily: fonts.Regular,
  },
  loadingContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  cancelButton: {
    paddingVertical: 12,
    paddingHorizontal: 30,
    borderRadius: 25,
    alignItems: 'center',
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: '#FF3B30',
  },
  cancelButtonText: {
    color: '#FF3B30',
    fontSize: 14,
    fontFamily: fonts.Regular,
  },
  unreadBadge: {
    position: 'absolute',
    top: 8,
    right: 8,
    backgroundColor: '#FF3B30',
    borderRadius: 10,
    minWidth: 20,
    height: 20,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 6,
  },
  unreadBadgeText: {
    color: '#FFFFFF',
    fontSize: 11,
    fontFamily: fonts.Bold,
    fontWeight: 'bold',
  },
  chatBottomSheetContent: {
    flex: 1,
    paddingHorizontal: 20,
  },
  chatHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#E0E0E0',
  },
  chatHeaderTitle: {
    fontSize: 18,
    fontFamily: fonts.Bold,
    fontWeight: 'bold',
    color: '#333',
  },
  messagesContainer: {
    flex: 1,
    marginVertical: 16,
  },
  messagesContent: {
    paddingBottom: 16,
  },
  emptyMessagesContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 60,
  },
  emptyMessagesText: {
    fontSize: 16,
    fontFamily: fonts.Bold,
    color: '#666',
    marginTop: 16,
  },
  emptyMessagesSubtext: {
    fontSize: 14,
    fontFamily: fonts.Regular,
    color: '#999',
    marginTop: 8,
  },
  messageBubble: {
    maxWidth: '75%',
    marginBottom: 12,
    padding: 12,
    borderRadius: 16,
  },
  messageBubbleOwn: {
    alignSelf: 'flex-end',
    backgroundColor: LEAF_GREEN,
    borderBottomRightRadius: 4,
  },
  messageBubbleOther: {
    alignSelf: 'flex-start',
    backgroundColor: '#F0F0F0',
    borderBottomLeftRadius: 4,
  },
  messageText: {
    fontSize: 14,
    fontFamily: fonts.Regular,
    lineHeight: 20,
  },
  messageTextOwn: {
    color: '#FFFFFF',
  },
  messageTextOther: {
    color: '#333',
  },
  messageTime: {
    fontSize: 10,
    fontFamily: fonts.Regular,
    marginTop: 4,
  },
  messageTimeOwn: {
    color: 'rgba(255, 255, 255, 0.7)',
  },
  messageTimeOther: {
    color: '#999',
  },
  chatInputContainer: {
    paddingVertical: 12,
    borderTopWidth: 1,
    borderTopColor: '#E0E0E0',
  },
  chatInputWrapper: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    backgroundColor: '#F5F5F5',
    borderRadius: 25,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  chatInput: {
    flex: 1,
    fontSize: 14,
    fontFamily: fonts.Regular,
    color: '#333',
    maxHeight: 100,
    paddingVertical: 8,
    paddingHorizontal: 12,
  },
  sendButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: LEAF_GREEN,
    justifyContent: 'center',
    alignItems: 'center',
    marginLeft: 8,
  },
  sendButtonDisabled: {
    backgroundColor: '#E0E0E0',
  },
});
