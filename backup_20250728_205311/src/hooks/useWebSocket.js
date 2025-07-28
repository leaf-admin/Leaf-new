import { useState, useEffect, useCallback, useRef } from 'react';
import webSocketService from '../services/WebSocketService';

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
      console.log('WebSocket já está conectando ou conectado');
      return;
    }

    setConnectionStatus(prev => ({ ...prev, isConnecting: true, error: null }));

    try {
      await webSocketService.connect(user);
      setConnectionStatus(prev => ({ 
        ...prev, 
        isConnecting: false, 
        isConnected: true,
        error: null 
      }));
    } catch (error) {
      console.error('Erro ao conectar WebSocket:', error);
      setConnectionStatus(prev => ({ 
        ...prev, 
        isConnecting: false, 
        error: error.message 
      }));
    }
  }, [userId, connectionStatus.isConnecting, connectionStatus.isConnected]);

  // Desconectar do WebSocket
  const disconnect = useCallback(() => {
    webSocketService.disconnect();
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

  // Reconectar automaticamente
  const reconnect = useCallback(() => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
    }

    reconnectTimeoutRef.current = setTimeout(() => {
      console.log('🔄 Tentando reconectar WebSocket...');
      connect();
    }, 3000); // 3 segundos
  }, [connect]);

  // Atualizar localização
  const updateLocation = useCallback((latitude, longitude, platform = 'mobile') => {
    if (!connectionStatus.isConnected || !connectionStatus.isAuthenticated) {
      console.error('WebSocket não está pronto para enviar localização');
      return false;
    }

    const success = webSocketService.updateLocation(latitude, longitude, platform);
    
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
      console.error('WebSocket não está conectado');
      return false;
    }

    return webSocketService.findNearbyDrivers(latitude, longitude, radius, limit);
  }, [connectionStatus.isConnected]);

  // Atualizar status do motorista
  const updateDriverStatus = useCallback((status, isOnline = true) => {
    if (!connectionStatus.isConnected || !connectionStatus.isAuthenticated) {
      console.error('WebSocket não está pronto para atualizar status');
      return false;
    }

    return webSocketService.updateDriverStatus(status, isOnline);
  }, [connectionStatus.isConnected, connectionStatus.isAuthenticated]);

  // Obter estatísticas
  const getStats = useCallback(() => {
    if (!connectionStatus.isConnected) {
      console.error('WebSocket não está conectado');
      return false;
    }

    return webSocketService.getStats();
  }, [connectionStatus.isConnected]);

  // Ping
  const ping = useCallback((data = {}) => {
    if (!connectionStatus.isConnected) {
      console.error('WebSocket não está conectado');
      return false;
    }

    return webSocketService.ping(data);
  }, [connectionStatus.isConnected]);

  // Iniciar atualização automática de localização
  const startLocationUpdates = useCallback((latitude, longitude, intervalMs = 2000) => {
    if (locationUpdateIntervalRef.current) {
      clearInterval(locationUpdateIntervalRef.current);
    }

    locationUpdateIntervalRef.current = setInterval(() => {
      updateLocation(latitude, longitude);
    }, intervalMs);

    console.log(`📍 Iniciando atualizações de localização a cada ${intervalMs}ms`);
  }, [updateLocation]);

  // Parar atualização automática de localização
  const stopLocationUpdates = useCallback(() => {
    if (locationUpdateIntervalRef.current) {
      clearInterval(locationUpdateIntervalRef.current);
      locationUpdateIntervalRef.current = null;
      console.log('📍 Parando atualizações de localização');
    }
  }, []);

  // Configurar listeners de eventos
  useEffect(() => {
    // Evento de conexão
    webSocketService.onConnect(() => {
      setConnectionStatus(prev => ({ 
        ...prev, 
        isConnected: true, 
        isConnecting: false,
        error: null 
      }));
    });

    // Evento de desconexão
    webSocketService.onDisconnect((reason) => {
      setConnectionStatus(prev => ({ 
        ...prev, 
        isConnected: false, 
        isAuthenticated: false 
      }));
      
      // Tentar reconectar automaticamente
      if (reason !== 'io client disconnect') {
        reconnect();
      }
    });

    // Evento de autenticação
    webSocketService.onAuthenticated((authData) => {
      setConnectionStatus(prev => ({ 
        ...prev, 
        isAuthenticated: true 
      }));
    });

    // Evento de motoristas próximos
    webSocketService.onNearbyDrivers((driversData) => {
      setData(prev => ({
        ...prev,
        nearbyDrivers: driversData.drivers || []
      }));
    });

    // Evento de atualização de localização
    webSocketService.onLocationUpdated((locationData) => {
      setData(prev => ({
        ...prev,
        locationUpdates: [
          ...prev.locationUpdates,
          locationData
        ].slice(-10)
      }));
    });

    // Evento de atualização de status do motorista
    webSocketService.onDriverStatusUpdated((statusData) => {
      setData(prev => ({
        ...prev,
        driverStatusUpdates: [
          ...prev.driverStatusUpdates,
          statusData
        ].slice(-10)
      }));
    });

    // Evento de erro
    webSocketService.onError((error) => {
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
    debugInfo: webSocketService.getDebugInfo(),
  };
};

export default useWebSocket; 