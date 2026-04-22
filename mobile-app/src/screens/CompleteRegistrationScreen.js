import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, ScrollView, Alert } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { fonts } from '../theme/runtimeTokens';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import OnboardingLayout from '../components/OnboardingLayout';
import onboardingTheme from '../components/auth/common/onboardingTheme';

const { color, radius, spacing, elevation } = onboardingTheme;

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
                placeholderTextColor={color.textMuted}
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
                  placeholderTextColor={color.textMuted}
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
                    placeholderTextColor={color.textMuted}
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
                      color={userData.cnhImage ? "#4CAF50" : color.textPrimary} 
                    />
                    <Text style={[
                      styles.documentText,
                      { color: userData.cnhImage ? "#4CAF50" : color.textPrimary }
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
                      color={userData.crlvImage ? "#4CAF50" : color.textPrimary} 
                    />
                    <Text style={[
                      styles.documentText,
                      { color: userData.crlvImage ? "#4CAF50" : color.textPrimary }
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
                  placeholderTextColor={color.textMuted}
                />
              </View>

                <View style={styles.inputGroup}>
                  <Text style={styles.label}>Conta bancária ou chave Pix *</Text>
                  <TextInput
                    style={styles.input}
                  value={pix}
                  onChangeText={setPix}
                  placeholder="Chave Pix ou dados bancários"
                  placeholderTextColor={color.textMuted}
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
                  color={color.textPrimary}
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
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.md
  },
  title: {
    fontSize: 24,
    fontFamily: fonts.Bold,
    color: color.textPrimary,
    marginBottom: 8,
    textAlign: 'center'
  },
  subtitle: {
    fontSize: 16,
    color: color.textSecondary,
    marginBottom: spacing.md,
    textAlign: 'center',
    lineHeight: 22
  },
  scrollView: {
    flex: 1,
    width: '100%'
  },
  form: {
    width: '100%',
    backgroundColor: color.panel,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: color.borderStrong,
    padding: spacing.md,
    shadowColor: '#0E1522',
    ...elevation.soft
  },
  inputGroup: {
    marginBottom: spacing.md
  },
  label: {
    fontSize: 16,
    fontFamily: fonts.SemiBold,
    color: color.textPrimary,
    marginBottom: 8
  },
  input: {
    fontSize: 16,
    color: color.textPrimary,
    borderWidth: 1,
    borderColor: color.border,
    borderRadius: radius.md,
    paddingVertical: 12,
    paddingHorizontal: 14,
    backgroundColor: color.surfaceMuted
  },
  inputError: {
    borderColor: color.error
  },
  errorText: {
    fontSize: 12,
    color: color.error,
    marginTop: 4
  },
  documentsContainer: {
    width: '100%',
    backgroundColor: color.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: color.border,
    padding: 16,
    marginBottom: spacing.md
  },
  documentsTitle: {
    fontSize: 16,
    fontFamily: fonts.SemiBold,
    color: color.textPrimary,
    marginBottom: 12
  },
  documentItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 8,
    borderRadius: 8,
    marginBottom: 8,
    backgroundColor: color.panelSoft
  },
  documentText: {
    fontSize: 16,
    fontFamily: fonts.Medium,
    marginLeft: 12
  },
  uploadBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: color.border,
    borderRadius: radius.md,
    backgroundColor: color.surfaceMuted,
    paddingVertical: 12,
    paddingHorizontal: 12
  },
  uploadText: {
    fontSize: 16,
    color: color.textPrimary,
    marginLeft: 8
  },
  termsContainer: {
    marginTop: 24,
    marginBottom: 8
  },
  termsRow: {
    flexDirection: 'row',
    alignItems: 'flex-start'
  },
  termsText: {
    fontSize: 14,
    color: color.textSecondary,
    marginLeft: 8,
    flex: 1,
    lineHeight: 20
  },
  termsLink: {
    color: color.textPrimary,
    fontFamily: fonts.SemiBold
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
    backgroundColor: color.borderStrong,
    marginHorizontal: 4
  },
  progressActive: {
    backgroundColor: color.accent
  }
});
