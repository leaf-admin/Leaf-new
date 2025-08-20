import React, { useState, useRef, useCallback } from 'react';
import { View, StyleSheet } from 'react-native';
import BottomSheet, { BottomSheetView, BottomSheetBackdrop } from '@gorhom/bottom-sheet';
import { useDispatch } from 'react-redux';

// Steps de autenticação
import PhoneInputStep from './steps/PhoneInputStep';
import OTPStep from './steps/OTPStep';
import ProfileDataStep from './steps/ProfileDataStep';
import CredentialsStep from './steps/CredentialsStep';

const AuthFlow = ({ visible, onComplete, onClose }) => {
  const [currentStep, setCurrentStep] = useState(0);
  const [authData, setAuthData] = useState({});
  const bottomSheetRef = useRef(null);
  const dispatch = useDispatch();

  // Snap points para o BottomSheet
  const snapPoints = ['90%'];

  // Função para avançar para o próximo step
  const goToNextStep = useCallback(() => {
    setCurrentStep(prev => prev + 1);
  }, []);

  // Função para voltar ao step anterior
  const goToPreviousStep = useCallback(() => {
    setCurrentStep(prev => Math.max(0, prev - 1));
  }, []);

  // Função para salvar dados do step atual
  const saveStepData = useCallback((data) => {
    setAuthData(prev => ({ ...prev, ...data }));
  }, []);

  // Função para lidar com o envio do telefone
  const handlePhoneVerificationSent = useCallback((confirmation, phoneNumber) => {
    saveStepData({ phoneNumber, confirmation });
    goToNextStep();
  }, [saveStepData, goToNextStep]);

  // Função para lidar com a verificação do OTP
  const handleOTPVerified = useCallback((user) => {
    saveStepData({ user });
    goToNextStep();
  }, [saveStepData, goToNextStep]);

  // Função para lidar com o envio dos dados do perfil
  const handleProfileDataSubmitted = useCallback((profileData) => {
    saveStepData({ profileData });
    goToNextStep();
  }, [saveStepData, goToNextStep]);

  // Função para lidar com a criação das credenciais
  const handleCredentialsCreated = useCallback((credentials) => {
    saveStepData({ credentials });
    // Autenticação completa
    if (onComplete) {
      onComplete(authData);
    }
  }, [saveStepData, authData, onComplete]);

  // Função para alternar para o fluxo de registro
  const handleSwitchToRegister = useCallback((phoneNumber) => {
    if (phoneNumber) {
      saveStepData({ phoneNumber });
    }
    // Aqui você pode implementar a lógica para alternar para o fluxo de registro
    // Por enquanto, vamos continuar com o fluxo de login
  }, [saveStepData]);

  // Renderizar o step atual
  const renderCurrentStep = () => {
    switch (currentStep) {
      case 0:
        return (
          <PhoneInputStep
            onVerificationSent={handlePhoneVerificationSent}
            onSwitchToRegister={handleSwitchToRegister}
          />
        );
      case 1:
        return (
          <OTPStep
            phoneNumber={authData.phoneNumber}
            confirmation={authData.confirmation}
            onVerified={handleOTPVerified}
            onBack={goToPreviousStep}
          />
        );
      case 2:
        return (
          <ProfileDataStep
            onSubmitted={handleProfileDataSubmitted}
            onBack={goToPreviousStep}
          />
        );
      case 3:
        return (
          <CredentialsStep
            onCreated={handleCredentialsCreated}
            onBack={goToPreviousStep}
          />
        );
      default:
        return null;
    }
  };

  // Backdrop para fechar o BottomSheet
  const renderBackdrop = useCallback(
    (props) => (
      <BottomSheetBackdrop
        {...props}
        disappearsOnIndex={-1}
        appearsOnIndex={0}
        opacity={0.5}
      />
    ),
    []
  );

  return (
    <BottomSheet
      ref={bottomSheetRef}
      index={visible ? 0 : -1}
      snapPoints={snapPoints}
      enablePanDownToClose={false}
      backdropComponent={renderBackdrop}
      backgroundStyle={styles.bottomSheetBackground}
    >
      <BottomSheetView style={styles.contentContainer}>
        {renderCurrentStep()}
      </BottomSheetView>
    </BottomSheet>
  );
};

const styles = StyleSheet.create({
  bottomSheetBackground: {
    backgroundColor: '#FFFFFF',
  },
  contentContainer: {
    flex: 1,
    paddingHorizontal: 20,
    paddingTop: 20,
  },
});

export default AuthFlow; 