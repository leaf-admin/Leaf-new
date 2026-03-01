import React, { useState, useMemo, useCallback } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Alert, ScrollView } from 'react-native';
import { fonts } from '../../../common-local/font';
import { Ionicons } from '@expo/vector-icons';
import { saveStepData } from '../../../utils/secureOnboardingStorage';
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

const ProfileDataStep = ({ onSubmitted, onBack, initialData = {} }) => {
    const [profileData, setProfileData] = useState({
        firstName: initialData.firstName || '',
        lastName: initialData.lastName || '',
        dateOfBirth: initialData.dateOfBirth || '',
        gender: initialData.gender || ''
    });

    const [errors, setErrors] = useState({});

    // Validação dos campos
    const validateFields = () => {
        const newErrors = {};

        if (!profileData.firstName.trim()) {
            newErrors.firstName = 'Nome é obrigatório';
        }

        if (!profileData.lastName.trim()) {
            newErrors.lastName = 'Sobrenome é obrigatório';
        }

        if (!profileData.dateOfBirth) {
            newErrors.dateOfBirth = 'Data de nascimento é obrigatória';
        }

        if (!profileData.gender) {
            newErrors.gender = 'Gênero é obrigatório';
        }

        setErrors(newErrors);
        return Object.keys(newErrors).length === 0;
    };

    // Função para verificar se o formulário está válido
    const isFormValid = useMemo(() => {
        return profileData.firstName.trim() && 
               profileData.lastName.trim() && 
               profileData.dateOfBirth && 
               profileData.gender;
    }, [profileData.firstName, profileData.lastName, profileData.dateOfBirth, profileData.gender]);

    // Função para lidar com o envio dos dados
    const handleSubmit = () => {
        if (validateFields()) {
            onSubmitted(profileData);
        }
    };

    // Função para atualizar um campo
    const updateField = useCallback(async (field, value) => {
        const newData = { ...profileData, [field]: value };
        setProfileData(newData);
        
        // Salvar automaticamente no AsyncStorage
        await saveStepData('profile_data', newData);
        
        // Limpar erro do campo quando o usuário começar a digitar
        if (errors[field]) {
            setErrors(prev => ({ ...prev, [field]: '' }));
        }
    }, [profileData, errors]);

    // Função para formatar data de nascimento
    const formatDateOfBirth = (value) => {
        const numbers = value.replace(/\D/g, '');
        if (numbers.length <= 2) return numbers;
        if (numbers.length <= 4) return `${numbers.slice(0, 2)}/${numbers.slice(2)}`;
        if (numbers.length <= 6) return `${numbers.slice(0, 2)}/${numbers.slice(2, 4)}/${numbers.slice(4)}`;
        return `${numbers.slice(0, 2)}/${numbers.slice(2, 4)}/${numbers.slice(4, 8)}`;
    };

    const handleDateOfBirthChange = (value) => {
        const formatted = formatDateOfBirth(value);
        updateField('dateOfBirth', formatted);
    };

    return (
        <ScrollView style={styles.container} showsVerticalScrollIndicator={false}>
            <View style={styles.header}>
                <TouchableOpacity style={styles.backButton} onPress={onBack}>
                    <Ionicons name="arrow-back" size={24} color={colors.leafGreen} />
                </TouchableOpacity>
                <Text style={styles.title}>Dados Pessoais</Text>
            </View>
            <Text style={styles.subtitle}>
                Preencha seus dados pessoais básicos
            </Text>

            {/* Nome e Sobrenome */}
            <View style={styles.row}>
                <View style={styles.halfWidth}>
                    <Text style={styles.label}>Nome *</Text>
                    <TextInput
                        style={[styles.input, errors.firstName && styles.inputError]}
                        value={profileData.firstName}
                        onChangeText={(value) => updateField('firstName', value)}
                        placeholder="Seu nome"
                        placeholderTextColor={colors.greyPlaceholder}
                    />
                    {errors.firstName && <Text style={styles.errorText}>{errors.firstName}</Text>}
                </View>

                <View style={styles.halfWidth}>
                    <Text style={styles.label}>Sobrenome *</Text>
                    <TextInput
                        style={[styles.input, errors.lastName && styles.inputError]}
                        value={profileData.lastName}
                        onChangeText={(value) => updateField('lastName', value)}
                        placeholder="Seu sobrenome"
                        placeholderTextColor={colors.greyPlaceholder}
                    />
                    {errors.lastName && <Text style={styles.errorText}>{errors.lastName}</Text>}
                </View>
            </View>

            {/* Data de Nascimento */}
            <View style={styles.fieldContainer}>
                <Text style={styles.label}>Data de Nascimento *</Text>
                <TextInput
                    style={[styles.input, errors.dateOfBirth && styles.inputError]}
                    value={profileData.dateOfBirth}
                    onChangeText={handleDateOfBirthChange}
                    placeholder="DD/MM/AAAA"
                    placeholderTextColor={colors.greyPlaceholder}
                    keyboardType="numeric"
                    maxLength={10}
                />
                {errors.dateOfBirth && <Text style={styles.errorText}>{errors.dateOfBirth}</Text>}
            </View>

            {/* Gênero */}
            <View style={styles.fieldContainer}>
                <Text style={styles.label}>Gênero *</Text>
                <View style={styles.radioContainer}>
                    {['Masculino', 'Feminino'].map((gender) => (
                        <TouchableOpacity
                            key={gender}
                            style={[
                                styles.radioButton,
                                profileData.gender === gender && styles.radioButtonSelected
                            ]}
                            onPress={() => updateField('gender', gender)}
                        >
                            <Text style={[
                                styles.radioText,
                                profileData.gender === gender && styles.radioTextSelected
                            ]}>
                                {gender}
                            </Text>
                        </TouchableOpacity>
                    ))}
                </View>
                {errors.gender && <Text style={styles.errorText}>{errors.gender}</Text>}
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
        paddingVertical: 20,
    },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: 16,
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
    subtitle: {
        fontSize: 17,
        color: colors.grey80,
        fontFamily: fonts.Medium,
        marginBottom: 32,
        lineHeight: 22,
    },
    row: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        marginBottom: 20,
    },
    halfWidth: {
        width: '48%',
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
    radioContainer: {
        flexDirection: 'row',
        justifyContent: 'space-between',
    },
    radioButton: {
        flex: 1,
        borderWidth: 2,
        borderColor: colors.lightGrey,
        borderRadius: 8,
        paddingVertical: 12,
        alignItems: 'center',
        marginHorizontal: 4,
        backgroundColor: colors.white,
    },
    radioButtonSelected: {
        borderColor: colors.leafGreen,
        backgroundColor: colors.leafGreen,
    },
    radioText: {
        fontSize: 16,
        color: colors.black,
        fontFamily: fonts.Medium,
    },
    radioTextSelected: {
        color: colors.white,
    },

});

export default ProfileDataStep;





