import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, SafeAreaView, ScrollView, Platform, Alert } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { colors } from '../common/theme';
import * as ImagePicker from 'expo-image-picker';
import { MaterialCommunityIcons } from '@expo/vector-icons';

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
  const [cnh, setCnh] = useState(null); // imagem
  const [crlv, setCrlv] = useState(null); // imagem
  const [city, setCity] = useState('');
  const [pix, setPix] = useState('');

  const [loading, setLoading] = useState(false);

  const pickImage = async (setter) => {
    let result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [4, 3],
      quality: 0.7,
    });
    if (!result.canceled && result.assets && result.assets.length > 0) {
      setter(result.assets[0]);
    }
  };

  const validate = () => {
    if (!name.trim()) return 'Preencha o nome completo';
    if (userType === 'driver') {
      if (!cpf.trim()) return 'Preencha o CPF';
      if (!cnh) return 'Envie a foto da CNH';
      if (!crlv) return 'Envie a foto do CRLV';
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
      navigation.reset({ index: 0, routes: [{ name: 'Welcome' }] });
    }, 1200);
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.container}>
        <Text style={styles.title}>Complete seu cadastro</Text>
        <Text style={styles.subtitle}>Preencha os dados abaixo para finalizar</Text>
        <View style={styles.form}>
          <Text style={styles.label}>Nome completo *</Text>
          <TextInput
            style={styles.input}
            value={name}
            onChangeText={setName}
            placeholder="Seu nome completo"
            placeholderTextColor={colors.PLACEHOLDER_COLOR}
          />
          {userType === 'passenger' && (
            <>
              <Text style={styles.label}>E-mail (opcional)</Text>
              <TextInput
                style={styles.input}
                value={email}
                onChangeText={setEmail}
                placeholder="Seu e-mail"
                placeholderTextColor={colors.PLACEHOLDER_COLOR}
                keyboardType="email-address"
                autoCapitalize="none"
              />
            </>
          )}
          {userType === 'driver' && (
            <>
              <Text style={styles.label}>CPF *</Text>
              <TextInput
                style={styles.input}
                value={cpf}
                onChangeText={setCpf}
                placeholder="Seu CPF"
                placeholderTextColor={colors.PLACEHOLDER_COLOR}
                keyboardType="numeric"
                maxLength={14}
              />
              <Text style={styles.label}>CNH (foto) *</Text>
              <TouchableOpacity style={styles.uploadBtn} onPress={() => pickImage(setCnh)}>
                <MaterialCommunityIcons name="camera" size={22} color={colors.BIDTAXIPRIMARY} />
                <Text style={styles.uploadText}>{cnh ? 'Foto enviada' : 'Enviar foto da CNH'}</Text>
              </TouchableOpacity>
              <Text style={styles.label}>CRLV (foto) *</Text>
              <TouchableOpacity style={styles.uploadBtn} onPress={() => pickImage(setCrlv)}>
                <MaterialCommunityIcons name="camera" size={22} color={colors.BIDTAXIPRIMARY} />
                <Text style={styles.uploadText}>{crlv ? 'Foto enviada' : 'Enviar foto do CRLV'}</Text>
              </TouchableOpacity>
              <Text style={styles.label}>Cidade de atuação *</Text>
              <View style={styles.pickerWrapper}>
                <TextInput
                  style={styles.input}
                  value={city}
                  onChangeText={setCity}
                  placeholder="Cidade"
                  placeholderTextColor={colors.PLACEHOLDER_COLOR}
                />
              </View>
              <Text style={styles.label}>Conta bancária ou chave Pix *</Text>
              <TextInput
                style={styles.input}
                value={pix}
                onChangeText={setPix}
                placeholder="Conta bancária ou Pix"
                placeholderTextColor={colors.PLACEHOLDER_COLOR}
                autoCapitalize="none"
              />
            </>
          )}
          <TouchableOpacity style={styles.termsRow} onPress={() => setTermsAccepted(!termsAccepted)}>
            <MaterialCommunityIcons
              name={termsAccepted ? 'checkbox-marked' : 'checkbox-blank-outline'}
              size={24}
              color={colors.BIDTAXIPRIMARY}
            />
            <Text style={styles.termsText}>Aceito os termos e políticas de privacidade</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.submitBtn, loading && { opacity: 0.7 }]}
            onPress={handleSubmit}
            disabled={loading}
          >
            <Text style={styles.submitText}>
              {userType === 'driver' ? 'Finalizar cadastro e aguardar aprovação' : 'Finalizar cadastro'}
            </Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.BACKGROUND_PRIMARY,
  },
  container: {
    flexGrow: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
    backgroundColor: colors.BACKGROUND_PRIMARY,
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    color: colors.BIDTAXIPRIMARY,
    marginBottom: 8,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 16,
    color: colors.GREY,
    marginBottom: 24,
    textAlign: 'center',
  },
  form: {
    width: '100%',
    marginTop: 8,
  },
  label: {
    fontSize: 15,
    color: colors.BIDTAXIPRIMARY,
    marginBottom: 4,
    marginTop: 16,
    fontWeight: 'bold',
  },
  input: {
    borderWidth: 1.5,
    borderColor: colors.BORDER_BACKGROUND,
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
    backgroundColor: colors.WHITE,
    color: colors.BLACK,
  },
  uploadBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#f0f7f5',
    borderRadius: 8,
    padding: 12,
    marginTop: 4,
    marginBottom: 4,
  },
  uploadText: {
    marginLeft: 8,
    color: colors.BIDTAXIPRIMARY,
    fontWeight: 'bold',
  },
  pickerWrapper: {
    borderRadius: 8,
    marginBottom: 4,
  },
  termsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 24,
    marginBottom: 16,
  },
  termsText: {
    marginLeft: 8,
    color: colors.BIDTAXIPRIMARY,
    fontSize: 15,
  },
  submitBtn: {
    backgroundColor: colors.BIDTAXIPRIMARY,
    borderRadius: 8,
    paddingVertical: 16,
    alignItems: 'center',
    marginTop: 8,
  },
  submitText: {
    color: colors.WHITE,
    fontSize: 18,
    fontWeight: 'bold',
  },
}); 