import Logger from '../utils/Logger';
// ProfileToggleTestScreen.js - Tela de teste para toggle beta
import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Alert,
  SafeAreaView
} from 'react-native';
import { useDispatch, useSelector } from 'react-redux';
import { Ionicons } from '@expo/vector-icons';
import ProfileToggle from '../components/ProfileToggle';
import {
  selectCurrentMode,
  selectIsLoading,
  selectError,
  selectCurrentProfileData,
  selectPermissions,
  selectCacheStats,
  toggleMode,
  loadProfileData,
  loadPermissions,
  updateCacheStats
} from '../common-local/reducers/profileToggleReducer';

const ProfileToggleTestScreen = () => {
  const dispatch = useDispatch();
  const currentMode = useSelector(selectCurrentMode);
  const isLoading = useSelector(selectIsLoading);
  const error = useSelector(selectError);
  const profileData = useSelector(selectCurrentProfileData);
  const permissions = useSelector(selectPermissions);
  const cacheStats = useSelector(selectCacheStats);

  const [userId] = useState('test_user_123'); // Mock user ID para teste

  useEffect(() => {
    loadInitialData();
  }, []);

  const loadInitialData = async () => {
    try {
      await dispatch(loadPermissions(userId));
      await dispatch(loadProfileData(userId, currentMode));
      await dispatch(updateCacheStats());
    } catch (error) {
      Logger.error('❌ Erro ao carregar dados iniciais:', error);
    }
  };

  const handleModeChange = async (newMode, profileData) => {
    Logger.log(`🔄 Modo alterado para: ${newMode}`, profileData);
    
    // Recarregar dados do novo modo
    try {
      await dispatch(loadProfileData(userId, newMode));
      await dispatch(updateCacheStats());
    } catch (error) {
      Logger.error('❌ Erro ao carregar dados do novo modo:', error);
    }
  };

  const handleToggleTest = async () => {
    try {
      await dispatch(toggleMode(userId));
    } catch (error) {
      Alert.alert('Erro', error.message);
    }
  };

  const handleLoadProfileData = async (mode) => {
    try {
      await dispatch(loadProfileData(userId, mode));
      Alert.alert('Sucesso', `Dados de ${mode} carregados`);
    } catch (error) {
      Alert.alert('Erro', error.message);
    }
  };

  const handleRefreshCacheStats = async () => {
    try {
      await dispatch(updateCacheStats());
      Alert.alert('Sucesso', 'Estatísticas de cache atualizadas');
    } catch (error) {
      Alert.alert('Erro', error.message);
    }
  };

  const renderProfileData = () => {
    if (!profileData) {
      return (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Dados do Perfil</Text>
          <Text style={styles.noData}>Nenhum dado carregado</Text>
        </View>
      );
    }

    return (
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Dados do Perfil ({currentMode})</Text>
        <ScrollView style={styles.dataContainer}>
          <Text style={styles.dataText}>
            {JSON.stringify(profileData, null, 2)}
          </Text>
        </ScrollView>
      </View>
    );
  };

  const renderPermissions = () => {
    return (
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Permissões</Text>
        <View style={styles.permissionsContainer}>
          <View style={styles.permissionItem}>
            <Text style={styles.permissionLabel}>Pode ser Motorista:</Text>
            <Ionicons
              name={permissions.canBeDriver ? 'checkmark-circle' : 'close-circle'}
              size={20}
              color={permissions.canBeDriver ? '#4CAF50' : '#F44336'}
            />
          </View>
          <View style={styles.permissionItem}>
            <Text style={styles.permissionLabel}>Pode ser Passageiro:</Text>
            <Ionicons
              name={permissions.canBePassenger ? 'checkmark-circle' : 'close-circle'}
              size={20}
              color={permissions.canBePassenger ? '#4CAF50' : '#F44336'}
            />
          </View>
          <View style={styles.permissionItem}>
            <Text style={styles.permissionLabel}>Motorista Verificado:</Text>
            <Ionicons
              name={permissions.driverVerified ? 'checkmark-circle' : 'close-circle'}
              size={20}
              color={permissions.driverVerified ? '#4CAF50' : '#F44336'}
            />
          </View>
          <View style={styles.permissionItem}>
            <Text style={styles.permissionLabel}>Motorista Aprovado:</Text>
            <Ionicons
              name={permissions.driverApproved ? 'checkmark-circle' : 'close-circle'}
              size={20}
              color={permissions.driverApproved ? '#4CAF50' : '#F44336'}
            />
          </View>
        </View>
      </View>
    );
  };

  const renderCacheStats = () => {
    return (
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Estatísticas de Cache</Text>
        <View style={styles.statsContainer}>
          <View style={styles.statItem}>
            <Text style={styles.statLabel}>Total:</Text>
            <Text style={styles.statValue}>{cacheStats.total}</Text>
          </View>
          <View style={styles.statItem}>
            <Text style={styles.statLabel}>Passageiro:</Text>
            <Text style={styles.statValue}>{cacheStats.passenger}</Text>
          </View>
          <View style={styles.statItem}>
            <Text style={styles.statLabel}>Motorista:</Text>
            <Text style={styles.statValue}>{cacheStats.driver}</Text>
          </View>
        </View>
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView style={styles.scrollView}>
        <View style={styles.header}>
          <Text style={styles.title}>🧪 Teste do Toggle Beta</Text>
          <Text style={styles.subtitle}>Testando funcionalidade de toggle passageiro/motorista</Text>
        </View>

        {/* Status */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Status</Text>
          <View style={styles.statusContainer}>
            <View style={styles.statusItem}>
              <Text style={styles.statusLabel}>Modo Atual:</Text>
              <Text style={[styles.statusValue, { color: currentMode === 'passenger' ? '#4CAF50' : '#2196F3' }]}>
                {currentMode === 'passenger' ? 'Passageiro' : 'Motorista'}
              </Text>
            </View>
            <View style={styles.statusItem}>
              <Text style={styles.statusLabel}>Carregando:</Text>
              <Ionicons
                name={isLoading ? 'refresh' : 'checkmark-circle'}
                size={20}
                color={isLoading ? '#FF9800' : '#4CAF50'}
              />
            </View>
            {error && (
              <View style={styles.statusItem}>
                <Text style={styles.statusLabel}>Erro:</Text>
                <Text style={[styles.statusValue, { color: '#F44336' }]}>{error}</Text>
              </View>
            )}
          </View>
        </View>

        {/* Toggle Component */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Componente Toggle</Text>
          <View style={styles.toggleContainer}>
            <ProfileToggle
              userId={userId}
              onModeChange={handleModeChange}
              style="discrete"
              size="medium"
            />
          </View>
        </View>

        {/* Botões de Teste */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Ações de Teste</Text>
          <View style={styles.buttonContainer}>
            <TouchableOpacity
              style={[styles.button, styles.primaryButton]}
              onPress={handleToggleTest}
              disabled={isLoading}
            >
              <Text style={styles.buttonText}>Testar Toggle</Text>
            </TouchableOpacity>
            
            <TouchableOpacity
              style={[styles.button, styles.secondaryButton]}
              onPress={() => handleLoadProfileData('passenger')}
            >
              <Text style={styles.buttonText}>Carregar Dados Passageiro</Text>
            </TouchableOpacity>
            
            <TouchableOpacity
              style={[styles.button, styles.secondaryButton]}
              onPress={() => handleLoadProfileData('driver')}
            >
              <Text style={styles.buttonText}>Carregar Dados Motorista</Text>
            </TouchableOpacity>
            
            <TouchableOpacity
              style={[styles.button, styles.secondaryButton]}
              onPress={handleRefreshCacheStats}
            >
              <Text style={styles.buttonText}>Atualizar Cache Stats</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Permissões */}
        {renderPermissions()}

        {/* Cache Stats */}
        {renderCacheStats()}

        {/* Dados do Perfil */}
        {renderProfileData()}
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F5F5F5'
  },
  scrollView: {
    flex: 1,
    padding: 16
  },
  header: {
    marginBottom: 24
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#333',
    marginBottom: 8
  },
  subtitle: {
    fontSize: 16,
    color: '#666',
    marginBottom: 16
  },
  section: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 2
    },
    shadowOpacity: 0.1,
    shadowRadius: 3.84,
    elevation: 5
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#333',
    marginBottom: 12
  },
  statusContainer: {
    gap: 8
  },
  statusItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 4
  },
  statusLabel: {
    fontSize: 14,
    color: '#666',
    fontWeight: '500'
  },
  statusValue: {
    fontSize: 14,
    fontWeight: '600'
  },
  toggleContainer: {
    alignItems: 'center',
    paddingVertical: 16
  },
  buttonContainer: {
    gap: 12
  },
  button: {
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 8,
    alignItems: 'center'
  },
  primaryButton: {
    backgroundColor: '#007AFF'
  },
  secondaryButton: {
    backgroundColor: '#E0E0E0'
  },
  buttonText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#FFFFFF'
  },
  permissionsContainer: {
    gap: 8
  },
  permissionItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 4
  },
  permissionLabel: {
    fontSize: 14,
    color: '#666'
  },
  statsContainer: {
    flexDirection: 'row',
    justifyContent: 'space-around'
  },
  statItem: {
    alignItems: 'center'
  },
  statLabel: {
    fontSize: 12,
    color: '#666',
    marginBottom: 4
  },
  statValue: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#333'
  },
  dataContainer: {
    maxHeight: 200,
    backgroundColor: '#F8F8F8',
    borderRadius: 8,
    padding: 12
  },
  dataText: {
    fontSize: 12,
    fontFamily: 'monospace',
    color: '#333'
  },
  noData: {
    fontSize: 14,
    color: '#999',
    fontStyle: 'italic',
    textAlign: 'center',
    paddingVertical: 20
  }
});

export default ProfileToggleTestScreen; 