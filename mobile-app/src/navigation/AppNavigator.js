import Logger from '../utils/Logger';
import React, { useEffect, useState } from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createStackNavigator } from '@react-navigation/stack';

import { useSelector, useDispatch } from 'react-redux';

import { View, Text, ActivityIndicator } from 'react-native';

// Telas de Autenticação
import LoginScreen from '../screens/LoginScreen';
import OTPScreen from '../screens/OTPScreen';
import Registration from '../screens/Registration';
import PhoneInputScreen from '../screens/PhoneInputScreen';
import ProfileSelectionScreen from '../screens/ProfileSelectionScreen';
import CompleteRegistrationScreen from '../screens/CompleteRegistrationScreen';
import DriverTermsScreen from '../screens/DriverTermsScreen';

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

// Componentes
// LoadingScreen removido - não é mais necessário

const Stack = createStackNavigator();

// Navegação direta sem menu inferior

// Navegação principal do app
function MainNavigator() {
  const auth = useSelector(state => state.auth);
  const profileToggle = useSelector(state => state.profileToggle);
  const [authCompleted, setAuthCompleted] = useState(false);

  useEffect(() => {
    // Resetar o estado quando a autenticação for completada
    if (auth.profile && auth.profile.usertype) {
      setAuthCompleted(true);
    }
  }, [auth.profile]);

  // Se a autenticação foi completada, mostrar navegação principal
  if (authCompleted) {
    // Resetar o estado para futuras sessões
    setAuthCompleted(false);
  }

  // Se não há usuário autenticado, mostrar SplashScreen que faz a verificação
  // ✅ CRÍTICO: Adicionar rotas públicas (acessíveis sem login)
  if (!auth.profile) {
    return (
      <Stack.Navigator screenOptions={{ headerShown: false }}>
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
      <Stack.Navigator screenOptions={{ headerShown: false }}>
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
    <Stack.Navigator screenOptions={{ headerShown: false }}>
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
      <Stack.Screen name="Referral" component={ReferralScreen} />
      <Stack.Screen name="BaaSAccount" component={BaaSAccountScreen} />
      <Stack.Screen
        name="PhoneInputScreen"
        component={PhoneInputScreen}
        options={{ headerShown: false }}
      />

      {/* Telas de teste */}
      <Stack.Screen name="ProfileToggleTest" component={ProfileToggleTestScreen} />
      <Stack.Screen name="ToggleTest" component={ToggleTestScreen} />
      <Stack.Screen name="RideFlowTest" component={RideFlowTestScreen} />
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
