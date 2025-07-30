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
  FlatList,
  Linking,
  Alert
} from 'react-native';
import { Icon } from 'react-native-elements';
import { useSelector } from 'react-redux';
import { api } from '../common-local';

const HelpScreen = ({ navigation, route }) => {
  const [selectedCategory, setSelectedCategory] = useState('getting-started');
  const [helpData, setHelpData] = useState({
    categories: [],
    tutorials: [],
    guides: [],
    emergencyContacts: []
  });
  const [isLoading, setIsLoading] = useState(true);
  const [expandedItem, setExpandedItem] = useState(null);
  
  const auth = useSelector(state => state.auth);
  const currentUser = auth.profile;

  const categories = [
    { id: 'getting-started', label: 'Primeiros Passos', icon: 'play-circle-outline' },
    { id: 'trips', label: 'Viagens', icon: 'directions-car' },
    { id: 'payments', label: 'Pagamentos', icon: 'payment' },
    { id: 'account', label: 'Conta', icon: 'account-circle' },
    { id: 'safety', label: 'Segurança', icon: 'security' },
    { id: 'troubleshooting', label: 'Problemas', icon: 'build' }
  ];

  useEffect(() => {
    loadHelpData();
  }, []);

  const loadHelpData = async () => {
    try {
      setIsLoading(true);
      
      const response = await api.get('/api/help/content');
      setHelpData(response.data);
      
    } catch (error) {
      console.error('Erro ao carregar dados de ajuda:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleEmergencyCall = (contact) => {
    Alert.alert(
      'Contato de Emergência',
      `Deseja ligar para ${contact.name}?`,
      [
        { text: 'Cancelar', style: 'cancel' },
        { 
          text: 'Ligar', 
          onPress: () => Linking.openURL(`tel:${contact.phone}`)
        }
      ]
    );
  };

  const handleVideoTutorial = (tutorial) => {
    // Implementar reprodução de vídeo
    Alert.alert(
      'Tutorial em Vídeo',
      `Reproduzir: ${tutorial.title}`,
      [{ text: 'OK' }]
    );
  };

  const handleGuidePress = (guide) => {
    navigation.navigate('GuideDetails', { guide });
  };

  const renderGettingStarted = () => (
    <View style={styles.categoryContent}>
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Bem-vindo ao Leaf!</Text>
        <Text style={styles.sectionDescription}>
          Aprenda como usar o app Leaf para suas viagens de forma segura e eficiente.
        </Text>
      </View>
      
      <View style={styles.stepsContainer}>
        <View style={styles.stepItem}>
          <View style={styles.stepNumber}>
            <Text style={styles.stepNumberText}>1</Text>
          </View>
          <View style={styles.stepContent}>
            <Text style={styles.stepTitle}>Criar Conta</Text>
            <Text style={styles.stepDescription}>
              Registre-se com seu telefone e complete seu perfil
            </Text>
          </View>
        </View>
        
        <View style={styles.stepItem}>
          <View style={styles.stepNumber}>
            <Text style={styles.stepNumberText}>2</Text>
          </View>
          <View style={styles.stepContent}>
            <Text style={styles.stepTitle}>Definir Destino</Text>
            <Text style={styles.stepDescription}>
              Digite seu destino no mapa ou escolha um local salvo
            </Text>
          </View>
        </View>
        
        <View style={styles.stepItem}>
          <View style={styles.stepNumber}>
            <Text style={styles.stepNumberText}>3</Text>
          </View>
          <View style={styles.stepContent}>
            <Text style={styles.stepTitle}>Pagar e Viajar</Text>
            <Text style={styles.stepDescription}>
              Pague via PIX e aguarde o motorista chegar
            </Text>
          </View>
        </View>
      </View>
    </View>
  );

  const renderTutorials = () => (
    <View style={styles.categoryContent}>
      <Text style={styles.sectionTitle}>Tutoriais em Vídeo</Text>
      
      <FlatList
        data={helpData.tutorials.filter(t => t.category === selectedCategory)}
        keyExtractor={(item) => item.id.toString()}
        renderItem={({ item }) => (
          <TouchableOpacity
            style={styles.tutorialCard}
            onPress={() => handleVideoTutorial(item)}
          >
            <View style={styles.tutorialHeader}>
              <Icon name="play-circle-outline" type="material" color="#2E8B57" size={24} />
              <Text style={styles.tutorialTitle}>{item.title}</Text>
            </View>
            
            <Text style={styles.tutorialDescription}>
              {item.description}
            </Text>
            
            <View style={styles.tutorialMeta}>
              <Text style={styles.tutorialDuration}>{item.duration}</Text>
              <Text style={styles.tutorialLevel}>{item.level}</Text>
            </View>
          </TouchableOpacity>
        )}
        showsVerticalScrollIndicator={false}
      />
    </View>
  );

  const renderGuides = () => (
    <View style={styles.categoryContent}>
      <Text style={styles.sectionTitle}>Guias Detalhados</Text>
      
      <FlatList
        data={helpData.guides.filter(g => g.category === selectedCategory)}
        keyExtractor={(item) => item.id.toString()}
        renderItem={({ item }) => (
          <TouchableOpacity
            style={styles.guideCard}
            onPress={() => handleGuidePress(item)}
          >
            <View style={styles.guideHeader}>
              <Icon name="description" type="material" color="#3498db" size={24} />
              <Text style={styles.guideTitle}>{item.title}</Text>
            </View>
            
            <Text style={styles.guideDescription}>
              {item.description}
            </Text>
            
            <View style={styles.guideMeta}>
              <Text style={styles.guideReadTime}>{item.readTime} min de leitura</Text>
              <Icon name="chevron-right" type="material" color="#7f8c8d" size={20} />
            </View>
          </TouchableOpacity>
        )}
        showsVerticalScrollIndicator={false}
      />
    </View>
  );

  const renderFAQ = () => (
    <View style={styles.categoryContent}>
      <Text style={styles.sectionTitle}>Perguntas Frequentes</Text>
      
      <FlatList
        data={helpData.faq.filter(f => f.category === selectedCategory)}
        keyExtractor={(item) => item.id.toString()}
        renderItem={({ item }) => (
          <TouchableOpacity
            style={styles.faqItem}
            onPress={() => setExpandedItem(expandedItem === item.id ? null : item.id)}
          >
            <View style={styles.faqHeader}>
              <Text style={styles.faqQuestion}>{item.question}</Text>
              <Icon 
                name={expandedItem === item.id ? "expand-less" : "expand-more"} 
                type="material" 
                color="#7f8c8d" 
                size={20} 
              />
            </View>
            
            {expandedItem === item.id && (
              <Text style={styles.faqAnswer}>{item.answer}</Text>
            )}
          </TouchableOpacity>
        )}
        showsVerticalScrollIndicator={false}
      />
    </View>
  );

  const renderEmergencyContacts = () => (
    <View style={styles.categoryContent}>
      <Text style={styles.sectionTitle}>Contatos de Emergência</Text>
      
      <FlatList
        data={helpData.emergencyContacts}
        keyExtractor={(item) => item.id.toString()}
        renderItem={({ item }) => (
          <TouchableOpacity
            style={styles.contactCard}
            onPress={() => handleEmergencyCall(item)}
          >
            <View style={styles.contactInfo}>
              <Icon name="phone" type="material" color="#e74c3c" size={24} />
              <View style={styles.contactDetails}>
                <Text style={styles.contactName}>{item.name}</Text>
                <Text style={styles.contactPhone}>{item.phone}</Text>
                <Text style={styles.contactDescription}>{item.description}</Text>
              </View>
            </View>
            
            <Icon name="call" type="material" color="#2E8B57" size={20} />
          </TouchableOpacity>
        )}
        showsVerticalScrollIndicator={false}
      />
    </View>
  );

  const renderCategoryContent = () => {
    switch (selectedCategory) {
      case 'getting-started':
        return renderGettingStarted();
      case 'trips':
      case 'payments':
      case 'account':
      case 'safety':
      case 'troubleshooting':
        return (
          <View style={styles.categoryContent}>
            {renderTutorials()}
            {renderGuides()}
            {renderFAQ()}
          </View>
        );
      default:
        return null;
    }
  };

  const renderCategories = () => (
    <View style={styles.categoriesContainer}>
      <FlatList
        data={categories}
        horizontal
        showsHorizontalScrollIndicator={false}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <TouchableOpacity
            style={[
              styles.categoryTab,
              selectedCategory === item.id && styles.activeCategoryTab
            ]}
            onPress={() => setSelectedCategory(item.id)}
          >
            <Icon 
              name={item.icon} 
              type="material" 
              color={selectedCategory === item.id ? '#2E8B57' : '#7f8c8d'} 
              size={20} 
            />
            <Text style={[
              styles.categoryText,
              selectedCategory === item.id && styles.activeCategoryText
            ]}>
              {item.label}
            </Text>
          </TouchableOpacity>
        )}
        contentContainerStyle={styles.categoriesList}
      />
    </View>
  );

  if (isLoading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#2E8B57" />
        <Text style={styles.loadingText}>Carregando ajuda...</Text>
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
        
        <Text style={styles.headerTitle}>Ajuda</Text>
        
        <TouchableOpacity
          style={styles.supportButton}
          onPress={() => navigation.navigate('SupportScreen')}
        >
          <Icon name="support-agent" type="material" color="#2c3e50" size={24} />
        </TouchableOpacity>
      </View>
      
      {renderCategories()}
      
      <ScrollView
        style={styles.content}
        showsVerticalScrollIndicator={false}
      >
        {renderCategoryContent()}
        
        <View style={styles.emergencySection}>
          {renderEmergencyContacts()}
        </View>
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
  supportButton: {
    padding: 8,
  },
  categoriesContainer: {
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#e0e0e0',
  },
  categoriesList: {
    paddingHorizontal: 16,
  },
  categoryTab: {
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    marginRight: 8,
    borderRadius: 8,
    backgroundColor: '#f8f9fa',
  },
  activeCategoryTab: {
    backgroundColor: '#e8f5e8',
  },
  categoryText: {
    fontSize: 12,
    color: '#7f8c8d',
    marginTop: 4,
  },
  activeCategoryText: {
    color: '#2E8B57',
    fontWeight: 'bold',
  },
  content: {
    flex: 1,
  },
  categoryContent: {
    padding: 20,
  },
  section: {
    marginBottom: 24,
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
    lineHeight: 20,
  },
  stepsContainer: {
    marginBottom: 24,
  },
  stepItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 16,
  },
  stepNumber: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#2E8B57',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 16,
  },
  stepNumberText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
  },
  stepContent: {
    flex: 1,
  },
  stepTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#2c3e50',
    marginBottom: 4,
  },
  stepDescription: {
    fontSize: 14,
    color: '#7f8c8d',
    lineHeight: 20,
  },
  tutorialCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
  },
  tutorialHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  tutorialTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#2c3e50',
    marginLeft: 8,
  },
  tutorialDescription: {
    fontSize: 14,
    color: '#7f8c8d',
    lineHeight: 20,
    marginBottom: 8,
  },
  tutorialMeta: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  tutorialDuration: {
    fontSize: 12,
    color: '#2E8B57',
  },
  tutorialLevel: {
    fontSize: 12,
    color: '#7f8c8d',
  },
  guideCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
  },
  guideHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  guideTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#2c3e50',
    marginLeft: 8,
  },
  guideDescription: {
    fontSize: 14,
    color: '#7f8c8d',
    lineHeight: 20,
    marginBottom: 8,
  },
  guideMeta: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  guideReadTime: {
    fontSize: 12,
    color: '#7f8c8d',
  },
  faqItem: {
    backgroundColor: '#fff',
    borderRadius: 8,
    marginBottom: 8,
    elevation: 1,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
  },
  faqHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
  },
  faqQuestion: {
    fontSize: 14,
    color: '#2c3e50',
    flex: 1,
    marginRight: 8,
  },
  faqAnswer: {
    fontSize: 14,
    color: '#7f8c8d',
    lineHeight: 20,
    paddingHorizontal: 16,
    paddingBottom: 16,
  },
  emergencySection: {
    marginTop: 20,
  },
  contactCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  contactInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  contactDetails: {
    marginLeft: 12,
    flex: 1,
  },
  contactName: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#2c3e50',
    marginBottom: 2,
  },
  contactPhone: {
    fontSize: 14,
    color: '#e74c3c',
    marginBottom: 2,
  },
  contactDescription: {
    fontSize: 12,
    color: '#7f8c8d',
  },
});

export default HelpScreen; 