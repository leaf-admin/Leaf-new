import Logger from '../../../utils/Logger';
import React, { useCallback, useEffect, useState } from 'react';
import { View } from 'react-native';
import { saveStepData } from '../../../utils/secureOnboardingStorage';
import ContinueButton from '../common/ContinueButton';
import EditorialOnboardingScreen from '../common/EditorialOnboardingLayout';
import { RoleCard } from '../../onboarding/onboardingSteps';

const options = [
  {
    key: 'customer',
    title: 'Quero viajar',
    description: 'Peça corridas com preço fechado e pague com Pix.',
    icon: 'navigate-outline'
  },
  {
    key: 'driver',
    title: 'Quero dirigir',
    description: 'Ganhe dirigindo com a Leaf, no seu horário.',
    icon: 'car-outline'
  }
];

function normalizeUserType(userType) {
  if (userType === 'passenger') {
    return 'customer';
  }
  return userType;
}

const ProfileSelectionStep = ({ onProfileSelected, onBack, initialData = {}, progressMeta }) => {
  const [selected, setSelected] = useState(null);

  useEffect(() => {
    const normalizedType = normalizeUserType(initialData?.userType);
    if (!normalizedType) {
      return;
    }

    const match = options.find(item => item.key === normalizedType);
    if (match) {
      setSelected(match);
      Logger.log('ProfileSelectionStep - dados iniciais carregados:', normalizedType);
    }
  }, [initialData?.userType]);

  const handleOptionSelect = useCallback(
    async option => {
      setSelected(option);

      await saveStepData('profile_selection', { userType: option.key });
    },
    []
  );

  const handleContinue = () => {
    if (!selected) {
      return;
    }

    onProfileSelected({
      userType: selected.key,
      timestamp: new Date().toISOString()
    });
  };

  return (
    <EditorialOnboardingScreen
      title="Como você vai usar a Leaf?"
      description="Dá para mudar depois no seu perfil."
      onBack={onBack}
      backTestID="auth-profile-selection-back-btn"
      backAccessibilityLabel="Voltar"
      progressMeta={progressMeta}
      footer={(
        <ContinueButton
          onPress={handleContinue}
          disabled={!selected}
          text="Continuar"
          testID="auth-profile-selection-continue-btn"
          accessibilityLabel="Continuar"
        />
      )}
    >
      <View accessibilityRole="radiogroup">
        {options.map(option => (
          <RoleCard
            key={option.key}
            title={option.title}
            description={option.description}
            icon={option.icon}
            selected={selected?.key === option.key}
            onPress={() => handleOptionSelect(option)}
            testID={`auth-profile-option-${option.key}`}
          />
        ))}
      </View>
    </EditorialOnboardingScreen>
  );
};

export default ProfileSelectionStep;
