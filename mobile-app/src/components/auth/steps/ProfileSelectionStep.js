import Logger from '../../../utils/Logger';
import React, { useState, useRef, useEffect, useCallback } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Animated, Dimensions } from 'react-native';
import { fonts } from '../../../common-local/font';
import { Ionicons } from '@expo/vector-icons';
import { saveStepData } from '../../../utils/secureOnboardingStorage';
import ContinueButton from '../common/ContinueButton';


const { width, height } = Dimensions.get('window');

// Constantes de cores
const WHITE = '#FFFFFF';
const BLACK = '#000000';
const GRAY = '#666666';
const LIGHT_GRAY = '#F5F5F5';
const DARK_GRAY = '#333333';
const LEAF_GREEN = '#1A330E';
const BORDER_COLOR = '#E0E0E0';

const options = [
  {
    key: 'passenger',
    title: 'Quero viajar',
    icon: 'car-outline',
    description: 'Faça viagens com total segurança',
  },
  {
    key: 'driver',
    title: 'Quero dirigir',
    icon: 'navigate-outline',
    description: 'Dirija e ganhe com suas viagens',
  },
];

const ProfileSelectionStep = ({ onProfileSelected, onBack, initialData = {} }) => {
  const [selected, setSelected] = useState(null);
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const dropdownAnim = useRef(new Animated.Value(0)).current;
  const rotateAnim = useRef(new Animated.Value(0)).current;

  // Carregar dados iniciais se disponível
  useEffect(() => {
    if (initialData.userType) {
      const option = options.find(opt => opt.key === initialData.userType);
      if (option) {
        setSelected(option);
        Logger.log('ProfileSelectionStep - 📥 Dados iniciais carregados:', initialData);
      }
    }
  }, [initialData]);

  const toggleDropdown = () => {
    setIsDropdownOpen(!isDropdownOpen);
    
    Animated.parallel([
      Animated.timing(dropdownAnim, {
        toValue: isDropdownOpen ? 0 : 1,
        duration: 300,
        useNativeDriver: false,
      }),
      Animated.timing(rotateAnim, {
        toValue: isDropdownOpen ? 0 : 1,
        duration: 300,
        useNativeDriver: false,
      }),
    ]).start();
  };

  const handleOptionSelect = useCallback(async (option) => {
    setSelected(option);
    setIsDropdownOpen(false);
    
    // Salvar automaticamente no AsyncStorage
    await saveStepData('profile_selection', { userType: option.key });
    
    Animated.parallel([
      Animated.timing(dropdownAnim, {
        toValue: 0,
        duration: 200,
        useNativeDriver: false,
      }),
      Animated.timing(rotateAnim, {
        toValue: 0,
        duration: 200,
        useNativeDriver: false,
      }),
    ]).start();
  }, []);

  const handleContinue = () => {
    if (selected) {
      Logger.log('ProfileSelectionStep - 🔄 Usuário selecionou:', selected.key);
      
      const profileData = {
        userType: selected.key,
        timestamp: new Date().toISOString()
      };
      
      onProfileSelected(profileData);
    }
  };

  const selectedOption = options.find(option => option.key === selected?.key);

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Escolha o seu perfil:</Text>

      {/* Dropdown Container */}
      <View style={styles.dropdownContainer}>
        <TouchableOpacity
          style={[
            styles.dropdownButton,
            isDropdownOpen && styles.dropdownButtonActive,
            selected && styles.dropdownButtonSelected
          ]}
          onPress={toggleDropdown}
        >
          <Text style={[
            styles.dropdownButtonText,
            selected && styles.dropdownButtonTextSelected
          ]}>
            {selected ? selected.title : 'Selecione um perfil'}
          </Text>
          <Animated.View
            style={[
              styles.arrowContainer,
              {
                transform: [{
                  rotate: rotateAnim.interpolate({
                    inputRange: [0, 1],
                    outputRange: ['0deg', '180deg']
                  })
                }]
              }
            ]}
          >
            <Ionicons
              name="chevron-down"
              size={24}
              color={selected ? WHITE : GRAY}
            />
          </Animated.View>
        </TouchableOpacity>

        {/* Dropdown Options */}
        <Animated.View
          style={[
            styles.dropdownOptions,
            {
              maxHeight: dropdownAnim.interpolate({
                inputRange: [0, 1],
                outputRange: [0, 200]
              }),
              opacity: dropdownAnim
            }
          ]}
        >
          {options.map((option) => (
            <TouchableOpacity
              key={option.key}
              style={[
                styles.optionItem,
                selected?.key === option.key && styles.optionItemSelected
              ]}
              onPress={() => handleOptionSelect(option)}
            >
              <View style={styles.optionContent}>
                <Ionicons
                  name={option.icon}
                  size={24}
                  color={selected?.key === option.key ? WHITE : LEAF_GREEN}
                />
                <View style={styles.optionTextContainer}>
                  <Text style={[
                    styles.optionTitle,
                    selected?.key === option.key && styles.optionTitleSelected
                  ]}>
                    {option.title}
                  </Text>
                  <Text style={[
                    styles.optionDescription,
                    selected?.key === option.key && styles.optionDescriptionSelected
                  ]}>
                    {option.description}
                  </Text>
                </View>
              </View>
            </TouchableOpacity>
          ))}
        </Animated.View>
      </View>

      {/* Continue Button */}
      <ContinueButton
        onPress={handleContinue}
        disabled={!selected}
        text="Continuar"
      />

      {/* Back Button */}
      <TouchableOpacity
        style={styles.backButton}
        onPress={onBack}
      >
        <Text style={styles.backButtonText}>Voltar</Text>
      </TouchableOpacity>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingHorizontal: 20,
    paddingTop: 20,
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    color: BLACK,
    textAlign: 'center',
    marginBottom: 30,
    fontFamily: fonts.regular,
  },
  dropdownContainer: {
    marginBottom: 30,
  },
  dropdownButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 15,
    backgroundColor: WHITE,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: BORDER_COLOR,
    shadowColor: BLACK,
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  dropdownButtonActive: {
    borderColor: LEAF_GREEN,
    shadowOpacity: 0.2,
  },
  dropdownButtonSelected: {
    backgroundColor: LEAF_GREEN,
    borderColor: LEAF_GREEN,
  },
  dropdownButtonText: {
    fontSize: 16,
    color: GRAY,
    fontFamily: fonts.medium,
  },
  dropdownButtonTextSelected: {
    color: WHITE,
  },
  arrowContainer: {
    marginLeft: 10,
  },
  dropdownOptions: {
    backgroundColor: WHITE,
    borderRadius: 12,
    marginTop: 5,
    shadowColor: BLACK,
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
    overflow: 'hidden',
  },
  optionItem: {
    paddingHorizontal: 20,
    paddingVertical: 15,
    borderBottomWidth: 1,
    borderBottomColor: LIGHT_GRAY,
  },
  optionItemSelected: {
    backgroundColor: LEAF_GREEN,
  },
  optionContent: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  optionTextContainer: {
    marginLeft: 15,
    flex: 1,
  },
  optionTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: BLACK,
    marginBottom: 4,
    fontFamily: fonts.medium,
  },
  optionTitleSelected: {
    color: WHITE,
  },
  optionDescription: {
    fontSize: 14,
    color: GRAY,
    fontFamily: fonts.regular,
  },
  optionDescriptionSelected: {
    color: WHITE,
    opacity: 0.9,
  },

  backButton: {
    paddingVertical: 15,
    alignItems: 'center',
  },
  backButtonText: {
    color: LEAF_GREEN,
    fontSize: 16,
    fontFamily: fonts.medium,
  },
});

export default ProfileSelectionStep;
