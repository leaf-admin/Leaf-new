import React, { useState, useMemo } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, ScrollView } from 'react-native';
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
    error: '#FF3B30'
};

const DocumentStep = ({ onSubmitted, onBack, initialData = {} }) => {
    const [documentData, setDocumentData] = useState({
        email: initialData.profileData?.email || initialData.email || '',
        cpf: initialData.profileData?.cpf || initialData.cpf || ''
    });

    const [errors, setErrors] = useState({});

    // Função para verificar se o formulário está válido
    const isFormValid = useMemo(() => {
        return documentData.email.trim() && 
               documentData.cpf.trim() && 
               /^\d{3}\.\d{3}\.\d{3}-\d{2}$/.test(documentData.cpf);
    }, [documentData.email, documentData.cpf]);

    // Validação dos campos
    const validateFields = () => {
        const newErrors = {};

        if (!documentData.email.trim()) {
            newErrors.email = 'Email é obrigatório';
        } else if (!/\S+@\S+\.\S+/.test(documentData.email)) {
            newErrors.email = 'Email inválido';
        }

        if (!documentData.cpf.trim()) {
            newErrors.cpf = 'CPF é obrigatório';
        } else if (!/^\d{3}\.\d{3}\.\d{3}-\d{2}$/.test(documentData.cpf)) {
            newErrors.cpf = 'CPF deve estar no formato XXX.XXX.XXX-XX';
        }

        setErrors(newErrors);
        return Object.keys(newErrors).length === 0;
    };

    // Função para lidar com o envio dos dados
    const handleSubmit = () => {
        if (validateFields()) {
            onSubmitted(documentData);
        }
    };

    // Função para atualizar um campo
    const updateField = (field, value) => {
        setDocumentData(prev => ({ ...prev, [field]: value }));
        // Limpar erro do campo quando o usuário começar a digitar
        if (errors[field]) {
            setErrors(prev => ({ ...prev, [field]: '' }));
        }
    };

    // Função para formatar CPF
    const formatCPF = (value) => {
        const numbers = value.replace(/\D/g, '');
        if (numbers.length <= 3) return numbers;
        if (numbers.length <= 6) return `${numbers.slice(0, 3)}.${numbers.slice(3)}`;
        if (numbers.length <= 9) return `${numbers.slice(0, 3)}.${numbers.slice(3, 6)}.${numbers.slice(6)}`;
        return `${numbers.slice(0, 3)}.${numbers.slice(3, 6)}.${numbers.slice(6, 9)}-${numbers.slice(9, 11)}`;
    };

    const handleCPFChange = (value) => {
        const formatted = formatCPF(value);
        updateField('cpf', formatted);
    };

    return (
        <ScrollView style={styles.container} showsVerticalScrollIndicator={false}>
            <View style={styles.header}>
                <TouchableOpacity style={styles.backButton} onPress={onBack}>
                    <Ionicons name="arrow-back" size={24} color={colors.leafGreen} />
                </TouchableOpacity>
                <Text style={styles.title}>Dados Pessoais</Text>
            </View>

            {/* Email */}
            <View style={styles.fieldContainer}>
                <Text style={styles.label}>Email *</Text>
                <TextInput
                    style={[styles.input, errors.email && styles.inputError]}
                    value={documentData.email}
                    onChangeText={(value) => updateField('email', value)}
                    placeholder="seu@email.com"
                    placeholderTextColor={colors.greyPlaceholder}
                    keyboardType="email-address"
                    autoCapitalize="none"
                />
                {errors.email && <Text style={styles.errorText}>{errors.email}</Text>}
            </View>

            {/* CPF */}
            <View style={styles.fieldContainer}>
                <Text style={styles.label}>CPF *</Text>
                <TextInput
                    style={[styles.input, errors.cpf && styles.inputError]}
                    value={documentData.cpf}
                    onChangeText={handleCPFChange}
                    placeholder="000.000.000-00"
                    placeholderTextColor={colors.greyPlaceholder}
                    keyboardType="numeric"
                    maxLength={14}
                />
                {errors.cpf && <Text style={styles.errorText}>{errors.cpf}</Text>}
            </View>

            {/* Botão Continuar */}
            <ContinueButton
                onPress={handleSubmit}
                disabled={!isFormValid}
                text="Continuar"
            />
        </ScrollView>
    );
};

const styles = StyleSheet.create({
    container: {
        flex: 1,
        paddingHorizontal: 24,
        paddingTop: 20,
    },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: 24,
    },
    backButton: {
        marginRight: 10,
    },
    title: {
        fontSize: 24,
        color: colors.black,
        fontFamily: fonts.Bold,
        textAlign: 'left',
    },
    fieldContainer: {
        marginBottom: 20,
    },
    label: {
        fontSize: 16,
        color: colors.black,
        fontFamily: fonts.Medium,
        marginBottom: 8,
    },
    input: {
        borderWidth: 2,
        borderColor: colors.lightGrey,
        borderRadius: 8,
        paddingHorizontal: 16,
        paddingVertical: 14,
        fontSize: 16,
        fontFamily: fonts.Medium,
        color: colors.black,
        backgroundColor: colors.white,
    },
    inputError: {
        borderColor: colors.error,
    },
    errorText: {
        color: colors.error,
        fontSize: 14,
        fontFamily: fonts.Medium,
        marginTop: 4,
    },

});

export default DocumentStep;
