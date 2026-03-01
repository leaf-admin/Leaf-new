import Logger from '../../utils/Logger';
import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Image,
  Dimensions,
  Alert,
  Linking,
  Platform,
  TextInput,
  KeyboardAvoidingView,
  ScrollView,
  Modal
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSelector } from 'react-redux';
import { fonts } from '../../common-local/font';
import BottomSheet, { BottomSheetView, BottomSheetBackdrop } from '@gorhom/bottom-sheet';
import WebSocketManager from '../../services/WebSocketManager';
import TripDataService from '../../services/TripDataService';
import * as Location from 'expo-location';
import { GetDistance } from '../../common-local/other/GeoFunctions';
import { Animated } from 'react-native';
import NetworkStatusBanner from '../NetworkStatusBanner';


const { width } = Dimensions.get('window');

// Cor da marca Leaf
const LEAF_GREEN = '#003002';

// Traduções em português
const translations = {
  passenger: 'Passageiro',
  heading_to_pickup: 'A caminho do embarque',
  pickup: 'Embarque',
  destination: 'Destino',
  navigate: 'Navegar',
  call_passenger: 'Ligar',
  message: 'Mensagem',
  arrived_at_pickup: 'Cheguei no embarque',
  confirm_arrival: 'Confirmar que chegou no local de embarque?',
  yes: 'Sim',
  no: 'Não'
};

const DriverEnRouteUI = React.memo(function DriverEnRouteUI({ booking, onArrived }) {
  // Função de tradução simplificada
  const t = (key) => translations[key] || key;
  const auth = useSelector(state => state.auth);
  const [estimatedTime, setEstimatedTime] = useState('--');
  const [estimatedDistance, setEstimatedDistance] = useState('--');
  
  // Estados para barra de progresso
  const [initialDistance, setInitialDistance] = useState(null); // Distância inicial quando motorista aceita
  const [currentDistance, setCurrentDistance] = useState(null); // Distância atual
  const [progressPercent, setProgressPercent] = useState(0); // Percentual de progresso (0-100)
  const progressAnimation = useRef(new Animated.Value(0)).current; // Animação da barra
  
  // ✅ Refs para evitar re-renderizações desnecessárias
  const lastUpdateTimeRef = useRef(0);
  const lastDistanceRef = useRef(null);
  const lastPercentRef = useRef(0);
  
  // Estados para chat
  const [messageText, setMessageText] = useState('');
  const [chatMessages, setChatMessages] = useState([]);
  const [unreadMessagesCount, setUnreadMessagesCount] = useState(0);
  const [isChatBottomSheetOpen, setIsChatBottomSheetOpen] = useState(false);
  const [distanceError, setDistanceError] = useState({ visible: false, message: '' });
  
  // Ref para BottomSheet de chat
  const chatBottomSheetRef = useRef(null);
  const chatSnapPoints = ['45%', '64%']; // Reduzido 25% (era 60% e 85%)
  
  // Ref para ScrollView de mensagens
  const messagesScrollViewRef = useRef(null);

  useEffect(() => {
    // Simular cálculo de tempo e distância
    if (booking?.pickup_location && booking?.driver_location) {
      // Aqui você implementaria a lógica real de cálculo
      setEstimatedTime('5');
      setEstimatedDistance('2.3 km');
    }
  }, [booking]);

  // ✅ Efeito para calcular e atualizar barra de progresso
  useEffect(() => {
    if (!booking) return;
    
    let intervalId = null;
    let isMounted = true;

    const updateProgress = async () => {
      if (!isMounted) return;
      
      try {
        // Obter coordenadas do ponto de partida
        let pickupLat = null;
        let pickupLng = null;
        
        if (booking?.pickup_location?.latitude && booking?.pickup_location?.longitude) {
          pickupLat = booking.pickup_location.latitude;
          pickupLng = booking.pickup_location.longitude;
        } else if (booking?.pickup_location?.lat && booking?.pickup_location?.lng) {
          pickupLat = booking.pickup_location.lat;
          pickupLng = booking.pickup_location.lng;
        } else if (booking?.pickup?.lat && booking?.pickup?.lng) {
          pickupLat = booking.pickup.lat;
          pickupLng = booking.pickup.lng;
        } else if (booking?.pickupLocation?.lat && booking?.pickupLocation?.lng) {
          pickupLat = booking.pickupLocation.lat;
          pickupLng = booking.pickupLocation.lng;
        }

        if (!pickupLat || !pickupLng) return;

        // Obter localização atual do motorista
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== 'granted') return;

        const currentLocation = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.High
        });

        const driverLat = currentLocation.coords.latitude;
        const driverLng = currentLocation.coords.longitude;

        // Calcular distância atual
        const distanceInKm = GetDistance(driverLat, driverLng, pickupLat, pickupLng);
        const distanceInMeters = distanceInKm * 1000;

        if (!isMounted) return;

        // Se ainda não temos distância inicial, definir como a atual
        if (initialDistance === null) {
          setInitialDistance(distanceInMeters);
          setCurrentDistance(distanceInMeters);
          setProgressPercent(0);
          return;
        }

        // ✅ Otimização: Usar refs para comparar sem causar re-renderizações
        const distanceDiff = Math.abs(distanceInMeters - (lastDistanceRef.current || 0));
        
        // ✅ Throttling: Só atualizar se passou tempo suficiente E distância mudou significativamente
        const now = Date.now();
        const timeSinceLastUpdate = now - lastUpdateTimeRef.current;
        const MIN_UPDATE_INTERVAL = 3000; // 3 segundos mínimo entre updates visuais
        
        if (distanceDiff < 10 && currentDistance !== null && timeSinceLastUpdate < MIN_UPDATE_INTERVAL) {
          // Mas ainda verificar se chegou perto o suficiente para esconder erro
          if (distanceInMeters <= 50 && distanceError.visible) {
            setDistanceError({ visible: false, message: '' });
          }
          return; // Não atualizar se mudança for muito pequena ou muito frequente
        }

        // ✅ Atualizar refs antes de setState para evitar loops
        lastDistanceRef.current = distanceInMeters;
        lastUpdateTimeRef.current = now;
        
        // ✅ Só atualizar estado se realmente mudou (evita re-renderizações)
        if (Math.abs(distanceInMeters - (currentDistance || 0)) >= 10) {
          setCurrentDistance(distanceInMeters);
        }
        
        // ✅ Esconder erro se chegou perto
        if (distanceInMeters <= 50 && distanceError.visible) {
          setDistanceError({ visible: false, message: '' });
        }

        // Calcular percentual de progresso
        // Progresso = (distância inicial - distância atual) / distância inicial * 100
        let percent = 0;
        if (initialDistance > 0) {
          percent = Math.max(0, Math.min(100, ((initialDistance - distanceInMeters) / initialDistance) * 100));
        }

        // ✅ Otimização: Só atualizar se o percentual mudou significativamente (mais de 2%)
        const percentDiff = Math.abs(percent - lastPercentRef.current);
        if (percentDiff < 2 && progressPercent !== 0) {
          return;
        }
        
        lastPercentRef.current = percent;
        
        // ✅ Só atualizar estado se realmente mudou
        if (Math.abs(percent - progressPercent) >= 2) {
          setProgressPercent(percent);
        }

        // Animar barra de progresso (só se mudou significativamente)
        if (percentDiff >= 2) {
          Animated.timing(progressAnimation, {
            toValue: percent,
            duration: 500,
            useNativeDriver: false
          }).start();
        }

      } catch (error) {
        Logger.error('❌ Erro ao atualizar progresso:', error);
      }
    };

    // Atualizar imediatamente
    updateProgress();

    // ✅ Reduzir frequência para 5 segundos (era 2 segundos) para evitar piscar
    intervalId = setInterval(updateProgress, 5000);

    return () => {
      isMounted = false;
      if (intervalId) {
        clearInterval(intervalId);
      }
    };
  }, [booking?.id, initialDistance, currentDistance, progressPercent, distanceError.visible]);

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
          
          // ✅ NOVO: Incrementar contador de mensagens não lidas se for do passageiro e o chat estiver fechado
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
        
        // ✅ NOVO: Incrementar contador de mensagens não lidas se for do passageiro e o chat estiver fechado
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

  const handleArrived = async () => {
    try {
      // ✅ Obter coordenadas do ponto de partida (suporta múltiplos formatos)
      let pickupLat = null;
      let pickupLng = null;
      
      if (booking?.pickup_location?.latitude && booking?.pickup_location?.longitude) {
        pickupLat = booking.pickup_location.latitude;
        pickupLng = booking.pickup_location.longitude;
      } else if (booking?.pickup_location?.lat && booking?.pickup_location?.lng) {
        pickupLat = booking.pickup_location.lat;
        pickupLng = booking.pickup_location.lng;
      } else if (booking?.pickup?.lat && booking?.pickup?.lng) {
        pickupLat = booking.pickup.lat;
        pickupLng = booking.pickup.lng;
      } else if (booking?.pickupLocation?.lat && booking?.pickupLocation?.lng) {
        pickupLat = booking.pickupLocation.lat;
        pickupLng = booking.pickupLocation.lng;
      }

      if (!pickupLat || !pickupLng) {
        Alert.alert('Erro', 'Localização de embarque não disponível');
        return;
      }

      // Obter localização atual do motorista
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Erro', 'Permissão de localização necessária');
        return;
      }

      const currentLocation = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.High
      });

      const driverLat = currentLocation.coords.latitude;
      const driverLng = currentLocation.coords.longitude;

      // Calcular distância em metros usando Haversine
      const distanceInKm = GetDistance(driverLat, driverLng, pickupLat, pickupLng);
      const distanceInMeters = distanceInKm * 1000;

      Logger.log('📍 [DriverEnRouteUI] Validação de distância:', {
        driverLocation: { lat: driverLat, lng: driverLng },
        pickupLocation: { lat: pickupLat, lng: pickupLng },
        distanceMeters: distanceInMeters.toFixed(2),
        isValid: distanceInMeters <= 50
      });

      // Validar se está a 50 metros ou menos
      if (distanceInMeters > 50) {
        const passengerName = booking?.customer_name || booking?.passenger_name || 'o passageiro';
        setDistanceError({
          visible: true,
          message: `Por favor, chegue mais perto do local de partida de ${passengerName}`
        });
        return;
      }
      
      // Se chegou perto, esconder erro
      setDistanceError({ visible: false, message: '' });

      // ✅ Se passou na validação, mostrar confirmação
      Alert.alert(
        t('arrived_at_pickup'),
        t('confirm_arrival'),
        [
          { text: t('no'), style: 'cancel' },
          { text: t('yes'), onPress: onArrived }
        ]
      );
    } catch (error) {
      Logger.error('❌ Erro ao validar distância:', error);
      Alert.alert('Erro', 'Não foi possível validar a localização. Tente novamente.');
    }
  };

  const handleCancelRide = async () => {
    Alert.alert(
      'Cancelar Corrida',
      'Tem certeza que deseja cancelar esta corrida?',
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
                
                // Navegar de volta para a tela principal
                // O Redux state será atualizado pelo backend
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

  const handleContactPassenger = () => {
    if (booking?.customer_phone) {
      const phoneNumber = booking.customer_phone.replace(/\D/g, ''); // Remove caracteres não numéricos
      Linking.openURL(`tel:${phoneNumber}`);
    }
  };

  const handleNavigateToPickup = async () => {
    if (!booking?.pickup_location) return;
    
    const { latitude, longitude } = booking.pickup_location;
    const address = booking?.pickup_address || 'Local de Embarque';
    
    try {
      // Verificar se Google Maps está instalado
      const isGoogleMapsInstalled = await Linking.canOpenURL(
        Platform.OS === 'ios' ? 'comgooglemaps://' : 'google.navigation:q='
      );
      
      // Verificar se Waze está instalado
      const isWazeInstalled = await Linking.canOpenURL('waze://');
      
      if (!isGoogleMapsInstalled && !isWazeInstalled) {
        // Nenhum app de navegação instalado, abrir no navegador
        const url = `https://www.google.com/maps/dir/?api=1&destination=${latitude},${longitude}`;
        await Linking.openURL(url);
        return;
      }
      
      // Mostrar opções de navegação
      const navigationOptions = [];
      
      if (isGoogleMapsInstalled) {
        navigationOptions.push({
          text: '🗺️ Google Maps',
          onPress: async () => {
            try {
              const destination = `${latitude},${longitude}`;
              const url = Platform.OS === 'ios' 
                ? `comgooglemaps://?daddr=${destination}&q=${encodeURIComponent(address)}`
                : `google.navigation:q=${destination}`;
              await Linking.openURL(url);
            } catch (error) {
              Logger.error('Erro ao abrir Google Maps:', error);
              const webUrl = `https://www.google.com/maps/dir/?api=1&destination=${latitude},${longitude}`;
              await Linking.openURL(webUrl);
            }
          }
        });
      }
      
      if (isWazeInstalled) {
        navigationOptions.push({
          text: '🧭 Waze',
          onPress: async () => {
            try {
              let url;
              if (address && address !== 'Local de Embarque') {
                url = `waze://?q=${encodeURIComponent(address)}&navigate=yes`;
              } else {
                url = `waze://?ll=${latitude},${longitude}&navigate=yes`;
              }
              await Linking.openURL(url);
            } catch (error) {
              Logger.error('Erro ao abrir Waze:', error);
              const webUrl = `https://www.google.com/maps/dir/?api=1&destination=${latitude},${longitude}`;
              await Linking.openURL(webUrl);
            }
          }
        });
      }
      
      // Adicionar opção de navegador web
      navigationOptions.push({
        text: '🌐 Navegador Web',
        onPress: () => {
          const url = `https://www.google.com/maps/dir/?api=1&destination=${latitude},${longitude}`;
          Linking.openURL(url);
        }
      });
      
      // Adicionar opção de cancelar
      navigationOptions.push({
        text: 'Cancelar',
        style: 'cancel'
      });
      
      Alert.alert(
        'Navegar para Embarque',
        'Escolha seu app de navegação:',
        navigationOptions
      );
      
    } catch (error) {
      Logger.error('Erro ao abrir navegação:', error);
      Alert.alert('Erro', 'Não foi possível abrir a navegação.');
    }
  };

  return (
    <>
      {/* ✅ NOVO: Banner de status de conexão */}
      <NetworkStatusBanner />
      
      {/* Card pequeno no topo (mesma posição do PassengerUI) */}
      <View style={styles.topCard}>
        <View style={styles.topCardContent}>
          <Ionicons name="car" size={20} color={LEAF_GREEN} />
          <View style={styles.topCardTextContainer}>
            <Text style={styles.topCardText}>
              A caminho do embarque de <Text style={styles.topCardBold}>{booking?.customer_name || 'Passageiro'}</Text>
              {estimatedTime !== '--' && (
                <Text style={styles.topCardTime}> • {estimatedTime} min</Text>
              )}
            </Text>
            
            {/* ✅ Barra de progresso animada */}
            {initialDistance !== null && (
              <View style={styles.progressContainer}>
                <View style={styles.progressBarBackground}>
                  <Animated.View
                    style={[
                      styles.progressBarFill,
                      {
                        width: progressAnimation.interpolate({
                          inputRange: [0, 100],
                          outputRange: ['0%', '100%']
                        })
                      }
                    ]}
                  />
                </View>
                {currentDistance !== null && (
                  <Text style={styles.progressText}>
                    {Math.round(progressPercent)}% • {currentDistance < 1000 
                      ? `${Math.round(currentDistance)}m` 
                      : `${(currentDistance / 1000).toFixed(1)}km`} restantes
                  </Text>
                )}
              </View>
            )}
          </View>
        </View>
      </View>

      {/* Card compacto na parte inferior */}
      <View style={styles.bottomCard}>
        {/* Botão de mensagem */}
        <TouchableOpacity 
          style={styles.messageButton}
          onPress={() => {
            setIsChatBottomSheetOpen(true);
            setUnreadMessagesCount(0); // ✅ Resetar contador ao abrir
            chatBottomSheetRef.current?.expand();
          }}
        >
          <Ionicons name="chatbubble-outline" size={20} color={LEAF_GREEN} />
          <Text style={styles.messageButtonText}>Enviar mensagem</Text>
          {unreadMessagesCount > 0 && (
            <View style={styles.unreadBadge}>
              <Text style={styles.unreadBadgeText}>
                {unreadMessagesCount > 9 ? '9+' : unreadMessagesCount}
              </Text>
            </View>
          )}
        </TouchableOpacity>

        {/* Botão principal - Cheguei */}
        <TouchableOpacity style={styles.arrivedButton} onPress={handleArrived}>
          <Text style={styles.arrivedButtonText}>{t('arrived_at_pickup')}</Text>
        </TouchableOpacity>

        {/* Botão de cancelar */}
        <TouchableOpacity style={styles.cancelButton} onPress={handleCancelRide}>
          <Text style={styles.cancelButtonText}>Cancelar</Text>
        </TouchableOpacity>
      </View>

      {/* Modal de erro de distância */}
      <Modal
        visible={distanceError.visible}
        transparent={true}
        animationType="fade"
        onRequestClose={() => setDistanceError({ visible: false, message: '' })}
      >
        <View style={styles.distanceErrorOverlay}>
          <View style={styles.distanceErrorCard}>
            <Ionicons name="alert-circle" size={32} color="#FF3B30" style={styles.distanceErrorIcon} />
            <Text style={styles.distanceErrorText}>{distanceError.message}</Text>
            <TouchableOpacity
              style={styles.distanceErrorButton}
              onPress={() => setDistanceError({ visible: false, message: '' })}
            >
              <Text style={styles.distanceErrorButtonText}>Entendi</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* BottomSheet de Chat */}
      <BottomSheet
        ref={chatBottomSheetRef}
        index={-1}
        snapPoints={chatSnapPoints}
        enablePanDownToClose={true}
        backdropComponent={renderChatBackdrop}
        onChange={(index) => {
          setIsChatBottomSheetOpen(index >= 0);
          // ✅ Resetar contador quando abrir o bottom sheet
          if (index >= 0) {
            setUnreadMessagesCount(0);
          }
        }}
      >
        <BottomSheetView style={styles.chatBottomSheetContent}>
          <View style={styles.chatHeader}>
            <Text style={styles.chatHeaderTitle}>Conversa com {booking?.customer_name || 'Passageiro'}</Text>
            <TouchableOpacity
              onPress={() => {
                chatBottomSheetRef.current?.close();
                setIsChatBottomSheetOpen(false);
              }}
            >
              <Ionicons name="close" size={24} color="#333" />
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
                <Ionicons name="chatbubbles-outline" size={48} color="#CCC" />
                <Text style={styles.emptyMessagesText}>Nenhuma mensagem ainda</Text>
                <Text style={styles.emptyMessagesSubtext}>Envie uma mensagem para o passageiro</Text>
              </View>
            ) : (
              chatMessages.map((message) => (
                <View
                  key={message.id}
                  style={[
                    styles.messageBubble,
                    message.isOwn ? styles.messageBubbleOwn : styles.messageBubbleOther
                  ]}
                >
                  <Text style={[
                    styles.messageText,
                    message.isOwn ? styles.messageTextOwn : styles.messageTextOther
                  ]}>
                    {message.text}
                  </Text>
                  <Text style={[
                    styles.messageTime,
                    message.isOwn ? styles.messageTimeOwn : styles.messageTimeOther
                  ]}>
                    {new Date(message.timestamp).toLocaleTimeString('pt-BR', {
                      hour: '2-digit',
                      minute: '2-digit'
                    })}
                  </Text>
                </View>
              ))
            )}
          </ScrollView>

          <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
            style={styles.chatInputContainer}
          >
            <View style={styles.chatInputWrapper}>
              <TextInput
                style={styles.chatInput}
                placeholder="Digite sua mensagem..."
                placeholderTextColor="#999"
                value={messageText}
                onChangeText={setMessageText}
                multiline
                maxLength={500}
              />
              <TouchableOpacity
                style={[
                  styles.sendButton,
                  !messageText.trim() && styles.sendButtonDisabled
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
});

const styles = StyleSheet.create({
  // Card no topo (mesma posição do PassengerUI)
  topCard: {
    position: 'absolute',
    top: 75,
    left: 0,
    right: 0,
    zIndex: 900,
    alignItems: 'center',
  },
  topCardContent: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    width: '92%',
    paddingVertical: 12,
    paddingHorizontal: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 10,
    elevation: 6,
  },
  topCardTextContainer: {
    flex: 1,
    marginLeft: 12,
  },
  topCardText: {
    fontSize: 14,
    fontFamily: fonts.Regular,
    color: '#333',
    lineHeight: 20,
  },
  topCardBold: {
    fontFamily: fonts.Bold,
    fontWeight: 'bold',
  },
  topCardTime: {
    fontFamily: fonts.Bold,
    fontWeight: 'bold',
    color: LEAF_GREEN,
  },
  progressContainer: {
    marginTop: 8,
  },
  progressBarBackground: {
    height: 4,
    backgroundColor: '#E0E0E0',
    borderRadius: 2,
    overflow: 'hidden',
    marginBottom: 4,
  },
  progressBarFill: {
    height: '100%',
    backgroundColor: LEAF_GREEN,
    borderRadius: 2,
  },
  progressText: {
    fontSize: 11,
    fontFamily: fonts.Bold,
    fontWeight: 'bold',
    color: '#666',
    marginTop: 2,
    textAlign: 'center',
  },
  // Card compacto na parte inferior
  bottomCard: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 10,
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
  arrivedButton: {
    backgroundColor: LEAF_GREEN,
    paddingVertical: 15,
    paddingHorizontal: 30,
    borderRadius: 25,
    alignItems: 'center',
    marginBottom: 8,
  },
  arrivedButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontFamily: fonts.Regular,
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
  distanceErrorOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  distanceErrorCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    padding: 24,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 8,
    minWidth: 280,
    maxWidth: '90%',
  },
  distanceErrorIcon: {
    marginBottom: 16,
  },
  distanceErrorText: {
    fontSize: 16,
    fontFamily: fonts.Regular,
    color: '#333',
    textAlign: 'center',
    marginBottom: 24,
    lineHeight: 22,
  },
  distanceErrorButton: {
    backgroundColor: LEAF_GREEN,
    paddingVertical: 12,
    paddingHorizontal: 32,
    borderRadius: 12,
    minWidth: 120,
  },
  distanceErrorButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontFamily: fonts.Bold,
    fontWeight: 'bold',
    textAlign: 'center',
  },
});

export default DriverEnRouteUI; 