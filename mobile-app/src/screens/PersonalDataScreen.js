import React, { useState, useRef } from 'react';
import { 
  View, 
  Text, 
  StyleSheet, 
  TextInput, 
  TouchableOpacity, 
  Alert, 
  ActivityIndicator,
  ScrollView,
  Dimensions,
  Platform,
  Animated
} from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import AsyncStorage from '@react-native-async-storage/async-storage';
// import DateTimePicker from '@react-native-community/datetimepicker';

const { width, height } = Dimensions.get('window');

const LEAF_GREEN = '#1A330E';
const WHITE = '#FFFFFF';
const BLACK = '#000000';
const GRAY = '#666666';
const LIGHT_GRAY = '#F5F5F5';
const DARK_GRAY = '#333333';
const RED = '#FF0000';

export default function PersonalDataScreen() {
  const navigation = useNavigation();
  const route = useRoute();
  
  const [formData, setFormData] = useState({
    firstName: '',
    lastName: '',
    cpf: '',
    birthDate: null,
    email: '',
    password: '',
    confirmPassword: ''
  });
  
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  
  const { phone, userType, isNewUser } = route.params;

  // Animações
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const cardAnim = useRef(new Animated.Value(0)).current;

  React.useEffect(() => {
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

  // Função para formatar CPF
  const formatCPF = (text) => {
    const numbers = text.replace(/\D/g, '');
    if (numbers.length <= 3) {
      return numbers;
    } else if (numbers.length <= 6) {
      return `${numbers.slice(0, 3)}.${numbers.slice(3)}`;
    } else if (numbers.length <= 9) {
      return `${numbers.slice(0, 3)}.${numbers.slice(3, 6)}.${numbers.slice(6)}`;
    } else {
      return `${numbers.slice(0, 3)}.${numbers.slice(3, 6)}.${numbers.slice(6, 9)}-${numbers.slice(9, 11)}`;
    }
  };

  const handleInputChange = (field, value) => {
    if (field === 'cpf') {
      value = formatCPF(value);
    }
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  const handleDateChange = (event, selectedDate) => {
    setShowDatePicker(false);
    if (selectedDate) {
      setFormData(prev => ({ ...prev, birthDate: selectedDate }));
    }
  };

  const showDatePickerModal = () => {
    setShowDatePicker(true);
  };

  const formatDate = (date) => {
    if (!date) return '';
    return date.toLocaleDateString('pt-BR');
  };

  const validateForm = () => {
    const errors = [];

    if (!formData.firstName.trim()) errors.push('Nome é obrigatório');
    if (!formData.lastName.trim()) errors.push('Sobrenome é obrigatório');
    
    const cleanCPF = formData.cpf.replace(/\D/g, '');
    if (cleanCPF.length !== 11) errors.push('CPF deve ter 11 dígitos');
    
    if (!formData.birthDate) errors.push('Data de nascimento é obrigatória');
    
    if (!formData.email.trim()) {
      errors.push('Email é obrigatório');
    } else if (!/\S+@\S+\.\S+/.test(formData.email)) {
      errors.push('Email inválido');
    }
    
    if (formData.password.length < 6) {
      errors.push('Senha deve ter pelo menos 6 caracteres');
    }
    
    if (formData.password !== formData.confirmPassword) {
      errors.push('Senhas não coincidem');
    }

    return errors;
  };

  const handleSubmit = async () => {
    if (!formData.cpf.trim() || !formData.birthDate) {
      Alert.alert("Dados Obrigatórios", "Por favor, preencha CPF e data de nascimento.");
      return;
    }

    // Validar CPF (formato básico)
    const cleanCpf = formData.cpf.replace(/\D/g, '');
    if (cleanCpf.length !== 11) {
      Alert.alert("CPF Inválido", "Por favor, insira um CPF válido.");
      return;
    }

    setIsLoading(true);
    
    try {
      console.log("PersonalDataScreen - Dados:", { cpf: cleanCpf, birthDate: formData.birthDate, userType });
      
      // Buscar dados temporários
      const tempDataString = await AsyncStorage.getItem('@temp_user_data');
      const tempData = tempDataString ? JSON.parse(tempDataString) : {};
      
      // Combinar dados
      const userData = { 
        ...tempData,
        cpf: cleanCpf,
        birthDate: formData.birthDate.toISOString(),
        profileComplete: true
      };
      
      // Salvar dados completos
      await AsyncStorage.setItem('@user_data', JSON.stringify(userData));
      
      // Limpar dados temporários
      await AsyncStorage.removeItem('@temp_user_data');
      
      console.log("PersonalDataScreen - Usuário cadastrado:", userData);
      
      // Navegar para próxima tela
      if (userType === 'driver') {
        navigation.navigate('DriverTerms');
      } else {
        navigation.navigate('WelcomeScreen');
      }
      
    } catch (error) {
      console.error("PersonalDataScreen - Erro:", error);
      Alert.alert("Erro", "Não foi possível salvar os dados. Tente novamente.");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <View style={styles.container}>
      {/* Header - FORA DO BOTTOM SHEET */}
      <View style={styles.header}>
        {/* Círculo de progresso */}
        <View style={styles.progressContainer}>
          <View style={styles.progressCircle}>
            <Text style={styles.progressText}>3</Text>
          </View>
        </View>
        
        {/* Contagem de progresso */}
        <Text style={styles.progressCount}>Passo 3 de 4</Text>
        
        {/* Nome da tela */}
        <Text style={styles.screenTitle}>Dados pessoais</Text>
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
        <ScrollView 
          style={styles.formContainer}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.formContent}
        >
          {/* CPF */}
          <View style={styles.inputGroup}>
            <Text style={styles.label}>CPF *</Text>
            <TextInput
              style={styles.input}
              value={formData.cpf}
              onChangeText={(value) => handleInputChange('cpf', value)}
              placeholder="000.000.000-00"
              placeholderTextColor={GRAY}
              keyboardType="numeric"
              maxLength={14}
            />
          </View>

          {/* Data de Nascimento */}
          <View style={styles.inputGroup}>
            <Text style={styles.label}>Data de Nascimento *</Text>
            <TouchableOpacity 
              style={styles.dateInput}
              onPress={showDatePickerModal}
            >
              <Text style={[
                styles.dateText, 
                !formData.birthDate && styles.placeholderText
              ]}>
                {formData.birthDate ? formatDate(formData.birthDate) : 'Selecione a data'}
              </Text>
              <Text style={styles.calendarIcon}>📅</Text>
            </TouchableOpacity>
          </View>
        </ScrollView>

        {/* Botão Continuar */}
        <View style={styles.footer}>
          <TouchableOpacity 
            style={[
              styles.submitButton, 
              isLoading && styles.submitButtonDisabled
            ]}
            onPress={handleSubmit}
            disabled={isLoading}
          >
            {isLoading ? (
              <ActivityIndicator size="small" color={WHITE} />
            ) : (
              <Text style={styles.submitButtonText}>Continuar</Text>
            )}
          </TouchableOpacity>
        </View>
      </Animated.View>

      {/* Date Picker Modal */}
      {showDatePicker && (
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Selecione a data de nascimento</Text>
            <Text style={styles.modalSubtitle}>
              Esta informação é necessária para verificar sua idade
            </Text>
            <TouchableOpacity 
              style={styles.modalButton}
              onPress={() => setShowDatePicker(false)}
            >
              <Text style={styles.modalButtonText}>OK</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}
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
  },
  formContent: {
    paddingBottom: 24,
  },
  
  // Grupos de input
  inputGroup: {
    marginBottom: 20,
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
    color: LEAF_GREEN,
    marginBottom: 8,
  },
  input: {
    backgroundColor: WHITE,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    fontSize: 16,
    color: BLACK,
  },
  
  // Data de nascimento
  dateInput: {
    backgroundColor: WHITE,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  dateText: {
    fontSize: 16,
    color: BLACK,
  },
  placeholderText: {
    color: GRAY,
  },
  calendarIcon: {
    fontSize: 20,
  },
  
  // Senha
  passwordContainer: {
    backgroundColor: WHITE,
    borderRadius: 12,
    flexDirection: 'row',
    alignItems: 'center',
  },
  passwordInput: {
    flex: 1,
    paddingHorizontal: 16,
    paddingVertical: 12,
    fontSize: 16,
    color: BLACK,
  },
  eyeButton: {
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  eyeIcon: {
    fontSize: 20,
  },
  
  // Footer
  footer: {
    marginTop: 'auto',
  },
  submitButton: {
    backgroundColor: LEAF_GREEN,
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
  },
  submitButtonDisabled: {
    backgroundColor: '#C0C0C0',
  },
  submitButtonText: {
    fontSize: 16,
    fontWeight: 'bold',
    color: WHITE,
  },
  
  // Modal
  modalOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 1000,
  },
  modalContent: {
    backgroundColor: WHITE,
    borderRadius: 16,
    padding: 24,
    marginHorizontal: 32,
    alignItems: 'center',
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: BLACK,
    marginBottom: 8,
    textAlign: 'center',
  },
  modalSubtitle: {
    fontSize: 14,
    color: GRAY,
    marginBottom: 24,
    textAlign: 'center',
    lineHeight: 20,
  },
  modalButton: {
    backgroundColor: LEAF_GREEN,
    borderRadius: 12,
    paddingHorizontal: 32,
    paddingVertical: 12,
  },
  modalButtonText: {
    fontSize: 16,
    fontWeight: 'bold',
    color: WHITE,
  },
}); 