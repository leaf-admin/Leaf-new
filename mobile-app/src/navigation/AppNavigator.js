import React, { useEffect, useRef, useState } from 'react';
import { NavigationContainer, useNavigationContainerRef } from '@react-navigation/native';
import { createStackNavigator, CardStyleInterpolators } from '@react-navigation/stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import {
    Dimensions,
    Platform,
} from 'react-native';
import DeviceInfo from 'react-native-device-info';
import {
    DriverRating,
    ProfileScreen,
    PaymentDetails,
    RideListPage,
    MapScreen,
    BookedCabScreen,
    RideDetails,
    SearchScreen,
    EditProfilePage,
    AboutPage,
    OnlineChat,
    WalletDetails,
    AddMoneyScreen,
    SelectGatewayPage,
    LoginScreen,
    DriverTrips,
    WithdrawMoneyScreen,
    DriverIncomeScreen,
    RegistrationPage,
    Notifications as NotificationsPage,
    SettingsScreen,
    CarsScreen,
    CarEditScreen,
    WelcomeScreen,
    CompleteRegistrationScreen,
} from '../screens';
import DriverDocumentsScreen from '../screens/DriverDocumentsScreen';
import Complain from '../screens/Complain';
import OTPScreen from '../screens/OTPScreen';
import UserInfoScreen from '../screens/UserInfoScreen';
// CNHUploadScreen e CRLVUploadScreen foram removidos - usar DriverDocumentsScreen
import AppCommon from '../screens/AppCommon';
import ProfileSelectionScreen from '../screens/ProfileSelectionScreen';
var { height, width } = Dimensions.get('window');
import { useSelector } from "react-redux";
import i18n from '../i18n';
import * as Notifications from 'expo-notifications';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../common/theme';
import { Icon } from "react-native-elements";
import { MAIN_COLOR } from '../common/sharedFunctions';
import { CommonActions } from '@react-navigation/native';
import { fonts } from '../common/font';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const hasNotch = DeviceInfo.hasNotch();

const Stack = createStackNavigator();
const Tab = createBottomTabNavigator();

export default function AppContainer() {
    const { t } = i18n;
    const isRTL = i18n.locale.indexOf('he') === 0 || i18n.locale.indexOf('ar') === 0;
    const [authState, setAuthState] = useState({ profile: null });
    const responseListener = useRef();
    const navigationRef = useNavigationContainerRef();
    const activeBookings = useSelector(state => state.bookinglistdata.active);
    const [initialRoute, setInitialRoute] = React.useState(null);
    const [isLoading, setIsLoading] = React.useState(true);
    const insets = useSafeAreaInsets();

    // Carregar estado de autenticação do AsyncStorage
    useEffect(() => {
        const loadAuthState = async () => {
            try {
                console.log("AppNavigator - Iniciando carregamento do estado de autenticação");
                setIsLoading(true);
                const userData = await AsyncStorage.getItem('@user_data');
                console.log("AppNavigator - Dados do usuário carregados:", !!userData);
                
                if (userData) {
                    const profile = JSON.parse(userData);
                    console.log("AppNavigator - Perfil carregado:", {
                        uid: profile.uid,
                        usertype: profile.usertype,
                        email: profile.email
                    });
                    setAuthState({ profile });
                    
                    // Set initial route based on user type
                    if (profile.usertype === 'customer') {
                        setInitialRoute('Map');
                        console.log("AppNavigator - Definindo rota inicial para Map (customer)");
                    } else if (profile.usertype === 'driver') {
                        setInitialRoute('DriverTrips');
                        console.log("AppNavigator - Definindo rota inicial para DriverTrips (driver)");
                    }
                } else {
                    console.log("AppNavigator - Nenhum usuário autenticado encontrado");
                }
            } catch (error) {
                console.error('AppNavigator - Erro ao carregar estado de autenticação:', error);
            } finally {
                console.log("AppNavigator - Finalizando carregamento do estado de autenticação");
                setIsLoading(false);
            }
        };

        loadAuthState();
    }, []);

    useEffect(() => {
      responseListener.current = Notifications.addNotificationResponseReceivedListener(response => {
          if (response && response.notification && response.notification.request && response.notification.request.content && response.notification.request.content.data){
            const nData = response.notification.request.content.data;
            if (nData.screen) {
              if (nData.params) {
                navigationRef.navigate(nData.screen, nData.params);
              } else {
                navigationRef.navigate(nData.screen);
              }
            } else {
              navigationRef.navigate("TabRoot");
            }
          }
        });
    }, []);
    
    const screenOptions = {
        headerStyle: {
          backgroundColor: '#41D274',
          transform: [{ scaleX: isRTL ? -1 : 1 }]
        },
        headerTintColor: colors.TRANSPARENT,
        headerTitleAlign: 'center',
        headerTitleStyle: {
            fontFamily:fonts.Bold,
          color:'white',
          transform: [{ scaleX: isRTL ? -1 : 1 }]
        },
        headerBackImage: () => 
        <Icon
            name={isRTL?'arrow-right':'arrow-left'}
            type='font-awesome'
            color={colors.WHITE}
            size={25}
            style={{margin:10, transform: [{ scaleX: isRTL ? -1 : 1 }]}}
        /> 
    };
    
    const TabRoot = () => {
        return (
            <Tab.Navigator
                initialRouteName={initialRoute}
                screenOptions={{
                    tabBarStyle: {
                        backgroundColor: 'rgba(30,30,30,0.92)',
                        borderTopLeftRadius: 0,
                        borderTopRightRadius: 0,
                        borderTopWidth: 0,
                        elevation: 10,
                        shadowColor: '#000',
                        shadowOffset: { width: 0, height: -2 },
                        shadowOpacity: 0.15,
                        shadowRadius: 8,
                        paddingBottom: 48,
                        zIndex: 9999,
                    },
                    tabBarShowLabel: false,
                    tabBarActiveTintColor: '#fff',
                    tabBarInactiveTintColor: '#b0b0b0',
                    tabBarIconStyle: { marginTop: 6, fontSize: 28 },
                }}
            >
                {authState.profile && authState.profile.usertype && authState.profile.usertype == 'customer' ?
                    <Tab.Screen name="Map" 
                        component={MapScreen} 
                        options={{
                            title: t('home'),
                            headerShown: false,
                            tabBarStyle: { display: 'none' },
                            tabBarIcon: ({ color, size }) => (
                                <Ionicons name="home-outline" color={color} size={size} />
                            ),
                        }}
                        listeners={({navigation,route})=>({
                            tabPress: e => {
                                e.preventDefault()
                                navigation.dispatch(
                                    CommonActions.reset({
                                        index: 0,
                                        routes: [{name: route.name}]
                                    })
                                )
                            },
                        })}
                    />
                : null}
                <Tab.Screen name="RideList"
                    component={RideListPage} 
                    options={{ 
                        title: t('ride_list_title'),
                        ...screenOptions,
                        tabBarIcon: ({ color, size }) => (
                            <Ionicons name="list-circle-outline" color={color} size={size} />
                        ),
                    }}
                    listeners={({navigation,route})=>({
                        tabPress: e => {
                            e.preventDefault()
                            navigation.dispatch(
                                CommonActions.reset({
                                    index: 0,
                                    routes: [{name: route.name}]
                                })
                            )
                        },
                    })}
                />
                <Tab.Screen name="Wallet" 
                    component={WalletDetails} 
                    options={{ 
                        title: t('my_wallet_tile'),
                        ...screenOptions,
                        tabBarIcon: ({ color, size }) => (
                            <Ionicons name="wallet-outline" color={color} size={size} />
                        ),
                    }}
                    listeners={({navigation,route})=>({
                        tabPress: e => {
                            e.preventDefault()
                            navigation.dispatch(
                                CommonActions.reset({
                                    index: 0,
                                    routes: [{name: route.name}]
                                })
                            )
                        },
                    })}
                />
                <Tab.Screen name="Settings" 
                    component={SettingsScreen} 
                    options={{ 
                        title: t('settings_title'),
                        ...screenOptions,
                        tabBarIcon: ({ color, size }) => (
                            <Ionicons name="settings-outline" color={color} size={size} />
                        ),
                    }}
                    listeners={({navigation,route})=>({
                        tabPress: e => {
                            e.preventDefault()
                            navigation.dispatch(
                                CommonActions.reset({
                                    index: 0,
                                    routes: [{name: route.name}]
                                })
                            )
                        },
                    })}
                />
            </Tab.Navigator>
        );
    }

    console.log("AppNavigator - Renderizando com estado:", {
        isLoading,
        hasProfile: !!authState.profile,
        userType: authState.profile?.usertype,
        initialRoute
    });

    if (isLoading) {
        console.log("AppNavigator - Renderizando WelcomeScreen (loading)");
        return <WelcomeScreen />;
    }

    if (!authState.profile || !authState.profile.uid) {
        console.log("AppNavigator - Renderizando fluxo de onboarding (usuário não autenticado)");
        // Usuário não autenticado: fluxo de onboarding CORRIGIDO
        return (
            <NavigationContainer ref={navigationRef}>
                <Stack.Navigator initialRouteName="Welcome" screenOptions={screenOptions}>
                    <Stack.Screen name="Welcome" component={WelcomeScreen} options={{ headerShown: false }} />
                    <Stack.Screen name="ProfileSelection" component={ProfileSelectionScreen} options={{ headerShown: false }} />
                    <Stack.Screen name="PhoneScreen" component={UserInfoScreen} options={{ headerShown: false }} />
                    <Stack.Screen name="OTP" component={OTPScreen} options={{ headerShown: false }} />
                    <Stack.Screen name="CNHUploadScreen" component={DriverDocumentsScreen} options={{ headerShown: false }} />
                    <Stack.Screen name="CRLVUploadScreen" component={DriverDocumentsScreen} options={{ headerShown: false }} />
                    <Stack.Screen name="CompleteRegistration" component={CompleteRegistrationScreen} options={{ headerShown: false }} />
                    <Stack.Screen name="Login" component={LoginScreen} options={{ headerShown: false }} />
                </Stack.Navigator>
            </NavigationContainer>
        );
    }

    console.log("AppNavigator - Renderizando fluxo principal (usuário autenticado)");
    // Usuário autenticado: fluxo principal
    return (
        <NavigationContainer ref={navigationRef}>
            <Stack.Navigator initialRouteName={initialRoute || 'TabRoot'} screenOptions={screenOptions}>
                {authState.profile && authState.profile.usertype === 'driver' ? (
                    <Stack.Screen name="DriverTrips" component={DriverTrips} options={{ headerShown: false }} />
                ) : (
                    <Stack.Screen name="TabRoot" component={TabRoot} options={{ headerShown: false }} />
                )}
                {/* Demais telas */}
                <Stack.Screen name="Profile" component={ProfileScreen} options={{ title: t('profile_setting_menu'),...screenOptions}}/>
                <Stack.Screen name="editUser" component={EditProfilePage} options={{ title: t('update_profile_title'),...screenOptions }}/>
                <Stack.Screen name="Search" component={SearchScreen} options={{ title: t('search'),...screenOptions }}/>
                <Stack.Screen name="DriverRating" component={DriverRating} options={{ title: t('rate_ride'),headerLeft: ()=> null,...screenOptions }}/>
                <Stack.Screen name="PaymentDetails" component={PaymentDetails} options={{ title: t('payment'),...screenOptions }}/>
                <Stack.Screen name="BookedCab" component={BookedCabScreen} options={{headerShown: false }}/>
                <Stack.Screen name="RideDetails" component={RideDetails} options={{ title: t('ride_details_page_title'),...screenOptions }}/>
                <Stack.Screen name="onlineChat" component={OnlineChat} options={{ title: t('chat_title'),...screenOptions }}/>
                <Stack.Screen name="addMoney" component={AddMoneyScreen} options={{ title: t('add_money'),...screenOptions }}/>
                <Stack.Screen name="selectGateway" component={SelectGatewayPage} options={{ title: t('select_gateway'),...screenOptions }}/>
                <Stack.Screen name="withdrawMoney" component={WithdrawMoneyScreen} options={{ title: t('withdraw_money'),...screenOptions }}/>
                <Stack.Screen name="driverIncome" component={DriverIncomeScreen} options={{ title: t('driver_income'),...screenOptions }}/>
                <Stack.Screen name="notifications" component={NotificationsPage} options={{ title: t('notifications'),...screenOptions }}/>
                <Stack.Screen name="cars" component={CarsScreen} options={{ title: t('cars'),...screenOptions }}/>
                <Stack.Screen name="carEdit" component={CarEditScreen} options={{ title: t('car_edit'),...screenOptions }}/>
                <Stack.Screen name="complain" component={Complain} options={{ title: t('complain'),...screenOptions }}/>
                <Stack.Screen name="about" component={AboutPage} options={{ title: t('about'),...screenOptions }}/>
                <Stack.Screen name="driverDocuments" component={DriverDocumentsScreen} options={{ title: t('driver_documents'),...screenOptions }}/>
            </Stack.Navigator>
        </NavigationContainer>
    );
}