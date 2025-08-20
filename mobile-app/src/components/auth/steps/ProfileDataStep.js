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
    error: '#FF3B30'
};

const ProfileDataStep = ({ onSubmitted, onBack }) => {
    const [profileData, setProfileData] = useState({
        firstName: '',
        lastName: '',
        email: '',
        dateOfBirth: '',
        gender: '',
        documentType: '',
        documentNumber: ''
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

        if (!profileData.email.trim()) {
            newErrors.email = 'Email é obrigatório';
        } else if (!/\S+@\S+\.\S+/.test(profileData.email)) {
            newErrors.email = 'Email inválido';
        }

        if (!profileData.dateOfBirth) {
            newErrors.dateOfBirth = 'Data de nascimento é obrigatória';
        }

        if (!profileData.gender) {
            newErrors.gender = 'Gênero é obrigatório';
        }

        if (!profileData.documentType) {
            newErrors.documentType = 'Tipo de documento é obrigatório';
        }

        if (!profileData.documentNumber.trim()) {
            newErrors.documentNumber = 'Número do documento é obrigatório';
        }

        setErrors(newErrors);
        return Object.keys(newErrors).length === 0;
    };

    // Função para lidar com o envio dos dados
    const handleSubmit = () => {
        if (validateFields()) {
            onSubmitted(profileData);
        }
    };

    // Função para atualizar um campo
    const updateField = (field, value) => {
        setProfileData(prev => ({ ...prev, [field]: value }));
        // Limpar erro do campo quando o usuário começar a digitar
        if (errors[field]) {
            setErrors(prev => ({ ...prev, [field]: '' }));
        }
    };

    return (
        <ScrollView style={styles.container} showsVerticalScrollIndicator={false}>
            <Text style={styles.title}>Dados do Perfil</Text>
            <Text style={styles.subtitle}>
                Preencha seus dados pessoais para continuar
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

            {/* Email */}
            <View style={styles.fieldContainer}>
                <Text style={styles.label}>Email *</Text>
                <TextInput
                    style={[styles.input, errors.email && styles.inputError]}
                    value={profileData.email}
                    onChangeText={(value) => updateField('email', value)}
                    placeholder="seu@email.com"
                    placeholderTextColor={colors.greyPlaceholder}
                    keyboardType="email-address"
                    autoCapitalize="none"
                />
                {errors.email && <Text style={styles.errorText}>{errors.email}</Text>}
            </View>

            {/* Data de Nascimento */}
            <View style={styles.fieldContainer}>
                <Text style={styles.label}>Data de Nascimento *</Text>
                <TextInput
                    style={[styles.input, errors.dateOfBirth && styles.inputError]}
                    value={profileData.dateOfBirth}
                    onChangeText={(value) => updateField('dateOfBirth', value)}
                    placeholder="DD/MM/AAAA"
                    placeholderTextColor={colors.greyPlaceholder}
                    keyboardType="numeric"
                />
                {errors.dateOfBirth && <Text style={styles.errorText}>{errors.dateOfBirth}</Text>}
            </View>

            {/* Gênero */}
            <View style={styles.fieldContainer}>
                <Text style={styles.label}>Gênero *</Text>
                <View style={styles.radioContainer}>
                    {['Masculino', 'Feminino', 'Outro'].map((gender) => (
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

            {/* Tipo de Documento */}
            <View style={styles.fieldContainer}>
                <Text style={styles.label}>Tipo de Documento *</Text>
                <View style={styles.radioContainer}>
                    {['CPF', 'RG', 'CNH'].map((docType) => (
                        <TouchableOpacity
                            key={docType}
                            style={[
                                styles.radioButton,
                                profileData.documentType === docType && styles.radioButtonSelected
                            ]}
                            onPress={() => updateField('documentType', docType)}
                        >
                            <Text style={[
                                styles.radioText,
                                profileData.documentType === docType && styles.radioTextSelected
                            ]}>
                                {docType}
                            </Text>
                        </TouchableOpacity>
                    ))}
                </View>
                {errors.documentType && <Text style={styles.errorText}>{errors.documentType}</Text>}
            </View>

            {/* Número do Documento */}
            <View style={styles.fieldContainer}>
                <Text style={styles.label}>Número do Documento *</Text>
                <TextInput
                    style={[styles.input, errors.documentNumber && styles.inputError]}
                    value={profileData.documentNumber}
                    onChangeText={(value) => updateField('documentNumber', value)}
                    placeholder="000.000.000-00"
                    placeholderTextColor={colors.greyPlaceholder}
                    keyboardType="numeric"
                />
                {errors.documentNumber && <Text style={styles.errorText}>{errors.documentNumber}</Text>}
            </View>

            {/* Botões */}
            <View style={styles.buttonContainer}>
                <TouchableOpacity style={styles.backButton} onPress={onBack}>
                    <Text style={styles.backButtonText}>Voltar</Text>
                </TouchableOpacity>

                <TouchableOpacity style={styles.submitButton} onPress={handleSubmit}>
                    <Text style={styles.submitButtonText}>Continuar</Text>
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
    submitButton: {
        flex: 2,
        backgroundColor: colors.leafGreen,
        borderRadius: 8,
        paddingVertical: 16,
        alignItems: 'center',
        marginLeft: 8,
    },
    submitButtonText: {
        color: colors.white,
        fontSize: 17,
        fontFamily: fonts.Bold,
    },
});

export default ProfileDataStep;





