import Logger from './Logger';
import * as FileSystem from 'expo-file-system';


/**
 * Utilitário para extrair texto de PDF
 * 
 * Nota: Em React Native, não podemos extrair texto diretamente do PDF
 * O processamento deve ser feito no backend ou usando uma biblioteca nativa
 * 
 * Por enquanto, esta função prepara o PDF para envio ao backend
 */

/**
 * Prepara PDF para processamento no backend
 * 
 * @param {string} pdfUri - URI do PDF
 * @returns {Promise<Object>} Dados do PDF preparados
 */
export async function preparePDFForProcessing(pdfUri) {
    try {
        // Ler informações do arquivo
        const fileInfo = await FileSystem.getInfoAsync(pdfUri);
        
        if (!fileInfo.exists) {
            throw new Error('Arquivo PDF não encontrado');
        }

        return {
            uri: pdfUri,
            size: fileInfo.size,
            exists: true,
        };
    } catch (error) {
        Logger.error('Erro ao preparar PDF:', error);
        throw error;
    }
}

/**
 * Envia PDF para backend processar
 * 
 * @param {string} pdfUri - URI do PDF
 * @param {string} apiEndpoint - Endpoint da API para processar PDF
 * @returns {Promise<Object>} Dados extraídos pelo backend
 */
export async function processPDFOnBackend(pdfUri, apiEndpoint) {
    try {
        // Criar FormData para upload
        const formData = new FormData();
        formData.append('pdf', {
            uri: pdfUri,
            type: 'application/pdf',
            name: 'crlv.pdf',
        });

        // Enviar para backend
        const response = await fetch(apiEndpoint, {
            method: 'POST',
            body: formData,
            headers: {
                'Content-Type': 'multipart/form-data',
            },
        });

        if (!response.ok) {
            throw new Error(`Erro ao processar PDF: ${response.statusText}`);
        }

        const result = await response.json();
        return result;
    } catch (error) {
        Logger.error('Erro ao processar PDF no backend:', error);
        throw error;
    }
}

