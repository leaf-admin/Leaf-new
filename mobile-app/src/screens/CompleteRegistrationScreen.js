import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, SafeAreaView, ScrollView, Platform, Alert } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { colors } from '../common/theme';
import * as ImagePicker from 'expo-image-picker';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import OnboardingLayout from '../components/OnboardingLayout';

const LEAF_GREEN = '#1A330E';
const LEAF_GRAY = '#B0B0B0';

const cities = [
  'São Paulo', 'Rio de Janeiro', 'Belo Horizonte', 'Brasília', 'Salvador', 'Curitiba', 'Porto Alegre', 'Recife', 'Fortaleza', 'Manaus'
];

export default function CompleteRegistrationScreen() {
  const navigation = useNavigation();
  const route = useRoute();
  const userType = route?.params?.userType || 'passenger';

  // Campos comuns
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [termsAccepted, setTermsAccepted] = useState(false);

  // Campos motorista
  const [cpf, setCpf] = useState('');
  const [city, setCity] = useState('');
  const [pix, setPix] = useState('');
  
  // Dados dos documentos (vêm das telas anteriores)
  const userData = route?.params?.userData || {};

  const [loading, setLoading] = useState(false);

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



  const validate = () => {
    if (!name.trim()) return 'Preencha o nome completo';
    if (userType === 'driver') {
      if (!cpf.trim()) return 'Preencha o CPF';
      if (!validateCPF(cpf)) return 'CPF inválido. Verifique os números digitados.';
      if (!userData.cnhImage) return 'Envie a foto da CNH';
      if (!userData.crlvImage) return 'Envie a foto do CRLV';
      if (!city) return 'Selecione a cidade de atuação';
      if (!pix.trim()) return 'Informe a conta bancária ou chave Pix';
    }
    if (!termsAccepted) return 'É necessário aceitar os termos e políticas';
    return null;
  };

  const handleSubmit = () => {
    const error = validate();
    if (error) {
      Alert.alert('Atenção', error);
      return;
    }
    setLoading(true);
    // Aqui você pode enviar os dados para o backend
    setTimeout(() => {
      setLoading(false);
      if (userType === 'driver') {
        Alert.alert('Cadastro enviado', 'Aguarde a aprovação da sua conta.');
      } else {
        Alert.alert('Cadastro concluído', 'Bem-vindo à Leaf!');
      }
      navigation.reset({ index: 0, routes: [{ name: 'WelcomeScreen' }] });
    }, 1200);
  };

  // Barra de progresso customizada
  const progressBar = (
    <View style={styles.progressBarContainer}>
      <View style={styles.progressDot} />
      <View style={styles.progressDot} />
      <View style={styles.progressDot} />
      <View style={[styles.progressDot, styles.progressActive]} />
    </View>
  );

  const isFormValid = name.trim() && termsAccepted && 
    (userType === 'passenger' || (cpf.trim() && validateCPF(cpf) && userData.cnhImage && userData.crlvImage && city && pix.trim()));

  return (
    <OnboardingLayout
      progress={progressBar}
      onContinue={handleSubmit}
      continueLabel={loading ? "Processando..." : "Finalizar cadastro"}
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

                {/* Status dos documentos */}
                <View style={styles.documentsContainer}>
                  <Text style={styles.documentsTitle}>📄 Documentos obrigatórios:</Text>
                  
                  <TouchableOpacity 
                    style={styles.documentItem}
                    onPress={() => navigation.navigate('CNHUploadScreen', { userType, userData })}
                  >
                    <MaterialCommunityIcons 
                      name={userData.cnhImage ? "check-circle" : "camera"} 
                      size={24} 
                      color={userData.cnhImage ? "#4CAF50" : LEAF_GREEN} 
                    />
                    <Text style={[
                      styles.documentText,
                      { color: userData.cnhImage ? "#4CAF50" : LEAF_GREEN }
                    ]}>
                      CNH {userData.cnhImage ? "✓ Enviada" : "📷 Enviar foto"}
                    </Text>
                  </TouchableOpacity>

                  <TouchableOpacity 
                    style={styles.documentItem}
                    onPress={() => navigation.navigate('CRLVUploadScreen', { userType, userData })}
                  >
                    <MaterialCommunityIcons 
                      name={userData.crlvImage ? "check-circle" : "camera"} 
                      size={24} 
                      color={userData.crlvImage ? "#4CAF50" : LEAF_GREEN} 
                    />
                    <Text style={[
                      styles.documentText,
                      { color: userData.crlvImage ? "#4CAF50" : LEAF_GREEN }
                    ]}>
                      CRLV {userData.crlvImage ? "✓ Enviado" : "📷 Enviar foto"}
                    </Text>
                  </TouchableOpacity>
                </View>

                <View style={styles.inputGroup}>
                  <Text style={styles.label}>Cidade de atuação *</Text>
                  <TextInput
                    style={styles.input}
                    value={city}
                    onChangeText={setCity}
                    placeholder="Selecione sua cidade"
                    placeholderTextColor={LEAF_GRAY}
                  />
                </View>

                <View style={styles.inputGroup}>
                  <Text style={styles.label}>Conta bancária ou chave Pix *</Text>
                  <TextInput
                    style={styles.input}
                    value={pix}
                    onChangeText={setPix}
                    placeholder="Chave Pix ou dados bancários"
                    placeholderTextColor={LEAF_GRAY}
                    autoCapitalize="none"
                  />
                </View>
              </>
            )}

            <View style={styles.termsContainer}>
              <TouchableOpacity style={styles.termsRow} onPress={() => setTermsAccepted(!termsAccepted)}>
                <MaterialCommunityIcons
                  name={termsAccepted ? 'checkbox-marked' : 'checkbox-blank-outline'}
                  size={24}
                  color={LEAF_GREEN}
                />
                <Text style={styles.termsText}>
                  Aceito os <Text style={styles.termsLink}>termos e políticas</Text> de privacidade
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
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingTop: 48,
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    color: LEAF_GREEN,
    marginBottom: 8,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 16,
    color: LEAF_GRAY,
    marginBottom: 32,
    textAlign: 'center',
    lineHeight: 22,
  },
  scrollView: {
    flex: 1,
    width: '100%',
  },
  form: {
    width: '100%',
  },
  inputGroup: {
    marginBottom: 20,
  },
  label: {
    fontSize: 16,
    fontWeight: '600',
    color: LEAF_GREEN,
    marginBottom: 8,
  },
  input: {
    fontSize: 16,
    color: LEAF_GREEN,
    borderBottomWidth: 2,
    borderBottomColor: LEAF_GRAY,
    paddingVertical: 12,
    paddingHorizontal: 0,
  },
  inputError: {
    borderBottomColor: '#FF4444',
  },
  errorText: {
    fontSize: 12,
    color: '#FF4444',
    marginTop: 4,
  },
  documentsContainer: {
    width: '100%',
    backgroundColor: '#F8F8F8',
    borderRadius: 12,
    padding: 16,
    marginBottom: 20,
  },
  documentsTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: LEAF_GREEN,
    marginBottom: 12,
  },
  documentItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 8,
    borderRadius: 8,
    marginBottom: 8,
    backgroundColor: 'white',
  },
  documentText: {
    fontSize: 16,
    fontWeight: '500',
    marginLeft: 12,
  },
  uploadBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: 2,
    borderBottomColor: LEAF_GRAY,
    paddingVertical: 12,
    paddingHorizontal: 0,
  },
  uploadText: {
    fontSize: 16,
    color: LEAF_GREEN,
    marginLeft: 8,
  },
  termsContainer: {
    marginTop: 24,
    marginBottom: 32,
  },
  termsRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  termsText: {
    fontSize: 14,
    color: LEAF_GRAY,
    marginLeft: 8,
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
    marginBottom: 0,
  },
  progressDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: LEAF_GRAY,
    marginHorizontal: 4,
  },
  progressActive: {
    backgroundColor: LEAF_GREEN,
  },
}); 