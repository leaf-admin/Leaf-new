import Logger from '../utils/Logger';
/**
 * 🔄 HOOK PERSONALIZADO - WEBSOCKET LISTENERS AUTOMÁTICOS
 * Gerencia listeners automáticos para eventos em tempo real
 */

import { useEffect, useRef, useCallback } from 'react';
import WebSocketManager from '../services/WebSocketManager';


const useWebSocketListeners = (userType, userId, options = {}) => {
  const wsManager = WebSocketManager.getInstance();
  const listenersRef = useRef(new Map());
  const isInitialized = useRef(false);

  // Configurações padrão
  const defaultOptions = {
    enableRideUpdates: true,
    enableDriverUpdates: true,
    enableSupportUpdates: true,
    enableChatUpdates: true,
    enableNotificationUpdates: true,
    enableSafetyUpdates: true,
    ...options
  };

  // Limpar listeners existentes
  const cleanupListeners = useCallback(() => {
    listenersRef.current.forEach((callback, event) => {
      wsManager.off(event);
    });
    listenersRef.current.clear();
  }, [wsManager]);

  // Adicionar listener
  const addListener = useCallback((event, callback) => {
    if (listenersRef.current.has(event)) {
      wsManager.off(event);
    }
    
    wsManager.on(event, callback);
    listenersRef.current.set(event, callback);
  }, [wsManager]);

  // Configurar listeners para CUSTOMER
  const setupCustomerListeners = useCallback(() => {
    if (!defaultOptions.enableRideUpdates) return;

    // Listener para atualizações de corrida
    addListener('rideAccepted', (data) => {
      Logger.log('🎉 Corrida aceita pelo motorista:', data);
      // Aqui você pode atualizar o estado da aplicação
      // Ex: navigation.navigate('TripTrackingScreen')
    });

    addListener('rideRejected', (data) => {
      Logger.log('❌ Corrida rejeitada pelo motorista:', data);
      // Ex: mostrar modal de busca por novo motorista
    });

    addListener('tripStarted', (data) => {
      Logger.log('🚗 Viagem iniciada:', data);
      // Ex: atualizar UI para mostrar que a viagem começou
    });

    addListener('tripCompleted', (data) => {
      Logger.log('✅ Viagem concluída:', data);
      // Ex: navegar para tela de avaliação
    });

    addListener('driverLocationUpdated', (data) => {
      Logger.log('📍 Localização do motorista atualizada:', data);
      // Ex: atualizar posição do motorista no mapa
    });

    // Listener para cancelamento com reembolso
    addListener('rideCancelled', (data) => {
      Logger.log('❌ Corrida cancelada - Reembolso:', data);
      // Ex: mostrar modal de confirmação de reembolso
    });
  }, [addListener]);

  // Configurar listeners para DRIVER
  const setupDriverListeners = useCallback(() => {
    if (!defaultOptions.enableDriverUpdates) return;

    // Listener para solicitações de corrida
    addListener('rideRequest', (data) => {
      Logger.log('🚗 Nova solicitação de corrida:', data);
      // Ex: mostrar modal de aceitar/rejeitar corrida
    });

    addListener('bookingCreated', (data) => {
      Logger.log('📋 Nova corrida criada:', data);
      // Ex: atualizar lista de corridas pendentes
    });

    // Listener para mudanças de status
    addListener('driverStatusChanged', (data) => {
      Logger.log('🔄 Status do driver alterado:', data);
      // Ex: atualizar indicador de status na UI
    });

    // Listener para atualizações de localização
    addListener('locationUpdated', (data) => {
      Logger.log('📍 Localização atualizada:', data);
      // Ex: atualizar posição no mapa
    });
  }, [addListener]);

  // Configurar listeners para SUPORTE
  const setupSupportListeners = useCallback(() => {
    if (!defaultOptions.enableSupportUpdates) return;

    // Listener para tickets de suporte
    addListener('supportTicketCreated', (data) => {
      Logger.log('🎫 Novo ticket de suporte:', data);
      // Ex: atualizar lista de tickets
    });

    addListener('supportTicketUpdated', (data) => {
      Logger.log('🔄 Ticket de suporte atualizado:', data);
      // Ex: atualizar status do ticket
    });

    // Listener para mensagens de suporte
    addListener('messageSent', (data) => {
      if (data.chatType === 'support') {
        Logger.log('💬 Nova mensagem de suporte:', data);
        // Ex: atualizar chat de suporte
      }
    });
  }, [addListener]);

  // Configurar listeners para CHAT
  const setupChatListeners = useCallback(() => {
    if (!defaultOptions.enableChatUpdates) return;

    // Listener para mensagens de chat
    addListener('messageSent', (data) => {
      if (data.chatType === 'trip_chat') {
        Logger.log('💬 Nova mensagem no chat:', data);
        // Ex: atualizar chat da viagem
      }
    });

    addListener('chatCreated', (data) => {
      Logger.log('💬 Chat criado:', data);
      // Ex: inicializar chat
    });

    // Listener para status de digitação
    addListener('typingStatus', (data) => {
      Logger.log('⌨️ Status de digitação:', data);
      // Ex: mostrar indicador de "digitando..."
    });
  }, [addListener]);

  // Configurar listeners para NOTIFICAÇÕES
  const setupNotificationListeners = useCallback(() => {
    if (!defaultOptions.enableNotificationUpdates) return;

    // Listener para preferências de notificação
    addListener('notificationPreferencesUpdated', (data) => {
      Logger.log('🔔 Preferências de notificação atualizadas:', data);
      // Ex: atualizar configurações de notificação
    });

    // Listener para notificações do sistema
    addListener('systemNotification', (data) => {
      Logger.log('📢 Notificação do sistema:', data);
      // Ex: mostrar notificação push
    });
  }, [addListener]);

  // Configurar listeners para SEGURANÇA
  const setupSafetyListeners = useCallback(() => {
    if (!defaultOptions.enableSafetyUpdates) return;

    // Listener para incidentes reportados
    addListener('incidentReported', (data) => {
      Logger.log('🚨 Incidente reportado:', data);
      // Ex: mostrar confirmação de incidente
    });

    // Listener para contatos de emergência
    addListener('emergencyContacted', (data) => {
      Logger.log('🚨 Contato de emergência realizado:', data);
      // Ex: mostrar confirmação de emergência
    });
  }, [addListener]);

  // Configurar listeners para ANALYTICS
  const setupAnalyticsListeners = useCallback(() => {
    // Listener para feedback
    addListener('feedbackReceived', (data) => {
      Logger.log('💬 Feedback recebido:', data);
      // Ex: mostrar mensagem de agradecimento
    });

    // Listener para ações rastreadas
    addListener('userActionTracked', (data) => {
      Logger.log('📊 Ação rastreada:', data);
      // Ex: atualizar analytics locais
    });
  }, [addListener]);

  // Inicializar listeners baseado no tipo de usuário
  const initializeListeners = useCallback(() => {
    if (isInitialized.current) return;
    
    Logger.log(`🔄 Configurando listeners automáticos para ${userType}`);
    
    // Configurar listeners baseado no tipo de usuário
    if (userType === 'customer') {
      setupCustomerListeners();
    } else if (userType === 'driver') {
      setupDriverListeners();
    }
    
    // Listeners comuns para todos os tipos de usuário
    setupSupportListeners();
    setupChatListeners();
    setupNotificationListeners();
    setupSafetyListeners();
    setupAnalyticsListeners();
    
    isInitialized.current = true;
    Logger.log('✅ Listeners automáticos configurados');
  }, [
    userType,
    setupCustomerListeners,
    setupDriverListeners,
    setupSupportListeners,
    setupChatListeners,
    setupNotificationListeners,
    setupSafetyListeners,
    setupAnalyticsListeners
  ]);

  // Conectar WebSocket e configurar listeners
  useEffect(() => {
    const connectAndSetup = async () => {
      try {
        // Conectar WebSocket se não estiver conectado
        if (!wsManager.isConnected()) {
          await wsManager.connect();
        }
        
        // Configurar listeners
        initializeListeners();
        
      } catch (error) {
        Logger.error('Erro ao configurar listeners automáticos:', error);
      }
    };

    connectAndSetup();

    // Cleanup ao desmontar
    return () => {
      cleanupListeners();
      isInitialized.current = false;
    };
  }, [wsManager, initializeListeners, cleanupListeners]);

  // Função para adicionar listener customizado
  const addCustomListener = useCallback((event, callback) => {
    addListener(event, callback);
  }, [addListener]);

  // Função para remover listener customizado
  const removeCustomListener = useCallback((event) => {
    if (listenersRef.current.has(event)) {
      wsManager.off(event);
      listenersRef.current.delete(event);
    }
  }, [wsManager]);

  return {
    addCustomListener,
    removeCustomListener,
    cleanupListeners,
    isConnected: wsManager.isConnected(),
    wsManager
  };
};

export default useWebSocketListeners;






