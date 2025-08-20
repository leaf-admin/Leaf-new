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

// Telas de Pagamento
import PaymentSuccessScreen from '../screens/PaymentSuccessScreen';
import PaymentFailedScreen from '../screens/PaymentFailedScreen';
import SelectGatewayScreen from '../screens/SelectGatewayScreen';
import PaymentDetails from '../screens/PaymentDetails';
import AddMoney from '../screens/AddMoney';
import WithdrawMoney from '../screens/WithdrawMoney';
import WalletDetails from '../screens/WalletDetails';

// Telas de Perfil e Configuração
import EditProfile from '../screens/EditProfile';
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

// Componentes
import { LoadingScreen } from '../components/LoadingStates';

const Stack = createStackNavigator();

// Navegação direta sem menu inferior

// Navegação principal do app
function MainNavigator() {
  const auth = useSelector(state => state.auth);
  const [isLoading, setIsLoading] = useState(true);
  const [authCompleted, setAuthCompleted] = useState(false);

  useEffect(() => {
    // Simular tempo de carregamento inicial
    const timer = setTimeout(() => {
      setIsLoading(false);
    }, 1000);

    return () => clearTimeout(timer);
  }, []);

  // Se ainda está carregando, mostrar tela de loading
  if (isLoading) {
    return <LoadingScreen />;
  }

  // Se a autenticação foi completada, mostrar navegação principal
  if (authCompleted) {
    // Resetar o estado para futuras sessões
    setAuthCompleted(false);
  }

  // Se não há usuário autenticado, mostrar SplashScreen
  if (!auth.profile) {
    return (
      <Stack.Navigator screenOptions={{ headerShown: false }}>
        <Stack.Screen 
          name="Splash" 
          component={SplashScreen}
          options={{ headerShown: false }}
          listeners={{
            focus: () => {
              // Resetar o estado quando a SplashScreen receber foco
              setAuthCompleted(false);
            }
          }}
        />
      </Stack.Navigator>
    );
  }

  // Se há usuário autenticado, mostrar navegação principal baseada no tipo
  const userType = auth.profile.usertype;

  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      {/* Tela principal baseada no tipo de usuário */}
      {userType === 'customer' ? (
        <Stack.Screen name="Map" component={NewMapScreen} />
      ) : userType === 'driver' ? (
        <Stack.Screen name="Map" component={NewMapScreen} />
      ) : (
        // Fallback para usuários sem tipo definido
        <Stack.Screen name="Map" component={NewMapScreen} />
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
      <Stack.Screen name="Trips" component={DriverTrips} />
      
      {/* Telas de perfil */}
      <Stack.Screen name="EditProfile" component={EditProfile} />
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
      <Stack.Screen name="Cancellation" component={CancellationScreen} />
      <Stack.Screen name="Feedback" component={FeedbackScreen} />
      <Stack.Screen name="Complain" component={Complain} />
      
      {/* Telas de pagamento */}
      <Stack.Screen name="PaymentSuccess" component={PaymentSuccessScreen} />
      <Stack.Screen name="PaymentFailed" component={PaymentFailedScreen} />
      <Stack.Screen name="SelectGateway" component={SelectGatewayScreen} />
      <Stack.Screen name="PaymentDetails" component={PaymentDetails} />
      <Stack.Screen name="AddMoney" component={AddMoney} />
      <Stack.Screen name="WithdrawMoney" component={WithdrawMoney} />
      <Stack.Screen name="WalletDetails" component={WalletDetails} />
      
      {/* Telas específicas de motorista */}
      {userType === 'driver' && (
        <>
          <Stack.Screen name="DriverBalance" component={DriverBalanceScreen} />
          <Stack.Screen name="DriverRating" component={DriverRating} />
          <Stack.Screen name="DriverDocuments" component={DriverDocumentsScreen} />
          <Stack.Screen name="DriverSearch" component={DriverSearchScreen} />
          <Stack.Screen name="DriverIncome" component={DriverIncomeScreen} />
          <Stack.Screen name="WeeklyPayment" component={WeeklyPaymentScreen} />
          <Stack.Screen name="EarningsReport" component={EarningsReportScreen} />
        </>
      )}
      
      {/* Telas de onboarding pós-login */}
      <Stack.Screen name="Referral" component={ReferralScreen} />
      <Stack.Screen name="BaaSAccount" component={BaaSAccountScreen} />
      
      {/* Telas de teste */}
      <Stack.Screen name="ProfileToggleTest" component={ProfileToggleTestScreen} />
      <Stack.Screen name="ToggleTest" component={ToggleTestScreen} />
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
