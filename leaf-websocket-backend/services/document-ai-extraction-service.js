const axios = require('axios');
const { logger } = require('../utils/logger');

function clamp01(value, fallback = 0.75) {
  const numeric = Number(value);
  if (Number.isFinite(numeric)) {
    return Math.max(0, Math.min(1, numeric));
  }
  return fallback;
}

function normalizeDate(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;

  const ddMmYyyy = raw.match(/(\d{2})[\/\-](\d{2})[\/\-](\d{4})/);
  if (ddMmYyyy) {
    const [, dd, mm, yyyy] = ddMmYyyy;
    return `${dd}/${mm}/${yyyy}`;
  }

  const yyyyMmDd = raw.match(/(\d{4})[\/\-](\d{2})[\/\-](\d{2})/);
  if (yyyyMmDd) {
    const [, yyyy, mm, dd] = yyyyMmDd;
    return `${dd}/${mm}/${yyyy}`;
  }

  return null;
}

function normalizeCPF(value) {
  const digits = String(value || '').replace(/\D/g, '');
  if (digits.length !== 11) return null;
  if (/^(\d)\1{10}$/.test(digits)) return null;
  return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6, 9)}-${digits.slice(9, 11)}`;
}

function normalizeUpper(value) {
  const text = String(value || '').trim();
  return text ? text.toUpperCase() : null;
}

function normalizePersonName(value) {
  const text = String(value || '')
    .replace(/\s+/g, ' ')
    .trim();
  return text ? text.toUpperCase() : null;
}

function normalizeGender(value) {
  const normalized = String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toUpperCase();

  if (!normalized) return null;

  if (['F', 'FEMININO', 'FEMALE', 'MULHER'].includes(normalized)) {
    return 'F';
  }

  if (['M', 'MASCULINO', 'MALE', 'HOMEM'].includes(normalized)) {
    return 'M';
  }

  if (
    [
      'X',
      'OUTRO',
      'OTHER',
      'N',
      'NB',
      'NAO BINARIO',
      'NAO-BINARIO',
      'NON BINARY',
      'NAO INFORMADO'
    ].includes(normalized)
  ) {
    return 'X';
  }

  return null;
}

function normalizePlate(value) {
  const plate = String(value || '').replace(/[^A-Za-z0-9]/g, '').toUpperCase();
  if (/^[A-Z]{3}\d{4}$/.test(plate) || /^[A-Z]{3}\d[A-Z]\d{2}$/.test(plate)) {
    return plate;
  }
  return null;
}

function normalizeYear(value) {
  const match = String(value || '').match(/\b(19\d{2}|20\d{2})\b/);
  if (!match) return null;
  return Number(match[1]);
}

function normalizeWarnings(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map(item => String(item || '').trim()).filter(Boolean))].slice(0, 8);
}

function detectImageMimeType(imageBuffer) {
  if (!Buffer.isBuffer(imageBuffer) || imageBuffer.length < 4) {
    return 'image/png';
  }

  // JPEG
  if (imageBuffer[0] === 0xff && imageBuffer[1] === 0xd8 && imageBuffer[2] === 0xff) {
    return 'image/jpeg';
  }

  // PNG
  if (
    imageBuffer[0] === 0x89 &&
    imageBuffer[1] === 0x50 &&
    imageBuffer[2] === 0x4e &&
    imageBuffer[3] === 0x47
  ) {
    return 'image/png';
  }

  // WEBP (RIFF....WEBP)
  if (
    imageBuffer[0] === 0x52 &&
    imageBuffer[1] === 0x49 &&
    imageBuffer[2] === 0x46 &&
    imageBuffer[3] === 0x46 &&
    imageBuffer[8] === 0x57 &&
    imageBuffer[9] === 0x45 &&
    imageBuffer[10] === 0x42 &&
    imageBuffer[11] === 0x50
  ) {
    return 'image/webp';
  }

  return 'image/png';
}

function normalizeJsonContent(content) {
  const raw = String(content || '').trim();
  if (!raw) {
    throw new Error('Resposta vazia da IA');
  }

  const withoutCodeFence = raw
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/```$/i, '')
    .trim();

  const firstBrace = withoutCodeFence.indexOf('{');
  const lastBrace = withoutCodeFence.lastIndexOf('}');
  const candidate =
    firstBrace >= 0 && lastBrace > firstBrace
      ? withoutCodeFence.slice(firstBrace, lastBrace + 1)
      : withoutCodeFence;

  return JSON.parse(candidate);
}

class DocumentAIExtractionService {
  constructor() {
    this.baseUrl = (process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/+$/, '');
    this.apiKey = process.env.OPENAI_API_KEY || '';
    this.model = process.env.OPENAI_DOCUMENT_MODEL || 'gpt-5.4-mini';
    this.timeoutMs = Number(process.env.OPENAI_DOCUMENT_TIMEOUT_MS || 30000);
  }

  get enabled() {
    return Boolean(this.apiKey);
  }

  async extractCNHFromText(text, metadata = {}) {
    const data = await this.#requestStructuredExtraction({
      systemPrompt:
        'Você extrai dados de documentos brasileiros. Responda APENAS JSON válido, sem markdown. Use null quando não houver dado.',
      userPrompt: [
        'Extraia os campos da CNH abaixo.',
        'Retorne JSON exatamente com estas chaves:',
        '{',
        '  "nome": string|null,',
        '  "cpf": string|null,',
        '  "rg": string|null,',
        '  "dataNascimento": string|null,',
        '  "nomeMae": string|null,',
        '  "genero": string|null,',
        '  "numeroRegistro": string|null,',
        '  "cnh": string|null,',
        '  "categoria": string|null,',
        '  "validade": string|null,',
        '  "dataPrimeiraHabilitacao": string|null,',
        '  "ear": boolean|null,',
        '  "confidence": number,',
        '  "warnings": string[]',
        '}',
        '',
        'Texto OCR:',
        text
      ].join('\n')
    });

    return {
      nome: String(data?.nome || '').trim() || null,
      cpf: normalizeCPF(data?.cpf),
      rg: String(data?.rg || '').trim() || null,
      dataNascimento: normalizeDate(data?.dataNascimento),
      nomeMae: normalizePersonName(
        data?.nomeMae ||
        data?.nome_da_mae ||
        data?.nomeDaMae ||
        data?.mae ||
        data?.motherName ||
        data?.filiacaoMae ||
        data?.filiacao?.mae
      ),
      genero: normalizeGender(data?.genero || data?.sexo || data?.gender || data?.sex),
      numeroRegistro: String(data?.numeroRegistro || '').replace(/\s+/g, '') || null,
      cnh: String(data?.cnh || '').replace(/\s+/g, '') || null,
      categoria: normalizeUpper(data?.categoria),
      validade: normalizeDate(data?.validade),
      dataPrimeiraHabilitacao: normalizeDate(data?.dataPrimeiraHabilitacao),
      ear: typeof data?.ear === 'boolean' ? data.ear : null,
      confidence: clamp01(data?.confidence),
      warnings: normalizeWarnings(data?.warnings),
      extractedBy: this.model,
      extractionMethod: 'openai',
      extractedAt: new Date().toISOString(),
      metadata: {
        source: metadata?.source || 'unknown',
        textLength: Number(metadata?.textLength || text.length || 0)
      }
    };
  }

  async extractCNHFromImageBuffer(imageBuffer, metadata = {}) {
    const data = await this.#requestStructuredExtractionFromImage({
      systemPrompt:
        'Você extrai dados de documentos brasileiros. Responda APENAS JSON válido, sem markdown. Use null quando não houver dado.',
      userPrompt: [
        'Extraia os campos da CNH na imagem enviada.',
        'Retorne JSON exatamente com estas chaves:',
        '{',
        '  "nome": string|null,',
        '  "cpf": string|null,',
        '  "rg": string|null,',
        '  "dataNascimento": string|null,',
        '  "nomeMae": string|null,',
        '  "genero": string|null,',
        '  "numeroRegistro": string|null,',
        '  "cnh": string|null,',
        '  "categoria": string|null,',
        '  "validade": string|null,',
        '  "dataPrimeiraHabilitacao": string|null,',
        '  "ear": boolean|null,',
        '  "confidence": number,',
        '  "warnings": string[]',
        '}'
      ].join('\n'),
      imageBuffer
    });

    return {
      nome: String(data?.nome || '').trim() || null,
      cpf: normalizeCPF(data?.cpf),
      rg: String(data?.rg || '').trim() || null,
      dataNascimento: normalizeDate(data?.dataNascimento),
      nomeMae: normalizePersonName(
        data?.nomeMae ||
        data?.nome_da_mae ||
        data?.nomeDaMae ||
        data?.mae ||
        data?.motherName ||
        data?.filiacaoMae ||
        data?.filiacao?.mae
      ),
      genero: normalizeGender(data?.genero || data?.sexo || data?.gender || data?.sex),
      numeroRegistro: String(data?.numeroRegistro || '').replace(/\s+/g, '') || null,
      cnh: String(data?.cnh || '').replace(/\s+/g, '') || null,
      categoria: normalizeUpper(data?.categoria),
      validade: normalizeDate(data?.validade),
      dataPrimeiraHabilitacao: normalizeDate(data?.dataPrimeiraHabilitacao),
      ear: typeof data?.ear === 'boolean' ? data.ear : null,
      confidence: clamp01(data?.confidence),
      warnings: normalizeWarnings(data?.warnings),
      extractedBy: this.model,
      extractionMethod: 'openai_image',
      extractedAt: new Date().toISOString(),
      metadata: {
        source: metadata?.source || 'unknown',
        imageBytes: Number(metadata?.imageBytes || imageBuffer?.length || 0)
      }
    };
  }

  async extractVehicleFromText(text, metadata = {}) {
    const data = await this.#requestStructuredExtraction({
      systemPrompt:
        'Você extrai dados de documentos veiculares brasileiros. Responda APENAS JSON válido, sem markdown. Use null quando não houver dado.',
      userPrompt: [
        'Extraia os campos abaixo do CRLV/documento do veículo.',
        'Retorne JSON exatamente com estas chaves:',
        '{',
        '  "placa": string|null,',
        '  "renavam": string|null,',
        '  "chassi": string|null,',
        '  "marca": string|null,',
        '  "modelo": string|null,',
        '  "anoFabricacao": number|null,',
        '  "anoModelo": number|null,',
        '  "cor": string|null,',
        '  "combustivel": string|null,',
        '  "categoria": string|null,',
        '  "uf": string|null,',
        '  "municipio": string|null,',
        '  "vehicleType": string|null,',
        '  "confidence": number,',
        '  "warnings": string[]',
        '}',
        '',
        'Texto OCR:',
        text
      ].join('\n')
    });

    return {
      placa: normalizePlate(data?.placa),
      renavam: String(data?.renavam || '').replace(/\D/g, '').slice(0, 11) || null,
      chassi: String(data?.chassi || '').replace(/\s+/g, '').toUpperCase() || null,
      marca: String(data?.marca || '').trim() || null,
      modelo: String(data?.modelo || '').trim() || null,
      anoFabricacao: normalizeYear(data?.anoFabricacao),
      anoModelo: normalizeYear(data?.anoModelo),
      cor: String(data?.cor || '').trim() || null,
      combustivel: String(data?.combustivel || '').trim() || null,
      categoria: String(data?.categoria || '').trim() || null,
      uf: normalizeUpper(data?.uf),
      municipio: String(data?.municipio || '').trim() || null,
      vehicleType: String(data?.vehicleType || '').trim().toLowerCase() || null,
      confidence: clamp01(data?.confidence),
      warnings: normalizeWarnings(data?.warnings),
      extractedBy: this.model,
      extractionMethod: 'openai',
      extractedAt: new Date().toISOString(),
      metadata: {
        source: metadata?.source || 'unknown',
        textLength: Number(metadata?.textLength || text.length || 0)
      }
    };
  }

  async extractVehicleFromImageBuffer(imageBuffer, metadata = {}) {
    const data = await this.#requestStructuredExtractionFromImage({
      systemPrompt:
        'Você extrai dados de documentos veiculares brasileiros. Responda APENAS JSON válido, sem markdown. Use null quando não houver dado.',
      userPrompt: [
        'Extraia os campos abaixo do CRLV/documento do veículo na imagem enviada.',
        'Retorne JSON exatamente com estas chaves:',
        '{',
        '  "placa": string|null,',
        '  "renavam": string|null,',
        '  "chassi": string|null,',
        '  "marca": string|null,',
        '  "modelo": string|null,',
        '  "anoFabricacao": number|null,',
        '  "anoModelo": number|null,',
        '  "cor": string|null,',
        '  "combustivel": string|null,',
        '  "categoria": string|null,',
        '  "uf": string|null,',
        '  "municipio": string|null,',
        '  "vehicleType": string|null,',
        '  "confidence": number,',
        '  "warnings": string[]',
        '}'
      ].join('\n'),
      imageBuffer
    });

    return {
      placa: normalizePlate(data?.placa),
      renavam: String(data?.renavam || '').replace(/\D/g, '').slice(0, 11) || null,
      chassi: String(data?.chassi || '').replace(/\s+/g, '').toUpperCase() || null,
      marca: String(data?.marca || '').trim() || null,
      modelo: String(data?.modelo || '').trim() || null,
      anoFabricacao: normalizeYear(data?.anoFabricacao),
      anoModelo: normalizeYear(data?.anoModelo),
      cor: String(data?.cor || '').trim() || null,
      combustivel: String(data?.combustivel || '').trim() || null,
      categoria: String(data?.categoria || '').trim() || null,
      uf: normalizeUpper(data?.uf),
      municipio: String(data?.municipio || '').trim() || null,
      vehicleType: String(data?.vehicleType || '').trim().toLowerCase() || null,
      confidence: clamp01(data?.confidence),
      warnings: normalizeWarnings(data?.warnings),
      extractedBy: this.model,
      extractionMethod: 'openai_image',
      extractedAt: new Date().toISOString(),
      metadata: {
        source: metadata?.source || 'unknown',
        imageBytes: Number(metadata?.imageBytes || imageBuffer?.length || 0)
      }
    };
  }

  async #requestStructuredExtraction({ systemPrompt, userPrompt }) {
    if (!this.enabled) {
      throw new Error('OPENAI_API_KEY não configurada');
    }

    const response = await axios.post(
      `${this.baseUrl}/chat/completions`,
      {
        model: this.model,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ]
      },
      {
        timeout: this.timeoutMs,
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json'
        }
      }
    );

    const content = response?.data?.choices?.[0]?.message?.content;
    if (!content) {
      logger.warn('⚠️ Resposta da IA sem conteúdo estruturado', {
        model: this.model,
        responsePreview: JSON.stringify(response?.data || {}).slice(0, 800)
      });
      throw new Error('IA retornou resposta sem conteúdo');
    }

    return normalizeJsonContent(content);
  }

  async #requestStructuredExtractionFromImage({ systemPrompt, userPrompt, imageBuffer }) {
    if (!this.enabled) {
      throw new Error('OPENAI_API_KEY não configurada');
    }

    if (!imageBuffer || !Buffer.isBuffer(imageBuffer) || imageBuffer.length === 0) {
      throw new Error('Imagem inválida para extração');
    }

    const imageBase64 = imageBuffer.toString('base64');
    const imageMimeType = detectImageMimeType(imageBuffer);
    const response = await axios.post(
      `${this.baseUrl}/chat/completions`,
      {
        model: this.model,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: systemPrompt },
          {
            role: 'user',
            content: [
              { type: 'text', text: userPrompt },
              {
                type: 'image_url',
                image_url: {
                  url: `data:${imageMimeType};base64,${imageBase64}`
                }
              }
            ]
          }
        ]
      },
      {
        timeout: this.timeoutMs,
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json'
        }
      }
    );

    const content = response?.data?.choices?.[0]?.message?.content;
    if (!content) {
      logger.warn('⚠️ Resposta multimodal da IA sem conteúdo estruturado', {
        model: this.model,
        responsePreview: JSON.stringify(response?.data || {}).slice(0, 800)
      });
      throw new Error('IA retornou resposta sem conteúdo');
    }

    return normalizeJsonContent(content);
  }
}

module.exports = new DocumentAIExtractionService();
