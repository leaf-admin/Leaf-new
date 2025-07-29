// ProfileToggle.js - Componente de toggle discreto (estilo Nubank)
import React, { useState, useEffect } from 'react';
import {
  TouchableOpacity,
  View,
  Text,
  StyleSheet,
  Animated,
  Alert
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import profileToggleService from '../services/ProfileToggleService';

const ProfileToggle = ({ 
  userId, 
  onModeChange, 
  style = 'discrete', // 'discrete' | 'prominent'
  size = 'medium'     // 'small' | 'medium' | 'large'
}) => {
  const [currentMode, setCurrentMode] = useState('passenger');
  const [isLoading, setIsLoading] = useState(false);
  const [fadeAnim] = useState(new Animated.Value(1));
  const [scaleAnim] = useState(new Animated.Value(1));

  useEffect(() => {
    loadCurrentMode();
  }, []);

  const loadCurrentMode = async () => {
    try {
      const mode = await profileToggleService.getCurrentMode();
      setCurrentMode(mode);
    } catch (error) {
      console.error('❌ Erro ao carregar modo atual:', error);
    }
  };

  const handleToggle = async () => {
    if (isLoading) return;

    try {
      setIsLoading(true);
      
      // Animação de feedback
      Animated.sequence([
        Animated.parallel([
          Animated.timing(fadeAnim, {
            toValue: 0.5,
            duration: 150,
            useNativeDriver: true
          }),
          Animated.timing(scaleAnim, {
            toValue: 0.95,
            duration: 150,
            useNativeDriver: true
          })
        ]),
        Animated.parallel([
          Animated.timing(fadeAnim, {
            toValue: 1,
            duration: 150,
            useNativeDriver: true
          }),
          Animated.timing(scaleAnim, {
            toValue: 1,
            duration: 150,
            useNativeDriver: true
          })
        ])
      ]).start();

      // Verificar permissões
      const newMode = currentMode === 'passenger' ? 'driver' : 'passenger';
      const canSwitch = await profileToggleService.canSwitchToMode(userId, newMode);
      
      if (!canSwitch) {
        Alert.alert(
          'Permissão Negada',
          `Você não tem permissão para alternar para modo ${profileToggleService.getModeDisplayName(newMode)}`,
          [{ text: 'OK' }]
        );
        return;
      }

      // Executar toggle
      const result = await profileToggleService.switchMode(userId);
      
      if (result.success) {
        setCurrentMode(result.newMode);
        
        // Callback para componente pai
        if (onModeChange) {
          onModeChange(result.newMode, result.profileData);
        }
        
        // Feedback visual
        Alert.alert(
          'Modo Alterado',
          result.message,
          [{ text: 'OK' }]
        );
      } else {
        Alert.alert(
          'Erro',
          result.error || 'Erro ao alternar modo',
          [{ text: 'OK' }]
        );
      }
    } catch (error) {
      console.error('❌ Erro no toggle:', error);
      Alert.alert(
        'Erro',
        'Erro ao alternar modo. Tente novamente.',
        [{ text: 'OK' }]
      );
    } finally {
      setIsLoading(false);
    }
  };

  const getIconName = () => {
    return profileToggleService.getModeIcon(currentMode);
  };

  const getDisplayText = () => {
    return profileToggleService.getModeDisplayName(currentMode);
  };

  const getStyles = () => {
    const baseStyles = {
      small: {
        container: { padding: 8, borderRadius: 12 },
        icon: { fontSize: 16 },
        text: { fontSize: 12 }
      },
      medium: {
        container: { padding: 12, borderRadius: 16 },
        icon: { fontSize: 20 },
        text: { fontSize: 14 }
      },
      large: {
        container: { padding: 16, borderRadius: 20 },
        icon: { fontSize: 24 },
        text: { fontSize: 16 }
      }
    };

    const styleVariants = {
      discrete: {
        container: {
          backgroundColor: 'transparent',
          borderWidth: 1,
          borderColor: '#E0E0E0'
        },
        text: { color: '#666666' }
      },
      prominent: {
        container: {
          backgroundColor: '#007AFF',
          borderWidth: 0
        },
        text: { color: '#FFFFFF' }
      }
    };

    return {
      ...baseStyles[size],
      ...styleVariants[style]
    };
  };

  const styles = getStyles();

  return (
    <Animated.View
      style={[
        {
          opacity: fadeAnim,
          transform: [{ scale: scaleAnim }]
        }
      ]}
    >
      <TouchableOpacity
        style={[
          styles.container,
          {
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'center',
            minWidth: 120,
            opacity: isLoading ? 0.6 : 1
          }
        ]}
        onPress={handleToggle}
        disabled={isLoading}
        activeOpacity={0.7}
      >
        <Ionicons
          name={getIconName()}
          size={styles.icon.fontSize}
          color={styles.text.color}
          style={{ marginRight: 6 }}
        />
        <Text style={[styles.text, { fontWeight: '500' }]}>
          {getDisplayText()}
        </Text>
        {isLoading && (
          <Ionicons
            name="refresh"
            size={styles.icon.fontSize * 0.8}
            color={styles.text.color}
            style={{ marginLeft: 6 }}
          />
        )}
      </TouchableOpacity>
    </Animated.View>
  );
};

// Estilos padrão
const defaultStyles = StyleSheet.create({
  container: {
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 2
    },
    shadowOpacity: 0.1,
    shadowRadius: 3.84,
    elevation: 5
  }
});

export default ProfileToggle; 