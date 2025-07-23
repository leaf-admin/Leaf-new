import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, SafeAreaView, ScrollView, Platform, Alert } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { colors } from '../common/theme';
import * as ImagePicker from 'expo-image-picker';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import OnboardingLayout from '../components/OnboardingLayout';
import { useDispatch, useSelector } from 'react-redux';
import { api } from 'common';
import { firebase } from 'common/src/config/configureFirebase';
import AsyncStorage from '@react-native-async-storage/async-storage';

const LEAF_GREEN = '#1A330E';
const LEAF_GRAY = '#B0B0B0';

const cities = [
  'São Paulo', 'Rio de Janeiro', 'Belo Horizonte', 'Brasília', 'Salvador', 'Curitiba', 'Porto Alegre', 'Recife', 'Fortaleza', 'Manaus'
];

export default function CompleteRegistrationScreen() {
  const navigation = useNavigation();
  const route = useRoute();
  const dispatch = useDispatch();
  const auth = useSelector(state => state.auth);
  const userType = route?.params?.userType || 'passenger';

  // Campos comuns
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [termsAccepted, setTermsAccepted] = useState(false);

  // Campos motorista
  const [cpf, setCpf] = useState('');
  const [birthDate, setBirthDate] = useState('');
  
  // Dados dos documentos (vêm das telas anteriores)
  const userData = route?.params?.userData || {};

  const [loading, setLoading] = useState(false);

  // Carregar dados do Google se disponíveis
  React.useEffect(() => {
    const loadGoogleData = async () => {
      try {
        const storedData = await AsyncStorage.getItem('@user_data');
        if (storedData) {
          const parsedData = JSON.parse(storedData);
          console.log('👤 Dados do Google carregados:', parsedData);
          
          // Preencher nome se disponível do Google
          if (parsedData.firstName && parsedData.lastName && !name) {
            const fullName = `${parsedData.firstName} ${parsedData.lastName}`.trim();
            setName(fullName);
            console.log('✅ Nome preenchido automaticamente:', fullName);
          }
          
          // Preencher email se disponível do Google
          if (parsedData.email && !email) {
            setEmail(parsedData.email);
            console.log('✅ Email preenchido automaticamente:', parsedData.email);
          }
        }
      } catch (error) {
        console.error('Erro ao carregar dados do Google:', error);
      }
    };

    loadGoogleData();
  }, []);

  // Função para converter URI da imagem para Blob
  const uriToBlob = async (uri) => {
    try {
      const response = await fetch(uri);
      const blob = await response.blob();
      return blob;
    } catch (error) {
      console.error('Erro ao converter URI para Blob:', error);
      throw new Error('Não foi possível processar a imagem');
    }
  };

  // Função para formatar CPF no padrão xxx.xxx.xxx-xx
  const formatCPF = (text) => {
    // Remove tudo que não é número
    const numbers = text.replace(/\D/g, '');
    
    // Aplica a máscara xxx.xxx.xxx-xx
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

  // Função para validar CPF
  const validateCPF = (cpf) => {
    // Remove caracteres não numéricos
    const numbers = cpf.replace(/\D/g, '');
    
    // Verifica se tem 11 dígitos
    if (numbers.length !== 11) {
      return false;
    }
    
    // Verifica se todos os dígitos são iguais
    if (/^(\d)\1{10}$/.test(numbers)) {
      return false;
    }
    
    // Validação do primeiro dígito verificador
    let sum = 0;
    for (let i = 0; i < 9; i++) {
      sum += parseInt(numbers[i]) * (10 - i);
    }
    let remainder = (sum * 10) % 11;
    if (remainder === 10 || remainder === 11) remainder = 0;
    if (remainder !== parseInt(numbers[9])) {
      return false;
    }
    
    // Validação do segundo dígito verificador
    sum = 0;
    for (let i = 0; i < 10; i++) {
      sum += parseInt(numbers[i]) * (11 - i);
    }
    remainder = (sum * 10) % 11;
    if (remainder === 10 || remainder === 11) remainder = 0;
    if (remainder !== parseInt(numbers[10])) {
      return false;
    }
    
    return true;
  };

  // Função para formatar data de nascimento no padrão DD/MM/AAAA
  const formatBirthDate = (text) => {
    // Remove tudo que não é número
    const numbers = text.replace(/\D/g, '');
    
    // Aplica a máscara DD/MM/AAAA
    if (numbers.length <= 2) {
      return numbers;
    } else if (numbers.length <= 4) {
      return `${numbers.slice(0, 2)}/${numbers.slice(2)}`;
    } else {
      return `${numbers.slice(0, 2)}/${numbers.slice(2, 4)}/${numbers.slice(4, 8)}`;
    }
  };

  // Função para validar data de nascimento e idade mínima de 18 anos
  const isValidBirthDate = (birthDate) => {
    // Verifica se está no formato DD/MM/AAAA
    const dateRegex = /^(\d{2})\/(\d{2})\/(\d{4})$/;
    const match = birthDate.match(dateRegex);
    
    if (!match) {
      return false;
    }
    
    const day = parseInt(match[1]);
    const month = parseInt(match[2]);
    const year = parseInt(match[3]);
    
    // Verifica se a data é válida
    const date = new Date(year, month - 1, day);
    if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
      return false;
    }
    
    // Verifica se não é uma data futura
    const today = new Date();
    if (date > today) {
      return false;
    }
    
    // Verifica se tem pelo menos 18 anos
    const age = today.getFullYear() - year;
    const monthDiff = today.getMonth() - (month - 1);
    const dayDiff = today.getDate() - day;
    
    if (age > 18) {
      return true;
    } else if (age === 18) {
      if (monthDiff > 0) {
        return true;
      } else if (monthDiff === 0 && dayDiff >= 0) {
        return true;
      }
    }
    
    return false;
  };

  const validate = () => {
    if (!name.trim()) return 'Preencha o nome completo';
    if (userType === 'driver') {
      if (!cpf.trim()) return 'Preencha o CPF';
      if (!validateCPF(cpf)) return 'CPF inválido. Verifique os números digitados.';
      if (!birthDate) return 'Informe a data de nascimento';
      if (birthDate && !isValidBirthDate(birthDate)) {
        Alert.alert(
          'Idade Insuficiente',
          'O cadastro de menores de 18 anos não é permitido.',
          [{ text: 'OK' }]
        );
        return 'Você deve ter pelo menos 18 anos para se cadastrar como motorista';
      }
    }
    if (!termsAccepted) return 'É necessário aceitar os termos e políticas';
    return null;
  };

  const handleSubmit = async () => {
    const error = validate();
    if (error) {
      // Se o erro for relacionado à idade, o alert já foi mostrado na validação
      if (!error.includes('18 anos')) {
        Alert.alert('Atenção', error);
      }
      return;
    }
    
    // Para motoristas, navegar para a tela de envio de documentos
    if (userType === 'driver') {
      const currentUserData = {
        ...userData,
        name: name.trim(),
        cpf: cpf.replace(/\D/g, ''),
        birthDate: birthDate,
        email: email.trim()
      };
      
      navigation.navigate('CNHUploadScreen', {
        userType: userType,
        userData: currentUserData
      });
      return;
    }
    
    // Para passageiros, continuar com o cadastro normal
    setLoading(true);
    
    try {
      console.log('=== INICIANDO CADASTRO DE PASSAGEIRO ===');
      console.log('Tipo de usuário:', userType);
      console.log('Dados do usuário:', userData);
      
      // Obter UID diretamente do Firebase Auth (não do Redux)
      const { auth } = firebase;
      const currentUser = auth?.currentUser;
      
      if (!currentUser || !currentUser.uid) {
        throw new Error('Usuário não está autenticado no Firebase Auth. Faça login novamente.');
      }
      
      const uid = currentUser.uid;
      const mobile = currentUser.phoneNumber || userData.phone || '';
      console.log('UID do usuário autenticado:', uid);
      console.log('Telefone do usuário:', mobile);
      
      // Criar usuário passageiro
      console.log('Criando usuário passageiro...');
      
      const userDataForDB = {
        name: name.trim(),
        mobile: mobile,
        usertype: 'customer',
        createdAt: new Date().getTime()
      };
      
      const signUpResult = await api.mainSignUp(userDataForDB);
      
      if (signUpResult.success) {
        console.log('Passageiro criado com sucesso');
        navigation.replace('Map');
      } else {
        throw new Error(signUpResult.message || 'Erro ao criar passageiro');
      }
      
    } catch (error) {
      console.error('=== ERRO DURANTE O CADASTRO ===');
      console.error('Erro completo:', error);
      console.error('Mensagem:', error.message);
      
      Alert.alert(
        'Erro no Cadastro',
        error.message || 'Ocorreu um erro durante o cadastro. Tente novamente.',
        [{ text: 'OK' }]
      );
    } finally {
      setLoading(false);
    }
  };

  // Barra de progresso customizada
  const progressBar = (
    <View style={styles.progressBarContainer}>
      <View style={styles.progressDot} />
      <View style={styles.progressDot} />
      <View style={styles.progressDot} />
      <View style={[styles.progressDot, styles.progressActive]} />
      <View style={styles.progressDot} />
    </View>
  );

  const isFormValid = name.trim() && termsAccepted && 
    (userType === 'passenger' || (cpf.trim() && validateCPF(cpf) && birthDate && isValidBirthDate(birthDate)));

  return (
    <OnboardingLayout
      progress={progressBar}
      onContinue={handleSubmit}
      continueLabel={loading ? "Processando..." : "Enviar documentos"}
      continueDisabled={!isFormValid || loading}
    >
      <View style={styles.container}>
        <Text style={styles.title}>
          {userType === 'driver' ? 'Complete seu cadastro de Parceiro' : 'Complete seu cadastro de Passageiro'}
        </Text>
        <Text style={styles.subtitle}>
          Preencha os dados abaixo para finalizar seu cadastro
        </Text>
        
        <ScrollView style={styles.scrollView} showsVerticalScrollIndicator={false}>
          <View style={styles.form}>
            <View style={styles.inputGroup}>
              <Text style={styles.label}>Nome completo *</Text>
              <TextInput
                style={styles.input}
                value={name}
                onChangeText={setName}
                placeholder="Seu nome completo"
                placeholderTextColor={LEAF_GRAY}
                autoCapitalize="words"
              />
            </View>

            {userType === 'passenger' && (
              <View style={styles.inputGroup}>
                <Text style={styles.label}>E-mail (opcional)</Text>
                <TextInput
                  style={styles.input}
                  value={email}
                  onChangeText={setEmail}
                  placeholder="Seu e-mail"
                  placeholderTextColor={LEAF_GRAY}
                  keyboardType="email-address"
                  autoCapitalize="none"
                />
              </View>
            )}

            {userType === 'driver' && (
              <>
                <View style={styles.inputGroup}>
                  <Text style={styles.label}>CPF *</Text>
                  <TextInput
                    style={[
                      styles.input,
                      cpf.trim() && !validateCPF(cpf) && styles.inputError
                    ]}
                    value={cpf}
                    onChangeText={(text) => setCpf(formatCPF(text))}
                    placeholder="000.000.000-00"
                    placeholderTextColor={LEAF_GRAY}
                    keyboardType="numeric"
                    maxLength={14}
                  />
                  {cpf.trim() && !validateCPF(cpf) && (
                    <Text style={styles.errorText}>CPF inválido</Text>
                  )}
                </View>

                <View style={styles.inputGroup}>
                  <Text style={styles.label}>Data de nascimento *</Text>
                  <TextInput
                    style={[
                      styles.input,
                      birthDate.length === 10 && !isValidBirthDate(birthDate) && styles.inputError
                    ]}
                    value={birthDate}
                    onChangeText={(text) => setBirthDate(formatBirthDate(text))}
                    placeholder="DD/MM/AAAA"
                    placeholderTextColor={LEAF_GRAY}
                    keyboardType="numeric"
                    maxLength={10}
                  />
                  {birthDate.length === 10 && !isValidBirthDate(birthDate) && (
                    <Text style={styles.errorText}>
                      {birthDate.match(/^\d{2}\/\d{2}\/\d{4}$/) ? 
                        'Você deve ter pelo menos 18 anos para se cadastrar como motorista' : 
                        'Data de nascimento inválida'
                      }
                    </Text>
                  )}
                </View>
              </>
            )}

            <View style={styles.termsSection}>
              <TouchableOpacity
                style={styles.termsCheckbox}
                onPress={() => setTermsAccepted(!termsAccepted)}
              >
                <View style={[styles.checkbox, termsAccepted && styles.checkboxChecked]}>
                  {termsAccepted && (
                    <MaterialCommunityIcons name="check" size={16} color="white" />
                  )}
                </View>
                <Text style={styles.termsText}>
                  Aceito os{' '}
                  <Text style={styles.termsLink}>Termos de Uso</Text>
                  {' '}e{' '}
                  <Text style={styles.termsLink}>Política de Privacidade</Text>
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </ScrollView>
      </View>
    </OnboardingLayout>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: 'white',
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    color: LEAF_GREEN,
    textAlign: 'center',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 16,
    color: LEAF_GRAY,
    textAlign: 'center',
    marginBottom: 32,
  },
  scrollView: {
    flex: 1,
  },
  form: {
    paddingHorizontal: 24,
  },
  inputGroup: {
    marginBottom: 24,
  },
  label: {
    fontSize: 16,
    fontWeight: '600',
    color: LEAF_GREEN,
    marginBottom: 8,
  },
  input: {
    borderWidth: 1,
    borderColor: '#E0E0E0',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 16,
    backgroundColor: '#FAFAFA',
  },
  inputError: {
    borderColor: '#FF6B35',
  },
  errorText: {
    color: '#FF6B35',
    fontSize: 14,
    marginTop: 4,
  },
  termsSection: {
    marginTop: 24,
    marginBottom: 32,
  },
  termsCheckbox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  checkbox: {
    width: 20,
    height: 20,
    borderWidth: 2,
    borderColor: LEAF_GRAY,
    borderRadius: 4,
    marginRight: 12,
    marginTop: 2,
    justifyContent: 'center',
    alignItems: 'center',
  },
  checkboxChecked: {
    backgroundColor: LEAF_GREEN,
    borderColor: LEAF_GREEN,
  },
  termsText: {
    fontSize: 14,
    color: LEAF_GRAY,
    flex: 1,
    lineHeight: 20,
  },
  termsLink: {
    color: LEAF_GREEN,
    fontWeight: '600',
  },
  progressBarContainer: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 32,
  },
  progressDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#E0E0E0',
    marginHorizontal: 4,
  },
  progressActive: {
    backgroundColor: LEAF_GREEN,
  },
}); 