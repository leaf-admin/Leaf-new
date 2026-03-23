import Logger from '../utils/Logger';
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
  Animated,
  Image,
  KeyboardAvoidingView,
  Keyboard,
  ScrollView
} from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import hybridOTPService from '../services/HybridOTPService';
import { fonts } from '../common-local/font';
import onboardingTheme from '../components/auth/common/onboardingTheme';

const { color, radius, spacing, elevation } = onboardingTheme;

const { width, height } = Dimensions.get('window');

export default function PhoneInputScreen() {
  const navigation = useNavigation();
  const route = useRoute();

  const [phone, setPhone] = useState('');
  const [name, setName] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [isKeyboardVisible, setIsKeyboardVisible] = useState(false);
  const [keyboardHeight, setKeyboardHeight] = useState(0);

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

    // Listeners do teclado
    const keyboardDidShowListener = Keyboard.addListener(
      Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow',
      (event) => {
        Logger.log('🔑 Teclado abriu - altura:', event.endCoordinates.height);
        setIsKeyboardVisible(true);
        setKeyboardHeight(event.endCoordinates.height);
      }
    );

    const keyboardDidHideListener = Keyboard.addListener(
      Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide',
      () => {
        setIsKeyboardVisible(false);
        setKeyboardHeight(0);
      }
    );

    return () => {
      keyboardDidShowListener.remove();
      keyboardDidHideListener.remove();
    };
  }, []);

  // Função para formatar o telefone no padrão brasileiro
  const formatPhoneNumber = (text) => {
    // Remove tudo que não é número
    const numbers = text.replace(/\D/g, '');

    // Aplica a máscara (XX) XXXXX-XXXX
    if (numbers.length <= 2) {
      return numbers;
    } else if (numbers.length <= 7) {
      return `(${numbers.slice(0, 2)}) ${numbers.slice(2)}`;
    } else {
      return `(${numbers.slice(0, 2)}) ${numbers.slice(2, 7)}-${numbers.slice(7, 11)}`;
    }
  };

  const handlePhoneChange = (text) => {
    const formatted = formatPhoneNumber(text);
    setPhone(formatted);
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
      Logger.log("PhoneInputScreen - Iniciando envio de OTP híbrido para:", phone);

      // Formatar telefone
      const cleanPhone = phone.replace(/\D/g, '');
      const formattedPhone = `+55${cleanPhone}`;

      Logger.log("PhoneInputScreen - Telefone formatado:", formattedPhone);

      // Inicializar serviço híbrido
      await hybridOTPService.initialize();

      // Enviar OTP usando estratégia híbrida (SMS + WhatsApp fallback)
      const result = await hybridOTPService.sendOTP(formattedPhone);

      Logger.log("PhoneInputScreen - Resultado do envio:", result);

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
        Logger.log(`PhoneInputScreen - OTP enviado via ${providerText}`);

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
      Logger.error("PhoneInputScreen - Erro ao enviar OTP:", error);

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
    Logger.log("PhoneInputScreen - Login com Google");
    // Implementar login com Google
  };

  const handleFacebookLogin = () => {
    Logger.log("PhoneInputScreen - Login com Facebook");
    // Implementar login com Facebook
  };

  const openTerms = () => {
    Logger.log("PhoneInputScreen - Abrindo Termos de Uso");
    // Abrir termos de uso
  };

  const openPrivacy = () => {
    Logger.log("PhoneInputScreen - Abrindo Política de Privacidade");
    // Abrir política de privacidade
  };

  return (
    <View style={styles.container}>
      {/* Background com cor estática */}
      <View style={styles.backgroundContainer} />

      {/* Logo da Leaf no topo - só mostra quando teclado não está visível */}
      {!isKeyboardVisible && (
        <View style={styles.logoContainer}>
          <Image
            source={require('../../assets/images/leaftransparentbg.png')}
            style={styles.logo}
            resizeMode="contain"
          />
        </View>
      )}

      {/* BOTTOM SHEET ULTRA FLAT */}
      <Animated.View
        style={[
          styles.bottomSheet,
          {
            opacity: fadeAnim,
            height: keyboardHeight > 0 ? height * 0.6 : height * 0.65,
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

        {/* ScrollView para permitir rolagem quando o teclado aparecer */}
        <ScrollView
          style={styles.scrollView}
          contentContainerStyle={styles.scrollViewContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* Conteúdo do formulário */}
          <View style={styles.formContainer}>
            {/* Campo de Nome */}
            <View style={styles.nameInputContainer}>
              <TextInput
                style={styles.nameInput}
                value={name}
                onChangeText={setName}
                placeholder="Seu nome completo"
                placeholderTextColor={color.textMuted}
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
                placeholder="(21) 99999-9999"
                placeholderTextColor={color.textMuted}
                keyboardType="phone-pad"
                maxLength={15}
              />
            </View>

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
        </ScrollView>

        {/* Botão Próximo */}
        <View style={styles.footer}>
          <TouchableOpacity
            style={[
              styles.nextButton,
              (!name.trim() || !validatePhone() || !termsAccepted || isLoading) && styles.nextButtonDisabled
            ]}
            onPress={handleNext}
            disabled={!name.trim() || !validatePhone() || !termsAccepted || isLoading}
          >
            {isLoading ? (
              <ActivityIndicator size="small" color={color.accentText} />
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
    backgroundColor: color.background
  },

  backgroundContainer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: color.surfaceMuted,
    width: width,
    height: height
  },

  logoContainer: {
    position: 'absolute',
    top: 56,
    left: 0,
    right: 0,
    alignItems: 'center',
    zIndex: 1
  },

  header: {
    position: 'absolute',
    top: 60,
    left: 0,
    right: 0,
    alignItems: 'center',
    zIndex: 1
  },
  logo: {
    width: 340,
    height: 170
  },

  bottomSheet: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: color.panel,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    borderWidth: 1,
    borderColor: color.borderStrong,
    padding: spacing.xl,
    paddingBottom: 46,
    shadowColor: '#0E1522',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.18,
    shadowRadius: 16,
    elevation: 12
  },

  handle: {
    width: 40,
    height: 6,
    backgroundColor: 'rgba(138,150,166,0.7)',
    borderRadius: 3,
    alignSelf: 'center',
    marginBottom: spacing.md
  },

  scrollView: {
    flex: 1
  },
  scrollViewContent: {
    flexGrow: 1,
    paddingBottom: spacing.md
  },

  formContainer: {
    flex: 1,
    paddingTop: spacing.xs
  },

  nameInputContainer: {
    backgroundColor: color.surface,
    borderRadius: radius.md,
    paddingHorizontal: 16,
    paddingVertical: 12,
    marginBottom: spacing.sm,
    borderWidth: 1,
    borderColor: color.border
  },
  nameInput: {
    fontSize: 16,
    fontFamily: fonts.Medium,
    color: color.textPrimary,
    paddingVertical: 8
  },

  phoneInputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: color.surface,
    borderRadius: radius.md,
    paddingHorizontal: 16,
    paddingVertical: 12,
    marginBottom: spacing.sm,
    borderWidth: 1,
    borderColor: color.border
  },
  countrySelector: {
    flexDirection: 'row',
    alignItems: 'center',
    marginRight: 12
  },
  flag: {
    fontSize: 20,
    marginRight: 8
  },
  countryCode: {
    fontSize: 16,
    fontFamily: fonts.SemiBold,
    color: color.textPrimary,
    marginRight: 4,
  },
  dropdownArrow: {
    fontSize: 12,
    color: color.textMuted
  },
  phoneInput: {
    flex: 1,
    fontSize: 16,
    fontFamily: fonts.Medium,
    color: color.textPrimary,
    paddingVertical: 8,
  },

  termsContainer: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: color.surface,
    borderRadius: radius.md,
    padding: 16,
    borderWidth: 1,
    borderColor: color.border
  },
  checkbox: {
    width: 20,
    height: 20,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: color.borderStrong,
    marginRight: 12,
    alignItems: 'center',
    justifyContent: 'center'
  },
  checkboxChecked: {
    backgroundColor: color.accent,
    borderColor: color.accent
  },
  checkmark: {
    color: color.accentText,
    fontSize: 12,
    fontWeight: 'bold'
  },
  termsText: {
    flex: 1,
    fontSize: 13,
    color: color.textSecondary,
    lineHeight: 18
  },
  termsLink: {
    color: color.textPrimary,
    fontFamily: fonts.SemiBold,
    textDecorationLine: 'underline'
  },

  footer: {
    marginTop: 'auto'
  },
  nextButton: {
    backgroundColor: color.accent,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: color.borderStrong,
    paddingVertical: 16,
    alignItems: 'center'
  },
  nextButtonDisabled: {
    backgroundColor: color.accentSoft,
    borderColor: color.border
  },
  nextButtonText: {
    fontSize: 16,
    fontFamily: fonts.SemiBold,
    color: color.accentText
  }
});
