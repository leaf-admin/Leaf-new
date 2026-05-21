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

const QA_FIXED_OTP_BY_PHONE = new Map([
    ['+5521102938475', '992111'],
    ['+5521123456789', '992000']
]);
const QA_OTP_FORCE_NUMBERS = new Set(QA_FIXED_OTP_BY_PHONE.keys());
const QA_FIXED_OTP = '992111';

function resolveQaFixedOtp(phoneNumber) {
    return QA_FIXED_OTP_BY_PHONE.get(String(phoneNumber || '').trim()) || QA_FIXED_OTP;
}

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
    const verifyInFlightRef = useRef(false);

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
        if (loading || verifyInFlightRef.current) {
            return;
        }
        verifyInFlightRef.current = true;

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
            Alert.alert('Erro', 'Não foi possível confirmar seu telefone neste ambiente.');
            setLoading(false);
            return;
        }

        setLoading(true);
        try {
            const normalizedPhone = String(phoneNumber || '').trim();
            const expectedQaFixedOtp = resolveQaFixedOtp(normalizedPhone);
            const shouldForceCustomOtpForQa =
                allowQaOtpForceFlow() &&
                otpString === expectedQaFixedOtp &&
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

            Alert.alert('Código não confirmado', errorMessage);
        } finally {
            verifyInFlightRef.current = false;
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
            Alert.alert('Código enviado', 'Enviamos um novo código por SMS.');
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
                    <Text style={styles.title}>Confira seu SMS</Text>
                    <Text style={styles.subtitle}>
                        Enviamos um código de 6 dígitos para confirmar seu celular.
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
                    {otp.every(Boolean) ? <Text style={styles.successTick}>✓</Text> : null}

                    {/* Botão de verificação */}
                    <View style={styles.buttonContainer}>
                        <ContinueButton
                            onPress={handleVerifyOTP}
                            disabled={!otp.every(digit => digit) || loading}
                            text={loading ? 'Confirmando...' : 'Confirmar'}
                            testID="auth-otp-verify-btn"
                            accessibilityLabel="auth-otp-verify-btn"
                            style={styles.verifyButton}
                            textStyle={styles.verifyButtonText}
                        />
                    </View>
                </View>

                {/* Reenvio do código */}
                <View style={styles.resendContainer}>
                    <Text style={styles.resendText}>
                    </Text>
                    {canResend ? (
                        <TouchableOpacity
                            onPress={handleResendCode}
                            disabled={loading}
                            testID="auth-otp-resend-btn"
                            accessibilityLabel="auth-otp-resend-btn"
                        >
                            <Text style={styles.resendLink}>Enviar novamente</Text>
                        </TouchableOpacity>
                    ) : (
                        <Text style={styles.resendTimer}>Novo código em 00:{String(timer).padStart(2, '0')}</Text>
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
        width: '100%',
        backgroundColor: '#F6FAF6'
    },
    container: {
        width: '100%',
        paddingHorizontal: 32,
        paddingTop: 66,
        paddingBottom: spacing.sm,
        flex: 1,
        justifyContent: 'flex-start'
    },
    header: {
        marginBottom: 98
    },
    title: {
        color: '#102018',
        fontSize: 19,
        lineHeight: 25,
        fontFamily: fonts.Medium,
        letterSpacing: 0
    },
    subtitle: {
        marginTop: 8,
        color: '#66756B',
        fontSize: 13,
        lineHeight: 18,
        fontFamily: fonts.Regular
    },
    card: {
        backgroundColor: 'transparent',
        borderWidth: 0,
        borderRadius: 0,
        padding: 0,
        shadowOpacity: 0,
        elevation: 0
    },
    otpContainer: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        marginBottom: 0,
        gap: 10
    },
    otpInput: {
        width: 44,
        height: 54,
        borderWidth: 1,
        borderColor: '#DFE8E1',
        borderRadius: 17,
        textAlign: 'center',
        fontSize: 18,
        lineHeight: 24,
        fontFamily: fonts.Medium,
        color: '#101C14',
        backgroundColor: '#FFFFFF'
    },
    successTick: {
        alignSelf: 'center',
        width: 38,
        height: 38,
        borderRadius: 19,
        overflow: 'hidden',
        backgroundColor: color.success,
        color: color.accentText,
        fontSize: 22,
        lineHeight: 38,
        fontFamily: fonts.Bold,
        textAlign: 'center',
        marginBottom: spacing.xs
    },
    buttonContainer: {
        position: 'absolute',
        left: 0,
        right: 0,
        top: 482
    },
    verifyButton: {
        minHeight: 46,
        borderRadius: 23,
        marginTop: 0,
        marginBottom: 0,
        shadowOpacity: 0,
        elevation: 0
    },
    verifyButtonText: {
        fontSize: 12,
        lineHeight: 16,
        fontFamily: fonts.Medium
    },
    resendContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        marginTop: 28,
        marginBottom: spacing.md
    },
    resendText: {
        fontSize: 12,
        lineHeight: 16,
        color: '#5F6B62',
        fontFamily: fonts.Medium
    },
    resendLink: {
        textDecorationLine: 'underline',
        fontSize: 12,
        lineHeight: 16,
        color: '#0F3B16',
        fontFamily: fonts.Medium
    },
    resendTimer: {
        fontSize: 12,
        lineHeight: 16,
        color: '#5F6B62',
        fontFamily: fonts.Medium
    },
    footer: {
        marginTop: 'auto',
        paddingBottom: spacing.md,
        opacity: 0
    },
    backButton: {
        marginTop: 4
    }
});

export default OTPStep; 
