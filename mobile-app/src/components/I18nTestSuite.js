/**
 * i18n Test Suite - Suite de testes para o sistema i18n
 * 
 * Testes completos para validar o funcionamento do sistema
 * de internacionalização JSON dinâmico.
 */

import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Alert } from 'react-native';
import { useTranslation } from '../components/i18n/LanguageProvider';
import { TranslationKeys } from '../i18n';

const I18nTestSuite = () => {
  const { t, formatCurrency, formatTime, currentLang, changeLanguage } = useTranslation();

  // Teste 1: Traduções básicas
  const testBasicTranslations = () => {
    const tests = [
      { key: 'welcome', expected: 'Welcome ta Leaf' },
      { key: 'app.name', expected: 'Leaf' },
      { key: 'auth.login', expected: 'Login' }
    ];

    const results = tests.map(test => ({
      key: test.key,
      result: t(test.key),
      expected: test.expected,
      passed: t(test.key) === test.expected
    }));

    Alert.alert(
      'Teste: Traduções Básicas',
      results.map(r => `${r.passed ? '✅' : '❌'} ${r.key}: ${r.result}`).join('\n')
    );
  };

  // Teste 2: Traduções com parâmetros
  const testParameterTranslations = () => {
    const testParams = { status: 'confirmed', driverName: 'João', eta: '5 min' };
    
    const results = [
      {
        key: 'ride.status',
        params: { status: testParams.status },
        result: t('ride.status', { status: testParams.status })
      },
      {
        key: 'driver.arriving',
        params: { driverName: testParams.driverName, eta: testParams.eta },
        result: t('driver.arriving', { driverName: testParams.driverName, eta: testParams.eta })
      }
    ];

    Alert.alert(
      'Teste: Traduções com Parâmetros',
      results.map(r => `✅ ${r.key}: ${r.result}`).join('\n')
    );
  };

  // Teste 3: Formatação de moeda
  const testCurrencyFormatting = () => {
    const amounts = [25.50, 100.00, 0.99];
    const results = amounts.map(amount => ({
      amount,
      formatted: formatCurrency(amount)
    }));

    Alert.alert(
      'Teste: Formatação de Moeda',
      results.map(r => `$${r.amount} → ${r.formatted}`).join('\n')
    );
  };

  // Teste 4: Formatação de tempo
  const testTimeFormatting = () => {
    const timeTests = [
      { count: 5, unit: 'minutes' },
      { count: 2, unit: 'hours' },
      { count: 1, unit: 'days' }
    ];

    const results = timeTests.map(test => ({
      ...test,
      formatted: formatTime(test.count, test.unit)
    }));

    Alert.alert(
      'Teste: Formatação de Tempo',
      results.map(r => `${r.count} ${r.unit} → ${r.formatted}`).join('\n')
    );
  };

  // Teste 5: Mudança de idioma
  const testLanguageChange = () => {
    const languages = ['en', 'pt', 'es'];
    const currentIndex = languages.indexOf(currentLang);
    const nextIndex = (currentIndex + 1) % languages.length;
    const nextLang = languages[nextIndex];

    changeLanguage(nextLang);
    
    Alert.alert(
      'Teste: Mudança de Idioma',
      `Idioma alterado de ${currentLang.toUpperCase()} para ${nextLang.toUpperCase()}\n\nTeste: ${t('welcome')}`
    );
  };

  // Teste 6: Fallback para chaves não encontradas
  const testFallback = () => {
    const nonExistentKey = 'nonexistent.key.test';
    const result = t(nonExistentKey);
    
    Alert.alert(
      'Teste: Fallback',
      `Chave não encontrada: ${nonExistentKey}\nResultado: ${result}\n\nEsperado: Chave formatada ou fallback`
    );
  };

  // Teste 7: Chaves aninhadas
  const testNestedKeys = () => {
    const nestedTests = [
      'ride.status',
      'driver.eta',
      'payment.method',
      'navigation.home',
      'errors.networkError'
    ];

    const results = nestedTests.map(key => ({
      key,
      result: t(key)
    }));

    Alert.alert(
      'Teste: Chaves Aninhadas',
      results.map(r => `✅ ${r.key}: ${r.result}`).join('\n')
    );
  };

  // Teste 8: Constantes de tradução
  const testTranslationKeys = () => {
    const keyTests = [
      TranslationKeys.APP_NAME,
      TranslationKeys.AUTH_LOGIN,
      TranslationKeys.RIDE_REQUEST,
      TranslationKeys.DRIVER_FIND,
      TranslationKeys.PAYMENT_TOTAL
    ];

    const results = keyTests.map(key => ({
      key,
      result: t(key)
    }));

    Alert.alert(
      'Teste: Constantes de Tradução',
      results.map(r => `✅ ${r.key}: ${r.result}`).join('\n')
    );
  };

  // Teste completo
  const runAllTests = () => {
    const tests = [
      () => testBasicTranslations(),
      () => testParameterTranslations(),
      () => testCurrencyFormatting(),
      () => testTimeFormatting(),
      () => testNestedKeys(),
      () => testTranslationKeys(),
      () => testFallback()
    ];

    let index = 0;
    const runNextTest = () => {
      if (index < tests.length) {
        tests[index]();
        index++;
        setTimeout(runNextTest, 2000); // Aguardar 2 segundos entre testes
      } else {
        Alert.alert('Testes Concluídos', 'Todos os testes foram executados!');
      }
    };

    runNextTest();
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>🧪 i18n Test Suite</Text>
        <Text style={styles.subtitle}>Sistema de Internacionalização</Text>
        <Text style={styles.currentLang}>Idioma Atual: {currentLang.toUpperCase()}</Text>
      </View>

      <View style={styles.testSection}>
        <Text style={styles.sectionTitle}>Testes Individuais</Text>
        
        <TouchableOpacity style={styles.testButton} onPress={testBasicTranslations}>
          <Text style={styles.testButtonText}>1. Traduções Básicas</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.testButton} onPress={testParameterTranslations}>
          <Text style={styles.testButtonText}>2. Traduções com Parâmetros</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.testButton} onPress={testCurrencyFormatting}>
          <Text style={styles.testButtonText}>3. Formatação de Moeda</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.testButton} onPress={testTimeFormatting}>
          <Text style={styles.testButtonText}>4. Formatação de Tempo</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.testButton} onPress={testNestedKeys}>
          <Text style={styles.testButtonText}>5. Chaves Aninhadas</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.testButton} onPress={testTranslationKeys}>
          <Text style={styles.testButtonText}>6. Constantes de Tradução</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.testButton} onPress={testFallback}>
          <Text style={styles.testButtonText}>7. Teste de Fallback</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.testButton} onPress={testLanguageChange}>
          <Text style={styles.testButtonText}>8. Mudança de Idioma</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.testSection}>
        <Text style={styles.sectionTitle}>Teste Completo</Text>
        <TouchableOpacity style={styles.runAllButton} onPress={runAllTests}>
          <Text style={styles.runAllButtonText}>🚀 Executar Todos os Testes</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.testSection}>
        <Text style={styles.sectionTitle}>Exemplo de Uso</Text>
        <View style={styles.exampleContainer}>
          <Text style={styles.exampleText}>
            <Text style={styles.exampleLabel}>t('welcome'):</Text> {t('welcome')}
          </Text>
          <Text style={styles.exampleText}>
            <Text style={styles.exampleLabel}>t('ride.status', {{'{status: "confirmed"}'}}):</Text> {t('ride.status', { status: 'confirmed' })}
          </Text>
          <Text style={styles.exampleText}>
            <Text style={styles.exampleLabel}>formatCurrency(25.50):</Text> {formatCurrency(25.50)}
          </Text>
          <Text style={styles.exampleText}>
            <Text style={styles.exampleLabel}>formatTime(5, 'minutes'):</Text> {formatTime(5, 'minutes')}
          </Text>
        </View>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  header: {
    backgroundColor: '#28a745',
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
  testSection: {
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
  testButton: {
    backgroundColor: '#007bff',
    padding: 12,
    borderRadius: 8,
    marginBottom: 10,
  },
  testButtonText: {
    color: 'white',
    textAlign: 'center',
    fontWeight: '500',
  },
  runAllButton: {
    backgroundColor: '#28a745',
    padding: 15,
    borderRadius: 8,
  },
  runAllButtonText: {
    color: 'white',
    textAlign: 'center',
    fontWeight: 'bold',
    fontSize: 16,
  },
  exampleContainer: {
    gap: 8,
  },
  exampleText: {
    fontSize: 14,
    color: '#666',
    fontFamily: 'monospace',
  },
  exampleLabel: {
    fontWeight: 'bold',
    color: '#007bff',
  },
});

export default I18nTestSuite;
