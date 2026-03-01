import Logger from '../utils/Logger';
import React, { useState } from 'react';
import { 
  View, 
  Text, 
  StyleSheet, 
  TouchableOpacity, 
  Alert, 
  ScrollView,
  Dimensions
} from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import AsyncStorage from '@react-native-async-storage/async-storage';


const { width, height } = Dimensions.get('window');

const LEAF_GREEN = '#1A330E';
const WHITE = '#FFFFFF';
const BLACK = '#000000';
const GRAY = '#666666';
const LIGHT_GRAY = '#F5F5F5';
const DARK_GRAY = '#333333';

export default function DriverTermsScreen() {
  const navigation = useNavigation();
  const route = useRoute();
  
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [privacyAccepted, setPrivacyAccepted] = useState(false);
  const [serviceAccepted, setServiceAccepted] = useState(false);
  
  const { userData } = route.params;

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
            Para se tornar um motorista parceiro da 99, você precisa aceitar os seguintes termos e condições:
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
                Li e aceito os Termos de Uso da plataforma 99, que regem o uso do aplicativo e os serviços prestados.
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
              • A 99 pode suspender ou encerrar sua conta por violação dos termos
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
    backgroundColor: WHITE,
  },
  
  header: {
    paddingTop: 60,
    paddingHorizontal: 30,
    paddingBottom: 30,
    backgroundColor: LEAF_GREEN,
  },
  
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    color: WHITE,
    textAlign: 'center',
    marginBottom: 10,
  },
  
  subtitle: {
    fontSize: 16,
    color: WHITE,
    textAlign: 'center',
    opacity: 0.8,
  },
  
  content: {
    flex: 1,
  },
  
  termsContainer: {
    padding: 30,
  },
  
  sectionTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: BLACK,
    textAlign: 'center',
    marginBottom: 20,
  },
  
  termsText: {
    fontSize: 16,
    color: GRAY,
    lineHeight: 24,
    marginBottom: 30,
    textAlign: 'center',
  },
  
  termItem: {
    flexDirection: 'row',
    marginBottom: 25,
    alignItems: 'flex-start',
  },
  
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: 4,
    borderWidth: 2,
    borderColor: GRAY,
    marginRight: 15,
    marginTop: 2,
    justifyContent: 'center',
    alignItems: 'center',
  },
  
  checkboxChecked: {
    backgroundColor: LEAF_GREEN,
    borderColor: LEAF_GREEN,
  },
  
  checkmark: {
    color: WHITE,
    fontSize: 14,
    fontWeight: 'bold',
  },
  
  termContent: {
    flex: 1,
  },
  
  termTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: BLACK,
    marginBottom: 8,
  },
  
  termDescription: {
    fontSize: 14,
    color: GRAY,
    lineHeight: 20,
  },
  
  importantNote: {
    backgroundColor: '#FFF8E1',
    borderWidth: 1,
    borderColor: '#FFE082',
    borderRadius: 8,
    padding: 20,
    marginTop: 20,
    marginBottom: 30,
  },
  
  importantTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#E65100',
    marginBottom: 10,
  },
  
  importantText: {
    fontSize: 14,
    color: '#E65100',
    lineHeight: 20,
  },
  
  buttonsContainer: {
    gap: 15,
  },
  
  acceptAllButton: {
    backgroundColor: LIGHT_GRAY,
    paddingVertical: 15,
    borderRadius: 25,
    alignItems: 'center',
  },
  
  acceptAllButtonText: {
    fontSize: 16,
    fontWeight: 'bold',
    color: BLACK,
  },
  
  continueButton: {
    backgroundColor: LEAF_GREEN,
    paddingVertical: 15,
    borderRadius: 25,
    alignItems: 'center',
  },
  
  continueButtonDisabled: {
    backgroundColor: LIGHT_GRAY,
  },
  
  continueButtonText: {
    fontSize: 18,
    fontWeight: 'bold',
    color: WHITE,
  },
}); 