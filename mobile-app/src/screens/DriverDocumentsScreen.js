import React, { useState, useEffect, useContext } from 'react';
import { StyleSheet, View, Text, TextInput, TouchableOpacity, ScrollView, ActivityIndicator, Alert, Image } from 'react-native';
import { useSelector, useDispatch } from 'react-redux';
import i18n from '../i18n';
import { colors } from '../common/theme';
import { api, FirebaseContext } from 'common'; // Importar api e FirebaseContext
import * as ImagePicker from 'expo-image-picker'; // Importar ImagePicker
import AsyncStorage from '@react-native-async-storage/async-storage';
import { updateUserType } from 'common/src/actions/authactions';

const DriverDocumentsScreen = ({ navigation }) => {
    const { t } = i18n;
    const auth = useSelector(state => state.auth);
    const settings = useSelector(state => state.settingsdata.settings); // Adicionar settings para verificar requisitos
    const dispatch = useDispatch(); // Descomentar dispatch

    const { profile } = auth;
    const { config, firebase } = useContext(FirebaseContext); // Usar useContext para config E firebase

    const [loading, setLoading] = useState(false);
    const [documents, setDocuments] = useState({});
    const [userData, setUserData] = useState(null);

    useEffect(() => {
        checkAuth();
    }, []);

    const checkAuth = async () => {
        try {
            const storedUserData = await AsyncStorage.getItem('@user_data');
            if (storedUserData) {
                const data = JSON.parse(storedUserData);
                setUserData(data);
                console.log('[DriverDocumentsScreen] Dados do usuário carregados:', data);
            } else {
                console.log('[DriverDocumentsScreen] Nenhum dado de usuário encontrado');
                Alert.alert(
                    'Sessão Expirada',
                    'Sua sessão expirou. Por favor, faça login novamente.',
                    [
                        {
                            text: 'OK',
                            onPress: () => navigation.navigate('Login')
                        }
                    ]
                );
            }
        } catch (error) {
            console.error('[DriverDocumentsScreen] Erro ao verificar autenticação:', error);
            Alert.alert(
                'Erro',
                'Ocorreu um erro ao verificar sua autenticação. Por favor, faça login novamente.',
                [
                    {
                        text: 'OK',
                        onPress: () => navigation.navigate('Login')
                    }
                ]
            );
        }
    };

    const _pickImage = async (documentType) => {
        try {
            const result = await ImagePicker.launchImageLibraryAsync({
                mediaTypes: ImagePicker.MediaTypeOptions.Images,
                allowsEditing: true,
                aspect: [4, 3],
                quality: 1,
            });

            if (!result.canceled) {
                const newDocuments = { ...documents };
                newDocuments[documentType] = result.assets[0].uri;
                setDocuments(newDocuments);
            }
        } catch (error) {
            console.error('[DriverDocumentsScreen] Erro ao selecionar imagem:', error);
            Alert.alert(
                'Erro',
                'Ocorreu um erro ao selecionar a imagem. Por favor, tente novamente.'
            );
        }
    };

    const handleSaveDocuments = async () => {
        try {
            setLoading(true);

            const storedUserData = await AsyncStorage.getItem('@user_data');
            if (!storedUserData) {
                throw new Error('Dados do usuário não encontrados');
            }

            const currentUserData = JSON.parse(storedUserData);
            if (!currentUserData || !currentUserData.uid) {
                throw new Error('Perfil de usuário inválido');
            }

            // Verificar documentos obrigatórios
            const requiredDocuments = ['cnh', 'crlv', 'selfie'];
            const missingDocuments = requiredDocuments.filter(doc => !documents[doc]);

            if (missingDocuments.length > 0) {
                Alert.alert(
                    t('documents_pending'),
                    t('documents_pending_message')
                );
                return;
            }

            // Atualizar tipo de usuário e documentos
            await dispatch(updateUserType(currentUserData.uid, documents));

            Alert.alert(
                t('documents_success'),
                t('documents_success_message'),
                [
                    {
                        text: 'OK',
                        onPress: () => {
                            // Navegar para a tela de veículos
                            navigation.navigate('VehicleRegistration');
                        }
                    }
                ]
            );
        } catch (error) {
            console.error('[DriverDocumentsScreen] Erro ao salvar documentos:', error);
            Alert.alert(
                t('error'),
                t('documents_error_message')
            );
        } finally {
            setLoading(false);
        }
    };

    if (loading) {
        return (
            <View style={styles.loadingContainer}>
                <ActivityIndicator size="large" color="#0000ff" />
                <Text style={styles.loadingText}>Processando...</Text>
            </View>
        );
    }

    return (
        <ScrollView style={styles.container}>
            <Text style={styles.title}>{t('driver_documents')}</Text>
            
            <View style={styles.documentSection}>
                <Text style={styles.sectionTitle}>{t('cnh_title')}</Text>
                <TouchableOpacity
                    style={styles.documentButton}
                    onPress={() => _pickImage('cnh')}
                >
                    <Text style={styles.buttonText}>{t('select_cnh')}</Text>
                </TouchableOpacity>
                {documents.cnh && (
                    <Image source={{ uri: documents.cnh }} style={styles.documentPreview} />
                )}
            </View>

            <View style={styles.documentSection}>
                <Text style={styles.sectionTitle}>{t('crlv_title')}</Text>
                <TouchableOpacity
                    style={styles.documentButton}
                    onPress={() => _pickImage('crlv')}
                >
                    <Text style={styles.buttonText}>{t('select_crlv')}</Text>
                </TouchableOpacity>
                {documents.crlv && (
                    <Image source={{ uri: documents.crlv }} style={styles.documentPreview} />
                )}
            </View>

            <View style={styles.documentSection}>
                <Text style={styles.sectionTitle}>{t('selfie_title')}</Text>
                <TouchableOpacity
                    style={styles.documentButton}
                    onPress={() => _pickImage('selfie')}
                >
                    <Text style={styles.buttonText}>{t('take_selfie')}</Text>
                </TouchableOpacity>
                {documents.selfie && (
                    <Image source={{ uri: documents.selfie }} style={styles.documentPreview} />
                )}
            </View>

            <TouchableOpacity
                style={styles.saveButton}
                onPress={handleSaveDocuments}
                disabled={loading}
            >
                <Text style={styles.saveButtonText}>{t('save_documents')}</Text>
            </TouchableOpacity>
        </ScrollView>
    );
};

const styles = StyleSheet.create({
    container: {
        flex: 1,
        padding: 20,
        backgroundColor: '#fff'
    },
    loadingContainer: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        backgroundColor: '#fff'
    },
    loadingText: {
        marginTop: 10,
        fontSize: 16,
        color: '#666'
    },
    title: {
        fontSize: 24,
        fontWeight: 'bold',
        marginBottom: 20,
        color: '#333'
    },
    documentSection: {
        marginBottom: 20,
        padding: 15,
        backgroundColor: '#f5f5f5',
        borderRadius: 8
    },
    sectionTitle: {
        fontSize: 16,
        fontWeight: '600',
        marginBottom: 10,
        color: '#333'
    },
    documentButton: {
        backgroundColor: '#007AFF',
        padding: 12,
        borderRadius: 6,
        alignItems: 'center',
        marginBottom: 10
    },
    buttonText: {
        color: '#fff',
        fontSize: 14,
        fontWeight: '600'
    },
    documentPreview: {
        width: '100%',
        height: 200,
        borderRadius: 8,
        marginTop: 10
    },
    saveButton: {
        backgroundColor: '#34C759',
        padding: 15,
        borderRadius: 8,
        alignItems: 'center',
        marginTop: 20,
        marginBottom: 40
    },
    saveButtonText: {
        color: '#fff',
        fontSize: 16,
        fontWeight: '600'
    }
});

export default DriverDocumentsScreen; 