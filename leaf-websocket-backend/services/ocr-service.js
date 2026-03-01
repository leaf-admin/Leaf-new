/**
 * Serviço de OCR para extração de dados de documentos
 * Suporta CNH e CRLV (documento do veículo)
 */

const { logger } = require('../utils/logger');

class OCRService {
  constructor() {
    this.visionClient = null;
    this.initialized = false;
    this.initialize();
  }

  async initialize() {
    try {
      // Tentar usar Google Vision API se disponível
      if (process.env.GOOGLE_APPLICATION_CREDENTIALS || process.env.GOOGLE_VISION_API_KEY) {
        try {
          const vision = require('@google-cloud/vision');
          this.visionClient = new vision.ImageAnnotatorClient();
          this.initialized = true;
          logger.info('✅ OCR Service inicializado com Google Vision API');
        } catch (visionError) {
          logger.warn('⚠️ Google Vision API não disponível, usando Tesseract.js como fallback:', visionError.message);
          this.initialized = true;
        }
      } else {
        // Fallback: usar Tesseract.js (open source)
        logger.info('ℹ️ Usando Tesseract.js para OCR (Google Vision API não configurada)');
        this.initialized = true;
      }
    } catch (error) {
      logger.error('❌ Erro ao inicializar OCR Service:', error);
      // Mesmo com erro, permitir usar Tesseract como fallback
      this.initialized = true;
    }
  }

  /**
   * Extrai texto diretamente de PDF (se tiver texto extraível)
   * @param {Buffer} pdfBuffer - Buffer do PDF
   * @returns {Promise<string|null>} Texto extraído ou null se não tiver texto
   */
  async extractTextFromPDF(pdfBuffer) {
    try {
      // Tentar usar pdf-parse para extrair texto diretamente
      const pdfParse = require('pdf-parse');
      const data = await pdfParse(pdfBuffer);
      
      if (data && data.text && data.text.trim().length > 0) {
        logger.info('✅ Texto extraído diretamente do PDF (sem OCR)');
        return data.text;
      }
      
      return null;
    } catch (error) {
      logger.warn('⚠️ Não foi possível extrair texto diretamente do PDF:', error.message);
      return null;
    }
  }

  /**
   * Extrai texto de uma imagem ou PDF usando OCR
   * @param {Buffer} fileBuffer - Buffer da imagem ou PDF
   * @param {string} mimeType - Tipo MIME do arquivo (opcional)
   * @returns {Promise<string>} Texto extraído
   */
  async extractText(fileBuffer, mimeType = null) {
    try {
      // Detectar se é PDF (pelos primeiros bytes)
      const isPDF = fileBuffer.slice(0, 4).toString() === '%PDF' || 
                    (mimeType && mimeType === 'application/pdf');

      if (isPDF) {
        // Primeiro, tentar extrair texto diretamente do PDF (sem OCR)
        // Isso funciona para PDFs com texto extraível (não escaneados)
        const directText = await this.extractTextFromPDF(fileBuffer);
        // Para CNH digital, mesmo que tenha algum texto, geralmente é pouco
        // Vamos usar OCR se o texto extraído for menor que 500 caracteres
        // (CNH digital tem muito mais texto quando processada com OCR)
        if (directText && directText.trim().length > 500) {
          // Se extraiu texto suficiente, usar ele
          logger.info('📄 Usando texto extraído diretamente do PDF');
          return directText;
        }
        
        // Se não extraiu texto suficiente, é PDF escaneado/imagem - precisa de OCR
        logger.info('📄 PDF escaneado/imagem detectado, usando OCR...');
      }

      if (this.visionClient) {
        // Google Vision API suporta PDF diretamente
        if (isPDF) {
          logger.info('📄 Processando PDF com Google Vision API...');
          const [result] = await this.visionClient.textDetection({
            image: { content: fileBuffer },
            imageContext: {
              // Configurações para PDF
            }
          });

          const detections = result.textAnnotations;
          if (detections && detections.length > 0) {
            return detections[0].description || '';
          }
          return '';
        } else {
          // Imagem normal
          const [result] = await this.visionClient.textDetection({
            image: { content: fileBuffer }
          });

          const detections = result.textAnnotations;
          if (detections && detections.length > 0) {
            return detections[0].description || '';
          }
          return '';
        }
      } else {
        // Tesseract.js não suporta PDF diretamente, precisa converter
        if (isPDF) {
          logger.info('📄 Convertendo PDF para imagem para OCR (PDF escaneado detectado)...');
          // Converter PDF para imagem com melhor qualidade
          let imageBuffer = await this.convertPDFToImage(fileBuffer);
          
          // Pré-processar imagem para melhorar qualidade do OCR
          imageBuffer = await this.preprocessImage(imageBuffer);
          
          const Tesseract = require('tesseract.js');
          // Usar configurações otimizadas para documentos
          const { data: { text } } = await Tesseract.recognize(imageBuffer, 'por', {
            logger: m => {
              if (m.status === 'recognizing text') {
                logger.debug(`OCR Progress: ${Math.round(m.progress * 100)}%`);
              }
            },
            // Configurações otimizadas para documentos estruturados (CNH, CRLV)
            tessedit_pageseg_mode: '6', // Assume uniform block of text
            tessedit_ocr_engine_mode: '1', // LSTM engine (mais preciso)
            // Não usar whitelist muito restritiva - pode perder informações
            // tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789.,/-:() ',
          });
          return text;
        } else {
          // Imagem normal - pré-processar antes do OCR
          const processedImage = await this.preprocessImage(fileBuffer);
          const Tesseract = require('tesseract.js');
          const { data: { text } } = await Tesseract.recognize(processedImage, 'por', {
            logger: m => {
              if (m.status === 'recognizing text') {
                logger.debug(`OCR Progress: ${Math.round(m.progress * 100)}%`);
              }
            },
            tessedit_pageseg_mode: '6', // Assume uniform block of text
          });
          return text;
        }
      }
    } catch (error) {
      logger.error('❌ Erro ao extrair texto:', error);
      throw new Error(`Falha ao processar OCR: ${error.message}`);
    }
  }

  /**
   * Pré-processa imagem para melhorar qualidade do OCR
   * Usa técnicas similares ao OpenCV para otimizar a imagem
   * @param {Buffer} imageBuffer - Buffer da imagem
   * @returns {Promise<Buffer>} Buffer da imagem processada
   */
  async preprocessImage(imageBuffer) {
    try {
      const sharp = require('sharp');
      
      // Aplicar melhorias na imagem para OCR (técnicas similares ao OpenCV):
      // 1. Converter para escala de cinza (melhor para OCR)
      // 2. Aumentar contraste e brilho
      // 3. Aplicar sharpening (nitidez) - similar ao filtro Laplacian do OpenCV
      // 4. Aplicar threshold adaptativo (binarização) para destacar texto
      // 5. Redimensionar se necessário para melhor resolução
      
      const metadata = await sharp(imageBuffer).metadata();
      const minDimension = Math.min(metadata.width || 0, metadata.height || 0);
      
      let pipeline = sharp(imageBuffer);
      
      // Se a imagem for muito pequena, aumentar resolução
      if (minDimension < 1500) {
        const scale = Math.ceil(1500 / minDimension);
        pipeline = pipeline.resize({
          width: (metadata.width || 0) * scale,
          height: (metadata.height || 0) * scale,
          kernel: 'lanczos3' // Melhor qualidade de redimensionamento
        });
        logger.info(`📐 Imagem redimensionada para melhor resolução (${scale}x)`);
      }
      
      // Aplicar processamento
      const processed = await pipeline
        .greyscale() // Converter para escala de cinza (OCR funciona melhor)
        .normalize() // Normalizar brilho e contraste
        .sharpen({ sigma: 1.5, m1: 1, m2: 2, x1: 2, y2: 10, y3: 20 }) // Sharpening avançado
        .linear(1.3, -(128 * 0.3)) // Aumentar contraste (1.3x) - similar a equalizeHist do OpenCV
        .modulate({ brightness: 1.1, saturation: 0 }) // Aumentar brilho levemente
        .png({ quality: 100, compressionLevel: 0 }) // Máxima qualidade
        .toBuffer();
      
      logger.info('✅ Imagem pré-processada para OCR (técnicas OpenCV-like aplicadas)');
      return processed;
    } catch (error) {
      logger.warn('⚠️ Erro no pré-processamento, usando imagem original:', error.message);
      return imageBuffer; // Retornar original se falhar
    }
  }

  /**
   * Converte PDF para imagem (para uso com Tesseract)
   * @param {Buffer} pdfBuffer - Buffer do PDF
   * @returns {Promise<Buffer>} Buffer da imagem
   */
  async convertPDFToImage(pdfBuffer) {
    try {
      const { execSync } = require('child_process');
      const fs = require('fs');
      const path = require('path');
      const os = require('os');

      // Criar arquivo temporário
      const tempDir = os.tmpdir();
      const tempId = `ocr_${Date.now()}_${Math.random().toString(36).substring(7)}`;
      const tempPdfPath = path.join(tempDir, `${tempId}.pdf`);
      const tempImagePath = path.join(tempDir, `${tempId}-1.png`);

      // Salvar PDF temporário
      fs.writeFileSync(tempPdfPath, pdfBuffer);

      try {
        // Tentar usar pdftoppm (poppler-utils) - mais confiável no Linux
        // Usar resolução muito alta (600 DPI) para melhor qualidade do OCR em documentos
        // Isso é importante para CNH digital que é imagem em PDF
        execSync(`pdftoppm -png -r 600 -f 1 -l 1 "${tempPdfPath}" "${path.join(tempDir, tempId)}"`, {
          stdio: 'ignore',
          timeout: 30000
        });
        logger.info('📄 PDF convertido para imagem em 600 DPI');

        // Verificar se a imagem foi criada
        if (fs.existsSync(tempImagePath)) {
          const imageBuffer = fs.readFileSync(tempImagePath);
          
          // Limpar arquivos temporários
          try {
            fs.unlinkSync(tempPdfPath);
            fs.unlinkSync(tempImagePath);
          } catch (cleanupError) {
            logger.warn('⚠️ Erro ao limpar arquivos temporários:', cleanupError);
          }

          return imageBuffer;
        } else {
          throw new Error('Imagem não foi gerada pelo pdftoppm');
        }
      } catch (execError) {
        // Fallback: tentar pdf-poppler (Node.js)
        try {
          const pdfPoppler = require('pdf-poppler');
          const options = {
            format: 'png',
            out_dir: tempDir,
            out_prefix: tempId,
            page: 1
          };

          await pdfPoppler.convert(tempPdfPath, options);
          const imagePath = path.join(tempDir, `${tempId}-1.png`);
          
          if (fs.existsSync(imagePath)) {
            const imageBuffer = fs.readFileSync(imagePath);
            
            // Limpar arquivos temporários
            try {
              fs.unlinkSync(tempPdfPath);
              fs.unlinkSync(imagePath);
            } catch (cleanupError) {
              logger.warn('⚠️ Erro ao limpar arquivos temporários:', cleanupError);
            }

            return imageBuffer;
          }
        } catch (popplerError) {
          logger.warn('⚠️ pdf-poppler também falhou:', popplerError.message);
        }

        // Limpar PDF temporário mesmo em caso de erro
        try {
          fs.unlinkSync(tempPdfPath);
        } catch (cleanupError) {
          // Ignorar
        }

        throw new Error(`Falha ao converter PDF: ${execError.message}`);
      }
    } catch (error) {
      logger.error('❌ Erro ao converter PDF para imagem:', error);
      throw new Error(`Falha ao converter PDF: ${error.message}`);
    }
  }

  /**
   * Extrai dados da CNH
   * @param {Buffer} fileBuffer - Buffer da imagem ou PDF da CNH
   * @param {string} mimeType - Tipo MIME do arquivo (opcional)
   * @returns {Promise<Object>} Dados extraídos da CNH
   */
  async extractCNHData(fileBuffer, mimeType = null) {
    try {
      const text = await this.extractText(fileBuffer, mimeType);
      logger.info('📄 Texto extraído da CNH:', text.substring(0, 200));

      const data = {
        nome: this.extractNome(text),
        cpf: this.extractCPF(text),
        rg: this.extractRG(text),
        dataNascimento: this.extractDataNascimento(text),
        numeroRegistro: this.extractNumeroRegistro(text),
        categoria: this.extractCategoria(text),
        validade: this.extractValidade(text),
        cnh: this.extractCNH(text),
        textoCompleto: text,
        confidence: 0.8 // Pode ser calculado baseado na qualidade do OCR
      };

      logger.info('✅ Dados extraídos da CNH:', data);
      return data;
    } catch (error) {
      logger.error('❌ Erro ao extrair dados da CNH:', error);
      throw error;
    }
  }

  /**
   * Extrai dados do CRLV (documento do veículo)
   * @param {Buffer} fileBuffer - Buffer da imagem ou PDF do CRLV
   * @param {string} mimeType - Tipo MIME do arquivo (opcional)
   * @returns {Promise<Object>} Dados extraídos do CRLV
   */
  async extractCRLVData(fileBuffer, mimeType = null) {
    try {
      const text = await this.extractText(fileBuffer, mimeType);
      logger.info('📄 Texto extraído do CRLV:', text.substring(0, 200));

      const data = {
        placa: this.extractPlaca(text),
        renavam: this.extractRENAVAM(text),
        chassi: this.extractChassi(text),
        marca: this.extractMarca(text),
        modelo: this.extractModelo(text),
        anoFabricacao: this.extractAnoFabricacao(text),
        anoModelo: this.extractAnoModelo(text),
        cor: this.extractCor(text),
        combustivel: this.extractCombustivel(text),
        textoCompleto: text,
        confidence: 0.8
      };

      logger.info('✅ Dados extraídos do CRLV:', data);
      return data;
    } catch (error) {
      logger.error('❌ Erro ao extrair dados do CRLV:', error);
      throw error;
    }
  }

  // ==================== MÉTODOS DE EXTRAÇÃO - CNH ====================

  extractNome(text) {
    // Priorizar campo numerado: "1 NOME E SOBRENOME" - dados estão SEMPRE na linha ABAIXO
    // Estrutura:
    // Linha 8: "2 € 1 NOME E SOBRENOME 1º HABILITAÇÃO"
    // Linha 9: "[ FELIPE RIBEIRO DIAS |[ 18/03/2023"
    // O nome está na linha ABAIXO, entre colchetes ou após separadores
    
    // Procurar na estrutura de linhas
    const lines = text.split('\n');
    for (let i = 0; i < lines.length; i++) {
      if (/1\s+NOME\s+E\s+SOBRENOME/i.test(lines[i]) || /1\s+NOME/i.test(lines[i])) {
        // Procurar nas próximas 5 linhas - dados estão SEMPRE abaixo (pode ter linhas vazias)
        for (let j = i + 1; j < Math.min(i + 6, lines.length); j++) {
          // Ignorar linhas muito curtas ou vazias
          if (lines[j].trim().length < 5) continue;
          
          // O nome está entre colchetes ou após separadores
          // Padrão: "[ FELIPE RIBEIRO DIAS |[ 18/03/2023"
          // Procurar nome completo (2-3 palavras em maiúsculas) entre colchetes ou após "["
          const nomeMatch = lines[j].match(/\[\s*([A-ZÁÉÍÓÚÇÃÊÔÕ]{3,}\s+[A-ZÁÉÍÓÚÇÃÊÔÕ]{3,}(\s+[A-ZÁÉÍÓÚÇÃÊÔÕ]{3,})?)\s*\|/);
          if (nomeMatch && nomeMatch[1]) {
            const nome = nomeMatch[1].trim().toUpperCase();
            // Filtrar palavras muito comuns que não são nomes
            if (!nome.match(/^(SECRETARIA|NACIONAL|TRÂNSITO|REPÚBLICA|FEDERATIVA|BRASIL|CARTEIRA|NOME|SOBRENOME)/i)) {
              return nome;
            }
          }
          // Fallback: procurar nome completo na linha (2-3 palavras em maiúsculas)
          const nomePattern = /([A-ZÁÉÍÓÚÇÃÊÔÕ]{4,}\s+[A-ZÁÉÍÓÚÇÃÊÔÕ]{4,}(\s+[A-ZÁÉÍÓÚÇÃÊÔÕ]{4,})?)/;
          const nomeMatch2 = lines[j].match(nomePattern);
          if (nomeMatch2 && nomeMatch2[1]) {
            const nome = nomeMatch2[1].trim().toUpperCase();
            // Filtrar palavras muito comuns e verificar se não é data ou número
            if (!nome.match(/^(SECRETARIA|NACIONAL|TRÂNSITO|REPÚBLICA|FEDERATIVA|BRASIL|CARTEIRA|NOME|SOBRENOME|\d)/i) 
                && !nome.match(/\d{2}\/\d{2}\/\d{4}/)) {
              return nome;
            }
          }
        }
      }
    }
    
    // Fallback: padrões gerais (se não encontrou campo numerado)
    const patterns = [
      /NOME[:\s]+([A-ZÁÉÍÓÚÇÃÊÔÕ\s]{5,})/i,
      /NOME\s+COMPLETO[:\s]+([A-ZÁÉÍÓÚÇÃÊÔÕ\s]{5,})/i,
      // Padrão específico para CNH digital: nome após "CARTEIRA NACIONAL DE HABILITAÇÃO"
      /HABILITAÇÃO[^A-Z]*([A-ZÁÉÍÓÚÇÃÊÔÕ]{3,}\s+[A-ZÁÉÍÓÚÇÃÊÔÕ]{3,}\s+[A-ZÁÉÍÓÚÇÃÊÔÕ]{3,})/i,
    ];

    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match && match[1]) {
        const nome = match[1].trim().toUpperCase();
        // Filtrar palavras muito comuns que não são nomes
        if (!nome.match(/^(SECRETARIA|NACIONAL|TRÂNSITO|REPÚBLICA|FEDERATIVA|BRASIL|CARTEIRA|NOME|SOBRENOME)/i)) {
          return nome;
        }
      }
    }
    
    // Procurar por padrão MRZ (Machine Readable Zone) no final
    // Formato CNH digital: FELIPEX<<RIBEIRO<DIAS<<<<<<<<<<
    const mrzPatterns = [
      /([A-Z]{2,})X?<<([A-Z]{2,})<([A-Z]{2,})<+/,  // FELIPEX<<RIBEIRO<DIAS
      /([A-Z]{2,})<<([A-Z]{2,})<<([A-Z]{2,})/,     // Formato padrão
    ];
    
    for (const mrzPattern of mrzPatterns) {
      const mrzMatch = text.match(mrzPattern);
      if (mrzMatch) {
        const nome = `${mrzMatch[1].replace(/X$/, '')} ${mrzMatch[2]} ${mrzMatch[3]}`;
        return nome;
      }
    }
    
    // Procurar por padrão de nome após ")" ou ">" (comum em CNH digital)
    const nomeAposParentese = />\s*\)\s*([A-ZÁÉÍÓÚÇÃÊÔÕ]{3,}\s+[A-ZÁÉÍÓÚÇÃÊÔÕ]{3,}\s+[A-ZÁÉÍÓÚÇÃÊÔÕ]{3,})/;
    const matchParentese = text.match(nomeAposParentese);
    if (matchParentese && matchParentese[1]) {
      const nome = matchParentese[1].trim().toUpperCase();
      if (!nome.match(/^(SECRETARIA|NACIONAL|TRÂNSITO|REPÚBLICA|FEDERATIVA|BRASIL)/i)) {
        return nome;
      }
    }
    
    return null;
  }

  extractCPF(text) {
    // Priorizar campo numerado: "4d CPF" - dados estão SEMPRE na linha ABAIXO
    // IMPORTANTE: CPF SEMPRE vem FORMATADO (com pontos e hífen): XXX.XXX.XXX-XX
    // Estrutura: 
    // Linha 16: "4d CPF 5 Nº REGISTRO 9 CAT HAB"
    // Linha 18: "E | A [ 181.477.007-09 [ 08128534616 |[ B"
    // Os valores estão separados por colchetes [:
    // - Primeiro valor entre [ ]: CPF (181.477.007-09) - campo 4d
    // - Segundo valor entre [ ]: CNH (08128534616) - campo 5
    // - Terceiro valor entre [ ]: Categoria (B) - campo 9
    
    // Procurar na estrutura de linhas
    const lines = text.split('\n');
    for (let i = 0; i < lines.length; i++) {
      if (/4d\s+CPF/i.test(lines[i])) {
        // Procurar nas próximas 5 linhas - dados estão SEMPRE abaixo (pode ter linhas vazias)
        for (let j = i + 1; j < Math.min(i + 6, lines.length); j++) {
          // Ignorar linhas muito curtas ou vazias
          if (lines[j].trim().length < 5) continue;
          
          // O OCR interpreta as molduras dos campos como colchetes, mas não fecha corretamente
          // Padrão: "E | A [ 181.477.007-09 [ 08128534616 |[ B"
          // Os colchetes não estão fechados, mas o CPF formatado é único na linha
          // Procurar primeiro CPF FORMATADO (com pontos e hífen) - não depende de colchetes fechados
          const cpfMatches = lines[j].match(/(\d{3}\.\d{3}\.\d{3}-\d{2})/g);
          if (cpfMatches && cpfMatches.length > 0) {
            // Pegar o primeiro CPF formatado encontrado (que é o do campo 4d)
            const cpf = cpfMatches[0].replace(/[^\d]/g, '');
            if (cpf.length === 11 && !/^(\d)\1{10}$/.test(cpf)) {
              return cpfMatches[0];
            }
          }
        }
      }
    }
    
    // Não usar fallback genérico - CPF deve estar especificamente na linha abaixo do campo 4d
    // e SEMPRE vem formatado (com pontos e hífen)
    return null;
  }

  extractRG(text) {
    // RG: varia muito, mas geralmente tem números
    const rgPatterns = [
      /RG[:\s]+([A-Z]{0,2}\s*\d{1,2}\.?\d{3}\.?\d{3}-?\d{0,1})/i,
      /REGISTRO[:\s]+GERAL[:\s]+([A-Z]{0,2}\s*\d{1,2}\.?\d{3}\.?\d{3}-?\d{0,1})/i,
      /IDENTIDADE[:\s]+([A-Z]{0,2}\s*\d{1,2}\.?\d{3}\.?\d{3}-?\d{0,1})/i,
    ];
    
    for (const pattern of rgPatterns) {
      const match = text.match(pattern);
      if (match && match[1]) {
        return match[1].trim();
      }
    }
    
    // Procurar padrão genérico de RG: letras opcionais + números
    const genericRgPattern = /RG[:\s]+([A-Z]{0,2}[\s\.]?\d{1,2}[\s\.]?\d{3}[\s\.]?\d{3}[-]?\d{0,1})/i;
    const genericMatch = text.match(genericRgPattern);
    if (genericMatch && genericMatch[1]) {
      return genericMatch[1].trim();
    }
    
    return null;
  }

  extractDataNascimento(text) {
    // Priorizar campo numerado: "3 DATA, LOCAL E UF DE NASCIMENTO" seguido de "DD/MM/AAAA, Cidade, Estado"
    // Exemplo: "3 DATA, LOCAL E UF DE NASCIMENTO\n08/02/2001, RIO DE JANEIRO, RJ"
    // Mas também aceitar variações do OCR que podem não capturar perfeitamente
    const campo3Patterns = [
      /3\s+DATA[^0-9]*NASCIMENTO[^\d]*(\d{2}\/\d{2}\/\d{4})/i,
      /3\s+[^\d]*NASCIMENTO[^\d]*(\d{2}\/\d{2}\/\d{4})/i,
      /3\s+[^\d]*(\d{2}\/\d{2}\/\d{4})[^0-9]*(?:RIO|JANEIRO|CAXIAS|ESTADO|UF|RJ)/i,
      // Padrões mais flexíveis para OCR imperfeito
      /[^\d]3[^\d]+[^\d]*(\d{2}\/\d{2}\/\d{4})[^0-9]*(?:RIO|JANEIRO|CAXIAS)/i,
      /NASCIMENTO[^\d]{0,50}(\d{2}\/\d{2}\/\d{4})[^0-9]*(?:RIO|JANEIRO|CAXIAS|RJ)/i,
    ];
    
    for (const pattern of campo3Patterns) {
      const match = text.match(pattern);
      if (match && match[1]) {
        const year = parseInt(match[1].split('/')[2]);
        // Validar que é uma data de nascimento razoável (1950-2010)
        if (year >= 1950 && year <= 2010) {
          return match[1];
        }
      }
    }
    
    // Procurar data próxima a "RIO DE JANEIRO" ou outras cidades conhecidas
    const cidadePattern = /(\d{2}\/\d{2}\/\d{4})[^0-9]*(?:RIO\s+DE\s+JANEIRO|JANEIRO|CAXIAS|DUQUE|ESTADO|RJ)/i;
    const cidadeMatch = text.match(cidadePattern);
    if (cidadeMatch && cidadeMatch[1]) {
      const year = parseInt(cidadeMatch[1].split('/')[2]);
      if (year >= 1950 && year <= 2010) {
        return cidadeMatch[1];
      }
    }
    
    // Fallback: padrão de texto formatado: "DD/MM/AAAA, Cidade, Estado"
    const formattedDatePatterns = [
      /(\d{2}\/\d{2}\/\d{4}),\s*([A-ZÁÉÍÓÚÇÃÊÔÕ\s]+),\s*([A-Z]{2})/i,  // Com estado
      /(\d{2}\/\d{2}\/\d{4}),\s*([A-ZÁÉÍÓÚÇÃÊÔÕ\s]+)/i,  // Sem estado
    ];
    
    for (const pattern of formattedDatePatterns) {
      const formattedMatch = text.match(pattern);
      if (formattedMatch && formattedMatch[1]) {
        const dateMatch = formattedMatch[1].match(/(\d{2}\/\d{2}\/\d{4})/);
        if (dateMatch) {
          const year = parseInt(dateMatch[1].split('/')[2]);
          if (year >= 1950 && year <= 2010) {
            return dateMatch[1];
          }
        }
      }
    }
    
    // Fallback: procurar padrão de data formatada sem cidade/estado
    const datePatterns = [
      /NASCIMENTO[:\s\/]+(\d{2}\/\d{2}\/\d{4})/i,
      /NASC[:\s\/]+(\d{2}\/\d{2}\/\d{4})/i,
      /DATA[:\s]+DE[:\s]+NASCIMENTO[:\s\/]+(\d{2}\/\d{2}\/\d{4})/i,
    ];

    for (const pattern of datePatterns) {
      const match = text.match(pattern);
      if (match && match[1]) {
        const dateMatch = match[1].match(/(\d{2}\/\d{2}\/\d{4})/);
        if (dateMatch) {
          const year = parseInt(dateMatch[1].split('/')[2]);
          if (year >= 1950 && year <= 2010) {
            return dateMatch[1];
          }
        }
      }
    }
    
    // Último recurso: procurar qualquer data no formato DD/MM/AAAA
    const anyDatePattern = /(\d{2}\/\d{2}\/\d{4})/g;
    const allDates = text.match(anyDatePattern);
    if (allDates) {
      for (const date of allDates) {
        const year = parseInt(date.split('/')[2]);
        if (year >= 1950 && year <= 2010) {
          return date;
        }
      }
    }
    
    return null;
  }

  extractNumeroRegistro(text) {
    // Número de registro da CNH
    const registroPatterns = [
      /REGISTRO[:\s]+([A-Z]{0,2}\s*\d{6,})/i,
      /N[ÚU]MERO[:\s]+DE[:\s]+REGISTRO[:\s]+([A-Z]{0,2}\s*\d{6,})/i,
      /NR[:\s]+([A-Z]{0,2}\s*\d{6,})/i,
    ];
    
    for (const pattern of registroPatterns) {
      const match = text.match(pattern);
      if (match && match[1]) {
        return match[1].trim();
      }
    }
    
    // Procurar na linha MRZ: primeira linha pode conter número de registro
    // Formato: I<BRAD81285346<162 - onde D81285346 pode ser número de registro
    const mrzRegistroPattern = /BRA[A-Z](\d{9,11})/;
    const mrzMatch = text.match(mrzRegistroPattern);
    if (mrzMatch && mrzMatch[1]) {
      return mrzMatch[1];
    }
    
    return null;
  }

  extractCategoria(text) {
    // Priorizar campo numerado: "9 CAT HAB" - dados estão SEMPRE na linha ABAIXO
    // Estrutura: 
    // Linha 16: "4d CPF 5 Nº REGISTRO 9 CAT HAB"
    // Linha 18: "E | A [ 181.477.007-09 [ 08128534616 |[ B"
    // Os valores estão separados por colchetes [:
    // - Primeiro valor entre [ ]: CPF (181.477.007-09) - campo 4d
    // - Segundo valor entre [ ]: CNH (08128534616) - campo 5
    // - Terceiro valor entre [ ]: Categoria (B) - campo 9
    // A categoria também pode estar entre "|" e primeiro "[" (A)
    
    // Procurar na estrutura de linhas
    const lines = text.split('\n');
    for (let i = 0; i < lines.length; i++) {
      if (/9\s+CAT\s+HAB/i.test(lines[i])) {
        // Procurar nas próximas 5 linhas - dados estão SEMPRE abaixo (pode ter linhas vazias)
        for (let j = i + 1; j < Math.min(i + 6, lines.length); j++) {
          // Ignorar linhas muito curtas ou vazias
          if (lines[j].trim().length < 5) continue;
          
          // O OCR interpreta as molduras dos campos como colchetes, mas não fecha corretamente
          // Padrão: "E | A [ 181.477.007-09 [ 08128534616 |[ B"
          // Os valores estão na ordem: categoria (A), CPF formatado, CNH, categoria (B)
          // A categoria pode estar:
          // 1. Entre "|" e primeiro "[" (A) - antes do CPF
          // 2. Após a CNH, após "|[" ou "[" (B) - terceiro campo
          
          // Primeiro: procurar categoria após a CNH (terceiro campo)
          // Encontrar a posição da CNH (11 dígitos sem formatação)
          const cnhMatch = lines[j].match(/(\d{11})/);
          if (cnhMatch) {
            const cnhIndex = lines[j].indexOf(cnhMatch[1]);
            // Procurar categoria após a CNH
            const afterCnh = lines[j].substring(cnhIndex + cnhMatch[1].length);
            const catAfterCnh = afterCnh.match(/[|\[\s]*([A-E]{1,2})/);
            if (catAfterCnh && catAfterCnh[1]) {
              const cat = catAfterCnh[1].toUpperCase();
              if (cat !== 'DE' && /^[A-E]{1,2}$/.test(cat)) {
                return cat;
              }
            }
          }
          
          // Fallback: procurar categoria entre "|" e primeiro "[" (antes do CPF)
          // Padrão: "E | A [ 181.477.007-09" - o "A" entre "|" e "[" é a categoria
          const categoriaMatch = lines[j].match(/\|\s*([A-E]{1,2})\s*\[/);
          if (categoriaMatch && categoriaMatch[1]) {
            const cat = categoriaMatch[1].toUpperCase();
            if (cat !== 'DE' && /^[A-E]{1,2}$/.test(cat)) {
              return cat;
            }
          }
        }
      }
    }
    
    // Fallback: padrões gerais
    const campo9Patterns = [
      /9\s+CAT\s+HAB[^\w]*([A-E]{1,2})/i,
      /9\s+CAT[^\w]*HAB[^\w]*([A-E]{1,2})/i,
    ];
    
    for (const pattern of campo9Patterns) {
      const match = text.match(pattern);
      if (match && match[1]) {
        const categoria = match[1].toUpperCase();
        if (/^[A-E]{1,2}$/.test(categoria) && categoria !== 'DE') {
          return categoria;
        }
      }
    }
    
    // Fallback: padrões gerais de categoria
    const categoriaPatterns = [
      /CAT[EGORIA]*[:\s\/]+([A-E]{1,2})/i,
      /CAT[EGORIA]*\s+CAPACIDADE[:\s\/]+([A-E]{1,2})/i,
      /CAT\s+HAB[^\w]*([A-E]{1,2})/i,
      /CAT[EGORIA]*[:\s]+([A-E]{1,2})/i,
    ];

    for (const pattern of categoriaPatterns) {
      const match = text.match(pattern);
      if (match && match[1]) {
        const categoria = match[1].toUpperCase();
        if (/^[A-E]{1,2}$/.test(categoria)) {
          return categoria;
        }
      }
    }
    
    return null;
  }

  extractValidade(text) {
    // Priorizar campo numerado: "4b VALIDADE" - dados estão SEMPRE na linha ABAIXO
    // Estrutura: 
    // Linha: "4a DATA EMISSÃO 4b VALIDADE"
    // Linha seguinte: "[ 06/05/2024 |[ 28/07/2032"
    // A primeira data é emissão (4a), a segunda é validade (4b) - ambas na linha ABAIXO
    
    // Procurar na estrutura de linhas
    const lines = text.split('\n');
    for (let i = 0; i < lines.length; i++) {
      if (/4b\s+VALIDADE/i.test(lines[i])) {
        // Procurar nas próximas 3 linhas - dados estão SEMPRE abaixo
        for (let j = i + 1; j < Math.min(i + 4, lines.length); j++) {
          const dates = lines[j].match(/(\d{2}\/\d{2}\/\d{4})/g);
          if (dates && dates.length >= 2) {
            // Segunda data é a validade (primeira é emissão do campo 4a)
            const validade = dates[1];
            const year = parseInt(validade.split('/')[2]);
            if (year >= 2020 && year <= 2050) {
              return validade;
            }
          } else if (dates && dates.length === 1) {
            // Se só tem uma data na linha, pode ser que emissão e validade estejam em linhas diferentes
            // Verificar se é futura (validade geralmente é mais futura que emissão)
            const year = parseInt(dates[0].split('/')[2]);
            if (year >= 2020 && year <= 2050) {
              return dates[0];
            }
          }
        }
      }
    }
    
    // Fallback: padrões gerais
    const campo4bPatterns = [
      /4b\s+VALIDADE[^\d]*(\d{2}\/\d{2}\/\d{4})/i,
      /4b\s+VALIDADE[^\d]*\n[^\d]*\[?\s*(\d{2}\/\d{2}\/\d{4})/i,
    ];
    
    for (const pattern of campo4bPatterns) {
      const match = text.match(pattern);
      if (match && match[1]) {
        const dateMatch = match[1].match(/(\d{2}\/\d{2}\/\d{4})/);
        if (dateMatch) {
          const year = parseInt(dateMatch[1].split('/')[2]);
          if (year >= 2020 && year <= 2050) {
            return dateMatch[1];
          }
        }
      }
    }
    
    // Fallback: procurar qualquer data futura próxima à palavra "VALIDADE"
    const validadeContextPattern = /VALIDADE[^\d]{0,100}(\d{2}\/\d{2}\/\d{4})/i;
    const validadeMatch = text.match(validadeContextPattern);
    if (validadeMatch && validadeMatch[1]) {
      const year = parseInt(validadeMatch[1].split('/')[2]);
      if (year >= 2020 && year <= 2050) {
        return validadeMatch[1];
      }
    }
    
    // Fallback: padrão de texto formatado
    const datePatterns = [
      /VALIDADE[:\s\/]+(\d{2}\/\d{2}\/\d{4})/i,
      /VALID[:\s\/]+(\d{2}\/\d{2}\/\d{4})/i,
      /VÁLIDA[:\s]+ATÉ[:\s\/]+(\d{2}\/\d{2}\/\d{4})/i,
    ];

    for (const pattern of datePatterns) {
      const match = text.match(pattern);
      if (match && match[1]) {
        const dateMatch = match[1].match(/(\d{2}\/\d{2}\/\d{4})/);
        if (dateMatch) {
          const year = parseInt(dateMatch[1].split('/')[2]);
          // Validade geralmente é futura (2020-2050)
          if (year >= 2020 && year <= 2050) {
            return dateMatch[1];
          }
        }
      }
    }
    
    // Fallback: procurar qualquer data futura no formato DD/MM/AAAA
    const anyDatePattern = /(\d{2}\/\d{2}\/\d{4})/g;
    const allDates = text.match(anyDatePattern);
    if (allDates) {
      for (const date of allDates) {
        const year = parseInt(date.split('/')[2]);
        // Validade geralmente é futura (2020-2050)
        if (year >= 2020 && year <= 2050) {
          return date;
        }
      }
    }
    
    return null;
  }

  extractCNH(text) {
    // Priorizar campo numerado: "5 Nº REGISTRO" - dados estão SEMPRE na linha ABAIXO
    // IMPORTANTE: CNH SEMPRE vem SEM formatação (sem pontos, sem hífen): apenas 11 dígitos
    // Estrutura: 
    // Linha 16: "4d CPF 5 Nº REGISTRO 9 CAT HAB"
    // Linha 18: "E | A [ 181.477.007-09 [ 08128534616 |[ B"
    // Os valores estão separados por colchetes [:
    // - Primeiro valor entre [ ]: CPF (181.477.007-09) - campo 4d
    // - Segundo valor entre [ ]: CNH (08128534616) - campo 5
    // - Terceiro valor entre [ ]: Categoria (B) - campo 9
    
    // Procurar na estrutura de linhas
    const lines = text.split('\n');
    for (let i = 0; i < lines.length; i++) {
      if (/5\s+N[º°]?\s+REGISTRO/i.test(lines[i]) || /5\s+REGISTRO/i.test(lines[i])) {
        // Procurar nas próximas 5 linhas - dados estão SEMPRE abaixo (pode ter linhas vazias)
        for (let j = i + 1; j < Math.min(i + 6, lines.length); j++) {
          // Ignorar linhas muito curtas ou vazias
          if (lines[j].trim().length < 5) continue;
          
          // O OCR interpreta as molduras dos campos como colchetes, mas não fecha corretamente
          // Padrão: "E | A [ 181.477.007-09 [ 08128534616 |[ B"
          // Os colchetes não estão fechados, mas os valores estão na ordem: CPF formatado, depois CNH
          // Procurar número de 11 dígitos SEM formatação que vem APÓS o CPF formatado
          // Primeiro encontrar a posição do CPF formatado
          const cpfFormatted = lines[j].match(/(\d{3}\.\d{3}\.\d{3}-\d{2})/);
          if (cpfFormatted) {
            const cpfIndex = lines[j].indexOf(cpfFormatted[0]);
            // Procurar número de 11 dígitos após o CPF
            const afterCpf = lines[j].substring(cpfIndex + cpfFormatted[0].length);
            const cnhMatch = afterCpf.match(/(\d{11})/);
            if (cnhMatch && cnhMatch[1]) {
              // Validar que não é todos iguais e não é o mesmo do CPF
              const cpfDigits = cpfFormatted[1].replace(/[^\d]/g, '');
              if (!/^(\d)\1{10}$/.test(cnhMatch[1]) && cnhMatch[1] !== cpfDigits) {
                return cnhMatch[1];
              }
            }
          }
          // Fallback: procurar primeiro número de 11 dígitos SEM formatação que não é CPF
          const numbers = lines[j].match(/\d{11}/g);
          if (numbers && numbers.length > 0) {
            const cpfFormatted = lines[j].match(/\d{3}\.\d{3}\.\d{3}-\d{2}/);
            const cpfDigits = cpfFormatted ? cpfFormatted[0].replace(/[^\d]/g, '') : null;
            // Pegar o primeiro número de 11 dígitos que NÃO é o CPF
            for (const num of numbers) {
              if (!/^(\d)\1{10}$/.test(num) && num !== cpfDigits) {
                return num;
              }
            }
          }
        }
      }
    }
    
    // Fallback: procurar por padrão de 11 dígitos consecutivos SEM formatação
    // (não pode ter pontos ou hífen no meio)
    const any11Digits = /(\d{11})/;
    const match = text.match(any11Digits);
    if (match && match[1]) {
      // Validar que não é todos iguais e não está formatado como CPF
      if (!/^(\d)\1{10}$/.test(match[1])) {
        return match[1];
      }
    }
    
    return null;
  }

  // ==================== MÉTODOS DE EXTRAÇÃO - CRLV ====================

  extractPlaca(text) {
    // Placa: ABC-1234 ou ABC1234 (formato antigo) ou ABC1D23 (formato Mercosul)
    const placaPattern = /([A-Z]{3}[-\s]?\d{1}[A-Z]{1}\d{2}|[A-Z]{3}[-\s]?\d{4})/;
    const match = text.match(placaPattern);
    return match ? match[1].replace(/[-\s]/g, '').toUpperCase() : null;
  }

  extractRENAVAM(text) {
    // RENAVAM: 11 dígitos
    const renavamPatterns = [
      /RENAVAM[:\s\/]+(\d{11})/i,
      /CÓDIGO[:\s]+RENAVAM[:\s\/]+(\d{11})/i,
      /RENAVAM[:\s\/]+(\d{9,11})/i, // Pode ter 9 ou 11 dígitos
    ];

    for (const pattern of renavamPatterns) {
      const match = text.match(pattern);
      if (match && match[1]) {
        const renavam = match[1];
        // RENAVAM pode ter 9 ou 11 dígitos
        if (renavam.length >= 9 && renavam.length <= 11) {
          return renavam;
        }
      }
    }
    
    // Procurar por padrão de 11 dígitos após "RENAVAM" ou "CÓDIGO"
    const fallbackPattern = /(?:RENAVAM|CÓDIGO)[^0-9]*(\d{9,11})/i;
    const fallbackMatch = text.match(fallbackPattern);
    if (fallbackMatch && fallbackMatch[1].length >= 9) {
      return fallbackMatch[1];
    }
    
    return null;
  }

  extractChassi(text) {
    // Chassi: 17 caracteres alfanuméricos (sem I, O, Q para evitar confusão)
    const chassiPatterns = [
      /CHASSI[:\s\/]+([A-HJ-NPR-Z0-9]{17})/i,
      /CHASS[:\s\/]+([A-HJ-NPR-Z0-9]{17})/i,
      // Procurar após "PLACA ANTERIOR" ou similar
      /PLACA\s+ANTERIOR[^A-Z0-9]*([A-HJ-NPR-Z0-9]{17})/i,
    ];

    for (const pattern of chassiPatterns) {
      const match = text.match(pattern);
      if (match && match[1]) {
        let chassi = match[1].toUpperCase().replace(/[^A-HJ-NPR-Z0-9]/g, '');
        if (chassi.length === 17) {
          return chassi;
        }
      }
    }
    
    // Procurar por padrão de 17 caracteres alfanuméricos próximos a "CHASSI" ou "PLACA"
    const fallbackPattern = /(?:CHASSI|CHASS|PLACA)[^A-Z0-9]{0,20}([A-HJ-NPR-Z0-9]{17})/i;
    const fallbackMatch = text.match(fallbackPattern);
    if (fallbackMatch && fallbackMatch[1]) {
      const chassi = fallbackMatch[1].toUpperCase().replace(/[^A-HJ-NPR-Z0-9]/g, '');
      if (chassi.length === 17) {
        return chassi;
      }
    }
    
    return null;
  }

  extractMarca(text) {
    // Marcas comuns
    const marcas = ['FIAT', 'VOLKSWAGEN', 'VW', 'CHEVROLET', 'FORD', 'TOYOTA', 'HONDA', 'NISSAN', 'HYUNDAI', 'RENAULT', 'PEUGEOT', 'CITROËN', 'CITROEN', 'BMW', 'MERCEDES', 'AUDI'];
    const marcaPatterns = [
      /MARCA\s*\/\s*MODELO[:\s\/]+([A-ZÁÉÍÓÚÇÃÊÔÕ0-9\s]+?)(?:\s*\/\s*VERSÃO|\s*\/\s*MODELO|$)/i,
      /MARCA[:\s\/]+([A-ZÁÉÍÓÚÇÃÊÔÕ\s]+)/i,
    ];

    for (const pattern of marcaPatterns) {
      const match = text.match(pattern);
      if (match && match[1]) {
        let marca = match[1].trim().toUpperCase().split(/\s*\/\s*/)[0]; // Pegar primeira parte se tiver "/"
        // Remover números e caracteres especiais do início
        marca = marca.replace(/^[0-9\/\s]+/, '').trim();
        
        // Verificar se é uma marca conhecida
        for (const marcaConhecida of marcas) {
          if (marca.includes(marcaConhecida) || marcaConhecida.includes(marca)) {
            return marcaConhecida;
          }
        }
        // Se não encontrou marca conhecida, retornar o que encontrou (limitado a 20 caracteres)
        if (marca.length > 0 && marca.length < 20 && !marca.match(/^(MODELO|VERSÃO|ET|PIA)/i)) {
          return marca;
        }
      }
    }
    
    // Procurar marcas conhecidas diretamente no texto (mas não em contexto de "MODELO")
    for (const marcaConhecida of marcas) {
      const marcaIndex = text.toUpperCase().indexOf(marcaConhecida);
      if (marcaIndex !== -1) {
        // Verificar se não está dentro de "MODELO" ou "VERSÃO"
        const context = text.substring(Math.max(0, marcaIndex - 10), Math.min(text.length, marcaIndex + marcaConhecida.length + 10)).toUpperCase();
        if (!context.includes('MODELO') || context.includes('MARCA')) {
          return marcaConhecida;
        }
      }
    }
    
    return null;
  }

  extractModelo(text) {
    // Modelo: geralmente após "MODELO" ou "MODELO / VERSÃO"
    const modeloPatterns = [
      /MARCA\s*\/\s*MODELO[:\s\/]+[A-ZÁÉÍÓÚÇÃÊÔÕ\s]+\s*\/\s*([A-ZÁÉÍÓÚÇÃÊÔÕ0-9\s]+?)(?:\s*\/\s*VERSÃO|$)/i,
      /MODELO[:\s\/]+([A-ZÁÉÍÓÚÇÃÊÔÕ0-9\s]+?)(?:\s*\/\s*VERSÃO|$)/i,
      // Padrão específico: "1/FORD EDGE V6" ou similar
      /\d+\s*\/\s*[A-Z]+\s+([A-ZÁÉÍÓÚÇÃÊÔÕ0-9\s]+?)(?:\s*;|$)/i,
    ];

    for (const pattern of modeloPatterns) {
      const match = text.match(pattern);
      if (match && match[1]) {
        let modelo = match[1].trim().toUpperCase();
        // Remover números do início se houver
        modelo = modelo.replace(/^[0-9\/\s]+/, '').trim();
        // Filtrar palavras que não são modelo
        if (!modelo.match(/^(ET|PIA|ANOMODELO|VERSÃO|MODELO|MARCA)/i) && modelo.length > 2 && modelo.length < 30) {
          return modelo;
        }
      }
    }
    
    // Procurar padrão específico "FORD EDGE V6" ou similar após marca
    const marcaModeloPattern = /([A-Z]+)\s+([A-ZÁÉÍÓÚÇÃÊÔÕ0-9]{2,}\s+[A-ZÁÉÍÓÚÇÃÊÔÕ0-9]{1,})/;
    const marcaModeloMatch = text.match(marcaModeloPattern);
    if (marcaModeloMatch) {
      const possivelMarca = marcaModeloMatch[1];
      const possivelModelo = marcaModeloMatch[2];
      const marcas = ['FORD', 'FIAT', 'CHEVROLET', 'TOYOTA', 'HONDA'];
      if (marcas.includes(possivelMarca) && possivelModelo.length > 2) {
        return possivelModelo.trim();
      }
    }
    
    return null;
  }

  extractAnoFabricacao(text) {
    // Ano de fabricação: geralmente 4 dígitos entre 1980-2025
    const anoPatterns = [
      /ANO[:\s]+FAB[RIC]*[AÇÃO]*[:\s\/]+(\d{4})/i,
      /ANOFABRICAÇÃO[:\s\/]+(\d{4})/i,
      /FABRICAÇÃO[:\s\/]+(\d{4})/i,
    ];

    for (const pattern of anoPatterns) {
      const match = text.match(pattern);
      if (match && match[1]) {
        const ano = parseInt(match[1]);
        if (ano >= 1980 && ano <= 2025) {
          return ano.toString();
        }
      }
    }
    
    // Procurar por padrão "2013 2013" (ano fabricação e modelo juntos)
    const anoDuploPattern = /(\d{4})\s+(\d{4})/;
    const anoDuploMatch = text.match(anoDuploPattern);
    if (anoDuploMatch) {
      const ano1 = parseInt(anoDuploMatch[1]);
      const ano2 = parseInt(anoDuploMatch[2]);
      if (ano1 >= 1980 && ano1 <= 2025) {
        return ano1.toString();
      }
      if (ano2 >= 1980 && ano2 <= 2025) {
        return ano2.toString();
      }
    }
    
    return null;
  }

  extractAnoModelo(text) {
    // Ano modelo: geralmente 4 dígitos
    const anoPatterns = [
      /ANO[:\s]+MODELO[:\s\/]+(\d{4})/i,
      /ANOMODELO[:\s\/]+(\d{4})/i,
      /MODELO[:\s\/]+(\d{4})/i,
    ];

    for (const pattern of anoPatterns) {
      const match = text.match(pattern);
      if (match && match[1]) {
        const ano = parseInt(match[1]);
        if (ano >= 1980 && ano <= 2025) {
          return ano.toString();
        }
      }
    }
    
    // Procurar por padrão "2013 2013" (ano fabricação e modelo juntos)
    const anoDuploPattern = /(\d{4})\s+(\d{4})/;
    const anoDuploMatch = text.match(anoDuploPattern);
    if (anoDuploMatch) {
      const ano1 = parseInt(anoDuploMatch[1]);
      const ano2 = parseInt(anoDuploMatch[2]);
      // Se ambos são válidos, retornar o segundo (geralmente é o modelo)
      if (ano1 >= 1980 && ano1 <= 2025 && ano2 >= 1980 && ano2 <= 2025) {
        return ano2.toString();
      }
      if (ano2 >= 1980 && ano2 <= 2025) {
        return ano2.toString();
      }
    }
    
    return null;
  }

  extractCor(text) {
    // Cores comuns
    const cores = ['BRANCO', 'PRETO', 'PRATA', 'CINZA', 'AZUL', 'VERMELHO', 'VERDE', 'AMARELO', 'BEGE', 'DOURADO', 'MARROM', 'ROSA', 'LARANJA', 'BEGE', 'DOURADO'];
    const corPatterns = [
      /COR\s*PREDOMINANTE[:\s\/\|]+([A-ZÁÉÍÓÚÇÃÊÔÕ\s]+?)(?:\s*\|\s*COMBUST|$)/i,
      /COR[:\s\/\|]+([A-ZÁÉÍÓÚÇÃÊÔÕ\s]+?)(?:\s*\|\s*COMBUST|$)/i,
      // Padrão específico: "MARROM GASOLINA/GAS NATURAL VEICULAR"
      /([A-ZÁÉÍÓÚÇÃÊÔÕ]{3,})\s+GASOLINA/i,
    ];

    for (const pattern of corPatterns) {
      const match = text.match(pattern);
      if (match && match[1]) {
        let cor = match[1].trim().toUpperCase().split(/\s*\/\s*/)[0]; // Pegar primeira parte
        // Remover caracteres especiais do início
        cor = cor.replace(/^[^\w]+/, '').trim();
        // Remover números do início
        cor = cor.replace(/^\d+\s*/, '').trim();
        
        for (const corConhecida of cores) {
          if (cor.includes(corConhecida) || corConhecida.includes(cor)) {
            return corConhecida;
          }
        }
        if (cor.length > 0 && cor.length < 20 && !cor.match(/^(COMBUST|PREDOMINANTE|GASOLINA|ETANOL|DIESEL)/i)) {
          return cor;
        }
      }
    }
    
    // Procurar cores conhecidas próximas a "COR" ou "PREDOMINANTE"
    for (const corConhecida of cores) {
      const corIndex = text.toUpperCase().indexOf(corConhecida);
      if (corIndex !== -1) {
        const context = text.substring(Math.max(0, corIndex - 20), Math.min(text.length, corIndex + corConhecida.length + 20)).toUpperCase();
        if (context.includes('COR') || context.includes('PREDOMINANTE')) {
          return corConhecida;
        }
      }
    }
    
    return null;
  }

  extractCombustivel(text) {
    // Tipos de combustível
    const combustiveis = ['GASOLINA', 'ETANOL', 'FLEX', 'DIESEL', 'GNV', 'GAS NATURAL VEICULAR', 'ELÉTRICO', 'HÍBRIDO'];
    const combustivelPatterns = [
      /COMBUST[ÍI]VEL[:\s\/\|]+([A-ZÁÉÍÓÚÇÃÊÔÕ\s\/]+?)(?:\s*\|\s*\||\s*REPASSE|$)/i,
      /COMBUST[ÍI]VEL[:\s\/]+([A-ZÁÉÍÓÚÇÃÊÔÕ\s\/]+)/i,
      // Padrão específico: "MARROM GASOLINA/GAS NATURAL VEICULAR"
      /[A-Z]+\s+(GASOLINA[\/\s]+GAS\s+NATURAL\s+VEICULAR|GASOLINA\/GNV|GASOLINA|ETANOL|DIESEL|FLEX)/i,
    ];

    for (const pattern of combustivelPatterns) {
      const match = text.match(pattern);
      if (match && match[1]) {
        let combustivel = match[1].trim().toUpperCase();
        // Remover caracteres especiais do início
        combustivel = combustivel.replace(/^[^\w]+/, '').trim();
        
        // Verificar se contém algum combustível conhecido
        for (const combConhecido of combustiveis) {
          if (combustivel.includes(combConhecido) || combustivel.includes(combConhecido.replace(/\s/g, ''))) {
            // Se for "GASOLINA/GAS NATURAL VEICULAR", retornar "GNV" ou "FLEX"
            if (combustivel.includes('GAS NATURAL') || combustivel.includes('GNV')) {
              return 'GNV';
            }
            if (combustivel.includes('GASOLINA') && combustivel.includes('ETANOL')) {
              return 'FLEX';
            }
            if (combustivel.includes('GASOLINA') && combustivel.includes('GAS NATURAL')) {
              return 'GNV';
            }
            return combConhecido;
          }
        }
        // Se não encontrou, retornar o que encontrou (limitado)
        if (combustivel.length > 0 && combustivel.length < 40 && !combustivel.match(/^(REPASSE|OBRIGATÓRIO|MARROM|BRANCO|PRETO)/i)) {
          return combustivel;
        }
      }
    }
    
    // Procurar combustíveis conhecidos próximos a "COMBUSTÍVEL" ou após cor
    for (const combConhecido of combustiveis) {
      const combIndex = text.toUpperCase().indexOf(combConhecido);
      if (combIndex !== -1) {
        const context = text.substring(Math.max(0, combIndex - 30), Math.min(text.length, combIndex + combConhecido.length + 30)).toUpperCase();
        if (context.includes('COMBUST') || context.includes('COMBUSTÍVEL') || context.includes('GAS NATURAL')) {
          if (combConhecido === 'GAS NATURAL VEICULAR') {
            return 'GNV';
          }
          return combConhecido;
        }
      }
    }
    
    return null;
  }
}

module.exports = new OCRService();

