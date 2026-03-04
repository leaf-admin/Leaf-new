import Logger from '../../../utils/Logger';
import React, { useState, useRef, useEffect, useCallback } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Alert, ActivityIndicator, KeyboardAvoidingView, Platform } from 'react-native';
import Constants from 'expo-constants';
import { fonts } from '../../../common-local/font';
import auth from '@react-native-firebase/auth';
import { saveStepData } from '../../../utils/secureOnboardingStorage';
import ContinueButton from '../common/ContinueButton';
import { Typography } from '../../design-system/Typography';
import { AnimatedButton } from '../../design-system/AnimatedButton';

// ✅ CRÍTICO: Flag de ambiente de review (App Store compliance)
const IS_REVIEW_ENV = Constants.expoConfig?.extra?.isReview === true;

// Cores baseadas no design
const colors = {
    black: '#1C1C1E',
    grey80: '#333333',
    greyPlaceholder: '#BDBDBD',
    leafGreen: '#1A330E',
    white: '#FFFFFF',
    lightGrey: '#F9F9F9',
    error: '#FF3B30'
};

const OTPStep = ({ phoneNumber, confirmation, onVerified, onBack }) => {
    const [otp, setOtp] = useState(['', '', '', '', '', '']);
    const [loading, setLoading] = useState(false);
    const [timer, setTimer] = useState(30);
    const [canResend, setCanResend] = useState(false);
    const inputRefs = useRef([]);

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
        if (!IS_REVIEW_ENV && !__DEV__) {
            // Em produção: OTP sempre obrigatório, nunca permitir bypass
            Logger.log('🔐 Ambiente de produção: OTP obrigatório');
            // Se chegou aqui, é porque não houve bypass (correto para produção)
        }

        // ✅ Validação adicional: Bloquear tentativas de bypass em produção
        if (confirmation?.isReviewAccount && !IS_REVIEW_ENV && !__DEV__) {
            Logger.error('🚫 Tentativa de bypass bloqueada em produção');
            Alert.alert('Erro', 'Bypass de OTP não permitido em produção');
            setLoading(false);
            return;
        }

        setLoading(true);
        try {
            // 🚀 VERIFICAR SE É NÚMERO DE TESTE COM CÓDIGO FIXO
            if (confirmation && confirmation.isTestNumber) {
                Logger.log('🧪 Verificando código de teste:', otpString);
                Logger.log('🔑 Código esperado:', confirmation.expectedOtp || '000000');

                // Aceitar código fixo para números de teste
                const expectedCode = confirmation.expectedOtp || '000000';
                if (otpString === expectedCode) {
                    Logger.log('✅ Código de teste aceito!');
                    const credential = await confirmation.confirm(otpString);
                    if (credential && credential.user) {
                        onVerified(credential.user);
                    }
                } else {
                    throw new Error('Código inválido. Para números de teste, use: ' + expectedCode);
                }
            } else {
                // Fluxo normal com Firebase ou Custom API
                if (confirmation && confirmation.isCustomOtp) {
                    const { api } = require('../../../common-local/api');
                    const response = await api.post('/custom-otp/verify-otp', {
                        phone: phoneNumber,
                        verificationId: confirmation.verificationId,
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
                    const credential = await confirmation.confirm(otpString);
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
    }, [otp, confirmation, onVerified, loading]);

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
            if (confirmation && confirmation.isCustomOtp) {
                const { api } = require('../../../common-local/api');
                const response = await api.post('/custom-otp/request-otp', { phone: phoneNumber });
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

            // Atualizar a confirmação no componente pai
            if (onVerified) {
                onVerified({ confirmation: newConfirmation });
            }
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
                    <Typography variant="h1" align="left" style={styles.title}>Verificação</Typography>
                    <Typography variant="body" color={colors.grey80} align="left" style={styles.subtitle}>
                        Digite o código de 6 dígitos enviado para {phoneNumber}
                    </Typography>
                </View>

                {/* Inputs do OTP */}
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
                        />
                    ))}
                </View>

                {/* Botão de verificação */}
                <View style={styles.buttonContainer}>
                    <ContinueButton
                        onPress={handleVerifyOTP}
                        disabled={!otp.every(digit => digit) || loading}
                        text={loading ? 'Verificando...' : 'Verificar'}
                    />
                </View>

                {/* Reenvio do código */}
                <View style={styles.resendContainer}>
                    <Typography variant="bodyMedium" color={colors.grey80}>
                        Não recebeu o código?{' '}
                    </Typography>
                    {canResend ? (
                        <TouchableOpacity onPress={handleResendCode} disabled={loading}>
                            <Typography variant="bodyMedium" color={colors.leafGreen} style={styles.resendLink}>
                                Reenviar
                            </Typography>
                        </TouchableOpacity>
                    ) : (
                        <Typography variant="bodyMedium" color={colors.greyPlaceholder}>
                            Reenviar em {timer}s
                        </Typography>
                    )}
                </View>

                <View style={styles.footer}>
                    {/* Botão voltar */}
                    <AnimatedButton
                        variant="ghost"
                        title="Voltar"
                        onPress={onBack}
                        style={styles.backButton}
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
    },
    container: {
        width: '100%',
        paddingVertical: 24,
        flex: 1,
        justifyContent: 'space-between',
    },
    header: {
        marginBottom: 32,
    },
    title: {
        marginBottom: 8,
    },
    subtitle: {
        lineHeight: 22,
    },
    otpContainer: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        marginBottom: 24,
        gap: 8,
    },
    otpInput: {
        flex: 1,
        maxWidth: 42,
        height: 48,
        borderWidth: 2,
        borderColor: colors.lightGrey,
        borderRadius: 8,
        textAlign: 'center',
        fontSize: 18,
        fontFamily: fonts.Bold,
        color: colors.black,
        backgroundColor: colors.white,
    },
    buttonContainer: {
        marginBottom: 24,
    },
    resendContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        marginBottom: 24,
    },
    resendLink: {
        textDecorationLine: 'underline',
    },
    footer: {
        marginTop: 'auto',
    },
    backButton: {
        marginTop: 4,
    }
});

export default OTPStep; 