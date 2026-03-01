import Logger from '../utils/Logger';
import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Alert,
  StatusBar,
  Platform,
  ActivityIndicator,
  RefreshControl
} from 'react-native';
import { Icon } from 'react-native-elements';
import { useSelector } from 'react-redux';
import { colors } from '../common-local/theme';
import { fonts } from '../common-local/font';
import { SkeletonLoader, LoadingSpinner } from '../components/LoadingStates';
import { useResponsiveLayout } from '../components/ResponsiveLayout';
import AuthService from '../services/AuthService';
import { useTranslation } from '../components/i18n/LanguageProvider';


const WaitListScreen = ({ navigation }) => {
  const { t } = useTranslation();
  const auth = useSelector(state => state.auth);
  const [waitListData, setWaitListData] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isJoining, setIsJoining] = useState(false);
  const [isLeaving, setIsLeaving] = useState(false);

  // Responsive layout hook
  const { config: responsiveConfig, isTablet, isMobile } = useResponsiveLayout();

  useEffect(() => {
    loadWaitListStatus();
  }, []);

  const loadWaitListStatus = async () => {
    try {
      setIsLoading(true);
      const isAuthenticated = await AuthService.isAuthenticated();
      if (!isAuthenticated) {
        Alert.alert(t('messages.error'), t('waitList.sessionExpired'));
        navigation.navigate('Login');
        return;
      }

      const response = await AuthService.supportRequest('/waitlist/status');
      const data = await AuthService.handleApiResponse(response);
      setWaitListData(data);
    } catch (error) {
      Logger.error('Erro ao carregar status da wait list:', error);
      Alert.alert(t('messages.error'), t('waitList.loadError'));
    } finally {
      setIsLoading(false);
    }
  };

  const handleRefresh = async () => {
    setIsRefreshing(true);
    await loadWaitListStatus();
    setIsRefreshing(false);
  };

  const joinWaitList = async () => {
    try {
      setIsJoining(true);
      const response = await AuthService.supportRequest('/waitlist/join', {
        method: 'POST',
        body: JSON.stringify({
          priority: 'normal',
          notes: ''
        })
      });
      const data = await AuthService.handleApiResponse(response);
      
      Alert.alert(
        t('messages.success'),
        t('waitList.joinSuccessMessage', { position: data.position, waitTime: data.estimatedWaitTime }),
        [{ text: t('messages.confirm'), onPress: () => loadWaitListStatus() }]
      );
    } catch (error) {
      Logger.error('Erro ao entrar na wait list:', error);
      Alert.alert(t('messages.error'), t('waitList.joinError'));
    } finally {
      setIsJoining(false);
    }
  };

  const leaveWaitList = async () => {
    Alert.alert(
      t('waitList.confirmLeave'),
      t('waitList.confirmLeaveMessage'),
      [
        { text: t('messages.cancel'), style: 'cancel' },
        {
          text: t('waitList.leave'),
          style: 'destructive',
          onPress: async () => {
            try {
              setIsLeaving(true);
              const response = await AuthService.supportRequest('/waitlist/leave', {
                method: 'DELETE'
              });
              await AuthService.handleApiResponse(response);
              
              Alert.alert(t('messages.success'), t('waitList.leaveSuccess'));
              loadWaitListStatus();
            } catch (error) {
              Logger.error('Erro ao sair da wait list:', error);
              Alert.alert(t('messages.error'), t('waitList.leaveError'));
            } finally {
              setIsLeaving(false);
            }
          }
        }
      ]
    );
  };

  const getStatusColor = (status) => {
    switch (status) {
      case 'approved': return '#4CAF50';
      case 'rejected': return '#F44336';
      case 'pending': return '#FF9800';
      default: return '#9E9E9E';
    }
  };

  const getStatusText = (status) => {
    switch (status) {
      case 'approved': return 'Aprovado';
      case 'rejected': return 'Rejeitado';
      case 'pending': return 'Em Espera';
      default: return 'Não Cadastrado';
    }
  };

  const renderWaitListCard = () => {
    if (!waitListData) return null;

    const { waitListStatus, position, estimatedWaitTime, documentsStatus } = waitListData;

    return (
      <View style={[styles.card, { backgroundColor: colors.WHITE }]}>
        <View style={styles.cardHeader}>
          <Icon 
            name="clock" 
            type="material-community" 
            color={getStatusColor(waitListStatus)} 
            size={24} 
          />
          <Text style={[styles.cardTitle, { color: colors.BLACK }]}>
            Status da Wait List
          </Text>
        </View>

        <View style={styles.statusContainer}>
          <View style={[styles.statusBadge, { backgroundColor: getStatusColor(waitListStatus) }]}>
            <Text style={styles.statusText}>{getStatusText(waitListStatus)}</Text>
          </View>
        </View>

        {waitListStatus === 'pending' && position && (
          <View style={styles.positionContainer}>
            <Text style={[styles.positionLabel, { color: colors.GRAY }]}>
              Sua posição na fila:
            </Text>
            <Text style={[styles.positionNumber, { color: colors.primary }]}>
              #{position}
            </Text>
            {estimatedWaitTime && (
              <Text style={[styles.waitTime, { color: colors.GRAY }]}>
                Tempo estimado: {estimatedWaitTime} dias
              </Text>
            )}
          </View>
        )}

        {waitListStatus === 'approved' && (
          <View style={styles.approvedContainer}>
            <Icon name="check-circle" type="material" color="#4CAF50" size={48} />
            <Text style={[styles.approvedText, { color: colors.BLACK }]}>
              Parabéns! Você foi aprovado e pode começar a trabalhar.
            </Text>
          </View>
        )}

        {waitListStatus === 'rejected' && (
          <View style={styles.rejectedContainer}>
            <Icon name="cancel" type="material" color="#F44336" size={48} />
            <Text style={[styles.rejectedText, { color: colors.BLACK }]}>
              Sua solicitação foi rejeitada. Entre em contato com o suporte para mais informações.
            </Text>
          </View>
        )}
      </View>
    );
  };

  const renderDocumentsStatus = () => {
    if (!waitListData?.documentsStatus) return null;

    const { documentsStatus } = waitListData;

    return (
      <View style={[styles.card, { backgroundColor: colors.WHITE }]}>
        <View style={styles.cardHeader}>
          <Icon name="file-document" type="material-community" color={colors.primary} size={24} />
          <Text style={[styles.cardTitle, { color: colors.BLACK }]}>
            Status dos Documentos
          </Text>
        </View>

        <View style={styles.documentsList}>
          <View style={styles.documentItem}>
            <Icon 
              name={documentsStatus.cnhUploaded ? "check-circle" : "clock"} 
              type="material" 
              color={documentsStatus.cnhUploaded ? "#4CAF50" : "#FF9800"} 
              size={20} 
            />
            <Text style={[styles.documentText, { color: colors.BLACK }]}>
              CNH {documentsStatus.cnhUploaded ? 'Enviada' : 'Pendente'}
            </Text>
          </View>

          <View style={styles.documentItem}>
            <Icon 
              name={documentsStatus.vehicleRegistered ? "check-circle" : "clock"} 
              type="material" 
              color={documentsStatus.vehicleRegistered ? "#4CAF50" : "#FF9800"} 
              size={20} 
            />
            <Text style={[styles.documentText, { color: colors.BLACK }]}>
              Veículo {documentsStatus.vehicleRegistered ? 'Registrado' : 'Pendente'}
            </Text>
          </View>

          <View style={styles.documentItem}>
            <Icon 
              name={documentsStatus.documentsComplete ? "check-circle" : "clock"} 
              type="material" 
              color={documentsStatus.documentsComplete ? "#4CAF50" : "#FF9800"} 
              size={20} 
            />
            <Text style={[styles.documentText, { color: colors.BLACK }]}>
              Documentos {documentsStatus.documentsComplete ? 'Completos' : 'Incompletos'}
            </Text>
          </View>
        </View>
      </View>
    );
  };

  const renderSystemInfo = () => {
    if (!waitListData) return null;

    const { maxActiveDrivers, currentActiveDrivers, waitListEnabled } = waitListData;

    return (
      <View style={[styles.card, { backgroundColor: colors.WHITE }]}>
        <View style={styles.cardHeader}>
          <Icon name="information" type="material-community" color={colors.primary} size={24} />
          <Text style={[styles.cardTitle, { color: colors.BLACK }]}>
            Informações do Sistema
          </Text>
        </View>

        <View style={styles.systemInfo}>
          <View style={styles.infoItem}>
            <Text style={[styles.infoLabel, { color: colors.GRAY }]}>
              Motoristas Ativos:
            </Text>
            <Text style={[styles.infoValue, { color: colors.BLACK }]}>
              {currentActiveDrivers} / {maxActiveDrivers}
            </Text>
          </View>

          <View style={styles.infoItem}>
            <Text style={[styles.infoLabel, { color: colors.GRAY }]}>
              Vagas Disponíveis:
            </Text>
            <Text style={[styles.infoValue, { color: colors.BLACK }]}>
              {maxActiveDrivers - currentActiveDrivers}
            </Text>
          </View>

          <View style={styles.infoItem}>
            <Text style={[styles.infoLabel, { color: colors.GRAY }]}>
              Wait List:
            </Text>
            <Text style={[styles.infoValue, { color: waitListEnabled ? '#4CAF50' : '#F44336' }]}>
              {waitListEnabled ? 'Ativa' : 'Inativa'}
            </Text>
          </View>
        </View>
      </View>
    );
  };

  const renderActions = () => {
    if (!waitListData) return null;

    const { waitListStatus, documentsStatus } = waitListData;

    if (waitListStatus === 'approved') {
      return (
        <TouchableOpacity
          style={[styles.actionButton, { backgroundColor: '#4CAF50' }]}
          onPress={() => navigation.navigate('MapScreen')}
        >
          <Icon name="car" type="material-community" color="#fff" size={20} />
          <Text style={styles.actionButtonText}>Começar a Trabalhar</Text>
        </TouchableOpacity>
      );
    }

    if (waitListStatus === 'pending') {
      return (
        <TouchableOpacity
          style={[styles.actionButton, { backgroundColor: '#F44336' }]}
          onPress={leaveWaitList}
          disabled={isLeaving}
        >
          {isLeaving ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <Icon name="exit" type="material-community" color="#fff" size={20} />
          )}
          <Text style={styles.actionButtonText}>
            {isLeaving ? 'Saindo...' : 'Sair da Wait List'}
          </Text>
        </TouchableOpacity>
      );
    }

    if (waitListStatus === 'none' && documentsStatus?.documentsComplete) {
      return (
        <TouchableOpacity
          style={[styles.actionButton, { backgroundColor: colors.primary }]}
          onPress={joinWaitList}
          disabled={isJoining}
        >
          {isJoining ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <Icon name="plus" type="material-community" color="#fff" size={20} />
          )}
          <Text style={styles.actionButtonText}>
            {isJoining ? 'Entrando...' : 'Entrar na Wait List'}
          </Text>
        </TouchableOpacity>
      );
    }

    if (waitListStatus === 'none' && !documentsStatus?.documentsComplete) {
      return (
        <TouchableOpacity
          style={[styles.actionButton, { backgroundColor: '#FF9800' }]}
          onPress={() => navigation.navigate('CarEditScreen')}
        >
          <Icon name="file-document" type="material-community" color="#fff" size={20} />
          <Text style={styles.actionButtonText}>Completar Documentos</Text>
        </TouchableOpacity>
      );
    }

    return null;
  };

  if (isLoading) {
    return (
      <View style={styles.container}>
        <StatusBar barStyle="dark-content" backgroundColor="#fff" />
        <View style={styles.header}>
          <TouchableOpacity onPress={() => navigation.goBack()}>
            <Icon name="arrow-back" size={24} color={colors.primary} />
          </TouchableOpacity>
          <Text style={[styles.headerTitle, { color: colors.BLACK }]}>Wait List</Text>
          <View style={{ width: 24 }} />
        </View>
        
        <View style={styles.skeletonContainer}>
          <LoadingSpinner 
            message="Carregando status da wait list..." 
            color={colors.primary} 
          />
          <SkeletonLoader width="100%" height={120} style={styles.skeletonCard} />
          <SkeletonLoader width="100%" height={100} style={styles.skeletonCard} />
          <SkeletonLoader width="100%" height={80} style={styles.skeletonCard} />
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor="#fff" />
      
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Icon name="arrow-back" size={24} color={colors.primary} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.BLACK }]}>Wait List</Text>
        <TouchableOpacity onPress={handleRefresh}>
          <Icon name="refresh" size={24} color={colors.primary} />
        </TouchableOpacity>
      </View>

      <ScrollView
        style={styles.content}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={isRefreshing} onRefresh={handleRefresh} />
        }
      >
        {renderWaitListCard()}
        {renderDocumentsStatus()}
        {renderSystemInfo()}
      </ScrollView>

      <View style={styles.footer}>
        {renderActions()}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5'
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#e0e0e0'
  },
  headerTitle: {
    fontSize: 18,
    fontFamily: fonts.Bold,
    color: colors.BLACK
  },
  content: {
    flex: 1,
    padding: 16
  },
  card: {
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12
  },
  cardTitle: {
    fontSize: 16,
    fontFamily: fonts.Bold,
    marginLeft: 8
  },
  statusContainer: {
    alignItems: 'center',
    marginBottom: 16
  },
  statusBadge: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20
  },
  statusText: {
    color: '#fff',
    fontSize: 14,
    fontFamily: fonts.Bold
  },
  positionContainer: {
    alignItems: 'center',
    marginBottom: 16
  },
  positionLabel: {
    fontSize: 14,
    fontFamily: fonts.Regular,
    marginBottom: 4
  },
  positionNumber: {
    fontSize: 32,
    fontFamily: fonts.Bold,
    marginBottom: 8
  },
  waitTime: {
    fontSize: 12,
    fontFamily: fonts.Regular
  },
  approvedContainer: {
    alignItems: 'center',
    padding: 16
  },
  approvedText: {
    fontSize: 16,
    fontFamily: fonts.Regular,
    textAlign: 'center',
    marginTop: 12
  },
  rejectedContainer: {
    alignItems: 'center',
    padding: 16
  },
  rejectedText: {
    fontSize: 16,
    fontFamily: fonts.Regular,
    textAlign: 'center',
    marginTop: 12
  },
  documentsList: {
    marginTop: 8
  },
  documentItem: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8
  },
  documentText: {
    fontSize: 14,
    fontFamily: fonts.Regular,
    marginLeft: 8
  },
  systemInfo: {
    marginTop: 8
  },
  infoItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8
  },
  infoLabel: {
    fontSize: 14,
    fontFamily: fonts.Regular
  },
  infoValue: {
    fontSize: 14,
    fontFamily: fonts.Bold
  },
  footer: {
    padding: 16,
    backgroundColor: '#fff',
    borderTopWidth: 1,
    borderTopColor: '#e0e0e0'
  },
  actionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 8
  },
  actionButtonText: {
    color: '#fff',
    fontSize: 16,
    fontFamily: fonts.Bold,
    marginLeft: 8
  },
  skeletonContainer: {
    flex: 1,
    padding: 16
  },
  skeletonCard: {
    marginBottom: 16,
    borderRadius: 12
  }
});

export default WaitListScreen;










