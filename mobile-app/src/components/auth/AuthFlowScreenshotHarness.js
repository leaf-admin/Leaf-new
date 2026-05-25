import React, { useEffect, useMemo, useState } from 'react';
import { Linking } from 'react-native';
import AuthFlow from './AuthFlow';

const sharedPhoneData = {
  phoneNumber: '+55 11 98888-7777',
  confirmation: {
    verificationId: 'screenshot-verification-id',
  },
};

const passengerProfileSelection = {
  profileSelection: {
    userType: 'customer',
    timestamp: '2026-05-08T22:00:00.000Z',
  },
};

const passengerProfileData = {
  ...sharedPhoneData,
  ...passengerProfileSelection,
  profileData: {
    fullName: 'Ana Passageira',
    firstName: 'Ana',
    lastName: 'Passageira',
  },
  documentData: {
    email: 'ana@exemplo.com',
  },
  credentials: {
    password: 'Leaf1234',
    confirmPassword: 'Leaf1234',
    acceptTerms: true,
    acceptPrivacy: true,
  },
};

const driverProfileSelection = {
  profileSelection: {
    userType: 'driver',
    timestamp: '2026-05-08T22:00:00.000Z',
  },
};

const driverCnhBaseData = {
  ...sharedPhoneData,
  ...driverProfileSelection,
  user: {
    uid: 'driver-screenshot',
  },
};

const extractedDriverDocumentData = {
  cpf: '123.456.789-09',
  birthDate: '12/04/1990',
  motherName: 'Claudia Souza',
  gender: 'F',
  cnhPdfMeta: {
    name: 'cnh-digital-maria.pdf',
  },
  cnhExtraction: {
    success: true,
    data: {
      cpf: '123.456.789-09',
      dataNascimento: '12/04/1990',
      nomeMae: 'Claudia Souza',
      genero: 'F',
      nome: 'Maria Motorista',
    },
  },
};

const driverCompletedData = {
  ...driverCnhBaseData,
  profileData: {
    fullName: 'Maria Motorista',
    firstName: 'Maria',
    lastName: 'Motorista',
  },
  documentData: extractedDriverDocumentData,
  credentials: {
    acceptTerms: true,
    acceptPrivacy: true,
    consentBackgroundCheck: true,
    marketingOptIn: true,
  },
};

const scenarios = {
  'passenger-phone': {
    step: 0,
    data: {},
  },
  'passenger-otp': {
    step: 1,
    data: sharedPhoneData,
  },
  'passenger-profile': {
    step: 2,
    data: passengerProfileSelection,
  },
  'passenger-data': {
    step: 3,
    data: passengerProfileData,
  },
  'driver-phone': {
    step: 0,
    data: {},
  },
  'driver-otp': {
    step: 1,
    data: sharedPhoneData,
  },
  'driver-profile': {
    step: 2,
    data: driverProfileSelection,
  },
  'driver-cnh-pending': {
    step: 4,
    data: driverCnhBaseData,
  },
  'driver-cnh-extracted': {
    step: 4,
    data: {
      ...driverCnhBaseData,
      documentData: extractedDriverDocumentData,
    },
  },
  'driver-consents': {
    step: 5,
    data: driverCompletedData,
  },
  'driver-email': {
    step: 6,
    data: {
      ...driverCompletedData,
      driverContactData: {
        email: 'maria.motorista@exemplo.com',
      },
      documentData: {
        ...driverCompletedData.documentData,
        email: 'maria.motorista@exemplo.com',
      },
    },
  },
};

function resolveScenarioFromUrl(url) {
  const fallback = 'passenger-phone';
  const cleanUrl = String(url || '');
  const match = cleanUrl.match(/[?&](?:case|scenario)=([^&]+)/);
  const rawScenario = match ? decodeURIComponent(match[1]) : fallback;
  return scenarios[rawScenario] ? rawScenario : fallback;
}

export default function AuthFlowScreenshotHarness() {
  const [scenarioName, setScenarioName] = useState('passenger-phone');

  useEffect(() => {
    let isMounted = true;

    Linking.getInitialURL().then((url) => {
      if (isMounted && url) {
        setScenarioName(resolveScenarioFromUrl(url));
      }
    });

    const subscription = Linking.addEventListener('url', ({ url }) => {
      setScenarioName(resolveScenarioFromUrl(url));
    });

    return () => {
      isMounted = false;
      subscription?.remove?.();
    };
  }, []);

  const scenario = useMemo(() => scenarios[scenarioName] || scenarios['passenger-phone'], [scenarioName]);

  return (
    <AuthFlow
      key={scenarioName}
      visible
      screenshotStep={scenario.step}
      screenshotAuthData={scenario.data}
      onComplete={() => {}}
      onClose={() => {}}
    />
  );
}
