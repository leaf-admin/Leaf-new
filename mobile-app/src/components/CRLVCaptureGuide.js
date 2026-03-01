import Logger from '../utils/Logger';
import React, { useState } from 'react';
import {
    View,
    Text,
    StyleSheet,
    Modal,
    TouchableOpacity,
    Image,
    ActivityIndicator,
    Alert,
    Dimensions,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import * as Camera from 'expo-camera';
import { OCRService } from '../services/OCRService';


const { width, height } = Dimensions.get('window');

/**
 * Componente de captura guiada de CRLV com OCR
 * 
 * Features:
 * - Moldura de documento
 * - Instruções claras
 * - OCR automático após captura
 * - Validação dos dados
 */
export default function CRLVCaptureGuide({ visible, onClose, onDataExtracted }) {
    const [capturing, setCapturing] = useState(false);
    const [processing, setProcessing] = useState(false);
    const [capturedImage, setCapturedImage] = useState(null);

    /**
     * Solicita permissão da câmera
     */
    const requestCameraPermission = async () => {
        const { status } = await ImagePicker.requestCameraPermissionsAsync();
        if (status !== 'granted') {
            Alert.alert(
                'Permissão necessária',
                'Precisamos de permissão para acessar a câmera para fotografar o CRLV.'
            );
            return false;
        }
        return true;
    };

    /**
     * Abre a câmera para capturar o documento
     */
    const captureDocument = async () => {
        const hasPermission = await requestCameraPermission();
        if (!hasPermission) return;

        setCapturing(true);
        
        try {
            const result = await ImagePicker.launchCameraAsync({
                mediaTypes: ImagePicker.MediaTypeOptions.Images,
                allowsEditing: true,
                aspect: [4, 3],
                quality: 0.9, // Alta qualidade para melhor OCR
            });

            if (!result.canceled && result.assets && result.assets.length > 0) {
                const image = result.assets[0];
                setCapturedImage(image.uri);
                
                // Processar OCR automaticamente
                await processOCR(image.uri);
            }
        } catch (error) {
            Logger.error('Erro ao capturar documento:', error);
            Alert.alert('Erro', 'Não foi possível capturar a imagem. Tente novamente.');
        } finally {
            setCapturing(false);
        }
    };

    /**
     * Seleciona imagem da galeria
     */
    const pickFromGallery = async () => {
        const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (status !== 'granted') {
            Alert.alert(
                'Permissão necessária',
                'Precisamos de permissão para acessar sua galeria.'
            );
            return;
        }

        try {
            const result = await ImagePicker.launchImageLibraryAsync({
                mediaTypes: ImagePicker.MediaTypeOptions.Images,
                allowsEditing: true,
                aspect: [4, 3],
                quality: 0.9,
            });

            if (!result.canceled && result.assets && result.assets.length > 0) {
                const image = result.assets[0];
                setCapturedImage(image.uri);
                
                // Processar OCR automaticamente
                await processOCR(image.uri);
            }
        } catch (error) {
            Logger.error('Erro ao selecionar imagem:', error);
            Alert.alert('Erro', 'Não foi possível selecionar a imagem. Tente novamente.');
        }
    };

    /**
     * Processa OCR da imagem capturada
     */
    const processOCR = async (imageUri) => {
        setProcessing(true);
        
        try {
            Logger.log('🔍 Processando OCR...');
            
            const result = await OCRService.processCRLVImage(imageUri);
            
            if (!result.success) {
                Alert.alert(
                    'Erro no processamento',
                    result.error || 'Não foi possível ler o documento. Certifique-se de que:\n\n' +
                    '• O documento está bem iluminado\n' +
                    '• A foto está nítida e completa\n' +
                    '• O texto está legível\n\n' +
                    'Tente capturar novamente.'
                );
                setCapturedImage(null);
                return;
            }

            const { data, validation } = result;

            // Verificar se os dados são válidos
            if (!validation.isValid) {
                Alert.alert(
                    'Dados incompletos',
                    'Alguns dados não foram encontrados no documento:\n\n' +
                    validation.errors.join('\n') +
                    '\n\nDeseja usar os dados encontrados mesmo assim?',
                    [
                        {
                            text: 'Tentar novamente',
                            style: 'cancel',
                            onPress: () => setCapturedImage(null),
                        },
                        {
                            text: 'Usar dados encontrados',
                            onPress: () => handleDataExtracted(data, imageUri),
                        },
                    ]
                );
                return;
            }

            // Dados válidos - usar diretamente
            handleDataExtracted(data, imageUri);
            
        } catch (error) {
            Logger.error('Erro no OCR:', error);
            Alert.alert('Erro', 'Erro ao processar o documento. Tente novamente.');
            setCapturedImage(null);
        } finally {
            setProcessing(false);
        }
    };

    /**
     * Chama callback com dados extraídos
     */
    const handleDataExtracted = (data, imageUri) => {
        if (onDataExtracted) {
            onDataExtracted({
                ...data,
                imageUri, // URI da imagem para upload posterior
            });
        }
        handleClose();
    };

    /**
     * Fecha o modal e reseta estado
     */
    const handleClose = () => {
        setCapturedImage(null);
        setProcessing(false);
        onClose();
    };

    /**
     * Tenta processar OCR novamente
     */
    const retryOCR = () => {
        if (capturedImage) {
            processOCR(capturedImage);
        }
    };

    return (
        <Modal
            visible={visible}
            animationType="slide"
            transparent={true}
            onRequestClose={handleClose}
        >
            <View style={styles.container}>
                <View style={styles.content}>
                    {/* Header */}
                    <View style={styles.header}>
                        <Text style={styles.title}>Capturar CRLV</Text>
                        <TouchableOpacity onPress={handleClose} style={styles.closeButton}>
                            <Ionicons name="close" size={28} color="#333" />
                        </TouchableOpacity>
                    </View>

                    {/* Instruções */}
                    <View style={styles.instructionsContainer}>
                        <Text style={styles.instructionsTitle}>📋 Instruções:</Text>
                        <Text style={styles.instructionsText}>
                            • Posicione o documento em uma superfície plana{'\n'}
                            • Certifique-se de que está bem iluminado{'\n'}
                            • Mantenha a câmera paralela ao documento{'\n'}
                            • O documento deve estar completo na foto{'\n'}
                            • Aguarde o processamento automático
                        </Text>
                    </View>

                    {/* Preview da imagem capturada */}
                    {capturedImage && (
                        <View style={styles.previewContainer}>
                            <Image source={{ uri: capturedImage }} style={styles.previewImage} />
                            {processing && (
                                <View style={styles.processingOverlay}>
                                    <ActivityIndicator size="large" color="#1A330E" />
                                    <Text style={styles.processingText}>Processando documento...</Text>
                                </View>
                            )}
                        </View>
                    )}

                    {/* Botões de ação */}
                    <View style={styles.actionsContainer}>
                        {!capturedImage ? (
                            <>
                                <TouchableOpacity
                                    style={[styles.button, styles.captureButton]}
                                    onPress={captureDocument}
                                    disabled={capturing}
                                >
                                    {capturing ? (
                                        <ActivityIndicator color="#fff" />
                                    ) : (
                                        <>
                                            <Ionicons name="camera" size={24} color="#fff" />
                                            <Text style={styles.buttonText}>Tirar Foto</Text>
                                        </>
                                    )}
                                </TouchableOpacity>

                                <TouchableOpacity
                                    style={[styles.button, styles.galleryButton]}
                                    onPress={pickFromGallery}
                                >
                                    <Ionicons name="images" size={24} color="#1A330E" />
                                    <Text style={[styles.buttonText, styles.galleryButtonText]}>
                                        Escolher da Galeria
                                    </Text>
                                </TouchableOpacity>
                            </>
                        ) : (
                            <>
                                {!processing && (
                                    <>
                                        <TouchableOpacity
                                            style={[styles.button, styles.retryButton]}
                                            onPress={retryOCR}
                                        >
                                            <Ionicons name="refresh" size={24} color="#1A330E" />
                                            <Text style={[styles.buttonText, styles.retryButtonText]}>
                                                Processar Novamente
                                            </Text>
                                        </TouchableOpacity>

                                        <TouchableOpacity
                                            style={[styles.button, styles.cancelButton]}
                                            onPress={() => setCapturedImage(null)}
                                        >
                                            <Text style={[styles.buttonText, styles.cancelButtonText]}>
                                                Capturar Outra Foto
                                            </Text>
                                        </TouchableOpacity>
                                    </>
                                )}
                            </>
                        )}
                    </View>
                </View>
            </View>
        </Modal>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: 'rgba(0, 0, 0, 0.7)',
        justifyContent: 'center',
        alignItems: 'center',
    },
    content: {
        width: width * 0.9,
        maxHeight: height * 0.85,
        backgroundColor: '#fff',
        borderRadius: 20,
        padding: 20,
    },
    header: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 20,
    },
    title: {
        fontSize: 24,
        fontWeight: 'bold',
        color: '#1A330E',
    },
    closeButton: {
        padding: 5,
    },
    instructionsContainer: {
        backgroundColor: '#f5f5f5',
        padding: 15,
        borderRadius: 10,
        marginBottom: 20,
    },
    instructionsTitle: {
        fontSize: 16,
        fontWeight: 'bold',
        color: '#333',
        marginBottom: 8,
    },
    instructionsText: {
        fontSize: 14,
        color: '#666',
        lineHeight: 20,
    },
    previewContainer: {
        width: '100%',
        height: 300,
        borderRadius: 10,
        overflow: 'hidden',
        marginBottom: 20,
        backgroundColor: '#f0f0f0',
        position: 'relative',
    },
    previewImage: {
        width: '100%',
        height: '100%',
        resizeMode: 'contain',
    },
    processingOverlay: {
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.7)',
        justifyContent: 'center',
        alignItems: 'center',
    },
    processingText: {
        color: '#fff',
        marginTop: 10,
        fontSize: 16,
        fontWeight: '600',
    },
    actionsContainer: {
        gap: 12,
    },
    button: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 16,
        borderRadius: 10,
        gap: 8,
    },
    captureButton: {
        backgroundColor: '#1A330E',
    },
    galleryButton: {
        backgroundColor: '#f0f0f0',
        borderWidth: 2,
        borderColor: '#1A330E',
    },
    retryButton: {
        backgroundColor: '#f0f0f0',
        borderWidth: 2,
        borderColor: '#1A330E',
    },
    cancelButton: {
        backgroundColor: 'transparent',
        borderWidth: 1,
        borderColor: '#ccc',
    },
    buttonText: {
        fontSize: 16,
        fontWeight: '600',
        color: '#fff',
    },
    galleryButtonText: {
        color: '#1A330E',
    },
    retryButtonText: {
        color: '#1A330E',
    },
    cancelButtonText: {
        color: '#666',
    },
});

