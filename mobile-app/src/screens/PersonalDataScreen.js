import React, { useState } from 'react';
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
  Platform
} from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import DateTimePicker from '@react-native-community/datetimepicker';

const { width } = Dimensions.get('window');

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
    const errors = validateForm();
    
    if (errors.length > 0) {
      Alert.alert('Erro de Validação', errors.join('\n'));
      return;
    }

    setIsLoading(true);
    
    try {
      console.log("PersonalDataScreen - Salvando dados pessoais");
      
      // Simular salvamento na API
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      // Salvar dados temporariamente
      const userData = {
        phone,
        userType,
        ...formData,
        birthDate: formData.birthDate.toISOString(),
        createdAt: new Date().toISOString()
      };
      
      await AsyncStorage.setItem('@temp_user_data', JSON.stringify(userData));
      
      console.log("PersonalDataScreen - Dados salvos, navegando para próximo passo");
      
      if (userType === 'driver') {
        // Para motoristas, ir para termos de serviço
        navigation.navigate('DriverTerms', { userData });
      } else {
        // Para passageiros, ir direto para o app
        navigation.navigate('CompleteRegistration', { userData });
      }
      
    } catch (error) {
      console.error("PersonalDataScreen - Erro ao salvar dados:", error);
      Alert.alert("Erro", "Não foi possível salvar os dados. Tente novamente.");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <ScrollView style={styles.container} showsVerticalScrollIndicator={false}>
      <View style={styles.header}>
        <Text style={styles.title}>Dados Pessoais</Text>
        <Text style={styles.subtitle}>Complete seu cadastro</Text>
      </View>

      <View style={styles.form}>
        {/* Nome */}
        <View style={styles.inputGroup}>
          <Text style={styles.label}>Nome *</Text>
          <TextInput
            style={styles.input}
            value={formData.firstName}
            onChangeText={(value) => handleInputChange('firstName', value)}
            placeholder="Digite seu nome"
            placeholderTextColor={GRAY}
            autoCapitalize="words"
          />
        </View>

        {/* Sobrenome */}
        <View style={styles.inputGroup}>
          <Text style={styles.label}>Sobrenome *</Text>
          <TextInput
            style={styles.input}
            value={formData.lastName}
            onChangeText={(value) => handleInputChange('lastName', value)}
            placeholder="Digite seu sobrenome"
            placeholderTextColor={GRAY}
            autoCapitalize="words"
          />
        </View>

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

        {/* Email */}
        <View style={styles.inputGroup}>
          <Text style={styles.label}>Email *</Text>
          <TextInput
            style={styles.input}
            value={formData.email}
            onChangeText={(value) => handleInputChange('email', value)}
            placeholder="seu@email.com"
            placeholderTextColor={GRAY}
            keyboardType="email-address"
            autoCapitalize="none"
          />
        </View>

        {/* Senha */}
        <View style={styles.inputGroup}>
          <Text style={styles.label}>Senha *</Text>
          <View style={styles.passwordContainer}>
            <TextInput
              style={styles.passwordInput}
              value={formData.password}
              onChangeText={(value) => handleInputChange('password', value)}
              placeholder="Mínimo 6 caracteres"
              placeholderTextColor={GRAY}
              secureTextEntry={!showPassword}
              autoCapitalize="none"
            />
            <TouchableOpacity 
              style={styles.eyeButton}
              onPress={() => setShowPassword(!showPassword)}
            >
              <Text style={styles.eyeIcon}>{showPassword ? '👁️' : '👁️‍🗨️'}</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Confirmar Senha */}
        <View style={styles.inputGroup}>
          <Text style={styles.label}>Confirmar Senha *</Text>
          <View style={styles.passwordContainer}>
            <TextInput
              style={styles.passwordInput}
              value={formData.confirmPassword}
              onChangeText={(value) => handleInputChange('confirmPassword', value)}
              placeholder="Digite a senha novamente"
              placeholderTextColor={GRAY}
              secureTextEntry={!showConfirmPassword}
              autoCapitalize="none"
            />
            <TouchableOpacity 
              style={styles.eyeButton}
              onPress={() => setShowConfirmPassword(!showConfirmPassword)}
            >
              <Text style={styles.eyeIcon}>{showConfirmPassword ? '👁️' : '👁️‍🗨️'}</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Botão Continuar */}
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

      {/* Date Picker Modal */}
      {showDatePicker && (
        <DateTimePicker
          value={formData.birthDate || new Date()}
          mode="date"
          display="default"
          onChange={handleDateChange}
          maximumDate={new Date()}
          minimumDate={new Date(1900, 0, 1)}
        />
      )}
    </ScrollView>
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
  
  form: {
    padding: 30,
  },
  
  inputGroup: {
    marginBottom: 25,
  },
  
  label: {
    fontSize: 16,
    fontWeight: 'bold',
    color: BLACK,
    marginBottom: 8,
  },
  
  input: {
    borderWidth: 1,
    borderColor: LIGHT_GRAY,
    borderRadius: 8,
    paddingHorizontal: 15,
    paddingVertical: 12,
    fontSize: 16,
    color: BLACK,
    backgroundColor: WHITE,
  },
  
  dateInput: {
    borderWidth: 1,
    borderColor: LIGHT_GRAY,
    borderRadius: 8,
    paddingHorizontal: 15,
    paddingVertical: 12,
    backgroundColor: WHITE,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
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
  
  passwordContainer: {
    flexDirection: 'row',
    borderWidth: 1,
    borderColor: LIGHT_GRAY,
    borderRadius: 8,
    backgroundColor: WHITE,
    alignItems: 'center',
  },
  
  passwordInput: {
    flex: 1,
    paddingHorizontal: 15,
    paddingVertical: 12,
    fontSize: 16,
    color: BLACK,
  },
  
  eyeButton: {
    paddingHorizontal: 15,
    paddingVertical: 12,
  },
  
  eyeIcon: {
    fontSize: 20,
  },
  
  submitButton: {
    backgroundColor: LEAF_GREEN,
    paddingVertical: 15,
    borderRadius: 25,
    alignItems: 'center',
    marginTop: 20,
  },
  
  submitButtonDisabled: {
    backgroundColor: LIGHT_GRAY,
  },
  
  submitButtonText: {
    fontSize: 18,
    fontWeight: 'bold',
    color: WHITE,
  },
}); 