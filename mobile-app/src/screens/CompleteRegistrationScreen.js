import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Alert,
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

export default function CompleteRegistrationScreen() {
  const navigation = useNavigation();
  const route = useRoute();
  
  const [isLoading, setIsLoading] = useState(false);
  const [userData, setUserData] = useState(null);
  
  const { userData: routeUserData } = route.params;

  useEffect(() => {
    loadUserData();
  }, []);

  const loadUserData = async () => {
    try {
      const storedData = await AsyncStorage.getItem('@temp_user_data');
      const data = storedData ? JSON.parse(storedData) : routeUserData;
      setUserData(data);
      console.log('CompleteRegistrationScreen - Dados carregados:', data);
    } catch (error) {
      console.error('CompleteRegistrationScreen - Erro ao carregar dados:', error);
    }
  };

  const handleCompleteRegistration = async () => {
    setIsLoading(true);
    
    try {
      console.log('CompleteRegistrationScreen - Finalizando cadastro');
      
      // Simular processo de finalização
      await new Promise(resolve => setTimeout(resolve, 3000));
      
      // Salvar dados finais
      const finalUserData = {
        ...userData,
        registrationCompleted: true,
        registrationCompletedAt: new Date().toISOString(),
        status: userData.userType === 'driver' ? 'pending_approval' : 'active'
      };
      
      await AsyncStorage.setItem('@user_data', JSON.stringify(finalUserData));
      await AsyncStorage.removeItem('@temp_user_data');
      
      console.log('CompleteRegistrationScreen - Cadastro finalizado com sucesso');
      
      // Mostrar mensagem de sucesso
      Alert.alert(
        'Cadastro Concluído!',
        userData.userType === 'driver' 
          ? 'Seu cadastro foi enviado para análise. Você receberá uma notificação quando for aprovado.'
          : 'Seu cadastro foi concluído com sucesso! Bem-vindo à 99.',
        [
          {
            text: 'OK',
            onPress: () => {
              // Navegar para a tela principal
              navigation.reset({
                index: 0,
                routes: [{ name: 'MainApp' }],
              });
            }
          }
        ]
      );
      
    } catch (error) {
      console.error('CompleteRegistrationScreen - Erro ao finalizar cadastro:', error);
      Alert.alert('Erro', 'Não foi possível finalizar o cadastro. Tente novamente.');
    } finally {
      setIsLoading(false);
    }
  };

  const getRegistrationInfo = () => {
    if (!userData) return null;
    
    if (userData.userType === 'passenger') {
      return {
        title: 'Cadastro Concluído!',
        subtitle: 'Bem-vindo à 99',
        icon: '🎉',
        message: 'Seu cadastro como passageiro foi concluído com sucesso. Agora você pode solicitar corridas e aproveitar todos os benefícios da plataforma.',
        nextSteps: [
          'Solicite sua primeira corrida',
          'Adicione métodos de pagamento',
          'Configure suas preferências',
          'Convide amigos e ganhe descontos'
        ]
      };
    } else {
      return {
        title: 'Cadastro Enviado!',
        subtitle: 'Aguardando Aprovação',
        icon: '📋',
        message: 'Seu cadastro como motorista parceiro foi enviado para análise. Nossa equipe irá revisar seus documentos e entrará em contato em breve.',
        nextSteps: [
          'Aguarde a análise dos documentos',
          'Você receberá uma notificação',
          'Após aprovação, poderá começar a dirigir',
          'Configure seu perfil e veículo'
        ]
      };
    }
  };

  const registrationInfo = getRegistrationInfo();

  if (!registrationInfo) {
    return (
      <View style={styles.container}>
        <View style={styles.loadingContainer}>
          <Text style={styles.loadingText}>Carregando...</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>{registrationInfo.title}</Text>
        <Text style={styles.subtitle}>{registrationInfo.subtitle}</Text>
      </View>

      <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.successContainer}>
          <View style={styles.iconContainer}>
            <Text style={styles.icon}>{registrationInfo.icon}</Text>
          </View>
          
          <Text style={styles.message}>{registrationInfo.message}</Text>
          
          <View style={styles.nextStepsContainer}>
            <Text style={styles.nextStepsTitle}>Próximos Passos:</Text>
            {registrationInfo.nextSteps.map((step, index) => (
              <View key={index} style={styles.stepItem}>
                <Text style={styles.stepNumber}>{index + 1}</Text>
                <Text style={styles.stepText}>{step}</Text>
              </View>
            ))}
          </View>
          
                     {userData?.userType === 'driver' && (
             <View style={styles.driverInfoContainer}>
               <Text style={styles.driverInfoTitle}>Documentos Enviados:</Text>
               <View style={styles.documentItem}>
                 <Text style={styles.documentIcon}>✅</Text>
                 <Text style={styles.documentText}>CNH - Carteira Nacional de Habilitação</Text>
               </View>
               <View style={styles.documentItem}>
                 <Text style={styles.documentIcon}>✅</Text>
                 <Text style={styles.documentText}>Dados Pessoais</Text>
               </View>
               <View style={styles.documentItem}>
                 <Text style={styles.documentIcon}>⏳</Text>
                 <Text style={styles.documentText}>CRLV - Será cadastrado dentro do app</Text>
               </View>
             </View>
           )}
        </View>
      </ScrollView>

      <View style={styles.footer}>
        <TouchableOpacity
          style={styles.completeButton}
          onPress={handleCompleteRegistration}
          disabled={isLoading}
        >
          <Text style={styles.completeButtonText}>
            {isLoading ? 'Finalizando...' : 'Finalizar Cadastro'}
          </Text>
        </TouchableOpacity>
        
        <TouchableOpacity
          style={styles.supportButton}
          onPress={() => Alert.alert('Suporte', 'Entre em contato conosco através do chat ou email: suporte@99.com')}
        >
          <Text style={styles.supportButtonText}>Preciso de Ajuda</Text>
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
    backgroundColor: LEAF_GREEN,
    padding: 30,
    alignItems: 'center',
  },
  
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    color: WHITE,
    textAlign: 'center',
    marginBottom: 5,
  },
  
  subtitle: {
    fontSize: 16,
    color: WHITE,
    opacity: 0.9,
    textAlign: 'center',
  },
  
  content: {
    flex: 1,
    padding: 20,
  },
  
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  
  loadingText: {
    fontSize: 16,
    color: GRAY,
  },
  
  successContainer: {
    alignItems: 'center',
    paddingVertical: 20,
  },
  
  iconContainer: {
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: '#E8F5E8',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 30,
  },
  
  icon: {
    fontSize: 50,
  },
  
  message: {
    fontSize: 16,
    color: GRAY,
    textAlign: 'center',
    lineHeight: 24,
    marginBottom: 30,
    paddingHorizontal: 20,
  },
  
  nextStepsContainer: {
    backgroundColor: LIGHT_GRAY,
    borderRadius: 15,
    padding: 20,
    width: '100%',
    marginBottom: 20,
  },
  
  nextStepsTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: DARK_GRAY,
    marginBottom: 15,
    textAlign: 'center',
  },
  
  stepItem: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  
  stepNumber: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: LEAF_GREEN,
    color: WHITE,
    fontSize: 12,
    fontWeight: 'bold',
    textAlign: 'center',
    lineHeight: 24,
    marginRight: 12,
  },
  
  stepText: {
    flex: 1,
    fontSize: 14,
    color: DARK_GRAY,
    lineHeight: 20,
  },
  
  driverInfoContainer: {
    backgroundColor: WHITE,
    borderWidth: 1,
    borderColor: LIGHT_GRAY,
    borderRadius: 15,
    padding: 20,
    width: '100%',
  },
  
  driverInfoTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: DARK_GRAY,
    marginBottom: 15,
    textAlign: 'center',
  },
  
  documentItem: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
  },
  
  documentIcon: {
    fontSize: 16,
    marginRight: 10,
  },
  
  documentText: {
    flex: 1,
    fontSize: 14,
    color: GRAY,
  },
  
  footer: {
    padding: 20,
    backgroundColor: WHITE,
    borderTopWidth: 1,
    borderTopColor: LIGHT_GRAY,
  },
  
  completeButton: {
    backgroundColor: LEAF_GREEN,
    paddingVertical: 15,
    borderRadius: 25,
    alignItems: 'center',
    marginBottom: 15,
  },
  
  completeButtonText: {
    fontSize: 18,
    fontWeight: 'bold',
    color: WHITE,
  },
  
  supportButton: {
    backgroundColor: WHITE,
    borderWidth: 1,
    borderColor: LEAF_GREEN,
    paddingVertical: 15,
    borderRadius: 25,
    alignItems: 'center',
  },
  
  supportButtonText: {
    fontSize: 16,
    fontWeight: 'bold',
    color: LEAF_GREEN,
  },
}); 