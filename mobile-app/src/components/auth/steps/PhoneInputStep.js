import React, { useState } from 'react';
import { View, TouchableOpacity, Alert as NativeAlert, StyleSheet, Text, TextInput } from 'react-native';
import auth from '@react-native-firebase/auth';
import { fonts } from '../../../theme/runtimeTokens';
import { Ionicons } from '@expo/vector-icons';
import {
    allowCustomOtpFallback,
    allowQaOtpForceFlow
} from '../../../config/runtimeAccessPolicy';
import apiClient from '../../../services/httpClient';
import UserAuthService from '../../../services/UserAuthService';
import Logger from '../../../utils/Logger';
import onboardingTheme from '../common/onboardingTheme';
import ContinueButton from '../common/ContinueButton';
import { toUserFriendlyError, toUserFriendlyMessage } from '../../../utils/friendlyErrorMessages';

const { color, radius, spacing } = onboardingTheme;
const TEST_OTP_BYPASS_CODE = '0'.repeat(6);

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

const PhoneInputStep = ({ onSwitchToRegister, onVerificationSent, onPasswordLoginSuccess }) => {
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

    const enableCustomOtpFallback = allowCustomOtpFallback();
    const allowForcedQaOtpFlow = allowQaOtpForceFlow();
    const FORCE_CUSTOM_OTP_NUMBERS = new Set(['11999999999', '11888888888']);

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

    const verifyOtpWithFallback = async ({ phone, verificationId, otp }) => {
        const endpoints = [
            '/api/custom-otp/verify-otp',
            '/custom-otp/verify-otp'
        ];

        let lastError = null;

        for (const endpoint of endpoints) {
            try {
                return await apiClient.post(endpoint, {
                    phone,
                    verificationId,
                    otp
                });
            } catch (error) {
                lastError = error;
                if (error?.response?.status !== 404) {
                    throw error;
                }
            }
        }

        throw lastError || new Error('Falha ao verificar OTP');
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
        setPhoneNumber(value);
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

    const handleContinue = async () => {
        if (phoneNumber.length < 10) {
            Alert.alert('Erro', 'Por favor, insira um número de telefone válido.');
            return;
        }

        setLoading(true);
        setChecking(true);

        try {
            const fullPhoneNumber = `+55${phoneNumber}`;

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
                allowForcedQaOtpFlow && FORCE_CUSTOM_OTP_NUMBERS.has(phoneNumber);
            const isControlledTestPhone = FORCE_CUSTOM_OTP_NUMBERS.has(phoneNumber);

            if (isControlledTestPhone) {
                Logger.log('🧪 Conta de teste detectada: preparando bypass OTP controlado no backend.');
                try {
                    let verificationId = null;
                    let requestOtpError = null;

                    try {
                        const response = await requestOtpWithFallback(fullPhoneNumber);
                        if (response?.data?.success) {
                            verificationId = response?.data?.verificationId || null;
                        } else {
                            requestOtpError = response?.data?.error || 'Erro ao preparar OTP da conta de teste';
                        }
                    } catch (requestError) {
                        requestOtpError = requestError?.message || 'Falha ao preparar bypass OTP';
                    }

                    const verifyResponse = await verifyOtpWithFallback({
                        phone: fullPhoneNumber,
                        verificationId,
                        otp: TEST_OTP_BYPASS_CODE
                    });

                    if (!verifyResponse?.data?.success || !verifyResponse?.data?.customToken) {
                        throw new Error(
                            verifyResponse?.data?.error ||
                            requestOtpError ||
                            'Falha no bypass OTP da conta de teste'
                        );
                    }

                    const userCredential = await auth().signInWithCustomToken(verifyResponse.data.customToken);
                    if (userCredential?.user && onVerificationSent) {
                        onVerificationSent(
                            {
                                isTestOtpBypass: true,
                                bypassUser: userCredential.user
                            },
                            fullPhoneNumber,
                            false,
                            true
                        );
                        return;
                    }

                    throw new Error('Falha ao autenticar conta de teste para revisão');
                } catch (testOtpError) {
                    Logger.warn('⚠️ Falha ao aplicar bypass OTP de conta de teste.', {
                        error: testOtpError?.message
                    });
                    // Não interrompe o fluxo: o backend é a fonte de verdade para liberar ou não o bypass.
                    // Se o bypass não estiver disponível, seguimos no caminho normal (senha/OTP).
                }
            }

            const phoneFlow = await UserAuthService.resolvePhoneAuthFlow(fullPhoneNumber);
            if (phoneFlow.requiresPassword) {
                Logger.log('🔐 Telefone existente detectado: seguir para senha.', {
                    phoneNumber: fullPhoneNumber,
                    hasPassword: phoneFlow.hasPassword,
                    source: phoneFlow.source
                });
                setResolvedPhone(phoneFlow);
                setRequiresPassword(true);
                setForgotPasswordMode(false);
                setPassword('');
                setPasswordError('');
                return;
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
                    onVerificationSent(confirmation, fullPhoneNumber, false);
                }
                return;
            }

            Logger.log('📱 Enviando OTP via Firebase Auth...');
            try {
                const firebaseConfirmation = await auth().signInWithPhoneNumber(fullPhoneNumber);
                if (onVerificationSent) {
                    onVerificationSent(firebaseConfirmation, fullPhoneNumber, false);
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
                onVerificationSent(confirmation, fullPhoneNumber, false);
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
            setLoading(false);
            if (!requiresPassword) {
                setChecking(false);
            }
        }
    };

    return (
        <View style={styles.container}>
            <View style={styles.header}>
                <Text style={styles.title}>Bem-vindo(a) à Leaf</Text>
                <Text style={styles.subtitle}>
                    Digite seu número de telefone para continuar
                </Text>
            </View>

            <View style={styles.contentCard}>
                <View style={styles.inputContainer}>
                    <TouchableOpacity style={styles.countrySelector}>
                        <Text style={styles.countryCode}>+55</Text>
                    </TouchableOpacity>

                    <TextInput
                        testID="auth-phone-input"
                        placeholder="Número"
                        placeholderTextColor={color.textMuted}
                        keyboardType="phone-pad"
                        value={phoneNumber}
                        onChangeText={handlePhoneChanged}
                        maxLength={11}
                        editable={!loading && !checking}
                        returnKeyType="done"
                        onSubmitEditing={handleContinue}
                        blurOnSubmit={false}
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
                                secureTextEntry={forgotPasswordMode ? !showNewPassword : !showPassword}
                                editable={!loading}
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
                                    placeholder="Código OTP (6 dígitos)"
                                    placeholderTextColor={color.textMuted}
                                    value={resetOtp}
                                    onChangeText={(value) => {
                                        setResetOtp(String(value || '').replace(/\D/g, '').slice(0, 6));
                                        setPasswordError('');
                                    }}
                                    keyboardType="number-pad"
                                    editable={!loading}
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
                                        secureTextEntry={!showConfirmNewPassword}
                                        editable={!loading}
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
                                    onPress={() => handleForgotPasswordPressed(`+55${phoneNumber}`)}
                                    disabled={loading}
                                    style={styles.inlineLinkButton}
                                >
                                    <Text style={styles.inlineLinkText}>Reenviar código</Text>
                                </TouchableOpacity>
                            </>
                        ) : (
                            <TouchableOpacity
                                activeOpacity={0.82}
                                onPress={() => handleForgotPasswordPressed(`+55${phoneNumber}`)}
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

            <View style={styles.footer}>
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

                <TouchableOpacity
                    activeOpacity={0.82}
                    onPress={() => onSwitchToRegister?.(phoneNumber)}
                    disabled={loading || checking}
                    style={styles.registerButton}
                >
                    <Text style={styles.registerButtonText}>Não tem conta? Cadastre-se</Text>
                </TouchableOpacity>
            </View>
        </View>
    );
};

const styles = StyleSheet.create({
    container: {
        flex: 1,
        paddingHorizontal: spacing.lg,
        paddingTop: spacing.lg,
        paddingBottom: spacing.md,
        justifyContent: 'flex-start'
    },
    header: {
        marginTop: spacing.xs,
        marginBottom: spacing.md
    },
    title: {
        marginBottom: spacing.xs,
        color: color.textPrimary,
        fontSize: 20,
        lineHeight: 26,
        fontFamily: fonts.SemiBold,
        textAlign: 'center'
    },
    subtitle: {
        marginBottom: 0,
        color: color.textSecondary,
        fontSize: 14,
        lineHeight: 20,
        fontFamily: fonts.Regular,
        textAlign: 'center'
    },
    contentCard: {
        paddingHorizontal: 2,
        marginTop: spacing.md,
        marginBottom: spacing.lg
    },
    passwordInlineContainer: {
        marginTop: spacing.sm
    },
    passwordInputContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: 'rgba(255,255,255,0.84)',
        borderWidth: 1,
        borderColor: 'rgba(255,255,255,0.92)',
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
        backgroundColor: 'rgba(255,255,255,0.84)',
        borderWidth: 1,
        borderColor: 'rgba(255,255,255,0.92)',
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
        backgroundColor: 'rgba(255,255,255,0.84)',
        borderWidth: 1,
        borderColor: 'rgba(255,255,255,0.92)',
        borderRadius: radius.pill,
        paddingRight: spacing.sm,
        minHeight: 58,
        shadowColor: '#0E1522',
        shadowOffset: { width: 0, height: 12 },
        shadowOpacity: 0.12,
        shadowRadius: 20,
        elevation: 8
    },
    countrySelector: {
        paddingHorizontal: spacing.sm,
        justifyContent: 'center',
        borderRightWidth: 1,
        borderRightColor: 'rgba(15,23,34,0.08)',
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
        marginTop: spacing.md
    },
    continueButton: {
        marginBottom: spacing.xs
    },
    registerButton: {
        marginTop: 4,
        alignSelf: 'center',
        paddingHorizontal: spacing.sm,
        paddingVertical: spacing.xs
    },
    registerButtonText: {
        color: color.textSecondary,
        fontSize: 13,
        lineHeight: 18,
        fontFamily: fonts.SemiBold
    }
});

export default PhoneInputStep;
