import leafTypography from '../../prototype/LeafTypography';
import Logger from '../../../utils/Logger';
import React, { useState, useRef, useEffect, useCallback } from 'react';
import { View, TextInput, TouchableOpacity, StyleSheet, Alert as NativeAlert, Text, Platform } from 'react-native';
import auth from '@react-native-firebase/auth';
import ContinueButton from '../common/ContinueButton';
import EditorialOnboardingScreen from '../common/EditorialOnboardingLayout';
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

const normalizePhoneDigits = value => String(value || '').replace(/\D/g, '');

export function assertVerifiedOtpIdentity({ requestedPhone, credentialUser, currentUser }) {
    const verifiedUid = String(credentialUser?.uid || '').trim();
    const currentUid = String(currentUser?.uid || '').trim();
    if (!verifiedUid || !currentUid || verifiedUid !== currentUid) {
        const error = new Error('A sessão autenticada não corresponde ao telefone confirmado.');
        error.code = 'OTP_AUTH_UID_MISMATCH';
        throw error;
    }

    const requestedDigits = normalizePhoneDigits(requestedPhone);
    const verifiedPhoneDigits = normalizePhoneDigits(
        credentialUser?.phoneNumber || currentUser?.phoneNumber,
    );
    if (!requestedDigits || !verifiedPhoneDigits || requestedDigits !== verifiedPhoneDigits) {
        const error = new Error('O telefone autenticado não corresponde ao número informado.');
        error.code = 'OTP_AUTH_PHONE_MISMATCH';
        throw error;
    }

    return credentialUser;
}

const { color, spacing } = onboardingTheme;

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

const OTPStep = ({ phoneNumber, confirmation, onVerified, onBack, progressMeta }) => {
    const [otp, setOtp] = useState(['', '', '', '', '', '']);
    const [loading, setLoading] = useState(false);
    const [timer, setTimer] = useState(30);
    const [canResend, setCanResend] = useState(false);
    const [currentConfirmation, setCurrentConfirmation] = useState(confirmation);
    const inputRefs = useRef([]);
    const verifyInFlightRef = useRef(false);
    const otpChannelLabel = currentConfirmation?.isCustomOtp
        ? (currentConfirmation?.channel === 'sms' ? 'SMS' : 'WhatsApp')
        : 'SMS';

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
                        const verifiedUser = assertVerifiedOtpIdentity({
                            requestedPhone: normalizedPhone,
                            credentialUser: userCredential.user,
                            currentUser: auth().currentUser,
                        });
                        onVerified(verifiedUser);
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
                            const verifiedUser = assertVerifiedOtpIdentity({
                                requestedPhone: phoneNumber,
                                credentialUser: userCredential.user,
                                currentUser: auth().currentUser,
                            });
                            onVerified(verifiedUser);
                        }
                    } else {
                        throw new Error(response.data?.error || 'Código inválido.');
                    }
                } else {
                    // Fallback para o FirebaseAuth antigo caso algum flow o invoque
                    const credential = await currentConfirmation.confirm(otpString);
                    if (credential.user) {
                        // OTP verificado com sucesso
                        const verifiedUser = assertVerifiedOtpIdentity({
                            requestedPhone: phoneNumber,
                            credentialUser: credential.user,
                            currentUser: auth().currentUser,
                        });
                        onVerified(verifiedUser);
                    }
                }
            }
        } catch (error) {
            Logger.error('Erro na verificação do OTP:', error);

            // ✅ Mensagens de erro específicas e humanas
            let errorMessage = 'Código inválido. Verifique e tente novamente.';

            if (error.message) {
                if (error.message.includes('invalid') || error.message.includes('inválido')) {
                    errorMessage = `Código inválido. Verifique o código recebido pelo ${otpChannelLabel} e tente novamente.`;
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
    }, [otp, currentConfirmation, onVerified, loading, verifyOtpWithFallback, phoneNumber, otpChannelLabel]);

    // Função para lidar com mudança de input
    const handleOtpChange = useCallback((value, index) => {
        const digits = String(value || '').replace(/\D/g, '');
        const newOtp = [...otp];

        if (digits.length > 1) {
            // Autofill/paste delivers the complete OTP to the focused input.
            for (let currentIndex = index; currentIndex < newOtp.length; currentIndex += 1) {
                newOtp[currentIndex] = '';
            }

            digits.slice(0, newOtp.length - index).split('').forEach((digit, offset) => {
                newOtp[index + offset] = digit;
            });
        } else {
            newOtp[index] = digits;
        }

        setOtp(newOtp);

        if (newOtp.every(Boolean)) {
            const otpString = newOtp.join('');
            // ✅ AUTO-VERIFICAR quando completar 6 dígitos
            // Pequeno delay para garantir que o estado foi atualizado
            setTimeout(() => {
                if (!loading) {
                    handleVerifyOTP(otpString);
                }
            }, 150);
        }

        // Mover para o próximo input
        if (digits.length > 1 && !newOtp.every(Boolean)) {
            const nextEmptyIndex = newOtp.findIndex((digit, currentIndex) => currentIndex >= index && !digit);
            if (nextEmptyIndex >= 0) {
                inputRefs.current[nextEmptyIndex]?.focus();
            }
        } else if (digits && digits.length === 1 && index < 5) {
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
                        isCustomOtp: true,
                        channel: response.data.channel || 'whatsapp',
                        expiresIn: response.data.expiresIn || 300
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
            Alert.alert('Código enviado', `Enviamos um novo código pelo ${otpChannelLabel}.`);
        } catch (error) {
            Logger.error('Erro ao reenviar código:', error);
            Alert.alert('Erro', 'Não foi possível reenviar o código. Tente novamente.');
        } finally {
            setLoading(false);
        }
    };

    return (
        <EditorialOnboardingScreen
            keyboard
            headerTitle="Seu acesso"
            leadObject="privacy"
            title="Código de acesso"
            description={`Digite os 6 números recebidos por ${otpChannelLabel}.`}
            onBack={onBack}
            backTestID="auth-otp-back-btn"
            backAccessibilityLabel="Voltar"
            progressMeta={progressMeta}
            childrenStyle={styles.childrenWrap}
            footer={(
                <View>
                <ContinueButton
                    onPress={() => handleVerifyOTP()}
                    disabled={!otp.every(digit => digit) || loading}
                    text={loading ? 'Confirmando...' : 'Confirmar'}
                    testID="auth-otp-verify-btn"
                    accessibilityLabel={loading ? 'Confirmando código' : 'Confirmar código'}
                />
                <View style={styles.resendContainer}>
                    {canResend ? (
                        <TouchableOpacity
                            onPress={handleResendCode}
                            disabled={loading}
                            style={styles.footerLink}
                            testID="auth-otp-resend-btn"
                            accessibilityRole="button"
                            accessibilityState={{ disabled: loading }}
                            accessibilityLabel={`Reenviar código pelo ${otpChannelLabel}`}
                            accessibilityHint="Solicita um novo código de verificação."
                        >
                            <Text style={styles.resendLink}>Reenviar código</Text>
                        </TouchableOpacity>
                    ) : (
                        <Text style={styles.resendTimer}>Novo código em 00:{String(timer).padStart(2, '0')}</Text>
                    )}
                    <TouchableOpacity onPress={onBack} disabled={loading} style={styles.footerLink}
                        accessibilityRole="button" accessibilityLabel="Alterar número" testID="auth-otp-change-number-btn">
                        <Text style={styles.resendLink}>Alterar número</Text>
                    </TouchableOpacity>
                </View>
                </View>
            )}
        >
            <View style={styles.delivery}>
                <Text style={styles.deliveryLabel}>Enviado para</Text>
                <Text style={styles.deliveryPhone}>{String(phoneNumber || '').replace(/\D/g, '').length >= 6
                    ? `+${String(phoneNumber).replace(/\D/g, '').slice(0, 2)} (${String(phoneNumber).replace(/\D/g, '').slice(2, 4)}) •••••-${String(phoneNumber).replace(/\D/g, '').slice(-4)}` : 'Seu celular'}</Text>
            </View>
            <View style={styles.otpContainer}>
                {otp.map((digit, index) => (
                    <TextInput
                        key={index}
                        ref={ref => inputRefs.current[index] = ref}
                        style={styles.otpInput}
                        value={digit}
                        placeholder="·"
                        placeholderTextColor="#AAAAAA"
                        selectionColor="#222222"
                        onChangeText={(value) => handleOtpChange(value, index)}
                        onKeyPress={(e) => handleKeyPress(e, index)}
                        keyboardType="number-pad"
                        maxLength={6}
                        selectTextOnFocus
                        autoFocus={index === 0}
                        autoComplete={index === 0
                            ? Platform.select({ ios: 'one-time-code', android: 'sms-otp' })
                            : 'off'}
                        importantForAutofill={index === 0 ? 'yes' : 'no'}
                        testID={`auth-otp-digit-${index}`}
                        accessibilityLabel={`Dígito ${index + 1} de 6`}
                        accessibilityHint={`Campo ${index + 1} de 6. Digite um número do código enviado pelo ${otpChannelLabel}.`}
                    />
                ))}
            </View>
            <Text style={styles.deliveryHelp}>{otp.every(Boolean) ? 'Código preenchido.' : 'Não recebeu? Você pode reenviar ou corrigir o número abaixo.'}</Text>
        </EditorialOnboardingScreen>
    );
};

const styles = StyleSheet.create({
    childrenWrap: {
        marginTop: 24
    },
    delivery: { gap: 6, marginBottom: 20 },
    deliveryLabel: { ...leafTypography.regular, fontSize: 13, lineHeight: 18, color: color.textSecondary },
    deliveryPhone: { ...leafTypography.semiBold, fontSize: 16, lineHeight: 22, color: color.textPrimary },
    keyboardView: {
        flex: 1,
        width: '100%',
        backgroundColor: color.background
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
        fontSize: 22,
        lineHeight: 28,
        ...leafTypography.medium,
        letterSpacing: 0
    },
    subtitle: {
        marginTop: 8,
        color: '#66756B',
        fontSize: 14,
        lineHeight: 20,
        ...leafTypography.regular
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
        gap: 8
    },
    otpInput: {
        flex: 1,
        minWidth: 0,
        height: 64,
        borderWidth: 1,
        borderColor: color.border,
        borderRadius: 12,
        textAlign: 'center',
        fontSize: 28,
        lineHeight: 34,
        ...leafTypography.semiBold,
        color: color.textPrimary,
        backgroundColor: '#F5F5F5'
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
        ...leafTypography.bold,
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
        ...leafTypography.medium
    },
    resendContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 16,
        flexWrap: 'wrap',
        marginTop: 12,
        minHeight: 44
    },
    footerLink: { minHeight: 44, justifyContent: 'center' },
    deliveryHelp: { marginTop: 20, fontSize: 13, lineHeight: 19, color: color.textSecondary, ...leafTypography.regular },
    resendText: {
        fontSize: 12,
        lineHeight: 16,
        color: '#5F6B62',
        ...leafTypography.medium
    },
    resendLink: {
        textDecorationLine: 'underline',
        fontSize: 14,
        lineHeight: 20,
        color: color.accent,
        ...leafTypography.semiBold
    },
    resendTimer: {
        fontSize: 12,
        lineHeight: 16,
        color: color.textSecondary,
        ...leafTypography.medium
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
