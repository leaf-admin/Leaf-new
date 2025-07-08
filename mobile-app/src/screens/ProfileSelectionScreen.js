import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, SafeAreaView } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { colors } from '../common/theme';
import { MaterialCommunityIcons, FontAwesome5 } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';

const options = [
  {
    key: 'passenger',
    title: 'Quero viajar',
    description: 'Sou passageiro e quero solicitar corridas.',
    icon: <MaterialCommunityIcons name="car" size={32} color={colors.GREEN} />,
  },
  {
    key: 'driver',
    title: 'Quero ser parceiro',
    description: 'Sou motorista e quero oferecer corridas.',
    icon: <FontAwesome5 name="user-tie" size={32} color={colors.BIDTAXIPRIMARY} />,
  },
];

export default function ProfileSelectionScreen() {
  const navigation = useNavigation();
  const [selected, setSelected] = useState(null);

  const handleContinue = async () => {
    if (selected) {
      await AsyncStorage.setItem('@user_type', selected);
      navigation.navigate('PhoneScreen', { userType: selected });
    }
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.container}>
        <Text style={styles.title}>Escolha o tipo de conta</Text>
        <Text style={styles.subtitle}>Vamos personalizar sua experiência na plataforma.</Text>
        <View style={styles.optionsContainer}>
          {options.map(opt => (
            <TouchableOpacity
              key={opt.key}
              style={[styles.option, selected === opt.key && styles.optionSelected]}
              onPress={() => setSelected(opt.key)}
              activeOpacity={0.8}
            >
              <View style={styles.icon}>{opt.icon}</View>
              <View style={styles.texts}>
                <Text style={styles.optionTitle}>{opt.title}</Text>
                <Text style={styles.optionDesc}>{opt.description}</Text>
              </View>
              {selected === opt.key && (
                <MaterialCommunityIcons name="check-circle" size={28} color={colors.BIDTAXIPRIMARY} style={styles.checkIcon} />
              )}
            </TouchableOpacity>
          ))}
        </View>
        {/* Barra de progresso */}
        <View style={styles.progressBarContainer}>
          <View style={[styles.progressDot, styles.progressActive]} />
          <View style={styles.progressDot} />
          <View style={styles.progressDot} />
          <View style={styles.progressDot} />
        </View>
        <TouchableOpacity
          style={[styles.continueBtn, !selected && styles.continueBtnDisabled]}
          onPress={handleContinue}
          disabled={!selected}
        >
          <Text style={styles.continueText}>Continuar</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.BACKGROUND_PRIMARY,
  },
  container: {
    flex: 1,
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
    marginBottom: 32,
    textAlign: 'center',
  },
  optionsContainer: {
    width: '100%',
    marginBottom: 32,
  },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: colors.BORDER_BACKGROUND,
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
    backgroundColor: colors.WHITE,
  },
  optionSelected: {
    borderColor: colors.BIDTAXIPRIMARY,
    backgroundColor: '#f0f7f5',
  },
  icon: {
    marginRight: 16,
  },
  texts: {
    flex: 1,
  },
  optionTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: colors.BIDTAXIPRIMARY,
  },
  optionDesc: {
    fontSize: 14,
    color: colors.GREY,
    marginTop: 2,
  },
  checkIcon: {
    marginLeft: 8,
  },
  progressBarContainer: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 32,
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
  continueBtn: {
    width: '100%',
    backgroundColor: colors.BIDTAXIPRIMARY,
    paddingVertical: 16,
    borderRadius: 8,
    alignItems: 'center',
  },
  continueBtnDisabled: {
    backgroundColor: colors.BORDER_BACKGROUND,
  },
  continueText: {
    color: colors.WHITE,
    fontSize: 18,
    fontWeight: 'bold',
  },
}); 