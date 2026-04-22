import Logger from '../utils/Logger';
/**
 * 📱 EXEMPLO DE USO - HOOK WEBSOCKET LISTENERS
 * Como integrar listeners automáticos nas telas principais
 */

import React, { useEffect, useState } from 'react';
import { View, Text, Alert } from 'react-native';
import { useSelector } from 'react-redux';
import useWebSocketListeners from '../hooks/useWebSocketListeners';


// ==================== EXEMPLO 1: TELA PRINCIPAL DO CUSTOMER ====================

const CustomerMainScreen = ({ navigation }) => {
  const auth = useSelector(state => state.auth);
  const currentUser = auth.profile;
  const [rideStatus, setRideStatus] = useState('idle');
  const [driverLocation, setDriverLocation] = useState(null);

  // USAR HOOK DE LISTENERS AUTOMÁTICOS
  const { addCustomListener, removeCustomListener, isConnected } = useWebSocketListeners(
    'customer', // userType
    currentUser?.id, // userId
    {
      enableRideUpdates: true,
      enableDriverUpdates: true,
      enableSupportUpdates: true,
      enableChatUpdates: true,
      enableNotificationUpdates: true,
      enableSafetyUpdates: true
    }
  );

  // Listener customizado para atualizar estado da corrida
  useEffect(() => {
    const handleRideAccepted = (data) => {
      setRideStatus('accepted');
      Alert.alert('Corrida Aceita!', 'Seu motorista está a caminho');
      navigation.navigate('TripTrackingScreen', { bookingData: data });
    };

    const handleDriverLocationUpdate = (data) => {
      setDriverLocation(data.location);
      // Atualizar posição do motorista no mapa
    };

    // Adicionar listeners customizados
    addCustomListener('rideAccepted', handleRideAccepted);
    addCustomListener('driverLocationUpdated', handleDriverLocationUpdate);

    // Cleanup
    return () => {
      removeCustomListener('rideAccepted');
      removeCustomListener('driverLocationUpdated');
    };
  }, [addCustomListener, removeCustomListener, navigation]);

  return (
    <View>
      <Text>Status da Conexão: {isConnected ? 'Conectado' : 'Desconectado'}</Text>
      <Text>Status da Corrida: {rideStatus}</Text>
      {driverLocation && (
        <Text>Localização do Motorista: {driverLocation.lat}, {driverLocation.lng}</Text>
      )}
    </View>
  );
};

// ==================== EXEMPLO 2: TELA PRINCIPAL DO DRIVER ====================

const DriverMainScreen = ({ navigation }) => {
  const auth = useSelector(state => state.auth);
  const currentUser = auth.profile;
  const [pendingRides, setPendingRides] = useState([]);
  const [driverStatus, setDriverStatus] = useState('offline');

  // USAR HOOK DE LISTENERS AUTOMÁTICOS
  const { addCustomListener, removeCustomListener, wsManager } = useWebSocketListeners(
    'driver', // userType
    currentUser?.id, // userId
    {
      enableRideUpdates: true,
      enableDriverUpdates: true,
      enableSupportUpdates: false, // Driver não precisa de suporte
      enableChatUpdates: true,
      enableNotificationUpdates: true,
      enableSafetyUpdates: true
    }
  );

  // Listener customizado para novas corridas
  useEffect(() => {
    const handleNewRideRequest = (data) => {
      setPendingRides(prev => [...prev, data]);
      Alert.alert(
        'Nova Corrida!',
        `Corrida de R$ ${data.estimatedFare} - ${data.pickupLocation.address}`,
        [
          { text: 'Recusar', onPress: () => rejectRide(data.bookingId) },
          { text: 'Aceitar', onPress: () => acceptRide(data.bookingId) }
        ]
      );
    };

    const handleStatusChange = (data) => {
      setDriverStatus(data.status);
    };

    // Adicionar listeners customizados
    addCustomListener('rideRequest', handleNewRideRequest);
    addCustomListener('driverStatusChanged', handleStatusChange);

    // Cleanup
    return () => {
      removeCustomListener('rideRequest');
      removeCustomListener('driverStatusChanged');
    };
  }, [addCustomListener, removeCustomListener]);

  const acceptRide = async (bookingId) => {
    try {
      await wsManager.driverResponse(bookingId, true);
      Logger.log('✅ Corrida aceita');
    } catch (error) {
      Logger.error('Erro ao aceitar corrida:', error);
    }
  };

  const rejectRide = async (bookingId) => {
    try {
      await wsManager.driverResponse(bookingId, false, 'Não disponível');
      Logger.log('❌ Corrida rejeitada');
    } catch (error) {
      Logger.error('Erro ao rejeitar corrida:', error);
    }
  };

  return (
    <View>
      <Text>Status: {driverStatus}</Text>
      <Text>Corridas Pendentes: {pendingRides.length}</Text>
    </View>
  );
};

// ==================== EXEMPLO 3: TELA DE SUPORTE ====================

const SupportMainScreen = () => {
  const auth = useSelector(state => state.auth);
  const currentUser = auth.profile;
  const [tickets, setTickets] = useState([]);
  const [supportMessages, setSupportMessages] = useState([]);

  // USAR HOOK DE LISTENERS AUTOMÁTICOS
  const { addCustomListener, removeCustomListener } = useWebSocketListeners(
    'customer', // userType
    currentUser?.id, // userId
    {
      enableRideUpdates: false, // Suporte não precisa de corridas
      enableDriverUpdates: false,
      enableSupportUpdates: true, // Apenas suporte
      enableChatUpdates: true,
      enableNotificationUpdates: true,
      enableSafetyUpdates: true
    }
  );

  // Listeners customizados para suporte
  useEffect(() => {
    const handleNewTicket = (data) => {
      setTickets(prev => [data, ...prev]);
      Alert.alert('Novo Ticket', `Ticket ${data.ticketId} criado com sucesso!`);
    };

    const handleSupportMessage = (data) => {
      if (data.chatType === 'support') {
        setSupportMessages(prev => [...prev, data]);
      }
    };

    const handleIncidentReport = (data) => {
      Alert.alert(
        'Incidente Reportado',
        `Incidente ${data.reportId} reportado com prioridade ${data.data.priority}`
      );
    };

    // Adicionar listeners customizados
    addCustomListener('supportTicketCreated', handleNewTicket);
    addCustomListener('messageSent', handleSupportMessage);
    addCustomListener('incidentReported', handleIncidentReport);

    // Cleanup
    return () => {
      removeCustomListener('supportTicketCreated');
      removeCustomListener('messageSent');
      removeCustomListener('incidentReported');
    };
  }, [addCustomListener, removeCustomListener]);

  return (
    <View>
      <Text>Tickets: {tickets.length}</Text>
      <Text>Mensagens de Suporte: {supportMessages.length}</Text>
    </View>
  );
};

// ==================== EXEMPLO 4: TELA DE CHAT ====================

const ChatMainScreen = ({ tripId }) => {
  const auth = useSelector(state => state.auth);
  const currentUser = auth.profile;
  const [messages, setMessages] = useState([]);
  const [isTyping, setIsTyping] = useState(false);

  // USAR HOOK DE LISTENERS AUTOMÁTICOS
  const { addCustomListener, removeCustomListener } = useWebSocketListeners(
    currentUser?.userType, // userType
    currentUser?.id, // userId
    {
      enableRideUpdates: false,
      enableDriverUpdates: false,
      enableSupportUpdates: false,
      enableChatUpdates: true, // Apenas chat
      enableNotificationUpdates: false,
      enableSafetyUpdates: false
    }
  );

  // Listeners customizados para chat
  useEffect(() => {
    const handleNewMessage = (data) => {
      if (data.chatId === tripId) {
        setMessages(prev => [...prev, data]);
      }
    };

    const handleTypingStatus = (data) => {
      if (data.chatId === tripId && data.userId !== currentUser.id) {
        setIsTyping(data.isTyping);
      }
    };

    // Adicionar listeners customizados
    addCustomListener('messageSent', handleNewMessage);
    addCustomListener('typingStatus', handleTypingStatus);

    // Cleanup
    return () => {
      removeCustomListener('messageSent');
      removeCustomListener('typingStatus');
    };
  }, [addCustomListener, removeCustomListener, tripId, currentUser.id]);

  return (
    <View>
      <Text>Mensagens: {messages.length}</Text>
      <Text>Status: {isTyping ? 'Digitando...' : 'Online'}</Text>
    </View>
  );
};

// ==================== EXEMPLO 5: TELA DE CONFIGURAÇÕES ====================

const SettingsScreen = () => {
  const auth = useSelector(state => state.auth);
  const currentUser = auth.profile;
  const [notificationSettings, setNotificationSettings] = useState({});

  // USAR HOOK DE LISTENERS AUTOMÁTICOS
  const { addCustomListener, removeCustomListener, wsManager } = useWebSocketListeners(
    currentUser?.userType, // userType
    currentUser?.id, // userId
    {
      enableRideUpdates: false,
      enableDriverUpdates: false,
      enableSupportUpdates: false,
      enableChatUpdates: false,
      enableNotificationUpdates: true, // Apenas notificações
      enableSafetyUpdates: false
    }
  );

  // Listener customizado para configurações
  useEffect(() => {
    const handleNotificationUpdate = (data) => {
      setNotificationSettings(data.data);
      Alert.alert('Configurações Atualizadas', 'Suas preferências foram salvas');
    };

    // Adicionar listener customizado
    addCustomListener('notificationPreferencesUpdated', handleNotificationUpdate);

    // Cleanup
    return () => {
      removeCustomListener('notificationPreferencesUpdated');
    };
  }, [addCustomListener, removeCustomListener]);

  const updateNotificationPreferences = async (preferences) => {
    try {
      await wsManager.updateNotificationPreferences(preferences);
    } catch (error) {
      Logger.error('Erro ao atualizar preferências:', error);
    }
  };

  return (
    <View>
      <Text>Configurações de Notificação:</Text>
      <Text>Atualizações de Corrida: {notificationSettings.rideUpdates ? 'Ativo' : 'Inativo'}</Text>
      <Text>Promoções: {notificationSettings.promotions ? 'Ativo' : 'Inativo'}</Text>
    </View>
  );
};

export {
  CustomerMainScreen,
  DriverMainScreen,
  SupportMainScreen,
  ChatMainScreen,
  SettingsScreen
};






