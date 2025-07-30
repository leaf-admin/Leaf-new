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
  Linking,
  Alert,
  Image
} from 'react-native';
import { Icon } from 'react-native-elements';
import { useSelector } from 'react-redux';
import { api } from '../common-local';

const AboutScreen = ({ navigation, route }) => {
  const [appInfo, setAppInfo] = useState({
    version: '1.0.0',
    buildNumber: '1',
    lastUpdate: '2025-07-28',
    features: [],
    team: [],
    changelog: []
  });
  const [isLoading, setIsLoading] = useState(true);
  const [selectedTab, setSelectedTab] = useState('overview');
  
  const auth = useSelector(state => state.auth);
  const currentUser = auth.profile;

  const tabs = [
    { id: 'overview', label: 'Visão Geral', icon: 'info' },
    { id: 'features', label: 'Recursos', icon: 'star' },
    { id: 'team', label: 'Equipe', icon: 'people' },
    { id: 'changelog', label: 'Atualizações', icon: 'update' },
    { id: 'legal', label: 'Legal', icon: 'gavel' }
  ];

  useEffect(() => {
    loadAppInfo();
  }, []);

  const loadAppInfo = async () => {
    try {
      setIsLoading(true);
      
      const response = await api.get('/api/app/info');
      setAppInfo(response.data);
      
    } catch (error) {
      console.error('Erro ao carregar informações do app:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleLinkPress = (url, title) => {
    Alert.alert(
      'Abrir Link',
      `Deseja abrir ${title}?`,
      [
        { text: 'Cancelar', style: 'cancel' },
        { text: 'Abrir', onPress: () => Linking.openURL(url) }
      ]
    );
  };

  const handleContactPress = (contact) => {
    switch (contact.type) {
      case 'email':
        Linking.openURL(`mailto:${contact.value}`);
        break;
      case 'phone':
        Linking.openURL(`tel:${contact.value}`);
        break;
      case 'website':
        handleLinkPress(contact.value, contact.label);
        break;
      default:
        break;
    }
  };

  const renderOverview = () => (
    <View style={styles.tabContent}>
      <View style={styles.appHeader}>
        <View style={styles.appLogo}>
          <Icon name="local-taxi" type="material" color="#2E8B57" size={48} />
        </View>
        
        <Text style={styles.appName}>Leaf</Text>
        <Text style={styles.appTagline}>Mobilidade Inteligente</Text>
        <Text style={styles.appVersion}>Versão {appInfo.version}</Text>
      </View>
      
      <View style={styles.appDescription}>
        <Text style={styles.descriptionText}>
          O Leaf é uma plataforma de mobilidade urbana que conecta passageiros 
          a motoristas parceiros de forma segura, rápida e eficiente. 
          Nossa missão é transformar a forma como as pessoas se movem pela cidade.
        </Text>
      </View>
      
      <View style={styles.statsContainer}>
        <View style={styles.statItem}>
          <Text style={styles.statNumber}>50K+</Text>
          <Text style={styles.statLabel}>Usuários Ativos</Text>
        </View>
        
        <View style={styles.statItem}>
          <Text style={styles.statNumber}>100K+</Text>
          <Text style={styles.statLabel}>Viagens Realizadas</Text>
        </View>
        
        <View style={styles.statItem}>
          <Text style={styles.statNumber}>4.8</Text>
          <Text style={styles.statLabel}>Avaliação Média</Text>
        </View>
      </View>
      
      <View style={styles.contactSection}>
        <Text style={styles.sectionTitle}>Entre em Contato</Text>
        
        <TouchableOpacity
          style={styles.contactItem}
          onPress={() => handleContactPress({ type: 'email', value: 'contato@leaf.com.br' })}
        >
          <Icon name="email" type="material" color="#3498db" size={20} />
          <Text style={styles.contactText}>contato@leaf.com.br</Text>
          <Icon name="chevron-right" type="material" color="#7f8c8d" size={20} />
        </TouchableOpacity>
        
        <TouchableOpacity
          style={styles.contactItem}
          onPress={() => handleContactPress({ type: 'phone', value: '+55 11 99999-9999' })}
        >
          <Icon name="phone" type="material" color="#27ae60" size={20} />
          <Text style={styles.contactText}>+55 11 99999-9999</Text>
          <Icon name="chevron-right" type="material" color="#7f8c8d" size={20} />
        </TouchableOpacity>
        
        <TouchableOpacity
          style={styles.contactItem}
          onPress={() => handleContactPress({ type: 'website', value: 'https://leaf.com.br', label: 'Site Oficial' })}
        >
          <Icon name="language" type="material" color="#f39c12" size={20} />
          <Text style={styles.contactText}>leaf.com.br</Text>
          <Icon name="chevron-right" type="material" color="#7f8c8d" size={20} />
        </TouchableOpacity>
      </View>
    </View>
  );

  const renderFeatures = () => (
    <View style={styles.tabContent}>
      <Text style={styles.sectionTitle}>Recursos Principais</Text>
      
      <View style={styles.featuresList}>
        <View style={styles.featureItem}>
          <Icon name="payment" type="material" color="#2E8B57" size={24} />
          <View style={styles.featureInfo}>
            <Text style={styles.featureTitle}>Pagamento PIX</Text>
            <Text style={styles.featureDescription}>
              Pagamento instantâneo e seguro via PIX
            </Text>
          </View>
        </View>
        
        <View style={styles.featureItem}>
          <Icon name="security" type="material" color="#2E8B57" size={24} />
          <View style={styles.featureInfo}>
            <Text style={styles.featureTitle}>Segurança Total</Text>
            <Text style={styles.featureDescription}>
              Motoristas verificados e viagens monitoradas
            </Text>
          </View>
        </View>
        
        <View style={styles.featureItem}>
          <Icon name="location-on" type="material" color="#2E8B57" size={24} />
          <View style={styles.featureInfo}>
            <Text style={styles.featureTitle}>Rastreamento em Tempo Real</Text>
            <Text style={styles.featureDescription}>
              Acompanhe sua viagem em tempo real
            </Text>
          </View>
        </View>
        
        <View style={styles.featureItem}>
          <Icon name="support-agent" type="material" color="#2E8B57" size={24} />
          <View style={styles.featureInfo}>
            <Text style={styles.featureTitle}>Suporte 24/7</Text>
            <Text style={styles.featureDescription}>
              Suporte ao cliente disponível 24 horas
            </Text>
          </View>
        </View>
        
        <View style={styles.featureItem}>
          <Icon name="account-balance" type="material" color="#2E8B57" size={24} />
          <View style={styles.featureInfo}>
            <Text style={styles.featureTitle}>Conta Leaf BaaS</Text>
            <Text style={styles.featureDescription}>
              Conta bancária integrada para motoristas
            </Text>
          </View>
        </View>
        
        <View style={styles.featureItem}>
          <Icon name="analytics" type="material" color="#2E8B57" size={24} />
          <View style={styles.featureInfo}>
            <Text style={styles.featureTitle}>Dashboard Avançado</Text>
            <Text style={styles.featureDescription}>
              Análises e relatórios detalhados
            </Text>
          </View>
        </View>
      </View>
    </View>
  );

  const renderTeam = () => (
    <View style={styles.tabContent}>
      <Text style={styles.sectionTitle}>Nossa Equipe</Text>
      
      <View style={styles.teamList}>
        <View style={styles.teamMember}>
          <View style={styles.memberAvatar}>
            <Icon name="person" type="material" color="#fff" size={32} />
          </View>
          <View style={styles.memberInfo}>
            <Text style={styles.memberName}>João Silva</Text>
            <Text style={styles.memberRole}>CEO & Fundador</Text>
            <Text style={styles.memberDescription}>
              Especialista em mobilidade urbana com 10+ anos de experiência
            </Text>
          </View>
        </View>
        
        <View style={styles.teamMember}>
          <View style={styles.memberAvatar}>
            <Icon name="person" type="material" color="#fff" size={32} />
          </View>
          <View style={styles.memberInfo}>
            <Text style={styles.memberName}>Maria Santos</Text>
            <Text style={styles.memberRole}>CTO</Text>
            <Text style={styles.memberDescription}>
              Desenvolvedora full-stack com foco em aplicações móveis
            </Text>
          </View>
        </View>
        
        <View style={styles.teamMember}>
          <View style={styles.memberAvatar}>
            <Icon name="person" type="material" color="#fff" size={32} />
          </View>
          <View style={styles.memberInfo}>
            <Text style={styles.memberName}>Pedro Costa</Text>
            <Text style={styles.memberRole}>Head de Produto</Text>
            <Text style={styles.memberDescription}>
              Especialista em UX/UI e experiência do usuário
            </Text>
          </View>
        </View>
        
        <View style={styles.teamMember}>
          <View style={styles.memberAvatar}>
            <Icon name="person" type="material" color="#fff" size={32} />
          </View>
          <View style={styles.memberInfo}>
            <Text style={styles.memberName}>Ana Oliveira</Text>
            <Text style={styles.memberRole}>Head de Operações</Text>
            <Text style={styles.memberDescription}>
              Responsável pela expansão e qualidade do serviço
            </Text>
          </View>
        </View>
      </View>
    </View>
  );

  const renderChangelog = () => (
    <View style={styles.tabContent}>
      <Text style={styles.sectionTitle}>Histórico de Atualizações</Text>
      
      <View style={styles.changelogList}>
        <View style={styles.changelogItem}>
          <View style={styles.changelogHeader}>
            <Text style={styles.changelogVersion}>v1.0.0</Text>
            <Text style={styles.changelogDate}>28/07/2025</Text>
          </View>
          <Text style={styles.changelogTitle}>Lançamento Inicial</Text>
          <Text style={styles.changelogDescription}>
            • Integração completa com Woovi PIX{'\n'}
            • Sistema de busca de motoristas{'\n'}
            • Rastreamento em tempo real{'\n'}
            • Chat integrado{'\n'}
            • Dashboard para motoristas{'\n'}
            • Conta Leaf BaaS
          </Text>
        </View>
        
        <View style={styles.changelogItem}>
          <View style={styles.changelogHeader}>
            <Text style={styles.changelogVersion}>v0.9.0</Text>
            <Text style={styles.changelogDate}>15/07/2025</Text>
          </View>
          <Text style={styles.changelogTitle}>Beta Testing</Text>
          <Text style={styles.changelogDescription}>
            • Testes com usuários reais{'\n'}
            • Correções de bugs{'\n'}
            • Melhorias de performance{'\n'}
            • Otimização de UI/UX
          </Text>
        </View>
        
        <View style={styles.changelogItem}>
          <View style={styles.changelogHeader}>
            <Text style={styles.changelogVersion}>v0.8.0</Text>
            <Text style={styles.changelogDate}>01/07/2025</Text>
          </View>
          <Text style={styles.changelogTitle}>Desenvolvimento Core</Text>
          <Text style={styles.changelogDescription}>
            • Arquitetura base implementada{'\n'}
            • Integração com APIs{'\n'}
            • Sistema de autenticação{'\n'}
            • Estrutura de navegação
          </Text>
        </View>
      </View>
    </View>
  );

  const renderLegal = () => (
    <View style={styles.tabContent}>
      <Text style={styles.sectionTitle}>Informações Legais</Text>
      
      <View style={styles.legalList}>
        <TouchableOpacity
          style={styles.legalItem}
          onPress={() => navigation.navigate('PrivacyPolicyScreen')}
        >
          <Icon name="privacy-tip" type="material" color="#3498db" size={20} />
          <Text style={styles.legalText}>Política de Privacidade</Text>
          <Icon name="chevron-right" type="material" color="#7f8c8d" size={20} />
        </TouchableOpacity>
        
        <TouchableOpacity
          style={styles.legalItem}
          onPress={() => navigation.navigate('LegalScreen')}
        >
          <Icon name="description" type="material" color="#f39c12" size={20} />
          <Text style={styles.legalText}>Termos de Uso</Text>
          <Icon name="chevron-right" type="material" color="#7f8c8d" size={20} />
        </TouchableOpacity>
        
        <TouchableOpacity
          style={styles.legalItem}
          onPress={() => handleLinkPress('https://leaf.com.br/licenses', 'Licenças')}
        >
          <Icon name="copyright" type="material" color="#e74c3c" size={20} />
          <Text style={styles.legalText}>Licenças de Software</Text>
          <Icon name="chevron-right" type="material" color="#7f8c8d" size={20} />
        </TouchableOpacity>
        
        <TouchableOpacity
          style={styles.legalItem}
          onPress={() => handleLinkPress('https://leaf.com.br/third-party', 'Terceiros')}
        >
          <Icon name="business" type="material" color="#9b59b6" size={20} />
          <Text style={styles.legalText}>Serviços de Terceiros</Text>
          <Icon name="chevron-right" type="material" color="#7f8c8d" size={20} />
        </TouchableOpacity>
      </View>
      
      <View style={styles.legalInfo}>
        <Text style={styles.legalInfoTitle}>Informações da Aplicação</Text>
        <Text style={styles.legalInfoText}>Versão: {appInfo.version}</Text>
        <Text style={styles.legalInfoText}>Build: {appInfo.buildNumber}</Text>
        <Text style={styles.legalInfoText}>Última atualização: {appInfo.lastUpdate}</Text>
        <Text style={styles.legalInfoText}>© 2025 Leaf. Todos os direitos reservados.</Text>
      </View>
    </View>
  );

  const renderTabContent = () => {
    switch (selectedTab) {
      case 'overview':
        return renderOverview();
      case 'features':
        return renderFeatures();
      case 'team':
        return renderTeam();
      case 'changelog':
        return renderChangelog();
      case 'legal':
        return renderLegal();
      default:
        return null;
    }
  };

  const renderTabs = () => (
    <View style={styles.tabsContainer}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.tabsList}
      >
        {tabs.map((tab) => (
          <TouchableOpacity
            key={tab.id}
            style={[
              styles.tab,
              selectedTab === tab.id && styles.activeTab
            ]}
            onPress={() => setSelectedTab(tab.id)}
          >
            <Icon 
              name={tab.icon} 
              type="material" 
              color={selectedTab === tab.id ? '#2E8B57' : '#7f8c8d'} 
              size={20} 
            />
            <Text style={[
              styles.tabText,
              selectedTab === tab.id && styles.activeTabText
            ]}>
              {tab.label}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>
    </View>
  );

  if (isLoading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#2E8B57" />
        <Text style={styles.loadingText}>Carregando informações...</Text>
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
        
        <Text style={styles.headerTitle}>Sobre o App</Text>
        
        <TouchableOpacity
          style={styles.helpButton}
          onPress={() => navigation.navigate('HelpScreen')}
        >
          <Icon name="help-outline" type="material" color="#2c3e50" size={24} />
        </TouchableOpacity>
      </View>
      
      {renderTabs()}
      
      <ScrollView
        style={styles.content}
        showsVerticalScrollIndicator={false}
      >
        {renderTabContent()}
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
  tabsContainer: {
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#e0e0e0',
  },
  tabsList: {
    paddingHorizontal: 16,
  },
  tab: {
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    marginRight: 8,
    borderRadius: 8,
    backgroundColor: '#f8f9fa',
  },
  activeTab: {
    backgroundColor: '#e8f5e8',
  },
  tabText: {
    fontSize: 12,
    color: '#7f8c8d',
    marginTop: 4,
  },
  activeTabText: {
    color: '#2E8B57',
    fontWeight: 'bold',
  },
  content: {
    flex: 1,
  },
  tabContent: {
    padding: 20,
  },
  appHeader: {
    alignItems: 'center',
    marginBottom: 24,
  },
  appLogo: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: '#e8f5e8',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  appName: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#2c3e50',
    marginBottom: 4,
  },
  appTagline: {
    fontSize: 16,
    color: '#7f8c8d',
    marginBottom: 8,
  },
  appVersion: {
    fontSize: 14,
    color: '#95a5a6',
  },
  appDescription: {
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
  descriptionText: {
    fontSize: 14,
    color: '#2c3e50',
    lineHeight: 20,
    textAlign: 'center',
  },
  statsContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 24,
  },
  statItem: {
    flex: 1,
    alignItems: 'center',
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    marginHorizontal: 4,
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
  },
  statNumber: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#2E8B57',
    marginBottom: 4,
  },
  statLabel: {
    fontSize: 12,
    color: '#7f8c8d',
    textAlign: 'center',
  },
  contactSection: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#2c3e50',
    marginBottom: 16,
  },
  contactItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#e0e0e0',
  },
  contactText: {
    fontSize: 14,
    color: '#2c3e50',
    flex: 1,
    marginLeft: 12,
  },
  featuresList: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
  },
  featureItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 16,
  },
  featureInfo: {
    marginLeft: 12,
    flex: 1,
  },
  featureTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#2c3e50',
    marginBottom: 4,
  },
  featureDescription: {
    fontSize: 14,
    color: '#7f8c8d',
    lineHeight: 18,
  },
  teamList: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
  },
  teamMember: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 20,
  },
  memberAvatar: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: '#2E8B57',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 16,
  },
  memberInfo: {
    flex: 1,
  },
  memberName: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#2c3e50',
    marginBottom: 2,
  },
  memberRole: {
    fontSize: 14,
    color: '#2E8B57',
    marginBottom: 4,
  },
  memberDescription: {
    fontSize: 12,
    color: '#7f8c8d',
    lineHeight: 16,
  },
  changelogList: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
  },
  changelogItem: {
    marginBottom: 20,
    paddingBottom: 20,
    borderBottomWidth: 1,
    borderBottomColor: '#e0e0e0',
  },
  changelogHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  changelogVersion: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#2E8B57',
  },
  changelogDate: {
    fontSize: 12,
    color: '#7f8c8d',
  },
  changelogTitle: {
    fontSize: 14,
    fontWeight: 'bold',
    color: '#2c3e50',
    marginBottom: 8,
  },
  changelogDescription: {
    fontSize: 12,
    color: '#7f8c8d',
    lineHeight: 16,
  },
  legalList: {
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
  legalItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#e0e0e0',
  },
  legalText: {
    fontSize: 14,
    color: '#2c3e50',
    flex: 1,
    marginLeft: 12,
  },
  legalInfo: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
  },
  legalInfoTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#2c3e50',
    marginBottom: 12,
  },
  legalInfoText: {
    fontSize: 12,
    color: '#7f8c8d',
    marginBottom: 4,
  },
});

export default AboutScreen; 