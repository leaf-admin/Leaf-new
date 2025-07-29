import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
  SafeAreaView,
} from 'react-native';
import { useSelector, useDispatch } from 'react-redux';
import { Ionicons } from '@expo/vector-icons';
import ProfileToggle from '../components/ProfileToggle';
import {
  selectCurrentMode,
  selectCurrentProfileData,
  selectIsLoading,
  selectError,
  selectPermissions,
  selectCacheStats,
  loadProfileData,
  loadPermissions,
  updateCacheStats,
} from '../../common/src/reducers/profileToggleReducer';

const ToggleTestScreen = ({ navigation }) => {
  const dispatch = useDispatch();
  const currentMode = useSelector(selectCurrentMode);
  const currentProfileData = useSelector(selectCurrentProfileData);
  const isLoading = useSelector(selectIsLoading);
  const error = useSelector(selectError);
  const permissions = useSelector(selectPermissions);
  const cacheStats = useSelector(selectCacheStats);
  const userId = 'test_user_123';

  useEffect(() => {
    dispatch(loadPermissions(userId));
    dispatch(loadProfileData(userId, currentMode));
    dispatch(updateCacheStats());
  }, [currentMode]);

  const handleModeChange = (newMode, profileData) => {
    console.log(`Modo alterado para: ${newMode}`, profileData);
    Alert.alert(
      'Toggle Testado',
      `Modo alterado para: ${newMode}\n\nDados carregados: ${JSON.stringify(profileData, null, 2)}`,
      [{ text: 'OK' }]
    );
  };

  const handleRefreshData = () => {
    dispatch(loadProfileData(userId, currentMode));
    dispatch(updateCacheStats());
  };

  const handleClearCache = () => {
    // Implementar limpeza de cache
    Alert.alert('Cache Limpo', 'Cache foi limpo com sucesso');
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => navigation.goBack()}
        >
          <Ionicons name="arrow-back" size={24} color="#333" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Teste do Toggle</Text>
        <View style={styles.headerRight}>
          <TouchableOpacity
            style={styles.refreshButton}
            onPress={handleRefreshData}
          >
            <Ionicons name="refresh" size={20} color="#333" />
          </TouchableOpacity>
        </View>
      </View>

      <ScrollView style={styles.content}>
        {/* Seção do Toggle */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>🔄 Toggle de Modo</Text>
          <View style={styles.toggleContainer}>
            <ProfileToggle
              userId={userId}
              onModeChange={handleModeChange}
              style="discrete"
              size="medium"
            />
          </View>
        </View>

        {/* Status Atual */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>📊 Status Atual</Text>
          <View style={styles.statusCard}>
            <Text style={styles.statusText}>
              <Text style={styles.label}>Modo Atual:</Text> {currentMode}
            </Text>
            <Text style={styles.statusText}>
              <Text style={styles.label}>Carregando:</Text> {isLoading ? 'Sim' : 'Não'}
            </Text>
            {error && (
              <Text style={[styles.statusText, styles.errorText]}>
                <Text style={styles.label}>Erro:</Text> {error}
              </Text>
            )}
          </View>
        </View>

        {/* Dados do Perfil */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>👤 Dados do Perfil</Text>
          <View style={styles.dataCard}>
            {currentProfileData ? (
              <Text style={styles.dataText}>
                {JSON.stringify(currentProfileData, null, 2)}
              </Text>
            ) : (
              <Text style={styles.noDataText}>Nenhum dado carregado</Text>
            )}
          </View>
        </View>

        {/* Permissões */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>🔐 Permissões</Text>
          <View style={styles.permissionsCard}>
            <Text style={styles.permissionText}>
              <Text style={styles.label}>Pode ser Motorista:</Text> {permissions.canBeDriver ? 'Sim' : 'Não'}
            </Text>
            <Text style={styles.permissionText}>
              <Text style={styles.label}>Pode ser Passageiro:</Text> {permissions.canBePassenger ? 'Sim' : 'Não'}
            </Text>
            <Text style={styles.permissionText}>
              <Text style={styles.label}>Motorista Verificado:</Text> {permissions.driverVerified ? 'Sim' : 'Não'}
            </Text>
            <Text style={styles.permissionText}>
              <Text style={styles.label}>Motorista Aprovado:</Text> {permissions.driverApproved ? 'Sim' : 'Não'}
            </Text>
          </View>
        </View>

        {/* Estatísticas de Cache */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>📈 Estatísticas de Cache</Text>
          <View style={styles.cacheCard}>
            <Text style={styles.cacheText}>
              <Text style={styles.label}>Total:</Text> {cacheStats.total}
            </Text>
            <Text style={styles.cacheText}>
              <Text style={styles.label}>Passageiro:</Text> {cacheStats.passenger}
            </Text>
            <Text style={styles.cacheText}>
              <Text style={styles.label}>Motorista:</Text> {cacheStats.driver}
            </Text>
          </View>
        </View>

        {/* Botões de Ação */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>🔧 Ações</Text>
          <View style={styles.actionsContainer}>
            <TouchableOpacity
              style={styles.actionButton}
              onPress={handleRefreshData}
            >
              <Ionicons name="refresh" size={20} color="#fff" />
              <Text style={styles.actionButtonText}>Atualizar Dados</Text>
            </TouchableOpacity>
            
            <TouchableOpacity
              style={[styles.actionButton, styles.clearButton]}
              onPress={handleClearCache}
            >
              <Ionicons name="trash" size={20} color="#fff" />
              <Text style={styles.actionButtonText}>Limpar Cache</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Informações de Debug */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>🐛 Debug Info</Text>
          <View style={styles.debugCard}>
            <Text style={styles.debugText}>
              <Text style={styles.label}>User ID:</Text> {userId}
            </Text>
            <Text style={styles.debugText}>
              <Text style={styles.label}>Redux State:</Text> Ativo
            </Text>
            <Text style={styles.debugText}>
              <Text style={styles.label}>Component:</Text> ProfileToggle
            </Text>
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 15,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#e0e0e0',
  },
  backButton: {
    padding: 5,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#333',
  },
  headerRight: {
    flexDirection: 'row',
  },
  refreshButton: {
    padding: 5,
  },
  content: {
    flex: 1,
    padding: 20,
  },
  section: {
    marginBottom: 25,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#333',
    marginBottom: 10,
  },
  toggleContainer: {
    alignItems: 'center',
    paddingVertical: 20,
    backgroundColor: '#fff',
    borderRadius: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 3.84,
    elevation: 5,
  },
  statusCard: {
    backgroundColor: '#fff',
    padding: 15,
    borderRadius: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 3.84,
    elevation: 5,
  },
  statusText: {
    fontSize: 14,
    color: '#333',
    marginBottom: 5,
  },
  label: {
    fontWeight: 'bold',
  },
  errorText: {
    color: '#e74c3c',
  },
  dataCard: {
    backgroundColor: '#fff',
    padding: 15,
    borderRadius: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 3.84,
    elevation: 5,
  },
  dataText: {
    fontSize: 12,
    color: '#333',
    fontFamily: 'monospace',
  },
  noDataText: {
    fontSize: 14,
    color: '#999',
    fontStyle: 'italic',
  },
  permissionsCard: {
    backgroundColor: '#fff',
    padding: 15,
    borderRadius: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 3.84,
    elevation: 5,
  },
  permissionText: {
    fontSize: 14,
    color: '#333',
    marginBottom: 5,
  },
  cacheCard: {
    backgroundColor: '#fff',
    padding: 15,
    borderRadius: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 3.84,
    elevation: 5,
  },
  cacheText: {
    fontSize: 14,
    color: '#333',
    marginBottom: 5,
  },
  actionsContainer: {
    flexDirection: 'row',
    justifyContent: 'space-around',
  },
  actionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#3498db',
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
    elevation: 5,
  },
  clearButton: {
    backgroundColor: '#e74c3c',
  },
  actionButtonText: {
    color: '#fff',
    fontWeight: 'bold',
    marginLeft: 8,
  },
  debugCard: {
    backgroundColor: '#fff',
    padding: 15,
    borderRadius: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 3.84,
    elevation: 5,
  },
  debugText: {
    fontSize: 14,
    color: '#333',
    marginBottom: 5,
  },
});

export default ToggleTestScreen; 