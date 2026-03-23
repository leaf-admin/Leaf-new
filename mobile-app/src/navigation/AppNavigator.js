import Logger from '../utils/Logger';
import React, { useEffect, useState } from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { TransitionPresets, createStackNavigator } from '@react-navigation/stack';

import { useSelector, useDispatch } from 'react-redux';

import { Platform, View, Text, ActivityIndicator } from 'react-native';
import featureFlagService from '../services/FeatureFlagService';

// Telas de Autenticação
import LoginScreen from '../screens/LoginScreen';
import OTPScreen from '../screens/OTPScreen';
import Registration from '../screens/Registration';
import PhoneInputScreen from '../screens/PhoneInputScreen';
import ProfileSelectionScreen from '../screens/ProfileSelectionScreen';
import CompleteRegistrationScreen from '../screens/CompleteRegistrationScreen';
import DriverTermsScreen from '../screens/DriverTermsScreen';
import CNHUploadScreen from '../screens/CNHUploadScreen';
import CRLVUploadScreen from '../screens/CRLVUploadScreen';

// Telas Principais
import NewMapScreen from '../screens/NewMapScreen';
import ProfileScreen from '../screens/ProfileScreen';
import SettingsScreen from '../screens/SettingsScreen';
import SearchScreen from '../screens/SearchScreen';
import RideListScreen from '../screens/RideListScreen';
import ChatScreen from '../screens/ChatScreen';
import Notifications from '../screens/Notifications';
import SupportScreen from '../screens/SupportScreen';
import SupportTicketScreen from '../screens/SupportTicketScreen';
import SupportChatScreen from '../screens/SupportChatScreen';
import WaitListScreen from '../screens/WaitListScreen';
import WooviDriverBalanceScreen from '../screens/WooviDriverBalanceScreen';
import HelpScreen from '../screens/HelpScreen';
import AboutScreen from '../screens/AboutScreen';
import LegalScreen from '../screens/LegalScreen';
import PrivacyPolicyScreen from '../screens/PrivacyPolicyScreen';

// Telas de Motorista
import DriverDashboardScreen from '../screens/DriverDashboardScreen';
import DriverBalanceScreen from '../screens/DriverBalanceScreen';
import DriverTrips from '../screens/DriverTrips';
import DriverRating from '../screens/DriverRating';
import DriverDocumentsScreen from '../screens/DriverDocumentsScreen';
import DriverSearchScreen from '../screens/DriverSearchScreen';
import DriverIncomeScreen from '../screens/DriverIncomeScreen';
import WeeklyPaymentScreen from '../screens/WeeklyPaymentScreen';
import EarningsReportScreen from '../screens/EarningsReportScreen';
import SubscriptionManagementScreen from '../screens/SubscriptionManagementScreen';

// Telas de Pagamento
import PaymentSuccessScreen from '../screens/PaymentSuccessScreen';
import PaymentFailedScreen from '../screens/PaymentFailedScreen';
import SelectGatewayScreen from '../screens/SelectGatewayScreen';
import PaymentDetails from '../screens/PaymentDetails';
import AddPaymentMethod from '../screens/AddPaymentMethod';
import AddMoney from '../screens/AddMoney';
import WithdrawMoney from '../screens/WithdrawMoney';
import WalletDetails from '../screens/WalletDetails';

// Telas de Perfil e Configuração
import EditProfile from '../screens/EditProfile';
import EditProfileScreen from '../screens/EditProfileScreen';
import PersonalDataScreen from '../screens/PersonalDataScreen';
import UserInfoScreen from '../screens/UserInfoScreen';
import AddVehicleScreen from '../screens/AddVehicleScreen';
import MyVehiclesScreen from '../screens/MyVehiclesScreen';
import CarEditScreen from '../screens/CarEditScreen';
import CarsScreen from '../screens/CarsScreen';

// Telas de Viagem
import BookedCabScreen from '../screens/BookedCabScreen';
import TripTrackingScreen from '../screens/TripTrackingScreen';
import RideDetails from '../screens/RideDetails';
import CancellationScreen from '../screens/CancellationScreen';
import FeedbackScreen from '../screens/FeedbackScreen';
import Complain from '../screens/Complain';
import ReceiptScreen from '../screens/ReceiptScreen';

// Telas de Onboarding
import SplashScreen from '../screens/SplashScreen';
import WelcomeScreen from '../screens/WelcomeScreen';
import AuthLoadingScreen from '../screens/AuthLoadingScreen';
import FreeTrialScreen from '../screens/FreeTrialScreen';
import PlanSelectionScreen from '../screens/PlanSelectionScreen';
import ReferralScreen from '../screens/ReferralScreen';
import BaaSAccountScreen from '../screens/BaaSAccountScreen';

// Telas de Teste
import ProfileToggleTestScreen from '../screens/ProfileToggleTestScreen';
import ToggleTestScreen from '../screens/ToggleTestScreen';
import RideFlowTestScreen from '../screens/RideFlowTestScreen';
import RobotaxiPrototypeScreen from '../screens/RobotaxiPrototypeScreen';
import RobotaxiDestinationScreen from '../screens/prototype/RobotaxiDestinationScreen';
import RobotaxiBookingScreen from '../screens/prototype/RobotaxiBookingScreen';
import RobotaxiDriverSearchScreen from '../screens/prototype/RobotaxiDriverSearchScreen';
import RobotaxiTripScreen from '../screens/prototype/RobotaxiTripScreen';
import RobotaxiProfileScreen from '../screens/prototype/RobotaxiProfileScreen';
import RobotaxiSettingsScreen from '../screens/prototype/RobotaxiSettingsScreen';
import RobotaxiMenuScreen from '../screens/prototype/RobotaxiMenuScreen';
import RobotaxiMenuDetailScreen from '../screens/prototype/RobotaxiMenuDetailScreen';
import RobotaxiPaymentScreen from '../screens/prototype/RobotaxiPaymentScreen';
import RobotaxiPaymentSuccessScreen from '../screens/prototype/RobotaxiPaymentSuccessScreen';
import RobotaxiPaymentFailedScreen from '../screens/prototype/RobotaxiPaymentFailedScreen';
import RobotaxiNoDriversScreen from '../screens/prototype/RobotaxiNoDriversScreen';
import RobotaxiChatScreen from '../screens/prototype/RobotaxiChatScreen';
import RobotaxiSupportScreen from '../screens/prototype/RobotaxiSupportScreen';
import RobotaxiReceiptScreen from '../screens/prototype/RobotaxiReceiptScreen';
import RobotaxiCancellationScreen from '../screens/prototype/RobotaxiCancellationScreen';
import RobotaxiRatingScreen from '../screens/prototype/RobotaxiRatingScreen';
import RobotaxiComplainScreen from '../screens/prototype/RobotaxiComplainScreen';
import RobotaxiDriverPanelScreen from '../screens/prototype/RobotaxiDriverPanelScreen';
import RobotaxiDriverOfferScreen from '../screens/prototype/RobotaxiDriverOfferScreen';
import RobotaxiDriverTripScreen from '../screens/prototype/RobotaxiDriverTripScreen';
import RobotaxiDriverActivationScreen from '../screens/prototype/RobotaxiDriverActivationScreen';

// Componentes
// LoadingScreen removido - não é mais necessário

const Stack = createStackNavigator();

const verticalScreenOptions = {
  headerShown: false,
  animationEnabled: true,
  ...(Platform.OS === 'ios' ? TransitionPresets.ModalPresentationIOS : TransitionPresets.DefaultTransition)
};

const prototypeOverlayScreenOptions = {
  headerShown: false,
  presentation: 'transparentModal',
  animationEnabled: false,
  gestureEnabled: false,
  cardOverlayEnabled: false,
  cardStyle: { backgroundColor: 'transparent' },
  detachPreviousScreen: false
};

// Navegação direta sem menu inferior

// Navegação principal do app
function MainNavigator() {
  const auth = useSelector(state => state.auth);
  const profileToggle = useSelector(state => state.profileToggle);
  const [authCompleted, setAuthCompleted] = useState(false);
  const [prototypeUiEnabled, setPrototypeUiEnabled] = useState(true);
  const [flagsReady, setFlagsReady] = useState(false);

  useEffect(() => {
    // Resetar o estado quando a autenticação for completada
    if (auth.profile && auth.profile.usertype) {
      setAuthCompleted(true);
    }
  }, [auth.profile]);

  useEffect(() => {
    let isMounted = true;
    let removeListener = null;

    const loadPrototypeFlag = async () => {
      try {
        await featureFlagService.initialize();
        const enabled = await featureFlagService.getFlag('PROTOTYPE_ROBOTAXI_UI_ENABLED', true);

        if (isMounted) {
          setPrototypeUiEnabled(Boolean(enabled));
          setFlagsReady(true);
        }

        removeListener = featureFlagService.addListener('PROTOTYPE_ROBOTAXI_UI_ENABLED', newValue => {
          if (isMounted) {
            setPrototypeUiEnabled(Boolean(newValue));
          }
        });
      } catch (error) {
        Logger.error('❌ [AppNavigator] Erro ao carregar flag de protótipo:', error);
        if (isMounted) {
          setPrototypeUiEnabled(true);
          setFlagsReady(true);
        }
      }
    };

    loadPrototypeFlag();

    return () => {
      isMounted = false;
      if (typeof removeListener === 'function') {
        removeListener();
      }
    };
  }, []);

  if (!flagsReady) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#F8FAFC' }}>
        <ActivityIndicator size="large" color="#1A330E" />
        <Text style={{ marginTop: 8, color: '#4E5A6B' }}>Carregando configuração de interface...</Text>
      </View>
    );
  }

  // Se a autenticação foi completada, mostrar navegação principal
  if (authCompleted) {
    // Resetar o estado para futuras sessões
    setAuthCompleted(false);
  }

  // Se não há usuário autenticado, mostrar SplashScreen que faz a verificação
  // ✅ CRÍTICO: Adicionar rotas públicas (acessíveis sem login)
  if (!auth.profile) {
    return (
      <Stack.Navigator
        key={prototypeUiEnabled ? 'public-prototype' : 'public-legacy'}
        initialRouteName={'RobotaxiPrototypePayment'}
        screenOptions={verticalScreenOptions}
      >
        <Stack.Screen
          name="RobotaxiPrototype"
          component={RobotaxiPrototypeScreen}
          options={{ headerShown: false }}
        />
        <Stack.Screen
          name="RobotaxiPrototypeDestination"
          component={RobotaxiDestinationScreen}
          options={prototypeOverlayScreenOptions}
        />
        <Stack.Screen
          name="RobotaxiPrototypeBooking"
          component={RobotaxiBookingScreen}
          options={prototypeOverlayScreenOptions}
        />
        <Stack.Screen
          name="RobotaxiPrototypeDriverSearch"
          component={RobotaxiDriverSearchScreen}
          options={prototypeOverlayScreenOptions}
        />
        <Stack.Screen
          name="RobotaxiPrototypeTrip"
          component={RobotaxiTripScreen}
          options={prototypeOverlayScreenOptions}
        />
        <Stack.Screen
          name="RobotaxiPrototypePayment"
          component={RobotaxiPaymentScreen}
          options={prototypeOverlayScreenOptions}
        />
        <Stack.Screen
          name="RobotaxiPrototypePaymentSuccess"
          component={RobotaxiPaymentSuccessScreen}
          options={prototypeOverlayScreenOptions}
        />
        <Stack.Screen
          name="RobotaxiPrototypePaymentFailed"
          component={RobotaxiPaymentFailedScreen}
          options={prototypeOverlayScreenOptions}
        />
        <Stack.Screen
          name="RobotaxiPrototypeNoDrivers"
          component={RobotaxiNoDriversScreen}
          options={prototypeOverlayScreenOptions}
        />
        <Stack.Screen
          name="RobotaxiPrototypeChat"
          component={RobotaxiChatScreen}
          options={prototypeOverlayScreenOptions}
        />
        <Stack.Screen
          name="RobotaxiPrototypeSupport"
          component={RobotaxiSupportScreen}
          options={prototypeOverlayScreenOptions}
        />
        <Stack.Screen
          name="RobotaxiPrototypeReceipt"
          component={RobotaxiReceiptScreen}
          options={prototypeOverlayScreenOptions}
        />
        <Stack.Screen
          name="RobotaxiPrototypeCancellation"
          component={RobotaxiCancellationScreen}
          options={prototypeOverlayScreenOptions}
        />
        <Stack.Screen
          name="RobotaxiPrototypeRating"
          component={RobotaxiRatingScreen}
          options={prototypeOverlayScreenOptions}
        />
        <Stack.Screen
          name="RobotaxiPrototypeComplain"
          component={RobotaxiComplainScreen}
          options={prototypeOverlayScreenOptions}
        />
        <Stack.Screen
          name="RobotaxiPrototypeDriverPanel"
          component={RobotaxiDriverPanelScreen}
          options={prototypeOverlayScreenOptions}
        />
        <Stack.Screen
          name="RobotaxiPrototypeDriverActivation"
          component={RobotaxiDriverActivationScreen}
          options={prototypeOverlayScreenOptions}
        />
        <Stack.Screen
          name="RobotaxiPrototypeDriverOffer"
          component={RobotaxiDriverOfferScreen}
          options={prototypeOverlayScreenOptions}
        />
        <Stack.Screen
          name="RobotaxiPrototypeDriverTrip"
          component={RobotaxiDriverTripScreen}
          options={prototypeOverlayScreenOptions}
        />
        <Stack.Screen
          name="RobotaxiPrototypeProfile"
          component={RobotaxiProfileScreen}
          options={prototypeOverlayScreenOptions}
        />
        <Stack.Screen
          name="RobotaxiPrototypeSettings"
          component={RobotaxiSettingsScreen}
          options={prototypeOverlayScreenOptions}
        />
        <Stack.Screen
          name="RobotaxiPrototypeMenu"
          component={RobotaxiMenuScreen}
          options={prototypeOverlayScreenOptions}
        />
        <Stack.Screen
          name="RobotaxiMenuEditProfile"
          component={RobotaxiMenuDetailScreen}
          options={prototypeOverlayScreenOptions}
        />
        <Stack.Screen
          name="RobotaxiMenuTripHistory"
          component={RobotaxiMenuDetailScreen}
          options={prototypeOverlayScreenOptions}
        />
        <Stack.Screen
          name="RobotaxiMenuMessages"
          component={RobotaxiMenuDetailScreen}
          options={prototypeOverlayScreenOptions}
        />
        <Stack.Screen
          name="RobotaxiMenuHelp"
          component={RobotaxiMenuDetailScreen}
          options={prototypeOverlayScreenOptions}
        />
        <Stack.Screen
          name="Splash"
          component={SplashScreen}
          options={{ headerShown: false }}
        />
        {/* ✅ Rotas públicas - acessíveis sem login */}
        <Stack.Screen
          name="Legal"
          component={LegalScreen}
          options={{ headerShown: true, title: 'Informações Legais' }}
        />
        <Stack.Screen
          name="PrivacyPolicy"
          component={PrivacyPolicyScreen}
          options={{ headerShown: true, title: 'Política de Privacidade' }}
        />
      </Stack.Navigator>
    );
  }

  // 🔍 VERIFICAR SE USUÁRIO ESTÁ COMPLETO (tem usertype)
  if (!auth.profile.usertype) {
    Logger.log('AppNavigator - 🔍 Usuário autenticado mas incompleto, mostrando SplashScreen');
    return (
      <Stack.Navigator screenOptions={verticalScreenOptions}>
        <Stack.Screen
          name="Splash"
          component={SplashScreen}
          options={{ headerShown: false }}
        />
      </Stack.Navigator>
    );
  }

  // Se há usuário autenticado, mostrar navegação principal baseada no tipo
  const authUserType = auth.profile.usertype;

  // Feature Toggle: Usar o Redux state (passenger -> customer para manter compatibilidade no Navigator)
  const toggleMode = profileToggle?.currentMode === 'passenger' ? 'customer' : profileToggle?.currentMode;

  // Prioridade de Role: O estado do Toggle é o ativo, senão fallback para o Cadastro Original
  const activeRole = toggleMode || authUserType;

  return (
    <Stack.Navigator
      key={prototypeUiEnabled ? 'private-prototype' : 'private-legacy'}
      initialRouteName={prototypeUiEnabled ? 'RobotaxiPrototype' : 'Map'}
      screenOptions={verticalScreenOptions}
    >
      {/* Tela principal baseada no tipo de usuário */}
      {activeRole === 'customer' ? (
        <Stack.Screen
          name="Map"
          component={NewMapScreen}
          options={{
            // ✅ Prevenir ajuste quando teclado abre
            keyboardHandlingEnabled: false
          }}
        />
      ) : activeRole === 'driver' ? (
        <Stack.Screen
          name="Map"
          component={NewMapScreen}
          options={{
            keyboardHandlingEnabled: false
          }}
        />
      ) : (
        // Fallback para usuários sem tipo definido
        <Stack.Screen
          name="Map"
          component={NewMapScreen}
          options={{
            keyboardHandlingEnabled: false
          }}
        />
      )}

      {/* Telas compartilhadas */}
      <Stack.Screen name="Search" component={SearchScreen} />
      <Stack.Screen name="Chat" component={ChatScreen} />
      <Stack.Screen name="Notifications" component={Notifications} />
      <Stack.Screen name="Settings" component={SettingsScreen} />
      <Stack.Screen name="Help" component={HelpScreen} />
      <Stack.Screen name="About" component={AboutScreen} />
      <Stack.Screen name="Legal" component={LegalScreen} />
      <Stack.Screen name="PrivacyPolicy" component={PrivacyPolicyScreen} />

      {/* Telas do menu inferior (agora acessíveis via menu sanduíche) */}
      <Stack.Screen name="Rides" component={RideListScreen} />
      <Stack.Screen name="Profile" component={ProfileScreen} />
      <Stack.Screen name="Support" component={SupportScreen} />
      <Stack.Screen name="Dashboard" component={DriverDashboardScreen} />
      <Stack.Screen
        name="Trips"
        component={DriverTrips}
        options={{
          headerShown: true,
        }}
      />

      {/* Telas de perfil */}
      <Stack.Screen name="EditProfile" component={EditProfile} />
      <Stack.Screen name="EditProfileScreen" component={EditProfileScreen} />
      <Stack.Screen name="PersonalData" component={PersonalDataScreen} />
      <Stack.Screen name="UserInfo" component={UserInfoScreen} />

      {/* Telas de veículos */}
      <Stack.Screen name="AddVehicle" component={AddVehicleScreen} />
      <Stack.Screen name="MyVehicles" component={MyVehiclesScreen} />
      <Stack.Screen name="CarEdit" component={CarEditScreen} />
      <Stack.Screen name="Cars" component={CarsScreen} />

      {/* Telas de viagem */}
      <Stack.Screen name="BookedCab" component={BookedCabScreen} />
      <Stack.Screen name="TripTracking" component={TripTrackingScreen} />
      <Stack.Screen name="RideDetails" component={RideDetails} />
      <Stack.Screen name="Receipt" component={ReceiptScreen} />
      <Stack.Screen name="Cancellation" component={CancellationScreen} />
      <Stack.Screen name="Feedback" component={FeedbackScreen} />
      <Stack.Screen name="Complain" component={Complain} />

      {/* Telas de pagamento */}
      <Stack.Screen name="PaymentSuccess" component={PaymentSuccessScreen} />
      <Stack.Screen name="PaymentFailed" component={PaymentFailedScreen} />
      <Stack.Screen name="SelectGateway" component={SelectGatewayScreen} />
      <Stack.Screen name="PaymentDetails" component={PaymentDetails} />
      <Stack.Screen name="AddPaymentMethod" component={AddPaymentMethod} />
      <Stack.Screen name="AddMoney" component={AddMoney} />
      <Stack.Screen name="WithdrawMoney" component={WithdrawMoney} />
      <Stack.Screen name="WalletDetails" component={WalletDetails} />

      {/* Telas de suporte */}
      <Stack.Screen name="SupportTicket" component={SupportTicketScreen} />
      <Stack.Screen name="SupportChat" component={SupportChatScreen} />
      <Stack.Screen name="WaitList" component={WaitListScreen} />
      <Stack.Screen name="WooviDriverBalance" component={WooviDriverBalanceScreen} />

      {/* Telas de relatórios e ganhos (disponível para todos) */}
      <Stack.Screen name="EarningsReport" component={EarningsReportScreen} />

      {/* Telas específicas de motorista */}
      {activeRole === 'driver' && (
        <>
          <Stack.Screen name="DriverBalance" component={DriverBalanceScreen} />
          <Stack.Screen name="DriverRating" component={DriverRating} />
          <Stack.Screen name="DriverSearch" component={DriverSearchScreen} />
          <Stack.Screen name="DriverIncome" component={DriverIncomeScreen} />
          <Stack.Screen name="WeeklyPayment" component={WeeklyPaymentScreen} />
          <Stack.Screen name="SubscriptionManagement" component={SubscriptionManagementScreen} />
        </>
      )}

      {/* Tela de upload de documentos (disponível durante onboarding para drivers) */}
      <Stack.Screen
        name="DriverDocuments"
        component={DriverDocumentsScreen}
        options={{
          // Só permite acesso se for driver ou se estiver no contexto de onboarding
          gestureEnabled: false,
          headerShown: false
        }}
      />

      {/* Telas de onboarding antigas (mantidas para compatibilidade) */}
      <Stack.Screen name="WelcomeScreen" component={WelcomeScreen} />
      <Stack.Screen name="ProfileSelectionScreen" component={ProfileSelectionScreen} />
      <Stack.Screen name="CompleteRegistration" component={CompleteRegistrationScreen} />
      <Stack.Screen name="DriverTerms" component={DriverTermsScreen} />
      <Stack.Screen name="CNHUploadScreen" component={CNHUploadScreen} />
      <Stack.Screen name="CRLVUploadScreen" component={CRLVUploadScreen} />
      <Stack.Screen name="CNHUpload" component={CNHUploadScreen} />
      <Stack.Screen name="CRLVUpload" component={CRLVUploadScreen} />
      <Stack.Screen name="OTP" component={OTPScreen} options={{ headerShown: false }} />
      <Stack.Screen name="Referral" component={ReferralScreen} />
      <Stack.Screen name="BaaSAccount" component={BaaSAccountScreen} />
      <Stack.Screen
        name="PhoneInputScreen"
        component={PhoneInputScreen}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="PhoneScreen"
        component={PhoneInputScreen}
        options={{ headerShown: false }}
      />

      {/* Telas de teste */}
      <Stack.Screen name="ProfileToggleTest" component={ProfileToggleTestScreen} />
      <Stack.Screen name="ToggleTest" component={ToggleTestScreen} />
      <Stack.Screen name="RideFlowTest" component={RideFlowTestScreen} />
      <Stack.Screen
        name="RobotaxiPrototype"
        component={RobotaxiPrototypeScreen}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="RobotaxiPrototypeDestination"
        component={RobotaxiDestinationScreen}
        options={prototypeOverlayScreenOptions}
      />
      <Stack.Screen
        name="RobotaxiPrototypeBooking"
        component={RobotaxiBookingScreen}
        options={prototypeOverlayScreenOptions}
      />
      <Stack.Screen
        name="RobotaxiPrototypeDriverSearch"
        component={RobotaxiDriverSearchScreen}
        options={prototypeOverlayScreenOptions}
      />
      <Stack.Screen
        name="RobotaxiPrototypeTrip"
        component={RobotaxiTripScreen}
        options={prototypeOverlayScreenOptions}
      />
      <Stack.Screen
        name="RobotaxiPrototypePayment"
        component={RobotaxiPaymentScreen}
        options={prototypeOverlayScreenOptions}
      />
      <Stack.Screen
        name="RobotaxiPrototypePaymentSuccess"
        component={RobotaxiPaymentSuccessScreen}
        options={prototypeOverlayScreenOptions}
      />
      <Stack.Screen
        name="RobotaxiPrototypePaymentFailed"
        component={RobotaxiPaymentFailedScreen}
        options={prototypeOverlayScreenOptions}
      />
      <Stack.Screen
        name="RobotaxiPrototypeNoDrivers"
        component={RobotaxiNoDriversScreen}
        options={prototypeOverlayScreenOptions}
      />
      <Stack.Screen
        name="RobotaxiPrototypeChat"
        component={RobotaxiChatScreen}
        options={prototypeOverlayScreenOptions}
      />
      <Stack.Screen
        name="RobotaxiPrototypeSupport"
        component={RobotaxiSupportScreen}
        options={prototypeOverlayScreenOptions}
      />
      <Stack.Screen
        name="RobotaxiPrototypeReceipt"
        component={RobotaxiReceiptScreen}
        options={prototypeOverlayScreenOptions}
      />
      <Stack.Screen
        name="RobotaxiPrototypeCancellation"
        component={RobotaxiCancellationScreen}
        options={prototypeOverlayScreenOptions}
      />
      <Stack.Screen
        name="RobotaxiPrototypeRating"
        component={RobotaxiRatingScreen}
        options={prototypeOverlayScreenOptions}
      />
      <Stack.Screen
        name="RobotaxiPrototypeComplain"
        component={RobotaxiComplainScreen}
        options={prototypeOverlayScreenOptions}
      />
      <Stack.Screen
        name="RobotaxiPrototypeDriverPanel"
        component={RobotaxiDriverPanelScreen}
        options={prototypeOverlayScreenOptions}
      />
      <Stack.Screen
        name="RobotaxiPrototypeDriverActivation"
        component={RobotaxiDriverActivationScreen}
        options={prototypeOverlayScreenOptions}
      />
      <Stack.Screen
        name="RobotaxiPrototypeDriverOffer"
        component={RobotaxiDriverOfferScreen}
        options={prototypeOverlayScreenOptions}
      />
      <Stack.Screen
        name="RobotaxiPrototypeDriverTrip"
        component={RobotaxiDriverTripScreen}
        options={prototypeOverlayScreenOptions}
      />
      <Stack.Screen
        name="RobotaxiPrototypeProfile"
        component={RobotaxiProfileScreen}
        options={prototypeOverlayScreenOptions}
      />
      <Stack.Screen
        name="RobotaxiPrototypeSettings"
        component={RobotaxiSettingsScreen}
        options={prototypeOverlayScreenOptions}
      />
      <Stack.Screen
        name="RobotaxiPrototypeMenu"
        component={RobotaxiMenuScreen}
        options={prototypeOverlayScreenOptions}
      />
      <Stack.Screen
        name="RobotaxiMenuEditProfile"
        component={RobotaxiMenuDetailScreen}
        options={prototypeOverlayScreenOptions}
      />
      <Stack.Screen
        name="RobotaxiMenuTripHistory"
        component={RobotaxiMenuDetailScreen}
        options={prototypeOverlayScreenOptions}
      />
      <Stack.Screen
        name="RobotaxiMenuMessages"
        component={RobotaxiMenuDetailScreen}
        options={prototypeOverlayScreenOptions}
      />
      <Stack.Screen
        name="RobotaxiMenuHelp"
        component={RobotaxiMenuDetailScreen}
        options={prototypeOverlayScreenOptions}
      />
    </Stack.Navigator>
  );
}

export default function AppNavigator() {
  return (
    <NavigationContainer>
      <MainNavigator />
    </NavigationContainer>
  );
}
