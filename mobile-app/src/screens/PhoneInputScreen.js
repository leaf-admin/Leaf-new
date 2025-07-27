import React, { useState, useEffect, useRef } from 'react';
import { 
  View, 
  Text, 
  StyleSheet, 
  TextInput, 
  TouchableOpacity, 
  Alert, 
  ActivityIndicator,
  Dimensions,
  Platform,
  Animated
} from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Linking from 'expo-linking';
import auth from '@react-native-firebase/auth';
import hybridOTPService from '../services/HybridOTPService';

const { width, height } = Dimensions.get('window');

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
  const [name, setName] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [isDetectingPhone, setIsDetectingPhone] = useState(false);
  
  const userType = route.params?.userType || 'passenger';

  // Animações
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const cardAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    // Animação de entrada
    Animated.parallel([
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 800,
        useNativeDriver: true,
      }),
      Animated.spring(cardAnim, {
        toValue: 1,
        tension: 80,
        friction: 7,
        useNativeDriver: true,
      })
    ]).start();
  }, []);

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
    if (!name.trim()) {
      Alert.alert("Nome Obrigatório", "Por favor, insira seu nome completo.");
      return;
    }

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
      console.log("PhoneInputScreen - Iniciando envio de OTP híbrido para:", phone);
      
      // Formatar telefone
      const cleanPhone = phone.replace(/\D/g, '');
      const formattedPhone = `+55${cleanPhone}`;
      
      console.log("PhoneInputScreen - Telefone formatado:", formattedPhone);
      
      // Inicializar serviço híbrido
      await hybridOTPService.initialize();
      
      // Enviar OTP usando estratégia híbrida (SMS + WhatsApp fallback)
      const result = await hybridOTPService.sendOTP(formattedPhone);
      
      console.log("PhoneInputScreen - Resultado do envio:", result);
      
      if (result.success) {
        // Salvar dados temporários
        const tempData = { 
          phone: formattedPhone, 
          name, 
          userType,
          verificationId: result.verificationId,
          otpProvider: result.provider,
          otpCode: result.otp // Para debug/teste
        };
        await AsyncStorage.setItem('@temp_user_data', JSON.stringify(tempData));
        
        // Mostrar feedback do provedor usado
        const providerText = result.provider === 'sms' ? 'SMS' : 'WhatsApp';
        console.log(`PhoneInputScreen - OTP enviado via ${providerText}`);
        
        // Navegar para tela de OTP
        navigation.navigate('OTP', { 
          phone: formattedPhone, 
          name, 
          userType,
          verificationId: result.verificationId,
          otpProvider: result.provider
        });
        
      } else {
        throw new Error(result.error || 'Falha no envio do OTP');
      }
      
    } catch (error) {
      console.error("PhoneInputScreen - Erro ao enviar OTP:", error);
      
      let errorMessage = "Não foi possível enviar o código. Tente novamente.";
      
      if (error.message.includes('invalid-phone-number')) {
        errorMessage = "Número de telefone inválido. Verifique o formato.";
      } else if (error.message.includes('too-many-requests') || error.message.includes('Muitas tentativas')) {
        errorMessage = "Muitas tentativas. Tente novamente em alguns minutos.";
      } else if (error.message.includes('quota-exceeded') || error.message.includes('limite')) {
        errorMessage = "Limite de envios excedido. Tente novamente mais tarde.";
      } else if (error.message.includes('SMS e WhatsApp falharam')) {
        errorMessage = "SMS e WhatsApp não estão disponíveis. Tente novamente mais tarde.";
      }
      
      Alert.alert("Erro", errorMessage);
    } finally {
      setIsLoading(false);
    }
  };

  const handleGoogleLogin = () => {
    console.log("PhoneInputScreen - Login com Google");
    // Implementar login com Google
  };

  const handleFacebookLogin = () => {
    console.log("PhoneInputScreen - Login com Facebook");
    // Implementar login com Facebook
  };

  const openTerms = () => {
    console.log("PhoneInputScreen - Abrindo Termos de Uso");
    // Abrir termos de uso
  };

  const openPrivacy = () => {
    console.log("PhoneInputScreen - Abrindo Política de Privacidade");
    // Abrir política de privacidade
  };

  return (
    <View style={styles.container}>
      {/* Header - FORA DO BOTTOM SHEET */}
      <View style={styles.header}>
        {/* Círculo de progresso */}
        <View style={styles.progressContainer}>
          <View style={styles.progressCircle}>
            <Text style={styles.progressText}>2</Text>
          </View>
        </View>
        
        {/* Contagem de progresso */}
        <Text style={styles.progressCount}>Passo 2 de 4</Text>
        
        {/* Nome da tela */}
        <Text style={styles.screenTitle}>Insira seu telefone</Text>
      </View>

      {/* BOTTOM SHEET ULTRA FLAT */}
      <Animated.View 
        style={[
          styles.bottomSheet,
          {
            opacity: fadeAnim,
            transform: [
              { 
                translateY: cardAnim.interpolate({
                  inputRange: [0, 1],
                  outputRange: [height, 0]
                })
              },
              { 
                scale: cardAnim.interpolate({
                  inputRange: [0, 1],
                  outputRange: [0.9, 1]
                })
              }
            ]
          }
        ]}
      >
        {/* Handle do bottom sheet */}
        <View style={styles.handle} />
        
        {/* Conteúdo do formulário */}
        <View style={styles.formContainer}>
          {/* Campo de Nome */}
          <View style={styles.nameInputContainer}>
            <TextInput
              style={styles.nameInput}
              value={name}
              onChangeText={setName}
              placeholder="Seu nome completo"
              placeholderTextColor={GRAY}
              autoCapitalize="words"
              maxLength={50}
            />
          </View>

          {/* Campo de Telefone */}
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
        </View>

        {/* Botão Próximo */}
        <View style={styles.footer}>
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
              <Text style={styles.nextButtonText}>Continuar</Text>
            )}
          </TouchableOpacity>
        </View>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: LEAF_GREEN,
  },
  
  // Header - FORA DO BOTTOM SHEET
  header: {
    alignItems: 'center',
    paddingTop: 60,
    paddingBottom: 20,
    zIndex: 1,
  },
  progressContainer: {
    marginBottom: 16,
  },
  progressCircle: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: WHITE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  progressText: {
    fontSize: 24,
    fontWeight: 'bold',
    color: LEAF_GREEN,
  },
  progressCount: {
    fontSize: 16,
    color: WHITE,
    marginBottom: 8,
    fontWeight: '500',
  },
  screenTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: WHITE,
    textAlign: 'center',
  },
  
  // BOTTOM SHEET ULTRA FLAT
  bottomSheet: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: height * 0.65,
    backgroundColor: '#E8F5E8',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 24,
  },
  
  // Handle do bottom sheet
  handle: {
    width: 40,
    height: 4,
    backgroundColor: '#C0C0C0',
    borderRadius: 2,
    alignSelf: 'center',
    marginBottom: 24,
  },
  
  // Formulário
  formContainer: {
    flex: 1,
    marginBottom: 24,
  },
  
  // Campo de nome
  nameInputContainer: {
    backgroundColor: WHITE,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    marginBottom: 16,
  },
  nameInput: {
    fontSize: 16,
    color: BLACK,
    paddingVertical: 8,
  },
  
  // Campo de telefone
  phoneInputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: WHITE,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    marginBottom: 16,
  },
  countrySelector: {
    flexDirection: 'row',
    alignItems: 'center',
    marginRight: 12,
  },
  flag: {
    fontSize: 20,
    marginRight: 8,
  },
  countryCode: {
    fontSize: 16,
    fontWeight: '600',
    color: LEAF_GREEN,
    marginRight: 4,
  },
  dropdownArrow: {
    fontSize: 12,
    color: GRAY,
  },
  phoneInput: {
    flex: 1,
    fontSize: 16,
    color: BLACK,
    paddingVertical: 8,
  },
  
  // Botão detectar
  detectButton: {
    backgroundColor: WHITE,
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
    marginBottom: 24,
  },
  detectButtonText: {
    fontSize: 14,
    color: LEAF_GREEN,
    fontWeight: '500',
  },
  
  // Termos
  termsContainer: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: WHITE,
    borderRadius: 12,
    padding: 16,
  },
  checkbox: {
    width: 20,
    height: 20,
    borderRadius: 4,
    borderWidth: 2,
    borderColor: LEAF_GREEN,
    marginRight: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxChecked: {
    backgroundColor: LEAF_GREEN,
  },
  checkmark: {
    color: WHITE,
    fontSize: 12,
    fontWeight: 'bold',
  },
  termsText: {
    flex: 1,
    fontSize: 13,
    color: LEAF_GREEN,
    lineHeight: 18,
  },
  termsLink: {
    color: LEAF_GREEN,
    fontWeight: '600',
    textDecorationLine: 'underline',
  },
  
  // Footer
  footer: {
    marginTop: 'auto',
  },
  nextButton: {
    backgroundColor: LEAF_GREEN,
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
  },
  nextButtonDisabled: {
    backgroundColor: '#C0C0C0',
  },
  nextButtonText: {
    fontSize: 16,
    fontWeight: 'bold',
    color: WHITE,
  },
}); 