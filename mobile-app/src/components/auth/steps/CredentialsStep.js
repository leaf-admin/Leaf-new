import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Alert, ScrollView } from 'react-native';
import { fonts } from '../../../common-local/font';

// Cores baseadas no design
const colors = {
    black: '#000000',
    grey80: '#333333',
    greyPlaceholder: '#BDBDBD',
    leafGreen: '#1A330E',
    white: '#FFFFFF',
    lightGrey: '#F5F5F5',
    error: '#FF3B30',
    success: '#34C759'
};

const CredentialsStep = ({ onCreated, onBack }) => {
    const [credentials, setCredentials] = useState({
        password: '',
        confirmPassword: '',
        acceptTerms: false,
        acceptMarketing: false
    });

    const [showPassword, setShowPassword] = useState(false);
    const [showConfirmPassword, setShowConfirmPassword] = useState(false);
    const [errors, setErrors] = useState({});

    // Validação dos campos
    const validateFields = () => {
        const newErrors = {};

        if (!credentials.password) {
            newErrors.password = 'Senha é obrigatória';
        } else if (credentials.password.length < 8) {
            newErrors.password = 'Senha deve ter pelo menos 8 caracteres';
        } else if (!/(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/.test(credentials.password)) {
            newErrors.password = 'Senha deve conter letra maiúscula, minúscula e número';
        }

        if (!credentials.confirmPassword) {
            newErrors.confirmPassword = 'Confirmação de senha é obrigatória';
        } else if (credentials.password !== credentials.confirmPassword) {
            newErrors.confirmPassword = 'Senhas não coincidem';
        }

        if (!credentials.acceptTerms) {
            newErrors.terms = 'Você deve aceitar os termos de uso';
        }

        setErrors(newErrors);
        return Object.keys(newErrors).length === 0;
    };

    // Função para lidar com a criação das credenciais
    const handleCreateCredentials = () => {
        if (validateFields()) {
            // Aqui você pode implementar a lógica para salvar as credenciais
            // Por exemplo, criar o usuário no Firebase Auth
            onCreated(credentials);
        }
    };

    // Função para atualizar um campo
    const updateField = (field, value) => {
        setCredentials(prev => ({ ...prev, [field]: value }));
        // Limpar erro do campo quando o usuário começar a digitar
        if (errors[field]) {
            setErrors(prev => ({ ...prev, [field]: '' }));
        }
    };

    // Função para alternar checkbox
    const toggleCheckbox = (field) => {
        setCredentials(prev => ({ ...prev, [field]: !prev[field] }));
        if (field === 'terms' && errors.terms) {
            setErrors(prev => ({ ...prev, terms: '' }));
        }
    };

    return (
        <ScrollView style={styles.container} showsVerticalScrollIndicator={false}>
            <Text style={styles.title}>Criar Conta</Text>
            <Text style={styles.subtitle}>
                Crie uma senha segura para sua conta
            </Text>

            {/* Senha */}
            <View style={styles.fieldContainer}>
                <Text style={styles.label}>Senha *</Text>
                <View style={styles.passwordContainer}>
                    <TextInput
                        style={[styles.passwordInput, errors.password && styles.inputError]}
                        value={credentials.password}
                        onChangeText={(value) => updateField('password', value)}
                        placeholder="Digite sua senha"
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
                {errors.password && <Text style={styles.errorText}>{errors.password}</Text>}
                
                {/* Requisitos da senha */}
                <View style={styles.requirementsContainer}>
                    <Text style={styles.requirementsTitle}>A senha deve conter:</Text>
                    <View style={styles.requirementItem}>
                        <Text style={[
                            styles.requirementText,
                            credentials.password.length >= 8 && styles.requirementMet
                        ]}>
                            • Pelo menos 8 caracteres
                        </Text>
                    </View>
                    <View style={styles.requirementItem}>
                        <Text style={[
                            styles.requirementText,
                            /(?=.*[a-z])/.test(credentials.password) && styles.requirementMet
                        ]}>
                            • Uma letra minúscula
                        </Text>
                    </View>
                    <View style={styles.requirementItem}>
                        <Text style={[
                            styles.requirementText,
                            /(?=.*[A-Z])/.test(credentials.password) && styles.requirementMet
                        ]}>
                            • Uma letra maiúscula
                        </Text>
                    </View>
                    <View style={styles.requirementItem}>
                        <Text style={[
                            styles.requirementText,
                            /(?=.*\d)/.test(credentials.password) && styles.requirementMet
                        ]}>
                            • Um número
                        </Text>
                    </View>
                </View>
            </View>

            {/* Confirmar Senha */}
            <View style={styles.fieldContainer}>
                <Text style={styles.label}>Confirmar Senha *</Text>
                <View style={styles.passwordContainer}>
                    <TextInput
                        style={[styles.passwordInput, errors.confirmPassword && styles.inputError]}
                        value={credentials.confirmPassword}
                        onChangeText={(value) => updateField('confirmPassword', value)}
                        placeholder="Confirme sua senha"
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
                {errors.confirmPassword && <Text style={styles.errorText}>{errors.confirmPassword}</Text>}
            </View>

            {/* Termos e Condições */}
            <View style={styles.fieldContainer}>
                <TouchableOpacity
                    style={styles.checkboxContainer}
                    onPress={() => toggleCheckbox('acceptTerms')}
                >
                    <View style={[
                        styles.checkbox,
                        credentials.acceptTerms && styles.checkboxChecked
                    ]}>
                        {credentials.acceptTerms && <Text style={styles.checkmark}>✓</Text>}
                    </View>
                    <Text style={styles.checkboxText}>
                        Aceito os{' '}
                        <Text style={styles.linkText}>Termos de Uso</Text>
                        {' '}e{' '}
                        <Text style={styles.linkText}>Política de Privacidade</Text>
                    </Text>
                </TouchableOpacity>
                {errors.terms && <Text style={styles.errorText}>{errors.terms}</Text>}
            </View>

            {/* Marketing */}
            <View style={styles.fieldContainer}>
                <TouchableOpacity
                    style={styles.checkboxContainer}
                    onPress={() => toggleCheckbox('acceptMarketing')}
                >
                    <View style={[
                        styles.checkbox,
                        credentials.acceptMarketing && styles.checkboxChecked
                    ]}>
                        {credentials.acceptMarketing && <Text style={styles.checkmark}>✓</Text>}
                    </View>
                    <Text style={styles.checkboxText}>
                        Aceito receber notificações sobre promoções e novidades
                    </Text>
                </TouchableOpacity>
            </View>

            {/* Botões */}
            <View style={styles.buttonContainer}>
                <TouchableOpacity style={styles.backButton} onPress={onBack}>
                    <Text style={styles.backButtonText}>Voltar</Text>
                </TouchableOpacity>

                <TouchableOpacity style={styles.createButton} onPress={handleCreateCredentials}>
                    <Text style={styles.createButtonText}>Criar Conta</Text>
                </TouchableOpacity>
            </View>
        </ScrollView>
    );
};

const styles = StyleSheet.create({
    container: {
        flex: 1,
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
    fieldContainer: {
        marginBottom: 24,
    },
    label: {
        fontSize: 16,
        color: colors.black,
        fontFamily: fonts.Medium,
        marginBottom: 8,
    },
    passwordContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        borderWidth: 2,
        borderColor: colors.lightGrey,
        borderRadius: 8,
        backgroundColor: colors.white,
    },
    passwordInput: {
        flex: 1,
        paddingHorizontal: 16,
        paddingVertical: 14,
        fontSize: 16,
        fontFamily: fonts.Medium,
        color: colors.black,
    },
    inputError: {
        borderColor: colors.error,
    },
    eyeButton: {
        paddingHorizontal: 16,
        paddingVertical: 14,
    },
    eyeButtonText: {
        fontSize: 20,
    },
    errorText: {
        color: colors.error,
        fontSize: 14,
        fontFamily: fonts.Medium,
        marginTop: 4,
    },
    requirementsContainer: {
        marginTop: 12,
        padding: 12,
        backgroundColor: colors.lightGrey,
        borderRadius: 8,
    },
    requirementsTitle: {
        fontSize: 14,
        color: colors.grey80,
        fontFamily: fonts.Medium,
        marginBottom: 8,
    },
    requirementItem: {
        marginBottom: 4,
    },
    requirementText: {
        fontSize: 14,
        color: colors.greyPlaceholder,
        fontFamily: fonts.Regular,
    },
    requirementMet: {
        color: colors.success,
        fontFamily: fonts.Medium,
    },
    checkboxContainer: {
        flexDirection: 'row',
        alignItems: 'flex-start',
    },
    checkbox: {
        width: 20,
        height: 20,
        borderWidth: 2,
        borderColor: colors.lightGrey,
        borderRadius: 4,
        marginRight: 12,
        marginTop: 2,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: colors.white,
    },
    checkboxChecked: {
        borderColor: colors.leafGreen,
        backgroundColor: colors.leafGreen,
    },
    checkmark: {
        color: colors.white,
        fontSize: 14,
        fontFamily: fonts.Bold,
    },
    checkboxText: {
        flex: 1,
        fontSize: 16,
        color: colors.black,
        fontFamily: fonts.Medium,
        lineHeight: 22,
    },
    linkText: {
        color: colors.leafGreen,
        textDecorationLine: 'underline',
    },
    buttonContainer: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        marginTop: 32,
    },
    backButton: {
        flex: 1,
        alignItems: 'center',
        paddingVertical: 16,
        marginRight: 8,
    },
    backButtonText: {
        color: colors.leafGreen,
        fontSize: 17,
        fontFamily: fonts.Medium,
        textDecorationLine: 'underline',
    },
    createButton: {
        flex: 2,
        backgroundColor: colors.leafGreen,
        borderRadius: 8,
        paddingVertical: 16,
        alignItems: 'center',
        marginLeft: 8,
    },
    createButtonText: {
        color: colors.white,
        fontSize: 17,
        fontFamily: fonts.Bold,
    },
});

export default CredentialsStep; 