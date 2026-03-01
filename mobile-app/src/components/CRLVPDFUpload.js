import Logger from '../utils/Logger';
import React, { useState, useRef } from 'react';
import {
    View,
    Text,
    StyleSheet,
    Modal,
    TouchableOpacity,
    ActivityIndicator,
    Alert,
    Dimensions,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system';
import Pdf from 'react-native-pdf';
import { captureRef } from 'react-native-view-shot';
import { processCRLVImage, processCRLVText, extractTextFromPDF } from '../services/OCRService';
import * as ImageManipulator from 'expo-image-manipulator';
import OCRConfirmationModal from './OCRConfirmationModal';


const { width, height } = Dimensions.get('window');

/**
 * Componente de upload de PDF do CRLV-e com OCR
 * 
 * IMPORTANTE: APENAS PDF DO CRLV-e (Certificado de Registro e Licenciamento de Veículo - Digital)
 * 
 * Features:
 * - Upload APENAS de PDF
 * - OCR automático após upload
 * - Validação dos dados
 * - Redimensionamento de imagem para auditoria (640x640)
 */
export default function CRLVPDFUpload({ visible, onClose, onDataExtracted }) {
    const [processing, setProcessing] = useState(false);
    const [selectedPDF, setSelectedPDF] = useState(null);
    const pdfViewRef = useRef(null);
    const [pdfLoaded, setPdfLoaded] = useState(false);
    const [showConfirmation, setShowConfirmation] = useState(false);
    const [extractedData, setExtractedData] = useState(null);

    /**
     * Seleciona PDF do dispositivo
     */
    const pickPDF = async () => {
        try {
            const result = await DocumentPicker.getDocumentAsync({
                type: 'application/pdf',
                copyToCacheDirectory: true,
                multiple: false,
            });

            if (!result.canceled && result.assets && result.assets.length > 0) {
                const selectedFile = result.assets[0];
                
                // Verificar se é realmente um PDF
                if (selectedFile.mimeType !== 'application/pdf' && !selectedFile.name.toLowerCase().endsWith('.pdf')) {
                    Alert.alert('Formato inválido', 'Por favor, selecione apenas arquivos PDF do CRLV eletrônico.');
                    return;
                }

                setSelectedPDF(selectedFile);
                
                // Processar OCR automaticamente
                await processPDFOCR(selectedFile.uri);
            }
        } catch (error) {
            Logger.error('Erro ao selecionar PDF:', error);
            Alert.alert('Erro', 'Não foi possível selecionar o PDF. Tente novamente.');
        }
    };

    /**
     * Converte PDF para imagem usando react-native-pdf e react-native-view-shot
     */
    const convertPDFToImage = async (pdfUri) => {
        return new Promise((resolve, reject) => {
            // Aguardar um pouco para garantir que o PDF foi renderizado
            setTimeout(async () => {
                try {
                    if (!pdfViewRef.current) {
                        throw new Error('PDF não foi renderizado');
                    }
                    
                    // Capturar a primeira página como imagem
                    const imageUri = await captureRef(pdfViewRef, {
                        format: 'jpg',
                        quality: 0.9,
                        result: 'tmpfile',
                    });
                    
                    Logger.log('✅ PDF convertido para imagem:', imageUri);
                    resolve(imageUri);
                } catch (error) {
                    Logger.error('❌ Erro ao capturar PDF:', error);
                    reject(error);
                }
            }, 2000); // Aguardar 2 segundos para renderização completa
        });
    };

    /**
     * Processa PDF: extrai texto via backend (pdf-parse) e processa no mobile
     */
    const processPDFOCR = async (pdfUri) => {
        setProcessing(true);
        setPdfLoaded(false);
        
        try {
            Logger.log('📄 Processando PDF...');
            
            // 1. Extrair texto do PDF via backend (pdf-parse)
            Logger.log('📤 Enviando PDF ao backend para extrair texto...');
            const text = await extractTextFromPDF(pdfUri);
            
            // 2. Processar texto no mobile (regex extraction)
            Logger.log('🔍 Processando texto extraído...');
            const ocrResult = await processCRLVText(text);
            
            if (!ocrResult.success) {
                throw new Error(ocrResult.error || 'Erro ao processar texto');
            }
            
            // 3. Converter PDF para imagem para auditoria (640x640)
            Logger.log('🖼️ Gerando imagem para auditoria...');
            // Renderizar PDF para capturar imagem
            setPdfLoaded(true);
            // A imagem será capturada quando o PDF carregar
            
            // Preparar dados (imagem será adicionada depois)
            const extractedData = {
                ...ocrResult.data,
                pdfUri: pdfUri,
                auditImageUri: null, // Será preenchido após captura
                fileName: selectedPDF?.name || 'crlv.pdf',
                validation: ocrResult.validation,
            };
            
            // Guardar dados temporariamente para adicionar imagem depois
            setExtractedData(extractedData);
            
        } catch (error) {
            Logger.error('Erro no processamento:', error);
            Alert.alert(
                'Erro ao processar PDF',
                error.message || 'Não foi possível processar o documento. Certifique-se de que:\n\n' +
                '• O PDF está legível\n' +
                '• O documento é um CRLV válido\n' +
                '• A conexão está estável\n\n' +
                'Tente novamente.'
            );
            setSelectedPDF(null);
            setProcessing(false);
        }
    };

    /**
     * Processa PDF quando renderizado (apenas para capturar imagem de auditoria)
     */
    const handlePDFLoadComplete = async (numberOfPages, pdfUri) => {
        if (!pdfLoaded || !extractedData) return;
        
        try {
            Logger.log(`📄 PDF carregado para captura de imagem: ${numberOfPages} páginas`);
            
            // Aguardar renderização completa
            await new Promise(resolve => setTimeout(resolve, 1000));
            
            // Capturar primeira página como imagem para auditoria
            const imageUri = await captureRef(pdfViewRef, {
                format: 'jpg',
                quality: 0.9,
                result: 'tmpfile',
            });
            
            Logger.log('✅ Imagem capturada para auditoria');
            
            // Redimensionar para 640x640
            const auditManipulated = await ImageManipulator.manipulateAsync(
                imageUri,
                [{ resize: { width: 640, height: 640 } }],
                {
                    compress: 0.8,
                    format: ImageManipulator.SaveFormat.JPEG,
                }
            );
            
            // Adicionar imagem de auditoria aos dados extraídos
            const finalData = {
                ...extractedData,
                auditImageUri: auditManipulated.uri,
            };
            
            // Mostrar modal de confirmação (SEM edição)
            setExtractedData(finalData);
            setShowConfirmation(true);
            setPdfLoaded(false);
            setProcessing(false);
            
        } catch (error) {
            Logger.error('Erro ao capturar imagem para auditoria:', error);
            // Mesmo sem imagem, mostrar dados extraídos
            setShowConfirmation(true);
            setPdfLoaded(false);
            setProcessing(false);
        }
    };

    /**
     * Chama callback com dados extraídos
     */
    const handleDataExtracted = (data) => {
        if (onDataExtracted) {
            onDataExtracted(data);
        }
        handleClose();
    };

    /**
     * Confirma dados extraídos (aprovado pelo usuário)
     */
    const handleConfirmData = (data) => {
        setShowConfirmation(false);
        handleDataExtracted(data);
    };

    /**
     * Rejeita dados extraídos (usuário quer tentar novamente)
     */
    const handleRejectData = () => {
        setShowConfirmation(false);
        setExtractedData(null);
        setSelectedPDF(null);
        setProcessing(false);
    };

    /**
     * Fecha o modal e reseta estado
     */
    const handleClose = () => {
        setSelectedPDF(null);
        setProcessing(false);
        setShowConfirmation(false);
        setExtractedData(null);
        onClose();
    };

    /**
     * Tenta processar novamente
     */
    const retryProcessing = () => {
        if (selectedPDF) {
            processPDFOCR(selectedPDF.uri);
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
                        <Text style={styles.title}>Upload CRLV-e (PDF)</Text>
                        <TouchableOpacity onPress={handleClose} style={styles.closeButton}>
                            <Ionicons name="close" size={28} color="#333" />
                        </TouchableOpacity>
                    </View>

                    {/* Instruções */}
                    <View style={styles.instructionsContainer}>
                        <Text style={styles.instructionsTitle}>📋 Instruções:</Text>
                        <Text style={styles.instructionsText}>
                            • Selecione o arquivo PDF do CRLV-e (Certificado de Registro e Licenciamento de Veículo - Digital){'\n'}
                            • Apenas arquivos PDF são aceitos{'\n'}
                            • O arquivo será processado automaticamente{'\n'}
                            • Os dados do veículo serão extraídos automaticamente{'\n'}
                            • O processamento pode levar alguns segundos
                        </Text>
                        <View style={styles.warningContainer}>
                            <Ionicons name="warning" size={16} color="#FF6B00" />
                            <Text style={styles.warningText}>
                                Apenas PDF do CRLV-e digital é aceito
                            </Text>
                        </View>
                    </View>

                    {/* Status do arquivo selecionado */}
                    {selectedPDF && (
                        <View style={styles.fileInfoContainer}>
                            <Ionicons name="document-text" size={24} color="#1A330E" />
                            <View style={styles.fileInfo}>
                                <Text style={styles.fileName} numberOfLines={1}>
                                    {selectedPDF.name}
                                </Text>
                                <Text style={styles.fileSize}>
                                    {(selectedPDF.size / 1024).toFixed(2)} KB
                                </Text>
                            </View>
                        </View>
                    )}

                    {/* Indicador de processamento */}
                    {processing && (
                        <View style={styles.processingContainer}>
                            <ActivityIndicator size="large" color="#1A330E" />
                            <Text style={styles.processingText}>
                                Processando documento...
                            </Text>
                        </View>
                    )}

                    {/* Botões de ação */}
                    <View style={styles.actionsContainer}>
                        {!selectedPDF ? (
                            <TouchableOpacity
                                style={[styles.button, styles.uploadButton]}
                                onPress={pickPDF}
                                disabled={processing}
                            >
                                <Ionicons name="document-attach" size={24} color="#fff" />
                                <Text style={styles.buttonText}>Selecionar PDF</Text>
                            </TouchableOpacity>
                        ) : (
                            <>
                                {!processing && (
                                    <>
                                        <TouchableOpacity
                                            style={[styles.button, styles.retryButton]}
                                            onPress={retryProcessing}
                                        >
                                            <Ionicons name="refresh" size={24} color="#1A330E" />
                                            <Text style={[styles.buttonText, styles.retryButtonText]}>
                                                Processar Novamente
                                            </Text>
                                        </TouchableOpacity>

                                        <TouchableOpacity
                                            style={[styles.button, styles.cancelButton]}
                                            onPress={() => setSelectedPDF(null)}
                                        >
                                            <Text style={[styles.buttonText, styles.cancelButtonText]}>
                                                Selecionar Outro PDF
                                            </Text>
                                        </TouchableOpacity>
                                    </>
                                )}
                            </>
                        )}
                    </View>
                </View>
            </View>
            
            {/* PDF Viewer invisível para conversão */}
            {pdfLoaded && selectedPDF && (
                <View 
                    ref={pdfViewRef}
                    style={{ 
                        position: 'absolute', 
                        width: width * 2, 
                        height: height * 2,
                        opacity: 0,
                        pointerEvents: 'none',
                        top: -height * 2,
                        left: -width * 2,
                    }}
                    collapsable={false}
                >
                    <Pdf
                        source={{ uri: selectedPDF.uri, cache: true }}
                        page={1}
                        scale={3.0}
                        horizontal={false}
                        enablePaging={false}
                        fitPolicy={0}
                        style={{ flex: 1, width: width * 2, height: height * 2 }}
                        onLoadComplete={(numberOfPages) => {
                            handlePDFLoadComplete(numberOfPages, selectedPDF.uri);
                        }}
                        onError={(error) => {
                            Logger.error('Erro ao carregar PDF:', error);
                            Alert.alert('Erro', 'Não foi possível carregar o PDF.');
                            setPdfLoaded(false);
                            setProcessing(false);
                        }}
                    />
                </View>
            )}

            {/* Modal de confirmação dos dados extraídos */}
            <OCRConfirmationModal
                visible={showConfirmation}
                onClose={handleRejectData}
                onConfirm={handleConfirmData}
                extractedData={extractedData}
            />
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
    fileInfoContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#f0f0f0',
        padding: 15,
        borderRadius: 10,
        marginBottom: 20,
        gap: 12,
    },
    fileInfo: {
        flex: 1,
    },
    fileName: {
        fontSize: 14,
        fontWeight: '600',
        color: '#333',
        marginBottom: 4,
    },
    fileSize: {
        fontSize: 12,
        color: '#666',
    },
    processingContainer: {
        alignItems: 'center',
        padding: 20,
        marginBottom: 20,
    },
    processingText: {
        marginTop: 10,
        fontSize: 16,
        fontWeight: '600',
        color: '#1A330E',
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
    uploadButton: {
        backgroundColor: '#1A330E',
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
    retryButtonText: {
        color: '#1A330E',
    },
    cancelButtonText: {
        color: '#666',
    },
    warningContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        marginTop: 12,
        padding: 10,
        backgroundColor: '#fff3e0',
        borderRadius: 8,
        borderWidth: 1,
        borderColor: '#FF6B00',
    },
    warningText: {
        fontSize: 13,
        color: '#FF6B00',
        fontWeight: '600',
        flex: 1,
    },
});

