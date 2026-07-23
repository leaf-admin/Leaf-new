import Logger from '../utils/Logger';
import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  StatusBar,
  ActivityIndicator,
  Linking,
  Alert,
  FlatList
} from 'react-native';
import { Icon } from 'react-native-elements';
import { Ionicons } from '@expo/vector-icons';
import { useSelector } from 'react-redux';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { apiClient } from '../services/httpClient';
import { fonts } from '../theme/runtimeTokens';
import robotaxiPrototypeTokens from '../components/design-system/robotaxiPrototypeTokens';

const { color, radius, spacing, touch } = robotaxiPrototypeTokens;

const LegalScreen = ({ navigation, route }) => {
  const insets = useSafeAreaInsets();
  const [selectedSection, setSelectedSection] = useState('terms');
  const [legalData, setLegalData] = useState({
    terms: '',
    privacy: '',
    cookies: '',
    licenses: []
  });
  const [isLoading, setIsLoading] = useState(true);
  const [expandedSection, setExpandedSection] = useState(null);
  
  // ✅ CRÍTICO: LegalScreen deve funcionar SEM login
  // Não usar auth para bloquear acesso
  const auth = useSelector(state => state.auth);
  // currentUser pode ser null - tela funciona sem login

  const sections = [
    { id: 'terms', label: 'Termos de Uso', icon: 'description' },
    { id: 'privacy', label: 'Privacidade', icon: 'privacy-tip' },
    { id: 'cookies', label: 'Cookies', icon: 'cookie' },
    { id: 'licenses', label: 'Licenças', icon: 'copyright' },
    { id: 'compliance', label: 'Conformidade', icon: 'verified' }
  ];

  useEffect(() => {
    loadLegalData();
  }, []);

  const loadLegalData = async () => {
    try {
      setIsLoading(true);
      
      // ✅ Tentar carregar do backend, mas não falhar se não conseguir
      try {
      const response = await apiClient.get('/api/legal/content');
        if (response.data) {
      setLegalData(response.data);
        }
      } catch (apiError) {
        // ✅ CRÍTICO: Erro ao carregar do backend não deve quebrar a tela
        // O conteúdo hardcoded será usado como fallback
        Logger.warn('⚠️ Erro ao carregar dados legais do backend. Usando conteúdo padrão.');
      }
      
    } catch (error) {
      Logger.error('Erro ao carregar dados legais:', error);
      // ✅ Sempre mostrar conteúdo mesmo se falhar
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

  const handleBack = () => {
    if (navigation.canGoBack?.()) {
      navigation.goBack();
      return;
    }

    const routeNames = navigation?.getState?.()?.routeNames || [];
    if (routeNames.includes('RobotaxiPrototype')) {
      navigation.navigate('RobotaxiPrototype');
      return;
    }
    if (routeNames.includes('Splash')) {
      navigation.navigate('Splash');
    }
  };

  const renderTerms = () => (
    <View style={styles.sectionContent}>
      <Text style={styles.sectionTitle}>Termos de Uso</Text>
      <Text style={styles.lastUpdated}>Última atualização: 28 de Julho de 2025</Text>
      
      <View style={styles.legalCard}>
        <Text style={styles.legalText}>
          <Text style={styles.boldText}>1. Aceitação dos Termos</Text>{'\n\n'}
          Ao usar o aplicativa Leaf, você concorda com estes Termos de Uso. 
          Se você não concordar com qualquer parte destes termos, não deve usar nossos serviços.{'\n\n'}
          
          <Text style={styles.boldText}>2. Descrição do Serviço</Text>{'\n\n'}
          A Leaf é uma plataforma de mobilidade urbana que conecta passageiros a motoristas parceiros. 
          Fornecemos serviços de transporte, processamento de pagamentos e comunicação entre usuários.{'\n\n'}
          
          <Text style={styles.boldText}>3. Elegibilidade</Text>{'\n\n'}
          Para usar nossos serviços, você deve ter pelo menos 18 anos de idade e capacidade legal para contratar. 
          Motoristas devem atender aos requisitos adicionais de elegibilidade.{'\n\n'}
          
          <Text style={styles.boldText}>4. Conta do Usuário</Text>{'\n\n'}
          Você é responsável por manter a confidencialidade de sua conta e senha. 
          Todas as atividades que ocorrem em sua conta são de sua responsabilidade.{'\n\n'}
          
          <Text style={styles.boldText}>5. Uso Aceitável</Text>{'\n\n'}
          Você concorda em usar nossos serviços apenas para fins legais e de acordo com estes termos. 
          É proibido usar nossos serviços para atividades ilegais ou prejudiciais.{'\n\n'}
          
          <Text style={styles.boldText}>6. Pagamentos e Taxas</Text>{'\n\n'}
          Os preços das viagens são calculados com base na distância, tempo e demanda. 
          Todas as taxas são cobradas através de nossos parceiros de pagamento autorizados.{'\n\n'}
          
          <Text style={styles.boldText}>7. Cancelamentos</Text>{'\n\n'}
          Cancelamentos podem estar sujeitos a taxas conforme nossa política de cancelamento. 
          Consulte nossa política completa para mais detalhes.{'\n\n'}
          
          <Text style={styles.boldText}>8. Limitação de Responsabilidade</Text>{'\n\n'}
          A Leaf não se responsabiliza por danos indiretos, incidentais ou consequenciais 
          decorrentes do uso de nossos serviços.{'\n\n'}
          
          <Text style={styles.boldText}>9. Modificações</Text>{'\n\n'}
          Reservamo-nos o direito de modificar estes termos a qualquer momento. 
          Mudanças significativas serão comunicadas através do aplicativo.{'\n\n'}
          
          <Text style={styles.boldText}>10. Contato</Text>{'\n\n'}
          Para dúvidas sobre estes termos, entre em contato conosco através do suporte do aplicativo.
        </Text>
      </View>
    </View>
  );

  const renderPrivacy = () => (
    <View style={styles.sectionContent}>
      <Text style={styles.sectionTitle}>Política de Privacidade</Text>
      <Text style={styles.lastUpdated}>Última atualização: 28 de Julho de 2025</Text>
      
      <View style={styles.legalCard}>
        <Text style={styles.legalText}>
          <Text style={styles.boldText}>Coleta de Informações</Text>{'\n\n'}
          Coletamos informações que você nos fornece diretamente, como dados de perfil, 
          informações de pagamento e dados de localização durante viagens.{'\n\n'}
          
          <Text style={styles.boldText}>Uso das Informações</Text>{'\n\n'}
          Utilizamos suas informações para fornecer nossos serviços, processar pagamentos, 
          melhorar nossos serviços e cumprir obrigações legais.{'\n\n'}
          
          <Text style={styles.boldText}>Compartilhamento de Dados</Text>{'\n\n'}
          Compartilhamos dados apenas com motoristas parceiros (dados limitados), 
          processadores de pagamento e autoridades quando exigido por lei.{'\n\n'}
          
          <Text style={styles.boldText}>Segurança</Text>{'\n\n'}
          Implementamos medidas de segurança técnicas e organizacionais para proteger 
          suas informações pessoais contra acesso não autorizado.{'\n\n'}
          
          <Text style={styles.boldText}>Seus Direitos</Text>{'\n\n'}
          Você tem direito de acessar, corrigir, excluir e portar seus dados pessoais. 
          Para exercer esses direitos, entre em contato conosco.{'\n\n'}
          
          <Text style={styles.boldText}>Retenção de Dados</Text>{'\n\n'}
          Mantemos seus dados pelo tempo necessário para fornecer nossos serviços 
          e cumprir obrigações legais.{'\n\n'}
          
          <Text style={styles.boldText}>Cookies e Tecnologias Similares</Text>{'\n\n'}
          Utilizamos cookies e tecnologias similares para melhorar sua experiência 
          e analisar o uso de nossos serviços.
        </Text>
      </View>
    </View>
  );

  const renderCookies = () => (
    <View style={styles.sectionContent}>
      <Text style={styles.sectionTitle}>Política de Cookies</Text>
      <Text style={styles.lastUpdated}>Última atualização: 28 de Julho de 2025</Text>
      
      <View style={styles.legalCard}>
        <Text style={styles.legalText}>
          <Text style={styles.boldText}>O que são Cookies?</Text>{'\n\n'}
          Cookies são pequenos arquivos de texto armazenados em seu dispositivo 
          que nos ajudam a melhorar sua experiência no aplicativo.{'\n\n'}
          
          <Text style={styles.boldText}>Tipos de Cookies que Utilizamos</Text>{'\n\n'}
          • Cookies Essenciais: Necessários para o funcionamento básico do app{'\n'}
          • Cookies de Performance: Nos ajudam a entender como você usa o app{'\n'}
          • Cookies de Funcionalidade: Lembram suas preferências{'\n'}
          • Cookies de Marketing: Usados para publicidade relevante{'\n\n'}
          
          <Text style={styles.boldText}>Controle de Cookies</Text>{'\n\n'}
          Você pode controlar e gerenciar cookies através das configurações do seu dispositivo. 
          Note que desabilitar cookies pode afetar a funcionalidade do app.{'\n\n'}
          
          <Text style={styles.boldText}>Cookies de Terceiros</Text>{'\n\n'}
          Alguns cookies são definidos por nossos parceiros, como processadores de pagamento 
          e provedores de análise.{'\n\n'}
          
          <Text style={styles.boldText}>Atualizações</Text>{'\n\n'}
          Esta política pode ser atualizada periodicamente. Recomendamos revisar 
          regularmente para estar ciente de qualquer mudança.
        </Text>
      </View>
    </View>
  );

  const renderLicenses = () => (
    <View style={styles.sectionContent}>
      <Text style={styles.sectionTitle}>Licenças de Software</Text>
      
      <View style={styles.licensesList}>
        <View style={styles.licenseItem}>
          <Text style={styles.licenseTitle}>React Native</Text>
          <Text style={styles.licenseType}>MIT License</Text>
          <Text style={styles.licenseDescription}>
            Framework JavaScript para desenvolvimento de aplicações móveis
          </Text>
          <TouchableOpacity
            style={styles.licenseLink}
            onPress={() => handleLinkPress('https://github.com/facebook/react-native/blob/main/LICENSE', 'Licença React Native')}
          >
            <Text style={styles.linkText}>Ver Licença Completa</Text>
          </TouchableOpacity>
        </View>
        
        <View style={styles.licenseItem}>
          <Text style={styles.licenseTitle}>Firebase</Text>
          <Text style={styles.licenseType}>Apache 2.0 License</Text>
          <Text style={styles.licenseDescription}>
            Plataforma de desenvolvimento de aplicações móveis e web
          </Text>
          <TouchableOpacity
            style={styles.licenseLink}
            onPress={() => handleLinkPress('https://firebase.google.com/terms', 'Termos Firebase')}
          >
            <Text style={styles.linkText}>Ver Termos de Serviço</Text>
          </TouchableOpacity>
        </View>
        
        <View style={styles.licenseItem}>
          <Text style={styles.licenseTitle}>Woovi (OpenPix)</Text>
          <Text style={styles.licenseType}>Termos de Serviço</Text>
          <Text style={styles.licenseDescription}>
            Processador de pagamentos PIX
          </Text>
          <TouchableOpacity
            style={styles.licenseLink}
            onPress={() => handleLinkPress('https://woovi.com/terms', 'Termos Woovi')}
          >
            <Text style={styles.linkText}>Ver Termos de Serviço</Text>
          </TouchableOpacity>
        </View>
        
        <View style={styles.licenseItem}>
          <Text style={styles.licenseTitle}>React Native Elements</Text>
          <Text style={styles.licenseType}>MIT License</Text>
          <Text style={styles.licenseDescription}>
            Biblioteca de componentes UI para React Native
          </Text>
          <TouchableOpacity
            style={styles.licenseLink}
            onPress={() => handleLinkPress('https://github.com/react-native-elements/react-native-elements/blob/master/LICENSE', 'Licença RNE')}
          >
            <Text style={styles.linkText}>Ver Licença Completa</Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );

  const renderCompliance = () => (
    <View style={styles.sectionContent}>
      <Text style={styles.sectionTitle}>Conformidade Legal</Text>
      
      <View style={styles.complianceList}>
        <View style={styles.complianceItem}>
          <Icon name="gavel" type="material" color="#3498db" size={24} />
          <View style={styles.complianceInfo}>
            <Text style={styles.complianceTitle}>LGPD - Lei Geral de Proteção de Dados</Text>
            <Text style={styles.complianceDescription}>
              Conformidade total com a Lei nº 13.709/2018, garantindo proteção adequada 
              aos dados pessoais dos usuários.
            </Text>
          </View>
        </View>
        
        <View style={styles.complianceItem}>
          <Icon name="security" type="material" color="#27ae60" size={24} />
          <View style={styles.complianceInfo}>
            <Text style={styles.complianceTitle}>ISO 27001 - Segurança da Informação</Text>
            <Text style={styles.complianceDescription}>
              Implementação de controles de segurança da informação conforme 
              padrões internacionais.
            </Text>
          </View>
        </View>
        
        <View style={styles.complianceItem}>
          <Icon name="verified-user" type="material" color="#f39c12" size={24} />
          <View style={styles.complianceInfo}>
            <Text style={styles.complianceTitle}>PCI DSS - Segurança de Pagamentos</Text>
            <Text style={styles.complianceDescription}>
              Conformidade com padrões de segurança para processamento de pagamentos 
              via PIX.
            </Text>
          </View>
        </View>
        
        <View style={styles.complianceItem}>
          <Icon name="business" type="material" color="#9b59b6" size={24} />
          <View style={styles.complianceInfo}>
            <Text style={styles.complianceTitle}>Regulamentações de Transporte</Text>
            <Text style={styles.complianceDescription}>
              Conformidade com regulamentações locais de transporte e mobilidade urbana 
              em todas as cidades atendidas.
            </Text>
          </View>
        </View>
      </View>
      
      <View style={styles.certificationsContainer}>
        <Text style={styles.certificationsTitle}>Certificações e Auditorias</Text>
        
        <View style={styles.certificationItem}>
          <Icon name="check-circle" type="material" color="#27ae60" size={20} />
          <Text style={styles.certificationText}>
            Auditoria anual de segurança da informação
          </Text>
        </View>
        
        <View style={styles.certificationItem}>
          <Icon name="check-circle" type="material" color="#27ae60" size={20} />
          <Text style={styles.certificationText}>
            Certificação de conformidade LGPD
          </Text>
        </View>
        
        <View style={styles.certificationItem}>
          <Icon name="check-circle" type="material" color="#27ae60" size={20} />
          <Text style={styles.certificationText}>
            Validação de segurança de pagamentos
          </Text>
        </View>
        
        <View style={styles.certificationItem}>
          <Icon name="check-circle" type="material" color="#27ae60" size={20} />
          <Text style={styles.certificationText}>
            Monitoramento contínuo de compliance
          </Text>
        </View>
      </View>
    </View>
  );

  const renderSectionContent = () => {
    switch (selectedSection) {
      case 'terms':
        return renderTerms();
      case 'privacy':
        return renderPrivacy();
      case 'cookies':
        return renderCookies();
      case 'licenses':
        return renderLicenses();
      case 'compliance':
        return renderCompliance();
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
            accessibilityRole="tab"
            accessibilityState={{ selected: selectedSection === item.id }}
            accessibilityLabel={item.label}
            testID={`legal-section-${item.id}`}
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
      <View style={[styles.loadingContainer, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
        <ActivityIndicator size="large" color={color.accent.primary} />
        <Text style={styles.loadingText}>Carregando informações legais...</Text>
      </View>
    );
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top }]} testID="legal-screen" accessibilityLabel="legal-screen">
      <StatusBar translucent barStyle="dark-content" backgroundColor="transparent" />
      
      <View style={styles.header}>
        <View style={styles.headerCopy}>
          <Text style={styles.headerTitle}>Informações legais</Text>
          <Text style={styles.headerSubtitle}>Termos, privacidade e licenças em um só lugar.</Text>
        </View>
        <TouchableOpacity
          style={styles.closeButton}
          onPress={handleBack}
          accessibilityRole="button"
          accessibilityLabel="Fechar informações legais"
          testID="legal-close-button"
        >
          <Ionicons name="close" color={color.text.primary} size={18} />
        </TouchableOpacity>
      </View>
      
      {renderSections()}
      
      <ScrollView
        style={styles.content}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: Math.max(insets.bottom, spacing.lg) }}
      >
        {renderSectionContent()}
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: color.bg.app,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: color.bg.app,
  },
  loadingText: {
    marginTop: 16,
    fontFamily: fonts.Regular,
    fontSize: 15,
    color: color.text.secondary,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.lg,
    paddingBottom: spacing.md,
    backgroundColor: color.bg.app,
    borderBottomWidth: 1,
    borderBottomColor: color.border.subtle,
  },
  headerCopy: {
    flex: 1,
    paddingRight: spacing.md,
  },
  headerTitle: {
    fontFamily: fonts.SemiBold,
    fontSize: 22,
    lineHeight: 28,
    color: color.text.primary,
  },
  headerSubtitle: {
    marginTop: spacing.xs,
    fontFamily: fonts.Regular,
    fontSize: 13,
    lineHeight: 18,
    color: color.text.secondary,
  },
  closeButton: {
    width: touch.min,
    height: touch.min,
    borderRadius: touch.min / 2,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: color.surface.secondary,
  },
  sectionsContainer: {
    backgroundColor: color.bg.app,
    borderBottomWidth: 1,
    borderBottomColor: color.border.subtle,
  },
  sectionsList: {
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.sm,
  },
  sectionTab: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: touch.comfortable,
    minWidth: 88,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    marginRight: spacing.xs,
    borderRadius: radius.md,
    backgroundColor: color.surface.secondary,
    borderWidth: 1,
    borderColor: color.border.subtle,
  },
  activeSectionTab: {
    backgroundColor: color.surface.activeStrong,
    borderColor: color.accent.soft,
  },
  sectionText: {
    fontFamily: fonts.Medium,
    fontSize: 12,
    lineHeight: 16,
    color: color.text.secondary,
    marginTop: 4,
  },
  activeSectionText: {
    color: color.accent.primary,
    fontFamily: fonts.SemiBold,
  },
  content: {
    flex: 1,
  },
  sectionContent: {
    padding: spacing.xl,
  },
  sectionTitle: {
    fontFamily: fonts.SemiBold,
    fontSize: 20,
    lineHeight: 26,
    color: color.text.primary,
    marginBottom: 8,
  },
  lastUpdated: {
    fontSize: 12,
    fontFamily: fonts.Regular,
    color: color.text.secondary,
    marginBottom: 20,
  },
  legalCard: {
    backgroundColor: color.surface.primary,
    borderRadius: radius.lg,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: color.border.subtle,
  },
  legalText: {
    fontSize: 14,
    fontFamily: fonts.Regular,
    color: color.text.primary,
    lineHeight: 22,
  },
  boldText: {
    fontFamily: fonts.SemiBold,
  },
  licensesList: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
  },
  licenseItem: {
    marginBottom: 20,
    paddingBottom: 20,
    borderBottomWidth: 1,
    borderBottomColor: '#e0e0e0',
  },
  licenseTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#2c3e50',
    marginBottom: 4,
  },
  licenseType: {
    fontSize: 12,
    color: '#2E8B57',
    fontWeight: 'bold',
    marginBottom: 8,
  },
  licenseDescription: {
    fontSize: 14,
    color: '#7f8c8d',
    marginBottom: 8,
  },
  licenseLink: {
    alignSelf: 'flex-start',
  },
  linkText: {
    fontSize: 12,
    color: '#3498db',
    textDecorationLine: 'underline',
  },
  complianceList: {
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
  complianceItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 20,
  },
  complianceInfo: {
    marginLeft: 12,
    flex: 1,
  },
  complianceTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#2c3e50',
    marginBottom: 4,
  },
  complianceDescription: {
    fontSize: 14,
    color: '#7f8c8d',
    lineHeight: 18,
  },
  certificationsContainer: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
  },
  certificationsTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#2c3e50',
    marginBottom: 16,
  },
  certificationItem: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  certificationText: {
    fontSize: 14,
    color: '#2c3e50',
    marginLeft: 8,
  },
});

export default LegalScreen;
