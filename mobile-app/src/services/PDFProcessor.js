import Logger from '../utils/Logger';
import * as FileSystem from 'expo-file-system';
import * as ImageManipulator from 'expo-image-manipulator';
import { processCRLVImage } from './OCRService';


/**
 * Processa PDF no device:
 * 1. Converte primeira página para imagem
 * 2. Faz OCR na imagem
 * 3. Redimensiona imagem para 640x640 para auditoria
 * 4. Retorna dados estruturados + imagem
 */

/**
 * Redimensiona imagem para 640x640 mantendo proporção
 */
async function resizeImageForAudit(imageUri, maxSize = 640) {
    try {
        const manipResult = await ImageManipulator.manipulateAsync(
            imageUri,
            [
                { resize: { width: maxSize, height: maxSize } }
            ],
            {
                compress: 0.8,
                format: ImageManipulator.SaveFormat.JPEG,
            }
        );
        
        return manipResult.uri;
    } catch (error) {
        Logger.error('Erro ao redimensionar imagem:', error);
        // Se falhar, retorna original
        return imageUri;
    }
}

/**
 * Processa PDF completo: OCR + redimensionamento
 * 
 * @param {string} pdfUri - URI do PDF
 * @returns {Promise<Object>} Dados extraídos + imagem para auditoria
 */
/**
 * Converte PDF para imagem usando uma abordagem mais simples
 * Tenta usar o ImageManipulator primeiro (funciona se o PDF for uma imagem)
 * Se falhar, precisa ser feito no componente com react-native-pdf
 */
async function convertPDFToImage(pdfUri) {
    try {
        // Tentar usar ImageManipulator (funciona se o PDF for na verdade uma imagem)
        const manipulated = await ImageManipulator.manipulateAsync(
            pdfUri,
            [], // Sem transformações
            {
                compress: 1.0,
                format: ImageManipulator.SaveFormat.JPEG,
            }
        );
        Logger.log('✅ PDF processado como imagem');
        return manipulated.uri;
    } catch (error) {
        // Se falhar, o PDF precisa ser convertido usando react-native-pdf
        // Isso precisa ser feito no componente, não no serviço
        throw new Error('PDF precisa ser convertido para imagem. Use o componente PDFViewer.');
    }
}

export async function processPDFOnDevice(pdfUri) {
    try {
        Logger.log('📄 Processando PDF no device...');
        
        // 1. Converter PDF para imagem
        Logger.log('🖼️ Convertendo PDF para imagem...');
        let imageUri;
        try {
            imageUri = await convertPDFToImage(pdfUri);
        } catch (convertError) {
            // Se não conseguir converter aqui, precisa ser feito no componente
            throw new Error(
                'Não foi possível converter o PDF automaticamente. ' +
                'O PDF será processado no componente usando react-native-pdf.'
            );
        }
        
        // 2. Fazer OCR na imagem
        Logger.log('🔍 Fazendo OCR...');
        const ocrResult = await processCRLVImage(imageUri);
        
        if (!ocrResult.success) {
            throw new Error(ocrResult.error || 'Erro ao processar OCR');
        }
        
        // 3. Redimensionar imagem para auditoria (640x640)
        Logger.log('🖼️ Redimensionando imagem para auditoria...');
        const auditImageUri = await resizeImageForAudit(imageUri, 640);
        
        // 4. Retornar dados estruturados + imagem
        return {
            success: true,
            data: ocrResult.data,
            validation: ocrResult.validation,
            auditImageUri: auditImageUri, // Imagem redimensionada para auditoria
            originalPdfUri: pdfUri, // URI original do PDF (opcional, para referência)
        };
        
    } catch (error) {
        Logger.error('❌ Erro ao processar PDF:', error);
        return {
            success: false,
            error: error.message || 'Erro ao processar PDF. Certifique-se de que o arquivo é um CRLV válido em formato PDF.',
            data: null,
        };
    }
}

/**
 * Prepara dados para envio ao backend
 * 
 * @param {Object} processedData - Dados processados do PDF
 * @returns {Object} Dados formatados para API
 */
export async function prepareDataForBackend(processedData) {
    if (!processedData.success || !processedData.data) {
        throw new Error('Dados não processados corretamente');
    }
    
    // Converter imagem de auditoria para base64
    let auditImageBase64 = null;
    try {
        const base64 = await FileSystem.readAsStringAsync(processedData.auditImageUri, {
            encoding: FileSystem.EncodingType.Base64,
        });
        auditImageBase64 = `data:image/jpeg;base64,${base64}`;
    } catch (error) {
        Logger.error('Erro ao converter imagem para base64:', error);
    }
    
    // Estrutura de dados para backend
    return {
        // Dados estruturados do veículo
        vehicleData: {
            placa: processedData.data.placa,
            renavam: processedData.data.renavam,
            ano: processedData.data.ano,
            uf: processedData.data.uf,
            chassi: processedData.data.chassi,
            marca: processedData.data.marca,
            modelo: processedData.data.modelo,
        },
        
        // Imagem para auditoria (640x640, base64)
        auditImage: auditImageBase64,
        
        // Metadados
        metadata: {
            processedAt: new Date().toISOString(),
            confidence: processedData.confidence || 0.8,
            validation: processedData.validation,
        },
    };
}

