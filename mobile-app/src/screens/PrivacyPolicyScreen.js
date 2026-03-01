import Logger from '../utils/Logger';
import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  StatusBar,
  Platform,
  ActivityIndicator,
  Switch,
  Alert,
  FlatList
} from 'react-native';
import { Icon } from 'react-native-elements';
import { useSelector } from 'react-redux';
import { api } from '../common-local';


const PrivacyPolicyScreen = ({ navigation, route }) => {
  const [selectedSection, setSelectedSection] = useState('overview');
  const [privacySettings, setPrivacySettings] = useState({
    locationSharing: true,
    dataAnalytics: true,
    marketingEmails: false,
    pushNotifications: true,
    thirdPartySharing: false
  });
  const [isLoading, setIsLoading] = useState(true);
  const [expandedSection, setExpandedSection] = useState(null);
  
  const auth = useSelector(state => state.auth);
  const currentUser = auth.profile;

  const sections = [
    { id: 'overview', label: 'Visão Geral', icon: 'info' },
    { id: 'data-collection', label: 'Coleta de Dados', icon: 'storage' },
    { id: 'data-usage', label: 'Uso dos Dados', icon: 'settings' },
    { id: 'data-sharing', label: 'Compartilhamento', icon: 'share' },
    { id: 'data-security', label: 'Segurança', icon: 'security' },
    { id: 'user-rights', label: 'Seus Direitos', icon: 'person' },
    { id: 'settings', label: 'Configurações', icon: 'tune' }
  ];

  useEffect(() => {
    loadPrivacySettings();
  }, []);

  const loadPrivacySettings = async () => {
    try {
      setIsLoading(true);
      
      const response = await api.get(`/api/privacy/settings/${currentUser.id}`);
      setPrivacySettings(response.data.settings || privacySettings);
      
    } catch (error) {
      Logger.error('Erro ao carregar configurações de privacidade:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const updatePrivacySetting = async (setting, value) => {
    try {
      await api.put(`/api/privacy/settings/${currentUser.id}`, {
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
          ? 'Permitir que o Leaf acesse sua localização para encontrar motoristas próximos?'
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
    try {
      Alert.alert(
        'Download de Dados',
        'Sua solicitação foi enviada. Você receberá um email com o link para download em até 48 horas.',
        [{ text: 'OK' }]
      );
      
      await api.post(`/api/privacy/download-data/${currentUser.id}`);
      
    } catch (error) {
      Logger.error('Erro ao solicitar download:', error);
      Alert.alert('Erro', 'Não foi possível solicitar o download dos dados');
    }
  };

  const deleteUserData = async () => {
    Alert.alert(
      'Excluir Dados Pessoais',
      'Esta ação é irreversível. Todos os seus dados pessoais serão permanentemente excluídos.',
      [
        { text: 'Cancelar', style: 'cancel' },
        { text: 'Excluir', style: 'destructive', onPress: confirmDeleteData }
      ]
    );
  };

  const confirmDeleteData = async () => {
    try {
      await api.delete(`/api/privacy/delete-data/${currentUser.id}`);
      
      Alert.alert(
        'Dados Excluídos',
        'Seus dados pessoais foram excluídos com sucesso.',
        [{ text: 'OK', onPress: () => navigation.navigate('AuthScreen') }]
      );
      
    } catch (error) {
      Logger.error('Erro ao excluir dados:', error);
      Alert.alert('Erro', 'Não foi possível excluir os dados');
    }
  };

  const renderOverview = () => (
    <View style={styles.sectionContent}>
      <Text style={styles.sectionTitle}>Política de Privacidade</Text>
      <Text style={styles.sectionDescription}>
        Última atualização: 28 de Julho de 2025
      </Text>
      
      <View style={styles.policyCard}>
        <Text style={styles.policyText}>
          O Leaf respeita sua privacidade e está comprometido em proteger seus dados pessoais. 
          Esta política descreve como coletamos, usamos e protegemos suas informações.
        </Text>
      </View>
      
      <View style={styles.highlightsContainer}>
        <Text style={styles.highlightsTitle}>Principais Pontos:</Text>
        
        <View style={styles.highlightItem}>
          <Icon name="check-circle" type="material" color="#27ae60" size={20} />
          <Text style={styles.highlightText}>
            Não vendemos seus dados pessoais
          </Text>
        </View>
        
        <View style={styles.highlightItem}>
          <Icon name="check-circle" type="material" color="#27ae60" size={20} />
          <Text style={styles.highlightText}>
            Você controla suas configurações de privacidade
          </Text>
        </View>
        
        <View style={styles.highlightItem}>
          <Icon name="check-circle" type="material" color="#27ae60" size={20} />
          <Text style={styles.highlightText}>
            Dados criptografados e seguros
          </Text>
        </View>
        
        <View style={styles.highlightItem}>
          <Icon name="check-circle" type="material" color="#27ae60" size={20} />
          <Text style={styles.highlightText}>
            Conformidade com LGPD
          </Text>
        </View>
      </View>
    </View>
  );

  const renderDataCollection = () => (
    <View style={styles.sectionContent}>
      <Text style={styles.sectionTitle}>Coleta de Dados</Text>
      
      <View style={styles.dataCard}>
        <Text style={styles.dataTitle}>Dados que Coletamos:</Text>
        
        <View style={styles.dataItem}>
          <Icon name="person" type="material" color="#3498db" size={20} />
          <View style={styles.dataInfo}>
            <Text style={styles.dataLabel}>Informações Pessoais</Text>
            <Text style={styles.dataDescription}>
              Nome, telefone, email, CPF
            </Text>
          </View>
        </View>
        
        <View style={styles.dataItem}>
          <Icon name="location-on" type="material" color="#e74c3c" size={20} />
          <View style={styles.dataInfo}>
            <Text style={styles.dataLabel}>Localização</Text>
            <Text style={styles.dataDescription}>
              Localização em tempo real durante viagens
            </Text>
          </View>
        </View>
        
        <View style={styles.dataItem}>
          <Icon name="payment" type="material" color="#f39c12" size={20} />
          <View style={styles.dataInfo}>
            <Text style={styles.dataLabel}>Dados de Pagamento</Text>
            <Text style={styles.dataDescription}>
              Informações de pagamento processadas pela Woovi
            </Text>
          </View>
        </View>
        
        <View style={styles.dataItem}>
          <Icon name="directions-car" type="material" color="#9b59b6" size={20} />
          <View style={styles.dataInfo}>
            <Text style={styles.dataLabel}>Dados de Viagem</Text>
            <Text style={styles.dataDescription}>
              Histórico de viagens, destinos, avaliações
            </Text>
          </View>
        </View>
      </View>
    </View>
  );

  const renderDataUsage = () => (
    <View style={styles.sectionContent}>
      <Text style={styles.sectionTitle}>Como Usamos seus Dados</Text>
      
      <View style={styles.usageCard}>
        <Text style={styles.usageTitle}>Finalidades Principais:</Text>
        
        <View style={styles.usageItem}>
          <Icon name="directions-car" type="material" color="#2E8B57" size={20} />
          <Text style={styles.usageText}>
            Fornecer serviços de transporte
          </Text>
        </View>
        
        <View style={styles.usageItem}>
          <Icon name="security" type="material" color="#2E8B57" size={20} />
          <Text style={styles.usageText}>
            Garantir segurança e prevenir fraudes
          </Text>
        </View>
        
        <View style={styles.usageItem}>
          <Icon name="support-agent" type="material" color="#2E8B57" size={20} />
          <Text style={styles.usageText}>
            Prestar suporte ao cliente
          </Text>
        </View>
        
        <View style={styles.usageItem}>
          <Icon name="analytics" type="material" color="#2E8B57" size={20} />
          <Text style={styles.usageText}>
            Melhorar nossos serviços
          </Text>
        </View>
      </View>
    </View>
  );

  const renderDataSharing = () => (
    <View style={styles.sectionContent}>
      <Text style={styles.sectionTitle}>Compartilhamento de Dados</Text>
      
      <View style={styles.sharingCard}>
        <Text style={styles.sharingTitle}>Com quem Compartilhamos:</Text>
        
        <View style={styles.sharingItem}>
          <Icon name="account-balance" type="material" color="#3498db" size={20} />
          <Text style={styles.sharingText}>
            Processadores de pagamento (Woovi)
          </Text>
        </View>
        
        <View style={styles.sharingItem}>
          <Icon name="gavel" type="material" color="#e74c3c" size={20} />
          <Text style={styles.sharingText}>
            Autoridades legais (quando exigido)
          </Text>
        </View>
        
        <View style={styles.sharingItem}>
          <Icon name="business" type="material" color="#f39c12" size={20} />
          <Text style={styles.sharingText}>
            Motoristas parceiros (dados limitados)
          </Text>
        </View>
        
        <Text style={styles.sharingNote}>
          Não vendemos, alugamos ou compartilhamos seus dados pessoais com terceiros 
          para fins de marketing sem seu consentimento.
        </Text>
      </View>
    </View>
  );

  const renderDataSecurity = () => (
    <View style={styles.sectionContent}>
      <Text style={styles.sectionTitle}>Segurança dos Dados</Text>
      
      <View style={styles.securityCard}>
        <Text style={styles.securityTitle}>Medidas de Segurança:</Text>
        
        <View style={styles.securityItem}>
          <Icon name="lock" type="material" color="#27ae60" size={20} />
          <Text style={styles.securityText}>
            Criptografia de ponta a ponta
          </Text>
        </View>
        
        <View style={styles.securityItem}>
          <Icon name="security" type="material" color="#27ae60" size={20} />
          <Text style={styles.securityText}>
            Servidores seguros e monitorados
          </Text>
        </View>
        
        <View style={styles.securityItem}>
          <Icon name="verified-user" type="material" color="#27ae60" size={20} />
          <Text style={styles.securityText}>
            Acesso restrito aos dados
          </Text>
        </View>
        
        <View style={styles.securityItem}>
          <Icon name="update" type="material" color="#27ae60" size={20} />
          <Text style={styles.securityText}>
            Atualizações regulares de segurança
          </Text>
        </View>
      </View>
    </View>
  );

  const renderUserRights = () => (
    <View style={styles.sectionContent}>
      <Text style={styles.sectionTitle}>Seus Direitos</Text>
      
      <View style={styles.rightsCard}>
        <Text style={styles.rightsTitle}>Você tem o direito de:</Text>
        
        <View style={styles.rightsItem}>
          <Icon name="visibility" type="material" color="#3498db" size={20} />
          <Text style={styles.rightsText}>
            Acessar seus dados pessoais
          </Text>
        </View>
        
        <View style={styles.rightsItem}>
          <Icon name="edit" type="material" color="#3498db" size={20} />
          <Text style={styles.rightsText}>
            Corrigir dados incorretos
          </Text>
        </View>
        
        <View style={styles.rightsItem}>
          <Icon name="delete" type="material" color="#3498db" size={20} />
          <Text style={styles.rightsText}>
            Solicitar exclusão de dados
          </Text>
        </View>
        
        <View style={styles.rightsItem}>
          <Icon name="block" type="material" color="#3498db" size={20} />
          <Text style={styles.rightsText}>
            Opor-se ao processamento
          </Text>
        </View>
        
        <View style={styles.rightsItem}>
          <Icon name="file-download" type="material" color="#3498db" size={20} />
          <Text style={styles.rightsText}>
            Portabilidade dos dados
          </Text>
        </View>
      </View>
      
      <View style={styles.actionsContainer}>
        <TouchableOpacity
          style={styles.actionButton}
          onPress={downloadUserData}
        >
          <Icon name="file-download" type="material" color="#fff" size={20} />
          <Text style={styles.actionButtonText}>Baixar Meus Dados</Text>
        </TouchableOpacity>
        
        <TouchableOpacity
          style={[styles.actionButton, styles.deleteButton]}
          onPress={deleteUserData}
        >
          <Icon name="delete-forever" type="material" color="#fff" size={20} />
          <Text style={styles.actionButtonText}>Excluir Dados</Text>
        </TouchableOpacity>
      </View>
    </View>
  );

  const renderSettings = () => (
    <View style={styles.sectionContent}>
      <Text style={styles.sectionTitle}>Configurações de Privacidade</Text>
      
      <View style={styles.settingsCard}>
        <View style={styles.settingItem}>
          <View style={styles.settingInfo}>
            <Icon name="location-on" type="material" color="#e74c3c" size={20} />
            <View style={styles.settingDetails}>
              <Text style={styles.settingTitle}>Compartilhamento de Localização</Text>
              <Text style={styles.settingDescription}>
                Permite que o app acesse sua localização para encontrar motoristas
              </Text>
            </View>
          </View>
          <Switch
            value={privacySettings.locationSharing}
            onValueChange={() => handleSettingToggle('locationSharing')}
            trackColor={{ false: '#e0e0e0', true: '#2E8B57' }}
            thumbColor={privacySettings.locationSharing ? '#fff' : '#f4f3f4'}
          />
        </View>
        
        <View style={styles.settingItem}>
          <View style={styles.settingInfo}>
            <Icon name="analytics" type="material" color="#f39c12" size={20} />
            <View style={styles.settingDetails}>
              <Text style={styles.settingTitle}>Análise de Dados</Text>
              <Text style={styles.settingDescription}>
                Permite análise anônima para melhorar nossos serviços
              </Text>
            </View>
          </View>
          <Switch
            value={privacySettings.dataAnalytics}
            onValueChange={() => handleSettingToggle('dataAnalytics')}
            trackColor={{ false: '#e0e0e0', true: '#2E8B57' }}
            thumbColor={privacySettings.dataAnalytics ? '#fff' : '#f4f3f4'}
          />
        </View>
        
        <View style={styles.settingItem}>
          <View style={styles.settingInfo}>
            <Icon name="email" type="material" color="#3498db" size={20} />
            <View style={styles.settingDetails}>
              <Text style={styles.settingTitle}>Emails de Marketing</Text>
              <Text style={styles.settingDescription}>
                Receber ofertas e novidades por email
              </Text>
            </View>
          </View>
          <Switch
            value={privacySettings.marketingEmails}
            onValueChange={() => handleSettingToggle('marketingEmails')}
            trackColor={{ false: '#e0e0e0', true: '#2E8B57' }}
            thumbColor={privacySettings.marketingEmails ? '#fff' : '#f4f3f4'}
          />
        </View>
        
        <View style={styles.settingItem}>
          <View style={styles.settingInfo}>
            <Icon name="notifications" type="material" color="#9b59b6" size={20} />
            <View style={styles.settingDetails}>
              <Text style={styles.settingTitle}>Notificações Push</Text>
              <Text style={styles.settingDescription}>
                Receber notificações sobre viagens e atualizações
              </Text>
            </View>
          </View>
          <Switch
            value={privacySettings.pushNotifications}
            onValueChange={() => handleSettingToggle('pushNotifications')}
            trackColor={{ false: '#e0e0e0', true: '#2E8B57' }}
            thumbColor={privacySettings.pushNotifications ? '#fff' : '#f4f3f4'}
          />
        </View>
        
        <View style={styles.settingItem}>
          <View style={styles.settingInfo}>
            <Icon name="share" type="material" color="#e74c3c" size={20} />
            <View style={styles.settingDetails}>
              <Text style={styles.settingTitle}>Compartilhamento com Terceiros</Text>
              <Text style={styles.settingDescription}>
                Permitir compartilhamento de dados com parceiros
              </Text>
            </View>
          </View>
          <Switch
            value={privacySettings.thirdPartySharing}
            onValueChange={() => handleSettingToggle('thirdPartySharing')}
            trackColor={{ false: '#e0e0e0', true: '#2E8B57' }}
            thumbColor={privacySettings.thirdPartySharing ? '#fff' : '#f4f3f4'}
          />
        </View>
      </View>
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
    <View style={styles.sectionsContainer}>
      <FlatList
        data={sections}
        horizontal
        showsHorizontalScrollIndicator={false}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <TouchableOpacity
            style={[
              styles.sectionTab,
              selectedSection === item.id && styles.activeSectionTab
            ]}
            onPress={() => setSelectedSection(item.id)}
          >
            <Icon 
              name={item.icon} 
              type="material" 
              color={selectedSection === item.id ? '#2E8B57' : '#7f8c8d'} 
              size={20} 
            />
            <Text style={[
              styles.sectionText,
              selectedSection === item.id && styles.activeSectionText
            ]}>
              {item.label}
            </Text>
          </TouchableOpacity>
        )}
        contentContainerStyle={styles.sectionsList}
      />
    </View>
  );

  if (isLoading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#2E8B57" />
        <Text style={styles.loadingText}>Carregando política de privacidade...</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor="#fff" />
      
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => navigation.goBack()}
        >
          <Icon name="arrow-back" type="material" color="#2c3e50" size={24} />
        </TouchableOpacity>
        
        <Text style={styles.headerTitle}>Política de Privacidade</Text>
        
        <TouchableOpacity
          style={styles.helpButton}
          onPress={() => navigation.navigate('HelpScreen')}
        >
          <Icon name="help-outline" type="material" color="#2c3e50" size={24} />
        </TouchableOpacity>
      </View>
      
      {renderSections()}
      
      <ScrollView
        style={styles.content}
        showsVerticalScrollIndicator={false}
      >
        {renderSectionContent()}
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f8f9fa',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#f8f9fa',
  },
  loadingText: {
    marginTop: 16,
    fontSize: 16,
    color: '#7f8c8d',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: Platform.OS === 'ios' ? 50 : 20,
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
    padding: 20,
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
});

export default PrivacyPolicyScreen; 