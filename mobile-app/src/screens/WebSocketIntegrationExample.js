import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Alert,
  ScrollView,
  ActivityIndicator,
} from 'react-native';
import useWebSocket from '../hooks/useWebSocket';
import webSocketTester from '../utils/WebSocketTester';

const WebSocketIntegrationExample = () => {
  const [isTesting, setIsTesting] = useState(false);
  const [testResults, setTestResults] = useState([]);

  // Usar o hook do WebSocket
  const {
    connectionStatus,
    data,
    connect,
    disconnect,
    updateLocation,
    findNearbyDrivers,
    updateDriverStatus,
    startLocationUpdates,
    stopLocationUpdates,
    debugInfo,
  } = useWebSocket('driver123');

  // Conectar automaticamente quando o componente montar
  useEffect(() => {
    const initializeWebSocket = async () => {
      try {
        await connect('driver123');
        console.log('WebSocket inicializado');
      } catch (error) {
        console.error('Erro ao inicializar WebSocket:', error);
        Alert.alert('Erro', 'Falha ao conectar com o servidor');
      }
    };

    initializeWebSocket();

    // Cleanup ao desmontar
    return () => {
      disconnect();
    };
  }, []);

  // Iniciar atualizações de localização quando autenticado
  useEffect(() => {
    if (connectionStatus.isAuthenticated) {
      // Simular localização de São Paulo
      startLocationUpdates(-23.5505, -46.6333, 3000); // 3 segundos
      console.log('📍 Atualizações de localização iniciadas');
    }

    return () => {
      stopLocationUpdates();
    };
  }, [connectionStatus.isAuthenticated]);

  // Executar testes
  const runTests = async () => {
    setIsTesting(true);
    setTestResults([]);

    try {
      await webSocketTester.runAllTests();
      const results = webSocketTester.getResults();
      setTestResults(results);
    } catch (error) {
      console.error('Erro nos testes:', error);
    } finally {
      setIsTesting(false);
    }
  };

  // Teste rápido
  const runQuickTest = async () => {
    const isConnected = await webSocketTester.quickTest();
    Alert.alert(
      'Teste Rápido',
      isConnected ? '✅ Backend acessível' : '❌ Backend não acessível'
    );
  };

  // Descobrir IP
  const discoverIP = async () => {
    const ip = await webSocketTester.discoverIP();
    if (ip) {
      Alert.alert('IP Descoberto', `Use este IP: ${ip}`);
    } else {
      Alert.alert('Erro', 'Não foi possível descobrir o IP');
    }
  };

  // Buscar motoristas próximos
  const handleFindDrivers = () => {
    const success = findNearbyDrivers(-23.5505, -46.6333, 5000, 10);
    if (success) {
      Alert.alert('Sucesso', 'Buscando motoristas próximos...');
    } else {
      Alert.alert('Erro', 'Falha ao buscar motoristas');
    }
  };

  // Atualizar status
  const handleUpdateStatus = (status) => {
    const success = updateDriverStatus(status, true);
    if (success) {
      Alert.alert('Sucesso', `Status atualizado para: ${status}`);
    } else {
      Alert.alert('Erro', 'Falha ao atualizar status');
    }
  };

  const getStatusColor = () => {
    if (connectionStatus.isConnected && connectionStatus.isAuthenticated) {
      return '#4CAF50';
    } else if (connectionStatus.isConnected) {
      return '#FF9800';
    } else if (connectionStatus.isConnecting) {
      return '#2196F3';
    } else {
      return '#F44336';
    }
  };

  const getStatusText = () => {
    if (connectionStatus.isConnected && connectionStatus.isAuthenticated) {
      return 'Conectado e Autenticado';
    } else if (connectionStatus.isConnected) {
      return 'Conectado';
    } else if (connectionStatus.isConnecting) {
      return 'Conectando...';
    } else {
      return 'Desconectado';
    }
  };

  return (
    <ScrollView style={styles.container}>
      <Text style={styles.title}>WebSocket Integration Example</Text>

      {/* Status da Conexão */}
      <View style={styles.statusContainer}>
        <View style={[styles.statusIndicator, { backgroundColor: getStatusColor() }]} />
        <Text style={styles.statusText}>{getStatusText()}</Text>
        {connectionStatus.error && (
          <Text style={styles.errorText}>Erro: {connectionStatus.error}</Text>
        )}
      </View>

      {/* Informações de Debug */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Informações de Debug</Text>
        <Text style={styles.debugText}>URL: {debugInfo.url}</Text>
        <Text style={styles.debugText}>Plataforma: {debugInfo.platform}</Text>
        <Text style={styles.debugText}>Socket ID: {debugInfo.socketId || 'N/A'}</Text>
        <Text style={styles.debugText}>User ID: {debugInfo.userId || 'N/A'}</Text>
      </View>

      {/* Dados em Tempo Real */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Dados em Tempo Real</Text>
        <Text style={styles.dataText}>
          Motoristas Próximos: {data.nearbyDrivers.length}
        </Text>
        <Text style={styles.dataText}>
          Atualizações de Localização: {data.locationUpdates.length}
        </Text>
        <Text style={styles.dataText}>
          Atualizações de Status: {data.driverStatusUpdates.length}
        </Text>
      </View>

      {/* Ações */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Ações</Text>
        
        <TouchableOpacity
          style={[styles.button, styles.actionButton]}
          onPress={handleFindDrivers}
          disabled={!connectionStatus.isConnected}
        >
          <Text style={styles.buttonText}>Buscar Motoristas</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.button, styles.actionButton]}
          onPress={() => handleUpdateStatus('available')}
          disabled={!connectionStatus.isAuthenticated}
        >
          <Text style={styles.buttonText}>Status: Disponível</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.button, styles.actionButton]}
          onPress={() => handleUpdateStatus('busy')}
          disabled={!connectionStatus.isAuthenticated}
        >
          <Text style={styles.buttonText}>Status: Ocupado</Text>
        </TouchableOpacity>
      </View>

      {/* Testes */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Testes</Text>
        
        <TouchableOpacity
          style={[styles.button, styles.testButton]}
          onPress={runQuickTest}
        >
          <Text style={styles.buttonText}>Teste Rápido</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.button, styles.testButton]}
          onPress={discoverIP}
        >
          <Text style={styles.buttonText}>Descobrir IP</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.button, styles.testButton]}
          onPress={runTests}
          disabled={isTesting}
        >
          <Text style={styles.buttonText}>
            {isTesting ? 'Executando Testes...' : 'Executar Todos os Testes'}
          </Text>
        </TouchableOpacity>

        {isTesting && (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="small" color="#2196F3" />
            <Text style={styles.loadingText}>Executando testes...</Text>
          </View>
        )}
      </View>

      {/* Resultados dos Testes */}
      {testResults.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Resultados dos Testes</Text>
          {testResults.map((result, index) => (
            <View key={index} style={styles.testResult}>
              <Text style={[
                styles.testResultText,
                { color: result.success ? '#4CAF50' : '#F44336' }
              ]}>
                {result.success ? '✅' : '❌'} {result.test}
              </Text>
              <Text style={styles.testResultMessage}>{result.message}</Text>
            </View>
          ))}
        </View>
      )}
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 16,
    backgroundColor: '#f5f5f5',
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    textAlign: 'center',
    marginBottom: 20,
    color: '#333',
  },
  statusContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 20,
    padding: 16,
    backgroundColor: 'white',
    borderRadius: 8,
    elevation: 2,
  },
  statusIndicator: {
    width: 12,
    height: 12,
    borderRadius: 6,
    marginRight: 8,
  },
  statusText: {
    fontSize: 16,
    fontWeight: 'bold',
    flex: 1,
  },
  errorText: {
    color: '#F44336',
    fontSize: 12,
    marginTop: 4,
  },
  section: {
    marginBottom: 20,
    padding: 16,
    backgroundColor: 'white',
    borderRadius: 8,
    elevation: 2,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 12,
    color: '#333',
  },
  debugText: {
    fontSize: 12,
    color: '#666',
    marginBottom: 4,
  },
  dataText: {
    fontSize: 14,
    color: '#333',
    marginBottom: 4,
  },
  button: {
    padding: 12,
    borderRadius: 6,
    marginBottom: 8,
    alignItems: 'center',
  },
  actionButton: {
    backgroundColor: '#2196F3',
  },
  testButton: {
    backgroundColor: '#FF9800',
  },
  buttonText: {
    color: 'white',
    fontSize: 14,
    fontWeight: 'bold',
  },
  loadingContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 8,
  },
  loadingText: {
    marginLeft: 8,
    color: '#666',
    fontSize: 14,
  },
  testResult: {
    marginBottom: 8,
    padding: 8,
    backgroundColor: '#f9f9f9',
    borderRadius: 4,
  },
  testResultText: {
    fontSize: 14,
    fontWeight: 'bold',
    marginBottom: 2,
  },
  testResultMessage: {
    fontSize: 12,
    color: '#666',
  },
});

export default WebSocketIntegrationExample; 