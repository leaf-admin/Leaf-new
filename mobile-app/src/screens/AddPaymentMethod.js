import React, { useState } from 'react';
import {
    View,
    Text,
    StyleSheet,
    TouchableOpacity,
    TextInput,
    KeyboardAvoidingView,
    Platform,
    Alert,
    ActivityIndicator,
    StatusBar
} from 'react-native';
import { Icon } from 'react-native-elements';
import { colors } from '../common-local/theme';
import { getSelfHostedApiUrl } from '../config/ApiConfig';
import { useSelector, useDispatch } from 'react-redux';
import { api } from '../common-local';
import Logger from '../utils/Logger';

const MAIN_COLOR = colors.TAXIPRIMARY;

export default function AddPaymentMethod({ navigation }) {
    const [cardNumber, setCardNumber] = useState('');
    const [expiry, setExpiry] = useState('');
    const [cvv, setCvv] = useState('');
    const [holderName, setHolderName] = useState('');
    const [loading, setLoading] = useState(false);

    const auth = useSelector(state => state.auth);
    const { addPaymentMethod } = api;

    const formatCardNumber = (text) => {
        const cleaned = text.replace(/\D/g, '');
        const match = cleaned.match(/.{1,4}/g);
        if (match) {
            setCardNumber(match.join(' '));
        } else {
            setCardNumber(cleaned);
        }
    };

    const formatExpiry = (text) => {
        const cleaned = text.replace(/\D/g, '');
        if (cleaned.length >= 3) {
            setExpiry(`${cleaned.slice(0, 2)}/${cleaned.slice(2, 4)}`);
        } else {
            setExpiry(cleaned);
        }
    };

    const handleSave = async () => {
        if (!cardNumber || !expiry || !cvv || !holderName) {
            Alert.alert('Erro', 'Por favor, preencha todos os campos.');
            return;
        }

        try {
            setLoading(true);
            const baseUrl = getSelfHostedApiUrl('/api');

            // 1. Tokenize in backend
            const response = await fetch(`${baseUrl}/woovi/tokenize-card`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    number: cardNumber.replace(/\s/g, ''),
                    expiration: expiry,
                    cvv,
                    holderName
                })
            });

            const data = await response.json();

            if (data.success && data.data) {
                // 2. Save card stub in Firebase via Redux API
                const newMethod = {
                    type: 'credit_card',
                    token: data.data.token,
                    last4: data.data.last4 || cardNumber.slice(-4),
                    brand: data.data.brand || 'visa',
                    createdAt: new Date().toISOString()
                };

                await addPaymentMethod(auth.profile.uid, newMethod);

                Alert.alert('Sucesso', 'Cartão adicionado com sucesso!');
                navigation.goBack();
            } else {
                Alert.alert('Erro', 'Não foi possível tokenizar o cartão.');
            }
        } catch (error) {
            Logger.error(error);
            Alert.alert('Erro', 'Houve uma falha de conexão.');
        } finally {
            setLoading(false);
        }
    };

    return (
        <KeyboardAvoidingView
            style={styles.container}
            behavior={Platform.OS === 'ios' ? 'padding' : null}
        >
            <StatusBar hidden={true} />
            <View style={styles.header}>
                <TouchableOpacity
                    style={styles.headerButton}
                    onPress={() => navigation.goBack()}
                >
                    <Icon name="arrow-back" type="material" size={24} />
                </TouchableOpacity>
                <Text style={styles.headerTitle}>Adicionar Cartão</Text>
                <View style={styles.headerButton} />
            </View>

            <View style={styles.content}>
                <Text style={styles.label}>Número do Cartão</Text>
                <TextInput
                    style={styles.input}
                    placeholder="0000 0000 0000 0000"
                    keyboardType="numeric"
                    maxLength={19}
                    value={cardNumber}
                    onChangeText={formatCardNumber}
                />

                <Text style={styles.label}>Nome do Titular</Text>
                <TextInput
                    style={styles.input}
                    placeholder="Nome como está no cartão"
                    autoCapitalize="characters"
                    value={holderName}
                    onChangeText={setHolderName}
                />

                <View style={styles.row}>
                    <View style={styles.halfWidth}>
                        <Text style={styles.label}>Validade</Text>
                        <TextInput
                            style={styles.input}
                            placeholder="MM/AA"
                            keyboardType="numeric"
                            maxLength={5}
                            value={expiry}
                            onChangeText={formatExpiry}
                        />
                    </View>
                    <View style={styles.halfWidth}>
                        <Text style={styles.label}>CVV</Text>
                        <TextInput
                            style={styles.input}
                            placeholder="123"
                            keyboardType="numeric"
                            maxLength={4}
                            secureTextEntry={true}
                            value={cvv}
                            onChangeText={setCvv}
                        />
                    </View>
                </View>

                <TouchableOpacity
                    style={[styles.saveButton, { backgroundColor: MAIN_COLOR }]}
                    onPress={handleSave}
                    disabled={loading}
                >
                    {loading ? (
                        <ActivityIndicator color="#FFF" />
                    ) : (
                        <Text style={styles.saveButtonText}>Adicionar e Salvar</Text>
                    )}
                </TouchableOpacity>
            </View>
        </KeyboardAvoidingView>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#FFFFFF',
    },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: 16,
        paddingTop: Platform.OS === 'ios' ? 50 : 40,
        paddingBottom: 16,
        borderBottomWidth: 1,
        borderBottomColor: '#E0E0E0',
    },
    headerButton: {
        width: 40,
        height: 40,
        borderRadius: 20,
        justifyContent: 'center',
        alignItems: 'center',
    },
    headerTitle: {
        fontSize: 20,
        fontWeight: 'bold',
    },
    content: {
        padding: 20,
    },
    label: {
        fontSize: 14,
        fontWeight: '600',
        marginBottom: 8,
        color: '#333',
    },
    input: {
        borderWidth: 1,
        borderColor: '#E0E0E0',
        borderRadius: 8,
        paddingHorizontal: 16,
        paddingVertical: 12,
        fontSize: 16,
        marginBottom: 20,
        backgroundColor: '#F9F9F9',
    },
    row: {
        flexDirection: 'row',
        justifyContent: 'space-between',
    },
    halfWidth: {
        width: '48%',
    },
    saveButton: {
        paddingVertical: 16,
        borderRadius: 12,
        alignItems: 'center',
        justifyContent: 'center',
        marginTop: 20,
    },
    saveButtonText: {
        color: '#FFFFFF',
        fontSize: 16,
        fontWeight: 'bold',
    }
});
