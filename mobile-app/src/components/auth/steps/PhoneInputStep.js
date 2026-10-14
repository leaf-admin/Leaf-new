import leafTypography from '../../prototype/LeafTypography';
import React, { useRef, useState } from 'react';
import {
    View,
    TouchableOpacity,
    Alert as NativeAlert,
    StyleSheet,
    Text,
    TextInput,
    Keyboard,
    Platform
} from 'react-native';
import auth from '@react-native-firebase/auth';
import { Ionicons } from '@expo/vector-icons';
import {
    allowCustomOtpFallback,
    allowQaOtpForceFlow,
    isE2ETestBuild,
    isSimulatorBuild,
    isWhatsAppOtpEnabled
} from '../../../config/runtimeAccessPolicy';
import apiClient from '../../../services/httpClient';
import UserAuthService from '../../../services/UserAuthService';
import Logger from '../../../utils/Logger';
import onboardingTheme from '../common/onboardingTheme';
import ContinueButton from '../common/ContinueButton';
import EditorialOnboardingScreen from '../common/EditorialOnboardingLayout';
import { formatBrazilPhone } from '../../onboarding/onboardingSteps';
import { toUserFriendlyError, toUserFriendlyMessage } from '../../../utils/friendlyErrorMessages';
import { getReviewAccountInfo } from '../../../config/reviewAccounts';

const { color, radius, spacing } = onboardingTheme;

const Alert = {
    ...NativeAlert,
    alert: (title, message, buttons, options) =>
        NativeAlert.alert(
            title || 'Atenção',
            toUserFriendlyMessage(message, {
                context: 'auth',
                fallbackMessage: 'Não foi possível concluir a autenticação agora. Tente novamente.'
            }),
            buttons,
            options
        )
};

const QA_SMS_CODE_BY_PHONE = new Map([
    ['+5521102938475', '992111'],
    ['+5521123456789', '992000']
]);

export function normalizePhoneInputValue(rawValue) {
    const digits = String(rawValue || '').replace(/\D/g, '');
    if (!digits) return '';

    if (digits.length > 11 && digits.startsWith('55')) {
        return digits.slice(2, 13);
    }

    return digits.slice(0, 11);
}

function resolveAuthAlertTitle(error, friendlyMessage = '') {
    const normalizedCode = String(
        error?.code ||
        error?.nativeErrorCode ||
        error?.userInfo?.code ||
        error?.userInfo?.nativeErrorCode ||
        ''
    ).toUpperCase();
    const normalizedText = [
        error?.message,
        error?.rawMessage,
        friendlyMessage
    ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();

    if (
        normalizedCode === '17010' ||
        normalizedCode === 'AUTH/TOO-MANY-REQUESTS' ||
        /17010|too many requests|muitas tentativas|rate limit/.test(normalizedText)
    ) {
        return 'Limite de Tentativas';
    }

    if (
        normalizedCode === 'AUTH/INVALID-PHONE-NUMBER' ||
        /invalid phone|numero de telefone invalido|telefone invalido/.test(normalizedText)
    ) {
        return 'Telefone inválido';
    }

    if (
        normalizedCode === 'AUTH/QUOTA-EXCEEDED' ||
        /quota|limite de sms|limite de envios/.test(normalizedText)
    ) {
        return 'Limite de Envios';
    }

    if (
        normalizedCode === 'NETWORK_ERROR' ||
        normalizedCode === 'AUTH/NETWORK-REQUEST-FAILED' ||
        /network|internet|conexao|connection/.test(normalizedText)
    ) {
        return 'Erro de Conexão';
    }

    return 'Erro de autenticação';
}

const PhoneInputStep = ({ onVerificationSent, onPasswordLoginSuccess, progressMeta, onBack }) => {
    const [phoneNumber, setPhoneNumber] = useState('');
    const [phoneFocused, setPhoneFocused] = useState(false);
    const [loading, setLoading] = useState(false);
    const [checking, setChecking] = useState(false);
    const [requiresPassword, setRequiresPassword] = useState(false);
    const [resolvedPhone, setResolvedPhone] = useState(null);
    const [password, setPassword] = useState('');
    const [showPassword, setShowPassword] = useState(false);
    const [passwordError, setPasswordError] = useState('');
    const [forgotPasswordMode, setForgotPasswordMode] = useState(false);
    const [resetVerificationId, setResetVerificationId] = useState(null);
    const [resetOtp, setResetOtp] = useState('');
    const [newPassword, setNewPassword] = useState('');
    const [confirmNewPassword, setConfirmNewPassword] = useState('');
    const [showNewPassword, setShowNewPassword] = useState(false);
    const [showConfirmNewPassword, setShowConfirmNewPassword] = useState(false);
    const continueInFlightRef = useRef(false);

    const enableCustomOtpFallback = allowCustomOtpFallback();
    const useWhatsAppOtp = isWhatsAppOtpEnabled();
    const otpChannelLabel = useWhatsAppOtp ? 'WhatsApp' : 'SMS';
    const allowForcedQaOtpFlow = allowQaOtpForceFlow();
    const shouldDisableFirebaseAppVerificationForE2E =
        allowForcedQaOtpFlow ||
        isE2ETestBuild() ||
        isSimulatorBuild();
    const FORCE_CUSTOM_OTP_NUMBERS = new Set(['21102938475', '21123456789']);

    const requestOtpWithFallback = async (fullPhoneNumber) => {
        const endpoints = [
            '/api/custom-otp/request-otp',
            '/custom-otp/request-otp'
        ];

        let lastError = null;

        for (const endpoint of endpoints) {
            try {
                return await apiClient.post(endpoint, { phone: fullPhoneNumber });
            } catch (error) {
                lastError = error;
                // Se não for 404, não faz sentido tentar fallback
                if (error?.response?.status !== 404) {
                    throw error;
                }
            }
        }

        throw lastError || new Error('Falha ao enviar OTP');
    };

    const resetInlinePasswordState = () => {
        setRequiresPassword(false);
        setResolvedPhone(null);
        setPassword('');
        setPasswordError('');
        setForgotPasswordMode(false);
        setResetVerificationId(null);
        setResetOtp('');
        setNewPassword('');
        setConfirmNewPassword('');
        setShowPassword(false);
        setShowNewPassword(false);
        setShowConfirmNewPassword(false);
    };

    const handlePhoneChanged = (value) => {
        setPhoneNumber(normalizePhoneInputValue(value));
        resetInlinePasswordState();
    };

    const requestPasswordResetOtpInline = async (fullPhoneNumber) => {
        const response = await apiClient.post('/api/auth/password/reset/request', {
            phone: fullPhoneNumber
        });
        const data = response?.data || {};
        if (!data?.success || !data?.verificationId) {
            throw new Error(data?.error || 'Não foi possível enviar o código de recuperação.');
        }
        setResetVerificationId(data.verificationId);
        setResetOtp('');
    };

    const handleForgotPasswordPressed = async (fullPhoneNumber) => {
        setLoading(true);
        try {
            await requestPasswordResetOtpInline(fullPhoneNumber);
            setForgotPasswordMode(true);
            setPasswordError('');
            Alert.alert('Código enviado', 'Digite o código recebido e defina sua nova senha.');
        } catch (error) {
            const friendlyError = toUserFriendlyError(error, {
                context: 'auth',
                fallbackMessage: 'Não foi possível enviar o código de recuperação agora.'
            });
            Alert.alert(resolveAuthAlertTitle(error, friendlyError.message), friendlyError.message);
        } finally {
            setLoading(false);
        }
    };

    const handleInlinePasswordLogin = async (fullPhoneNumber) => {
        if (!password || password.length < 6) {
            setPasswordError('Digite sua senha para continuar.');
            return;
        }

        setLoading(true);
        try {
            const userData = await UserAuthService.loginWithPassword(fullPhoneNumber, password);
            setPasswordError('');
            onPasswordLoginSuccess?.(userData);
        } catch (error) {
            Logger.error('❌ Erro no login inline com senha:', error);
            if (error?.message?.includes('Muitas tentativas')) {
                setPasswordError(error.message);
            } else {
                setPasswordError('Senha incorreta.');
            }
        } finally {
            setLoading(false);
        }
    };

    const handleInlinePasswordReset = async (fullPhoneNumber) => {
        const otp = String(resetOtp || '').trim();
        if (otp.length !== 6) {
            setPasswordError('Digite o código de 6 dígitos.');
            return;
        }
        if (!newPassword || newPassword.length < 8) {
            setPasswordError('A nova senha deve ter pelo menos 8 caracteres.');
            return;
        }
        if (newPassword !== confirmNewPassword) {
            setPasswordError('As senhas não coincidem.');
            return;
        }
        if (!/(?=.*[A-Za-z])(?=.*\d)/.test(newPassword)) {
            setPasswordError('A nova senha deve conter letras e números.');
            return;
        }
        if (!resetVerificationId) {
            setPasswordError('Solicite um novo código de recuperação.');
            return;
        }

        setLoading(true);
        try {
            const response = await apiClient.post('/api/auth/password/reset/confirm', {
                phone: fullPhoneNumber,
                verificationId: resetVerificationId,
                otp,
                password: newPassword,
                confirmPassword: confirmNewPassword
            });
            const data = response?.data || {};
            if (!data.success) {
                throw new Error(data.error || 'Não foi possível redefinir a senha.');
            }

            const userData = await UserAuthService.loginWithPassword(fullPhoneNumber, newPassword);
            setPasswordError('');
            onPasswordLoginSuccess?.(userData);
        } catch (error) {
            Logger.error('❌ Erro no reset inline de senha:', error);
            const friendlyError = toUserFriendlyError(error, {
                context: 'auth',
                fallbackMessage: 'Não foi possível redefinir a senha agora.'
            });
            setPasswordError(friendlyError.message);
        } finally {
            setLoading(false);
        }
    };

    const handlePasswordFallbackPressed = async () => {
        const normalizedPhoneInput = normalizePhoneInputValue(phoneNumber);
        if (normalizedPhoneInput.length < 10) {
            Alert.alert('Erro', 'Informe um telefone válido para entrar com senha.');
            return;
        }

        const fullPhoneNumber = `+55${normalizedPhoneInput}`;
        setLoading(true);
        setChecking(true);

        try {
            const phoneFlow = await UserAuthService.resolvePhoneAuthFlow(fullPhoneNumber);
            const canUsePasswordFallback =
                phoneFlow?.passwordFallbackAvailable === true &&
                phoneFlow?.hasPassword === true;

            if (!canUsePasswordFallback) {
                Alert.alert(
                    'Confirme seu telefone',
                    'Para este telefone, continue com o código recebido pelo WhatsApp.'
                );
                return;
            }

            setResolvedPhone(phoneFlow);
            setRequiresPassword(true);
            setForgotPasswordMode(false);
            setPassword('');
            setPasswordError('');
        } catch (error) {
            const friendlyError = toUserFriendlyError(error, {
                context: 'auth',
                fallbackMessage: 'Não foi possível validar esse telefone para login com senha.'
            });
            Alert.alert(resolveAuthAlertTitle(error, friendlyError.message), friendlyError.message);
        } finally {
            setLoading(false);
            setChecking(false);
        }
    };

    const handleContinue = async () => {
        if (continueInFlightRef.current) {
            Logger.warn('⚠️ Ignorando tentativa duplicada de continuar no fluxo de telefone.');
            return;
        }

        const normalizedPhoneInput = normalizePhoneInputValue(phoneNumber);

        if (normalizedPhoneInput.length < 10) {
            Alert.alert('Erro', 'Por favor, insira um número de telefone válido.');
            return;
        }

        continueInFlightRef.current = true;
        setLoading(true);
        setChecking(true);

        try {
            const fullPhoneNumber = `+55${normalizedPhoneInput}`;

            if (requiresPassword) {
                setChecking(false);
                if (forgotPasswordMode) {
                    await handleInlinePasswordReset(fullPhoneNumber);
                } else {
                    await handleInlinePasswordLogin(fullPhoneNumber);
                }
                return;
            }

            const forceCustomOtpFlow =
                allowForcedQaOtpFlow && FORCE_CUSTOM_OTP_NUMBERS.has(normalizedPhoneInput);
            let phoneFlow = null;
            let phoneFlowResolutionSource = 'password_resolver';
            try {
                phoneFlow = await UserAuthService.resolvePhoneAuthFlow(fullPhoneNumber);
            } catch (resolveError) {
                const resolveErrorMessage = resolveError?.message || String(resolveError);
                Logger.warn('⚠️ Falha ao resolver estratégia de autenticação por telefone. Aplicando fallback para OTP.', {
                    phoneNumber: fullPhoneNumber,
                    error: resolveErrorMessage
                });
                phoneFlow = {
                    exists: false,
                    uid: null,
                    hasPassword: false,
                    nextAction: 'OTP_REQUIRED',
                    passwordFallbackAvailable: false,
                    source: 'resolve_phone_failed_fallback'
                };
                phoneFlowResolutionSource = 'fallback_otp_after_resolve_error';
            }
            const isExistingUser = Boolean(phoneFlow?.exists || phoneFlow?.uid);
            const hasPasswordConfigured = phoneFlow?.hasPassword === true;
            const reviewAccount = getReviewAccountInfo(fullPhoneNumber);
            const isControlledReviewAccount = Boolean(reviewAccount?.phoneNumber);
            const nextAction = String(phoneFlow?.nextAction || 'OTP_REQUIRED').toUpperCase();
            setResolvedPhone(phoneFlow);

            if (
                nextAction === 'PASSWORD_LOGIN' &&
                hasPasswordConfigured &&
                !forceCustomOtpFlow &&
                !isControlledReviewAccount
            ) {
                Logger.log('🔐 Telefone existente detectado: seguir para senha.', {
                    phoneNumber: fullPhoneNumber,
                    hasPassword: phoneFlow.hasPassword,
                    source: phoneFlow.source || phoneFlowResolutionSource
                });
                setRequiresPassword(true);
                setForgotPasswordMode(false);
                setPassword('');
                setPasswordError('');
                return;
            }

            if (hasPasswordConfigured) {
                Logger.log('📱 Conta com senha detectada, mantendo OTP como fluxo principal.', {
                    phoneNumber: fullPhoneNumber,
                    nextAction,
                    source: phoneFlow.source || phoneFlowResolutionSource
                });
            } else if (phoneFlow.exists) {
                Logger.warn('⚠️ Conta existente sem senha: seguindo fluxo OTP para concluir autenticação.', {
                    phoneNumber: fullPhoneNumber,
                    source: phoneFlow.source || phoneFlowResolutionSource
                });
            }

            // 📱 Primeiro acesso: OTP + criação de conta
            const requestCustomOtp = async () => {
                const response = await requestOtpWithFallback(fullPhoneNumber);
                if (!response?.data?.success || !response?.data?.verificationId) {
                    throw new Error(response?.data?.error || 'Erro ao enviar OTP');
                }
                return {
                    verificationId: response.data.verificationId,
                    isCustomOtp: true,
                    channel: response.data.channel || 'whatsapp',
                    expiresIn: response.data.expiresIn || 300
                };
            };

            const requestFirebaseOtp = async () => {
                if (shouldDisableFirebaseAppVerificationForE2E) {
                    try {
                        auth().settings.appVerificationDisabledForTesting = true;
                        Logger.log('🧪 Firebase app verification desativado para fallback legado de QA/E2E.');
                    } catch (appVerificationError) {
                        Logger.warn('⚠️ Não foi possível desativar app verification para fallback:', appVerificationError?.message || appVerificationError);
                    }

                    if (Platform.OS === 'android') {
                        const preconfiguredSmsCode = QA_SMS_CODE_BY_PHONE.get(fullPhoneNumber);
                        if (preconfiguredSmsCode) {
                            try {
                                await auth().settings.setAutoRetrievedSmsCodeForPhoneNumber(
                                    fullPhoneNumber,
                                    preconfiguredSmsCode
                                );
                            } catch (autoSmsError) {
                                Logger.warn('⚠️ Falha ao configurar auto SMS para fallback:', autoSmsError?.message || autoSmsError);
                            }
                        }
                    }
                }

                const firebaseConfirmation = await auth().signInWithPhoneNumber(fullPhoneNumber);
                // confirm() lives on the ConfirmationResult prototype; spreading drops it.
                return Object.assign(firebaseConfirmation, {
                    channel: 'sms',
                    isCustomOtp: false
                });
            };

            if (forceCustomOtpFlow) {
                Logger.log('📲 Forçando fluxo OTP customizado para conta QA controlada.');
                const confirmation = await requestCustomOtp();

                if (onVerificationSent) {
                    onVerificationSent(confirmation, fullPhoneNumber, isExistingUser);
                }
                return;
            }

            if (useWhatsAppOtp) {
                Logger.log('📲 Enviando OTP via WhatsApp pelo backend Leaf...', {
                    phoneNumber: fullPhoneNumber
                });
                try {
                    const confirmation = await requestCustomOtp();
                    onVerificationSent?.(confirmation, fullPhoneNumber, isExistingUser);
                    return;
                } catch (whatsappError) {
                    Logger.error('❌ Falha no envio OTP via WhatsApp:', whatsappError);
                    if (!enableCustomOtpFallback) {
                        throw whatsappError;
                    }
                    Logger.warn('⚠️ Aplicando fallback legado de SMS somente no ambiente controlado.');
                }
            }

            try {
                const confirmation = await requestFirebaseOtp();
                onVerificationSent?.(confirmation, fullPhoneNumber, isExistingUser);
                return;
            } catch (firebaseError) {
                if (!useWhatsAppOtp && enableCustomOtpFallback) {
                    Logger.warn('⚠️ Firebase SMS indisponível; tentando OTP customizado somente no ambiente controlado.');
                    const confirmation = await requestCustomOtp();
                    onVerificationSent?.(confirmation, fullPhoneNumber, isExistingUser);
                    return;
                }
                throw firebaseError;
            }
        } catch (error) {
            Logger.error("Erro no handleContinue:", error);
            const friendlyError = toUserFriendlyError(error, {
                context: 'auth',
                fallbackMessage: 'Não foi possível concluir a autenticação agora. Tente novamente.'
            });

            Alert.alert(
                resolveAuthAlertTitle(error, friendlyError.message),
                friendlyError.message
            );
        } finally {
            continueInFlightRef.current = false;
            setLoading(false);
            if (!requiresPassword) {
                setChecking(false);
            }
        }
    };

    return (
        <EditorialOnboardingScreen
            keyboard
            showBack={Boolean(onBack)}
            onBack={onBack}
            progressMeta={progressMeta}
            title={requiresPassword ? 'Bem-vindo de volta' : 'Qual é o seu número?'}
            description={requiresPassword
                ? 'Entre com a senha deste celular.'
                : `Enviamos um código por ${otpChannelLabel} para confirmar que é você.`}
            childrenStyle={styles.childrenWrap}
            footer={(
                <View>
                    <ContinueButton
                        testID="auth-continue-btn"
                        onPress={handleContinue}
                        text={loading || checking
                            ? 'Continuando…'
                            : requiresPassword
                                ? (forgotPasswordMode ? 'Redefinir senha' : 'Entrar')
                                : 'Continuar'}
                        disabled={loading || phoneNumber.length < 10}
                    />

                    {!requiresPassword ? (
                        <>
                            <Text style={styles.hiddenText}>
                                Informe seu celular para confirmar sua conta com segurança.
                            </Text>
                            <TouchableOpacity
                                activeOpacity={0.82}
                                onPress={handlePasswordFallbackPressed}
                                disabled={loading || checking || phoneNumber.length < 10}
                                style={styles.passwordFallbackButton}
                                testID="auth-password-fallback-btn"
                                accessibilityRole="button"
                                accessibilityLabel="Já tenho senha"
                                accessibilityHint="Entrar com a senha deste celular."
                            >
                                <Text style={styles.passwordFallbackText}>Já tenho senha</Text>
                            </TouchableOpacity>
                        </>
                    ) : null}
                </View>
            )}
        >
                <View style={styles.contentCard}>
                    <Text style={styles.fieldLabel}>Telefone com DDD</Text>
                    <View style={[styles.inputContainer, phoneFocused && styles.inputContainerFocused]}>
                        <View
                            style={styles.countrySelector}
                            accessible
                            accessibilityRole="text"
                            accessibilityLabel="Código do país +55"
                        >
                            <Text style={styles.countryCode} accessible={false}>+55</Text>
                        </View>

                        <TextInput
                            testID="auth-phone-input"
                            placeholder="(21) 99999-9999"
                            accessibilityLabel="Número de celular com DDD"
                            accessibilityHint="Digite o número com DDD, sem o código do país."
                            placeholderTextColor={color.textMuted}
                            selectionColor="#222222"
                            keyboardType="phone-pad"
                            value={formatBrazilPhone(phoneNumber)}
                            onChangeText={handlePhoneChanged}
                            maxLength={16}
                            editable={!loading && !checking}
                            returnKeyType="done"
                            onSubmitEditing={() => {
                                Keyboard.dismiss();
                                handleContinue();
                            }}
                            blurOnSubmit
                            onFocus={() => setPhoneFocused(true)}
                            onBlur={() => setPhoneFocused(false)}
                            style={styles.input}
                        />
                    </View>

                    {!requiresPassword ? (
                        <View style={styles.accessHint}>
                            <Ionicons name="lock-closed-outline" size={16} color={color.textMuted} />
                            <Text style={styles.accessHintText}>
                                Seu número fica protegido e só é usado para acessar a Leaf.
                            </Text>
                        </View>
                    ) : null}

                    {requiresPassword ? (
                        <View style={styles.passwordInlineContainer}>
                            <View style={styles.passwordInputContainer}>
                                <TextInput
                                    placeholder={forgotPasswordMode ? 'Nova senha' : 'Senha'}
                                    placeholderTextColor={color.textMuted}
                                    value={forgotPasswordMode ? newPassword : password}
                                    onChangeText={(value) => {
                                        if (forgotPasswordMode) {
                                            setNewPassword(value);
                                        } else {
                                            setPassword(value);
                                        }
                                        setPasswordError('');
                                    }}
                                    autoCapitalize="none"
                                    autoCorrect={false}
                                    secureTextEntry={forgotPasswordMode ? !showNewPassword : !showPassword}
                                    editable={!loading}
                                    testID={forgotPasswordMode ? 'auth-reset-new-password-input' : 'auth-password-input'}
                                    accessibilityLabel={forgotPasswordMode ? 'Nova senha' : 'Senha'}
                                    style={styles.passwordInput}
                                />
                                <TouchableOpacity
                                    style={styles.passwordEyeButton}
                                    onPress={() => {
                                        if (forgotPasswordMode) {
                                            setShowNewPassword((prev) => !prev);
                                        } else {
                                            setShowPassword((prev) => !prev);
                                        }
                                    }}
                                    disabled={loading}
                                    accessibilityRole="button"
                                    accessibilityLabel={
                                        (forgotPasswordMode ? showNewPassword : showPassword)
                                            ? 'Ocultar senha'
                                            : 'Mostrar senha'
                                    }
                                >
                                    <Ionicons
                                        name={(forgotPasswordMode ? showNewPassword : showPassword) ? 'eye-off' : 'eye'}
                                        size={20}
                                        color={color.textMuted}
                                    />
                                </TouchableOpacity>
                            </View>

                            {forgotPasswordMode ? (
                                <>
                                    <TextInput
                                        placeholder="Código de recuperação"
                                        placeholderTextColor={color.textMuted}
                                        value={resetOtp}
                                        onChangeText={(value) => {
                                            setResetOtp(String(value || '').replace(/\D/g, '').slice(0, 6));
                                            setPasswordError('');
                                        }}
                                        keyboardType="number-pad"
                                        editable={!loading}
                                        testID="auth-reset-otp-input"
                                        accessibilityLabel="Código de recuperação"
                                        style={styles.inlineTextInput}
                                    />
                                    <View style={styles.passwordInputContainer}>
                                        <TextInput
                                            placeholder="Confirmar nova senha"
                                            placeholderTextColor={color.textMuted}
                                            value={confirmNewPassword}
                                            onChangeText={(value) => {
                                                setConfirmNewPassword(value);
                                                setPasswordError('');
                                            }}
                                            autoCapitalize="none"
                                            autoCorrect={false}
                                            secureTextEntry={!showConfirmNewPassword}
                                            editable={!loading}
                                            testID="auth-reset-confirm-password-input"
                                            accessibilityLabel="Confirmar nova senha"
                                            style={styles.passwordInput}
                                        />
                                        <TouchableOpacity
                                            style={styles.passwordEyeButton}
                                            onPress={() => setShowConfirmNewPassword((prev) => !prev)}
                                            disabled={loading}
                                            accessibilityRole="button"
                                            accessibilityLabel={
                                                showConfirmNewPassword
                                                    ? 'Ocultar confirmação de senha'
                                                    : 'Mostrar confirmação de senha'
                                            }
                                        >
                                            <Ionicons
                                                name={showConfirmNewPassword ? 'eye-off' : 'eye'}
                                                size={20}
                                                color={color.textMuted}
                                            />
                                        </TouchableOpacity>
                                    </View>
                                    <TouchableOpacity
                                        activeOpacity={0.82}
                                        onPress={() => handleForgotPasswordPressed(`+55${normalizePhoneInputValue(phoneNumber)}`)}
                                        disabled={loading}
                                        style={styles.inlineLinkButton}
                                        accessibilityRole="button"
                                        accessibilityLabel="Reenviar código"
                                    >
                                        <Text style={styles.inlineLinkText}>Reenviar código</Text>
                                    </TouchableOpacity>
                                </>
                            ) : (
                                <TouchableOpacity
                                    activeOpacity={0.82}
                                    onPress={() => handleForgotPasswordPressed(`+55${normalizePhoneInputValue(phoneNumber)}`)}
                                    disabled={loading}
                                    style={styles.inlineLinkButton}
                                >
                                    <Text style={styles.inlineLinkText}>Esqueci minha senha</Text>
                                </TouchableOpacity>
                            )}

                            {passwordError ? <Text style={styles.passwordErrorText}>{passwordError}</Text> : null}

                            {resolvedPhone?.hasPassword === false && !forgotPasswordMode ? (
                                <Text style={styles.inlineHintText}>
                                    Conta existente sem senha configurada. Use "Esqueci minha senha" para criar agora.
                                </Text>
                            ) : null}
                        </View>
                    ) : null}
                </View>
        </EditorialOnboardingScreen>
    );
};

const styles = StyleSheet.create({
    childrenWrap: {
        marginTop: 24
    },
    keyboardContainer: {
        flex: 1,
        backgroundColor: color.background
    },
    scrollView: {
        flex: 1
    },
    container: {
        flexGrow: 1,
        paddingHorizontal: 32,
        paddingTop: 66,
        paddingBottom: spacing.lg,
        justifyContent: 'flex-start'
    },
    containerWithExpandedForm: {
        paddingBottom: spacing.xxl + spacing.lg
    },
    header: {
        marginBottom: 94
    },
    title: {
        color: '#102018',
        fontSize: 22,
        lineHeight: 28,
        ...leafTypography.medium,
        textAlign: 'left',
        letterSpacing: 0
    },
    subtitle: {
        marginTop: 8,
        color: '#66756B',
        fontSize: 14,
        lineHeight: 20,
        ...leafTypography.regular,
        textAlign: 'left'
    },
    contentCard: {
        borderRadius: 0,
        borderWidth: 0,
        backgroundColor: 'transparent',
        padding: 0,
        marginTop: 0,
        marginBottom: spacing.sm
    },
    passwordInlineContainer: {
        marginTop: spacing.sm
    },
    passwordInputContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#FFFFFF',
        borderWidth: 1.5,
        borderColor: color.border,
        borderRadius: 16,
        minHeight: 56,
        marginTop: 12
    },
    passwordInput: {
        flex: 1,
        paddingHorizontal: 16,
        fontSize: 17,
        lineHeight: 22,
        color: color.textPrimary,
        ...leafTypography.regular
    },
    passwordEyeButton: {
        paddingHorizontal: spacing.sm,
        paddingVertical: spacing.xs
    },
    inlineTextInput: {
        backgroundColor: '#FFFFFF',
        borderWidth: 1.5,
        borderColor: color.border,
        borderRadius: 16,
        minHeight: 56,
        marginTop: 12,
        paddingHorizontal: 16,
        fontSize: 17,
        lineHeight: 22,
        color: color.textPrimary,
        ...leafTypography.regular
    },
    inlineLinkButton: {
        alignSelf: 'flex-start',
        marginTop: 12,
        paddingVertical: 4
    },
    inlineLinkText: {
        color: color.textPrimary,
        fontSize: 14,
        lineHeight: 20,
        ...leafTypography.medium,
        textDecorationLine: 'underline'
    },
    inlineHintText: {
        marginTop: 8,
        color: color.textSecondary,
        fontSize: 13,
        lineHeight: 18,
        ...leafTypography.regular
    },
    passwordErrorText: {
        marginTop: 8,
        color: color.error,
        fontSize: 13,
        lineHeight: 18,
        ...leafTypography.medium
    },
    inputContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#FFFFFF',
        borderWidth: 1.5,
        borderColor: color.border,
        borderRadius: 16,
        paddingRight: 16,
        minHeight: 60
    },
    inputContainerFocused: {
        borderColor: color.borderStrong
    },
    countrySelector: {
        width: 60,
        justifyContent: 'center',
        borderRightWidth: StyleSheet.hairlineWidth,
        borderRightColor: color.border,
        minHeight: 28
    },
    fieldLabel: {
        marginBottom: 8,
        color: color.textSecondary,
        fontSize: 13,
        lineHeight: 18,
        ...leafTypography.medium
    },
    accessHint: {
        marginTop: 16,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8
    },
    accessHintText: {
        flex: 1,
        color: color.textSecondary,
        fontSize: 13,
        lineHeight: 19,
        ...leafTypography.regular
    },
    countryCode: {
        color: color.textPrimary,
        fontSize: 18,
        ...leafTypography.semiBold,
        textAlign: 'center'
    },
    input: {
        flex: 1,
        minHeight: 56,
        paddingHorizontal: 16,
        paddingVertical: 12,
        fontSize: 20,
        letterSpacing: 0.3,
        color: color.textPrimary,
        ...leafTypography.semiBold
    },
    footer: {
        marginTop: 'auto',
        paddingTop: spacing.xs,
        paddingBottom: 22
    },
    footerExpanded: {
        marginTop: spacing.sm,
        paddingBottom: spacing.xl
    },
    continueButton: {
        minHeight: 46,
        borderRadius: 23,
        marginTop: 0,
        marginBottom: 22,
        shadowOpacity: 0,
        elevation: 0
    },
    continueButtonText: {
        fontSize: 12,
        lineHeight: 16,
        ...leafTypography.medium
    },
    firstAccessHint: {
        marginTop: 0,
        textAlign: 'center',
        color: color.textMuted,
        fontSize: 11,
        lineHeight: 15,
        ...leafTypography.regular,
        paddingHorizontal: 14
    },
    hiddenText: {
        position: 'absolute',
        width: 1,
        height: 1,
        opacity: 0
    },
    passwordFallbackButton: {
        marginTop: 14,
        alignSelf: 'center',
        paddingHorizontal: 12,
        paddingVertical: 6
    },
    passwordFallbackText: {
        color: color.textPrimary,
        fontSize: 15,
        lineHeight: 20,
        ...leafTypography.medium,
        textDecorationLine: 'underline'
    }
});

export default PhoneInputStep;
