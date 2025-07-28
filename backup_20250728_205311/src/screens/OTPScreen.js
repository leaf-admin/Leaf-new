import React, { useState, useRef, useEffect } from 'react';
import { 
  View, 
  Text, 
  StyleSheet, 
  TextInput, 
  TouchableOpacity, 
  Alert, 
  ActivityIndicator,
  Animated,
  Dimensions,
  Image
} from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import auth from '@react-native-firebase/auth';
import SmsRetriever from 'react-native-sms-retriever';

const { width, height } = Dimensions.get('window');

// Constantes de cores
const WHITE = '#FFFFFF';
const BLACK = '#000000';
const GRAY = '#666666';
const LIGHT_GRAY = '#F5F5F5';
const DARK_GRAY = '#333333';

export default function OTPScreen() {
  const navigation = useNavigation();
  const route = useRoute();
  
  const [otp, setOtp] = useState(['', '', '', '', '', '']);
  const [isLoading, setIsLoading] = useState(false);
  const [resendTimer, setResendTimer] = useState(30);
  const [canResend, setCanResend] = useState(false);
  const [smsRetrieverActive, setSmsRetrieverActive] = useState(false);

  
  const { phone, name, userType, verificationId } = route.params;

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

    // Timer para reenvio
    const timer = setInterval(() => {
      setResendTimer((prev) => {
        if (prev <= 1) {
          setCanResend(true);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);



    // Iniciar SMS Retriever para auto-preenchimento
    startSmsRetriever();

    return () => {
      clearInterval(timer);
      // Limpar SMS Retriever
      SmsRetriever.removeSmsListener();
    };
  }, []);

  // Função para iniciar SMS Retriever
  const startSmsRetriever = async () => {
    try {
      console.log("OTPScreen - Iniciando SMS Retriever...");
      
      // Verificar se o dispositivo suporta SMS Retriever
      const isSupported = await SmsRetriever.isSupported();
      
      if (!isSupported) {
        console.log("OTPScreen - SMS Retriever não suportado neste dispositivo");
        setSmsRetrieverActive(false);
        return;
      }

      // Iniciar listener para SMS
      SmsRetriever.addSmsListener((message) => {
        console.log("OTPScreen - SMS recebido:", message);
        
        // Extrair código OTP do SMS
        const otpCode = extractOtpFromSms(message);
        
        if (otpCode) {
          console.log("OTPScreen - Código OTP detectado:", otpCode);
          
          // Preencher automaticamente os campos
          const otpArray = otpCode.split('').slice(0, 6);
          setOtp(otpArray);
          
          // Mostrar feedback visual
          Alert.alert(
            "Código Detectado!",
            `Código ${otpCode} foi detectado automaticamente. Verificando...`,
            [{ text: "OK" }]
          );
          
          // Verificar automaticamente após 1 segundo
          setTimeout(() => {
            handleVerifyOtp();
          }, 1000);
        }
      });

      console.log("OTPScreen - SMS Retriever iniciado com sucesso");
      setSmsRetrieverActive(true);
      
    } catch (error) {
      console.error("OTPScreen - Erro ao iniciar SMS Retriever:", error);
      setSmsRetrieverActive(false);
    }
  };

  // Função para extrair OTP do SMS
  const extractOtpFromSms = (message) => {
    try {
      // Padrões comuns de SMS do Firebase
      const patterns = [
        /(\d{6})/, // 6 dígitos consecutivos
        /código[:\s]*(\d{6})/i, // "código: 123456"
        /code[:\s]*(\d{6})/i, // "code: 123456"
        /verificação[:\s]*(\d{6})/i, // "verificação: 123456"
        /verification[:\s]*(\d{6})/i, // "verification: 123456"
        /otp[:\s]*(\d{6})/i, // "otp: 123456"
        /(\d{6})[^\d]*$/ // 6 dígitos no final da mensagem
      ];

      for (const pattern of patterns) {
        const match = message.match(pattern);
        if (match && match[1]) {
          return match[1];
        }
      }

      return null;
    } catch (error) {
      console.error("OTPScreen - Erro ao extrair OTP:", error);
      return null;
    }
  };

  const handleOtpChange = (text, index) => {
    const newOtp = [...otp];
    newOtp[index] = text;
    setOtp(newOtp);

    // Auto focus next input
    if (text && index < 5) {
      // Focus next input
    }
  };

  const formatPhone = (phone) => {
    const clean = phone.replace(/\D/g, '');
    return `(${clean.slice(0, 2)}) ${clean.slice(2, 7)}-${clean.slice(7, 11)}`;
  };

  const validateOtp = () => {
    return otp.join('').length === 6;
  };

  const handleVerifyOtp = async () => {
    if (!validateOtp()) {
      Alert.alert("Código Inválido", "Por favor, insira o código de 6 dígitos.");
      return;
    }

    if (!verificationId) {
      Alert.alert("Erro", "Dados de verificação não encontrados. Tente novamente.");
      return;
    }

    setIsLoading(true);
    
    try {
      const otpCode = otp.join('');
      console.log("OTPScreen - Verificando OTP:", otpCode);
      
      // Criar credencial com Firebase
      const credential = auth.PhoneAuthProvider.credential(verificationId, otpCode);
      
      // Fazer sign in com a credencial
      const userCredential = await auth().signInWithCredential(credential);
      
      console.log("OTPScreen - OTP verificado com sucesso:", userCredential.user.uid);
      
      // Salvar dados temporários
      const tempData = { 
        phone, 
        name, 
        userType, 
        otpVerified: true,
        uid: userCredential.user.uid
      };
      await AsyncStorage.setItem('@temp_user_data', JSON.stringify(tempData));
      
      // Navegar para próxima tela
      navigation.navigate('PersonalData', { phone, name, userType });
      
    } catch (error) {
      console.error("OTPScreen - Erro ao verificar OTP:", error);
      
      let errorMessage = "Não foi possível verificar o código. Tente novamente.";
      
      if (error.code === 'auth/invalid-verification-code') {
        errorMessage = "Código inválido. Verifique o número e tente novamente.";
      } else if (error.code === 'auth/invalid-verification-id') {
        errorMessage = "Sessão expirada. Solicite um novo código.";
      } else if (error.code === 'auth/code-expired') {
        errorMessage = "Código expirado. Solicite um novo código.";
      }
      
      Alert.alert("Erro", errorMessage);
    } finally {
      setIsLoading(false);
    }
  };

  const handleResendOtp = async () => {
    if (!canResend) return;

    setCanResend(false);
    setResendTimer(30);
    
    try {
      console.log("OTPScreen - Reenviando OTP para:", phone);
      
      // Reenviar SMS via Firebase
      const confirmation = await auth().verifyPhoneNumber(phone);
      
      console.log("OTPScreen - Novo SMS enviado, verificationId:", confirmation.verificationId);
      
      // Atualizar verificationId nos dados temporários
      const tempDataString = await AsyncStorage.getItem('@temp_user_data');
      const tempData = tempDataString ? JSON.parse(tempDataString) : {};
      tempData.verificationId = confirmation.verificationId;
      await AsyncStorage.setItem('@temp_user_data', JSON.stringify(tempData));
      
      Alert.alert("Código Reenviado", "Um novo código foi enviado para seu telefone.");
      
    } catch (error) {
      console.error("OTPScreen - Erro ao reenviar OTP:", error);
      
      let errorMessage = "Não foi possível reenviar o código. Tente novamente.";
      
      if (error.code === 'auth/too-many-requests') {
        errorMessage = "Muitas tentativas. Tente novamente em alguns minutos.";
      } else if (error.code === 'auth/quota-exceeded') {
        errorMessage = "Limite de SMS excedido. Tente novamente mais tarde.";
      }
      
      Alert.alert("Erro", errorMessage);
      setCanResend(true);
    }
  };

  return (
    <View style={styles.container}>
      {/* Background com splash.png */}
      <Image 
        source={require('../../assets/images/splash.png')}
        style={styles.backgroundImage}
        resizeMode="cover"
      />
      
      {/* Logo da Leaf no topo */}
      <View style={styles.logoContainer}>
        <Image 
          source={require('../../assets/images/leaftransparentbg.png')}
          style={styles.logo}
          resizeMode="contain"
        />
      </View>

      {/* BOTTOM SHEET */}
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
        
        {/* Título */}
        <Text style={styles.title}>Verificação</Text>
        
        {/* Subtítulo */}
        <Text style={styles.subtitle}>
          Digite o código enviado para {formatPhone(phone)}
        </Text>
        
        {/* Indicador de SMS Retriever */}
        {smsRetrieverActive && (
          <View style={styles.smsRetrieverContainer}>
            <ActivityIndicator size="small" color="#1A330E" />
            <Text style={styles.smsRetrieverText}>
              Aguardando SMS para preenchimento automático...
            </Text>
          </View>
        )}
        

        
        {/* Campos OTP */}
        <View style={styles.otpContainer}>
          {otp.map((digit, index) => (
            <TextInput
              key={index}
              style={styles.otpInput}
              value={digit}
              onChangeText={(text) => handleOtpChange(text, index)}
              keyboardType="numeric"
              maxLength={1}
              textAlign="center"
              placeholder="•"
              placeholderTextColor={GRAY}
            />
          ))}
        </View>
        
        {/* Botão verificar */}
        <TouchableOpacity
          style={[
            styles.verifyButton,
            !validateOtp() && styles.verifyButtonDisabled
          ]}
          onPress={handleVerifyOtp}
          disabled={!validateOtp() || isLoading}
        >
          {isLoading ? (
            <ActivityIndicator size="small" color={WHITE} />
          ) : (
            <Text style={styles.verifyButtonText}>Verificar</Text>
          )}
        </TouchableOpacity>
        
        {/* Reenviar código */}
        <View style={styles.resendContainer}>
          <Text style={styles.resendText}>
            Não recebeu o código?{' '}
            {canResend ? (
              <Text style={styles.resendLink} onPress={handleResendOtp}>
                Reenviar
              </Text>
            ) : (
              <Text style={styles.resendTimer}>
                Reenviar em {resendTimer}s
              </Text>
            )}
          </Text>
          

        </View>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  
  // Background com splash.png
  backgroundImage: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    width: width,
    height: height,
  },
  
  // Logo da Leaf
  logoContainer: {
    position: 'absolute',
    top: 60,
    left: 0,
    right: 0,
    alignItems: 'center',
    zIndex: 1,
  },
  logo: {
    width: 389,
    height: 194,
  },
  
  // BOTTOM SHEET
  bottomSheet: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: WHITE,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 32,
    paddingBottom: 40,
    height: height * 0.55 + 75,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.1,
    shadowRadius: 12,
    elevation: 8,
  },
  handle: {
    width: 40,
    height: 6,
    backgroundColor: '#E5E7EB',
    borderRadius: 3,
    alignSelf: 'center',
    marginBottom: 20,
  },
  
  // Título
  title: {
    fontSize: 20,
    fontWeight: 'bold',
    color: BLACK,
    textAlign: 'left',
    marginBottom: 8,
  },
  
  // Subtítulo
  subtitle: {
    fontSize: 14,
    color: GRAY,
    textAlign: 'left',
    marginBottom: 16,
    lineHeight: 20,
  },
  
  // SMS Retriever
  smsRetrieverContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F0F8F0',
    borderRadius: 8,
    padding: 12,
    marginBottom: 32,
  },
  smsRetrieverText: {
    fontSize: 12,
    color: '#1A330E',
    marginLeft: 8,
    fontWeight: '500',
  },
  

  
  // Campos OTP
  otpContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 32,
  },
  otpInput: {
    width: 60,
    height: 60,
    borderWidth: 2,
    borderColor: '#E5E7EB',
    borderRadius: 12,
    fontSize: 24,
    fontWeight: 'bold',
    color: BLACK,
    backgroundColor: WHITE,
  },
  
  // Botão verificar
  verifyButton: {
    backgroundColor: '#1A330E',
    borderRadius: 8,
    paddingVertical: 14,
    alignItems: 'center',
    marginBottom: 24,
    shadowColor: '#1A330E',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 4,
  },
  verifyButtonDisabled: {
    backgroundColor: '#D1D5DB',
    shadowOpacity: 0,
    elevation: 0,
  },
  verifyButtonText: {
    fontSize: 15,
    fontWeight: 'bold',
    color: WHITE,
  },
  
  // Reenviar
  resendContainer: {
    alignItems: 'center',
  },
  resendText: {
    fontSize: 13,
    color: GRAY,
    textAlign: 'center',
    marginBottom: 16,
  },
  resendLink: {
    color: '#1A330E',
    fontWeight: '600',
    textDecorationLine: 'underline',
  },
  resendTimer: {
    color: GRAY,
  },
  

}); 