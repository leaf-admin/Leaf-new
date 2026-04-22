/**
 * LanguageDemo - Componente de demonstração do sistema i18n
 * 
 * Exemplo prático de como usar o sistema de tradução
 * em componentes React Native.
 */

import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Alert
} from 'react-native';
import { useTranslation, LanguageSelector, LanguageDebug } from '../components/i18n/LanguageProvider';

const LanguageDemo = () => {
  const { t, formatCurrency, formatTime, currentLang } = useTranslation();

  const handleTestTranslation = () => {
    Alert.alert(
      t('messages.success'),
      t('ride.status', { status: t('status.confirmed') }),
      [{ text: t('messages.confirm') }]
    );
  };

  const handleTestCurrency = () => {
    const price = 25.50;
    Alert.alert(
      t('payment.total'),
      formatCurrency(price),
      [{ text: t('messages.confirm') }]
    );
  };

  const handleTestTime = () => {
    const minutes = 5;
    Alert.alert(
      t('driver.eta'),
      formatTime(minutes, 'minutes'),
      [{ text: t('messages.confirm') }]
    );
  };

  return (
    <ScrollView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>{t('welcome')}</Text>
        <Text style={styles.subtitle}>{t('app.tagline')}</Text>
        <Text style={styles.currentLang}>
          {t('app.version')}: {currentLang.toUpperCase()}
        </Text>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>{t('navigation.settings')}</Text>
        <View style={styles.languageContainer}>
          <Text style={styles.label}>Idioma / Language:</Text>
          <LanguageSelector style={styles.selector} />
        </View>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>{t('ride.request')}</Text>
        <View style={styles.buttonContainer}>
          <TouchableOpacity style={styles.button} onPress={handleTestTranslation}>
            <Text style={styles.buttonText}>{t('ride.status')}</Text>
          </TouchableOpacity>
          
          <TouchableOpacity style={styles.button} onPress={handleTestCurrency}>
            <Text style={styles.buttonText}>{t('payment.total')}</Text>
          </TouchableOpacity>
          
          <TouchableOpacity style={styles.button} onPress={handleTestTime}>
            <Text style={styles.buttonText}>{t('driver.eta')}</Text>
          </TouchableOpacity>
        </View>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Exemplos de Tradução</Text>
        
        <View style={styles.exampleContainer}>
          <Text style={styles.exampleLabel}>Auth:</Text>
          <Text style={styles.exampleText}>{t('auth.login')}</Text>
          <Text style={styles.exampleText}>{t('auth.register')}</Text>
          <Text style={styles.exampleText}>{t('auth.forgotPassword')}</Text>
        </View>

        <View style={styles.exampleContainer}>
          <Text style={styles.exampleLabel}>Ride:</Text>
          <Text style={styles.exampleText}>{t('ride.request')}</Text>
          <Text style={styles.exampleText}>{t('ride.cancel')}</Text>
          <Text style={styles.exampleText}>{t('ride.schedule')}</Text>
        </View>

        <View style={styles.exampleContainer}>
          <Text style={styles.exampleLabel}>Driver:</Text>
          <Text style={styles.exampleText}>{t('driver.find')}</Text>
          <Text style={styles.exampleText}>{t('driver.contact')}</Text>
          <Text style={styles.exampleText}>{t('driver.rating')}</Text>
        </View>

        <View style={styles.exampleContainer}>
          <Text style={styles.exampleLabel}>Payment:</Text>
          <Text style={styles.exampleText}>{t('payment.method')}</Text>
          <Text style={styles.exampleText}>{t('payment.cash')}</Text>
          <Text style={styles.exampleText}>{t('payment.card')}</Text>
        </View>

        <View style={styles.exampleContainer}>
          <Text style={styles.exampleLabel}>Navigation:</Text>
          <Text style={styles.exampleText}>{t('navigation.home')}</Text>
          <Text style={styles.exampleText}>{t('navigation.profile')}</Text>
          <Text style={styles.exampleText}>{t('navigation.history')}</Text>
        </View>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Status Messages</Text>
        <View style={styles.statusContainer}>
          <Text style={[styles.statusText, styles.statusSearching]}>
            {t('status.searching')}
          </Text>
          <Text style={[styles.statusText, styles.statusFound]}>
            {t('status.found')}
          </Text>
          <Text style={[styles.statusText, styles.statusArriving]}>
            {t('status.arriving')}
          </Text>
          <Text style={[styles.statusText, styles.statusCompleted]}>
            {t('status.completed')}
          </Text>
        </View>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Error Messages</Text>
        <View style={styles.errorContainer}>
          <Text style={styles.errorText}>{t('errors.networkError')}</Text>
          <Text style={styles.errorText}>{t('errors.locationError')}</Text>
          <Text style={styles.errorText}>{t('errors.driverNotFound')}</Text>
        </View>
      </View>

      {/* Debug component (only in development) */}
      <LanguageDebug />
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  header: {
    backgroundColor: '#007bff',
    padding: 20,
    alignItems: 'center',
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    color: 'white',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 16,
    color: 'white',
    opacity: 0.9,
    marginBottom: 4,
  },
  currentLang: {
    fontSize: 12,
    color: 'white',
    opacity: 0.7,
  },
  section: {
    backgroundColor: 'white',
    margin: 10,
    padding: 15,
    borderRadius: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#333',
    marginBottom: 15,
  },
  languageContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  label: {
    fontSize: 16,
    color: '#666',
  },
  selector: {
    minWidth: 120,
  },
  buttonContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  button: {
    backgroundColor: '#007bff',
    paddingHorizontal: 15,
    paddingVertical: 10,
    borderRadius: 8,
    flex: 1,
    minWidth: 100,
  },
  buttonText: {
    color: 'white',
    textAlign: 'center',
    fontWeight: '500',
  },
  exampleContainer: {
    marginBottom: 15,
  },
  exampleLabel: {
    fontSize: 14,
    fontWeight: 'bold',
    color: '#007bff',
    marginBottom: 5,
  },
  exampleText: {
    fontSize: 14,
    color: '#666',
    marginBottom: 2,
  },
  statusContainer: {
    gap: 8,
  },
  statusText: {
    padding: 10,
    borderRadius: 8,
    textAlign: 'center',
    fontWeight: '500',
  },
  statusSearching: {
    backgroundColor: '#fff3cd',
    color: '#856404',
  },
  statusFound: {
    backgroundColor: '#d4edda',
    color: '#155724',
  },
  statusArriving: {
    backgroundColor: '#cce5ff',
    color: '#004085',
  },
  statusCompleted: {
    backgroundColor: '#d1ecf1',
    color: '#0c5460',
  },
  errorContainer: {
    gap: 8,
  },
  errorText: {
    backgroundColor: '#f8d7da',
    color: '#721c24',
    padding: 10,
    borderRadius: 8,
    textAlign: 'center',
  },
});

export default LanguageDemo;
