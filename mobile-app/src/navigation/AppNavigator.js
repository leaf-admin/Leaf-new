import Logger from '../utils/Logger';
import React, { useEffect, useRef, useState } from 'react';
import { CommonActions, NavigationContainer, createNavigationContainerRef, getStateFromPath } from '@react-navigation/native';
import { TransitionPresets, createStackNavigator } from '@react-navigation/stack';
import Constants from 'expo-constants';

import { useDispatch, useSelector } from 'react-redux';

import { Alert, Linking, Platform, View, Text, ActivityIndicator } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import firebaseAuth from '@react-native-firebase/auth';
import WebSocketManager from '../services/WebSocketManager';
import realtimeConnectionOrchestrator from '../services/RealtimeConnectionOrchestrator';
import {
  allowTestUserTools,
  isE2ETestBuild,
  isSimulatorBuild,
} from '../config/runtimeAccessPolicy';
import { getPilotLaunchFeatureSnapshot } from '../config/pilotLaunchProfile';
import { USER_SIGN_OUT } from '../services/runtime/authTypesBridge';
import { normalizeManifestDeepLinkPath } from './surfaceManifestContract';
import {
  isPersistedProfileOnboardingComplete,
  isProfileIdentityConsistent,
} from '../components/auth/authFlowRecovery';

// Telas de Autenticação
import OTPScreen from '../screens/OTPScreen';
import Registration from '../screens/Registration';
import ProfileSelectionScreen from '../screens/ProfileSelectionScreen';
import CompleteRegistrationScreen from '../screens/CompleteRegistrationScreen';
import DriverTermsScreen from '../screens/DriverTermsScreen';
import CNHUploadScreen from '../screens/CNHUploadScreen';
import CRLVUploadScreen from '../screens/CRLVUploadScreen';
import AuthFlowScreenshotHarness from '../components/auth/AuthFlowScreenshotHarness';

import LegalScreen from '../screens/LegalScreen';
import PrivacyPolicyScreen from '../screens/PrivacyPolicyScreen';
import PilotFeatureUnavailableScreen from '../screens/PilotFeatureUnavailableScreen';

import EarningsReportScreen from '../screens/EarningsReportScreen';

// Telas de Onboarding
import SplashScreen from '../screens/SplashScreen';
import WelcomeScreen from '../screens/WelcomeScreen';
import AuthLoadingScreen from '../screens/AuthLoadingScreen';

import RobotaxiPrototypeScreen from '../screens/RobotaxiPrototypeScreen';
import RobotaxiDestinationScreen from '../screens/prototype/RobotaxiDestinationScreen';
import RobotaxiDriverSearchScreen from '../screens/prototype/RobotaxiDriverSearchScreen';
import RobotaxiTripScreen from '../screens/prototype/RobotaxiTripScreen';
import RobotaxiProfileScreen from '../screens/prototype/RobotaxiProfileScreen';
import RobotaxiSettingsScreen from '../screens/prototype/RobotaxiSettingsScreen';
import RobotaxiMenuScreen from '../screens/prototype/RobotaxiMenuScreen';
import RobotaxiTripHistoryScreen from '../screens/prototype/RobotaxiTripHistoryScreen';
import RobotaxiPaymentSuccessScreen from '../screens/prototype/RobotaxiPaymentSuccessScreen';
import RobotaxiPaymentFailedScreen from '../screens/prototype/RobotaxiPaymentFailedScreen';
import RobotaxiNoDriversScreen from '../screens/prototype/RobotaxiNoDriversScreen';
import RobotaxiChatScreen from '../screens/prototype/RobotaxiChatScreen';
import RobotaxiSupportScreen from '../screens/prototype/RobotaxiSupportScreen';
import RobotaxiReceiptScreen from '../screens/prototype/RobotaxiReceiptScreen';
import RobotaxiSupportThreadScreen from '../screens/prototype/RobotaxiSupportThreadScreen';
import RobotaxiCancellationScreen from '../screens/prototype/RobotaxiCancellationScreen';
import RobotaxiRatingScreen from '../screens/prototype/RobotaxiRatingScreen';
import RobotaxiComplainScreen from '../screens/prototype/RobotaxiComplainScreen';
import RobotaxiShareTripScreen from '../screens/prototype/RobotaxiShareTripScreen';
import RobotaxiPublicTripTrackingScreen from '../screens/prototype/RobotaxiPublicTripTrackingScreen';
import RobotaxiInvitesScreen from '../screens/prototype/RobotaxiInvitesScreen';
import RobotaxiSupportTicketScreen from '../screens/prototype/RobotaxiSupportTicketScreen';
import RobotaxiDriverDocumentsScreen from '../screens/prototype/RobotaxiDriverDocumentsScreen';
import RobotaxiVehiclesScreen from '../screens/prototype/RobotaxiVehiclesScreen';
import RobotaxiDriverActivationScreen from '../screens/prototype/RobotaxiDriverActivationScreen';
import RobotaxiDriverWaitlistScreen from '../screens/prototype/RobotaxiDriverWaitlistScreen';
import RobotaxiDriverWaitlistStatusScreen from '../screens/prototype/RobotaxiDriverWaitlistStatusScreen';

// Componentes
// LoadingScreen removido - não é mais necessário

const Stack = createStackNavigator();
const rootNavigationRef = createNavigationContainerRef();

function RobotaxiDriverSearchMapScreen(props) {
  return (
    <View style={{ flex: 1 }}>
      <RobotaxiPrototypeScreen {...props} />
      <View
        pointerEvents="box-none"
        style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 }}
      >
        <RobotaxiDriverSearchScreen {...props} />
      </View>
    </View>
  );
}

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
  return normalizeManifestDeepLinkPath(path);
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
          qaAutoFlow: String,
          qaAutoConfirmPix: String,
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
      RobotaxiPrototypeDriverSearch: 'robotaxi/driver/search',
      RobotaxiPrototypeTrip: 'robotaxi/trip',
      RobotaxiPrototypePaymentSuccess: 'robotaxi/payment/success',
      RobotaxiPrototypePaymentFailed: 'robotaxi/payment/failed',
      RobotaxiPrototypeNoDrivers: 'robotaxi/no-drivers',
      RobotaxiPrototypeChat: 'robotaxi/chat',
      RobotaxiPrototypeSupport: 'robotaxi/support',
      RobotaxiPrototypeSupportTicket: 'robotaxi/support/ticket',
      RobotaxiPrototypeSupportThread: 'robotaxi/support/ticket/:ticketId',
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
      AuthFlowScreenshotHarness: 'auth/screenshots',
      RobotaxiPrototypeProfile: 'robotaxi/profile',
      RobotaxiPrototypeSettings: 'robotaxi/settings',
      RobotaxiPrototypeMenu: 'robotaxi/menu',
      RobotaxiMenuEditProfile: 'robotaxi/menu/profile',
      RobotaxiMenuTripHistory: 'robotaxi/menu/history',
      RobotaxiMenuMessages: 'robotaxi/menu/messages',
      RobotaxiMenuHelp: 'robotaxi/menu/help',
      RobotaxiMenuSettings: 'robotaxi/menu/settings',
      EarningsReport: 'driver/earnings',
      Legal: 'legal',
      PrivacyPolicy: 'privacy',
    }
  },
  getStateFromPath(path, options) {
    return getStateFromPath(normalizeLeafAppLinkPath(path), options);
  },
};

const PROTOTYPE_QA_DEEP_LINK_ROUTES = {
  'robotaxi/trip': 'RobotaxiPrototypeTrip',
  'robotaxi/receipt': 'RobotaxiPrototypeReceipt',
  'robotaxi/driver/offer': 'RobotaxiPrototype',
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
        <>
          <Stack.Screen
            name="RobotaxiPrototype"
            component={RobotaxiPrototypeScreen}
            options={{ keyboardHandlingEnabled: false }}
          />
          <Stack.Screen
            name="AuthFlowScreenshotHarness"
            component={AuthFlowScreenshotHarness}
            options={{ headerShown: false }}
          />
        </>
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
        name="RobotaxiPrototypeSupportThread"
        component={RobotaxiSupportThreadScreen}
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
        name="RobotaxiPrototypeCancellation"
        component={RobotaxiCancellationScreen}
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
        name="RobotaxiPrototypeDriverSearch"
        component={RobotaxiDriverSearchMapScreen}
        options={prototypeOverlayScreenOptions}
      />
      <Stack.Screen
        name="RobotaxiPrototypeTrip"
        component={RobotaxiTripScreen}
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
    </>
  );
}

function renderSharedLegacyAliases() {
  return (
    <>
      {/* Compatibility aliases resolve to the canonical runtime only. */}
      <Stack.Screen name="MapScreen" component={RobotaxiPrototypeScreen} />
      <Stack.Screen name="TabRoot" component={RobotaxiPrototypeScreen} />
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
    const firebaseUser = firebaseAuth().currentUser;
    const explicitSimulatorE2EProfile = Boolean(
      allowTestUserTools() &&
      isSimulatorBuild() &&
      isE2ETestBuild() &&
      (profile?.isTestUser || profile?.isTestCustomer),
    );
    const profileAuthorized =
      (
        isProfileIdentityConsistent({ profile, firebaseUser }) ||
        explicitSimulatorE2EProfile
      ) &&
      isPersistedProfileOnboardingComplete(profile);
    const userId = String(profile?.uid || profile?.id || '').trim();
    const role = normalizeNavigatorRole(
      profile?.usertype ||
        profile?.userType ||
        profile?.role ||
        profile?.user_role ||
        profile?.accountType
    );
    const sessionKey = profileAuthorized && userId && role ? `${userId}:${role}` : '';

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
  const isReviewEnv = Constants?.expoConfig?.extra?.isReview === true;

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

  const allowPublicPrototypeQaScreens =
    isReviewEnv || isE2ETestBuild() || isSimulatorBuild();

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
  const profileOnboardingComplete = isPersistedProfileOnboardingComplete(auth.profile);
  const profileIdentityAuthorized = isProfileIdentityConsistent({
    profile: auth.profile,
    firebaseUser: firebaseAuth().currentUser,
  }) || Boolean(
    allowTestUserTools() &&
    isSimulatorBuild() &&
    isE2ETestBuild() &&
    (auth.profile?.isTestUser || auth.profile?.isTestCustomer),
  );

  // Perfil, consentimentos e identidade Firebase precisam estar completos antes
  // de montar mapa, socket ou qualquer superfície privada.
  if (!normalizedProfileRole || !profileOnboardingComplete || !profileIdentityAuthorized) {
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
        component={RobotaxiPrototypeScreen}
        options={{ keyboardHandlingEnabled: false }}
      />

      {allowPublicPrototypeQaScreens ? (
        <Stack.Screen
          name="AuthFlowScreenshotHarness"
          component={AuthFlowScreenshotHarness}
          options={{ headerShown: false }}
        />
      ) : null}

      {renderSharedLegacyAliases()}
      {renderPrototypeCompanionScreens(activeRole)}
      {renderSharedPrototypeScreens()}
      {activeRole === 'driver' ? renderDriverPrototypeScreens() : renderCustomerPrototypeScreens()}
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
