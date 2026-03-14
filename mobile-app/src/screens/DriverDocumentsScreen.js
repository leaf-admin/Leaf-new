import Logger from '../utils/Logger';
import React, { useState, useEffect, useContext } from 'react';
import { StyleSheet, View, Text, TextInput, TouchableOpacity, ScrollView, ActivityIndicator, Alert, Image, Modal } from 'react-native';
import { useSelector, useDispatch } from 'react-redux';
import i18n from '../i18n';
import { colors } from '../common/theme';
import { api, FirebaseContext } from '../../common'; // Importar api e FirebaseContext
import * as ImagePicker from 'expo-image-picker'; // Importar ImagePicker
import AsyncStorage from '@react-native-async-storage/async-storage';
import { updateUserType } from '../../common/src/actions/authactions';
import KYCCameraScreen from '../components/KYC/KYCCameraScreen';
import faceDetectionService from '../services/FaceDetectionService';
import kycService from '../services/KYCService';
import { isKYCEnabled } from '../config/kycConfig';


const DriverDocumentsScreen = ({ navigation }) => {
    const { t } = i18n;
    const auth = useSelector(state => state.auth);
    const settings = useSelector(state => state.settingsdata.settings); // Adicionar settings para verificar requisitos
    const dispatch = useDispatch(); // Descomentar dispatch

    const { profile } = auth;
    // Verificar se o FirebaseContext está disponível antes de usar
    let config = null;
    let firebaseInstance = null;
    try {
        if (FirebaseContext) {
            const context = useContext(FirebaseContext);
            config = context?.config;
            firebaseInstance = context?.firebase;
        }
    } catch (error) {
        Logger.warn('FirebaseContext não disponível:', error);
    }
    
    // Fallback para config e firebase se não estiverem disponíveis
    if (!config || !firebaseInstance) {
        try {
            const { firebase } = require('../../firebase');
            config = firebase?.config;
            firebaseInstance = firebase;
        } catch (error) {
            Logger.warn('Firebase não disponível:', error);
        }
        
        // Fallback final
        if (!config) {
            config = {
                projectId: "leaf-reactnative",
                appId: "1:106504629884:web:ada50a78fcf7bf3ea1a3f9",
                databaseURL: "https://leaf-reactnative-default-rtdb.firebaseio.com",
                storageBucket: "leaf-reactnative.firebasestorage.app",
                apiKey: "AIzaSyChYseG1IcmffYHHVYT7MqtLlzfdWKE_fc",
                authDomain: "leaf-reactnative.firebaseapp.com",
                messagingSenderId: "106504629884",
                measurementId: "G-22368DBCY9"
            };
        }
    }
    
    const firebase = firebaseInstance;

    const [loading, setLoading] = useState(false);
    const [documents, setDocuments] = useState({});
    const [userData, setUserData] = useState(null);
    const [showCamera, setShowCamera] = useState(false);
    const [cameraType, setCameraType] = useState(null); // 'cnh' ou 'selfie'

    useEffect(() => {
        checkAuth();
    }, []);

    const checkAuth = async () => {
        try {
            const storedUserData = await AsyncStorage.getItem('@user_data');
            if (storedUserData) {
                const data = JSON.parse(storedUserData);
                setUserData(data);
                Logger.log('[DriverDocumentsScreen] Dados do usuário carregados:', data);
            } else {
                Logger.log('[DriverDocumentsScreen] Nenhum dado de usuário encontrado');
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
            Logger.error('[DriverDocumentsScreen] Erro ao verificar autenticação:', error);
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
            // Para selfie, usar câmera com detecção facial
            if (documentType === 'selfie') {
                setCameraType('selfie');
                setShowCamera(true);
                return;
            }

            // Para CNH e CRLV, usar galeria normal
            const result = await ImagePicker.launchImageLibraryAsync({
                mediaTypes: ImagePicker.MediaTypeOptions.Images,
                allowsEditing: true,
                aspect: [4, 3],
                quality: 1,
            });

            if (!result.canceled) {
                const imageUri = result.assets[0].uri;
                
                // Processar imagem (detectar face se for CNH com foto)
                if (documentType === 'cnh') {
                    const processed = await faceDetectionService.processImage(imageUri);
                    if (processed.success) {
                        const newDocuments = { ...documents };
                        newDocuments[documentType] = processed.alignedUri;
                        setDocuments(newDocuments);
                    } else {
                        // Se processamento falhar, usar imagem original
                        const newDocuments = { ...documents };
                        newDocuments[documentType] = imageUri;
                        setDocuments(newDocuments);
                    }
                } else {
                    const newDocuments = { ...documents };
                    newDocuments[documentType] = imageUri;
                    setDocuments(newDocuments);
                }
            }
        } catch (error) {
            Logger.error('[DriverDocumentsScreen] Erro ao selecionar imagem:', error);
            Alert.alert(
                'Erro',
                'Ocorreu um erro ao selecionar a imagem. Por favor, tente novamente.'
            );
        }
    };

    const handleCameraCapture = async (imageUri) => {
        try {
            setShowCamera(false);
            
            // Processar imagem capturada
            const processed = await faceDetectionService.processImage(imageUri);
            
            if (processed.success) {
                const newDocuments = { ...documents };
                newDocuments[cameraType] = processed.alignedUri;
                setDocuments(newDocuments);
                Alert.alert('Sucesso', 'Foto capturada e processada com sucesso!');
            } else {
                // Se processamento falhar, usar imagem original
                const newDocuments = { ...documents };
                newDocuments[cameraType] = imageUri;
                setDocuments(newDocuments);
                Alert.alert('Aviso', 'Foto capturada, mas validação facial não foi possível.');
            }
        } catch (error) {
            Logger.error('[DriverDocumentsScreen] Erro ao processar foto:', error);
            Alert.alert('Erro', 'Erro ao processar a foto. Tente novamente.');
        } finally {
            setCameraType(null);
        }
    };

    const handleCameraCancel = () => {
        setShowCamera(false);
        setCameraType(null);
    };

    const persistKycOnboardingStatus = async (uid, kycStatus, kycPayload = {}) => {
        const kycData = {
            status: kycStatus,
            blocked: !!kycPayload.blocked,
            similarity: typeof kycPayload.similarity === 'number' ? kycPayload.similarity : null,
            needsReview: !!kycPayload.needsReview,
            approved: !!kycPayload.approved,
            message: kycPayload.message || null,
            updatedAt: new Date().toISOString()
        };

        try {
            if (firebase && typeof firebase.singleUserRef === 'function') {
                await firebase.singleUserRef(uid).update({
                    kycStatus,
                    kycOnboarding: kycData,
                    kycUpdatedAt: new Date().toISOString()
                });
            }
        } catch (error) {
            Logger.warn('[DriverDocumentsScreen] Falha ao persistir KYC no Firebase:', error);
        }

        try {
            const storedUserData = await AsyncStorage.getItem('@user_data');
            if (storedUserData) {
                const userData = JSON.parse(storedUserData);
                const updatedUserData = {
                    ...userData,
                    kycStatus,
                    kycOnboarding: kycData
                };
                await AsyncStorage.setItem('@user_data', JSON.stringify(updatedUserData));
            }
        } catch (error) {
            Logger.warn('[DriverDocumentsScreen] Falha ao persistir KYC no AsyncStorage:', error);
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

            const kycEnabled = await isKYCEnabled();
            if (kycEnabled) {
                const onboardingResult = await kycService.processOnboarding(
                    currentUserData.uid,
                    documents.cnh,
                    documents.selfie
                );

                if (!onboardingResult.success) {
                    await persistKycOnboardingStatus(currentUserData.uid, 'pending', {
                        approved: false,
                        needsReview: true,
                        blocked: true,
                        message: onboardingResult.error || 'Falha na validação KYC'
                    });
                    Alert.alert(
                        'Validação em revisão',
                        'Não foi possível concluir a validação automática agora. Seu cadastro ficou pendente para revisão manual.',
                        [
                            {
                                text: 'OK',
                                onPress: () => navigation.navigate('WaitList')
                            }
                        ]
                    );
                    return;
                }

                const kycData = onboardingResult.data || {};
                if (kycData.approved) {
                    await persistKycOnboardingStatus(currentUserData.uid, 'approved', kycData);
                    Alert.alert(
                        t('documents_success'),
                        t('documents_success_message'),
                        [
                            {
                                text: 'OK',
                                onPress: () => navigation.navigate('VehicleRegistration')
                            }
                        ]
                    );
                    return;
                }

                if (kycData.needsReview) {
                    await persistKycOnboardingStatus(currentUserData.uid, 'pending_review', kycData);
                    Alert.alert(
                        'Validação em revisão',
                        'Seu KYC foi enviado para revisão manual. Você será notificado quando for liberado.',
                        [
                            {
                                text: 'OK',
                                onPress: () => navigation.navigate('WaitList')
                            }
                        ]
                    );
                    return;
                }

                await persistKycOnboardingStatus(currentUserData.uid, 'rejected', kycData);
                Alert.alert(
                    'Validação não aprovada',
                    'A selfie não corresponde à foto da CNH. Refaça as fotos para continuar.'
                );
                return;
            }

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
            Logger.error('[DriverDocumentsScreen] Erro ao salvar documentos:', error);
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
        <>
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

        {/* Modal da câmera com detecção facial */}
        <Modal
            visible={showCamera}
            animationType="slide"
            onRequestClose={handleCameraCancel}
        >
            <KYCCameraScreen
                onCapture={handleCameraCapture}
                onCancel={handleCameraCancel}
                type={cameraType}
            />
        </Modal>
        </>
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
