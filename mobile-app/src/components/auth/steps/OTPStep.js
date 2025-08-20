import React, { useState, useRef, useEffect } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Alert, ActivityIndicator } from 'react-native';
import { fonts } from '../../../common-local/font';
import auth from '@react-native-firebase/auth';

// Cores baseadas no design
const colors = {
    black: '#000000',
    grey80: '#333333',
    greyPlaceholder: '#BDBDBD',
    leafGreen: '#1A330E',
    white: '#FFFFFF',
    lightGrey: '#F5F5F5',
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

    // Função para lidar com mudança de input
    const handleOtpChange = (value, index) => {
        const newOtp = [...otp];
        newOtp[index] = value;
        setOtp(newOtp);

        // Mover para o próximo input
        if (value && index < 5) {
            inputRefs.current[index + 1]?.focus();
        }
    };

    // Função para lidar com backspace
    const handleKeyPress = (e, index) => {
        if (e.nativeEvent.key === 'Backspace' && !otp[index] && index > 0) {
            inputRefs.current[index - 1]?.focus();
        }
    };

    // Função para verificar o OTP
    const handleVerifyOTP = async () => {
        const otpString = otp.join('');
        
        if (otpString.length !== 6) {
            Alert.alert('Erro', 'Por favor, insira o código completo de 6 dígitos.');
            return;
        }

        setLoading(true);
        try {
            const credential = await confirmation.confirm(otpString);
            if (credential.user) {
                // OTP verificado com sucesso
                onVerified(credential.user);
            }
        } catch (error) {
            console.error('Erro na verificação do OTP:', error);
            Alert.alert('Erro', 'Código inválido. Verifique e tente novamente.');
        } finally {
            setLoading(false);
        }
    };

    // Função para reenviar o código
    const handleResendCode = async () => {
        if (!canResend) return;

        setLoading(true);
        try {
            const newConfirmation = await auth().signInWithPhoneNumber(phoneNumber, true);
            // Atualizar a confirmação no componente pai
            if (onVerified) {
                onVerified({ confirmation: newConfirmation });
            }
            setTimer(30);
            setCanResend(false);
            setOtp(['', '', '', '', '', '']);
            Alert.alert('Sucesso', 'Novo código enviado!');
        } catch (error) {
            console.error('Erro ao reenviar código:', error);
            Alert.alert('Erro', 'Não foi possível reenviar o código. Tente novamente.');
        } finally {
            setLoading(false);
        }
    };

    return (
        <View style={styles.container}>
            <Text style={styles.title}>Verificação</Text>
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

            {/* Botão de verificação */}
            <TouchableOpacity 
                style={[styles.button, (!otp.every(digit => digit) || loading) && styles.buttonDisabled]} 
                onPress={handleVerifyOTP}
                disabled={!otp.every(digit => digit) || loading}
            >
                {loading ? (
                    <ActivityIndicator color={colors.white} />
                ) : (
                    <Text style={styles.buttonText}>Verificar</Text>
                )}
            </TouchableOpacity>

            {/* Reenvio do código */}
            <View style={styles.resendContainer}>
                <Text style={styles.resendText}>
                    Não recebeu o código?{' '}
                </Text>
                {canResend ? (
                    <TouchableOpacity onPress={handleResendCode} disabled={loading}>
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
    );
};

const styles = StyleSheet.create({
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
        marginBottom: 32,
    },
    otpInput: {
        width: 45,
        height: 55,
        borderWidth: 2,
        borderColor: colors.lightGrey,
        borderRadius: 8,
        textAlign: 'center',
        fontSize: 20,
        fontFamily: fonts.Bold,
        color: colors.black,
        backgroundColor: colors.white,
    },
    button: {
        backgroundColor: colors.leafGreen,
        borderRadius: 8,
        paddingVertical: 16,
        alignItems: 'center',
        marginBottom: 24,
    },
    buttonDisabled: {
        backgroundColor: colors.greyPlaceholder,
    },
    buttonText: {
        color: colors.white,
        fontSize: 17,
        fontFamily: fonts.Bold,
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
    backButton: {
        alignItems: 'center',
        paddingVertical: 12,
    },
    backButtonText: {
        color: colors.leafGreen,
        fontSize: 17,
        fontFamily: fonts.Medium,
        textDecorationLine: 'underline',
    },
});

export default OTPStep; 