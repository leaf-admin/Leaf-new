import React, { useState, useRef } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Animated, Dimensions } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { colors } from '../common/theme';
import AsyncStorage from '@react-native-async-storage/async-storage';
import OnboardingLayout from '../components/OnboardingLayout';

const { width } = Dimensions.get('window');
const LEAF_GREEN = '#1A330E';
const LEAF_LIGHT_GREEN = '#2A4A1E';
const LEAF_GRAY = '#B0B0B0';
const WHITE = '#FFFFFF';

const options = [
  {
    key: 'passenger',
    title: 'Quero viajar',
    subtitle: 'Encontre motoristas próximos e faça suas viagens',
    icon: '🚗',
    color: '#4CAF50',
  },
  {
    key: 'driver',
    title: 'Quero ser parceiro',
    subtitle: 'Dirija e ganhe dinheiro com suas viagens',
    icon: '💰',
    color: '#FF9800',
  },
];

export default function ProfileSelectionScreen() {
  const navigation = useNavigation();
  const [selected, setSelected] = useState(null);
  const scaleAnim = useRef(new Animated.Value(1)).current;
  const fadeAnim = useRef(new Animated.Value(0)).current;

  React.useEffect(() => {
    // Animação de entrada
    Animated.parallel([
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 800,
        useNativeDriver: true,
      }),
      Animated.spring(scaleAnim, {
        toValue: 1,
        tension: 50,
        friction: 7,
        useNativeDriver: true,
      })
    ]).start();
  }, []);

  const handleOptionPress = (optionKey) => {
    setSelected(optionKey);
    // Seleção instantânea sem animação de bounce
  };

  const handleContinue = async () => {
    if (selected) {
      // Salvar o tipo de usuário escolhido
      await AsyncStorage.setItem('@user_type', selected);
      
      // Navegar diretamente para a tela de telefone
      navigation.navigate('PhoneInput', { userType: selected });
    }
  };

  // Barra de progresso customizada
  const progressBar = (
    <View style={styles.progressBarContainer}>
      <View style={[styles.progressDot, styles.progressActive]} />
      <View style={styles.progressDot} />
      <View style={styles.progressDot} />
      <View style={styles.progressDot} />
    </View>
  );

  return (
    <OnboardingLayout
      progress={progressBar}
      onContinue={handleContinue}
      continueLabel="Continuar"
      continueDisabled={!selected}
    >
      <Animated.View style={[
        styles.container,
        {
          opacity: fadeAnim,
          transform: [{ scale: scaleAnim }]
        }
      ]}>
        <View style={styles.header}>
          <Text style={styles.title}>Escolha seu perfil:</Text>
          <Text style={styles.subtitle}>
            Escolha o tipo de conta que melhor se adapta às suas necessidades
          </Text>
        </View>

        <View style={styles.optionsWrapper}>
          {options.map((opt, index) => {
            const isSelected = selected === opt.key;
            return (
              <Animated.View
                key={opt.key}
                style={[
                  styles.optionContainer,
                  { transform: [{ scale: isSelected ? 1.02 : 1 }] }
                ]}
              >
                <TouchableOpacity
                  style={[
                    styles.optionButton,
                    isSelected && {
                      ...styles.optionButtonSelected,
                      backgroundColor: opt.color,
                      borderColor: opt.color,
                    }
                  ]}
                  onPress={() => handleOptionPress(opt.key)}
                  activeOpacity={0.9}
                >
                  <View style={styles.optionContent}>
                    <View style={[
                      styles.iconContainer,
                      isSelected && { backgroundColor: WHITE + '20' }
                    ]}>
                      <Text style={styles.iconText}>{opt.icon}</Text>
                    </View>
                    
                    <View style={styles.textContainer}>
                      <Text style={[
                        styles.optionTitle,
                        { color: isSelected ? WHITE : LEAF_GREEN }
                      ]}>
                        {opt.title}
                      </Text>
                      <Text style={[
                        styles.optionSubtitle,
                        { color: isSelected ? WHITE + 'CC' : LEAF_GRAY }
                      ]}>
                        {opt.subtitle}
                      </Text>
                    </View>

                    {isSelected && (
                      <View style={styles.checkmarkContainer}>
                        <Text style={styles.checkmark}>✓</Text>
                      </View>
                    )}
                  </View>
                </TouchableOpacity>
              </Animated.View>
            );
          })}
        </View>

        {selected && (
          <Animated.View style={[styles.selectedInfo, { opacity: fadeAnim }]}>
            <Text style={styles.selectedInfoText}>
              Você selecionou: {options.find(opt => opt.key === selected)?.title}
            </Text>
          </Animated.View>
        )}
      </Animated.View>
    </OnboardingLayout>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'flex-start',
    alignItems: 'center',
    width: '100%',
    paddingTop: 20,
  },
  header: {
    alignItems: 'center',
    marginBottom: 40,
    paddingHorizontal: 20,
  },
  title: {
    fontSize: 28,
    fontWeight: '800',
    color: LEAF_GREEN,
    marginBottom: 12,
    textAlign: 'center',
    letterSpacing: 0.5,
  },
  subtitle: {
    fontSize: 16,
    color: LEAF_GRAY,
    textAlign: 'center',
    lineHeight: 22,
    paddingHorizontal: 20,
  },
  optionsWrapper: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    width: '100%',
    gap: 20,
    paddingHorizontal: 24,
  },
  optionContainer: {
    width: '100%',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 4,
  },
  optionButton: {
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
    paddingVertical: 24,
    paddingHorizontal: 20,
    borderRadius: 16,
    borderWidth: 2,
    borderColor: '#E0E0E0',
    backgroundColor: WHITE,
    position: 'relative',
    overflow: 'hidden',
  },
  optionButtonSelected: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.3,
    shadowRadius: 12,
    elevation: 8,
  },
  optionContent: {
    flexDirection: 'row',
    alignItems: 'center',
    width: '100%',
    zIndex: 1,
  },
  iconContainer: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: '#F5F5F5',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 16,
  },
  iconText: {
    fontSize: 28,
  },
  textContainer: {
    flex: 1,
  },
  optionTitle: {
    fontSize: 20,
    fontWeight: '700',
    marginBottom: 4,
    letterSpacing: 0.3,
  },
  optionSubtitle: {
    fontSize: 14,
    lineHeight: 20,
    letterSpacing: 0.2,
  },
  checkmarkContainer: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: WHITE + '20',
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkmark: {
    color: WHITE,
    fontSize: 18,
    fontWeight: 'bold',
  },
  selectedInfo: {
    marginTop: 20,
    paddingHorizontal: 20,
  },
  selectedInfoText: {
    fontSize: 14,
    color: LEAF_GREEN,
    textAlign: 'center',
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
    backgroundColor: colors.BORDER_BACKGROUND,
    marginHorizontal: 4,
  },
  progressActive: {
    backgroundColor: colors.BIDTAXIPRIMARY,
  },
}); 