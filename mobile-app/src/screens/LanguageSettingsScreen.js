import Logger from '../utils/Logger';
/**
 * LanguageSettingsScreen - Tela de configuração de idioma
 * 
 * Interface completa para configuração de idioma
 * com preview das traduções e configurações avançadas.
 */

import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Alert,
  Switch,
  Dimensions
} from 'react-native';
import { useTranslation, useLanguage } from '../components/i18n/LanguageProvider';
import { Ionicons } from '@expo/vector-icons';


const { width } = Dimensions.get('window');

const LanguageSettingsScreen = ({ navigation }) => {
  const { t, formatCurrency, formatTime } = useTranslation();
  const { currentLang, changeLanguage, supportedLanguages } = useLanguage();
  
  const [autoDetect, setAutoDetect] = useState(true);
  const [showPreview, setShowPreview] = useState(true);
  const [selectedLanguage, setSelectedLanguage] = useState(currentLang);

  useEffect(() => {
    // Carregar configurações salvas
    loadSettings();
  }, []);

  const loadSettings = async () => {
    try {
      // Aqui você pode carregar configurações do AsyncStorage
      // const settings = await AsyncStorage.getItem('language_settings');
      // if (settings) {
      //   const parsed = JSON.parse(settings);
      //   setAutoDetect(parsed.autoDetect || true);
      //   setShowPreview(parsed.showPreview !== false);
      // }
    } catch (error) {
      Logger.error('Erro ao carregar configurações:', error);
    }
  };

  const saveSettings = async () => {
    try {
      const settings = {
        autoDetect,
        showPreview,
        selectedLanguage
      };
      // await AsyncStorage.setItem('language_settings', JSON.stringify(settings));
      Logger.log('Configurações salvas:', settings);
    } catch (error) {
      Logger.error('Erro ao salvar configurações:', error);
    }
  };

  const handleLanguageChange = (langCode) => {
    setSelectedLanguage(langCode);
    changeLanguage(langCode);
    saveSettings();
  };

  const handleAutoDetectToggle = (value) => {
    setAutoDetect(value);
    saveSettings();
  };

  const handlePreviewToggle = (value) => {
    setShowPreview(value);
    saveSettings();
  };

  const showLanguagePreview = (langCode) => {
    const previewTexts = {
      en: "Welcome ta Leaf - Your ride, your way",
      pt: "Bem-vindo à Leaf - Sua corrida, seu jeito",
      es: "Bienvenido a Leaf - Tu viaje, tu manera",
      fr: "Bienvenue sur Leaf - Votre trajet, votre façon",
      de: "Willkommen bei Leaf - Ihre Fahrt, Ihr Weg"
    };

    Alert.alert(
      `${supportedLanguages.find(l => l.code === langCode)?.nativeName}`,
      previewTexts[langCode] || "Preview not available",
      [{ text: t('messages.confirm') }]
    );
  };

  const resetToDefault = () => {
    Alert.alert(
      t('messages.confirm'),
      'Reset language settings to default?',
      [
        { text: t('messages.cancel'), style: 'cancel' },
        {
          text: t('messages.confirm'),
          onPress: () => {
            setAutoDetect(true);
            setShowPreview(true);
            setSelectedLanguage('en');
            changeLanguage('en');
            saveSettings();
          }
        }
      ]
    );
  };

  const LanguageCard = ({ language }) => {
    const isSelected = language.code === selectedLanguage;
    
    return (
      <TouchableOpacity
        style={[
          styles.languageCard,
          isSelected && styles.selectedCard
        ]}
        onPress={() => handleLanguageChange(language.code)}
        onLongPress={() => showLanguagePreview(language.code)}
      >
        <View style={styles.languageInfo}>
          <Text style={[
            styles.languageName,
            isSelected && styles.selectedText
          ]}>
            {language.nativeName}
          </Text>
          <Text style={[
            styles.languageEnglish,
            isSelected && styles.selectedSubText
          ]}>
            {language.name}
          </Text>
        </View>
        
        {isSelected && (
          <Ionicons 
            name="checkmark-circle" 
            size={24} 
            color="#007bff" 
          />
        )}
        
        <TouchableOpacity
          style={styles.previewButton}
          onPress={() => showLanguagePreview(language.code)}
        >
          <Ionicons name="eye-outline" size={16} color="#666" />
        </TouchableOpacity>
      </TouchableOpacity>
    );
  };

  const PreviewCard = () => {
    if (!showPreview) return null;

    return (
      <View style={styles.previewCard}>
        <Text style={styles.previewTitle}>{t('messages.preview')}</Text>
        
        <View style={styles.previewContent}>
          <Text style={styles.previewText}>{t('welcome')}</Text>
          <Text style={styles.previewText}>{t('app.tagline')}</Text>
          <Text style={styles.previewText}>{t('ride.request')}</Text>
          <Text style={styles.previewText}>{formatCurrency(25.50)}</Text>
          <Text style={styles.previewText}>{formatTime(5, 'minutes')}</Text>
        </View>
      </View>
    );
  };

  return (
    <ScrollView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => navigation.goBack()}
        >
          <Ionicons name="arrow-back" size={24} color="#333" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{t('navigation.settings')}</Text>
        <View style={styles.placeholder} />
      </View>

      <View style={styles.content}>
        {/* Configurações */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{t('messages.settings')}</Text>
          
          <View style={styles.settingRow}>
            <View style={styles.settingInfo}>
              <Text style={styles.settingTitle}>Auto-detect Language</Text>
              <Text style={styles.settingDescription}>
                Automatically detect user's language preference
              </Text>
            </View>
            <Switch
              value={autoDetect}
              onValueChange={handleAutoDetectToggle}
              trackColor={{ false: '#767577', true: '#007bff' }}
              thumbColor={autoDetect ? '#fff' : '#f4f3f4'}
            />
          </View>

          <View style={styles.settingRow}>
            <View style={styles.settingInfo}>
              <Text style={styles.settingTitle}>Show Preview</Text>
              <Text style={styles.settingDescription}>
                Show translation preview in language cards
              </Text>
            </View>
            <Switch
              value={showPreview}
              onValueChange={handlePreviewToggle}
              trackColor={{ false: '#767577', true: '#007bff' }}
              thumbColor={showPreview ? '#fff' : '#f4f3f4'}
            />
          </View>
        </View>

        {/* Preview */}
        <PreviewCard />

        {/* Idiomas Disponíveis */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Available Languages</Text>
          <Text style={styles.sectionDescription}>
            Select your preferred language. Long press for preview.
          </Text>
          
          {supportedLanguages.map((language) => (
            <LanguageCard key={language.code} language={language} />
          ))}
        </View>

        {/* Informações */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Language Information</Text>
          
          <View style={styles.infoCard}>
            <View style={styles.infoRow}>
              <Text style={styles.infoLabel}>Current Language:</Text>
              <Text style={styles.infoValue}>
                {supportedLanguages.find(l => l.code === currentLang)?.nativeName}
              </Text>
            </View>
            
            <View style={styles.infoRow}>
              <Text style={styles.infoLabel}>Supported Languages:</Text>
              <Text style={styles.infoValue}>{supportedLanguages.length}</Text>
            </View>
            
            <View style={styles.infoRow}>
              <Text style={styles.infoLabel}>Auto-detect:</Text>
              <Text style={styles.infoValue}>{autoDetect ? 'Enabled' : 'Disabled'}</Text>
            </View>
          </View>
        </View>

        {/* Ações */}
        <View style={styles.section}>
          <TouchableOpacity style={styles.resetButton} onPress={resetToDefault}>
            <Ionicons name="refresh" size={20} color="#fff" />
            <Text style={styles.resetButtonText}>Reset to Default</Text>
          </TouchableOpacity>
        </View>
      </View>
    </ScrollView>
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
    padding: 8,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#333',
  },
  placeholder: {
    width: 40,
  },
  content: {
    padding: 20,
  },
  section: {
    marginBottom: 30,
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#333',
    marginBottom: 8,
  },
  sectionDescription: {
    fontSize: 14,
    color: '#666',
    marginBottom: 15,
  },
  settingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#fff',
    padding: 15,
    borderRadius: 10,
    marginBottom: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  settingInfo: {
    flex: 1,
    marginRight: 15,
  },
  settingTitle: {
    fontSize: 16,
    fontWeight: '500',
    color: '#333',
    marginBottom: 4,
  },
  settingDescription: {
    fontSize: 12,
    color: '#666',
  },
  languageCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    padding: 15,
    borderRadius: 10,
    marginBottom: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  selectedCard: {
    borderWidth: 2,
    borderColor: '#007bff',
    backgroundColor: '#f0f8ff',
  },
  languageInfo: {
    flex: 1,
  },
  languageName: {
    fontSize: 16,
    fontWeight: '500',
    color: '#333',
    marginBottom: 2,
  },
  languageEnglish: {
    fontSize: 12,
    color: '#666',
  },
  selectedText: {
    color: '#007bff',
    fontWeight: '600',
  },
  selectedSubText: {
    color: '#0056b3',
  },
  previewButton: {
    padding: 8,
    marginLeft: 10,
  },
  previewCard: {
    backgroundColor: '#fff',
    padding: 15,
    borderRadius: 10,
    marginBottom: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  previewTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#333',
    marginBottom: 10,
  },
  previewContent: {
    gap: 8,
  },
  previewText: {
    fontSize: 14,
    color: '#666',
    paddingVertical: 4,
  },
  infoCard: {
    backgroundColor: '#fff',
    padding: 15,
    borderRadius: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
  infoLabel: {
    fontSize: 14,
    color: '#666',
  },
  infoValue: {
    fontSize: 14,
    fontWeight: '500',
    color: '#333',
  },
  resetButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#dc3545',
    padding: 15,
    borderRadius: 10,
    gap: 8,
  },
  resetButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '500',
  },
});

export default LanguageSettingsScreen;
