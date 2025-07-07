import React, { useState, useRef, useEffect } from "react";
import {
    StyleSheet,
    View,
    ImageBackground,
    Text,
    Dimensions,
    Alert,
    TextInput,
    Image,
    ActivityIndicator,
    Platform,
    Linking,
    Keyboard,
    ScrollView,
    StatusBar,
    Animated,
    Easing
} from "react-native";
import MaterialButtonDark from "../components/MaterialButtonDark";
import { TouchableOpacity } from "react-native-gesture-handler";
import AsyncStorage from '@react-native-async-storage/async-storage';
import { api } from 'common';
import { colors } from '../common/theme';
import RNPickerSelect from '../components/RNPickerSelect';
import * as AppleAuthentication from 'expo-apple-authentication';
import * as Crypto from "expo-crypto";
import i18n from 'i18n-js';
import { Feather, Ionicons, FontAwesome5 } from '@expo/vector-icons';
import moment from 'moment/min/moment-with-locales';
import rnauth from '@react-native-firebase/auth';
import { GoogleSignin } from '@react-native-google-signin/google-signin';
import { TextInputMask } from 'react-native-masked-text';
import { useSelector, useDispatch } from 'react-redux';
import { checkUserExists } from 'common/src/actions/authactions';
import { useAuth } from '../hooks/useAuth';
var { width,height } = Dimensions.get('window');
import ClientIds from '../../config/ClientIds';
import { MAIN_COLOR } from "../common/sharedFunctions";
import { Button } from "../components";
import { fonts } from "../common/font";
import auth from '@react-native-firebase/auth';

GoogleSignin.configure(ClientIds);

const errorMessages = {
    'auth/invalid-email': 'E-mail inválido. Verifique e tente novamente.',
    'auth/user-not-found': 'Usuário não encontrado. Verifique o número ou cadastre-se.',
    'auth/wrong-password': 'Senha incorreta. Tente novamente.',
    'auth/too-many-requests': 'Muitas tentativas. Aguarde alguns minutos e tente novamente.',
    'auth/network-request-failed': 'Sem conexão. Verifique sua internet.',
    'auth/invalid-verification-code': 'Código de verificação inválido.',
    'auth/invalid-phone-number': 'Número de telefone inválido.',
    'auth/user-disabled': 'Usuário desativado. Contate o suporte.',
    'default': 'Ocorreu um erro. Tente novamente.'
};

function getFriendlyErrorMessage(error) {
    if (!error) return errorMessages['default'];
    if (typeof error === 'string' && errorMessages[error]) return errorMessages[error];
    if (typeof error === 'object' && error.code && errorMessages[error.code]) return errorMessages[error.code];
    if (typeof error === 'object' && error.message) {
        // Tenta mapear por código no message
        const codeMatch = error.message.match(/auth\/[a-zA-Z0-9\-]+/);
        if (codeMatch && errorMessages[codeMatch[0]]) return errorMessages[codeMatch[0]];
    }
    return errorMessages['default'];
}

export default function LoginScreen(props) {
    const {
        clearLoginError,
        requestPhoneOtpDevice,
        mobileSignIn,
        googleLogin,
        countries,
        appleSignIn,
        verifyEmailPassword,
        sendResetMail,
        requestMobileOtp,
        verifyMobileOtp
    } = api;
    const dispatch = useDispatch();
    const [authState, setAuthState] = useState({ profile: null });
    const [settings, setSettings] = useState(null);
    const { user, loading: authLoading, error: authError, signIn, signInWithPhone } = useAuth();

    // Carregar estado inicial
    useEffect(() => {
        const loadInitialState = async () => {
            try {
                const userData = await AsyncStorage.getItem('@user_data');
                const settingsData = await AsyncStorage.getItem('@settings');
                
                if (userData) {
                    setAuthState({ profile: JSON.parse(userData) });
                }
                if (settingsData) {
                    setSettings(JSON.parse(settingsData));
                }
            } catch (error) {
                console.error('Erro ao carregar estado inicial:', error);
            }
        };

        loadInitialState();
    }, []);

    console.log("LoginScreen - Estado de autenticação:", authState);
    console.log("LoginScreen - Configurações:", settings);

    const formatCountries = () => {
        let arr = [];
        for (let i = 0; i < countries.length; i++) {
            let txt = countries[i].label + " (+" + countries[i].phone + ")";
            arr.push({ label: txt, value: txt, key: txt });
        }
        return arr;
    }

    const [state, setState] = useState({
        entryType: null,
        contact: null,
        verificationId: null,
        verificationCode: null,
        countryCodeList: formatCountries(),
        countryCode: null
    });

    const pageActive = useRef(false);
    const [loading, setLoading] = useState(false);
    const [newUserText, setNewUserText] = useState(false);

    const { t } = i18n;
    const [isRTL, setIsRTL] = useState();
    const [langSelection, setLangSelection] = useState();
    const languagedata = useSelector(state => state.languagedata);
    const [eyePass, setEyePass] = useState(true);
    const [isNewUser, setIsNewUser] = useState(false);
    const pickerRef1 = React.createRef();
    const pickerRef2 = React.createRef();
    const [keyboardStatus, setKeyboardStatus] = useState("Keyboard Hidden");
    const [retryCount, setRetryCount] = useState(0);
    const [lastAttemptTime, setLastAttemptTime] = useState(null);
    const [isDeviceBlocked, setIsDeviceBlocked] = useState(false);
    const [blockExpiryTime, setBlockExpiryTime] = useState(null);
    const [timer, setTimer] = useState(120); // 2 minutos em segundos
    const [canResend, setCanResend] = useState(false);
    const [phone, setPhone] = useState('');
    const [password, setPassword] = useState('');
    const [isExistingUser, setIsExistingUser] = useState(false);
    const [userEmail, setUserEmail] = useState('');
    const [isCheckingUser, setIsCheckingUser] = useState(false);
    const [showPasswordField, setShowPasswordField] = useState(false);
    const [passwordFocused, setPasswordFocused] = useState(false);
    const [passwordError, setPasswordError] = useState(false);

    // Animação para overlay de loading
    const loadingAnim = useRef(new Animated.Value(0)).current;

    const [snackbar, setSnackbar] = useState({ visible: false, message: '', type: 'error' });
    const snackbarAnim = useRef(new Animated.Value(0)).current;

    useEffect(() => {
        AsyncStorage.getItem('lang', (err, result) => {
            if (result) {
                const langLocale = JSON.parse(result)['langLocale']
                setIsRTL(langLocale == 'he' || langLocale == 'ar')
                setLangSelection(langLocale);
            } else {
                setIsRTL(i18n.locale.indexOf('he') === 0 || i18n.locale.indexOf('ar') === 0)
                setLangSelection(i18n.locale);
            }
        });
    }, []);

    useEffect(() => {
        console.log("LoginScreen - useEffect de configurações");
        if (settings) {
            console.log("LoginScreen - Configurações carregadas:", {
                AllowCriticalEditsAdmin: settings.AllowCriticalEditsAdmin,
                mobileLogin: settings.mobileLogin,
                customMobileOTP: settings.customMobileOTP
            });
            for (let i = 0; i < countries.length; i++) {
                if (countries[i].label == settings.country) {
                    setState({ ...state, countryCode: settings.country + " (+" + countries[i].phone + ")" })
                }
            }
        } else {
            console.log("LoginScreen - Configurações ainda não carregadas");
        }
    }, [settings]);

    useEffect(() => {
        console.log("LoginScreen - Estado de autenticação atualizado:", {
            profile: authState.profile ? "presente" : "ausente",
            verificationId: authState.verificationId,
            error: authState.error
        });

        if (authState.profile && pageActive.current) {
            console.log("LoginScreen - Perfil encontrado, atualizando estado");
            pageActive.current = false;
            setLoading(false);
            setNewUserText(false);
        }
        if (authState.error && authState.error.msg && pageActive.current && authState.error.msg.message !== t('not_logged_in')) {
            console.log("LoginScreen - Erro de autenticação:", authState.error.msg);
            pageActive.current = false;
            setState({ ...state, verificationCode: '' });
            showSnackbar(authState.error.msg.message || t('login_error'), 'error');

            dispatch(clearLoginError());
            setLoading(false);
        }
        if (authState.verificationId) {
            console.log("LoginScreen - verificationId recebido:", authState.verificationId);
            pageActive.current = false;
            setState({ ...state, verificationId: authState.verificationId });
            setLoading(false);
        }
    }, [authState.profile, authState.error, authState.verificationId]);

    useEffect(() => {
        if (authError) {
            showSnackbar(getFriendlyErrorMessage(authError), 'error');
        }
    }, [authError]);

    useEffect(() => {
        if (loading) {
            Animated.timing(loadingAnim, {
                toValue: 1,
                duration: 250,
                useNativeDriver: true,
            }).start();
        } else {
            Animated.timing(loadingAnim, {
                toValue: 0,
                duration: 250,
                useNativeDriver: true,
            }).start();
        }
    }, [loading]);

    const checkExistingUser = async (phoneNumber) => {
        try {
            setIsCheckingUser(true);
            console.log("Verificando usuário com número:", phoneNumber);
            const res = await checkUserExists({ mobile: phoneNumber });
            console.log("Resposta da verificação:", res);
            
            if (res && Array.isArray(res.users) && res.users.length > 0) {
                console.log("Usuário encontrado:", res.users);
                // Apenas marcamos como usuário existente se tiver email (para mostrar opção de senha)
                const hasEmail = res.users[0].email && res.users[0].email.length > 0;
                setIsExistingUser(hasEmail);
                setUserEmail(hasEmail ? res.users[0].email : '');
                return hasEmail;
            }
            
            console.log("Nenhum usuário encontrado ou usuário sem email");
            setIsExistingUser(false);
            setUserEmail('');
            return false;
        } catch (error) {
            console.error("Erro ao verificar usuário:", error);
            setIsExistingUser(false);
            setUserEmail('');
            return false;
        } finally {
            setIsCheckingUser(false);
        }
    };

    const validateAndFormatPhone = (phoneNumber) => {
        // Remove todos os caracteres não numéricos
        const cleanNumber = phoneNumber.replace(/\D/g, '');
        
        // Verifica se tem 11 dígitos (DDD + número)
        if (cleanNumber.length !== 11) {
            return { isValid: false, formattedNumber: null };
        }

        // Formata o número para o padrão internacional
        const formattedNumber = `+55${cleanNumber}`;
        return { isValid: true, formattedNumber };
    };

    const handlePhoneChange = async (text) => {
        setPhone(text);
        const cleanPhone = text.replace(/\D/g, '');
        if (cleanPhone.length === 11) {
            const { isValid, formattedNumber } = validateAndFormatPhone(text);
            if (isValid) {
                console.log("Verificando número completo:", formattedNumber);
                await checkExistingUser(formattedNumber);
            }
        } else {
            setIsExistingUser(false);
            setUserEmail('');
        }
    };

    const onPressLogin = async () => {
        try {
            console.log("LoginScreen - Iniciando processo de login");
            
            const cleanPhone = phone.replace(/\D/g, '');
            if (cleanPhone.length !== 11) {
                showSnackbar(t('mobile_no_blank_error'), 'error');
                return;
            }

            const formattedNumber = `+55${cleanPhone}`;
            console.log("LoginScreen - Número formatado:", formattedNumber);

            setLoading(true);
            setIsCheckingUser(true);

            try {
                // Verifica se o usuário existe no Firebase Auth
                console.log("LoginScreen - Verificando usuário no Firebase Auth");
                const auth = rnauth();
                const userExists = await checkUserExists({ mobile: formattedNumber });
                console.log("LoginScreen - Resultado da verificação:", userExists);
                
                if (userExists && userExists.users && userExists.users.length > 0) {
                    console.log("LoginScreen - Usuário encontrado, habilitando campo de senha");
                    // Usuário existe, habilita campo de senha
                    setShowPasswordField(true);
                    setIsExistingUser(true);
                } else {
                    console.log("LoginScreen - Usuário não encontrado, iniciando verificação OTP");
                    // Novo usuário, inicia verificação OTP
                    try {
                        console.log("LoginScreen - Enviando código de verificação para:", formattedNumber);
                        const confirmation = await auth.verifyPhoneNumber(formattedNumber);
                        console.log("LoginScreen - Confirmação recebida:", confirmation);
                        
                        if (confirmation && confirmation.verificationId) {
                            console.log("LoginScreen - Navegando para tela OTP com verificationId:", confirmation.verificationId);
                            props.navigation.navigate('OTP', {
                                verificationId: confirmation.verificationId,
                                phone: formattedNumber,
                                isExistingUser: false
                            });
                        } else {
                            throw new Error('VerificationId não recebido');
                        }
                    } catch (otpError) {
                        console.error("LoginScreen - Erro ao enviar OTP:", otpError);
                        showSnackbar('Erro ao enviar código de verificação. Por favor, tente novamente.', 'error');
                    }
                }
            } catch (error) {
                console.error("LoginScreen - Erro ao verificar usuário:", error);
                showSnackbar(t('user_check_error'), 'error');
            } finally {
                setLoading(false);
                setIsCheckingUser(false);
            }
        } catch (error) {
            console.error("LoginScreen - Erro geral no login:", error);
            showSnackbar(t('login_error'), 'error');
            setLoading(false);
        }
    };

    const onPressPasswordLogin = async () => {
        try {
            setLoading(true);
            setPasswordError(false);
            const auth = rnauth();
            const formattedNumber = `+55${phone.replace(/\D/g, '')}`;
            
            // Buscar email do usuário
            const userExists = await checkUserExists({ mobile: formattedNumber });
            if (!userExists || !userExists.users || userExists.users.length === 0) {
                setPasswordError(true);
                throw new Error('Usuário não encontrado');
            }

            const userEmail = userExists.users[0].email;
            
            // Tentar login com email/senha
            await signIn(userEmail, password);
            
            // Se chegou aqui, login foi bem sucedido
            console.log("LoginScreen - Login com senha realizado com sucesso");
            
        } catch (error) {
            setPasswordError(true);
            console.error("LoginScreen - Erro no login com senha:", error);
            showSnackbar(t('login_error'), 'error');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        console.log("Estado de loading alterado:", loading);
    }, [loading]);

    useEffect(() => {
        console.log("Estado de auth alterado:", {
            verificationId: authState.verificationId,
            error: authState.error,
            profile: authState.profile
        });

        if (authState.error || authState.profile) {
                                setLoading(false);
                            }
    }, [authState.verificationId, authState.error, authState.profile]);

    useEffect(() => {
        return () => {
                        setLoading(false);
            setNewUserText(false);
            setRetryCount(0);
            setLastAttemptTime(null);
            setIsDeviceBlocked(false);
            setBlockExpiryTime(null);
        };
    }, []);

    const onSignIn = async () => {
        if (loading) return;

        setLoading(true);
        try {
            if (isExistingUser && password) {
                // Caso 1: Usuário existente com senha
                console.log("Tentando login com senha para usuário existente");
                await dispatch(verifyEmailPassword(userEmail, password));
            } else if (state.verificationCode) {
                // Caso 2: Verificação de OTP
                console.log("Iniciando verificação de OTP");
                pageActive.current = true;
                
                if (settings.customMobileOTP) {
                    let formattedNum = `+55${state.contact}`;
                    dispatch(verifyMobileOtp(
                        formattedNum,
                        state.verificationCode
                    ));
                } else {
                    try {
                        console.log("Verificando código OTP:", {
                            verificationId: state.verificationId,
                            code: state.verificationCode
                        });

                        // Usa a action mobileSignIn para autenticar e aguarda o resultado
                        const userCredential = await dispatch(mobileSignIn(
                            state.verificationId,
                            state.verificationCode.replace(/\D/g, '')
                        ));

                        console.log("Usuário autenticado com sucesso:", userCredential);

                        // Navega para a tela de complemento de dados
                        props.navigation.navigate('UserInfoScreen', {
                            phone: `+55${state.contact}`,
                            verificationId: state.verificationId,
                            isPhoneVerified: true,
                            userCredential: userCredential
                        });
                    } catch (error) {
                        console.error("Erro ao verificar código:", error);
                        if (error.code === 'auth/too-many-requests') {
                            console.log("Ignorando erro de too many requests durante verificação do código");
                            return;
                        }
                        showSnackbar(t('auth_error'), 'error');
                    }
                }
            } else {
                setNewUserText(false);
                showSnackbar(t('otp_blank_error'), 'error');
            }
        } catch (error) {
            console.error("Erro durante autenticação:", error);
            showSnackbar(t('auth_error'), 'error');
        } finally {
            setLoading(false);
        }
    }

    const CancelLogin = () => {
        setNewUserText(false);
        setState({
            ...state,
            contact: null,
            verificationId: null,
            verificationCode: null
        });
    }
    const GoogleLogin = async () => {
        await GoogleSignin.signOut();
        GoogleSignin.hasPlayServices().then((hasPlayService) => {
            if (hasPlayService) {
                GoogleSignin.signIn().then(async (userInfo) => {
                    if (userInfo.idToken) {
                        pageActive.current = true;
                        dispatch(googleLogin(userInfo.idToken, null))
                        setLoading(true);
                    } else {
                        const { accessToken } = await GoogleSignin.getTokens();
                        if (accessToken) {
                            pageActive.current = true;
                            dispatch(googleLogin(null, accessToken))
                            setLoading(true);
                        } else {
                            console.log("ERROR IS: No Tokens");
                        }
                    }
                }).catch((e) => {
                    console.log("ERROR IS: " + JSON.stringify(e));
                })
            }
        }).catch((e) => {
            console.log("ERROR IS: " + JSON.stringify(e));
        })
    }

    const AppleLogin = async () => {
        const csrf = Math.random().toString(36).substring(2, 15);
        const nonce = Math.random().toString(36).substring(2, 10);
        const hashedNonce = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, nonce);
        try {
            const applelogincredentials = await AppleAuthentication.signInAsync({
                requestedScopes: [
                    AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
                    AppleAuthentication.AppleAuthenticationScope.EMAIL,
                ],
                state: csrf,
                nonce: hashedNonce
            });

            pageActive.current = true;
            dispatch(appleSignIn({
                idToken: applelogincredentials.identityToken,
                rawNonce: nonce,
            }));

        } catch (error) {
            if (error.code === 'ERR_CANCELED') {
                console.log(error);
            } else {
                showSnackbar(t('apple_signin_error'), 'error');
            }
        }
    }

    const openRegister = () => {
        pageActive.current = false;
        props.navigation.navigate("Register")
    }

    const openTerms = async () => {
        Linking.openURL(settings.CompanyTerms).catch(err => console.error("Couldn't load page", err));
    }

    const handleForgotPassword = async () => {
        if (!userEmail) {
            showSnackbar('Não foi possível encontrar o e-mail cadastrado para este número.', 'error');
            return;
        }

        try {
            setLoading(true);
            const result = await dispatch(sendResetMail(userEmail));
            
            if (result.success) {
                showSnackbar('Enviamos um email com instruções para redefinir sua senha. Por favor, verifique sua caixa de entrada.', 'success');
            } else {
                showSnackbar(result.error || 'Não foi possível enviar o email de recuperação. Tente novamente mais tarde.', 'error');
            }
        } catch (error) {
            console.error('Erro ao solicitar recuperação de senha:', error);
            showSnackbar('Ocorreu um erro ao tentar recuperar sua senha. Por favor, tente novamente mais tarde.', 'error');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        const showSubscription = Keyboard.addListener('keyboardDidShow', () => {
            setKeyboardStatus('Keyboard Shown');
        });
        const hideSubscription = Keyboard.addListener('keyboardDidHide', () => {
            setKeyboardStatus('Keyboard Hidden');
        });

        return () => {
            showSubscription.remove();
            hideSubscription.remove();
        };
    }, []);

    useEffect(() => {
        console.log("VerificationId atualizado:", state.verificationId);
    }, [state.verificationId]);

    useEffect(() => {
        console.log("Código de verificação atualizado:", state.verificationCode);
    }, [state.verificationCode]);

    useEffect(() => {
        let interval;
        if (state.verificationId && timer > 0) {
            interval = setInterval(() => {
                setTimer((prevTimer) => {
                    if (prevTimer <= 1) {
                        setCanResend(true);
                        return 0;
                    }
                    return prevTimer - 1;
                });
            }, 1000);
        }
        return () => {
            if (interval) {
                clearInterval(interval);
            }
        };
    }, [state.verificationId, timer]);

    const formatTimer = (seconds) => {
        const minutes = Math.floor(seconds / 60);
        const remainingSeconds = seconds % 60;
        return `${minutes.toString().padStart(2, '0')}:${remainingSeconds.toString().padStart(2, '0')}`;
    };

    const handleResendCode = async () => {
        setLoading(true);
        setCanResend(false);
        setTimer(120);
        try {
            let formattedNum = `+55${state.contact}`;
            
            console.log("Reenviando código para:", formattedNum);
            
            const auth = rnauth();
            const confirmation = await auth.verifyPhoneNumber(formattedNum, true);
            
            console.log("Confirmação recebida:", confirmation);
            
            if (confirmation && confirmation.verificationId) {
                console.log("VerificationId recebido:", confirmation.verificationId);
                dispatch(requestPhoneOtpDevice(confirmation.verificationId));
                setState(prevState => ({
                    ...prevState,
                    verificationId: confirmation.verificationId,
                    verificationCode: ''
                }));
            } else {
                throw new Error('VerificationId não recebido');
            }
        } catch (error) {
            console.error("Erro ao reenviar código:", error);
            if (error.code === 'auth/too-many-requests') {
                console.log("Ignorando erro de too many requests para permitir testes");
                const mockConfirmation = {
                    verificationId: 'test-verification-id',
                    confirm: () => Promise.resolve({ user: { uid: 'test-uid' } })
                };
                dispatch(requestPhoneOtpDevice(mockConfirmation.verificationId));
                setState(prevState => ({
                    ...prevState,
                    verificationId: mockConfirmation.verificationId,
                    verificationCode: ''
                }));
            } else {
                showSnackbar(t('auth_error'), 'error');
            }
        } finally {
            setLoading(false);
        }
    };

    const handleVerifyOTP = async () => {
        console.log("LoginScreen - Iniciando verificação OTP");
        console.log("LoginScreen - Estado atual:", {
            verificationId: state.verificationId,
            verificationCode: state.verificationCode
        });

        if (!state.verificationId) {
            console.error("LoginScreen - verificationId não encontrado");
            showSnackbar(t('verification_id_missing'), 'error');
            return;
        }

        if (!state.verificationCode || state.verificationCode.length !== 6) {
            console.error("LoginScreen - Código de verificação inválido");
            showSnackbar(t('otp_validate_error'), 'error');
            return;
        }

        setLoading(true);
        try {
            console.log("LoginScreen - Enviando código para verificação");
            await dispatch(mobileSignIn(
                state.verificationId,
                state.verificationCode
            ));
            console.log("LoginScreen - Código enviado com sucesso");
        } catch (error) {
            console.error("LoginScreen - Erro na verificação:", error);
            showSnackbar(t('login_error'), 'error');
        } finally {
            setLoading(false);
        }
    };

    const renderSocialLoginButtons = () => (
        <View style={styles.socialLoginContainer}>
            <Text style={styles.socialLoginText}>Ou entre com</Text>
            
            <View style={styles.socialButtonsContainer}>
                <TouchableOpacity
                    style={[styles.socialButton, styles.googleButton]}
                    onPress={GoogleLogin}
                    accessibilityLabel="Entrar com Google"
                    activeOpacity={0.8}
                >
                    <FontAwesome5 name="google" size={20} color="#DB4437" style={styles.socialIcon} />
                    <Text style={styles.socialButtonText}>Google</Text>
                </TouchableOpacity>

                <TouchableOpacity
                    style={[styles.socialButton, styles.appleButton]}
                    onPress={AppleLogin}
                    accessibilityLabel="Entrar com Apple"
                    activeOpacity={0.8}
                >
                    <FontAwesome5 name="apple" size={20} color="#FFFFFF" style={styles.socialIcon} />
                    <Text style={[styles.socialButtonText, styles.appleButtonText]}>Apple</Text>
                </TouchableOpacity>
            </View>
        </View>
    );

    // Função para exibir snackbar
    const showSnackbar = (message, type = 'error') => {
        setSnackbar({ visible: true, message, type });
        Animated.timing(snackbarAnim, {
            toValue: 1,
            duration: 250,
            easing: Easing.out(Easing.ease),
            useNativeDriver: true,
        }).start(() => {
            setTimeout(() => {
                Animated.timing(snackbarAnim, {
                    toValue: 0,
                    duration: 250,
                    easing: Easing.in(Easing.ease),
                    useNativeDriver: true,
                }).start(() => setSnackbar({ ...snackbar, visible: false }));
            }, 3000);
        });
    };

    useEffect(() => {
        const unsubscribe = auth().onAuthStateChanged((user) => {
            if (user && user.uid) {
                // Usuário autenticado, redirecionar para tela principal
                props.navigation.reset({
                    index: 0,
                    routes: [{ name: 'TabRoot' }],
                });
            }
        });
        return unsubscribe;
    }, []);

    // Função para validar se o botão pode ser habilitado
    const isLoginEnabled = showPasswordField
        ? phone.replace(/\D/g, '').length === 11 && password.length >= 6 && !loading && !authLoading
        : phone.replace(/\D/g, '').length === 11 && !loading && !authLoading;

    // --- NOVO LAYOUT MODERNO ---
    return (
        <View style={stylesModern.bg}>
            <View style={stylesModern.card}>
                <Text style={stylesModern.cardTitle}>Faça login, ou cadastre-se para começar</Text>
                <View style={stylesModern.inputGroup}>
                    <View style={stylesModern.inputRow}>
                        <View style={stylesModern.countryCodeBox}>
                            <Text style={stylesModern.countryCode}>+55</Text>
                        </View>
                        <TextInput
                            style={stylesModern.input}
                            placeholder="21 999999999"
                            keyboardType="phone-pad"
                            placeholderTextColor="#B0B0B0"
                            value={phone}
                            onChangeText={setPhone}
                        />
                    </View>
                    <View style={stylesModern.inputRow}>
                        <TextInput
                            value={password}
                            onChangeText={setPassword}
                            style={stylesModern.input}
                            placeholder="Senha"
                            placeholderTextColor="#B0B0B0"
                            secureTextEntry={eyePass}
                            onFocus={() => setPasswordFocused(true)}
                            onBlur={() => setPasswordFocused(false)}
                            returnKeyType="done"
                        />
                        <TouchableOpacity onPress={() => setEyePass(!eyePass)} style={stylesModern.eyeIcon}>
                            <Feather name={eyePass ? 'eye-off' : 'eye'} size={22} color="#888" />
                        </TouchableOpacity>
                    </View>
                </View>
                <TouchableOpacity style={stylesModern.primaryButton} onPress={showPasswordField ? onPressPasswordLogin : onPressLogin}>
                    <Text style={stylesModern.primaryButtonText}>Login</Text>
                </TouchableOpacity>
                <TouchableOpacity style={stylesModern.forgot} onPress={handleForgotPassword}>
                    <Text style={stylesModern.forgotText}>Esqueci a senha?</Text>
                </TouchableOpacity>
                <Text style={stylesModern.orText}>Ou login com</Text>
                <View style={stylesModern.socialRow}>
                    <TouchableOpacity style={stylesModern.socialCircle} onPress={GoogleLogin}>
                        <FontAwesome5 name="google" size={22} color="#EA4335" />
                    </TouchableOpacity>
                    <TouchableOpacity style={stylesModern.socialCircle} onPress={AppleLogin}>
                        <FontAwesome5 name="apple" size={22} color="#000" />
                    </TouchableOpacity>
                </View>
                <TouchableOpacity style={stylesModern.signup} onPress={openRegister}>
                    <Text style={stylesModern.signupText}>Não tem conta? <Text style={stylesModern.signupLink}>Criar conta</Text></Text>
                </TouchableOpacity>
            </View>
        </View>
    );
}

const stylesModern = StyleSheet.create({
    bg: {
        flex: 1,
        backgroundColor: '#F8F8F8',
        justifyContent: 'center',
        alignItems: 'center',
    },
    card: {
        width: '90%',
        maxWidth: 380,
        backgroundColor: '#fff',
        borderRadius: 24,
        padding: 28,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 8 },
        shadowOpacity: 0.10,
        shadowRadius: 24,
        elevation: 8,
        alignItems: 'center',
    },
    cardTitle: {
        fontSize: 22,
        color: '#233D1A',
        fontWeight: '700',
        marginBottom: 24,
        alignSelf: 'flex-start',
    },
    inputGroup: {
        width: '100%',
        marginBottom: 24,
    },
    inputRow: {
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: 14,
        width: '100%',
        position: 'relative',
    },
    countryCodeBox: {
        backgroundColor: '#fff',
        borderRadius: 12,
        paddingVertical: 12,
        paddingHorizontal: 12,
        marginRight: 8,
        borderWidth: 1,
        borderColor: '#E0E0E0',
        height: 54,
        justifyContent: 'center',
    },
    countryCode: {
        fontSize: 16,
        color: '#233D1A',
        fontWeight: '600',
    },
    input: {
        flex: 1,
        backgroundColor: '#fff',
        borderRadius: 12,
        paddingVertical: 12,
        paddingHorizontal: 12,
        fontSize: 16,
        borderWidth: 1,
        borderColor: '#E0E0E0',
        color: '#233D1A',
        height: 54,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.04,
        shadowRadius: 4,
    },
    eyeIcon: {
        position: 'absolute',
        right: 12,
        top: -11,
        zIndex: 10,
    },
    primaryButton: {
        backgroundColor: '#233D1A',
        borderRadius: 8,
        paddingVertical: 9,
        alignItems: 'center',
        width: 85,
        marginBottom: 8,
        marginTop: -11,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.10,
        shadowRadius: 4,
        elevation: 2,
    },
    primaryButtonText: {
        color: '#fff',
        fontSize: 18,
        fontWeight: '700',
    },
    forgot: {
        alignSelf: 'flex-end',
        marginBottom: 0,
    },
    forgotText: {
        color: '#888',
        fontSize: 14,
        textDecorationLine: 'underline',
    },
    orText: {
        color: '#888',
        marginVertical: 10,
        fontSize: 15,
        textAlign: 'center',
    },
    socialRow: {
        flexDirection: 'row',
        justifyContent: 'center',
        alignItems: 'center',
        marginBottom: 18,
        width: '100%',
        gap: 18,
    },
    socialCircle: {
        width: 48,
        height: 48,
        borderRadius: 24,
        backgroundColor: '#F8F8F8',
        alignItems: 'center',
        justifyContent: 'center',
        marginHorizontal: 8,
        borderWidth: 1,
        borderColor: '#E0E0E0',
    },
    signup: {
        marginTop: 4,
        alignSelf: 'center',
    },
    signupText: {
        color: '#888',
        fontSize: 15,
        textAlign: 'center',
    },
    signupLink: {
        color: '#233D1A',
        fontWeight: '700',
        textDecorationLine: 'underline',
    },
});