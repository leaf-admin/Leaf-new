import Logger from '../../../utils/Logger';
/**
 * 🔑 TELA DE ESQUECI A SENHA
 * 
 * Permite resetar senha via OTP
 */

import React, { useState, useCallback, useRef, useEffect } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Alert, ActivityIndicator, KeyboardAvoidingView, Platform } from 'react-native';
import { fonts } from '../../../common-local/font';
import auth from '@react-native-firebase/auth';
import database from '@react-native-firebase/database';
import ContinueButton from '../common/ContinueButton';
import UserAuthService from '../../../services/UserAuthService';


const colors = {
    black: '#000000',
    grey80: '#333333',
    greyPlaceholder: '#BDBDBD',
    leafGreen: '#1A330E',
    white: '#FFFFFF',
    lightGrey: '#F5F5F5',
    error: '#FF3B30'
};

const ForgotPasswordStep = ({ phoneNumber, existingUser, onPasswordReset, onBack }) => {
    const [otp, setOtp] = useState(['', '', '', '', '', '']);
    const [newPassword, setNewPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [loading, setLoading] = useState(false);
    const [step, setStep] = useState(1); // 1 = OTP, 2 = Nova senha
    const [timer, setTimer] = useState(60);
    const [canResend, setCanResend] = useState(false);
    const [confirmation, setConfirmation] = useState(null);
    const [showPassword, setShowPassword] = useState(false);
    const [showConfirmPassword, setShowConfirmPassword] = useState(false);
    const inputRefs = useRef([]);

    // Timer para reenvio
    useEffect(() => {
        if (timer > 0 && step === 1) {
            const interval = setInterval(() => {
                setTimer(prev => prev - 1);
            }, 1000);
            return () => clearInterval(interval);
        } else if (timer === 0) {
            setCanResend(true);
        }
    }, [timer, step]);

    // Solicitar OTP ao montar
    useEffect(() => {
        if (step === 1 && !confirmation) {
            requestOTP();
        }
    }, [step]);

    const requestOTP = async () => {
        setLoading(true);
        try {
            const result = await UserAuthService.requestPasswordReset(phoneNumber);
            setConfirmation(result.confirmation);
            setTimer(60);
            setCanResend(false);
            Alert.alert('Sucesso', 'Código enviado para seu telefone!');
        } catch (error) {
            Logger.error('❌ Erro ao solicitar OTP:', error);
            if (error.message && error.message.includes('Muitas tentativas')) {
                Alert.alert('Limite de Tentativas', error.message);
            } else {
                Alert.alert('Erro', 'Não foi possível enviar o código. Tente novamente.');
            }
        } finally {
            setLoading(false);
        }
    };

    const handleOtpChange = useCallback(async (value, index) => {
        const newOtp = [...otp];
        newOtp[index] = value;
        setOtp(newOtp);

        // Auto-verificar quando completar 6 dígitos
        const otpString = newOtp.join('');
        if (otpString.length === 6) {
            setTimeout(() => {
                verifyOTP(otpString);
            }, 150);
        }

        // Mover para o próximo input
        if (value && index < 5) {
            inputRefs.current[index + 1]?.focus();
        }
    }, [otp]);

    const handleKeyPress = (e, index) => {
        if (e.nativeEvent.key === 'Backspace' && !otp[index] && index > 0) {
            inputRefs.current[index - 1]?.focus();
        }
    };

    const verifyOTP = async (otpString = null) => {
        const code = otpString || otp.join('');
        
        if (code.length !== 6) {
            return;
        }

        if (loading || !confirmation) {
            return;
        }

        setLoading(true);
        try {
            // Verificar OTP usando o método confirm do Firebase
            let credential;
            
            if (confirmation.confirm) {
                // Se tem método confirm (confirmação do Firebase)
                credential = await confirmation.confirm(code);
            } else if (confirmation.verificationId) {
                // Se tem verificationId, criar credencial manualmente
                const PhoneAuthProvider = auth().PhoneAuthProvider;
                credential = PhoneAuthProvider.credential(confirmation.verificationId, code);
                await auth().signInWithCredential(credential);
            } else {
                throw new Error('Confirmação inválida');
            }
            
            // OTP verificado - avançar para criar nova senha
            setStep(2);
            setOtp(['', '', '', '', '', '']);
        } catch (error) {
            Logger.error('❌ Erro ao verificar OTP:', error);
            Alert.alert('Erro', 'Código inválido. Verifique e tente novamente.');
            setOtp(['', '', '', '', '', '']);
            inputRefs.current[0]?.focus();
        } finally {
            setLoading(false);
        }
    };

    const handleResetPassword = async () => {
        if (!newPassword || newPassword.length < 8) {
            Alert.alert('Erro', 'A senha deve ter pelo menos 8 caracteres.');
            return;
        }

        if (newPassword !== confirmPassword) {
            Alert.alert('Erro', 'As senhas não coincidem.');
            return;
        }

        if (!/(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/.test(newPassword)) {
            Alert.alert('Erro', 'A senha deve conter letra maiúscula, minúscula e número.');
            return;
        }

        setLoading(true);
        try {
            // Resetar senha
            const currentUser = auth().currentUser;
            if (currentUser) {
                // Atualizar senha no Firebase Auth
                await currentUser.updatePassword(newPassword);
                
                // Marcar que tem senha no banco
                await database().ref(`users/${currentUser.uid}`).update({
                    hasPassword: true,
                    passwordUpdatedAt: new Date().toISOString()
                });
                
                // Registrar sucesso
                await UserAuthService.recordAttempt(phoneNumber, true);
                
                Alert.alert('Sucesso', 'Senha alterada com sucesso!');
                
                if (onPasswordReset) {
                    onPasswordReset({
                        uid: currentUser.uid,
                        phoneNumber: phoneNumber
                    });
                }
            } else {
                throw new Error('Usuário não autenticado');
            }
        } catch (error) {
            Logger.error('❌ Erro ao resetar senha:', error);
            await UserAuthService.recordAttempt(phoneNumber, false);
            Alert.alert('Erro', 'Não foi possível alterar a senha. Tente novamente.');
        } finally {
            setLoading(false);
        }
    };

    const handleResendOTP = async () => {
        if (!canResend) return;
        
        setCanResend(false);
        setTimer(60);
        setOtp(['', '', '', '', '', '']);
        await requestOTP();
    };

    // Renderizar step 1: OTP
    if (step === 1) {
        return (
            <KeyboardAvoidingView 
                style={styles.keyboardView}
                behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
            >
                <View style={styles.container}>
                    <Text style={styles.title}>Redefinir Senha</Text>
                    <Text style={styles.subtitle}>
                        Digite o código de 6 dígitos enviado para {phoneNumber}
                    </Text>

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

                    {/* Reenvio */}
                    <View style={styles.resendContainer}>
                        <Text style={styles.resendText}>
                            Não recebeu o código?{' '}
                        </Text>
                        {canResend ? (
                            <TouchableOpacity onPress={handleResendOTP} disabled={loading}>
                                <Text style={styles.resendLink}>Reenviar</Text>
                            </TouchableOpacity>
                        ) : (
                            <Text style={styles.timerText}>
                                Reenviar em {timer}s
                            </Text>
                        )}
                    </View>

                    {/* Botão voltar */}
                    <TouchableOpacity style={styles.backButton} onPress={onBack}>
                        <Text style={styles.backButtonText}>Voltar</Text>
                    </TouchableOpacity>
                </View>
            </KeyboardAvoidingView>
        );
    }

    // Renderizar step 2: Nova senha
    return (
        <KeyboardAvoidingView 
            style={styles.keyboardView}
            behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        >
            <View style={styles.container}>
                <Text style={styles.title}>Nova Senha</Text>
                <Text style={styles.subtitle}>
                    Digite sua nova senha
                </Text>

                {/* Campo nova senha */}
                <View style={styles.passwordContainer}>
                    <TextInput
                        style={styles.passwordInput}
                        value={newPassword}
                        onChangeText={setNewPassword}
                        placeholder="Nova senha"
                        placeholderTextColor={colors.greyPlaceholder}
                        secureTextEntry={!showPassword}
                        autoCapitalize="none"
                    />
                    <TouchableOpacity
                        style={styles.eyeButton}
                        onPress={() => setShowPassword(!showPassword)}
                    >
                        <Text style={styles.eyeButtonText}>
                            {showPassword ? '👁️' : '👁️‍🗨️'}
                        </Text>
                    </TouchableOpacity>
                </View>

                {/* Campo confirmar senha */}
                <View style={styles.passwordContainer}>
                    <TextInput
                        style={styles.passwordInput}
                        value={confirmPassword}
                        onChangeText={setConfirmPassword}
                        placeholder="Confirmar senha"
                        placeholderTextColor={colors.greyPlaceholder}
                        secureTextEntry={!showConfirmPassword}
                        autoCapitalize="none"
                    />
                    <TouchableOpacity
                        style={styles.eyeButton}
                        onPress={() => setShowConfirmPassword(!showConfirmPassword)}
                    >
                        <Text style={styles.eyeButtonText}>
                            {showConfirmPassword ? '👁️' : '👁️‍🗨️'}
                        </Text>
                    </TouchableOpacity>
                </View>

                {/* Requisitos da senha */}
                <View style={styles.requirementsContainer}>
                    <Text style={styles.requirementText}>
                        • Pelo menos 8 caracteres
                    </Text>
                    <Text style={styles.requirementText}>
                        • Uma letra minúscula
                    </Text>
                    <Text style={styles.requirementText}>
                        • Uma letra maiúscula
                    </Text>
                    <Text style={styles.requirementText}>
                        • Um número
                    </Text>
                </View>

                {/* Botão confirmar */}
                <ContinueButton
                    onPress={handleResetPassword}
                    disabled={!newPassword || !confirmPassword || loading}
                    text={loading ? 'Alterando...' : 'Confirmar'}
                />

                {/* Botão voltar */}
                <TouchableOpacity style={styles.backButton} onPress={() => setStep(1)}>
                    <Text style={styles.backButtonText}>Voltar</Text>
                </TouchableOpacity>
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
        paddingVertical: 20,
    },
    title: {
        fontSize: 24,
        color: colors.black,
        fontFamily: fonts.Bold,
        textAlign: 'left',
        marginBottom: 8,
    },
    subtitle: {
        fontSize: 17,
        color: colors.grey80,
        fontFamily: fonts.Medium,
        marginBottom: 32,
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
    resendContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        marginBottom: 24,
    },
    resendText: {
        fontSize: 17,
        color: colors.grey80,
        fontFamily: fonts.Medium,
    },
    resendLink: {
        color: colors.leafGreen,
        textDecorationLine: 'underline',
        fontFamily: fonts.Medium,
        fontSize: 17,
    },
    timerText: {
        color: colors.greyPlaceholder,
        fontFamily: fonts.Medium,
        fontSize: 17,
    },
    passwordContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        borderWidth: 2,
        borderColor: colors.lightGrey,
        borderRadius: 8,
        backgroundColor: colors.white,
        marginBottom: 16,
    },
    passwordInput: {
        flex: 1,
        paddingHorizontal: 16,
        paddingVertical: 16,
        fontSize: 17,
        fontFamily: fonts.Medium,
        color: colors.black,
    },
    eyeButton: {
        paddingHorizontal: 16,
        paddingVertical: 16,
    },
    eyeButtonText: {
        fontSize: 20,
    },
    requirementsContainer: {
        marginTop: 8,
        marginBottom: 24,
        padding: 12,
        backgroundColor: colors.lightGrey,
        borderRadius: 8,
    },
    requirementText: {
        fontSize: 14,
        color: colors.greyPlaceholder,
        fontFamily: fonts.Regular,
        marginBottom: 4,
    },
    backButton: {
        alignItems: 'center',
        paddingVertical: 12,
        marginTop: 8,
    },
    backButtonText: {
        color: colors.leafGreen,
        fontSize: 17,
        fontFamily: fonts.Medium,
        textDecorationLine: 'underline',
    },
});

export default ForgotPasswordStep;

