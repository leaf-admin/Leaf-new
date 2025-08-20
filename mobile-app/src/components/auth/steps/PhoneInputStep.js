import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Alert, ActivityIndicator } from 'react-native';
import { fonts } from '../../../common-local/font';
import auth from '@react-native-firebase/auth';

// Cores e fontes baseadas no seu design
const colors = {
    black: '#000000',
    grey80: '#333333', // Cinza 80% aproximado
    greyPlaceholder: '#BDBDBD',
    leafGreen: '#1A330E',
    white: '#FFFFFF',
    lightGrey: '#F5F5F5'
};

const PhoneInputStep = ({ onSwitchToRegister, onVerificationSent }) => {
    const [phoneNumber, setPhoneNumber] = useState('');
    const [loading, setLoading] = useState(false);

    const handleContinue = async () => {
        if (phoneNumber.length < 10) {
            Alert.alert('Erro', 'Por favor, insira um número de telefone válido.');
            return;
        }

        setLoading(true);
        try {
            const fullPhoneNumber = `+55${phoneNumber}`;
            const confirmation = await auth().signInWithPhoneNumber(fullPhoneNumber, true);
            
            // Sucesso! Notifica o componente pai para avançar.
            if (onVerificationSent) {
                onVerificationSent(confirmation, fullPhoneNumber); // Passar o telefone também
            }
        } catch (error) {
            Alert.alert('Erro de Autenticação', 'Não foi possível verificar o número. Verifique se ele está correto e tente novamente.');
            console.error("Erro no signInWithPhoneNumber:", error);
        } finally {
            setLoading(false);
        }
    };

    const handleSwitchToRegister = () => {
        // Salvar o telefone antes de mudar para o fluxo de registro
        if (phoneNumber.length >= 10) {
            const fullPhoneNumber = `+55${phoneNumber}`;
            onSwitchToRegister(fullPhoneNumber); // Passar o telefone
        } else {
            onSwitchToRegister(); // Sem telefone se não foi preenchido
        }
    };

    return (
        <View style={styles.container}>
            <Text style={styles.title}>Insira seu telefone para começar</Text>
            <View style={styles.subtitleContainer}>
                <Text style={styles.subtitleText}>ou </Text>
                <TouchableOpacity onPress={handleSwitchToRegister}>
                    <Text style={styles.link}>Cadastre-se</Text>
                </TouchableOpacity>
            </View>

            <View style={styles.inputContainer}>
                 <TouchableOpacity style={styles.countrySelector}>
                    <Text style={styles.flag}>🇧🇷</Text>
                    <Text style={styles.countryCode}>+55</Text>
                </TouchableOpacity>
                <TextInput
                    style={styles.input}
                    placeholder="(21) 99999-9999"
                    placeholderTextColor={colors.greyPlaceholder}
                    keyboardType="phone-pad"
                    value={phoneNumber}
                    onChangeText={setPhoneNumber}
                    maxLength={11}
                />
            </View>

            <TouchableOpacity style={styles.button} onPress={handleContinue} disabled={loading}>
                {loading ? (
                    <ActivityIndicator color={colors.white} />
                ) : (
                    <Text style={styles.buttonText}>Continuar</Text>
                )}
            </TouchableOpacity>
        </View>
    );
};

const styles = StyleSheet.create({
    container: {
        width: '100%',
    },
    title: {
        fontSize: 24,
        color: colors.black,
        fontFamily: fonts.Bold,
        textAlign: 'left',
        marginBottom: 8,
    },
    subtitleContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: 32,
    },
    subtitleText: {
        fontSize: 17,
        color: colors.black,
        fontFamily: fonts.Medium,
    },
    link: {
        color: colors.leafGreen,
        textDecorationLine: 'underline',
        fontFamily: fonts.Medium,
    },
    inputContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: colors.lightGrey,
        borderRadius: 8,
        paddingHorizontal: 12,
        marginBottom: 24,
    },
    countrySelector: {
        flexDirection: 'row',
        alignItems: 'center',
        marginRight: 8,
    },
    flag: {
        fontSize: 24,
    },
    countryCode: {
        fontSize: 17,
        fontFamily: fonts.Medium,
        color: colors.black,
        marginHorizontal: 8,
    },
    input: {
        flex: 1,
        fontSize: 17,
        fontFamily: fonts.Medium,
        color: colors.black,
        paddingVertical: 16,
    },
    button: {
        backgroundColor: colors.leafGreen,
        borderRadius: 8,
        paddingVertical: 16,
        alignItems: 'center',
    },
    buttonText: {
        color: colors.white,
        fontSize: 17,
        fontFamily: fonts.Bold,
    },
});

export default PhoneInputStep; 