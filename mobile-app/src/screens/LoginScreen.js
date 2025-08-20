import React, { useState, useRef, useEffect } from "react";
import {
    StyleSheet,
    View,
    ImageBackground,
    Text,
    Dimensions,
    Alert,
    TextInput,
    Image,
    Platform,
    Linking,
    Keyboard,
    ScrollView,
    StatusBar,
    Animated,
    Easing
} from "react-native";
import MaterialButtonDark from "../components/MaterialButtonDark";
import { TouchableOpacity } from "react-native-gesture-handler";
import AsyncStorage from '@react-native-async-storage/async-storage';
import { api } from '../common-local';
import { colors } from '../common-local/theme';
import RNPickerSelect from '../components/RNPickerSelect';
import * as AppleAuthentication from 'expo-apple-authentication';
import * as Crypto from "expo-crypto";
import i18n from 'i18n-js';
import { Feather, Ionicons, FontAwesome5 } from '@expo/vector-icons';
import moment from 'moment/min/moment-with-locales';
import rnauth from '@react-native-firebase/auth';
import { GoogleSignin } from '@react-native-google-signin/google-signin';
// import { TextInputMask } from 'react-native-masked-text'; // Removido - dependência não existe
import { useSelector, useDispatch } from 'react-redux';
import { checkUserExists } from '../common-local/actions/authactions';
import { useAuth } from '../hooks/useAuth';
var { width,height } = Dimensions.get('window');
import ClientIds from '../../config/ClientIds';
import { MAIN_COLOR } from "../common-local/sharedFunctions";
import { Button } from "../components";
import { fonts } from "../common-local/font";
import auth from '@react-native-firebase/auth';
import { ActivityIndicator } from 'react-native';

GoogleSignin.configure(ClientIds);

const errorMessages = {
    'auth/invalid-email': 'E-mail inválido. Verifique e tente novamente.',
    'auth/user-not-found': 'Usuário não encontrado. Verifique o número ou cadastre-se.',
    'auth/wrong-password': 'Senha incorreta. Tente novamente.',
    'auth/too-many-requests': 'Muitas tentativas. Aguarde alguns minutos e tente novamente.',
    'auth/network-request-failed': 'Sem conexão. Verifique sua internet.',
    'auth/invalid-verification-code': 'Código de verificação inválido.',
    'auth/invalid-phone-number': 'Número de telefone inválido.',
    'auth/user-disabled': 'Usuário desativado. Contate o suporte.',
    'default': 'Ocorreu um erro. Tente novamente.'
};

function getFriendlyErrorMessage(error) {
    if (!error) return errorMessages['default'];
    if (typeof error === 'string' && errorMessages[error]) return errorMessages[error];
    if (typeof error === 'object' && error.code && errorMessages[error.code]) return errorMessages[error.code];
    if (typeof error === 'object' && error.message) {
        // Tenta mapear por código no message
        const codeMatch = error.message.match(/auth\/[a-zA-Z0-9\-]+/);
        if (codeMatch && errorMessages[codeMatch[0]]) return errorMessages[codeMatch[0]];
    }
    return errorMessages['default'];
}

export default function LoginScreen({ navigation, route }) {
  const [phone, setPhone] = useState('');
  const [isExistingUser, setIsExistingUser] = useState(null); // null = não checado, true = existe, false = não existe
  const [loading, setLoading] = useState(false);
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [cpf, setCpf] = useState('');
  const [error, setError] = useState('');
  const userType = route?.params?.userType;

  const checkPhone = async () => {
    setError('');
    if (!phone) return;
    setLoading(true);
    try {
      // Firebase Auth não permite busca direta por telefone, mas podemos tentar signInWithPhoneNumber
      // ou usar fetchSignInMethodsForEmail se o telefone for usado como email (ex: phone@leaf.com)
      // Aqui, vamos simular a checagem:
      const methods = await auth().fetchSignInMethodsForEmail(`${phone}@leaf.com`);
      setIsExistingUser(methods && methods.length > 0);
    } catch (e) {
      setIsExistingUser(false);
    } finally {
      setLoading(false);
    }
  };

  const handleLogin = async () => {
    setError('');
    setLoading(true);
    try {
      await auth().signInWithEmailAndPassword(`${phone}@leaf.com`, password);
      navigation.replace('AuthLoadingScreen');
    } catch (e) {
      setError('Telefone ou senha inválidos.');
    } finally {
      setLoading(false);
    }
  };

  const handleSignup = async () => {
    setError('');
    setLoading(true);
    try {
      // Crie o usuário no Firebase Auth
      await auth().createUserWithEmailAndPassword(`${phone}@leaf.com`, cpf || '123456');
      // Salve os dados adicionais no backend, se necessário
      // Navegue para tela de documentos se for motorista
      if (userType === 'driver') {
        navigation.replace('DriverDocumentsScreen', { phone, name, cpf });
      } else {
        navigation.replace('AuthLoadingScreen');
      }
    } catch (e) {
      setError('Erro ao criar conta.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#F5F5F5', padding: 24 }}>
      <Text style={{ fontSize: 24, fontWeight: 'bold', color: '#1A330E', marginBottom: 24 }}>Informe seu celular</Text>
      <TextInput
        style={{ width: '100%', fontSize: 20, borderBottomWidth: 1, borderColor: '#B0B0B0', marginBottom: 24, color: '#1A330E', padding: 8 }}
        placeholder="(99) 99999-9999"
        placeholderTextColor="#B0B0B0"
        keyboardType="phone-pad"
        value={phone}
        onChangeText={setPhone}
        onBlur={checkPhone}
        autoCapitalize="none"
      />
      {loading && <ActivityIndicator size="small" color="#1A330E" style={{ marginBottom: 16 }} />}
      {isExistingUser === true && (
        <>
          <TextInput
            style={{ width: '100%', fontSize: 20, borderBottomWidth: 1, borderColor: '#B0B0B0', marginBottom: 24, color: '#1A330E', padding: 8 }}
            placeholder="Senha"
            placeholderTextColor="#B0B0B0"
            secureTextEntry
            value={password}
            onChangeText={setPassword}
            autoCapitalize="none"
          />
          <TouchableOpacity style={{ backgroundColor: '#1A330E', borderRadius: 8, paddingVertical: 16, width: 185, alignItems: 'center', marginBottom: 15 }} onPress={handleLogin}>
            <Text style={{ color: '#F5F5F5', fontSize: 18, fontWeight: 'bold' }}>Entrar</Text>
          </TouchableOpacity>
        </>
      )}
      {isExistingUser === false && (
        <>
          <TextInput
            style={{ width: '100%', fontSize: 20, borderBottomWidth: 1, borderColor: '#B0B0B0', marginBottom: 24, color: '#1A330E', padding: 8 }}
            placeholder="Nome completo"
            placeholderTextColor="#B0B0B0"
            value={name}
            onChangeText={setName}
            autoCapitalize="words"
          />
          <TextInput
            style={{ width: '100%', fontSize: 20, borderBottomWidth: 1, borderColor: '#B0B0B0', marginBottom: 24, color: '#1A330E', padding: 8 }}
            placeholder="CPF"
            placeholderTextColor="#B0B0B0"
            value={cpf}
            onChangeText={setCpf}
            keyboardType="numeric"
            maxLength={14}
          />
          <TouchableOpacity style={{ backgroundColor: '#1A330E', borderRadius: 8, paddingVertical: 16, width: 185, alignItems: 'center', marginBottom: 15 }} onPress={handleSignup}>
            <Text style={{ color: '#F5F5F5', fontSize: 18, fontWeight: 'bold' }}>Cadastrar</Text>
          </TouchableOpacity>
        </>
      )}
      {!!error && <Text style={{ color: 'red', marginTop: 12 }}>{error}</Text>}
    </View>
  );
}

const stylesModern = StyleSheet.create({
    bg: {
        flex: 1,
        backgroundColor: '#F8F8F8',
        justifyContent: 'center',
        alignItems: 'center',
    },
    card: {
        width: '90%',
        maxWidth: 380,
        backgroundColor: '#fff',
        borderRadius: 24,
        padding: 28,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 8 },
        shadowOpacity: 0.10,
        shadowRadius: 24,
        elevation: 8,
        alignItems: 'center',
    },
    cardTitle: {
        fontSize: 22,
        color: '#233D1A',
        fontWeight: '700',
        marginBottom: 24,
        alignSelf: 'flex-start',
    },
    inputGroup: {
        width: '100%',
        marginBottom: 24,
    },
    inputRow: {
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: 14,
        width: '100%',
        position: 'relative',
    },
    countryCodeBox: {
        backgroundColor: '#fff',
        borderRadius: 12,
        paddingVertical: 12,
        paddingHorizontal: 12,
        marginRight: 8,
        borderWidth: 1,
        borderColor: '#E0E0E0',
        height: 54,
        justifyContent: 'center',
    },
    countryCode: {
        fontSize: 16,
        color: '#233D1A',
        fontWeight: '600',
    },
    input: {
        flex: 1,
        backgroundColor: '#fff',
        borderRadius: 12,
        paddingVertical: 12,
        paddingHorizontal: 12,
        fontSize: 16,
        borderWidth: 1,
        borderColor: '#E0E0E0',
        color: '#233D1A',
        height: 54,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.04,
        shadowRadius: 4,
    },
    eyeIcon: {
        position: 'absolute',
        right: 12,
        top: -11,
        zIndex: 10,
    },
    primaryButton: {
        backgroundColor: '#233D1A',
        borderRadius: 8,
        paddingVertical: 9,
        alignItems: 'center',
        width: 85,
        marginBottom: 8,
        marginTop: -11,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.10,
        shadowRadius: 4,
        elevation: 2,
    },
    primaryButtonText: {
        color: '#fff',
        fontSize: 18,
        fontWeight: '700',
    },
    forgot: {
        alignSelf: 'flex-end',
        marginBottom: 0,
    },
    forgotText: {
        color: '#888',
        fontSize: 14,
        textDecorationLine: 'underline',
    },
    orText: {
        color: '#888',
        marginVertical: 10,
        fontSize: 15,
        textAlign: 'center',
    },
    socialRow: {
        flexDirection: 'row',
        justifyContent: 'center',
        alignItems: 'center',
        marginBottom: 18,
        width: '100%',
        gap: 18,
    },
    socialCircle: {
        width: 48,
        height: 48,
        borderRadius: 24,
        backgroundColor: '#F8F8F8',
        alignItems: 'center',
        justifyContent: 'center',
        marginHorizontal: 8,
        borderWidth: 1,
        borderColor: '#E0E0E0',
    },
    signup: {
        marginTop: 4,
        alignSelf: 'center',
    },
    signupText: {
        color: '#888',
        fontSize: 15,
        textAlign: 'center',
    },
    signupLink: {
        color: '#233D1A',
        fontWeight: '700',
        textDecorationLine: 'underline',
    },
});