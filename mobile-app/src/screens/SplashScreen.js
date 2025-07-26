import React, { useState, useEffect, useRef } from 'react';
import { 
  View, 
  Text, 
  StyleSheet, 
  StatusBar, 
  Animated, 
  TouchableOpacity, 
  Alert,
  Dimensions,
  Platform
} from 'react-native';
import * as Location from 'expo-location';
import * as Notifications from 'expo-notifications';
import AsyncStorage from '@react-native-async-storage/async-storage';

const { width, height } = Dimensions.get('window');

const LEAF_GREEN = '#1A330E';
const WHITE = '#FFFFFF';
const BLACK = '#000000';
const GRAY = '#666666';
const LIGHT_GRAY = '#F5F5F5';
const DARK_GRAY = '#333333';

export default function SplashScreen({ navigation }) {
  const [currentStep, setCurrentStep] = useState('splash'); // splash, permissions, policy
  const [permissionsGranted, setPermissionsGranted] = useState({
    location: false,
    notifications: false,
    phone: false,
    policy: false
  });
  
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const scaleAnim = useRef(new Animated.Value(0.8)).current;
  const logoAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    console.log("SplashScreen - Iniciando animação");
    startAnimation();
  }, []);

  const startAnimation = () => {
    Animated.parallel([
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 1000,
        useNativeDriver: true,
      }),
      Animated.spring(scaleAnim, {
        toValue: 1,
        tension: 50,
        friction: 7,
        useNativeDriver: true,
      }),
      Animated.timing(logoAnim, {
        toValue: 1,
        duration: 800,
        useNativeDriver: true,
      })
    ]).start(() => {
      console.log("SplashScreen - Animação concluída, iniciando permissões");
      setTimeout(() => {
        setCurrentStep('permissions');
      }, 1500);
    });
  };

  const requestLocationPermission = async () => {
    try {
      console.log("SplashScreen - Solicitando permissão de localização");
      
      const { status } = await Location.requestForegroundPermissionsAsync();
      
      if (status === 'granted') {
        console.log("SplashScreen - Permissão de localização concedida");
        setPermissionsGranted(prev => ({ ...prev, location: true }));
        return true;
      } else {
        console.log("SplashScreen - Permissão de localização negada");
        Alert.alert(
          "Permissão Necessária",
          "A localização é obrigatória para o funcionamento do app. Sem ela, não é possível continuar.",
          [{ text: "OK", onPress: () => requestLocationPermission() }]
        );
        return false;
      }
    } catch (error) {
      console.error("SplashScreen - Erro ao solicitar permissão de localização:", error);
      return false;
    }
  };

  const requestNotificationPermission = async () => {
    try {
      console.log("SplashScreen - Solicitando permissão de notificações");
      
      const { status } = await Notifications.requestPermissionsAsync();
      
      if (status === 'granted') {
        console.log("SplashScreen - Permissão de notificações concedida");
        setPermissionsGranted(prev => ({ ...prev, notifications: true }));
      } else {
        console.log("SplashScreen - Permissão de notificações negada");
      }
      return true; // Notificações não são obrigatórias
    } catch (error) {
      console.error("SplashScreen - Erro ao solicitar permissão de notificações:", error);
      return true;
    }
  };

  const requestPhonePermission = async () => {
    try {
      console.log("SplashScreen - Solicitando permissão de telefone");
      
      // Para Android, tentar solicitar permissão de telefone
      if (Platform.OS === 'android') {
        const { PermissionsAndroid } = require('react-native');
        
        try {
          const granted = await PermissionsAndroid.request(
            PermissionsAndroid.PERMISSIONS.READ_PHONE_STATE,
            {
              title: 'Permissão de Telefone',
              message: 'O app precisa acessar informações do telefone para melhorar sua experiência.',
              buttonNeutral: 'Perguntar depois',
              buttonNegative: 'Cancelar',
              buttonPositive: 'OK',
            }
          );
          
          if (granted === PermissionsAndroid.RESULTS.GRANTED) {
            console.log("SplashScreen - Permissão de telefone concedida");
            setPermissionsGranted(prev => ({ ...prev, phone: true }));
          } else {
            console.log("SplashScreen - Permissão de telefone negada");
          }
        } catch (err) {
          console.log("SplashScreen - Erro ao solicitar permissão de telefone:", err);
        }
      }
      return true; // Telefone não é obrigatório
    } catch (error) {
      console.error("SplashScreen - Erro ao solicitar permissão de telefone:", error);
      return true;
    }
  };

  const handlePermissionsRequest = async () => {
    console.log("SplashScreen - Iniciando solicitação de permissões");
    
    const locationGranted = await requestLocationPermission();
    await requestNotificationPermission();
    await requestPhonePermission();
    
    if (locationGranted) {
      console.log("SplashScreen - Permissões concedidas, indo para política");
      setCurrentStep('policy');
    }
  };

  const handlePolicyAccept = async () => {
    try {
      console.log("SplashScreen - Política aceita, salvando permissões");
      
      // Salvar estado das permissões
      await AsyncStorage.setItem('@permissions_granted', JSON.stringify({
        ...permissionsGranted,
        policy: true
      }));
      
      console.log("SplashScreen - Navegando para ProfileSelection");
      navigation.replace('ProfileSelection');
    } catch (error) {
      console.error("SplashScreen - Erro ao salvar permissões:", error);
    }
  };

  const handlePolicyDecline = () => {
    Alert.alert(
      "Política de Privacidade Obrigatória",
      "É necessário aceitar a Política de Privacidade para continuar usando o app.",
      [{ text: "OK" }]
    );
  };

  // Tela de Splash inicial
  if (currentStep === 'splash') {
    return (
      <View style={styles.container}>
        <StatusBar backgroundColor={LEAF_GREEN} barStyle="light-content" />
        
        <Animated.View style={[
          styles.logoContainer,
          {
            opacity: fadeAnim,
            transform: [
              { scale: scaleAnim },
              { translateY: logoAnim.interpolate({
                inputRange: [0, 1],
                outputRange: [50, 0]
              })}
            ]
          }
        ]}>
          <Text style={styles.logoText}>99</Text>
        </Animated.View>
      </View>
    );
  }

  // Tela de Permissões
  if (currentStep === 'permissions') {
    return (
      <View style={styles.container}>
        <StatusBar backgroundColor={LEAF_GREEN} barStyle="light-content" />
        
        <View style={styles.permissionDialog}>
          <View style={styles.permissionIcon}>
            <Text style={styles.permissionIconText}>📍</Text>
          </View>
          
          <Text style={styles.permissionTitle}>
            Permissões Necessárias
          </Text>
          
          <Text style={styles.permissionText}>
            O app 99 precisa das seguintes permissões para funcionar corretamente:
          </Text>
          
          <View style={styles.permissionList}>
            <Text style={styles.permissionItem}>• <Text style={styles.permissionBold}>Localização:</Text> Para encontrar motoristas próximos e calcular rotas</Text>
            <Text style={styles.permissionItem}>• <Text style={styles.permissionBold}>Notificações:</Text> Para avisos sobre suas corridas</Text>
            <Text style={styles.permissionItem}>• <Text style={styles.permissionBold}>Telefone:</Text> Para melhorar sua experiência</Text>
          </View>
          
          <TouchableOpacity 
            style={styles.permissionButton}
            onPress={handlePermissionsRequest}
          >
            <Text style={styles.permissionButtonText}>Permitir</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  // Tela de Política de Privacidade
  if (currentStep === 'policy') {
    return (
      <View style={styles.container}>
        <StatusBar backgroundColor={LEAF_GREEN} barStyle="light-content" />
        
        <View style={styles.policyContainer}>
          <View style={styles.policyHeader}>
            <Text style={styles.policyTitle}>Política de Privacidade e Uso</Text>
          </View>
          
          <View style={styles.policyContent}>
            <Text style={styles.policyText}>
              Antes de usar os produtos ou serviços 99, leia atentamente os Termos de Uso, 
              as regras da plataforma e a Política de Privacidade.
            </Text>
            
            <Text style={styles.policyText}>
              Ao tocar em "Concordo" e usar nossos produtos e serviços, você confirma que 
              leu, entendeu e concorda em agir de acordo com os termos.
            </Text>
            
            <Text style={styles.policyText}>
              A Política de Privacidade aborda principalmente como coletamos e usamos 
              informações pessoais, como seu número de telefone, nome, dados das suas 
              corridas, localização, detalhes das corridas e permissões do dispositivo.
            </Text>
            
            <TouchableOpacity style={styles.policyLink}>
              <Text style={styles.policyLinkText}>Privacidade e uso da 99 {'>'}</Text>
            </TouchableOpacity>
          </View>
          
          <View style={styles.policyButtons}>
            <TouchableOpacity 
              style={styles.agreeButton}
              onPress={handlePolicyAccept}
            >
              <Text style={styles.agreeButtonText}>Concordo</Text>
            </TouchableOpacity>
            
            <TouchableOpacity 
              style={styles.declineButton}
              onPress={handlePolicyDecline}
            >
              <Text style={styles.declineButtonText}>Sair</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    );
  }

  return null;
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: LEAF_GREEN,
    justifyContent: 'center',
    alignItems: 'center',
  },
  
  // Splash Screen
  logoContainer: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoText: {
    fontSize: 120,
    fontWeight: 'bold',
    color: BLACK,
    textAlign: 'center',
  },
  
  // Permission Dialog
  permissionDialog: {
    backgroundColor: WHITE,
    borderRadius: 20,
    padding: 30,
    margin: 20,
    width: width - 40,
    alignItems: 'center',
  },
  permissionIcon: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: '#F0F0F0',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 20,
  },
  permissionIconText: {
    fontSize: 30,
  },
  permissionTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: BLACK,
    textAlign: 'center',
    marginBottom: 15,
  },
  permissionText: {
    fontSize: 16,
    color: '#666',
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: 20,
  },
  permissionList: {
    alignSelf: 'stretch',
    marginBottom: 30,
  },
  permissionItem: {
    fontSize: 14,
    color: '#666',
    lineHeight: 20,
    marginBottom: 8,
  },
  permissionBold: {
    fontWeight: 'bold',
    color: BLACK,
  },
  permissionButton: {
    backgroundColor: LEAF_GREEN,
    paddingHorizontal: 40,
    paddingVertical: 15,
    borderRadius: 25,
    minWidth: 150,
  },
  permissionButtonText: {
    fontSize: 18,
    fontWeight: 'bold',
    color: WHITE,
    textAlign: 'center',
  },
  
  // Policy Screen
  policyContainer: {
    flex: 1,
    backgroundColor: WHITE,
    margin: 20,
    borderRadius: 20,
    overflow: 'hidden',
  },
  policyHeader: {
    backgroundColor: LEAF_GREEN,
    padding: 30,
    alignItems: 'center',
  },
  policyTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: WHITE,
    textAlign: 'center',
  },
  policyContent: {
    flex: 1,
    padding: 30,
  },
  policyText: {
    fontSize: 16,
    color: GRAY,
    lineHeight: 24,
    marginBottom: 20,
  },
  policyLink: {
    marginTop: 20,
  },
  policyLinkText: {
    fontSize: 16,
    color: LEAF_GREEN,
    textDecorationLine: 'underline',
    fontWeight: 'bold',
  },
  policyButtons: {
    padding: 30,
    gap: 15,
  },
  agreeButton: {
    backgroundColor: LEAF_GREEN,
    paddingVertical: 15,
    borderRadius: 25,
    alignItems: 'center',
  },
  agreeButtonText: {
    fontSize: 18,
    fontWeight: 'bold',
    color: WHITE,
  },
  declineButton: {
    backgroundColor: WHITE,
    paddingVertical: 15,
    borderRadius: 25,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: LIGHT_GRAY,
  },
  declineButtonText: {
    fontSize: 18,
    fontWeight: 'bold',
    color: GRAY,
  },
}); 