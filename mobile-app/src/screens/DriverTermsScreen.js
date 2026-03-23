import Logger from '../utils/Logger';
import React, { useState } from 'react';
import { 
  View, 
  Text, 
  StyleSheet, 
  TouchableOpacity, 
  Alert, 
  ScrollView
} from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { fonts } from '../common-local/font';
import onboardingTheme from '../components/auth/common/onboardingTheme';

const { color, radius, spacing, elevation } = onboardingTheme;

export default function DriverTermsScreen() {
  const navigation = useNavigation();
  const route = useRoute();
  
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [privacyAccepted, setPrivacyAccepted] = useState(false);
  const [serviceAccepted, setServiceAccepted] = useState(false);
  
  const userData = route?.params?.userData || {};

  const handleAcceptAll = () => {
    setTermsAccepted(true);
    setPrivacyAccepted(true);
    setServiceAccepted(true);
  };

  const handleContinue = async () => {
    if (!termsAccepted || !privacyAccepted || !serviceAccepted) {
      Alert.alert(
        "Termos Obrigatórios",
        "Você precisa aceitar todos os termos para continuar como motorista parceiro."
      );
      return;
    }

    try {
      Logger.log("DriverTermsScreen - Termos aceitos, salvando dados");
      
      // Salvar aceitação dos termos
      const updatedUserData = {
        ...userData,
        termsAccepted: true,
        privacyAccepted: true,
        serviceAccepted: true,
        termsAcceptedAt: new Date().toISOString()
      };
      
      await AsyncStorage.setItem('@temp_user_data', JSON.stringify(updatedUserData));
      
      Logger.log("DriverTermsScreen - Navegando para upload da CNH");
      navigation.navigate('CNHUpload', { userData: updatedUserData });
      
    } catch (error) {
      Logger.error("DriverTermsScreen - Erro ao salvar termos:", error);
      Alert.alert("Erro", "Não foi possível salvar os termos. Tente novamente.");
    }
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Termos de Serviço</Text>
        <Text style={styles.subtitle}>Motorista Parceiro</Text>
      </View>

      <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.termsContainer}>
          <Text style={styles.sectionTitle}>Bem-vindo ao programa de motoristas parceiros!</Text>
          
          <Text style={styles.termsText}>
            Para se tornar um motorista parceiro da Leaf, você precisa aceitar os seguintes termos e condições:
          </Text>

          {/* Termos de Uso */}
          <View style={styles.termItem}>
            <TouchableOpacity 
              style={[styles.checkbox, termsAccepted && styles.checkboxChecked]}
              onPress={() => setTermsAccepted(!termsAccepted)}
            >
              {termsAccepted && <Text style={styles.checkmark}>✓</Text>}
            </TouchableOpacity>
            <View style={styles.termContent}>
              <Text style={styles.termTitle}>Termos de Uso</Text>
              <Text style={styles.termDescription}>
                Li e aceito os Termos de Uso da plataforma Leaf, que regem o uso do aplicativo e os serviços prestados.
              </Text>
            </View>
          </View>

          {/* Política de Privacidade */}
          <View style={styles.termItem}>
            <TouchableOpacity 
              style={[styles.checkbox, privacyAccepted && styles.checkboxChecked]}
              onPress={() => setPrivacyAccepted(!privacyAccepted)}
            >
              {privacyAccepted && <Text style={styles.checkmark}>✓</Text>}
            </TouchableOpacity>
            <View style={styles.termContent}>
              <Text style={styles.termTitle}>Política de Privacidade</Text>
              <Text style={styles.termDescription}>
                Li e aceito a Política de Privacidade, que explica como coletamos, usamos e protegemos suas informações pessoais.
              </Text>
            </View>
          </View>

          {/* Termos de Serviço do Motorista */}
          <View style={styles.termItem}>
            <TouchableOpacity 
              style={[styles.checkbox, serviceAccepted && styles.checkboxChecked]}
              onPress={() => setServiceAccepted(!serviceAccepted)}
            >
              {serviceAccepted && <Text style={styles.checkmark}>✓</Text>}
            </TouchableOpacity>
            <View style={styles.termContent}>
              <Text style={styles.termTitle}>Termos de Serviço do Motorista</Text>
              <Text style={styles.termDescription}>
                Li e aceito os Termos de Serviço específicos para motoristas parceiros, incluindo responsabilidades, comissões e regras de conduta.
              </Text>
            </View>
          </View>

          <View style={styles.importantNote}>
            <Text style={styles.importantTitle}>⚠️ Informações Importantes:</Text>
            <Text style={styles.importantText}>
              • Você será responsável por manter seu veículo em boas condições{'\n'}
              • Deve seguir todas as leis de trânsito e regulamentações locais{'\n'}
              • A comissão será de acordo com a política vigente da plataforma{'\n'}
              • Pode cancelar sua participação a qualquer momento{'\n'}
              • A Leaf pode suspender ou encerrar sua conta por violação dos termos
            </Text>
          </View>

          <View style={styles.buttonsContainer}>
            <TouchableOpacity 
              style={styles.acceptAllButton}
              onPress={handleAcceptAll}
            >
              <Text style={styles.acceptAllButtonText}>Aceitar Todos</Text>
            </TouchableOpacity>

            <TouchableOpacity 
              style={[
                styles.continueButton, 
                (!termsAccepted || !privacyAccepted || !serviceAccepted) && styles.continueButtonDisabled
              ]}
              onPress={handleContinue}
              disabled={!termsAccepted || !privacyAccepted || !serviceAccepted}
            >
              <Text style={styles.continueButtonText}>Continuar</Text>
            </TouchableOpacity>
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: color.background
  },
  
  header: {
    paddingTop: 58,
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing.lg,
    backgroundColor: color.panel,
    borderBottomWidth: 1,
    borderBottomColor: color.borderStrong
  },
  
  title: {
    fontSize: 26,
    fontFamily: fonts.Bold,
    color: color.textPrimary,
    textAlign: 'center',
    marginBottom: 8
  },
  
  subtitle: {
    fontSize: 15,
    color: color.textSecondary,
    fontFamily: fonts.Medium,
    textAlign: 'center',
    opacity: 0.92
  },
  
  content: {
    flex: 1
  },
  
  termsContainer: {
    margin: spacing.xl,
    marginTop: spacing.lg,
    padding: spacing.lg,
    backgroundColor: color.panel,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: color.borderStrong,
    shadowColor: '#0E1522',
    ...elevation.soft
  },
  
  sectionTitle: {
    fontSize: 20,
    fontFamily: fonts.Bold,
    color: color.textPrimary,
    textAlign: 'center',
    marginBottom: spacing.sm
  },
  
  termsText: {
    fontSize: 15,
    color: color.textSecondary,
    lineHeight: 22,
    marginBottom: spacing.md,
    textAlign: 'center'
  },
  
  termItem: {
    flexDirection: 'row',
    marginBottom: spacing.md,
    alignItems: 'flex-start',
    paddingBottom: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: color.border
  },
  
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: color.borderStrong,
    marginRight: 15,
    marginTop: 2,
    justifyContent: 'center',
    alignItems: 'center'
  },
  
  checkboxChecked: {
    backgroundColor: color.accent,
    borderColor: color.accent
  },
  
  checkmark: {
    color: color.accentText,
    fontSize: 14,
    fontWeight: 'bold'
  },
  
  termContent: {
    flex: 1
  },
  
  termTitle: {
    fontSize: 16,
    fontFamily: fonts.SemiBold,
    color: color.textPrimary,
    marginBottom: 6
  },
  
  termDescription: {
    fontSize: 14,
    color: color.textSecondary,
    lineHeight: 20
  },
  
  importantNote: {
    backgroundColor: color.surface,
    borderWidth: 1,
    borderColor: color.borderStrong,
    borderRadius: radius.md,
    padding: spacing.md,
    marginTop: spacing.md,
    marginBottom: spacing.lg
  },
  
  importantTitle: {
    fontSize: 16,
    fontFamily: fonts.SemiBold,
    color: color.textPrimary,
    marginBottom: 8
  },
  
  importantText: {
    fontSize: 14,
    color: color.textSecondary,
    lineHeight: 20
  },
  
  buttonsContainer: {
    gap: 12
  },
  
  acceptAllButton: {
    backgroundColor: color.surfaceMuted,
    borderWidth: 1,
    borderColor: color.border,
    paddingVertical: 15,
    borderRadius: radius.md,
    alignItems: 'center'
  },
  
  acceptAllButtonText: {
    fontSize: 16,
    fontFamily: fonts.SemiBold,
    color: color.textPrimary
  },
  
  continueButton: {
    backgroundColor: color.accent,
    borderWidth: 1,
    borderColor: color.borderStrong,
    paddingVertical: 15,
    borderRadius: radius.md,
    alignItems: 'center'
  },
  
  continueButtonDisabled: {
    backgroundColor: color.accentSoft,
    borderColor: color.border
  },
  
  continueButtonText: {
    fontSize: 16,
    fontFamily: fonts.SemiBold,
    color: color.accentText
  }
});
