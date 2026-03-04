import Logger from '../utils/Logger';
import { useState, useEffect, useCallback, useRef } from 'react';
import webSocketManager from '../services/WebSocketManager';
const useWebSocket = (userId = null) => {
  const [connectionStatus, setConnectionStatus] = useState({
    isConnected: false,
    isAuthenticated: false,
    isConnecting: false,
    error: null,
  });

  const [data, setData] = useState({
    nearbyDrivers: [],
    locationUpdates: [],
    driverStatusUpdates: [],
    stats: null,
  });

  const reconnectTimeoutRef = useRef(null);
  const locationUpdateIntervalRef = useRef(null);

  // Conectar ao WebSocket
  const connect = useCallback(async (user = userId) => {
    if (connectionStatus.isConnecting || connectionStatus.isConnected) {
      Logger.log('WebSocket já está conectando ou conectado');
      return;
    }

    setConnectionStatus(prev => ({ ...prev, isConnecting: true, error: null }));

    try {
      await webSocketManager.connect();
      // Wait for socket to be ready and available
      const maxRetries = 10;
      let retries = 0;

      while (!webSocketManager.getSocket() && retries < maxRetries) {
        await new Promise(resolve => setTimeout(resolve, 500));
        retries++;
      }

      if (webSocketManager.getSocket()) {
        setConnectionStatus(prev => ({
          ...prev,
          isConnecting: false,
          isConnected: true,
          error: null
        }));

        if (user) {
          webSocketManager.authenticate(user);
        }
      } else {
        throw new Error("Timeout ao obter socket.");
      }
    } catch (error) {
      Logger.error('Erro ao conectar WebSocket:', error);
      setConnectionStatus(prev => ({
        ...prev,
        isConnecting: false,
        error: error.message
      }));
    }
  }, [userId, connectionStatus.isConnecting, connectionStatus.isConnected]);

  // Desconectar do WebSocket
  const disconnect = useCallback(() => {
    webSocketManager.disconnect();
    setConnectionStatus({
      isConnected: false,
      isAuthenticated: false,
      isConnecting: false,
      error: null,
    });
    setData({
      nearbyDrivers: [],
      locationUpdates: [],
      driverStatusUpdates: [],
      stats: null,
    });

    // Limpar intervalos
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
    if (locationUpdateIntervalRef.current) {
      clearInterval(locationUpdateIntervalRef.current);
      locationUpdateIntervalRef.current = null;
    }
  }, []);

  // Reconectar não é mais necessário manualmente pois o socket.io cuida disso
  const reconnect = useCallback(() => {
    Logger.log('🔄 Reconnect requisitado (ignorado favor do auto-reconnect do Socket.io)');
  }, []);

  // Atualizar localização
  const updateLocation = useCallback((latitude, longitude, platform = 'mobile') => {
    if (!connectionStatus.isConnected || !connectionStatus.isAuthenticated) {
      Logger.error('WebSocket não está pronto para enviar localização');
      return false;
    }

    const success = webSocketManager.updateDriverLocation(user, latitude, longitude);

    if (success) {
      setData(prev => ({
        ...prev,
        locationUpdates: [
          ...prev.locationUpdates,
          { latitude, longitude, timestamp: Date.now(), platform }
        ].slice(-10) // Manter apenas os últimos 10
      }));
    }

    return success;
  }, [connectionStatus.isConnected, connectionStatus.isAuthenticated]);

  // Buscar motoristas próximos
  const findNearbyDrivers = useCallback((latitude, longitude, radius = 5000, limit = 10) => {
    if (!connectionStatus.isConnected) {
      Logger.error('WebSocket não está conectado');
      return false;
    }

    return webSocketService.findNearbyDrivers(latitude, longitude, radius, limit);
  }, [connectionStatus.isConnected]);

  // Atualizar status do motorista
  const updateDriverStatus = useCallback((status, isOnline = true) => {
    if (!connectionStatus.isConnected || !connectionStatus.isAuthenticated) {
      Logger.error('WebSocket não está pronto para atualizar status');
      return false;
    }

    return webSocketService.updateDriverStatus(status, isOnline);
  }, [connectionStatus.isConnected, connectionStatus.isAuthenticated]);

  // Obter estatísticas
  const getStats = useCallback(() => {
    if (!connectionStatus.isConnected) {
      Logger.error('WebSocket não está conectado');
      return false;
    }

    return webSocketManager.emit('getStats');
  }, [connectionStatus.isConnected]);

  // Ping
  const ping = useCallback((data = {}) => {
    if (!connectionStatus.isConnected) {
      Logger.error('WebSocket não está conectado');
      return false;
    }

    return webSocketManager.emit('ping', data);
  }, [connectionStatus.isConnected]);

  // Iniciar atualização automática de localização
  const startLocationUpdates = useCallback((latitude, longitude, intervalMs = 2000) => {
    if (locationUpdateIntervalRef.current) {
      clearInterval(locationUpdateIntervalRef.current);
    }

    locationUpdateIntervalRef.current = setInterval(() => {
      updateLocation(latitude, longitude);
    }, intervalMs);

    Logger.log(`📍 Iniciando atualizações de localização a cada ${intervalMs}ms`);
  }, [updateLocation]);

  // Parar atualização automática de localização
  const stopLocationUpdates = useCallback(() => {
    if (locationUpdateIntervalRef.current) {
      clearInterval(locationUpdateIntervalRef.current);
      locationUpdateIntervalRef.current = null;
      Logger.log('📍 Parando atualizações de localização');
    }
  }, []);

  // Configurar listeners de eventos
  useEffect(() => {
    // Evento de conexão
    webSocketManager.on('connect', () => {
      setConnectionStatus(prev => ({
        ...prev,
        isConnected: true,
        isConnecting: false,
        error: null
      }));
    });

    // Evento de desconexão
    webSocketManager.on('disconnect', (reason) => {
      setConnectionStatus(prev => ({
        ...prev,
        isConnected: false,
        isAuthenticated: false,
        error: reason
      }));

      Logger.log(`🔌 [useWebSocket] Desconectado: ${reason}. Aguardando auto-reconnect...`);
    });

    // Evento de autenticação
    webSocketManager.on('authenticated', (authData) => {
      setConnectionStatus(prev => ({
        ...prev,
        isAuthenticated: true
      }));
    });

    // Evento de motoristas próximos
    webSocketManager.on('nearbyDrivers', (driversData) => {
      setData(prev => ({
        ...prev,
        nearbyDrivers: driversData.drivers || []
      }));
    });

    // Evento de atualização de localização
    webSocketManager.on('locationUpdated', (locationData) => {
      setData(prev => ({
        ...prev,
        locationUpdates: [
          ...prev.locationUpdates,
          locationData
        ].slice(-10)
      }));
    });

    // Evento de atualização de status do motorista
    webSocketManager.on('driverStatusUpdated', (statusData) => {
      setData(prev => ({
        ...prev,
        driverStatusUpdates: [
          ...prev.driverStatusUpdates,
          statusData
        ].slice(-10)
      }));
    });

    // Evento de erro
    webSocketManager.on('error', (error) => {
      setConnectionStatus(prev => ({
        ...prev,
        error: error.message || 'Erro WebSocket desconhecido'
      }));
    });

    // Cleanup
    return () => {
      disconnect();
    };
  }, [disconnect, reconnect]);

  // Conectar automaticamente quando userId mudar
  useEffect(() => {
    if (userId && !connectionStatus.isConnected && !connectionStatus.isConnecting) {
      connect(userId);
    }
  }, [userId, connect, connectionStatus.isConnected, connectionStatus.isConnecting]);

  return {
    // Status
    connectionStatus,

    // Dados
    data,

    // Métodos
    connect,
    disconnect,
    reconnect,
    updateLocation,
    findNearbyDrivers,
    updateDriverStatus,
    getStats,
    ping,
    startLocationUpdates,
    stopLocationUpdates,

    // Informações de debug
    debugInfo: webSocketManager.getConnectionStatus(),
  };
};

export default useWebSocket;