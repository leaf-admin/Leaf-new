import React, { useState, useEffect } from 'react';
import { 
  View, 
  Text, 
  StyleSheet, 
  TextInput, 
  TouchableOpacity, 
  Alert, 
  ActivityIndicator,
  Dimensions,
  Platform
} from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Linking from 'expo-linking';

const { width } = Dimensions.get('window');

const LEAF_GREEN = '#1A330E';
const WHITE = '#FFFFFF';
const BLACK = '#000000';
const GRAY = '#666666';
const LIGHT_GRAY = '#F5F5F5';
const DARK_GRAY = '#333333';

export default function PhoneInputScreen() {
  const navigation = useNavigation();
  const route = useRoute();
  
  const [phone, setPhone] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [isDetectingPhone, setIsDetectingPhone] = useState(false);
  
  const userType = route.params?.userType || 'passenger';

  // Função para formatar o telefone no padrão brasileiro
  const formatPhoneNumber = (text) => {
    // Remove tudo que não é número
    const numbers = text.replace(/\D/g, '');
    
    // Aplica a máscara XX XXXXX-XXXX
    if (numbers.length <= 2) {
      return numbers;
    } else if (numbers.length <= 7) {
      return `${numbers.slice(0, 2)} ${numbers.slice(2)}`;
    } else {
      return `${numbers.slice(0, 2)} ${numbers.slice(2, 7)}-${numbers.slice(7, 11)}`;
    }
  };

  const handlePhoneChange = (text) => {
    const formatted = formatPhoneNumber(text);
    setPhone(formatted);
  };

  // Função para detectar automaticamente o número do telefone
  const detectPhoneNumber = async () => {
    setIsDetectingPhone(true);
    
    try {
      // Simular detecção de telefone (em produção, usar APIs nativas)
      console.log("PhoneInputScreen - Detectando número do telefone...");
      
      // Aguardar um pouco para simular a detecção
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      // Para demonstração, usar um número fictício
      const detectedNumber = "21 99999-9999";
      setPhone(detectedNumber);
      
      console.log("PhoneInputScreen - Número detectado:", detectedNumber);
    } catch (error) {
      console.error("PhoneInputScreen - Erro ao detectar telefone:", error);
      Alert.alert("Erro", "Não foi possível detectar o número do telefone automaticamente.");
    } finally {
      setIsDetectingPhone(false);
    }
  };

  const validatePhone = () => {
    const cleanPhone = phone.replace(/\D/g, '');
    return cleanPhone.length >= 10 && cleanPhone.length <= 11;
  };

  const handleNext = async () => {
    if (!validatePhone()) {
      Alert.alert("Telefone Inválido", "Por favor, insira um número de telefone válido.");
      return;
    }

    if (!termsAccepted) {
      Alert.alert("Termos Obrigatórios", "Você precisa aceitar os Termos de Uso e Política de Privacidade.");
      return;
    }

    setIsLoading(true);
    
    try {
      console.log("PhoneInputScreen - Validando telefone:", phone);
      
      // Simular verificação na base de dados
      await new Promise(resolve => setTimeout(resolve, 1500));
      
      // Para demonstração, vamos simular que o telefone não existe (novo usuário)
      const phoneExists = false; // Em produção, verificar na API
      
      if (phoneExists) {
        // Telefone existe - ir para login
        console.log("PhoneInputScreen - Telefone existe, indo para login");
        navigation.navigate('Login', { phone, userType });
      } else {
        // Telefone não existe - enviar OTP
        console.log("PhoneInputScreen - Telefone não existe, enviando OTP");
        navigation.navigate('PersonalData', { phone, userType, isNewUser: true });
      }
    } catch (error) {
      console.error("PhoneInputScreen - Erro ao validar telefone:", error);
      Alert.alert("Erro", "Não foi possível validar o telefone. Tente novamente.");
    } finally {
      setIsLoading(false);
    }
  };

  const handleGoogleLogin = () => {
    Alert.alert("Login Google", "Funcionalidade de login com Google será implementada.");
  };

  const handleFacebookLogin = () => {
    Alert.alert("Login Facebook", "Funcionalidade de login com Facebook será implementada.");
  };

  const openTerms = () => {
    Linking.openURL('https://exemplo.com/termos');
  };

  const openPrivacy = () => {
    Linking.openURL('https://exemplo.com/privacidade');
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.logo}>99</Text>
      </View>

      <View style={styles.content}>
        <Text style={styles.title}>Insira o número de telefone</Text>
        
        <View style={styles.phoneInputContainer}>
          {/* Seletor de País */}
          <TouchableOpacity style={styles.countrySelector}>
            <Text style={styles.flag}>🇧🇷</Text>
            <Text style={styles.countryCode}>+55</Text>
            <Text style={styles.dropdownArrow}>▼</Text>
          </TouchableOpacity>
          
          {/* Campo de Telefone */}
          <TextInput
            style={styles.phoneInput}
            value={phone}
            onChangeText={handlePhoneChange}
            placeholder="123 4567 8901"
            placeholderTextColor={GRAY}
            keyboardType="phone-pad"
            maxLength={15}
          />
        </View>

        {/* Botão de Detectar Telefone */}
        <TouchableOpacity 
          style={styles.detectButton}
          onPress={detectPhoneNumber}
          disabled={isDetectingPhone}
        >
          {isDetectingPhone ? (
            <ActivityIndicator size="small" color={LEAF_GREEN} />
          ) : (
            <Text style={styles.detectButtonText}>Detectar automaticamente</Text>
          )}
        </TouchableOpacity>

        {/* Checkbox de Termos */}
        <View style={styles.termsContainer}>
          <TouchableOpacity 
            style={[styles.checkbox, termsAccepted && styles.checkboxChecked]}
            onPress={() => setTermsAccepted(!termsAccepted)}
          >
            {termsAccepted && <Text style={styles.checkmark}>✓</Text>}
          </TouchableOpacity>
          <Text style={styles.termsText}>
            Li e aceito os{' '}
            <Text style={styles.termsLink} onPress={openTerms}>Termos de Uso</Text>
            {' '}e a{' '}
            <Text style={styles.termsLink} onPress={openPrivacy}>Política de Privacidade</Text>
          </Text>
        </View>

        {/* Botão Próximo */}
        <TouchableOpacity 
          style={[
            styles.nextButton, 
            (!validatePhone() || !termsAccepted || isLoading) && styles.nextButtonDisabled
          ]}
          onPress={handleNext}
          disabled={!validatePhone() || !termsAccepted || isLoading}
        >
          {isLoading ? (
            <ActivityIndicator size="small" color={WHITE} />
          ) : (
            <Text style={styles.nextButtonText}>Próximo</Text>
          )}
        </TouchableOpacity>

        {/* Separador */}
        <View style={styles.separator}>
          <View style={styles.separatorLine} />
          <Text style={styles.separatorText}>ou</Text>
          <View style={styles.separatorLine} />
        </View>

        {/* Login Social */}
        <TouchableOpacity style={styles.socialButton} onPress={handleGoogleLogin}>
          <Text style={styles.socialButtonText}>Entrar com Google</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.socialButton} onPress={handleFacebookLogin}>
          <Text style={styles.socialButtonText}>Entrar com Facebook</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: WHITE,
  },
  
  header: {
    alignItems: 'center',
    paddingTop: 60,
    paddingBottom: 40,
  },
  
  logo: {
    fontSize: 48,
    fontWeight: 'bold',
    color: BLACK,
  },
  
  content: {
    flex: 1,
    paddingHorizontal: 30,
  },
  
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    color: BLACK,
    textAlign: 'center',
    marginBottom: 40,
  },
  
  phoneInputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: LIGHT_GRAY,
    paddingBottom: 10,
    marginBottom: 20,
  },
  
  countrySelector: {
    flexDirection: 'row',
    alignItems: 'center',
    marginRight: 15,
  },
  
  flag: {
    fontSize: 20,
    marginRight: 8,
  },
  
  countryCode: {
    fontSize: 16,
    fontWeight: 'bold',
    color: BLACK,
    marginRight: 5,
  },
  
  dropdownArrow: {
    fontSize: 12,
    color: GRAY,
  },
  
  phoneInput: {
    flex: 1,
    fontSize: 18,
    color: BLACK,
    paddingVertical: 5,
  },
  
  detectButton: {
    alignSelf: 'center',
    paddingVertical: 10,
    marginBottom: 30,
  },
  
  detectButtonText: {
    fontSize: 14,
    color: LEAF_GREEN,
    textDecorationLine: 'underline',
  },
  
  termsContainer: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 30,
  },
  
  checkbox: {
    width: 20,
    height: 20,
    borderRadius: 4,
    borderWidth: 2,
    borderColor: GRAY,
    marginRight: 10,
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
    fontSize: 12,
    fontWeight: 'bold',
  },
  
  termsText: {
    flex: 1,
    fontSize: 14,
    color: GRAY,
    lineHeight: 20,
  },
  
  termsLink: {
    color: LEAF_GREEN,
    textDecorationLine: 'underline',
  },
  
  nextButton: {
    backgroundColor: LEAF_GREEN,
    paddingVertical: 15,
    borderRadius: 25,
    alignItems: 'center',
    marginBottom: 30,
  },
  
  nextButtonDisabled: {
    backgroundColor: LIGHT_GRAY,
  },
  
  nextButtonText: {
    fontSize: 18,
    fontWeight: 'bold',
    color: WHITE,
  },
  
  separator: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 30,
  },
  
  separatorLine: {
    flex: 1,
    height: 1,
    backgroundColor: LIGHT_GRAY,
  },
  
  separatorText: {
    marginHorizontal: 15,
    fontSize: 14,
    color: GRAY,
  },
  
  socialButton: {
    backgroundColor: WHITE,
    borderWidth: 1,
    borderColor: LIGHT_GRAY,
    paddingVertical: 15,
    borderRadius: 25,
    alignItems: 'center',
    marginBottom: 15,
  },
  
  socialButtonText: {
    fontSize: 16,
    color: BLACK,
    fontWeight: '500',
  },
}); 