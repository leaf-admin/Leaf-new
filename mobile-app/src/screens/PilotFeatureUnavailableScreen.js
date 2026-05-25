import React, { useMemo } from 'react';
import { StatusBar, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { fonts } from '../theme/runtimeTokens';

const DEFAULT_MESSAGE = 'Este recurso fica fora do escopo do piloto controlado e sera operado manualmente nesta fase.';

export default function PilotFeatureUnavailableScreen({ navigation, route }) {
  const insets = useSafeAreaInsets();
  const title = String(route?.params?.title || 'Indisponivel no piloto').trim() || 'Indisponivel no piloto';
  const message = String(route?.params?.message || DEFAULT_MESSAGE).trim() || DEFAULT_MESSAGE;
  const targetRoute = String(route?.params?.targetRoute || 'Map').trim() || 'Map';

  const buttonLabel = useMemo(() => {
    if (targetRoute === 'RobotaxiPrototype' || targetRoute === 'Map') {
      return 'Voltar ao mapa';
    }
    return 'Fechar';
  }, [targetRoute]);

  const handleClose = () => {
    if (navigation.canGoBack()) {
      navigation.goBack();
      return;
    }

    const routeNames = navigation?.getState?.()?.routeNames || [];
    if (routeNames.includes(targetRoute)) {
      navigation.navigate(targetRoute);
      return;
    }

    if (routeNames.includes('Map')) {
      navigation.navigate('Map');
      return;
    }

    if (routeNames.includes('Splash')) {
      navigation.navigate('Splash');
    }
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top + 20, paddingBottom: Math.max(insets.bottom, 24) }]}>
      <StatusBar translucent backgroundColor="transparent" barStyle="dark-content" />
      <View style={styles.card}>
        <View style={styles.iconWrap}>
          <Ionicons name="flag-outline" size={22} color="#1A330E" />
        </View>
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.message}>{message}</Text>
        <TouchableOpacity style={styles.button} activeOpacity={0.88} onPress={handleClose}>
          <Text style={styles.buttonText}>{buttonLabel}</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F5F7F8',
    paddingHorizontal: 20,
    justifyContent: 'center',
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 28,
    paddingHorizontal: 24,
    paddingVertical: 28,
    borderWidth: 1,
    borderColor: 'rgba(17,26,39,0.08)',
    shadowColor: '#111827',
    shadowOpacity: 0.08,
    shadowOffset: { width: 0, height: 12 },
    shadowRadius: 28,
    elevation: 4,
  },
  iconWrap: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(26,51,14,0.08)',
    marginBottom: 18,
  },
  title: {
    color: '#111A27',
    fontFamily: fonts.Bold,
    fontSize: 24,
    lineHeight: 28,
  },
  message: {
    marginTop: 10,
    color: '#4E5A6B',
    fontFamily: fonts.Regular,
    fontSize: 15,
    lineHeight: 22,
  },
  button: {
    marginTop: 22,
    minHeight: 50,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#1A330E',
  },
  buttonText: {
    color: '#FFFFFF',
    fontFamily: fonts.SemiBold,
    fontSize: 15,
    lineHeight: 18,
  },
});
