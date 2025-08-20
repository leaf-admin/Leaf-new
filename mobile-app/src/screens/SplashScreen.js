import React, { useEffect, useState } from 'react';
import { View, StyleSheet, Image, Dimensions } from 'react-native';
import { useSelector } from 'react-redux';
import AuthFlow from '../components/auth/AuthFlow';

const { width, height } = Dimensions.get('window');

const SplashScreen = ({ navigation }) => {
  const [showAuth, setShowAuth] = useState(false);
  const auth = useSelector(state => state.auth);

  useEffect(() => {
    // Mostrar o fluxo de autenticação após 2 segundos
    const timer = setTimeout(() => {
      setShowAuth(true);
    }, 2000);

    return () => clearTimeout(timer);
  }, []);

  // Se o usuário já está autenticado, não mostrar o fluxo de auth
  useEffect(() => {
    if (auth.profile && auth.profile.uid) {
      setShowAuth(false);
    }
  }, [auth.profile]);

  const handleAuthComplete = (authData) => {
    setShowAuth(false);
    // Aqui você pode implementar a lógica para salvar os dados de autenticação
    // e navegar para a tela principal
    console.log('Autenticação completada:', authData);
    
    // Por enquanto, vamos simular uma autenticação bem-sucedida
    // Em um app real, você salvaria os dados no Redux/AsyncStorage
    // e navegaria para a tela principal
  };

  return (
    <View style={styles.container}>
      {/* Logo centralizada */}
      <View style={styles.logoContainer}>
        <Image
          source={require('../../assets/images/logo1024x1024.png')}
          style={styles.logo}
          resizeMode="contain"
        />
      </View>



      {/* Fluxo de autenticação (só se não estiver autenticado) */}
      {!auth.profile && (
        <AuthFlow
          visible={showAuth}
          onComplete={handleAuthComplete}
          onClose={() => setShowAuth(false)}
        />
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#1A330E', // Verde da Leaf (cor correta)
    justifyContent: 'center',
    alignItems: 'center',
  },
  logoContainer: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  logo: {
    width: 120,
    height: 120,
  },
});

export default SplashScreen;
