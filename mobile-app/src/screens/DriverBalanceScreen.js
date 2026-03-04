import Logger from '../utils/Logger';
import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  RefreshControl,
  StatusBar,
  Platform,
  Alert,
  ActivityIndicator,
  Dimensions
} from 'react-native';
import { Icon } from 'react-native-elements';
import { useSelector } from 'react-redux';
import { api } from '../common-local';
import QRCode from 'react-native-qrcode-svg';
import { useTranslation } from '../components/i18n/LanguageProvider';
import Typography from '../components/design-system/Typography';
import AnimatedButton from '../components/design-system/AnimatedButton';
import { useTheme } from '../common-local/theme';


const { width, height } = Dimensions.get('window');

const DriverBalanceScreen = ({ navigation, route }) => {
  const { t } = useTranslation();
  const [balanceData, setBalanceData] = useState({
    balance: 0,
    minimumBalance: 49.90,
    canGoOnline: false,
    reason: '',
    message: '',
    qrCodeRequired: false,
    qrCodeAmount: 49.90,
    requiredAmount: 0
  });

  const [qrCodeData, setQrCodeData] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [generatingQR, setGeneratingQR] = useState(false);

  const auth = useSelector(state => state.auth);
  const currentUser = auth.profile;

  useEffect(() => {
    loadBalanceData();
  }, []);

  const loadBalanceData = async () => {
    try {
      setIsLoading(true);

      // Verificar status online do motorista
      const response = await api.post('/api/baas/check-driver-online-status', {
        driverId: currentUser.id
      });

      setBalanceData(response.data);

      // Se precisa de QR Code, gerar automaticamente
      if (response.data.qrCodeRequired && !qrCodeData) {
        generateQRCode();
      }

    } catch (error) {
      Logger.error('Erro ao carregar dados do saldo:', error);
      Alert.alert(t('messages.error'), t('driverBalance.loadError'));
    } finally {
      setIsLoading(false);
    }
  };

  const generateQRCode = async () => {
    try {
      setGeneratingQR(true);

      const response = await api.post('/api/baas/generate-balance-qr-code', {
        driverId: currentUser.id,
        amount: balanceData.qrCodeAmount
      });

      setQrCodeData(response.data);

    } catch (error) {
      Logger.error('Erro ao gerar QR Code:', error);
      Alert.alert(t('messages.error'), t('driverBalance.qrCodeError'));
    } finally {
      setGeneratingQR(false);
    }
  };

  const onRefresh = async () => {
    setRefreshing(true);
    await loadBalanceData();
    setRefreshing(false);
  };

  const handleGoOnline = () => {
    if (balanceData.canGoOnline) {
      navigation.navigate('DriverDashboard');
    } else {
      Alert.alert(
        t('driverBalance.insufficientBalance'),
        t('driverBalance.insufficientBalanceMessage'),
        [
          { text: t('messages.confirm'), style: 'default' },
          { text: t('driverBalance.generateQRCode'), onPress: generateQRCode }
        ]
      );
    }
  };

  const { theme, isDarkMode } = useTheme();

  const renderBalanceCard = () => (
    <View style={[styles.balanceCard, { backgroundColor: theme.card, borderColor: theme.border, borderWidth: 1, elevation: 0 }]}>
      <View style={styles.balanceHeader}>
        <Icon name="account-balance-wallet" type="material" color={theme.leafGreen || '#2E8B57'} size={32} />
        <Typography variant="h2" weight="bold" color={theme.leafGreen || '#2E8B57'} style={{ marginLeft: 12 }}>
          Saldo da Conta Leaf
        </Typography>
      </View>

      <View style={styles.balanceAmount}>
        <Typography variant="h1" weight="bold" color={theme.text}>
          R$ {balanceData.balance.toFixed(2).replace('.', ',')}
        </Typography>
        <Typography variant="caption" color={theme.textSecondary} style={{ marginTop: 4 }}>
          Saldo disponível
        </Typography>
      </View>

      <View style={[styles.balanceInfo, { borderTopColor: theme.border }]}>
        <View style={styles.infoRow}>
          <Typography variant="caption" color={theme.textSecondary}>Saldo mínimo:</Typography>
          <Typography variant="body" weight="bold" color={theme.text}>R$ {balanceData.minimumBalance.toFixed(2).replace('.', ',')}</Typography>
        </View>

        {balanceData.requiredAmount > 0 && (
          <View style={styles.infoRow}>
            <Typography variant="caption" color={theme.textSecondary}>Falta para regularizar:</Typography>
            <Typography variant="body" weight="bold" color="#E74C3C">
              R$ {balanceData.requiredAmount.toFixed(2).replace('.', ',')}
            </Typography>
          </View>
        )}
      </View>
    </View>
  );

  const renderStatusCard = () => (
    <View style={[styles.statusCard, { backgroundColor: balanceData.canGoOnline ? (isDarkMode ? 'rgba(76, 175, 80, 0.1)' : '#E8F5E8') : (isDarkMode ? 'rgba(255, 152, 0, 0.1)' : '#FFF3CD') }]}>
      <View style={styles.statusHeader}>
        <Icon
          name={balanceData.canGoOnline ? "check-circle" : "warning"}
          type="material"
          color={balanceData.canGoOnline ? (theme.leafGreen || "#4CAF50") : "#FF9800"}
          size={24}
        />
        <Typography variant="body" weight="bold" color={balanceData.canGoOnline ? (theme.leafGreen || "#4CAF50") : "#FF9800"} style={{ marginLeft: 12 }}>
          {balanceData.canGoOnline ? 'Pode Ficar Online' : 'Saldo Insuficiente'}
        </Typography>
      </View>

      <Typography variant="caption" color={theme.text} style={{ lineHeight: 20 }}>
        {balanceData.message}
      </Typography>

      {balanceData.reason === 'free_trial' && (
        <View style={[styles.freeTrialInfo, { backgroundColor: isDarkMode ? 'rgba(255, 215, 0, 0.1)' : '#FFF8DC' }]}>
          <Icon name="star" type="material" color="#FFD700" size={16} />
          <Typography variant="small" weight="bold" color="#B8860B" style={{ marginLeft: 8 }}>Período grátis ativo</Typography>
        </View>
      )}
    </View>
  );

  const renderQRCodeCard = () => {
    if (!balanceData.qrCodeRequired) return null;

    return (
      <View style={[styles.qrCodeCard, { backgroundColor: theme.card, borderColor: theme.border, borderWidth: 1, elevation: 0 }]}>
        <View style={styles.qrCodeHeader}>
          <Icon name="qr-code" type="material" color={theme.leafGreen || '#2E8B57'} size={24} />
          <Typography variant="body" weight="bold" color={theme.text} style={{ marginLeft: 12 }}>Regularizar Saldo</Typography>
        </View>

        <Typography variant="caption" color={theme.textSecondary} style={{ lineHeight: 20, marginBottom: 16 }}>
          Escaneie o QR Code abaixo para adicionar R$ {balanceData.qrCodeAmount.toFixed(2).replace('.', ',')} à sua conta Leaf
        </Typography>

        {generatingQR ? (
          <View style={styles.qrCodeLoading}>
            <ActivityIndicator size="large" color={theme.leafGreen || "#2E8B57"} />
            <Typography variant="caption" color={theme.textSecondary} style={{ marginTop: 12 }}>Gerando QR Code...</Typography>
          </View>
        ) : qrCodeData ? (
          <View style={styles.qrCodeContainer}>
            <View style={{ padding: 10, backgroundColor: '#FFFFFF', borderRadius: 12 }}>
              <QRCode
                value={qrCodeData.qr_code}
                size={200}
                color="#000000"
                backgroundColor="#FFFFFF"
              />
            </View>
            <Typography variant="h2" weight="bold" color={theme.leafGreen || '#2E8B57'} style={{ marginTop: 12 }}>
              R$ {qrCodeData.amount.toFixed(2).replace('.', ',')}
            </Typography>
            <Typography variant="small" color={theme.textSecondary} style={{ marginTop: 4 }}>
              Expira em 1 hora
            </Typography>
          </View>
        ) : (
          <AnimatedButton
            title="Gerar QR Code"
            onPress={generateQRCode}
            leftIcon={<Icon name="qr-code-scanner" type="material" color="#FFFFFF" size={24} />}
          />
        )}
      </View>
    );
  };

  const renderActionButtons = () => (
    <View style={styles.actionButtons}>
      <AnimatedButton
        title={balanceData.canGoOnline ? 'Ficar Online' : 'Saldo Insuficiente'}
        onPress={handleGoOnline}
        disabled={!balanceData.canGoOnline}
        variant={balanceData.canGoOnline ? 'primary' : 'secondary'}
        leftIcon={<Icon name="directions-car" type="material" color="#FFFFFF" size={24} />}
      />

      <AnimatedButton
        title="Gerenciar Conta"
        onPress={() => navigation.navigate('BaaSAccountScreen')}
        variant="secondary"
        leftIcon={<Icon name="account-balance" type="material" color={theme.leafGreen || '#2E8B57'} size={24} />}
      />
    </View>
  );

  if (isLoading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#2E8B57" />
        <Text style={styles.loadingText}>Carregando dados do saldo...</Text>
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      <StatusBar barStyle={isDarkMode ? "light-content" : "dark-content"} backgroundColor={theme.background} />

      <ScrollView
        style={styles.scrollView}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.leafGreen || "#2E8B57"} />
        }
      >
        <View style={styles.content}>
          {renderBalanceCard()}
          {renderStatusCard()}
          {renderQRCodeCard()}
          {renderActionButtons()}
        </View>
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F5F5F5',
  },

  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
  },

  loadingText: {
    marginTop: 16,
    fontSize: 16,
    color: '#666666',
  },

  scrollView: {
    flex: 1,
  },

  content: {
    padding: 20,
  },

  balanceCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 20,
    marginBottom: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },

  balanceHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
  },

  balanceTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#2E8B57',
    marginLeft: 12,
  },

  balanceAmount: {
    alignItems: 'center',
    marginBottom: 16,
  },

  balanceValue: {
    fontSize: 32,
    fontWeight: 'bold',
    color: '#2E8B57',
  },

  balanceSubtitle: {
    fontSize: 14,
    color: '#666666',
    marginTop: 4,
  },

  balanceInfo: {
    borderTopWidth: 1,
    borderTopColor: '#E0E0E0',
    paddingTop: 16,
  },

  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 8,
  },

  infoLabel: {
    fontSize: 14,
    color: '#666666',
  },

  infoValue: {
    fontSize: 14,
    fontWeight: '600',
    color: '#333333',
  },

  requiredAmount: {
    color: '#E74C3C',
  },

  statusCard: {
    borderRadius: 12,
    padding: 20,
    marginBottom: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },

  statusHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },

  statusTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    marginLeft: 12,
  },

  statusMessage: {
    fontSize: 14,
    color: '#666666',
    lineHeight: 20,
  },

  freeTrialInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 12,
    padding: 8,
    backgroundColor: '#FFF8DC',
    borderRadius: 8,
  },

  freeTrialText: {
    fontSize: 12,
    color: '#B8860B',
    marginLeft: 8,
    fontWeight: '600',
  },

  qrCodeCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 20,
    marginBottom: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },

  qrCodeHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },

  qrCodeTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#2E8B57',
    marginLeft: 12,
  },

  qrCodeDescription: {
    fontSize: 14,
    color: '#666666',
    lineHeight: 20,
    marginBottom: 16,
  },

  qrCodeLoading: {
    alignItems: 'center',
    padding: 20,
  },

  qrCodeLoadingText: {
    fontSize: 14,
    color: '#666666',
    marginTop: 12,
  },

  qrCodeContainer: {
    alignItems: 'center',
    padding: 20,
  },

  qrCodeAmount: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#2E8B57',
    marginTop: 12,
  },

  qrCodeExpires: {
    fontSize: 12,
    color: '#999999',
    marginTop: 4,
  },

  generateQRButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#2E8B57',
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 8,
  },

  generateQRButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#FFFFFF',
    marginLeft: 8,
  },

  actionButtons: {
    gap: 12,
  },

  actionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 16,
    paddingHorizontal: 24,
    borderRadius: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },

  primaryButton: {
    backgroundColor: '#2E8B57',
  },

  secondaryButton: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#2E8B57',
  },

  disabledButton: {
    backgroundColor: '#CCCCCC',
    opacity: 0.6,
  },

  primaryButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#FFFFFF',
    marginLeft: 8,
  },

  secondaryButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#2E8B57',
    marginLeft: 8,
  },
});

export default DriverBalanceScreen; 