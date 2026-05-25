import Logger from '../utils/Logger';
import React, { useCallback, useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  StatusBar,
  ActivityIndicator,
  Switch,
  Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useSelector } from 'react-redux';
import { apiClient } from '../services/httpClient';
import { useAccountDeletionFlow } from '../hooks/useAccountDeletionFlow';
import { fonts } from '../theme/runtimeTokens';
import {
  PrototypeMenuCloseButton,
  PrototypeMenuInfoRow,
  PrototypeMenuRow,
  PrototypeMenuSection,
  PrototypeMenuSurface,
} from '../components/prototype/PrototypeMenuSurface';
import robotaxiPrototypeTokens from '../components/design-system/robotaxiPrototypeTokens';

const { color, typography } = robotaxiPrototypeTokens;
const SURFACE_TOP_PADDING = 16;
const SURFACE_BOTTOM_PADDING = 18;

const PrivacyPolicyScreen = ({ navigation, route }) => {
  const insets = useSafeAreaInsets();
  const [selectedSection, setSelectedSection] = useState(() => route?.params?.initialSection || 'overview');
  const [privacySettings, setPrivacySettings] = useState({
    locationSharing: true,
    dataAnalytics: true,
    marketingEmails: false,
    pushNotifications: true,
    thirdPartySharing: false
  });
  const [isLoading, setIsLoading] = useState(true);
  
  const authState = useSelector(state => state.auth);
  const currentUser = authState.profile;
  const userIdentifier = String(currentUser?.id || currentUser?.uid || '').trim();
  const { promptAccountDeletion } = useAccountDeletionFlow({
    navigation,
    profile: currentUser,
    source: 'mobile-app-privacy-screen',
    additionalInfo: 'Solicitação enviada pela tela de privacidade do app',
  });

  const sections = [
    { id: 'overview', label: 'Visão geral', icon: 'information-circle-outline' },
    { id: 'data-collection', label: 'Coleta de dados', icon: 'server-outline' },
    { id: 'data-usage', label: 'Uso dos dados', icon: 'options-outline' },
    { id: 'data-sharing', label: 'Compartilhamento', icon: 'share-social-outline' },
    { id: 'data-security', label: 'Segurança', icon: 'shield-checkmark-outline' },
    { id: 'user-rights', label: 'Excluir conta', icon: 'trash-outline' },
    { id: 'settings', label: 'Configurações', icon: 'settings-outline' }
  ];
  const isAccountDeletionEntry = selectedSection === 'user-rights';

  useEffect(() => {
    loadPrivacySettings();
  }, [currentUser?.id, currentUser?.uid]);

  const loadPrivacySettings = async () => {
    if (!userIdentifier) {
      setIsLoading(false);
      Logger.warn('⚠️ Identificador do usuário indisponível para carregar privacidade.');
      return;
    }

    try {
      setIsLoading(true);
      
      const response = await apiClient.get(`/api/privacy/settings/${userIdentifier}`);
      setPrivacySettings(response.data.settings || privacySettings);
      
    } catch (error) {
      Logger.error('Erro ao carregar configurações de privacidade:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const updatePrivacySetting = async (setting, value) => {
    if (!userIdentifier) {
      Alert.alert('Sessão indisponível', 'Faça login novamente para ajustar as configurações de privacidade.');
      return;
    }

    try {
      await apiClient.put(`/api/privacy/settings/${userIdentifier}`, {
        setting,
        value
      });
      
      setPrivacySettings(prev => ({
        ...prev,
        [setting]: value
      }));
      
    } catch (error) {
      Logger.error('Erro ao atualizar configuração:', error);
      Alert.alert('Erro', 'Não foi possível atualizar a configuração');
    }
  };

  const handleSettingToggle = (setting) => {
    const newValue = !privacySettings[setting];
    
    if (setting === 'locationSharing') {
      Alert.alert(
        'Compartilhamento de Localização',
        newValue 
          ? 'Permitir que a Leaf acesse sua localização para encontrar motoristas próximos?'
          : 'Desativar o compartilhamento de localização pode afetar a funcionalidade do app.',
        [
          { text: 'Cancelar', style: 'cancel' },
          { text: 'Confirmar', onPress: () => updatePrivacySetting(setting, newValue) }
        ]
      );
    } else {
      updatePrivacySetting(setting, newValue);
    }
  };

  const downloadUserData = async () => {
    if (!userIdentifier) {
      Alert.alert('Sessão indisponível', 'Faça login novamente para solicitar o download dos seus dados.');
      return;
    }

    try {
      Alert.alert(
        'Download de Dados',
        'Sua solicitação foi enviada. Você receberá um email com o link para download em até 48 horas.',
        [{ text: 'OK' }]
      );
      
      await apiClient.post(`/api/privacy/download-data/${userIdentifier}`);
      
    } catch (error) {
      Logger.error('Erro ao solicitar download:', error);
      Alert.alert('Erro', 'Não foi possível solicitar o download dos dados');
    }
  };

  const handleBack = useCallback(() => {
    if (navigation.canGoBack?.()) {
      navigation.goBack();
      return;
    }

    navigation.navigate('RobotaxiPrototype');
  }, [navigation]);

  const renderDetailRow = ({ icon, title, description, last = false }) => (
    <View style={[styles.detailRow, last && styles.detailRowLast]}>
      <View style={styles.detailIconSlot}>
        <Ionicons name={icon} size={18} color={color.text.primary} />
      </View>
      <View style={styles.detailCopy}>
        <Text style={styles.detailTitle}>{title}</Text>
        {description ? <Text style={styles.detailDescription}>{description}</Text> : null}
      </View>
    </View>
  );

  const renderSettingRow = ({ keyName, icon, title, description, last = false }) => (
    <View style={[styles.settingRow, last && styles.detailRowLast]}>
      <View style={styles.settingCopyWrap}>
        <View style={styles.detailIconSlot}>
          <Ionicons name={icon} size={18} color={color.text.primary} />
        </View>
        <View style={styles.detailCopy}>
          <Text style={styles.detailTitle}>{title}</Text>
          <Text style={styles.detailDescription}>{description}</Text>
        </View>
      </View>
      <Switch
        value={privacySettings[keyName]}
        onValueChange={() => handleSettingToggle(keyName)}
        trackColor={{ false: 'rgba(17,26,39,0.16)', true: 'rgba(42,77,29,0.36)' }}
        thumbColor={privacySettings[keyName] ? color.accent.strong : '#F5F8FB'}
      />
    </View>
  );

  const renderOverview = () => (
    <View style={styles.sectionContent}>
      <PrototypeMenuSection title="Resumo">
        <PrototypeMenuInfoRow label="Atualização" value="28 de julho de 2025" />
        <Text style={styles.bodyCopy}>
          A Leaf respeita sua privacidade e está comprometido em proteger seus dados pessoais.
          Esta política descreve como coletamos, usamos e protegemos suas informações.
        </Text>
      </PrototypeMenuSection>

      <PrototypeMenuSection title="Principais pontos">
        {renderDetailRow({ icon: 'checkmark-circle-outline', title: 'Não vendemos seus dados pessoais' })}
        {renderDetailRow({ icon: 'options-outline', title: 'Você controla suas preferências de privacidade' })}
        {renderDetailRow({ icon: 'lock-closed-outline', title: 'Dados protegidos por controles de segurança' })}
        {renderDetailRow({ icon: 'document-text-outline', title: 'Fluxos alinhados à LGPD', last: true })}
      </PrototypeMenuSection>

      <PrototypeMenuSection title="Conta">
        <PrototypeMenuRow
          icon="trash-outline"
          title="Excluir conta"
          subtitle="Iniciar exclusão permanente da conta e dados"
          last
          onPress={() => setSelectedSection('user-rights')}
          accessibilityLabel="Excluir conta"
        />
      </PrototypeMenuSection>
    </View>
  );

  const renderDataCollection = () => (
    <View style={styles.sectionContent}>
      <PrototypeMenuSection title="Dados coletados">
        {renderDetailRow({ icon: 'person-outline', title: 'Informações pessoais', description: 'Nome, telefone, email e dados necessários da conta.' })}
        {renderDetailRow({ icon: 'location-outline', title: 'Localização', description: 'Localização em tempo real durante viagens e solicitações.' })}
        {renderDetailRow({ icon: 'card-outline', title: 'Dados de pagamento', description: 'Informações processadas pelos provedores de pagamento.' })}
        {renderDetailRow({ icon: 'car-outline', title: 'Dados de viagem', description: 'Histórico de corridas, destinos, recibos e avaliações.', last: true })}
      </PrototypeMenuSection>
    </View>
  );

  const renderDataUsage = () => (
    <View style={styles.sectionContent}>
      <PrototypeMenuSection title="Finalidades">
        {renderDetailRow({ icon: 'car-outline', title: 'Fornecer transporte', description: 'Conectar passageiros, motoristas, rotas e corridas.' })}
        {renderDetailRow({ icon: 'shield-checkmark-outline', title: 'Garantir segurança', description: 'Prevenir fraude, abuso e incidentes operacionais.' })}
        {renderDetailRow({ icon: 'chatbubble-ellipses-outline', title: 'Prestar suporte', description: 'Resolver problemas da conta, pagamentos e viagens.' })}
        {renderDetailRow({ icon: 'analytics-outline', title: 'Melhorar o serviço', description: 'Analisar desempenho e qualidade da experiência.', last: true })}
      </PrototypeMenuSection>
    </View>
  );

  const renderDataSharing = () => (
    <View style={styles.sectionContent}>
      <PrototypeMenuSection title="Compartilhamento">
        {renderDetailRow({ icon: 'business-outline', title: 'Processadores de pagamento', description: 'Dados necessários para processar cobranças e recibos.' })}
        {renderDetailRow({ icon: 'document-text-outline', title: 'Autoridades legais', description: 'Somente quando exigido por obrigação legal.' })}
        {renderDetailRow({ icon: 'car-sport-outline', title: 'Motoristas parceiros', description: 'Dados limitados para executar a viagem.', last: true })}
      </PrototypeMenuSection>

      <PrototypeMenuSection title="Nota">
        <Text style={styles.bodyCopy}>
          Não vendemos, alugamos ou compartilhamos seus dados pessoais com terceiros 
          para fins de marketing sem seu consentimento.
        </Text>
      </PrototypeMenuSection>
    </View>
  );

  const renderDataSecurity = () => (
    <View style={styles.sectionContent}>
      <PrototypeMenuSection title="Medidas de segurança">
        {renderDetailRow({ icon: 'lock-closed-outline', title: 'Criptografia e controles de acesso' })}
        {renderDetailRow({ icon: 'shield-outline', title: 'Servidores monitorados' })}
        {renderDetailRow({ icon: 'person-circle-outline', title: 'Acesso restrito aos dados' })}
        {renderDetailRow({ icon: 'refresh-outline', title: 'Atualizações regulares de segurança', last: true })}
      </PrototypeMenuSection>
    </View>
  );

  const renderUserRights = () => (
    <View style={styles.sectionContent}>
      <PrototypeMenuSection title="Conta">
        <PrototypeMenuRow
          icon="trash-outline"
          title="Excluir conta"
          onPress={promptAccountDeletion}
          testID="privacy-delete-account-button"
          accessibilityLabel="Excluir conta"
        />
        <PrototypeMenuRow
          icon="download-outline"
          title="Baixar meus dados"
          last
          onPress={downloadUserData}
        />
      </PrototypeMenuSection>
    </View>
  );

  const renderSettings = () => (
    <View style={styles.sectionContent}>
      <PrototypeMenuSection title="Configurações de privacidade">
        {renderSettingRow({ keyName: 'locationSharing', icon: 'location-outline', title: 'Compartilhamento de localização', description: 'Permite encontrar motoristas próximos.' })}
        {renderSettingRow({ keyName: 'dataAnalytics', icon: 'analytics-outline', title: 'Análise de dados', description: 'Ajuda a melhorar o serviço.' })}
        {renderSettingRow({ keyName: 'marketingEmails', icon: 'mail-outline', title: 'Emails de marketing', description: 'Receber ofertas e novidades.' })}
        {renderSettingRow({ keyName: 'pushNotifications', icon: 'notifications-outline', title: 'Notificações push', description: 'Atualizações sobre viagens e conta.' })}
        {renderSettingRow({ keyName: 'thirdPartySharing', icon: 'share-social-outline', title: 'Compartilhamento com terceiros', description: 'Permitir uso por parceiros autorizados.', last: true })}
      </PrototypeMenuSection>
    </View>
  );

  const renderSectionContent = () => {
    switch (selectedSection) {
      case 'overview':
        return renderOverview();
      case 'data-collection':
        return renderDataCollection();
      case 'data-usage':
        return renderDataUsage();
      case 'data-sharing':
        return renderDataSharing();
      case 'data-security':
        return renderDataSecurity();
      case 'user-rights':
        return renderUserRights();
      case 'settings':
        return renderSettings();
      default:
        return null;
    }
  };

  const renderSections = () => (
    <PrototypeMenuSection title="Tópicos">
      {sections.map((item, index) => (
        <PrototypeMenuRow
          key={item.id}
          icon={item.icon}
          title={item.label}
          active={selectedSection === item.id}
          last={index === sections.length - 1}
          onPress={() => setSelectedSection(item.id)}
        />
      ))}
    </PrototypeMenuSection>
  );

  if (isLoading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="small" color={color.accent.strong} />
        <Text style={styles.loadingText}>Carregando privacidade...</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <StatusBar translucent backgroundColor="transparent" barStyle="dark-content" />

      <PrototypeMenuSurface
        fullScreen
        eyebrow={isAccountDeletionEntry ? 'Conta' : 'Privacidade'}
        title={isAccountDeletionEntry ? 'Gerenciar conta' : 'Privacidade'}
        subtitle={
          isAccountDeletionEntry
            ? 'Baixe seus dados ou exclua sua conta.'
            : 'Dados, preferências e direitos da sua conta.'
        }
        style={{
          paddingTop: insets.top + SURFACE_TOP_PADDING,
          paddingBottom: Math.max(insets.bottom, SURFACE_BOTTOM_PADDING),
        }}
        bodyStyle={styles.surfaceBody}
        headerAccessory={<PrototypeMenuCloseButton onPress={handleBack} accessibilityLabel="Voltar" />}
      >
        <ScrollView
          style={styles.content}
          contentContainerStyle={styles.contentContainer}
          showsVerticalScrollIndicator={false}
        >
          {!isAccountDeletionEntry ? renderSections() : null}
          {renderSectionContent()}
        </ScrollView>
      </PrototypeMenuSurface>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(247,250,247,0.985)',
  },
  loadingText: {
    marginTop: 12,
    color: color.text.secondary,
    fontFamily: fonts.Medium,
    fontSize: typography.caption.size,
    lineHeight: typography.caption.lineHeight,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 50,
    paddingBottom: 20,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#e0e0e0',
  },
  backButton: {
    padding: 8,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#2c3e50',
  },
  helpButton: {
    padding: 8,
  },
  sectionsContainer: {
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#e0e0e0',
  },
  sectionsList: {
    paddingHorizontal: 16,
  },
  sectionTab: {
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    marginRight: 8,
    borderRadius: 8,
    backgroundColor: '#f8f9fa',
  },
  activeSectionTab: {
    backgroundColor: '#e8f5e8',
  },
  sectionText: {
    fontSize: 12,
    color: '#7f8c8d',
    marginTop: 4,
  },
  activeSectionText: {
    color: '#2E8B57',
    fontWeight: 'bold',
  },
  content: {
    flex: 1,
  },
  sectionContent: {
    padding: 0,
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#2c3e50',
    marginBottom: 8,
  },
  sectionDescription: {
    fontSize: 14,
    color: '#7f8c8d',
    marginBottom: 20,
  },
  policyCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    marginBottom: 20,
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
  },
  policyText: {
    fontSize: 14,
    color: '#2c3e50',
    lineHeight: 20,
  },
  accountDeletionCard: {
    backgroundColor: '#fff5f5',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#f3b7b1',
    padding: 16,
    marginBottom: 20,
  },
  accountDeletionTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#7a1f16',
    marginBottom: 8,
  },
  accountDeletionDescription: {
    fontSize: 13,
    color: '#7a1f16',
    lineHeight: 18,
    marginBottom: 12,
  },
  accountDeletionButton: {
    minHeight: 44,
    borderRadius: 8,
    backgroundColor: '#c0392b',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  accountDeletionButtonText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: 'bold',
    marginLeft: 8,
  },
  highlightsContainer: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
  },
  highlightsTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#2c3e50',
    marginBottom: 12,
  },
  highlightItem: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  highlightText: {
    fontSize: 14,
    color: '#2c3e50',
    marginLeft: 8,
  },
  dataCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
  },
  dataTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#2c3e50',
    marginBottom: 16,
  },
  dataItem: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
  },
  dataInfo: {
    marginLeft: 12,
    flex: 1,
  },
  dataLabel: {
    fontSize: 14,
    fontWeight: 'bold',
    color: '#2c3e50',
    marginBottom: 2,
  },
  dataDescription: {
    fontSize: 12,
    color: '#7f8c8d',
  },
  usageCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
  },
  usageTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#2c3e50',
    marginBottom: 16,
  },
  usageItem: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  usageText: {
    fontSize: 14,
    color: '#2c3e50',
    marginLeft: 8,
  },
  sharingCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
  },
  sharingTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#2c3e50',
    marginBottom: 16,
  },
  sharingItem: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  sharingText: {
    fontSize: 14,
    color: '#2c3e50',
    marginLeft: 8,
  },
  sharingNote: {
    fontSize: 12,
    color: '#7f8c8d',
    fontStyle: 'italic',
    marginTop: 12,
    lineHeight: 16,
  },
  securityCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
  },
  securityTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#2c3e50',
    marginBottom: 16,
  },
  securityItem: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  securityText: {
    fontSize: 14,
    color: '#2c3e50',
    marginLeft: 8,
  },
  rightsCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    marginBottom: 20,
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
  },
  rightsTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#2c3e50',
    marginBottom: 16,
  },
  rightsItem: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  rightsText: {
    fontSize: 14,
    color: '#2c3e50',
    marginLeft: 8,
  },
  actionsContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  actionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#2E8B57',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 8,
    flex: 1,
    marginHorizontal: 4,
  },
  deleteButton: {
    backgroundColor: '#e74c3c',
  },
  actionButtonText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: 'bold',
    marginLeft: 8,
  },
  settingsCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
  },
  settingItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#e0e0e0',
  },
  settingInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  settingDetails: {
    marginLeft: 12,
    flex: 1,
  },
  settingTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#2c3e50',
    marginBottom: 2,
  },
  settingDescription: {
    fontSize: 12,
    color: '#7f8c8d',
  },
  surfaceBody: {
    flex: 1,
  },
  contentContainer: {
    paddingTop: 10,
    paddingBottom: 24,
  },
  bodyCopy: {
    color: color.text.secondary,
    fontFamily: fonts.Regular,
    fontSize: typography.body.size,
    lineHeight: typography.body.lineHeight,
    paddingTop: 10,
    paddingBottom: 4,
  },
  detailRow: {
    minHeight: 54,
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(17,26,39,0.08)',
  },
  detailRowLast: {
    borderBottomWidth: 0,
    paddingBottom: 4,
  },
  detailIconSlot: {
    width: 28,
    alignItems: 'flex-start',
    justifyContent: 'center',
  },
  detailCopy: {
    flex: 1,
    paddingRight: 8,
  },
  detailTitle: {
    color: color.text.primary,
    fontFamily: fonts.SemiBold,
    fontSize: 16,
    lineHeight: 22,
  },
  detailDescription: {
    marginTop: 1,
    color: color.text.secondary,
    fontFamily: fonts.Regular,
    fontSize: typography.micro.size,
    lineHeight: typography.micro.lineHeight,
  },
  settingRow: {
    minHeight: 62,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(17,26,39,0.08)',
  },
  settingCopyWrap: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
  },
});

export default PrivacyPolicyScreen; 
