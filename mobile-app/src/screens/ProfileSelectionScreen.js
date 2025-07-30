import React, { useState, useRef } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Animated, Dimensions, Image } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import AsyncStorage from '@react-native-async-storage/async-storage';

const { width, height } = Dimensions.get('window');

// Constantes de cores
const WHITE = '#FFFFFF';
const BLACK = '#000000';
const GRAY = '#666666';
const LIGHT_GRAY = '#F5F5F5';
const DARK_GRAY = '#333333';

const options = [
  {
    key: 'passenger',
    title: 'Quero viajar',
    symbol: '💼',
    description: [
      'Faça viagens com total segurança',
      'Melhores carros e melhores motoristas',
    ],
  },
  {
    key: 'driver',
    title: 'Quero dirigir',
    symbol: '$',
    description: [
      'Dirija e ganhe com suas viagens',
      'Receba até 99% do valor pago',
    ],
  },
];

export default function ProfileSelectionScreen() {
  const navigation = useNavigation();
  const [selected, setSelected] = useState(null);
  const [termsAccepted, setTermsAccepted] = useState(false);
  const cardAnim = useRef(new Animated.Value(0)).current;
  const descriptionAnim = useRef(new Animated.Value(0)).current;

  React.useEffect(() => {
    // Animação simples: deslize de baixo para cima sem bounce
    Animated.spring(cardAnim, {
      toValue: 1,
      tension: 100,
      friction: 12,
      useNativeDriver: true,
    }).start();
  }, []);

  const handleOptionPress = (optionKey) => {
    if (selected === optionKey) {
      // Se clicar na mesma opção, desmarca
      setSelected(null);
      Animated.timing(descriptionAnim, {
        toValue: 0,
        duration: 200,
        useNativeDriver: true,
      }).start();
    } else {
      // Seleciona nova opção
      setSelected(optionKey);
      Animated.timing(descriptionAnim, {
        toValue: 1,
        duration: 300,
        useNativeDriver: true,
      }).start();
    }
  };

  const handleContinue = async () => {
    if (selected && termsAccepted) {
      await AsyncStorage.setItem('@user_type', selected);
      navigation.navigate('PhoneInput', { userType: selected });
    }
  };

  const selectedOption = options.find(option => option.key === selected);

  return (
    <View style={styles.container}>
      {/* Background com cor estática */}
      <View style={styles.backgroundContainer} />
      
      {/* Logo da Leaf no topo */}
      <View style={styles.logoContainer}>
        <Image 
          source={require('../../assets/images/leaftransparentbg.png')}
          style={styles.logo}
          resizeMode="contain"
        />
      </View>

      {/* BOTTOM SHEET */}
      <Animated.View 
        style={[
          styles.bottomSheet,
          {
            transform: [
              { 
                translateY: cardAnim.interpolate({
                  inputRange: [0, 1],
                  outputRange: [height, 0]
                })
              }
            ]
          }
        ]}
      >
        {/* Handle do bottom sheet */}
        <View style={styles.handle} />
        
        {/* Título do card */}
        <Text style={styles.cardTitle}>Escolha seu perfil</Text>
        
        {/* Opções */}
        <View style={styles.optionsContainer}>
          {options.map((option, index) => {
            const isSelected = selected === option.key;
            
            return (
              <TouchableOpacity
                key={option.key}
                style={[
                  styles.optionCard,
                  isSelected && styles.optionCardSelected
                ]}
                onPress={() => handleOptionPress(option.key)}
                activeOpacity={0.7}
              >
                <View style={styles.optionContent}>
                  {/* Radio button */}
                  <View style={styles.radioContainer}>
                    <View style={[
                      styles.radioButton,
                      isSelected && styles.radioButtonSelected
                    ]}>
                      {isSelected && <View style={styles.radioDot} />}
                    </View>
                  </View>
                  
                  {/* Conteúdo da opção */}
                  <View style={styles.optionTextContainer}>
                    <Text style={styles.optionTitle}>
                      {option.title}
                    </Text>
                    
                    {/* Descrição sempre visível */}
                    {option.description.map((line, i) => (
                      <Text key={i} style={styles.optionDescription}>
                        {line}
                      </Text>
                    ))}
                  </View>
                </View>
              </TouchableOpacity>
            );
          })}
        </View>

        {/* Checkbox de Termos */}
        <View style={styles.termsContainer}>
          <TouchableOpacity 
            style={[styles.checkbox, termsAccepted && styles.checkboxChecked]}
            onPress={() => setTermsAccepted(!termsAccepted)}
          >
            {termsAccepted && <Text style={styles.checkmark}>✓</Text>}
          </TouchableOpacity>
          <Text style={styles.termsText}>
            Li e aceito os{' '}
            <Text style={styles.termsLink}>Termos de Uso</Text>
            {' '}e a{' '}
            <Text style={styles.termsLink}>Política de Privacidade</Text>
          </Text>
        </View>

        {/* Botão continuar */}
        <TouchableOpacity
          style={[
            styles.continueButton,
            (!selected || !termsAccepted) && styles.continueButtonDisabled
          ]}
          onPress={handleContinue}
          disabled={!selected || !termsAccepted}
          activeOpacity={0.8}
        >
          <Text style={[
            styles.continueButtonText,
            (!selected || !termsAccepted) && styles.continueButtonTextDisabled
          ]}>
            Continuar
          </Text>
        </TouchableOpacity>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  
  // Background com cor estática
  backgroundContainer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: '#1A330E', // Cor estática para o fundo
    width: width,
    height: height,
  },
  
  // Logo da Leaf
  logoContainer: {
    position: 'absolute',
    top: 60,
    left: 0,
    right: 0,
    alignItems: 'center',
    zIndex: 1,
  },
  logo: {
    width: 389,
    height: 194,
  },
  
  // BOTTOM SHEET
  bottomSheet: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: WHITE,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 32,
    paddingBottom: 40,
    height: height * 0.55 + 75,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.1,
    shadowRadius: 12,
    elevation: 8,
  },
  handle: {
    width: 40,
    height: 6,
    backgroundColor: '#E5E7EB',
    borderRadius: 3,
    alignSelf: 'center',
    marginBottom: 20,
  },
  
  // Título do card
  cardTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: BLACK,
    textAlign: 'left',
    marginBottom: 32,
  },
  
  // Opções
  optionsContainer: {
    marginBottom: 32,
  },
  optionCard: {
    backgroundColor: WHITE,
    borderRadius: 8,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  optionCardSelected: {
    borderColor: '#1A330E',
    borderWidth: 2,
  },
  optionContent: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  radioContainer: {
    marginRight: 12,
    marginTop: 2,
  },
  radioButton: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 2,
    borderColor: '#D1D5DB',
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioButtonSelected: {
    borderColor: '#1A330E',
  },
  radioDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#1A330E',
  },
  optionTextContainer: {
    flex: 1,
  },
  optionTitle: {
    fontSize: 16,
    fontWeight: 'normal',
    color: BLACK,
    marginBottom: 6,
  },
  optionDescription: {
    fontSize: 13,
    color: GRAY,
    lineHeight: 16,
    marginBottom: 2,
  },
  
  // Termos
  termsContainer: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 20,
  },
  checkbox: {
    width: 18,
    height: 18,
    borderRadius: 3,
    borderWidth: 2,
    borderColor: '#D1D5DB',
    marginRight: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxChecked: {
    backgroundColor: '#1A330E',
    borderColor: '#1A330E',
  },
  checkmark: {
    color: WHITE,
    fontSize: 10,
    fontWeight: 'bold',
  },
  termsText: {
    flex: 1,
    fontSize: 13,
    color: GRAY,
    lineHeight: 18,
  },
  termsLink: {
    color: '#1A330E',
    fontWeight: '600',
    textDecorationLine: 'underline',
  },
  
  // Botão
  continueButton: {
    backgroundColor: '#1A330E',
    borderRadius: 8,
    paddingVertical: 14,
    alignItems: 'center',
    shadowColor: '#1A330E',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 4,
  },
  continueButtonDisabled: {
    backgroundColor: '#D1D5DB',
    shadowOpacity: 0,
    elevation: 0,
  },
  continueButtonText: {
    fontSize: 15,
    fontWeight: 'bold',
    color: WHITE,
  },
  continueButtonTextDisabled: {
    color: '#9CA3AF',
  },
}); 