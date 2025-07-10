import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { colors } from '../common/theme';
import AsyncStorage from '@react-native-async-storage/async-storage';
import OnboardingLayout from '../components/OnboardingLayout';

const LEAF_GREEN = '#1A330E';
const LEAF_GRAY = '#B0B0B0';

const options = [
  {
    key: 'passenger',
    title: 'Quero viajar',
  },
  {
    key: 'driver',
    title: 'Quero ser parceiro',
  },
];

export default function ProfileSelectionScreen() {
  const navigation = useNavigation();
  const [selected, setSelected] = useState(null);

  const handleContinue = async () => {
    if (selected) {
      // Salvar o tipo de usuário escolhido
      await AsyncStorage.setItem('@user_type', selected);
      
      // Navegar diretamente para a tela de telefone
      navigation.navigate('PhoneScreen', { userType: selected });
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
      <View style={styles.container}>
        <Text style={styles.title}>Escolha o tipo de conta</Text>
        <View style={styles.optionsWrapper}>
          {options.map(opt => {
            const isSelected = selected === opt.key;
            const color = isSelected ? LEAF_GREEN : LEAF_GRAY;
            return (
              <TouchableOpacity
                key={opt.key}
                style={[styles.optionButton, isSelected && styles.optionButtonSelected]}
                onPress={() => setSelected(opt.key)}
                activeOpacity={0.8}
              >
                <Text style={[styles.optionTitle, { color }]}>{opt.title}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </View>
    </OnboardingLayout>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'flex-start',
    alignItems: 'center',
    width: '100%',
    paddingTop: 48,
    paddingBottom: 0,
  },
  title: {
    fontSize: 22,
    fontWeight: '700',
    color: LEAF_GREEN,
    marginBottom: 40,
    textAlign: 'center',
    letterSpacing: 0.2,
  },
  optionsWrapper: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    width: '100%',
    gap: 16,
    paddingHorizontal: 32,
  },
  optionButton: {
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
    paddingVertical: 20,
    paddingHorizontal: 24,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: LEAF_GRAY,
    backgroundColor: 'transparent',
  },
  optionButtonSelected: {
    borderColor: LEAF_GREEN,
    backgroundColor: LEAF_GREEN + '10',
  },
  optionTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    textAlign: 'center',
    letterSpacing: 0.2,
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