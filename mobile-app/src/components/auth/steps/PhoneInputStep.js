import React, { useRef, useState } from 'react';
import {
    View,
    TouchableOpacity,
    Alert as NativeAlert,
    StyleSheet,
    Text,
    TextInput,
    ScrollView,
    KeyboardAvoidingView,
    Keyboard,
    Platform
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import auth from '@react-native-firebase/auth';
import { fonts } from '../../../theme/runtimeTokens';
import { Ionicons } from '@expo/vector-icons';
import {
    allowCustomOtpFallback,
    allowQaOtpForceFlow,
    isE2ETestBuild,
    isSimulatorBuild
} from '../../../config/runtimeAccessPolicy';
import apiClient from '../../../services/httpClient';
import UserAuthService from '../../../services/UserAuthService';
import Logger from '../../../utils/Logger';
import onboardingTheme from '../common/onboardingTheme';
import ContinueButton from '../common/ContinueButton';
import { toUserFriendlyError, toUserFriendlyMessage } from '../../../utils/friendlyErrorMessages';

const { color, radius, spacing } = onboardingTheme;

const Alert = {
    ...NativeAlert,
    alert: (title, message, buttons, options) =>
        NativeAlert.alert(
            title || 'Atencao',
            toUserFriendlyMessage(message, {
                context: 'auth',
                fallbackMessage: 'Nao foi possivel concluir a autenticacao agora. Tente novamente.'
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
        return 'Telefone Invalido';
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
        return 'Erro de Conexao';
    }

    return 'Erro de Autenticacao';
}

const PhoneInputStep = ({ onVerificationSent, onPasswordLoginSuccess }) => {
    const insets = useSafeAreaInsets();
    const isAndroid = Platform.OS === 'android';
    const [phoneNumber, setPhoneNumber] = useState('');
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
    const allowForcedQaOtpFlow = allowQaOtpForceFlow();
    const shouldDisableFirebaseAppVerificationForE2E =
        allowForcedQaOtpFlow ||
        isE2ETestBuild() ||
        isSimulatorBuild();
    const containerPaddingBottom = isAndroid
        ? (requiresPassword ? spacing.xxl + spacing.lg : spacing.lg) + insets.bottom
        : spacing.lg;
    const footerPaddingBottom = isAndroid
        ? (requiresPassword
            ? Math.max(spacing.md, insets.bottom + spacing.sm)
            : Math.max(spacing.xs, insets.bottom + spacing.xs))
        : null;
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
                fallbackMessage: 'Nao foi possivel enviar o codigo de recuperacao agora.'
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
                setPasswordError('Senha incorreta ou conta sem senha configurada.');
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
                fallbackMessage: 'Nao foi possivel redefinir a senha agora.'
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
                    'Para este telefone, continue com o código recebido por SMS.'
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
                fallbackMessage: 'Nao foi possivel validar esse telefone para login com senha.'
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
            const nextAction = String(phoneFlow?.nextAction || 'OTP_REQUIRED').toUpperCase();
            setResolvedPhone(phoneFlow);

            if (nextAction === 'PASSWORD_LOGIN' && hasPasswordConfigured) {
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
            if (forceCustomOtpFlow) {
                Logger.log('📲 Forçando fluxo OTP customizado para conta QA controlada.');
                const response = await requestOtpWithFallback(fullPhoneNumber);
                if (!response.data || !response.data.success) {
                    throw new Error(response.data?.error || 'Erro ao enviar OTP');
                }

                const confirmation = {
                    verificationId: response.data.verificationId,
                    isCustomOtp: true
                };

                if (onVerificationSent) {
                    onVerificationSent(confirmation, fullPhoneNumber, isExistingUser);
                }
                return;
            }

            Logger.log('📱 Enviando OTP via Firebase Auth...');
            if (shouldDisableFirebaseAppVerificationForE2E) {
                try {
                    auth().settings.appVerificationDisabledForTesting = true;
                    Logger.log('🧪 Firebase app verification desativado para ambiente controlado de QA/E2E.');
                } catch (appVerificationError) {
                    Logger.warn('⚠️ Não foi possível desativar app verification para testes:', appVerificationError?.message || appVerificationError);
                }

                if (Platform.OS === 'android') {
                    const preconfiguredSmsCode = QA_SMS_CODE_BY_PHONE.get(fullPhoneNumber);
                    if (preconfiguredSmsCode) {
                        try {
                            await auth().settings.setAutoRetrievedSmsCodeForPhoneNumber(
                                fullPhoneNumber,
                                preconfiguredSmsCode
                            );
                            Logger.log('🧪 SMS auto-retrieval configurado para Android QA/E2E.', {
                                phoneNumber: fullPhoneNumber
                            });
                        } catch (autoSmsError) {
                            Logger.warn('⚠️ Falha ao configurar auto SMS para Android:', autoSmsError?.message || autoSmsError);
                        }
                    }
                }
            }
            try {
                const firebaseConfirmation = await auth().signInWithPhoneNumber(fullPhoneNumber);
                if (onVerificationSent) {
                    onVerificationSent(firebaseConfirmation, fullPhoneNumber, isExistingUser);
                }
                return;
            } catch (firebaseError) {
                Logger.error('❌ Falha no envio OTP via Firebase:', firebaseError);
                if (!enableCustomOtpFallback) {
                    throw firebaseError;
                }
                Logger.warn('⚠️ Aplicando fallback de OTP customizado para ambiente de suporte.');
            }

            // Fallback controlado (dev/review/suporte)
            const response = await requestOtpWithFallback(fullPhoneNumber);
            if (!response.data || !response.data.success) {
                throw new Error(response.data?.error || 'Erro ao enviar OTP');
            }

            const confirmation = {
                verificationId: response.data.verificationId,
                isCustomOtp: true
            };

            if (onVerificationSent) {
                onVerificationSent(confirmation, fullPhoneNumber, isExistingUser);
            }
        } catch (error) {
            Logger.error("Erro no handleContinue:", error);
            const friendlyError = toUserFriendlyError(error, {
                context: 'auth',
                fallbackMessage: 'Nao foi possivel concluir a autenticacao agora. Tente novamente.'
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
        <KeyboardAvoidingView
            style={styles.keyboardContainer}
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
            keyboardVerticalOffset={Platform.OS === 'ios' ? 12 : 0}
        >
            <ScrollView
                style={styles.scrollView}
                scrollEnabled={false}
                contentContainerStyle={[
                    styles.container,
                    isAndroid && requiresPassword ? styles.containerWithExpandedForm : null,
                    { paddingBottom: containerPaddingBottom }
                ]}
                keyboardShouldPersistTaps="handled"
                keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
                showsVerticalScrollIndicator={false}
            >
                <View style={styles.header}>
                    <View style={styles.eyebrow}>
                        <View style={styles.leafMark} />
                        <Text style={styles.eyebrowText}>Configuração em 2 min</Text>
                    </View>
                    <Text style={styles.title}>Comece pelo telefone</Text>
                    <Text style={styles.subtitle}>
                        Enviaremos códigos por SMS e avisos importantes da sua corrida.
                    </Text>
                </View>

                <View style={styles.contentCard}>
                    <View style={styles.inputContainer}>
                        <TouchableOpacity style={styles.countrySelector}>
                            <Text style={styles.countryCode}>+55</Text>
                        </TouchableOpacity>

                        <TextInput
                            testID="auth-phone-input"
                            placeholder="Celular"
                            placeholderTextColor={color.textMuted}
                            keyboardType="phone-pad"
                            value={phoneNumber}
                            onChangeText={handlePhoneChanged}
                            maxLength={16}
                            editable={!loading && !checking}
                            returnKeyType="done"
                            onSubmitEditing={() => {
                                Keyboard.dismiss();
                                handleContinue();
                            }}
                            blurOnSubmit
                            style={styles.input}
                        />
                    </View>

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
                                    accessibilityLabel={forgotPasswordMode ? 'auth-reset-new-password-input' : 'auth-password-input'}
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
                                        placeholder="Código recebido por SMS"
                                        placeholderTextColor={color.textMuted}
                                        value={resetOtp}
                                        onChangeText={(value) => {
                                            setResetOtp(String(value || '').replace(/\D/g, '').slice(0, 6));
                                            setPasswordError('');
                                        }}
                                        keyboardType="number-pad"
                                        editable={!loading}
                                        testID="auth-reset-otp-input"
                                        accessibilityLabel="auth-reset-otp-input"
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
                                            accessibilityLabel="auth-reset-confirm-password-input"
                                            style={styles.passwordInput}
                                        />
                                        <TouchableOpacity
                                            style={styles.passwordEyeButton}
                                            onPress={() => setShowConfirmNewPassword((prev) => !prev)}
                                            disabled={loading}
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

                <View
                    style={[
                        styles.footer,
                        isAndroid && requiresPassword ? styles.footerExpanded : null,
                        isAndroid && footerPaddingBottom !== null ? { paddingBottom: footerPaddingBottom } : null
                    ]}
                >
                    <ContinueButton
                        testID="auth-continue-btn"
                        accessibilityLabel="auth-continue-btn"
                        onPress={handleContinue}
                        text={loading || checking
                            ? 'Continuando...'
                            : requiresPassword
                                ? (forgotPasswordMode ? 'Redefinir senha' : 'Entrar')
                                : 'Continuar'}
                        disabled={phoneNumber.length < 10}
                        style={styles.continueButton}
                    />

                    {!requiresPassword ? (
                        <>
                            <Text style={styles.firstAccessHint}>
                                Informe seu telefone para confirmar sua conta com segurança.
                            </Text>
                            <TouchableOpacity
                                activeOpacity={0.82}
                                onPress={handlePasswordFallbackPressed}
                                disabled={loading || checking || phoneNumber.length < 10}
                                style={styles.passwordFallbackButton}
                                testID="auth-password-fallback-btn"
                                accessibilityLabel="auth-password-fallback-btn"
                            >
                                <Text style={styles.passwordFallbackText}>Já tenho senha</Text>
                            </TouchableOpacity>
                        </>
                    ) : null}
                </View>
            </ScrollView>
        </KeyboardAvoidingView>
    );
};

const styles = StyleSheet.create({
    keyboardContainer: {
        flex: 1
    },
    scrollView: {
        flex: 1
    },
    container: {
        flexGrow: 1,
        paddingHorizontal: spacing.lg,
        paddingTop: spacing.xl,
        paddingBottom: spacing.lg,
        justifyContent: 'flex-start'
    },
    containerWithExpandedForm: {
        paddingBottom: spacing.xxl + spacing.lg
    },
    header: {
        marginTop: spacing.xl,
        marginBottom: spacing.lg
    },
    eyebrow: {
        alignSelf: 'flex-start',
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        borderRadius: radius.pill,
        paddingHorizontal: 10,
        paddingVertical: 8,
        backgroundColor: color.accentSoft,
        marginBottom: spacing.md
    },
    leafMark: {
        width: 14,
        height: 14,
        borderTopLeftRadius: 10,
        borderTopRightRadius: 10,
        borderBottomRightRadius: 10,
        borderBottomLeftRadius: 3,
        backgroundColor: color.accent,
        transform: [{ rotate: '-34deg' }]
    },
    eyebrowText: {
        color: color.accent,
        fontSize: 12,
        lineHeight: 14,
        fontFamily: fonts.Bold
    },
    title: {
        marginBottom: spacing.sm,
        color: color.textPrimary,
        fontSize: 34,
        lineHeight: 38,
        fontFamily: fonts.Bold,
        textAlign: 'left',
        letterSpacing: 0
    },
    subtitle: {
        marginBottom: 0,
        color: color.textSecondary,
        fontSize: 15,
        lineHeight: 21,
        fontFamily: fonts.Regular,
        textAlign: 'left'
    },
    contentCard: {
        borderRadius: radius.xl,
        borderWidth: 1,
        borderColor: color.glassStroke,
        backgroundColor: color.panel,
        padding: spacing.sm,
        marginTop: 'auto',
        marginBottom: spacing.sm,
        shadowColor: color.accent,
        ...onboardingTheme.elevation.soft
    },
    passwordInlineContainer: {
        marginTop: spacing.sm
    },
    passwordInputContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: color.surfaceMuted,
        borderWidth: 1,
        borderColor: color.border,
        borderRadius: radius.md,
        minHeight: 52,
        marginTop: spacing.xs
    },
    passwordInput: {
        flex: 1,
        paddingHorizontal: spacing.sm,
        fontSize: 15,
        lineHeight: 20,
        color: color.textPrimary,
        fontFamily: fonts.Medium
    },
    passwordEyeButton: {
        paddingHorizontal: spacing.sm,
        paddingVertical: spacing.xs
    },
    inlineTextInput: {
        backgroundColor: color.surfaceMuted,
        borderWidth: 1,
        borderColor: color.border,
        borderRadius: radius.md,
        minHeight: 52,
        marginTop: spacing.xs,
        paddingHorizontal: spacing.sm,
        fontSize: 15,
        lineHeight: 20,
        color: color.textPrimary,
        fontFamily: fonts.Medium
    },
    inlineLinkButton: {
        alignSelf: 'flex-start',
        marginTop: spacing.xs,
        paddingVertical: 4
    },
    inlineLinkText: {
        color: color.textSecondary,
        fontSize: 13,
        lineHeight: 18,
        fontFamily: fonts.SemiBold,
        textDecorationLine: 'underline'
    },
    inlineHintText: {
        marginTop: 6,
        color: color.textSecondary,
        fontSize: 12,
        lineHeight: 16,
        fontFamily: fonts.Medium
    },
    passwordErrorText: {
        marginTop: 6,
        color: color.error,
        fontSize: 12,
        lineHeight: 16,
        fontFamily: fonts.Medium
    },
    inputContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: color.surfaceMuted,
        borderWidth: 1,
        borderColor: color.border,
        borderRadius: radius.md,
        paddingRight: spacing.sm,
        minHeight: 58
    },
    countrySelector: {
        paddingHorizontal: spacing.sm,
        justifyContent: 'center',
        borderRightWidth: 1,
        borderRightColor: color.border,
        height: 58
    },
    countryCode: {
        marginTop: 1,
        color: color.textPrimary,
        fontSize: 16,
        lineHeight: 20,
        fontFamily: fonts.SemiBold
    },
    input: {
        flex: 1,
        height: 58,
        paddingHorizontal: spacing.sm,
        fontSize: 15,
        lineHeight: 20,
        letterSpacing: 0.2,
        color: color.textPrimary,
        fontFamily: fonts.Medium
    },
    footer: {
        marginTop: 0,
        paddingTop: spacing.xs,
        paddingBottom: spacing.xs
    },
    footerExpanded: {
        marginTop: spacing.sm,
        paddingBottom: spacing.xl
    },
    continueButton: {
        marginBottom: spacing.xs
    },
    firstAccessHint: {
        marginTop: spacing.xs,
        textAlign: 'center',
        color: color.textSecondary,
        fontSize: 13,
        lineHeight: 18,
        fontFamily: fonts.SemiBold
    },
    passwordFallbackButton: {
        marginTop: spacing.xs,
        alignSelf: 'center',
        paddingHorizontal: spacing.sm,
        paddingVertical: 4
    },
    passwordFallbackText: {
        color: color.textSecondary,
        fontSize: 13,
        lineHeight: 18,
        fontFamily: fonts.SemiBold,
        textDecorationLine: 'underline'
    }
});

export default PhoneInputStep;
