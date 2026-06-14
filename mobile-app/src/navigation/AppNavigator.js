import Logger from '../utils/Logger';
import React, { useEffect, useRef, useState } from 'react';
import { CommonActions, NavigationContainer, createNavigationContainerRef, getStateFromPath } from '@react-navigation/native';
import { TransitionPresets, createStackNavigator } from '@react-navigation/stack';
import Constants from 'expo-constants';

import { useDispatch, useSelector } from 'react-redux';

import { Alert, Linking, Platform, View, Text, ActivityIndicator } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import firebaseAuth from '@react-native-firebase/auth';
import featureFlagService from '../services/FeatureFlagService';
import WebSocketManager from '../services/WebSocketManager';
import realtimeConnectionOrchestrator from '../services/RealtimeConnectionOrchestrator';
import { isE2ETestBuild, isSimulatorBuild } from '../config/runtimeAccessPolicy';
import { getPilotLaunchFeatureSnapshot } from '../config/pilotLaunchProfile';
import { USER_SIGN_OUT } from '../services/runtime/authTypesBridge';

// Telas de Autenticação
import OTPScreen from '../screens/OTPScreen';
import Registration from '../screens/Registration';
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
import HelpScreen from '../screens/HelpScreen';
import AboutScreen from '../screens/AboutScreen';
import LegalScreen from '../screens/LegalScreen';
import PrivacyPolicyScreen from '../screens/PrivacyPolicyScreen';
import PilotFeatureUnavailableScreen from '../screens/PilotFeatureUnavailableScreen';

// Telas de Motorista
import DriverDashboardScreen from '../screens/DriverDashboardScreen';
import DriverTrips from '../screens/DriverTrips';
import DriverRating from '../screens/DriverRating';
import DriverDocumentsScreen from '../screens/DriverDocumentsScreen';
import DriverSearchScreen from '../screens/DriverSearchScreen';
import DriverIncomeScreen from '../screens/DriverIncomeScreen';
import EarningsReportScreen from '../screens/EarningsReportScreen';
import SubscriptionManagementScreen from '../screens/SubscriptionManagementScreen';

// Telas de Pagamento
import PaymentSuccessScreen from '../screens/PaymentSuccessScreen';
import PaymentFailedScreen from '../screens/PaymentFailedScreen';
import PaymentDetails from '../screens/PaymentDetails';
import WithdrawMoney from '../screens/WithdrawMoney';

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

import RobotaxiPrototypeScreen from '../screens/RobotaxiPrototypeScreen';
import RobotaxiDestinationScreen from '../screens/prototype/RobotaxiDestinationScreen';
import RobotaxiBookingScreen from '../screens/prototype/RobotaxiBookingScreen';
import RobotaxiDriverSearchScreen from '../screens/prototype/RobotaxiDriverSearchScreen';
import RobotaxiTripScreen from '../screens/prototype/RobotaxiTripScreen';
import RobotaxiProfileScreen from '../screens/prototype/RobotaxiProfileScreen';
import RobotaxiSettingsScreen from '../screens/prototype/RobotaxiSettingsScreen';
import RobotaxiMenuScreen from '../screens/prototype/RobotaxiMenuScreen';
import RobotaxiTripHistoryScreen from '../screens/prototype/RobotaxiTripHistoryScreen';
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
import RobotaxiShareTripScreen from '../screens/prototype/RobotaxiShareTripScreen';
import RobotaxiPublicTripTrackingScreen from '../screens/prototype/RobotaxiPublicTripTrackingScreen';
import RobotaxiInvitesScreen from '../screens/prototype/RobotaxiInvitesScreen';
import RobotaxiSupportTicketScreen from '../screens/prototype/RobotaxiSupportTicketScreen';
import RobotaxiDriverDocumentsScreen from '../screens/prototype/RobotaxiDriverDocumentsScreen';
import RobotaxiVehiclesScreen from '../screens/prototype/RobotaxiVehiclesScreen';
import RobotaxiDriverOfferScreen from '../screens/prototype/RobotaxiDriverOfferScreen';
import RobotaxiDriverTripScreen from '../screens/prototype/RobotaxiDriverTripScreen';
import RobotaxiDriverActivationScreen from '../screens/prototype/RobotaxiDriverActivationScreen';
import RobotaxiDriverWaitlistScreen from '../screens/prototype/RobotaxiDriverWaitlistScreen';
import RobotaxiDriverWaitlistStatusScreen from '../screens/prototype/RobotaxiDriverWaitlistStatusScreen';

// Componentes
// LoadingScreen removido - não é mais necessário

const Stack = createStackNavigator();
const rootNavigationRef = createNavigationContainerRef();

if (typeof globalThis !== 'undefined') {
  globalThis.navigationRef = rootNavigationRef;
}

const SESSION_TERMINATED_ALERT_OPTIONS = {
  cancelable: false,
  __skipFriendlyAlertPatch: true,
};

const SESSION_TERMINATED_BASE_STORAGE_KEYS = [
  '@user_data',
  '@auth_uid',
  '@auth_token',
  '@qa_socket_id_token',
  'fcmToken',
];

function getSessionTerminatedUserId(payload = {}) {
  if (!payload || typeof payload !== 'object') {
    return '';
  }

  return String(payload.userId || payload.uid || payload.previousUserId || '').trim();
}

function getSessionTerminatedUserType(payload = {}) {
  if (!payload || typeof payload !== 'object') {
    return null;
  }

  return normalizeNavigatorRole(
    payload.userType ||
      payload.usertype ||
      payload.role ||
      payload.accountType ||
      payload.profile?.userType ||
      payload.profile?.usertype ||
      payload.profile?.role
  );
}

function getProfileSessionRole(profile = {}) {
  return normalizeNavigatorRole(
    profile?.userType ||
      profile?.usertype ||
      profile?.role ||
      profile?.user_role ||
      profile?.accountType ||
      profile?.profile?.userType ||
      profile?.profile?.usertype ||
      profile?.profile?.role
  );
}

function buildSessionTerminatedStorageKeys(userId) {
  const keys = new Set(SESSION_TERMINATED_BASE_STORAGE_KEYS);
  const safeUid = String(userId || '').trim();

  if (safeUid) {
    keys.add(`@prototype_runtime_session_${safeUid}`);
    keys.add(`@prototype_runtime_qa_seed_${safeUid}`);
  }

  return Array.from(keys);
}

function resetToInitialAppScreen(navigationRef) {
  const resetAction = CommonActions.reset({
    index: 0,
    routes: [{ name: 'Splash' }],
  });

  const dispatchReset = () => {
    if (navigationRef?.isReady?.()) {
      navigationRef.dispatch(resetAction);
      return true;
    }
    return false;
  };

  if (!dispatchReset()) {
    setTimeout(dispatchReset, 100);
  }
}

async function clearLocalSessionAfterRemoteLogin({ dispatch, navigationRef, payload }) {
  const payloadUserId = getSessionTerminatedUserId(payload);
  let storageUserId = payloadUserId;

  try {
    if (!storageUserId) {
      storageUserId = String(await AsyncStorage.getItem('@auth_uid') || '').trim();
    }
  } catch (error) {
    Logger.warn('⚠️ [SessionTerminated] Falha ao ler UID local antes de limpar sessão:', error?.message || error);
  }

  try {
    realtimeConnectionOrchestrator.clearSession({
      reason: 'remote_session_terminated',
    });
  } catch (error) {
    Logger.warn('⚠️ [SessionTerminated] Falha ao encerrar socket local:', error?.message || error);
  }

  try {
    await AsyncStorage.multiRemove(buildSessionTerminatedStorageKeys(storageUserId));
  } catch (error) {
    Logger.warn('⚠️ [SessionTerminated] Falha ao limpar cache local:', error?.message || error);
  }

  dispatch({ type: USER_SIGN_OUT, payload: null });

  try {
    if (firebaseAuth().currentUser) {
      await firebaseAuth().signOut();
    }
  } catch (error) {
    if (error?.code !== 'auth/no-current-user') {
      Logger.warn('⚠️ [SessionTerminated] Falha ao sair do Firebase Auth:', error?.message || error);
    }
  }

  resetToInitialAppScreen(navigationRef);
}

const verticalScreenOptions = {
  headerShown: false,
  animationEnabled: true,
  ...(Platform.OS === 'ios' ? TransitionPresets.DefaultTransition : TransitionPresets.DefaultTransition)
};

const prototypeOverlayScreenOptions = {
  headerShown: false,
  presentation: 'card',
  animationEnabled: false,
  gestureEnabled: false,
  cardOverlayEnabled: false,
  cardStyle: { backgroundColor: 'transparent' },
  detachPreviousScreen: false
};

const prototypeTransparentOverlayScreenOptions = {
  ...prototypeOverlayScreenOptions,
  presentation: 'transparentModal'
};

const prototypeInteractiveOverlayScreenOptions = {
  ...prototypeTransparentOverlayScreenOptions,
  detachPreviousScreen: true
};

const pilotLaunchFeatures = getPilotLaunchFeatureSnapshot();
const prototypeInvitesEntryComponent = pilotLaunchFeatures.referralProgramsEnabled ? RobotaxiInvitesScreen : PilotFeatureUnavailableScreen;
const referralEntryComponent = prototypeInvitesEntryComponent;
const driverInviteEntryComponent = RobotaxiDriverWaitlistScreen;
const withdrawalEntryComponent = pilotLaunchFeatures.driverWithdrawalsEnabled ? WithdrawMoney : PilotFeatureUnavailableScreen;
const driverPayoutEntryComponent = PilotFeatureUnavailableScreen;

const referralScreenParams = {
  title: 'Convites fora do piloto',
  message: 'Convites e campanhas de growth ficam desativados durante o piloto controlado.',
  targetRoute: 'Map'
};

const prototypeReferralScreenParams = {
  ...referralScreenParams,
  targetRoute: 'RobotaxiPrototype'
};

const withdrawalScreenParams = {
  title: 'Saque operado manualmente',
  message: 'Saque e repasse do motorista ficam fora do app nesta fase e serao tratados pela operacao assistida.',
  targetRoute: 'Map'
};

const legacyWalletScreenParams = {
  title: 'Carteira fora do piloto',
  message: 'Pagamento de corrida segue via Pix. Saldo e saques do motorista ficam na area de ganhos.',
  targetRoute: 'Map'
};

const driverPayoutScreenParams = {
  title: 'Repasse pelo saldo Leaf',
  message: 'Conta BaaS nao faz parte do modelo atual. Use a tela de ganhos para consultar saldo e solicitar saque.',
  targetRoute: 'Map'
};

const legacyPlanScreenParams = {
  title: 'Plano antigo desativado',
  message: 'Assinaturas e repasses seguem o modelo atual de ganhos e saque. Este fluxo antigo ficou em compatibilidade.',
  targetRoute: 'Map'
};

function normalizeLeafAppLinkPath(path) {
  const normalizedPath = String(path || '').replace(/^\/+/, '');

  if (normalizedPath === 'viagem') {
    return 'robotaxi/trip/public';
  }

  if (normalizedPath.startsWith('viagem/')) {
    return normalizedPath.replace(/^viagem\//, 'robotaxi/trip/public/');
  }

  return path;
}

const appLinking = {
  prefixes: ['leafapp://', 'br.com.leaf.ride://', 'https://leaf.app.br', 'https://www.leaf.app.br'],
  config: {
    screens: {
      RobotaxiPrototype: {
        path: 'robotaxi/home',
        parse: {
          automation: String,
          e2e: String,
          qaAutomation: String,
          qaDriverAction: String,
          qaBookingId: String,
          qaPassengerAction: String,
          qaNonce: String,
          qaConnectionScenario: String,
          qaTriggerState: String,
          qaRecoveryMs: String,
          qaDelayMs: String,
        },
      },
      RobotaxiPrototypeDestination: 'robotaxi/destination',
      RobotaxiPrototypeBooking: 'robotaxi/booking',
      RobotaxiPrototypeDriverSearch: 'robotaxi/driver/search',
      RobotaxiPrototypeTrip: 'robotaxi/trip',
      RobotaxiPrototypePayment: 'robotaxi/payment',
      RobotaxiPrototypePaymentSuccess: 'robotaxi/payment/success',
      RobotaxiPrototypePaymentFailed: 'robotaxi/payment/failed',
      RobotaxiPrototypeNoDrivers: 'robotaxi/no-drivers',
      RobotaxiPrototypeChat: 'robotaxi/chat',
      RobotaxiPrototypeSupport: 'robotaxi/support',
      RobotaxiPrototypeSupportTicket: 'robotaxi/support/ticket',
      RobotaxiPrototypeReceipt: 'robotaxi/receipt',
      RobotaxiPrototypeCancellation: 'robotaxi/cancellation',
      RobotaxiPrototypeRating: 'robotaxi/rating',
      RobotaxiPrototypeComplain: 'robotaxi/complain',
      RobotaxiPrototypeShareTrip: 'robotaxi/trip/share',
      RobotaxiPrototypePublicTracking: 'robotaxi/trip/public/:tripId',
      RobotaxiPrototypeInvites: 'robotaxi/invites',
      Referral: {
        path: 'convite/:inviteCode',
        parse: { inviteCode: String },
      },
      ReferralScreen: {
        path: 'referral/:inviteCode',
        parse: { inviteCode: String },
      },
      DriverInvite: {
        path: 'motorista/convite/:inviteCode',
        parse: { inviteCode: String },
      },
      RobotaxiPrototypeDriverPanel: 'robotaxi/driver/panel',
      RobotaxiPrototypeDriverActivation: 'robotaxi/driver/activation',
      RobotaxiPrototypeDriverDocuments: 'robotaxi/driver/documents',
      RobotaxiPrototypeVehicles: 'robotaxi/driver/vehicles',
      RobotaxiPrototypeDriverWaitlist: 'robotaxi/driver/waitlist',
      RobotaxiPrototypeDriverWaitlistStatus: {
        path: 'robotaxi/driver/waitlist/status',
        parse: {
          status: String,
          waitlistEvent: String,
          position: Number,
          city: String,
          cityLabel: String,
        },
      },
      RobotaxiPrototypeDriverOffer: 'robotaxi/driver/offer',
      RobotaxiPrototypeDriverTrip: 'robotaxi/driver/trip',
      RobotaxiPrototypeProfile: 'robotaxi/profile',
      RobotaxiPrototypeSettings: 'robotaxi/settings',
      RobotaxiPrototypeMenu: 'robotaxi/menu',
      RobotaxiMenuEditProfile: 'robotaxi/menu/profile',
      RobotaxiMenuTripHistory: 'robotaxi/menu/history',
      RobotaxiMenuMessages: 'robotaxi/menu/messages',
      RobotaxiMenuHelp: 'robotaxi/menu/help',
      RobotaxiMenuSettings: 'robotaxi/menu/settings',
      EarningsReport: 'driver/earnings'
    }
  },
  getStateFromPath(path, options) {
    return getStateFromPath(normalizeLeafAppLinkPath(path), options);
  },
};

const PROTOTYPE_QA_DEEP_LINK_ROUTES = {
  'robotaxi/trip': 'RobotaxiPrototypeTrip',
  'robotaxi/receipt': 'RobotaxiPrototypeReceipt',
  'robotaxi/driver/offer': 'RobotaxiPrototypeDriverOffer',
  'robotaxi/driver/trip': 'RobotaxiPrototype',
};

function parsePrototypeQaDeepLink(url) {
  if (!(__DEV__ || isE2ETestBuild() || isSimulatorBuild())) {
    return null;
  }

  const rawUrl = String(url || '').trim();
  if (!rawUrl) {
    return null;
  }

  let parsedUrl = null;
  try {
    parsedUrl = new URL(rawUrl);
  } catch (_error) {
    return null;
  }

  const normalizedPath = [
    parsedUrl.hostname,
    parsedUrl.pathname.replace(/^\/+/, ''),
  ]
    .filter(Boolean)
    .join('/')
    .replace(/\/+$/, '');
  const routeName = PROTOTYPE_QA_DEEP_LINK_ROUTES[normalizedPath];
  if (!routeName) {
    return null;
  }

  const params = {};
  parsedUrl.searchParams.forEach((value, key) => {
    params[key] = value;
  });

  return { routeName, params };
}

function navigatePrototypeQaDeepLink(navigationRef, deepLink) {
  if (!deepLink?.routeName) {
    return false;
  }

  let attempts = 0;
  const navigateTarget = () => {
    attempts += 1;
    if (!navigationRef?.isReady?.()) {
      return false;
    }

    navigationRef.navigate(deepLink.routeName, deepLink.params || {});
    return true;
  };

  if (!navigateTarget()) {
    const retryNavigation = () => {
      if (navigateTarget() || attempts >= 20) {
        return;
      }
      setTimeout(retryNavigation, 150);
    };
    setTimeout(retryNavigation, 150);
  }

  return true;
}

function shouldRoutePrototypeReceiptUrl(url) {
  const normalized = String(url || '').trim().toLowerCase();

  if (!normalized) {
    return false;
  }

  return (
    normalized.includes('robotaxi/receipt') ||
    normalized.includes('robotaxi%2freceipt') ||
    (
      normalized.includes('robotaxi/home') &&
      normalized.includes('qapassengeraction=open_receipt')
    )
  );
}

function navigatePrototypeReceiptFromLink(navigationRef) {
  const navigateReceipt = () => {
    if (!navigationRef?.isReady?.()) {
      return false;
    }

    navigationRef.navigate('RobotaxiPrototypeReceipt', { fromTrip: true });
    return true;
  };

  if (!navigateReceipt()) {
    setTimeout(navigateReceipt, 150);
  }
}

function normalizeNavigatorRole(rawRole) {
  const normalized = String(rawRole || '')
    .trim()
    .toLowerCase();
  if (!normalized) {
    return null;
  }

  if (['passenger', 'customer', 'rider', 'cliente'].includes(normalized)) {
    return 'customer';
  }

  if (['driver', 'motorista', 'partner', 'parceiro'].includes(normalized)) {
    return 'driver';
  }

  return null;
}

function LegacyAuthRouteRedirectScreen({ navigation }) {
  useEffect(() => {
    const timer = setTimeout(() => {
      navigation.replace('Splash');
    }, 0);

    return () => clearTimeout(timer);
  }, [navigation]);

  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#F8FAFC' }}>
      <ActivityIndicator size="small" color="#1A330E" />
      <Text style={{ marginTop: 8, color: '#4E5A6B' }}>Redirecionando autenticação...</Text>
    </View>
  );
}

function renderPublicScreens(allowPrototypeQaScreens = false) {
  return (
    <>
      <Stack.Screen
        name="Splash"
        component={SplashScreen}
        options={{ headerShown: false }}
      />
      {allowPrototypeQaScreens ? (
        <Stack.Screen
          name="RobotaxiPrototype"
          component={RobotaxiPrototypeScreen}
          options={{ keyboardHandlingEnabled: false }}
        />
      ) : null}
      <Stack.Screen name="AuthLoading" component={AuthLoadingScreen} options={{ headerShown: false }} />
      <Stack.Screen name="AuthLoadingScreen" component={AuthLoadingScreen} options={{ headerShown: false }} />
      <Stack.Screen name="LoginScreen" component={LegacyAuthRouteRedirectScreen} options={{ headerShown: false }} />
      <Stack.Screen name="Registration" component={Registration} options={{ headerShown: false }} />
      <Stack.Screen name="WelcomeScreen" component={WelcomeScreen} options={{ headerShown: false }} />
      <Stack.Screen name="ProfileSelectionScreen" component={ProfileSelectionScreen} options={{ headerShown: false }} />
      <Stack.Screen name="CompleteRegistration" component={CompleteRegistrationScreen} options={{ headerShown: false }} />
      <Stack.Screen name="DriverTerms" component={DriverTermsScreen} options={{ headerShown: false }} />
      <Stack.Screen name="CNHUploadScreen" component={CNHUploadScreen} options={{ headerShown: false }} />
      <Stack.Screen name="CRLVUploadScreen" component={CRLVUploadScreen} options={{ headerShown: false }} />
      <Stack.Screen name="CNHUpload" component={CNHUploadScreen} options={{ headerShown: false }} />
      <Stack.Screen name="CRLVUpload" component={CRLVUploadScreen} options={{ headerShown: false }} />
      <Stack.Screen name="OTP" component={OTPScreen} options={{ headerShown: false }} />
      <Stack.Screen name="PhoneInputScreen" component={LegacyAuthRouteRedirectScreen} options={{ headerShown: false }} />
      <Stack.Screen name="PhoneScreen" component={LegacyAuthRouteRedirectScreen} options={{ headerShown: false }} />
      <Stack.Screen name="Login" component={LegacyAuthRouteRedirectScreen} options={{ headerShown: false }} />
      <Stack.Screen name="AuthScreen" component={LegacyAuthRouteRedirectScreen} options={{ headerShown: false }} />
      <Stack.Screen name="ProfileSelection" component={ProfileSelectionScreen} options={{ headerShown: false }} />
      <Stack.Screen
        name="FreeTrial"
        component={PilotFeatureUnavailableScreen}
        initialParams={legacyPlanScreenParams}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="PlanSelection"
        component={PilotFeatureUnavailableScreen}
        initialParams={legacyPlanScreenParams}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="Referral"
        component={referralEntryComponent}
        initialParams={referralScreenParams}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="ReferralScreen"
        component={referralEntryComponent}
        initialParams={referralScreenParams}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="DriverInvite"
        component={driverInviteEntryComponent}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="RobotaxiPrototypePublicTracking"
        component={RobotaxiPublicTripTrackingScreen}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="BaaSAccount"
        component={driverPayoutEntryComponent}
        initialParams={driverPayoutScreenParams}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="BaaSAccountScreen"
        component={driverPayoutEntryComponent}
        initialParams={driverPayoutScreenParams}
        options={{ headerShown: false }}
      />
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
    </>
  );
}

function renderSharedPrivateScreens() {
  return (
    <>
      <Stack.Screen name="Search" component={SearchScreen} />
      <Stack.Screen name="Chat" component={ChatScreen} />
      <Stack.Screen name="Notifications" component={Notifications} />
      <Stack.Screen name="Settings" component={SettingsScreen} />
      <Stack.Screen name="Help" component={HelpScreen} />
      <Stack.Screen name="About" component={AboutScreen} />
      <Stack.Screen name="Legal" component={LegalScreen} />
      <Stack.Screen name="PrivacyPolicy" component={PrivacyPolicyScreen} />
      <Stack.Screen name="Profile" component={ProfileScreen} />
      <Stack.Screen name="Support" component={SupportScreen} />
      <Stack.Screen name="SupportTicket" component={SupportTicketScreen} />
      <Stack.Screen name="SupportChat" component={SupportChatScreen} />
      <Stack.Screen name="WaitList" component={RobotaxiDriverWaitlistStatusScreen} />
      <Stack.Screen name="DriverInvite" component={driverInviteEntryComponent} />
      <Stack.Screen name="EditProfile" component={EditProfile} />
      <Stack.Screen name="EditProfileScreen" component={EditProfileScreen} />
      <Stack.Screen name="PersonalData" component={PersonalDataScreen} />
      <Stack.Screen name="UserInfo" component={UserInfoScreen} />
      <Stack.Screen name="PaymentDetails" component={PaymentDetails} />
      <Stack.Screen
        name="AddMoney"
        component={PilotFeatureUnavailableScreen}
        initialParams={legacyWalletScreenParams}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="WithdrawMoney"
        component={withdrawalEntryComponent}
        initialParams={withdrawalScreenParams}
      />
      <Stack.Screen
        name="WalletDetails"
        component={PilotFeatureUnavailableScreen}
        initialParams={legacyWalletScreenParams}
        options={{ headerShown: false }}
      />
      <Stack.Screen name="OTP" component={OTPScreen} options={{ headerShown: false }} />
      <Stack.Screen name="PhoneInputScreen" component={LegacyAuthRouteRedirectScreen} options={{ headerShown: false }} />
      <Stack.Screen name="PhoneScreen" component={LegacyAuthRouteRedirectScreen} options={{ headerShown: false }} />
      <Stack.Screen name="Login" component={LegacyAuthRouteRedirectScreen} options={{ headerShown: false }} />
      <Stack.Screen name="AuthScreen" component={LegacyAuthRouteRedirectScreen} options={{ headerShown: false }} />
      <Stack.Screen name="WelcomeScreen" component={WelcomeScreen} options={{ headerShown: false }} />
      <Stack.Screen name="ProfileSelectionScreen" component={ProfileSelectionScreen} options={{ headerShown: false }} />
      <Stack.Screen name="ProfileSelection" component={ProfileSelectionScreen} options={{ headerShown: false }} />
      <Stack.Screen name="CompleteRegistration" component={CompleteRegistrationScreen} options={{ headerShown: false }} />
      <Stack.Screen name="DriverTerms" component={DriverTermsScreen} options={{ headerShown: false }} />
      <Stack.Screen name="CNHUploadScreen" component={CNHUploadScreen} options={{ headerShown: false }} />
      <Stack.Screen name="CRLVUploadScreen" component={CRLVUploadScreen} options={{ headerShown: false }} />
      <Stack.Screen name="CNHUpload" component={CNHUploadScreen} options={{ headerShown: false }} />
      <Stack.Screen name="CRLVUpload" component={CRLVUploadScreen} options={{ headerShown: false }} />
      <Stack.Screen
        name="Referral"
        component={referralEntryComponent}
        initialParams={referralScreenParams}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="ReferralScreen"
        component={referralEntryComponent}
        initialParams={referralScreenParams}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="BaaSAccount"
        component={driverPayoutEntryComponent}
        initialParams={driverPayoutScreenParams}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="BaaSAccountScreen"
        component={driverPayoutEntryComponent}
        initialParams={driverPayoutScreenParams}
        options={{ headerShown: false }}
      />
      <Stack.Screen name="Messages" component={ChatScreen} />
      <Stack.Screen name="AccountSettings" component={SettingsScreen} />
      <Stack.Screen name="SettingsScreen" component={SettingsScreen} />
      <Stack.Screen name="HelpScreen" component={HelpScreen} />
      <Stack.Screen
        name="AccountStatement"
        component={PilotFeatureUnavailableScreen}
        initialParams={legacyWalletScreenParams}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="addMoney"
        component={PilotFeatureUnavailableScreen}
        initialParams={legacyWalletScreenParams}
        options={{ headerShown: false }}
      />
      <Stack.Screen name="onlineChat" component={SupportChatScreen} />
    </>
  );
}

function renderPrototypeCompanionScreens(activeRole) {
  return (
    <>
      <Stack.Screen name="Legal" component={LegalScreen} />
      <Stack.Screen name="PrivacyPolicy" component={PrivacyPolicyScreen} />
      {activeRole === 'driver' ? (
        <>
          <Stack.Screen name="EarningsReport" component={EarningsReportScreen} />
          <Stack.Screen
            name="WooviDriverBalance"
            component={driverPayoutEntryComponent}
            initialParams={driverPayoutScreenParams}
          />
        </>
      ) : null}
    </>
  );
}

function renderCustomerPrivateScreens() {
  return (
    <>
      <Stack.Screen name="Rides" component={RideListScreen} />
      <Stack.Screen name="RideListScreen" component={RideListScreen} />
      <Stack.Screen name="BookedCab" component={BookedCabScreen} />
      <Stack.Screen name="TripTracking" component={TripTrackingScreen} />
      <Stack.Screen name="RideDetails" component={RideDetails} />
      <Stack.Screen name="TripDetails" component={RideDetails} />
      <Stack.Screen name="Receipt" component={ReceiptScreen} />
      <Stack.Screen name="ReceiptDetails" component={ReceiptScreen} />
      <Stack.Screen name="Cancellation" component={CancellationScreen} />
      <Stack.Screen name="CancellationSuccess" component={CancellationScreen} />
      <Stack.Screen name="Feedback" component={FeedbackScreen} />
      <Stack.Screen name="Complain" component={Complain} />
      <Stack.Screen name="PaymentSuccess" component={PaymentSuccessScreen} />
      <Stack.Screen name="PaymentFailed" component={PaymentFailedScreen} />
      <Stack.Screen name="PaymentSuccessScreen" component={PaymentSuccessScreen} />
      <Stack.Screen name="BookingConfirmation" component={BookedCabScreen} />
      <Stack.Screen name="PixPayment" component={PaymentDetails} />
      <Stack.Screen name="TransactionHistory" component={RideListScreen} />
    </>
  );
}

function renderDriverPrivateScreens() {
  return (
    <>
      <Stack.Screen name="Dashboard" component={DriverDashboardScreen} />
      <Stack.Screen
        name="Trips"
        component={DriverTrips}
        options={{ headerShown: true }}
      />
      <Stack.Screen
        name="DriverBalance"
        component={driverPayoutEntryComponent}
        initialParams={driverPayoutScreenParams}
      />
      <Stack.Screen name="DriverRating" component={DriverRating} />
      <Stack.Screen name="DriverDocuments" component={DriverDocumentsScreen} options={{ gestureEnabled: false, headerShown: false }} />
      <Stack.Screen name="DriverSearch" component={DriverSearchScreen} />
      <Stack.Screen name="DriverIncome" component={DriverIncomeScreen} />
      <Stack.Screen
        name="WeeklyPayment"
        component={PilotFeatureUnavailableScreen}
        initialParams={legacyPlanScreenParams}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="WooviDriverBalance"
        component={driverPayoutEntryComponent}
        initialParams={driverPayoutScreenParams}
      />
      <Stack.Screen name="EarningsReport" component={EarningsReportScreen} />
      <Stack.Screen name="SubscriptionManagement" component={SubscriptionManagementScreen} />
      <Stack.Screen name="AddVehicle" component={AddVehicleScreen} />
      <Stack.Screen name="MyVehicles" component={MyVehiclesScreen} />
      <Stack.Screen name="CarEdit" component={CarEditScreen} />
      <Stack.Screen name="Cars" component={CarsScreen} />
      <Stack.Screen name="DriverDashboard" component={DriverDashboardScreen} />
      <Stack.Screen name="DriverTrips" component={DriverTrips} />
      <Stack.Screen name="MyEarning" component={EarningsReportScreen} />
      <Stack.Screen
        name="UpdateBankInfo"
        component={driverPayoutEntryComponent}
        initialParams={driverPayoutScreenParams}
      />
      <Stack.Screen name="VehicleRegistration" component={AddVehicleScreen} />
      <Stack.Screen
        name="WeeklyPaymentScreen"
        component={PilotFeatureUnavailableScreen}
        initialParams={legacyPlanScreenParams}
        options={{ headerShown: false }}
      />
      <Stack.Screen name="EarningsReportScreen" component={EarningsReportScreen} />
      <Stack.Screen
        name="TransferMoney"
        component={withdrawalEntryComponent}
        initialParams={withdrawalScreenParams}
      />
      <Stack.Screen name="CarEditScreen" component={CarEditScreen} />
      <Stack.Screen name="MyVehiclesScreen" component={MyVehiclesScreen} />
    </>
  );
}

function renderSharedPrototypeScreens() {
  return (
    <>
      <Stack.Screen
        name="RobotaxiPrototype"
        component={RobotaxiPrototypeScreen}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="RobotaxiPrototypeChat"
        component={RobotaxiChatScreen}
        options={prototypeTransparentOverlayScreenOptions}
      />
      <Stack.Screen
        name="RobotaxiPrototypeSupport"
        component={RobotaxiSupportScreen}
        options={prototypeTransparentOverlayScreenOptions}
      />
      <Stack.Screen
        name="RobotaxiPrototypeSupportTicket"
        component={RobotaxiSupportTicketScreen}
        options={prototypeTransparentOverlayScreenOptions}
      />
      <Stack.Screen
        name="RobotaxiPrototypeReceipt"
        component={RobotaxiReceiptScreen}
        options={prototypeTransparentOverlayScreenOptions}
      />
      <Stack.Screen
        name="RobotaxiPrototypeRating"
        component={RobotaxiRatingScreen}
        options={prototypeTransparentOverlayScreenOptions}
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
        name="RobotaxiPrototypeShareTrip"
        component={RobotaxiShareTripScreen}
        options={prototypeTransparentOverlayScreenOptions}
      />
      <Stack.Screen
        name="RobotaxiPrototypePublicTracking"
        component={RobotaxiPublicTripTrackingScreen}
        options={prototypeTransparentOverlayScreenOptions}
      />
      <Stack.Screen
        name="RobotaxiPrototypeInvites"
        component={prototypeInvitesEntryComponent}
        options={prototypeTransparentOverlayScreenOptions}
        initialParams={prototypeReferralScreenParams}
      />
      <Stack.Screen
        name="Referral"
        component={referralEntryComponent}
        options={prototypeTransparentOverlayScreenOptions}
        initialParams={prototypeReferralScreenParams}
      />
      <Stack.Screen
        name="ReferralScreen"
        component={referralEntryComponent}
        options={prototypeTransparentOverlayScreenOptions}
        initialParams={prototypeReferralScreenParams}
      />
      <Stack.Screen
        name="RobotaxiMenuEditProfile"
        component={RobotaxiProfileScreen}
        options={prototypeOverlayScreenOptions}
      />
      <Stack.Screen
        name="RobotaxiMenuTripHistory"
        component={RobotaxiTripHistoryScreen}
        options={prototypeOverlayScreenOptions}
      />
      <Stack.Screen
        name="RobotaxiMenuMessages"
        component={RobotaxiChatScreen}
        options={prototypeOverlayScreenOptions}
      />
      <Stack.Screen
        name="RobotaxiMenuHelp"
        component={RobotaxiSupportScreen}
        options={prototypeOverlayScreenOptions}
      />
      <Stack.Screen
        name="RobotaxiMenuSettings"
        component={RobotaxiSettingsScreen}
        options={prototypeOverlayScreenOptions}
      />
    </>
  );
}

function renderCustomerPrototypeScreens() {
  return (
    <>
      <Stack.Screen
        name="RobotaxiPrototypeDestination"
        component={RobotaxiDestinationScreen}
        options={prototypeTransparentOverlayScreenOptions}
      />
      <Stack.Screen
        name="RobotaxiPrototypeBooking"
        component={RobotaxiBookingScreen}
        options={prototypeTransparentOverlayScreenOptions}
      />
      <Stack.Screen
        name="RobotaxiPrototypeDriverSearch"
        component={RobotaxiDriverSearchScreen}
        options={prototypeTransparentOverlayScreenOptions}
      />
      <Stack.Screen
        name="RobotaxiPrototypeTrip"
        component={RobotaxiTripScreen}
        options={prototypeTransparentOverlayScreenOptions}
      />
      <Stack.Screen
        name="RobotaxiPrototypePayment"
        component={RobotaxiPaymentScreen}
        options={prototypeTransparentOverlayScreenOptions}
      />
      <Stack.Screen
        name="RobotaxiPrototypePaymentSuccess"
        component={RobotaxiPaymentSuccessScreen}
        options={prototypeTransparentOverlayScreenOptions}
      />
      <Stack.Screen
        name="RobotaxiPrototypePaymentFailed"
        component={RobotaxiPaymentFailedScreen}
        options={prototypeTransparentOverlayScreenOptions}
      />
      <Stack.Screen
        name="RobotaxiPrototypeNoDrivers"
        component={RobotaxiNoDriversScreen}
        options={prototypeTransparentOverlayScreenOptions}
      />
      <Stack.Screen
        name="RobotaxiPrototypeCancellation"
        component={RobotaxiCancellationScreen}
        options={prototypeTransparentOverlayScreenOptions}
      />
      <Stack.Screen
        name="RobotaxiPrototypeComplain"
        component={RobotaxiComplainScreen}
        options={prototypeTransparentOverlayScreenOptions}
      />
    </>
  );
}

function renderDriverPrototypeScreens() {
  return (
    <>
      <Stack.Screen
        name="RobotaxiPrototypeDriverPanel"
        component={RobotaxiProfileScreen}
        options={prototypeOverlayScreenOptions}
      />
      <Stack.Screen
        name="RobotaxiPrototypeDriverActivation"
        component={RobotaxiDriverActivationScreen}
        options={prototypeTransparentOverlayScreenOptions}
      />
      <Stack.Screen
        name="RobotaxiPrototypeDriverDocuments"
        component={RobotaxiDriverDocumentsScreen}
        options={prototypeTransparentOverlayScreenOptions}
      />
      <Stack.Screen
        name="RobotaxiPrototypeVehicles"
        component={RobotaxiVehiclesScreen}
        options={prototypeTransparentOverlayScreenOptions}
      />
      <Stack.Screen
        name="RobotaxiPrototypeDriverWaitlist"
        component={RobotaxiDriverWaitlistScreen}
        options={prototypeTransparentOverlayScreenOptions}
      />
      <Stack.Screen
        name="RobotaxiPrototypeDriverWaitlistStatus"
        component={RobotaxiDriverWaitlistStatusScreen}
        options={prototypeTransparentOverlayScreenOptions}
      />
      <Stack.Screen
        name="DriverInvite"
        component={driverInviteEntryComponent}
        options={prototypeTransparentOverlayScreenOptions}
      />
      <Stack.Screen
        name="RobotaxiPrototypeDriverOffer"
        component={RobotaxiDriverOfferScreen}
        options={prototypeTransparentOverlayScreenOptions}
      />
      <Stack.Screen
        name="RobotaxiPrototypeDriverTrip"
        component={RobotaxiDriverTripScreen}
        options={prototypeTransparentOverlayScreenOptions}
      />
    </>
  );
}

function renderSharedLegacyAliases(mapComponent) {
  return (
    <>
      {/* Legacy compatibility aliases kept only because older screens still navigate to them. */}
      <Stack.Screen name="MapScreen" component={mapComponent} />
      <Stack.Screen name="TabRoot" component={mapComponent} />
    </>
  );
}

function SessionTerminatedGuard({ navigationRef }) {
  const dispatch = useDispatch();
  const currentProfile = useSelector(state => state.auth?.profile);
  const currentUidRef = useRef('');
  const currentRoleRef = useRef(null);
  const handlingSessionTerminationRef = useRef(false);

  useEffect(() => {
    currentUidRef.current = String(currentProfile?.uid || '').trim();
    currentRoleRef.current = getProfileSessionRole(currentProfile);
  }, [currentProfile]);

  useEffect(() => {
    const webSocketManager = WebSocketManager.getInstance();

    const handleSessionTerminated = (payload = {}) => {
      const payloadUserId = getSessionTerminatedUserId(payload);
      const payloadRole = getSessionTerminatedUserType(payload);
      const currentUid = currentUidRef.current;
      const currentRole = currentRoleRef.current;

      if (payloadUserId && currentUid && payloadUserId !== currentUid) {
        return;
      }

      const shouldEnforceSessionTermination =
        payloadRole === 'driver' || (!payloadRole && currentRole === 'driver');

      if (!shouldEnforceSessionTermination) {
        Logger.info('🔐 [SessionTerminated] Evento ignorado para passageiro/role não motorista', {
          userId: payloadUserId || currentUid || null,
          payloadRole: payloadRole || null,
          currentRole: currentRole || null,
        });
        return;
      }

      if (handlingSessionTerminationRef.current) {
        return;
      }

      handlingSessionTerminationRef.current = true;
      Logger.warn('🔐 [SessionTerminated] Sessão local encerrada por login em outro aparelho', {
        userId: payloadUserId || currentUid || null,
        previousSocketId: payload?.previousSocketId || null,
        newSocketId: payload?.newSocketId || null,
      });

      Alert.alert(
        'Sessão encerrada',
        'Sua conta foi aberta em outro aparelho. Por segurança, encerramos esta sessão neste aparelho. Toque em Ok para voltar à tela inicial.',
        [
          {
            text: 'Ok',
            onPress: () => {
              clearLocalSessionAfterRemoteLogin({ dispatch, navigationRef, payload })
                .finally(() => {
                  handlingSessionTerminationRef.current = false;
                });
            },
          },
        ],
        SESSION_TERMINATED_ALERT_OPTIONS
      );
    };

    webSocketManager.on('sessionTerminated', handleSessionTerminated);

    return () => {
      webSocketManager.off('sessionTerminated', handleSessionTerminated);
    };
  }, [dispatch, navigationRef]);

  return null;
}

function RealtimeConnectionGuard() {
  const profile = useSelector(state => state.auth?.profile);
  const lastSessionKeyRef = useRef('');

  useEffect(() => {
    const userId = String(profile?.uid || profile?.id || '').trim();
    const role = normalizeNavigatorRole(
      profile?.usertype ||
        profile?.userType ||
        profile?.role ||
        profile?.user_role ||
        profile?.accountType
    );
    const sessionKey = userId && role ? `${userId}:${role}` : '';

    if (!sessionKey) {
      if (lastSessionKeyRef.current) {
        realtimeConnectionOrchestrator.clearSession({
          reason: 'profile_session_cleared',
        });
        lastSessionKeyRef.current = '';
      }
      return;
    }

    if (lastSessionKeyRef.current === sessionKey) {
      return;
    }

    lastSessionKeyRef.current = sessionKey;
    realtimeConnectionOrchestrator
      .syncSession(
        {
          ...profile,
          userType: role,
        },
        {
          reason: 'profile_hydrated',
          forceRefreshToken: false,
        },
      )
      .catch(error => {
        Logger.warn(
          '⚠️ [RealtimeGuard] Falha ao preparar realtime autenticado:',
          error?.message || error,
        );
      });
  }, [profile]);

  return null;
}

// Navegação principal do app
function MainNavigator() {
  const auth = useSelector(state => state.auth);
  const [authCompleted, setAuthCompleted] = useState(false);
  const [prototypeUiEnabled, setPrototypeUiEnabled] = useState(true);
  const [flagsReady, setFlagsReady] = useState(true);
  const isReviewEnv = Constants?.expoConfig?.extra?.isReview === true;
  const forceLegacyMapUi =
    String(process.env.EXPO_PUBLIC_FORCE_LEGACY_MAP_UI || '').trim().toLowerCase() === 'true';

  useEffect(() => {
    // Resetar o estado quando a autenticação for completada
    const roleSource =
      auth?.profile?.usertype ??
      auth?.profile?.userType ??
      auth?.profile?.role ??
      auth?.profile?.user_role ??
      auth?.profile?.accountType;
    if (normalizeNavigatorRole(roleSource)) {
      setAuthCompleted(true);
    }
  }, [auth.profile]);

  useEffect(() => {
    let isMounted = true;
    let removeListener = null;

    const loadPrototypeFlag = async () => {
      try {
        await featureFlagService.initialize();
        const enabled = await featureFlagService.getFlag('PROTOTYPE_ROBOTAXI_UI_ENABLED', false);

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
          setPrototypeUiEnabled(false);
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

  const allowPrototypePrivateScreens =
    !forceLegacyMapUi && (isReviewEnv || isE2ETestBuild() || prototypeUiEnabled);
  const allowPublicPrototypeQaScreens =
    !forceLegacyMapUi && (isReviewEnv || isE2ETestBuild() || isSimulatorBuild());
  const mapComponent = allowPrototypePrivateScreens ? RobotaxiPrototypeScreen : NewMapScreen;

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
        key="public-safe"
        initialRouteName="Splash"
        screenOptions={verticalScreenOptions}
      >
        {renderPublicScreens(allowPublicPrototypeQaScreens)}
      </Stack.Navigator>
    );
  }

  const profileRoleSource =
    auth.profile.usertype ??
    auth.profile.userType ??
    auth.profile.role ??
    auth.profile.user_role ??
    auth.profile.accountType ??
    null;
  const normalizedProfileRole = normalizeNavigatorRole(profileRoleSource);

  // 🔍 VERIFICAR SE USUÁRIO ESTÁ COMPLETO (tem role válida)
  if (!normalizedProfileRole) {
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
  const activeRole = normalizedProfileRole || 'customer';

  return (
    <Stack.Navigator
      key={activeRole === 'driver' ? 'private-driver' : 'private-customer'}
      initialRouteName="Map"
      screenOptions={verticalScreenOptions}
    >
      <Stack.Screen
        name="Map"
        component={mapComponent}
        options={{ keyboardHandlingEnabled: false }}
      />

      {renderSharedLegacyAliases(mapComponent)}

      {allowPrototypePrivateScreens ? (
        <>
          {renderPrototypeCompanionScreens(activeRole)}
          {renderSharedPrototypeScreens()}
          {activeRole === 'driver' ? renderDriverPrototypeScreens() : renderCustomerPrototypeScreens()}
        </>
      ) : (
        <>
          {renderSharedPrivateScreens()}
          {activeRole === 'driver' ? renderDriverPrivateScreens() : renderCustomerPrivateScreens()}
        </>
      )}
    </Stack.Navigator>
  );
}

function PrototypeReceiptDeepLinkGuard({ navigationRef }) {
  const lastHandledUrlRef = useRef('');

  useEffect(() => {
    let mounted = true;

    const handleReceiptUrl = (url) => {
      if (!mounted || !shouldRoutePrototypeReceiptUrl(url)) {
        return;
      }

      const normalized = String(url || '').trim();
      if (lastHandledUrlRef.current === normalized) {
        return;
      }

      lastHandledUrlRef.current = normalized;
      navigatePrototypeReceiptFromLink(navigationRef);
    };

    Linking.getInitialURL()
      .then(handleReceiptUrl)
      .catch((error) => {
        Logger.warn('⚠️ [PrototypeDeepLink] Falha ao ler URL inicial:', error?.message || error);
      });

    const subscription = Linking.addEventListener('url', ({ url }) => {
      handleReceiptUrl(url);
    });

    return () => {
      mounted = false;
      if (typeof subscription?.remove === 'function') {
        subscription.remove();
      }
    };
  }, [navigationRef]);

  return null;
}

function PrototypeQaDeepLinkGuard({ navigationRef }) {
  useEffect(() => {
    if (!(__DEV__ || isE2ETestBuild() || isSimulatorBuild())) {
      return undefined;
    }

    let mounted = true;

    const handleUrl = (url) => {
      const deepLink = parsePrototypeQaDeepLink(url);
      if (!deepLink) {
        return;
      }

      navigatePrototypeQaDeepLink(navigationRef, deepLink);
    };

    Linking.getInitialURL()
      .then(url => {
        if (mounted) {
          handleUrl(url);
        }
      })
      .catch(error => {
        Logger.warn('⚠️ [PrototypeQA] Falha ao ler deep link inicial:', error?.message || error);
      });

    const subscription = Linking.addEventListener('url', event => {
      handleUrl(event?.url);
    });

    return () => {
      mounted = false;
      if (typeof subscription?.remove === 'function') {
        subscription.remove();
      }
    };
  }, [navigationRef]);

  return null;
}

export default function AppNavigator() {
  return (
    <>
      <NavigationContainer ref={rootNavigationRef} linking={appLinking}>
        <MainNavigator />
      </NavigationContainer>
      <PrototypeQaDeepLinkGuard navigationRef={rootNavigationRef} />
      <PrototypeReceiptDeepLinkGuard navigationRef={rootNavigationRef} />
      <RealtimeConnectionGuard />
      <SessionTerminatedGuard navigationRef={rootNavigationRef} />
    </>
  );
}
