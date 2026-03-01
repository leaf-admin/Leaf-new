import Logger from '../utils/Logger';
import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Animated,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { fetchNetInfo, addNetInfoListener } from '../utils/NetInfoSafe';

/**
 * Banner não bloqueante para indicar status de conexão
 * Segue as diretrizes da Apple e Google:
 * - Não bloqueia funcionalidades
 * - Apenas informa o usuário
 * - Aparece/desaparece suavemente
 */
const NetworkStatusBanner = () => {
  const [isConnected, setIsConnected] = useState(true);
  const [isInternetReachable, setIsInternetReachable] = useState(true);
  const [showBanner, setShowBanner] = useState(false);
  const slideAnim = useRef(new Animated.Value(-100)).current; // Começa fora da tela (acima)

  useEffect(() => {
    let isMounted = true;
    let wasConnected = true; // Rastrear estado anterior
    
    // Verificar estado inicial
    const checkInitialState = async () => {
      try {
        const netInfo = await fetchNetInfo();
        if (!isMounted) return;
        
        const connected = netInfo.isConnected && netInfo.isInternetReachable;
        wasConnected = connected;
        setIsConnected(netInfo.isConnected);
        setIsInternetReachable(netInfo.isInternetReachable);
        
        if (!connected) {
          // Mostrar banner se estiver offline
          setShowBanner(true);
          Animated.spring(slideAnim, {
            toValue: 0,
            useNativeDriver: true,
            tension: 50,
            friction: 8,
          }).start();
        }
      } catch (error) {
        Logger.error('❌ Erro ao verificar conectividade:', error);
      }
    };

    checkInitialState();

    // Listener para mudanças de conectividade
    const unsubscribe = addNetInfoListener(state => {
      if (!isMounted) return;
      
      const connected = state.isConnected && state.isInternetReachable;
      
      // Só atualizar se mudou
      if (wasConnected !== connected) {
        setIsConnected(state.isConnected);
        setIsInternetReachable(state.isInternetReachable);
        
        // Se mudou para offline
        if (!connected) {
          setShowBanner(true);
          Animated.spring(slideAnim, {
            toValue: 0,
            useNativeDriver: true,
            tension: 50,
            friction: 8,
          }).start();
        }
        
        // Se mudou para online
        if (connected) {
          Animated.spring(slideAnim, {
            toValue: -100,
            useNativeDriver: true,
            tension: 50,
            friction: 8,
          }).start(() => {
            // Esconder banner após animação
            if (isMounted) {
              setShowBanner(false);
            }
          });
        }
        
        wasConnected = connected;
      }
    });

    return () => {
      isMounted = false;
      unsubscribe();
    };
  }, [slideAnim]);

  // Não renderizar se estiver online
  if (!showBanner || (isConnected && isInternetReachable)) {
    return null;
  }

  return (
    <Animated.View
      style={[
        styles.banner,
        {
          transform: [{ translateY: slideAnim }],
        },
      ]}
      pointerEvents="box-none"
    >
      <View style={styles.bannerContent}>
        <Ionicons name="cloud-offline-outline" size={20} color="#FFFFFF" style={styles.icon} />
        <Text style={styles.text}>
          Sem conexão com a internet. Algumas funcionalidades podem estar limitadas.
        </Text>
      </View>
    </Animated.View>
  );
};

const styles = StyleSheet.create({
  banner: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    backgroundColor: '#FF6B6B',
    paddingVertical: 10,
    paddingHorizontal: 16,
    zIndex: 9999,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
    elevation: 5,
  },
  bannerContent: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  icon: {
    marginRight: 8,
  },
  text: {
    flex: 1,
    fontSize: 13,
    fontWeight: '500',
    color: '#FFFFFF',
    textAlign: 'center',
    lineHeight: 18,
  },
});

export default NetworkStatusBanner;

