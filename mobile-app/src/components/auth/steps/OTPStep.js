import Logger from '../../../utils/Logger';
import React, { useState, useRef, useEffect, useCallback } from 'react';
import { View, TextInput, TouchableOpacity, StyleSheet, Alert as NativeAlert, KeyboardAvoidingView, Platform, Text } from 'react-native';
import { fonts } from '../../../theme/runtimeTokens';
import auth from '@react-native-firebase/auth';
import { saveStepData } from '../../../utils/secureOnboardingStorage';
import ContinueButton from '../common/ContinueButton';
import { AnimatedButton } from '../../design-system/AnimatedButton';
import {
    allowQaOtpForceFlow,
    allowReviewAccess,
    isDevelopmentBuild
} from '../../../config/runtimeAccessPolicy';
import apiClient from '../../../services/httpClient';
import onboardingTheme from '../common/onboardingTheme';
import { toUserFriendlyMessage } from '../../../utils/friendlyErrorMessages';

const QA_OTP_FORCE_NUMBERS = new Set(['+5511999999999', '+5511888888888']);
const QA_FIXED_OTP = '0'.repeat(6);

const { color, radius, spacing, elevation } = onboardingTheme;

const Alert = {
    ...NativeAlert,
    alert: (title, message, buttons, options) =>
        NativeAlert.alert(
            title || 'Atencao',
            toUserFriendlyMessage(message, {
                context: 'auth',
                fallbackMessage: 'Nao foi possivel validar o codigo agora. Tente novamente.'
            }),
            buttons,
            options
        )
};

const OTPStep = ({ phoneNumber, confirmation, onVerified, onBack }) => {
    const [otp, setOtp] = useState(['', '', '', '', '', '']);
    const [loading, setLoading] = useState(false);
    const [timer, setTimer] = useState(30);
    const [canResend, setCanResend] = useState(false);
    const [currentConfirmation, setCurrentConfirmation] = useState(confirmation);
    const inputRefs = useRef([]);

    useEffect(() => {
        setCurrentConfirmation(confirmation);
    }, [confirmation]);

    const requestOtpWithFallback = useCallback(async (phone) => {
        const endpoints = [
            '/api/custom-otp/request-otp',
            '/custom-otp/request-otp'
        ];

        let lastError = null;
        for (const endpoint of endpoints) {
            try {
                return await apiClient.post(endpoint, { phone });
            } catch (error) {
                lastError = error;
                if (error?.response?.status !== 404) {
                    throw error;
                }
            }
        }

        throw lastError || new Error('Falha ao enviar OTP');
    }, []);

    const verifyOtpWithFallback = useCallback(async ({ phone, verificationId, otp }) => {
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
    }, []);

    useEffect(() => {
        // Timer para reenvio do código
        if (timer > 0) {
            const interval = setInterval(() => {
                setTimer(prev => prev - 1);
            }, 1000);
            return () => clearInterval(interval);
        } else {
            setCanResend(true);
        }
    }, [timer]);

    // Função para verificar o OTP
    const handleVerifyOTP = useCallback(async (otpToVerify = null) => {
        const otpString = otpToVerify || otp.join('');

        if (otpString.length !== 6) {
            return;
        }

        // Evitar múltiplas verificações simultâneas
        if (loading) {
            return;
        }

        // ✅ CRÍTICO: Guard para ambiente de produção - OTP sempre obrigatório
        // Apenas em ambiente de review (APP_REVIEW=true) o OTP pode ser pulado
        // Nota: O bypass real é tratado em AuthFlow.js antes de chegar aqui
        if (!allowReviewAccess() && !isDevelopmentBuild()) {
            // Em produção: OTP sempre obrigatório, nunca permitir bypass
            Logger.log('🔐 Ambiente de produção: OTP obrigatório');
            // Se chegou aqui, é porque não houve bypass (correto para produção)
        }

        // ✅ Validação adicional: Bloquear tentativas de bypass em produção
        if (currentConfirmation?.isReviewAccount && !allowReviewAccess()) {
            Logger.error('🚫 Tentativa de bypass bloqueada em produção');
            Alert.alert('Erro', 'Bypass de OTP não permitido em produção');
            setLoading(false);
            return;
        }

        setLoading(true);
        try {
            const normalizedPhone = String(phoneNumber || '').trim();
            const shouldForceCustomOtpForQa =
                allowQaOtpForceFlow() &&
                otpString === QA_FIXED_OTP &&
                QA_OTP_FORCE_NUMBERS.has(normalizedPhone) &&
                !(currentConfirmation && currentConfirmation.isCustomOtp);

            if (shouldForceCustomOtpForQa) {
                const requestResponse = await requestOtpWithFallback(normalizedPhone);
                if (!requestResponse?.data?.success || !requestResponse?.data?.verificationId) {
                    throw new Error(requestResponse?.data?.error || 'Falha ao preparar OTP para conta QA.');
                }

                const verificationResponse = await verifyOtpWithFallback({
                    phone: normalizedPhone,
                    verificationId: requestResponse.data.verificationId,
                    otp: otpString
                });

                if (verificationResponse?.data?.success && verificationResponse?.data?.customToken) {
                    const userCredential = await auth().signInWithCustomToken(verificationResponse.data.customToken);
                    if (userCredential?.user) {
                        onVerified(userCredential.user);
                        return;
                    }
                }

                throw new Error(verificationResponse?.data?.error || 'Código inválido para conta QA.');
            }

            // 🚀 VERIFICAR SE É NÚMERO DE TESTE COM CÓDIGO FIXO
            if (currentConfirmation && currentConfirmation.isTestNumber) {
                if (!allowQaOtpForceFlow() && !allowReviewAccess()) {
                    Logger.error('🚫 OTP de número de teste bloqueado fora de QA/review');
                    throw new Error('Código de teste não permitido neste ambiente.');
                }

                Logger.log('🧪 Verificando código de teste:', otpString);

                // Aceitar código fixo para números de teste
                const expectedCode = currentConfirmation.expectedOtp || QA_FIXED_OTP;
                if (otpString === expectedCode) {
                    Logger.log('✅ Código de teste aceito!');
                    const credential = await currentConfirmation.confirm(otpString);
                    if (credential && credential.user) {
                        onVerified(credential.user);
                    }
                } else {
                    throw new Error('Código inválido.');
                }
            } else {
                // Fluxo normal com Firebase ou Custom API
                if (currentConfirmation && currentConfirmation.isCustomOtp) {
                    const response = await verifyOtpWithFallback({
                        phone: phoneNumber,
                        verificationId: currentConfirmation.verificationId,
                        otp: otpString
                    });

                    if (response.data && response.data.success && response.data.customToken) {
                        const userCredential = await auth().signInWithCustomToken(response.data.customToken);
                        if (userCredential.user) {
                            onVerified(userCredential.user);
                        }
                    } else {
                        throw new Error(response.data?.error || 'Código inválido.');
                    }
                } else {
                    // Fallback para o FirebaseAuth antigo caso algum flow o invoque
                    const credential = await currentConfirmation.confirm(otpString);
                    if (credential.user) {
                        // OTP verificado com sucesso
                        onVerified(credential.user);
                    }
                }
            }
        } catch (error) {
            Logger.error('Erro na verificação do OTP:', error);

            // ✅ Mensagens de erro específicas e humanas
            let errorMessage = 'Código inválido. Verifique e tente novamente.';

            if (error.message) {
                if (error.message.includes('invalid') || error.message.includes('inválido')) {
                    errorMessage = 'Código inválido. Verifique o código recebido por SMS e tente novamente.';
                } else if (error.message.includes('expired') || error.message.includes('expirado')) {
                    errorMessage = 'Código expirado. Solicite um novo código.';
                } else if (
                    error.message.includes('already used') ||
                    error.message.includes('already been used') ||
                    error.message.includes('code used') ||
                    error.message.includes('reutilizado')
                ) {
                    errorMessage = 'Esse código já foi utilizado. Solicite um novo código.';
                } else if (error.message.includes('network') || error.message.includes('rede')) {
                    errorMessage = 'Erro de conexão. Verifique sua internet e tente novamente.';
                } else if (error.message.includes('timeout')) {
                    errorMessage = 'Tempo de espera esgotado. Tente novamente.';
                } else {
                    errorMessage = error.message;
                }
            }

            Alert.alert('Erro na Verificação', errorMessage);
        } finally {
            setLoading(false);
        }
    }, [otp, currentConfirmation, onVerified, loading, verifyOtpWithFallback, phoneNumber]);

    // Função para lidar com mudança de input
    const handleOtpChange = useCallback(async (value, index) => {
        const newOtp = [...otp];
        newOtp[index] = value;
        setOtp(newOtp);

        // Salvar automaticamente no AsyncStorage
        const otpString = newOtp.join('');
        if (otpString.length === 6) {
            await saveStepData('phone_validation', {
                phoneNumber: phoneNumber,
                otp: otpString
            });

            // ✅ AUTO-VERIFICAR quando completar 6 dígitos
            // Pequeno delay para garantir que o estado foi atualizado
            setTimeout(() => {
                if (!loading) {
                    handleVerifyOTP(otpString);
                }
            }, 150);
        }

        // Mover para o próximo input
        if (value && index < 5) {
            inputRefs.current[index + 1]?.focus();
        }
    }, [otp, phoneNumber, loading, handleVerifyOTP]);

    // Função para lidar com backspace
    const handleKeyPress = (e, index) => {
        if (e.nativeEvent.key === 'Backspace' && !otp[index] && index > 0) {
            inputRefs.current[index - 1]?.focus();
        }
    };

    // Função para reenviar o código
    const handleResendCode = async () => {
        if (!canResend) return;

        setLoading(true);
        try {
            let newConfirmation;
            if (currentConfirmation && currentConfirmation.isCustomOtp) {
                const response = await requestOtpWithFallback(phoneNumber);
                if (response.data && response.data.success) {
                    newConfirmation = {
                        verificationId: response.data.verificationId,
                        isCustomOtp: true
                    };
                } else {
                    throw new Error('Falha ao reenviar código.');
                }
            } else {
                newConfirmation = await auth().signInWithPhoneNumber(phoneNumber, true);
            }

            setCurrentConfirmation(newConfirmation);
            setTimer(30);
            setCanResend(false);
            setOtp(['', '', '', '', '', '']);
            Alert.alert('Sucesso', 'Novo código enviado!');
        } catch (error) {
            Logger.error('Erro ao reenviar código:', error);
            Alert.alert('Erro', 'Não foi possível reenviar o código. Tente novamente.');
        } finally {
            setLoading(false);
        }
    };

    return (
        <KeyboardAvoidingView
            style={styles.keyboardView}
            behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
            keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 20}
        >
            <View style={styles.container}>
                <View style={styles.header}>
                    <Text style={styles.title}>Verificação</Text>
                    <Text style={styles.subtitle}>
                        Digite o código de 6 dígitos enviado para {phoneNumber}
                    </Text>
                </View>

                {/* Inputs do OTP */}
                <View style={styles.card}>
                    <View style={styles.otpContainer}>
                        {otp.map((digit, index) => (
                            <TextInput
                                key={index}
                                ref={ref => inputRefs.current[index] = ref}
                                style={styles.otpInput}
                                value={digit}
                                onChangeText={(value) => handleOtpChange(value, index)}
                                onKeyPress={(e) => handleKeyPress(e, index)}
                                keyboardType="number-pad"
                                maxLength={1}
                                selectTextOnFocus
                                autoFocus={index === 0}
                                testID={`auth-otp-digit-${index}`}
                                accessibilityLabel={`auth-otp-digit-${index}`}
                            />
                        ))}
                    </View>

                    {/* Botão de verificação */}
                    <View style={styles.buttonContainer}>
                        <ContinueButton
                            onPress={handleVerifyOTP}
                            disabled={!otp.every(digit => digit) || loading}
                            text={loading ? 'Verificando...' : 'Verificar'}
                            testID="auth-otp-verify-btn"
                            accessibilityLabel="auth-otp-verify-btn"
                        />
                    </View>
                </View>

                {/* Reenvio do código */}
                <View style={styles.resendContainer}>
                    <Text style={styles.resendText}>
                        Não recebeu o código?{' '}
                    </Text>
                    {canResend ? (
                        <TouchableOpacity
                            onPress={handleResendCode}
                            disabled={loading}
                            testID="auth-otp-resend-btn"
                            accessibilityLabel="auth-otp-resend-btn"
                        >
                            <Text style={styles.resendLink}>Reenviar</Text>
                        </TouchableOpacity>
                    ) : (
                        <Text style={styles.resendTimer}>Reenviar em {timer}s</Text>
                    )}
                </View>

                <View style={styles.footer}>
                    {/* Botão voltar */}
                    <AnimatedButton
                        variant="ghost"
                        title="Voltar"
                        onPress={onBack}
                        style={styles.backButton}
                        testID="auth-otp-back-btn"
                        accessibilityLabel="auth-otp-back-btn"
                    />
                </View>
            </View>
        </KeyboardAvoidingView>
    );
};

const styles = StyleSheet.create({
    keyboardView: {
        flex: 1,
        width: '100%'
    },
    container: {
        width: '100%',
        paddingHorizontal: spacing.lg,
        paddingVertical: spacing.sm,
        flex: 1,
        justifyContent: 'flex-start'
    },
    header: {
        marginBottom: spacing.md
    },
    title: {
        marginBottom: spacing.xs,
        color: color.textPrimary,
        fontSize: 22,
        lineHeight: 28,
        fontFamily: fonts.Bold
    },
    subtitle: {
        color: color.textSecondary,
        fontSize: 14,
        lineHeight: 20,
        fontFamily: fonts.Regular
    },
    card: {
        backgroundColor: color.panelSoft,
        borderWidth: 1,
        borderColor: color.glassStroke,
        borderRadius: radius.lg,
        padding: spacing.sm,
        shadowColor: '#0E1522',
        shadowOffset: { width: 0, height: 12 },
        shadowOpacity: 0.16,
        shadowRadius: 20,
        elevation: 9
    },
    otpContainer: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        marginBottom: spacing.sm,
        gap: 6
    },
    otpInput: {
        flex: 1,
        maxWidth: 40,
        height: 44,
        borderWidth: 1,
        borderColor: color.borderStrong,
        borderRadius: radius.sm,
        textAlign: 'center',
        fontSize: 16,
        fontFamily: fonts.Bold,
        color: color.textPrimary,
        backgroundColor: color.surface
    },
    buttonContainer: {
        marginBottom: 0
    },
    resendContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        marginTop: spacing.md,
        marginBottom: spacing.md
    },
    resendText: {
        fontSize: 13,
        lineHeight: 18,
        color: color.textSecondary,
        fontFamily: fonts.Medium
    },
    resendLink: {
        textDecorationLine: 'underline',
        fontSize: 13,
        lineHeight: 18,
        color: color.accent,
        fontFamily: fonts.Medium
    },
    resendTimer: {
        fontSize: 13,
        lineHeight: 18,
        color: color.textMuted,
        fontFamily: fonts.Medium
    },
    footer: {
        marginTop: spacing.xs
    },
    backButton: {
        marginTop: 4
    }
});

export default OTPStep; 
