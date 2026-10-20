import leafTypography from '../components/prototype/LeafTypography';
import React, { useCallback, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  StatusBar,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LeafObjectIcon } from '../components/prototype/LeafVisualElements';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useSelector } from 'react-redux';
import { useAccountDeletionFlow } from '../hooks/useAccountDeletionFlow';
import {
  PrototypeMenuCloseButton,
  PrototypeMenuInfoRow,
  PrototypeMenuRow,
  PrototypeMenuSection,
  PrototypeMenuSurface,
} from '../components/prototype/PrototypeMenuSurface';
import robotaxiPrototypeTokens from '../components/design-system/robotaxiPrototypeTokens';
import { leafButtonMetrics } from '../components/prototype/LeafRideUI';

const { color, typography } = robotaxiPrototypeTokens;
const SURFACE_TOP_PADDING = 16;
const SURFACE_BOTTOM_PADDING = 18;

const PrivacyPolicyScreen = ({ navigation, route }) => {
  const insets = useSafeAreaInsets();
  const [selectedSection, setSelectedSection] = useState(() => route?.params?.initialSection || 'overview');
  const [sectionsExpanded, setSectionsExpanded] = useState(false);
  
  const authState = useSelector(state => state.auth);
  const currentUser = authState.profile;
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
    { id: 'user-rights', label: 'Seus direitos', icon: 'trash-outline' },
  ];
  const isAccountDeletionEntry = selectedSection === 'user-rights';

  // Data export has no backend endpoint yet; route the LGPD request to support
  // (a real ticket) instead of promising an email that is never sent.
  const downloadUserData = () => {
    navigation.navigate('RobotaxiPrototypeSupportTicket', {
      type: 'account',
      subject: 'Solicitação de cópia dos meus dados',
      description: 'Quero receber uma cópia dos meus dados pessoais (LGPD).',
      source: 'privacy-data-export',
    });
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
        <LeafObjectIcon symbol={icon} size={40} />
      </View>
      <View style={styles.detailCopy}>
        <Text style={styles.detailTitle}>{title}</Text>
        {description ? <Text style={styles.detailDescription}>{description}</Text> : null}
      </View>
    </View>
  );

  const renderOverview = () => (
    <View style={styles.sectionContent}>
      <PrototypeMenuSection title="Resumo">
        <PrototypeMenuInfoRow label="Atualização" value="28 de julho de 2025" />
        <Text style={styles.bodyCopy}>
          A Leaf respeita sua privacidade e está comprometida em proteger seus dados pessoais.
          Esta política descreve como coletamos, usamos e protegemos suas informações.
        </Text>
      </PrototypeMenuSection>

      <PrototypeMenuSection title="Principais pontos">
        {renderDetailRow({ icon: 'checkmark-circle-outline', title: 'Não vendemos seus dados pessoais' })}
        {renderDetailRow({ icon: 'options-outline', title: 'Você controla suas preferências de privacidade' })}
        {renderDetailRow({ icon: 'lock-closed-outline', title: 'Dados protegidos por controles de segurança' })}
        {renderDetailRow({ icon: 'document-text-outline', title: 'Em conformidade com a LGPD', last: true })}
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
        {renderDetailRow({ icon: 'analytics-outline', title: 'Melhorar o serviço', description: 'Analisar erros, desempenho e uso do app, sem nome, telefone ou documentos. Você pode desligar os dados de uso em Configurações.', last: true })}
      </PrototypeMenuSection>
    </View>
  );

  const renderDataSharing = () => (
    <View style={styles.sectionContent}>
      <PrototypeMenuSection title="Compartilhamento">
        {renderDetailRow({ icon: 'business-outline', title: 'Processadores de pagamento', description: 'Dados necessários para processar cobranças e recibos.' })}
        {renderDetailRow({ icon: 'document-text-outline', title: 'Autoridades legais', description: 'Somente quando exigido por obrigação legal.' })}
        {renderDetailRow({ icon: 'car-sport-outline', title: 'Motoristas parceiros', description: 'Dados limitados para executar a viagem.' })}
        {renderDetailRow({ icon: 'pulse-outline', title: 'Monitoramento do app', description: 'Ferramentas de erros e de uso recebem um identificador da conta, sem dados pessoais.', last: true })}
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
      default:
        return null;
    }
  };

  const renderSections = () => (
    <PrototypeMenuSection title="Tópicos">
      <PrototypeMenuRow
        icon="document-text-outline"
        title={sections.find(item => item.id === selectedSection)?.label || 'Tópicos'}
        subtitle={sectionsExpanded ? 'Escolha o conteúdo abaixo' : 'Ver todos os tópicos'}
        last={!sectionsExpanded}
        trailing={<Ionicons name={sectionsExpanded ? 'chevron-up' : 'chevron-down'} size={18} color={color.text.secondary} />}
        onPress={() => setSectionsExpanded(current => !current)}
        expanded={sectionsExpanded}
        testID="privacy-topic-selector"
        accessibilityLabel="Tópicos de privacidade"
        accessibilityHint={sectionsExpanded ? 'Recolher a lista de tópicos.' : 'Abrir a lista de tópicos.'}
      />
      {sectionsExpanded ? sections.map((item, index) => (
        <PrototypeMenuRow
          key={item.id}
          icon={item.icon}
          title={item.label}
          active={selectedSection === item.id}
          last={index === sections.length - 1}
          onPress={() => { setSelectedSection(item.id); setSectionsExpanded(false); }}
          testID={`privacy-topic-${item.id}`}
          accessibilityLabel={item.label}
        />
      )) : null}
    </PrototypeMenuSection>
  );


  return (
    <View
      style={styles.container}
      testID="privacy-policy-screen"
    >
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
    fontSize: 22,
    fontFamily: 'Figtree-Bold',
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
    fontFamily: 'Figtree-Bold',
  },
  content: {
    flex: 1,
  },
  sectionContent: {
    padding: 0,
  },
  sectionTitle: {
    fontSize: 20,
    fontFamily: 'Figtree-Bold',
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
    fontFamily: 'Figtree-Bold',
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
    minHeight: leafButtonMetrics.height,
    borderRadius: leafButtonMetrics.radius,
    backgroundColor: '#c0392b',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  accountDeletionButtonText: {
    color: '#fff',
    fontSize: 14,
    fontFamily: 'Figtree-Bold',
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
    fontFamily: 'Figtree-Bold',
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
    fontFamily: 'Figtree-Bold',
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
    fontFamily: 'Figtree-Bold',
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
    fontFamily: 'Figtree-Bold',
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
    fontFamily: 'Figtree-Bold',
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
    fontFamily: 'Figtree-Bold',
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
    fontFamily: 'Figtree-Bold',
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
    fontFamily: 'Figtree-Bold',
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
    fontFamily: 'Figtree-Bold',
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
    ...leafTypography.regular,
    fontSize: typography.body.size,
    lineHeight: typography.body.lineHeight,
    paddingTop: 10,
    paddingBottom: 4,
  },
  detailRow: {
    minHeight: 68,
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#E5E5E5',
  },
  detailRowLast: {
    borderBottomWidth: 0,
    paddingBottom: 4,
  },
  detailIconSlot: {
    width: 52,
    alignItems: 'flex-start',
    justifyContent: 'center',
  },
  detailCopy: {
    flex: 1,
    paddingRight: 8,
  },
  detailTitle: {
    color: color.text.primary,
    ...leafTypography.semiBold,
    fontSize: 16,
    lineHeight: 22,
  },
  detailDescription: {
    marginTop: 1,
    color: color.text.secondary,
    ...leafTypography.regular,
    fontSize: 14,
    lineHeight: 20,
  },
});

export default PrivacyPolicyScreen; 
