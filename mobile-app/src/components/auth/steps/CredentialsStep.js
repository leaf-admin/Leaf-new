import React, { useState, useMemo } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Alert, ScrollView } from 'react-native';
import { fonts } from '../../../common-local/font';
import { Ionicons } from '@expo/vector-icons';
import ContinueButton from '../common/ContinueButton';

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

const CredentialsStep = ({ onCreated, onBack, initialData = {} }) => {
    const [credentials, setCredentials] = useState({
        password: initialData.password || '',
        confirmPassword: initialData.confirmPassword || '',
        acceptTerms: initialData.acceptTerms || false,
        acceptMarketing: initialData.acceptMarketing || false
    });

    const [showPassword, setShowPassword] = useState(false);
    const [showConfirmPassword, setShowConfirmPassword] = useState(false);
    const [errors, setErrors] = useState({});

    // Função para verificar se o formulário está válido
    const isFormValid = useMemo(() => {
        return credentials.password && 
               credentials.confirmPassword && 
               credentials.password === credentials.confirmPassword &&
               credentials.password.length >= 8 &&
               /(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/.test(credentials.password) &&
               credentials.acceptTerms &&
               credentials.acceptMarketing;
    }, [credentials]);

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

        if (!credentials.acceptMarketing) {
            newErrors.marketing = 'Você deve aceitar os termos legais para parceiros';
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
        <ScrollView 
            style={styles.container} 
            showsVerticalScrollIndicator={false}
            contentContainerStyle={styles.scrollContent}
        >
            <View style={styles.header}>
                <TouchableOpacity style={styles.backButton} onPress={onBack}>
                    <Ionicons name="arrow-back" size={24} color={colors.leafGreen} />
                </TouchableOpacity>
                <Text style={styles.title}>Crie uma senha</Text>
            </View>

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
                    <View style={styles.requirementItem}>
                        <Text style={styles.requirementText}>
                            • Pelo menos 8 caracteres
                        </Text>
                        <Text style={[
                            styles.requirementIcon,
                            credentials.password.length >= 8 ? styles.requirementMet : styles.requirementNotMet
                        ]}>
                            {credentials.password.length >= 8 ? '✓' : '✗'}
                        </Text>
                    </View>
                    <View style={styles.requirementItem}>
                        <Text style={styles.requirementText}>
                            • Uma letra minúscula
                        </Text>
                        <Text style={[
                            styles.requirementIcon,
                            /(?=.*[a-z])/.test(credentials.password) ? styles.requirementMet : styles.requirementNotMet
                        ]}>
                            {/(?=.*[a-z])/.test(credentials.password) ? '✓' : '✗'}
                        </Text>
                    </View>
                    <View style={styles.requirementItem}>
                        <Text style={styles.requirementText}>
                            • Uma letra maiúscula
                        </Text>
                        <Text style={[
                            styles.requirementIcon,
                            /(?=.*[A-Z])/.test(credentials.password) ? styles.requirementMet : styles.requirementNotMet
                        ]}>
                            {/(?=.*[A-Z])/.test(credentials.password) ? '✓' : '✗'}
                        </Text>
                    </View>
                    <View style={styles.requirementItem}>
                        <Text style={styles.requirementText}>
                            • Um número
                        </Text>
                        <Text style={[
                            styles.requirementIcon,
                            /(?=.*\d)/.test(credentials.password) ? styles.requirementMet : styles.requirementNotMet
                        ]}>
                            {/(?=.*\d)/.test(credentials.password) ? '✓' : '✗'}
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
                        Aceitar termos legais para parceiros *
                    </Text>
                </TouchableOpacity>
                {errors.marketing && <Text style={styles.errorText}>{errors.marketing}</Text>}
            </View>

            {/* Botão Continuar */}
            <ContinueButton
                onPress={handleCreateCredentials}
                disabled={!isFormValid}
                text="Continuar"
            />
        </ScrollView>
    );
};

const styles = StyleSheet.create({
    container: {
        flex: 1,
        paddingVertical: 5, // Reduzido de 20 para 5 (subindo 15px)
    },
    scrollContent: {
        flexGrow: 1,
        paddingBottom: 20, // Adicionado padding bottom para o botão
    },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: 16,
        paddingHorizontal: 24,
        marginTop: -10, // Adicionado margem negativa para subir mais
    },
    backButton: {
        padding: 8,
        marginRight: 12,
    },
    title: {
        fontSize: 24,
        color: colors.black,
        fontFamily: fonts.Bold,
        textAlign: 'left',
    },
    fieldContainer: {
        marginBottom: 20, // Reduzido de 24 para 20 (subindo 4px)
        paddingHorizontal: 24,
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
        marginTop: 10, // Reduzido de 12 para 10 (subindo 2px)
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
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 4,
    },
    requirementText: {
        fontSize: 14,
        color: colors.greyPlaceholder,
        fontFamily: fonts.Regular,
    },
    requirementIcon: {
        fontSize: 18,
        marginLeft: 8,
    },
    requirementMet: {
        color: colors.success,
        fontFamily: fonts.Medium,
    },
    requirementNotMet: {
        color: colors.error,
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
        fontSize: 14,
        color: colors.black,
        fontFamily: fonts.Medium,
        lineHeight: 20,
    },
    linkText: {
        color: colors.leafGreen,
        textDecorationLine: 'underline',
    },

});

export default CredentialsStep; 