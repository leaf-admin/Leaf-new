import React, { useState, useEffect } from 'react';
import { 
  View, 
  Text, 
  TextInput, 
  TouchableOpacity, 
  StyleSheet, 
  Alert, 
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Image
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { api } from 'common';
import { firebase } from 'common/src/config/configureFirebase';


const LEAF_GREEN = '#1A330E';
const LEAF_GRAY = '#B0B0B0';
const GOOGLE_BLUE = '#4285F4';



export default function AuthScreen() {
  const navigation = useNavigation();
  const [isLogin, setIsLogin] = useState(true);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  // Google Auth - Temporarily disabled due to import issues
  // const [request, response, promptAsync] = useAuthRequest({
  //   clientId: GOOGLE_AUTH_CONFIG.expoClientId,
  //   scopes: ['openid', 'profile', 'email'],
  //   redirectUri: 'https://auth.expo.io/@your-expo-username/your-app-slug',
  // });

  // useEffect(() => {
  //   if (response?.type === 'success') {
  //     handleGoogleSignIn(response.authentication.accessToken);
  //   }
  // }, [response]);

  // Função para login com email/senha
  const handleEmailAuth = async () => {
    if (!email.trim() || !password.trim()) {
      Alert.alert('Atenção', 'Preencha todos os campos obrigatórios.');
      return;
    }

    if (!isLogin && password !== confirmPassword) {
      Alert.alert('Atenção', 'As senhas não coincidem.');
      return;
    }

    if (!isLogin && password.length < 6) {
      Alert.alert('Atenção', 'A senha deve ter pelo menos 6 caracteres.');
      return;
    }

    setLoading(true);

    try {
      const { auth } = firebase;
      
      if (isLogin) {
        // Login
        const userCredential = await auth.signInWithEmailAndPassword(email, password);
        console.log('✅ Login bem-sucedido:', userCredential.user.uid);
        
        // Salvar dados básicos no AsyncStorage
        await AsyncStorage.setItem('@auth_uid', userCredential.user.uid);
        await AsyncStorage.setItem('@user_data', JSON.stringify({
          uid: userCredential.user.uid,
          email: email,
          createdAt: new Date().getTime()
        }));
        
        // Navegar para seleção de perfil
        navigation.replace('ProfileSelection');
      } else {
        // Atualizar usuário existente com email/senha
        const currentUser = auth.currentUser;
        if (!currentUser) {
          throw new Error('Usuário não está autenticado. Faça login novamente.');
        }
        
        console.log('🔄 Atualizando usuário existente com email/senha...');
        
        // Atualizar email no Firebase Auth
        await currentUser.updateEmail(email);
        console.log('✅ Email atualizado no Firebase Auth');
        
        // Atualizar senha no Firebase Auth
        await currentUser.updatePassword(password);
        console.log('✅ Senha atualizada no Firebase Auth');
        
        // Enviar email de verificação
        await currentUser.sendEmailVerification();
        console.log('📧 Email de verificação enviado');
        
        // Atualizar dados no AsyncStorage
        const existingData = await AsyncStorage.getItem('@user_data');
        const userData = existingData ? JSON.parse(existingData) : {};
        
        await AsyncStorage.setItem('@user_data', JSON.stringify({
          ...userData,
          email: email,
          updatedAt: new Date().getTime()
        }));
        
        console.log('✅ Usuário atualizado com email/senha');
        
        // Navegar para seleção de perfil
        navigation.navigate('ProfileSelection');
      }
    } catch (error) {
      console.error('❌ Erro na autenticação:', error);
      let errorMessage = 'Ocorreu um erro durante a autenticação.';
      
      if (error.code === 'auth/user-not-found') {
        errorMessage = 'Usuário não encontrado. Verifique seu email.';
      } else if (error.code === 'auth/wrong-password') {
        errorMessage = 'Senha incorreta.';
      } else if (error.code === 'auth/email-already-in-use') {
        errorMessage = 'Este email já está em uso.';
      } else if (error.code === 'auth/weak-password') {
        errorMessage = 'A senha é muito fraca.';
      } else if (error.code === 'auth/invalid-email') {
        errorMessage = 'Email inválido.';
      }
      
      Alert.alert('Erro', errorMessage);
    } finally {
      setLoading(false);
    }
  };

  // Função para login com Google - Temporarily disabled
  // const handleGoogleSignIn = async (accessToken) => {
  //   setLoading(true);
    
  //   try {
  //     // Obter informações do usuário do Google
  //     const userInfoResponse = await fetch('https://www.googleapis.com/userinfo/v2/me', {
  //       headers: { Authorization: `Bearer ${accessToken}` },
  //     });
      
  //     const userInfo = await userInfoResponse.json();
  //     console.log('👤 Dados do Google:', userInfo);
      
  //     // Criar credencial do Google
  //     const { auth } = firebase;
  //     const credential = auth.GoogleAuthProvider.credential(null, accessToken);
      
  //     // Fazer login com Google
  //     const userCredential = await auth.signInWithCredential(credential);
  //     console.log('✅ Login com Google bem-sucedido:', userCredential.user.uid);
      
  //     // Salvar dados do Google no AsyncStorage
  //     await AsyncStorage.setItem('@auth_uid', userCredential.user.uid);
  //     await AsyncStorage.setItem('@user_data', JSON.stringify({
  //       uid: userCredential.user.uid,
  //       email: userInfo.email,
  //       firstName: userInfo.given_name || '',
  //       lastName: userInfo.family_name || '',
  //       googleData: {
  //         name: userInfo.name,
  //         picture: userInfo.picture
  //       },
  //       createdAt: new Date().getTime()
  //     }));
      
  //     // Navegar para seleção de perfil
  //     navigation.replace('ProfileSelection');
      
  //   } catch (error) {
  //     console.error('❌ Erro no login com Google:', error);
  //     Alert.alert('Erro', 'Não foi possível fazer login com o Google. Tente novamente.');
  //   } finally {
  //     setLoading(false);
  //   }
  // };

  return (
    <KeyboardAvoidingView 
      style={styles.container} 
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <ScrollView contentContainerStyle={styles.scrollContainer}>
        <View style={styles.header}>
          <Image 
            source={require('../../assets/images/leaftransparentbg.png')} 
            style={styles.logo}
            resizeMode="contain"
          />
          <Text style={styles.title}>Adicionar Email/Senha</Text>
          <Text style={styles.subtitle}>
            {isLogin ? 'Faça login para continuar' : 'Adicione um email e senha para facilitar futuros acessos (opcional)'}
          </Text>
        </View>

        <View style={styles.form}>
          {/* Campo de Email */}
          <View style={styles.inputContainer}>
            <MaterialCommunityIcons name="email" size={20} color="#666666" style={styles.inputIcon} />
            <TextInput
              style={styles.input}
              placeholder="Seu e-mail"
              placeholderTextColor="#999999"
              value={email}
              onChangeText={setEmail}
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
            />
          </View>

          {/* Campo de Senha */}
          <View style={styles.inputContainer}>
            <MaterialCommunityIcons name="lock" size={20} color="#666666" style={styles.inputIcon} />
            <TextInput
              style={styles.input}
              placeholder="Sua senha"
              placeholderTextColor="#999999"
              value={password}
              onChangeText={setPassword}
              secureTextEntry={!showPassword}
              autoCapitalize="none"
            />
            <TouchableOpacity 
              onPress={() => setShowPassword(!showPassword)}
              style={styles.eyeIcon}
            >
              <MaterialCommunityIcons 
                name={showPassword ? "eye-off" : "eye"} 
                size={20} 
                color="#666666" 
              />
            </TouchableOpacity>
          </View>

          {/* Indicador de força da senha (apenas no cadastro) */}
          {!isLogin && password.length > 0 && (
            <View style={styles.passwordStrength}>
              <Text style={styles.passwordStrengthText}>Força da senha:</Text>
              <View style={styles.strengthBar}>
                <View style={[
                  styles.strengthFill, 
                  { 
                    width: `${Math.min(100, (password.length / 8) * 100)}%`,
                    backgroundColor: password.length >= 6 ? "#4CAF50" : "#FF9800"
                  }
                ]} />
              </View>
              <Text style={[
                styles.strengthText,
                { color: password.length >= 6 ? "#4CAF50" : "#FF9800" }
              ]}>
                {password.length < 6 ? "Muito fraca" : password.length < 8 ? "Fraca" : "Boa"}
              </Text>
            </View>
          )}

          {/* Campo de Confirmar Senha (apenas no cadastro) */}
          {!isLogin && (
            <View style={styles.inputContainer}>
              <MaterialCommunityIcons name="lock-check" size={20} color="#666666" style={styles.inputIcon} />
              <TextInput
                style={styles.input}
                placeholder="Confirmar senha"
                placeholderTextColor="#999999"
                value={confirmPassword}
                onChangeText={setConfirmPassword}
                secureTextEntry={!showConfirmPassword}
                autoCapitalize="none"
              />
              <TouchableOpacity 
                onPress={() => setShowConfirmPassword(!showConfirmPassword)}
                style={styles.eyeIcon}
              >
                <MaterialCommunityIcons 
                  name={showConfirmPassword ? "eye-off" : "eye"} 
                  size={20} 
                  color="#666666" 
                />
              </TouchableOpacity>
            </View>
          )}

          {/* Indicador de verificação de senha (apenas no cadastro) */}
          {!isLogin && password.length > 0 && confirmPassword.length > 0 && (
            <View style={styles.passwordIndicator}>
              <MaterialCommunityIcons 
                name={password === confirmPassword ? "check-circle" : "alert-circle"} 
                size={16} 
                color={password === confirmPassword ? "#4CAF50" : "#FF9800"} 
              />
              <Text style={[
                styles.passwordIndicatorText,
                { color: password === confirmPassword ? "#4CAF50" : "#FF9800" }
              ]}>
                {password === confirmPassword ? "Senhas coincidem" : "As senhas devem ser iguais"}
              </Text>
            </View>
          )}

          {/* Botão de Email/Senha */}
          <TouchableOpacity
            style={[
              styles.button, 
              styles.emailButton, 
              (loading || (!isLogin && password !== confirmPassword)) && styles.buttonDisabled
            ]}
            onPress={handleEmailAuth}
            disabled={loading || (!isLogin && password !== confirmPassword)}
          >
            {loading ? (
              <ActivityIndicator color="white" size="small" />
            ) : (
              <Text style={styles.buttonText}>
                {isLogin ? 'Entrar' : 'Adicionar Email/Senha'}
              </Text>
            )}
          </TouchableOpacity>

          {/* Botão Pular (apenas no cadastro) */}
          {!isLogin && (
            <TouchableOpacity
              style={[styles.button, styles.skipButton]}
              onPress={() => {
                console.log('⏭️ Usuário escolheu pular email/senha');
                navigation.navigate('ProfileSelection');
              }}
            >
              <Text style={styles.skipButtonText}>Pular por enquanto</Text>
            </TouchableOpacity>
          )}

          {/* Separador - Temporarily disabled for Google auth */}
          {/* <View style={styles.separator}>
            <View style={styles.separatorLine} />
            <Text style={styles.separatorText}>ou</Text>
            <View style={styles.separatorLine} />
          </View> */}

          {/* Botão do Google - Temporarily disabled */}
          {/* <TouchableOpacity
            style={[styles.button, styles.googleButton, loading && styles.buttonDisabled]}
            onPress={() => promptAsync()}
            disabled={loading}
          >
            <MaterialCommunityIcons name="google" size={20} color="white" />
            <Text style={styles.buttonText}>
              {isLogin ? 'Entrar com Google' : 'Cadastrar com Google'}
            </Text>
          </TouchableOpacity> */}

          {/* Link para alternar entre login e cadastro */}
          <TouchableOpacity
            style={styles.switchMode}
            onPress={() => setIsLogin(!isLogin)}
            disabled={loading}
          >
            <Text style={styles.switchModeText}>
              {isLogin ? 'Não tem uma conta? Cadastre-se' : 'Já tem uma conta? Faça login'}
            </Text>
          </TouchableOpacity>
        </View>

        {/* Informações sobre verificação de email */}
        {!isLogin && (
          <View style={styles.infoContainer}>
            <MaterialCommunityIcons name="information" size={16} color="#E8F5E8" />
            <Text style={styles.infoText}>
              Um email de verificação será enviado para confirmar sua conta.
            </Text>
          </View>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: LEAF_GREEN,
  },
  scrollContainer: {
    flexGrow: 1,
    justifyContent: 'center',
    padding: 24,
  },
  header: {
    alignItems: 'center',
    marginBottom: 48,
    marginTop: -80,
  },
  logo: {
    width: 240,
    height: 240,
    marginBottom: 24,
  },
  title: {
    fontSize: 32,
    fontWeight: '700',
    color: 'white',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 16,
    color: '#E8F5E8',
    textAlign: 'center',
  },
  form: {
    marginBottom: 24,
  },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'white',
    borderRadius: 12,
    marginBottom: 16,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: '#D0D0D0',
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.1,
    shadowRadius: 3.84,
    elevation: 5,
  },
  inputIcon: {
    marginRight: 12,
    color: '#666666',
  },
  input: {
    flex: 1,
    fontSize: 16,
    color: '#333333',
  },
  eyeIcon: {
    padding: 4,
  },
  passwordIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
    paddingHorizontal: 4,
  },
  passwordIndicatorText: {
    fontSize: 14,
    marginLeft: 8,
    fontWeight: '500',
  },
  passwordStrength: {
    marginBottom: 16,
    paddingHorizontal: 4,
  },
  passwordStrengthText: {
    fontSize: 12,
    color: '#666666',
    marginBottom: 4,
  },
  strengthBar: {
    height: 4,
    backgroundColor: '#E0E0E0',
    borderRadius: 2,
    marginBottom: 4,
  },
  strengthFill: {
    height: '100%',
    borderRadius: 2,
  },
  strengthText: {
    fontSize: 12,
    fontWeight: '500',
  },
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 16,
    borderRadius: 12,
    marginBottom: 16,
  },
  emailButton: {
    backgroundColor: 'white',
  },
  skipButton: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: 'white',
    marginTop: 8,
  },
  googleButton: {
    backgroundColor: GOOGLE_BLUE,
  },
  buttonDisabled: {
    backgroundColor: '#CCCCCC',
    opacity: 0.6,
  },
  buttonText: {
    color: LEAF_GREEN,
    fontSize: 16,
    fontWeight: '600',
    marginLeft: 8,
  },
  skipButtonText: {
    color: 'white',
    fontSize: 16,
    fontWeight: '600',
  },
  separator: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: 24,
  },
  separatorLine: {
    flex: 1,
    height: 1,
    backgroundColor: '#E0E0E0',
  },
  separatorText: {
    marginHorizontal: 16,
    color: LEAF_GRAY,
    fontSize: 14,
  },
  switchMode: {
    alignItems: 'center',
    paddingVertical: 16,
  },
  switchModeText: {
    color: 'white',
    fontSize: 14,
    textDecorationLine: 'underline',
  },
  infoContainer: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    padding: 16,
    borderRadius: 8,
    marginTop: 16,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.2)',
  },
  infoText: {
    flex: 1,
    marginLeft: 8,
    fontSize: 12,
    color: '#E8F5E8',
    lineHeight: 16,
  },
}); 