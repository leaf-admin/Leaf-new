import Logger from '../utils/Logger';
import { getTextFromFrame } from 'expo-text-recognition';
import * as FileSystem from 'expo-file-system';
import { normalizeVehicleData } from './vehicle-catalog';


// Importar lista de marcas do mercado brasileiro
const brazilBrands = require('./brazil-brands.json');

/**
 * Serviço de OCR para extrair dados de documentos de veículo (CRLV)
 * 
 * Arquitetura: OCR no device (MLKit) -> Regex extraction -> Validation -> Structured data
 */

// Regex patterns para extrair dados do CRLV brasileiro
const PATTERNS = {
    // Placa: SEMPRE começa com letra!
    // Antiga: LLLNNNN (3 letras + 4 números) - exemplo: ABC1234
    // Mercosul: LLLNLNN (3 letras + 1 número + 1 letra + 2 números) - exemplo: ABC1D23, QQO0G16
    PLACA_ANTIGA: /[A-Z]{3}[0-9]{4}/g, // 3 letras + 4 números
    PLACA_MERCOSUL: /[A-Z]{3}[0-9][A-Z][0-9]{2}/g, // 3 letras + 1 número + 1 letra + 2 números
    PLACA: /[A-Z]{3}[0-9][A-Z0-9][0-9]{2}/g, // Mercosul (compatível)
    
    // RENAVAM: 11 dígitos
    RENAVAM: /\b\d{11}\b/g,
    
    // Ano: 4 dígitos entre 1950 e ano atual + 1
    ANO: /\b(19[5-9]\d|20[0-3]\d)\b/g,
    
    // UF: 2 letras maiúsculas
    UF: /\b(AC|AL|AP|AM|BA|CE|DF|ES|GO|MA|MT|MS|MG|PA|PB|PR|PE|PI|RJ|RN|RS|RO|RR|SC|SP|SE|TO)\b/g,
    
    // Chassi: 17 caracteres alfanuméricos
    CHASSI: /\b[A-HJ-NPR-Z0-9]{17}\b/g,
    
    // Marca/Modelo: palavras comuns de marcas brasileiras
    MARCA: /\b(TOYOTA|HONDA|VOLKSWAGEN|CHEVROLET|FORD|FIAT|HYUNDAI|NISSAN|BMW|MERCEDES|RENAULT|PEUGEOT|CITROEN|JEEP|RAM|DODGE|MITSUBISHI|SUZUKI|KIA|VOLVO|AUDI|LAND\s*ROVER|JAGUAR)\b/gi,
};

// Mapeamento de marcas comuns (normalização)
const MARCA_MAP = {
    'TOYOTA': 'Toyota',
    'HONDA': 'Honda',
    'VOLKSWAGEN': 'Volkswagen',
    'VW': 'Volkswagen',
    'CHEVROLET': 'Chevrolet',
    'CHEV': 'Chevrolet',
    'FORD': 'Ford',
    'FIAT': 'Fiat',
    'HYUNDAI': 'Hyundai',
    'NISSAN': 'Nissan',
    'BMW': 'BMW',
    'MERCEDES': 'Mercedes-Benz',
    'MERCEDES BENZ': 'Mercedes-Benz',
    'RENAULT': 'Renault',
    'PEUGEOT': 'Peugeot',
    'CITROEN': 'Citroën',
    'JEEP': 'Jeep',
    'RAM': 'Ram',
    'DODGE': 'Dodge',
    'MITSUBISHI': 'Mitsubishi',
    'SUZUKI': 'Suzuki',
    'KIA': 'Kia',
    'VOLVO': 'Volvo',
    'AUDI': 'Audi',
};

/**
 * Normaliza texto: remove acentos, converte para maiúsculas, remove espaços extras
 * MELHORADO: Remove caracteres especiais que podem confundir OCR
 */
function normalizeText(text) {
    if (!text) return '';
    
    return text
        .toUpperCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '') // Remove acentos
        .replace(/[^A-Z0-9\/ ]/g, ' ') // Remove caracteres especiais (mantém / e espaços)
        .replace(/\s+/g, ' ') // Remove espaços múltiplos
        .trim();
}

/**
 * Corrige confusão comum do OCR em placas: Q/0, O/0, Q/9
 * REGRA: Placa SEMPRE começa com LETRA (LLLNNNN ou LLLNLNN)
 * Se encontrar padrão que começa com número, tenta corrigir
 */
function corrigirOCRPlaca(placa) {
    if (!placa || placa.length !== 7) return placa;
    
    // Se já começa com letra, está ok
    if (/^[A-Z]/.test(placa)) return placa;
    
    // Padrão comum: "9000G16" pode ser "QQO0G16" (Q confundido com 9/0)
    // Formato esperado: LLLNLNN (Mercosul) - SEMPRE começa com letra!
    if (/^9[0-9]{2}0[A-Z][0-9]{2}$/.test(placa)) {
        // Corrigir: 9000G16 -> QQO0G16
        // 9 -> Q (primeiro Q confundido com 9)
        // 0 -> Q (segundo Q confundido com 0)
        // 0 -> O (O confundido com 0)
        // 0 -> 0 (número mesmo)
        const corrigida = 'Q' + 'Q' + 'O' + placa.substring(3);
        Logger.log(`🔧 Placa corrigida (Q/0): ${placa} -> ${corrigida}`);
        return corrigida;
    }
    
    // Outro padrão: "9XXXGXX" pode ser "QXXXGXX" (primeiro Q confundido com 9)
    if (/^9[A-Z0-9]{6}$/.test(placa) && /[A-Z]/.test(placa)) {
        // Se tem letra depois, provavelmente é placa Mercosul
        // Primeiro 9 -> Q
        const corrigida = 'Q' + placa.substring(1);
        Logger.log(`🔧 Placa corrigida (9->Q): ${placa} -> ${corrigida}`);
        return corrigida;
    }
    
    // Se começa com 0, pode ser Q ou O confundido
    if (/^0[A-Z0-9]{6}$/.test(placa) && /[A-Z]/.test(placa)) {
        // Tentar Q primeiro (mais comum)
        const corrigida = 'Q' + placa.substring(1);
        Logger.log(`🔧 Placa corrigida (0->Q): ${placa} -> ${corrigida}`);
        return corrigida;
    }
    
    return placa;
}

/**
 * Extrai placa do texto
 * REGRA: SEMPRE extrair do campo "PLACA" - nunca de outro lugar!
 * IMPORTANTE: Placa SEMPRE começa com letra!
 * - Antiga: LLLNNNN (3 letras + 4 números) - exemplo: ABC1234
 * - Mercosul: LLLNLNN (3 letras + 1 número + 1 letra + 2 números) - exemplo: QQO0G16
 * 
 * PROBLEMA: OCR pode confundir Q com 0, então "QQO0G16" vira "9000G16"
 * SOLUÇÃO: Buscar padrão que pode ter Q confundido com 0 e tentar corrigir
 */
function extractPlaca(text) {
    const normalized = normalizeText(text);
    
    // MÚLTIPLAS TENTATIVAS para encontrar o campo PLACA
    // O OCR pode ler de formas diferentes, então tentamos vários padrões
    
    // Padrão 1: Buscar linha após "PLACA" e "CODIGO RENAVAM"
    // Estrutura: PLACA\nCODIGO RENAVAM\n01188473104\n9000G16
    const linhas = normalized.split('\n');
    const indicePlaca = linhas.findIndex(l => /^PLACA$/i.test(l.trim()));
    if (indicePlaca !== -1) {
        // Procurar linha com "CODIGO RENAVAM" ou "RENAVAM"
        for (let i = indicePlaca + 1; i < linhas.length && i < indicePlaca + 5; i++) {
            if (/CODIGO\s*RENAVAM|RENAVAM/i.test(linhas[i])) {
                // Próxima linha deve ser o RENAVAM (11 dígitos)
                // Linha seguinte deve ser a PLACA
                if (i + 2 < linhas.length) {
                    const linhaPossivelPlaca = linhas[i + 2].trim();
                    if (/^[A-Z0-9]{7}$/.test(linhaPossivelPlaca)) {
                        let placa = linhaPossivelPlaca;
                        
                        // Se começa com número, corrigir erro OCR
                        if (/^[0-9]/.test(placa)) {
                            placa = corrigirOCRPlaca(placa);
                        }
                        
                        // Validar formato
                        if (placa.length === 7 && /^[A-Z]{3}([0-9]{4}|[0-9][A-Z][0-9]{2})$/.test(placa)) {
                            Logger.log('✅ Placa extraída do campo PLACA (padrão 1 - linha):', placa);
                            return placa;
                        }
                    }
                }
                break;
            }
        }
    }
    
    // Padrão 2: "PLACA" seguido de quebra de linha e depois a placa
    // Exemplo: "PLACA\nQQO0G16" ou "PLACA\n 9000G16" (OCR confundiu Q com 0)
    let match = normalized.match(/PLACA\s*\n\s*([A-Z0-9]{7})/i);
    if (match && match[1]) {
        let placa = match[1].trim();
        
        // Se começa com número, corrigir erro OCR
        if (/^[0-9]/.test(placa)) {
            placa = corrigirOCRPlaca(placa);
        }
        
        // Validar formato: LLLNNNN ou LLLNLNN (SEMPRE começa com letra!)
        if (placa.length === 7 && /^[A-Z]{3}([0-9]{4}|[0-9][A-Z][0-9]{2})$/.test(placa)) {
            Logger.log('✅ Placa extraída do campo PLACA (padrão 2):', placa);
            return placa;
        }
    }
    
    // Padrão 3: Buscar após "PLACA" e antes de "CODIGO RENAVAM" ou "RENAVAM"
    // Aceita qualquer padrão de 7 caracteres que pode ser placa (com ou sem quebra de linha)
    match = normalized.match(/PLACA[\s\S]{0,200}?([A-Z0-9]{7})[\s\S]{0,50}?(?:CODIGO\s*RENAVAM|RENAVAM)/i);
    if (match && match[1]) {
        let placa = match[1].trim();
        
        // Se começa com número, corrigir erro OCR
        if (/^[0-9]/.test(placa)) {
            placa = corrigirOCRPlaca(placa);
        }
        
        // Validar formato: LLLNNNN ou LLLNLNN (SEMPRE começa com letra!)
        if (placa.length === 7 && /^[A-Z]{3}([0-9]{4}|[0-9][A-Z][0-9]{2})$/.test(placa)) {
            Logger.log('✅ Placa extraída do campo PLACA (padrão 3):', placa);
            return placa;
        }
    }
    
    // Padrão 4: Buscar entre "PLACA" e próximo campo (mais flexível)
    // Aceita padrão que pode ter erro de OCR (sem quebra de linha obrigatória)
    match = normalized.match(/PLACA[\s\S]{0,200}?([A-Z0-9]{7})/i);
    if (match && match[1]) {
        let placa = match[1].trim();
        
        // Se começa com número, corrigir erro OCR
        if (/^[0-9]/.test(placa)) {
            placa = corrigirOCRPlaca(placa);
        }
        
        // Validar formato: LLLNNNN ou LLLNLNN (SEMPRE começa com letra!)
        if (placa.length === 7 && /^[A-Z]{3}([0-9]{4}|[0-9][A-Z][0-9]{2})$/.test(placa)) {
            Logger.log('✅ Placa extraída do campo PLACA (padrão 4):', placa);
            return placa;
        }
    }
    
    // Padrão 5: Buscar diretamente padrão de placa Mercosul no texto (fallback)
    // Exemplo: QQO0G16, ABC1D23
    match = normalized.match(/\b([A-Z]{3}[0-9][A-Z][0-9]{2})\b/);
    if (match && match[1]) {
        let placa = match[1].trim();
        Logger.log('✅ Placa extraída (padrão 5 - fallback Mercosul):', placa);
        return placa;
    }
    
    // Padrão 6: Buscar padrão de placa antiga (fallback)
    // Exemplo: ABC1234
    match = normalized.match(/\b([A-Z]{3}[0-9]{4})\b/);
    if (match && match[1]) {
        let placa = match[1].trim();
        Logger.log('✅ Placa extraída (padrão 6 - fallback antiga):', placa);
        return placa;
    }
    
    Logger.warn('⚠️ Placa não encontrada');
    return null;
}

/**
 * Extrai RENAVAM do texto
 * REGRA: Buscar 11 dígitos consecutivos, priorizando após "RENAVAM" ou "CODIGO RENAVAM"
 */
function extractRenavam(text) {
    const normalized = normalizeText(text);
    
    // Padrão 1: Buscar após "RENAVAM" ou "CODIGO RENAVAM"
    let match = normalized.match(/(?:CODIGO\s*)?RENAVAM[\s\S]{0,200}?(\d{11})/i);
    if (match && match[1]) {
        Logger.log('✅ RENAVAM extraído do campo RENAVAM:', match[1]);
        return match[1];
    }
    
    // Padrão 2: Buscar qualquer sequência de 11 dígitos (priorizar os que começam com 0 ou 1)
    const matches = normalized.match(/\b\d{11}\b/g);
    if (matches && matches.length > 0) {
        // Filtrar RENAVAMs válidos (geralmente começa com 0 ou 1, não é CPF)
        // RENAVAM geralmente começa com 0 ou 1
        let renavam = matches.find(m => /^[01]/.test(m));
        if (!renavam) {
            // Se não encontrar começando com 0 ou 1, pegar o primeiro que não seja CPF
            // CPF geralmente tem padrão específico, RENAVAM é mais aleatório
            renavam = matches[0];
        }
        Logger.log('✅ RENAVAM extraído (padrão genérico):', renavam);
        return renavam;
    }
    
    Logger.warn('⚠️ RENAVAM não encontrado');
    return null;
}

/**
 * Extrai ano do texto
 * REGRA: Priorizar ano após "ANO FABRICAÇÃO" ou "ANO MODELO"
 */
function extractAno(text) {
    const normalized = normalizeText(text);
    
    // Padrão 1: Buscar após "ANO FABRICAÇÃO" ou "ANO MODELO"
    let match = normalized.match(/ANO\s*(?:FABRICACAO|MODELO)[\s\S]*?(\d{4})/i);
    if (match && match[1]) {
        const ano = parseInt(match[1]);
        const currentYear = new Date().getFullYear();
        if (ano >= 1950 && ano <= currentYear + 1) {
            Logger.log('✅ Ano extraído do campo ANO FABRICAÇÃO/MODELO:', ano);
            return ano.toString();
        }
    }
    
    // Padrão 2: Buscar qualquer ano válido
    const matches = normalized.match(PATTERNS.ANO);
    if (matches && matches.length > 0) {
        const currentYear = new Date().getFullYear();
        const validYears = matches
            .map(m => parseInt(m))
            .filter(year => year >= 1950 && year <= currentYear + 1);
        
        if (validYears.length > 0) {
            // Retorna o ano mais recente (geralmente é o ano do veículo)
            const ano = Math.max(...validYears).toString();
            Logger.log('✅ Ano extraído (padrão genérico):', ano);
            return ano;
        }
    }
    
    Logger.warn('⚠️ Ano não encontrado');
    return null;
}

/**
 * Extrai UF do texto
 * REGRA: Priorizar UF após "PLACA ANTERIOR / UF" ou junto com placa
 */
function extractUF(text) {
    const normalized = normalizeText(text);
    
    // Padrão 1: Buscar após "PLACA ANTERIOR / UF" ou "PLACA / UF"
    let match = normalized.match(/PLACA\s*(?:ANTERIOR)?\s*\/\s*UF[\s\S]*?\/\s*([A-Z]{2})/i);
    if (match && match[1]) {
        Logger.log('✅ UF extraída do campo PLACA/UF:', match[1]);
        return match[1];
    }
    
    // Padrão 2: Buscar UF junto com placa (ex: QQO0G16/RJ ou QQO0G16RJ)
    // IMPORTANTE: Garantir que não pega parte da placa (QQO0G16/RJ, não QQ)
    // Buscar padrão: placa seguida de / e depois 2 letras (UF)
    match = normalized.match(/([A-Z]{3}[0-9][A-Z0-9][0-9]{2})\/([A-Z]{2})/);
    if (match && match[2]) {
        const uf = match[2];
        // Validar que é UF válida usando o padrão
        const ufMatch = uf.match(PATTERNS.UF);
        if (ufMatch) {
            Logger.log('✅ UF extraída junto com placa:', uf);
            return uf;
        }
    }
    
    // Padrão 2b: Buscar UF após placa sem barra (ex: QQO0G16RJ)
    match = normalized.match(/([A-Z]{3}[0-9][A-Z0-9][0-9]{2})([A-Z]{2})(?![A-Z0-9])/);
    if (match && match[2]) {
        const uf = match[2];
        const ufMatch = uf.match(PATTERNS.UF);
        if (ufMatch) {
            Logger.log('✅ UF extraída após placa (sem barra):', uf);
            return uf;
        }
    }
    
    // Padrão 3: Buscar após "UF" ou "ESTADO"
    match = normalized.match(/(?:UF|ESTADO)[\s\S]{0,100}?([A-Z]{2})/i);
    if (match && match[1]) {
        Logger.log('✅ UF extraída do campo UF/ESTADO:', match[1]);
        return match[1];
    }
    
    // Padrão 4: Buscar qualquer UF válida
    const matches = normalized.match(PATTERNS.UF);
    if (matches && matches.length > 0) {
        // Priorizar RJ, SP, MG (mais comuns) ou retornar primeira
        const ufPrioritaria = matches.find(m => ['RJ', 'SP', 'MG'].includes(m)) || matches[0];
        Logger.log('✅ UF extraída (padrão genérico):', ufPrioritaria);
        return ufPrioritaria;
    }
    
    Logger.warn('⚠️ UF não encontrada');
    return null;
}

/**
 * Extrai chassi do texto
 * REGRA: Buscar 17 caracteres alfanuméricos, priorizando após "CHASSI"
 */
function extractChassi(text) {
    const normalized = normalizeText(text);
    
    // Padrão 1: Buscar após "CHASSI"
    let match = normalized.match(/CHASSI[\s\S]*?([A-HJ-NPR-Z0-9]{17})/i);
    if (match && match[1]) {
        Logger.log('✅ Chassi extraído do campo CHASSI:', match[1]);
        return match[1];
    }
    
    // Padrão 2: Buscar qualquer chassi válido (17 caracteres alfanuméricos)
    const matches = normalized.match(PATTERNS.CHASSI);
    if (matches && matches.length > 0) {
        // Filtrar chassi válido (não pode ter I, O, Q - letras proibidas)
        const chassi = matches.find(m => !/[IOQ]/.test(m)) || matches[0];
        Logger.log('✅ Chassi extraído (padrão genérico):', chassi);
        return chassi;
    }
    
    Logger.warn('⚠️ Chassi não encontrado');
    return null;
}

/**
 * Normaliza nome de marca usando lista do mercado brasileiro
 * Ex: "VW" -> "Volkswagen", "CHEV" -> "Chevrolet"
 */
function normalizeBrandName(rawBrand) {
    if (!rawBrand) return null;
    
    const normalized = rawBrand.toUpperCase().trim();
    const brandsList = brazilBrands.brands_brazil_market.map(b => b.toUpperCase());
    
    // Mapeamento de abreviações comuns
    const abbreviationMap = {
        'VW': 'VOLKSWAGEN',
        'CHEV': 'CHEVROLET',
        'CHEVY': 'CHEVROLET',
        'GM': 'CHEVROLET',
        'MB': 'MERCEDES-BENZ',
        'MBZ': 'MERCEDES-BENZ',
        'LR': 'LAND ROVER',
        'RR': 'ROLLS-ROYCE',
    };
    
    // Verificar se é abreviação conhecida
    if (abbreviationMap[normalized]) {
        const fullName = abbreviationMap[normalized];
        const foundBrand = brazilBrands.brands_brazil_market.find(b => 
            b.toUpperCase() === fullName
        );
        if (foundBrand) {
            return foundBrand;
        }
    }
    
    // Buscar match exato
    const exactMatch = brazilBrands.brands_brazil_market.find(b => 
        b.toUpperCase() === normalized
    );
    if (exactMatch) {
        return exactMatch;
    }
    
    // Buscar match parcial (contém)
    const partialMatch = brazilBrands.brands_brazil_market.find(b => {
        const brandUpper = b.toUpperCase();
        return normalized.includes(brandUpper) || brandUpper.includes(normalized);
    });
    if (partialMatch) {
        return partialMatch;
    }
    
    // Se não encontrou, retornar o original (pode ser uma marca não listada)
    return rawBrand;
}

/**
 * Extrai marca e modelo do padrão MARCA/MODELO
 * REGRA: Sempre buscar padrão "MARCA/MODELO" no campo "MARCA / MODELO / VERSÃO"
 * Estrutura: sempre tem uma barra "/" separando marca e modelo
 */
function extractMarcaModeloFromPattern(text) {
    const normalized = normalizeText(text);
    
    // Padrão principal: Buscar após "MARCA / MODELO / VERSÃO" o padrão MARCA/MODELO
    // Exemplo: "MARCA / MODELO / VERSÃO\nVW/SAVEIRO" ou "MARCA / MODELO / VERSÃO VW/SAVEIRO"
    let match = normalized.match(/MARCA\s*\/\s*MODELO\s*\/\s*VERSAO[\s\S]{0,300}?([A-Z0-9\s]{2,20})\s*\/\s*([A-Z0-9\s]{3,30})/i);
    
    if (match && match[1] && match[2]) {
        const marcaRaw = match[1].trim();
        const modeloRaw = match[2].trim();
        
        // Normalizar marca usando lista do mercado brasileiro
        const marcaNormalizada = normalizeBrandName(marcaRaw);
        
        if (marcaNormalizada) {
            Logger.log('✅ Marca/Modelo extraídos do padrão MARCA/MODELO:', marcaNormalizada, '/', modeloRaw);
            return {
                marca: marcaNormalizada,
                modelo: modeloRaw
            };
        }
    }
    
    // Padrão alternativo: Buscar qualquer padrão MARCA/MODELO próximo a palavras-chave
    match = normalized.match(/([A-Z0-9\s]{2,20})\s*\/\s*([A-Z0-9\s]{3,30})/);
    if (match && match[1] && match[2]) {
        const contexto = normalized.substring(
            Math.max(0, normalized.indexOf(match[0]) - 50),
            Math.min(normalized.length, normalized.indexOf(match[0]) + match[0].length + 50)
        );
        
        // Verificar se está próximo de palavras-chave relacionadas a veículo
        if (/MARCA|MODELO|VEICULO|AUTOMOVEL|VERSAO/i.test(contexto)) {
            const marcaRaw = match[1].trim();
            const modeloRaw = match[2].trim();
            const marcaNormalizada = normalizeBrandName(marcaRaw);
            
            if (marcaNormalizada) {
                Logger.log('✅ Marca/Modelo extraídos (padrão alternativo):', marcaNormalizada, '/', modeloRaw);
                return {
                    marca: marcaNormalizada,
                    modelo: modeloRaw
                };
            }
        }
    }
    
    return null;
}

/**
 * Extrai marca do texto
 * REGRA: SEMPRE extrair do campo "MARCA / MODELO / VERSÃO" usando padrão MARCA/MODELO
 * IMPORTANTE: Usar lista de marcas do mercado brasileiro para normalização
 */
function extractMarca(text) {
    const normalized = normalizeText(text);
    
    // Primeiro, tentar extrair usando padrão MARCA/MODELO
    const marcaModelo = extractMarcaModeloFromPattern(text);
    if (marcaModelo && marcaModelo.marca) {
        return marcaModelo.marca;
    }
    
    // Fallback: Buscar marca isolada (método antigo)
    const palavrasExcluidas = ['ANTERIOR', 'MODELO', 'VERSAO', 'PLACA', 'UF', 'CODIGO', 'RENAVAM', 'ESPECIE', 'TIPO'];
    
    // Padrão 1: "MARCA / MODELO / VERSÃO" seguido de quebra de linha e depois VW/SAVEIRO
    let match = normalized.match(/MARCA\s*\/\s*MODELO\s*\/\s*VERSAO[\s\S]{0,200}?([A-Z0-9]{2,15})\s*\/\s*([A-Z\s]+)/i);
    if (match && match[1]) {
        const marca = match[1].trim();
        // Validar que não é palavra excluída
        if (!palavrasExcluidas.includes(marca) && marca.length >= 2 && marca.length <= 15) {
            const marcaNormalizada = normalizeBrandName(marca);
            Logger.log('✅ Marca extraída do campo MARCA/MODELO/VERSÃO (padrão 1):', marcaNormalizada);
            return marcaNormalizada;
        }
    }
    
    // Padrão 1b: Buscar diretamente padrão MARCA/MODELO no texto (fallback)
    // Exemplo: "VW/NOVA SAVEIRO" em qualquer lugar do texto
    match = normalized.match(/\b([A-Z]{2,15})\s*\/\s*[A-Z\s]{4,}/);
    if (match && match[1]) {
        const marca = match[1].trim();
        // Validar que não é palavra excluída e não é número
        if (!palavrasExcluidas.includes(marca) && marca.length >= 2 && marca.length <= 15 && !/^\d+$/.test(marca)) {
            // Verificar se está perto de palavras relacionadas a veículo
            const contexto = normalized.substring(Math.max(0, normalized.indexOf(marca) - 50), normalized.indexOf(marca) + 100);
            if (/MARCA|MODELO|VEICULO|AUTOMOVEL/i.test(contexto)) {
                Logger.log('✅ Marca extraída (padrão 1b - fallback):', marca);
                return MARCA_MAP[marca] || marca;
            }
        }
    }
    
    // Padrão 2: Buscar especificamente após "MARCA / MODELO / VERSÃO" e antes de próximo campo
    // Exemplo: "MARCA / MODELO / VERSÃO\nVW/NOVA SAVEIRO\nPLACA ANTERIOR"
    match = normalized.match(/MARCA\s*\/\s*MODELO\s*\/\s*VERSAO[\s\S]*?\n\s*([A-Z0-9]{2,15})\s*\/\s*[A-Z]/i);
    if (match && match[1]) {
        const marca = match[1].trim();
        if (!palavrasExcluidas.includes(marca) && marca.length >= 2 && marca.length <= 15) {
            Logger.log('✅ Marca extraída do campo MARCA/MODELO/VERSÃO (padrão 2):', marca);
            return MARCA_MAP[marca] || marca;
        }
    }
    
    // Padrão 3: Buscar linha que contém "/" após "MARCA / MODELO / VERSÃO"
    // Exemplo: linha com "VW/NOVA SAVEIRO" após o cabeçalho
    const linhas = normalized.split('\n');
    const indiceMarcaModelo = linhas.findIndex(l => /MARCA\s*\/\s*MODELO\s*\/\s*VERSAO/i.test(l));
    if (indiceMarcaModelo !== -1 && indiceMarcaModelo + 1 < linhas.length) {
        const linhaApos = linhas[indiceMarcaModelo + 1].trim();
        const matchLinha = linhaApos.match(/^([A-Z0-9]{2,15})\s*\/\s*([A-Z\s]+)/);
        if (matchLinha && matchLinha[1]) {
            const marca = matchLinha[1].trim();
            if (!palavrasExcluidas.includes(marca) && marca.length >= 2 && marca.length <= 15) {
                Logger.log('✅ Marca extraída do campo MARCA/MODELO/VERSÃO (padrão 3 - linha):', marca);
                return MARCA_MAP[marca] || marca;
            }
        }
    }
    
    Logger.warn('⚠️ Marca não encontrada no campo MARCA/MODELO/VERSÃO');
    return null;
}

/**
 * Extrai modelo do texto
 * REGRA: SEMPRE extrair do campo "MARCA / MODELO / VERSÃO" (direita da barra)
 * IMPORTANTE: Usar padrão MARCA/MODELO para extração precisa
 */
function extractModelo(text) {
    const normalized = normalizeText(text);
    
    // Primeiro, tentar extrair usando padrão MARCA/MODELO
    const marcaModelo = extractMarcaModeloFromPattern(text);
    if (marcaModelo && marcaModelo.modelo) {
        const modeloCompleto = marcaModelo.modelo.trim();
        // Limpar modelo: remover palavras comuns e pegar o modelo principal
        const palavras = modeloCompleto.split(/\s+/);
        const palavrasExcluidas = ['MODELO', 'VERSAO', 'MARCA', 'ANTERIOR', 'PLACA', 'NOVA', 'RB', 'MBVS'];
        const palavrasValidas = palavras.filter(p => 
            p.length >= 3 && 
            !/^\d+$/.test(p) && 
            !palavrasExcluidas.includes(p.toUpperCase())
        );
        if (palavrasValidas.length > 0) {
            // Pegar primeira palavra significativa (ex: "NOVA SAVEIRO RB MBVS" -> "SAVEIRO")
            const modelo = palavrasValidas.find(p => p.length >= 4) || palavrasValidas[0];
            Logger.log('✅ Modelo extraído do padrão MARCA/MODELO:', modelo);
            return modelo;
        }
        // Se não conseguiu limpar, retornar o modelo completo
        return modeloCompleto;
    }
    
    // Fallback: Buscar modelo isolado (método antigo)
    const palavrasExcluidas = ['MODELO', 'VERSAO', 'MARCA', 'ANTERIOR', 'PLACA'];
    
    // Padrão 1: "MARCA / MODELO / VERSÃO" seguido de quebra de linha e depois VW/SAVEIRO
    let match = normalized.match(/MARCA\s*\/\s*MODELO\s*\/\s*VERSAO[\s\S]{0,200}?[A-Z0-9]+\s*\/\s*([A-Z\s]+)/i);
    if (match && match[1]) {
        const modeloCompleto = match[1].trim();
        // Pegar primeira palavra significativa (ex: "NOVA SAVEIRO RB MBVS" -> "SAVEIRO")
        const palavras = modeloCompleto.split(/\s+/);
        const palavrasValidas = palavras.filter(p => 
            p.length >= 3 && 
            !/^\d+$/.test(p) && 
            !palavrasExcluidas.includes(p)
        );
        if (palavrasValidas.length > 0) {
            // Pular palavras comuns como "NOVA", "RB", etc e pegar o modelo principal
            const modelo = palavrasValidas.find(p => p.length >= 4) || palavrasValidas[0];
            Logger.log('✅ Modelo extraído do campo MARCA/MODELO/VERSÃO (padrão 1):', modelo);
            return modelo;
        }
    }
    
    // Padrão 1b: Buscar diretamente padrão MARCA/MODELO no texto (fallback)
    // Exemplo: "VW/NOVA SAVEIRO" em qualquer lugar do texto
    match = normalized.match(/\b[A-Z]{2,15}\s*\/\s*([A-Z\s]{4,})/);
    if (match && match[1]) {
        const modeloCompleto = match[1].trim();
        const palavras = modeloCompleto.split(/\s+/);
        const palavrasValidas = palavras.filter(p => 
            p.length >= 3 && 
            !/^\d+$/.test(p) && 
            !palavrasExcluidas.includes(p)
        );
        if (palavrasValidas.length > 0) {
            // Verificar se está perto de palavras relacionadas a veículo
            const contexto = normalized.substring(Math.max(0, normalized.indexOf(match[0]) - 50), normalized.indexOf(match[0]) + 100);
            if (/MARCA|MODELO|VEICULO|AUTOMOVEL/i.test(contexto)) {
                const modelo = palavrasValidas.find(p => p.length >= 4) || palavrasValidas[0];
                Logger.log('✅ Modelo extraído (padrão 1b - fallback):', modelo);
                return modelo;
            }
        }
    }
    
    // Padrão 2: Buscar linha que contém "/" após "MARCA / MODELO / VERSÃO"
    // Exemplo: linha com "VW/NOVA SAVEIRO RB MBVS" após o cabeçalho
    const linhas = normalized.split('\n');
    const indiceMarcaModelo = linhas.findIndex(l => /MARCA\s*\/\s*MODELO\s*\/\s*VERSAO/i.test(l));
    if (indiceMarcaModelo !== -1 && indiceMarcaModelo + 1 < linhas.length) {
        const linhaApos = linhas[indiceMarcaModelo + 1].trim();
        const matchLinha = linhaApos.match(/^[A-Z0-9]+\s*\/\s*([A-Z\s]+)/);
        if (matchLinha && matchLinha[1]) {
            const modeloCompleto = matchLinha[1].trim();
            const palavras = modeloCompleto.split(/\s+/);
            const palavrasValidas = palavras.filter(p => 
                p.length >= 3 && 
                !/^\d+$/.test(p) && 
                !palavrasExcluidas.includes(p)
            );
            if (palavrasValidas.length > 0) {
                const modelo = palavrasValidas.find(p => p.length >= 4) || palavrasValidas[0];
                Logger.log('✅ Modelo extraído do campo MARCA/MODELO/VERSÃO (padrão 2 - linha):', modelo);
                return modelo;
            }
        }
    }
    
    Logger.warn('⚠️ Modelo não encontrado no campo MARCA/MODELO/VERSÃO');
    return null;
}

/**
 * Extrai cor do veículo do texto
 * REGRA: Buscar no campo "COR PREDOMINANTE" ou "COR"
 */
function extractCor(text) {
    const normalized = normalizeText(text);
    
    // Lista de cores conhecidas (normalizadas)
    const coresConhecidas = [
        'BRANCO', 'BRANCA',
        'PRETO', 'PRETA',
        'PRATA',
        'CINZA', 'CINZA',
        'AZUL',
        'VERMELHO', 'VERMELHA',
        'VERDE',
        'AMARELO', 'AMARELA',
        'BEGE',
        'DOURADO', 'DOURADA',
        'MARROM',
        'ROSA',
        'LARANJA',
        'ROXO', 'ROXA'
    ];
    
    // Padrão 1: "COR PREDOMINANTE" seguido da cor
    // Exemplo: "COR PREDOMINANTE BRANCA" ou "COR PREDOMINANTE / BRANCA"
    let match = normalized.match(/COR\s*PREDOMINANTE[\s\/\|:]+([A-ZÁÉÍÓÚÇÃÊÔÕ\s]+?)(?:\s*\|\s*COMBUST|$)/i);
    if (match && match[1]) {
        let cor = match[1].trim();
        // Remover caracteres especiais do início
        cor = cor.replace(/^[^\w]+/, '').trim();
        // Remover números do início
        cor = cor.replace(/^\d+\s*/, '').trim();
        // Pegar primeira palavra se tiver múltiplas
        cor = cor.split(/\s*\/\s*/)[0].trim();
        
        // Normalizar para cores conhecidas
        for (const corConhecida of coresConhecidas) {
            if (cor.includes(corConhecida) || corConhecida.includes(cor)) {
                // Normalizar gênero (BRANCA -> BRANCO, PRETA -> PRETO, etc)
                const corNormalizada = normalizarCor(corConhecida);
                Logger.log('✅ Cor extraída do campo COR PREDOMINANTE:', corNormalizada);
                return corNormalizada;
            }
        }
        
        // Se não encontrou cor conhecida mas tem texto válido
        if (cor.length > 0 && cor.length < 20 && !cor.match(/^(COMBUST|PREDOMINANTE|GASOLINA|ETANOL|DIESEL)/i)) {
            Logger.log('✅ Cor extraída (não normalizada):', cor);
            return cor;
        }
    }
    
    // Padrão 2: Apenas "COR" seguido da cor
    match = normalized.match(/COR[\s\/\|:]+([A-ZÁÉÍÓÚÇÃÊÔÕ\s]+?)(?:\s*\|\s*COMBUST|$)/i);
    if (match && match[1]) {
        let cor = match[1].trim();
        cor = cor.replace(/^[^\w]+/, '').trim();
        cor = cor.replace(/^\d+\s*/, '').trim();
        cor = cor.split(/\s*\/\s*/)[0].trim();
        
        // Normalizar para cores conhecidas
        for (const corConhecida of coresConhecidas) {
            if (cor.includes(corConhecida) || corConhecida.includes(cor)) {
                const corNormalizada = normalizarCor(corConhecida);
                Logger.log('✅ Cor extraída do campo COR:', corNormalizada);
                return corNormalizada;
            }
        }
        
        if (cor.length > 0 && cor.length < 20 && !cor.match(/^(COMBUST|PREDOMINANTE|GASOLINA|ETANOL|DIESEL)/i)) {
            Logger.log('✅ Cor extraída (não normalizada):', cor);
            return cor;
        }
    }
    
    // Padrão 3: Buscar cores conhecidas próximas a "COR" ou "PREDOMINANTE"
    for (const corConhecida of coresConhecidas) {
        const corIndex = normalized.indexOf(corConhecida);
        if (corIndex !== -1) {
            const context = normalized.substring(
                Math.max(0, corIndex - 30),
                Math.min(normalized.length, corIndex + corConhecida.length + 30)
            );
            if (context.includes('COR') || context.includes('PREDOMINANTE')) {
                const corNormalizada = normalizarCor(corConhecida);
                Logger.log('✅ Cor extraída por contexto:', corNormalizada);
                return corNormalizada;
            }
        }
    }
    
    Logger.warn('⚠️ Cor não encontrada');
    return null;
}

/**
 * Normaliza cor (remove gênero: BRANCA -> BRANCO, PRETA -> PRETO)
 */
function normalizarCor(cor) {
    const normalizacoes = {
        'BRANCA': 'BRANCO',
        'PRETA': 'PRETO',
        'VERMELHA': 'VERMELHO',
        'AMARELA': 'AMARELO',
        'DOURADA': 'DOURADO',
        'ROXA': 'ROXO'
    };
    
    return normalizacoes[cor] || cor;
}

/**
 * Extrai tipo de veículo (carro ou moto) baseado no campo ESPÉCIE/TIPO
 */
function extractVehicleType(text) {
    const normalized = normalizeText(text);
    
    // Procura pelo campo ESPÉCIE/TIPO
    const especiePattern = /ESPECIE\s*\/\s*TIPO[\s\S]*?\n\s*([A-Z\s]+)/i;
    const especieMatch = normalized.match(especiePattern);
    
    if (especieMatch && especieMatch[1]) {
        const especie = especieMatch[1].trim();
        
        // Palavras-chave que indicam moto
        const motoKeywords = [
            'MOTOCICLETA',
            'MOTO',
            'MOTONETA',
            'CICLOMOTOR',
            'SCOOTER',
            'TRICICLO',
            'QUADRICICLO'
        ];
        
        // Verifica se contém alguma palavra-chave de moto
        const isMoto = motoKeywords.some(keyword => especie.includes(keyword));
        
        return isMoto ? 'moto' : 'carro';
    }
    
    // Fallback: procura por palavras-chave de moto em qualquer lugar do texto
    const motoPattern = /\b(MOTOCICLETA|MOTO|MOTONETA|CICLOMOTOR|SCOOTER)\b/i;
    if (motoPattern.test(normalized)) {
        return 'moto';
    }
    
    // Padrão: se não encontrar indicação de moto, assume carro
    return 'carro';
}

/**
 * Valida dados extraídos
 */
function validateExtractedData(data) {
    const errors = [];
    
    if (!data.placa || data.placa.length !== 7) {
        errors.push('Placa inválida ou não encontrada');
    }
    
    if (!data.renavam || data.renavam.length !== 11) {
        errors.push('RENAVAM inválido ou não encontrado');
    }
    
    if (!data.ano) {
        errors.push('Ano não encontrado');
    } else {
        const ano = parseInt(data.ano);
        const currentYear = new Date().getFullYear();
        if (ano < 1950 || ano > currentYear + 1) {
            errors.push('Ano inválido');
        }
    }
    
    return {
        isValid: errors.length === 0,
        errors
    };
}

/**
 * Processa imagem e extrai dados do CRLV
 * 
 * @param {string} imageUri - URI da imagem do documento
 * @returns {Promise<Object>} Dados extraídos e validados
 */
export async function processCRLVImage(imageUri) {
    try {
        Logger.log('🔍 Iniciando OCR do CRLV...');
        
        // 1. Converter imagem para base64
        const base64 = await FileSystem.readAsStringAsync(imageUri, {
            encoding: FileSystem.EncodingType.Base64,
        });
        
        // 2. Ler texto da imagem usando MLKit
        const textLines = await getTextFromFrame(base64, true); // true = isBase64
        
        if (!textLines || textLines.length === 0) {
            throw new Error('Nenhum texto encontrado na imagem. Certifique-se de que o documento está legível.');
        }
        
        // 3. Juntar todas as linhas em um único texto
        const text = textLines.join('\n');
        
        Logger.log('📄 Texto extraído (primeiros 500 chars):', text.substring(0, 500));
        Logger.log('📄 Texto completo (para debug):', text);
        
        // 4. Extrair campos usando regex
        const rawData = {
            placa: extractPlaca(text),
            renavam: extractRenavam(text),
            ano: extractAno(text),
            uf: extractUF(text),
            chassi: extractChassi(text),
            marca: extractMarca(text),
            modelo: extractModelo(text), // Extrai modelo (não precisa de marca)
            cor: extractCor(text), // Extrai cor do veículo
            vehicleType: extractVehicleType(text), // Extrai tipo: 'carro' ou 'moto'
            rawText: text, // Mantém texto original para debug
        };
        
        Logger.log('✅ Dados extraídos (raw):', rawData);
        
        // 5. Normalizar dados usando catálogo
        const normalizedData = normalizeVehicleData(rawData);
        Logger.log('✅ Dados normalizados:', normalizedData);
        
        // 6. Validar dados
        const validation = validateExtractedData({
            ...rawData,
            ...normalizedData
        });
        
        return {
            success: true,
            data: {
                // Dados canônicos (prioridade)
                ...normalizedData,
                // Dados raw (fallback se normalização falhou)
                placa: normalizedData.plate || rawData.placa,
                renavam: normalizedData.renavam || rawData.renavam,
                ano: normalizedData.year || rawData.ano,
                uf: normalizedData.uf || rawData.uf,
                chassi: normalizedData.chassi || rawData.chassi,
                cor: rawData.cor, // Cor extraída (não precisa normalização)
                vehicleType: normalizedData.vehicle_type || rawData.vehicleType,
                // Dados originais para auditoria
                raw_brand: rawData.marca,
                raw_model: rawData.modelo,
                rawText: text
            },
            validation,
            confidence: normalizedData.confidence || 0.8,
            needs_manual_review: normalizedData.needs_manual_review
        };
        
    } catch (error) {
        Logger.error('❌ Erro no OCR:', error);
        return {
            success: false,
            error: error.message || 'Erro ao processar imagem',
            data: null,
        };
    }
}

/**
 * Extrai texto do PDF usando backend (pdf-parse)
 * Backend apenas extrai texto, mobile processa
 * 
 * @param {string} pdfUri - URI do PDF
 * @returns {Promise<string>} Texto extraído do PDF
 */
export async function extractTextFromPDF(pdfUri) {
    try {
        Logger.log('📄 Extraindo texto do PDF via backend...');
        
        // Verificar se arquivo existe
        const fileInfo = await FileSystem.getInfoAsync(pdfUri);
        if (!fileInfo.exists) {
            throw new Error('Arquivo PDF não encontrado');
        }
        
        // Enviar PDF ao backend para extrair texto
        // IMPORTANTE: Usar selfHostedWebSocket (HTTP) ao invés de selfHostedApi (HTTPS)
        // porque o backend está rodando em HTTP na porta 3001
        // Importar configuração
        const ApiConfig = require('../config/ApiConfig');
        const baseUrl = ApiConfig.getSelfHostedWebSocketUrl();
        
        Logger.log('🔧 [DEBUG] ApiConfig importado:', !!ApiConfig);
        Logger.log('🔧 [DEBUG] getSelfHostedWebSocketUrl existe:', typeof ApiConfig.getSelfHostedWebSocketUrl);
        Logger.log('🌐 Base URL retornada:', baseUrl);
        
        if (!baseUrl) {
            Logger.error('❌ Base URL é null/undefined');
            throw new Error('URL do backend não configurada. Verifique a configuração da API.');
        }
        
        if (baseUrl === 'undefined' || baseUrl === 'null') {
            Logger.error('❌ Base URL é string "undefined" ou "null"');
            throw new Error(`URL do backend inválida: ${baseUrl}. Verifique a configuração da API.`);
        }
        
        const backendUrl = `${baseUrl}/api/ocr/vehicle/extract-text`;
        
        Logger.log('🌐 Base URL:', baseUrl);
        Logger.log('📤 URL completa:', backendUrl);
        Logger.log('📄 PDF URI:', pdfUri);
        
        // Testar se a rota está acessível primeiro
        try {
            const testUrl = `${baseUrl}/api/ocr/test`;
            Logger.log('🧪 Testando rota:', testUrl);
            const testResponse = await fetch(testUrl);
            const testResult = await testResponse.json();
            Logger.log('✅ Teste de rota:', testResult);
        } catch (testError) {
            Logger.warn('⚠️ Teste de rota falhou:', testError.message);
        }
        
        // Criar FormData para React Native
        const formData = new FormData();
        
        // No Android, pode precisar usar o path sem file://
        // Mas vamos tentar com file:// primeiro
        const fileData = {
            uri: pdfUri,
            type: 'application/pdf',
            name: 'crlv.pdf',
        };
        
        formData.append('pdf', fileData);
        Logger.log('📦 FormData preparado:', {
            hasFormData: !!formData,
            fileUri: pdfUri,
        });
        
        // No React Native, não definir Content-Type - o fetch define automaticamente com boundary
        // IMPORTANTE: No Android, pode precisar de timeout maior
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 30000); // 30 segundos
        
        const response = await fetch(backendUrl, {
            method: 'POST',
            body: formData,
            signal: controller.signal,
            headers: {
                // Não definir Content-Type - FormData define automaticamente com boundary
                'Accept': 'application/json',
            },
        }).then((res) => {
            clearTimeout(timeoutId);
            return res;
        }).catch((fetchError) => {
            clearTimeout(timeoutId);
            Logger.error('❌ Erro na requisição fetch:', fetchError);
            Logger.error('❌ Tipo do erro:', fetchError.constructor.name);
            Logger.error('❌ Mensagem:', fetchError.message);
            Logger.error('❌ Stack:', fetchError.stack);
            
            // Mensagem mais amigável
            let errorMsg = 'Não foi possível conectar ao servidor.';
            if (fetchError.message) {
                if (fetchError.message.includes('Network request failed')) {
                    errorMsg = 'Erro de conexão: Verifique sua conexão com a internet e se o servidor está acessível.';
                } else if (fetchError.message.includes('timeout')) {
                    errorMsg = 'Timeout: O servidor demorou muito para responder. Tente novamente.';
                } else {
                    errorMsg = `Erro de conexão: ${fetchError.message}`;
                }
            }
            throw new Error(errorMsg);
        });
        
        if (!response.ok) {
            let errorMessage = `Erro HTTP: ${response.status}`;
            try {
                const errorData = await response.json();
                errorMessage = errorData.error || errorMessage;
            } catch (e) {
                // Se não conseguir ler JSON, usar status
                const text = await response.text().catch(() => '');
                errorMessage = text || errorMessage;
            }
            throw new Error(errorMessage);
        }
        
        const result = await response.json();
        
        if (!result.success || !result.text) {
            throw new Error(result.error || 'Texto não extraído do PDF');
        }
        
        Logger.log('✅ Texto extraído do PDF:', result.text.substring(0, 200) + '...');
        return result.text;
        
    } catch (error) {
        Logger.error('❌ Erro ao extrair texto do PDF:', error);
        // Melhorar mensagem de erro
        if (error.message.includes('Network request failed') || error.message.includes('Failed to fetch')) {
            throw new Error('Erro de conexão: Não foi possível conectar ao servidor. Verifique sua conexão com a internet.');
        }
        throw error;
    }
}

/**
 * Processa texto extraído de PDF do CRLV
 * 
 * @param {string} text - Texto extraído do PDF
 * @returns {Promise<Object>} Dados extraídos
 */
export async function processCRLVText(text) {
    try {
        Logger.log('🔍 Processando texto do CRLV...');
        
        if (!text || text.trim().length === 0) {
            throw new Error('Nenhum texto encontrado no PDF. Certifique-se de que o documento está legível.');
        }
        
        Logger.log('📄 Texto extraído:', text.substring(0, 300) + '...');
        
        // 2. Extrair campos usando regex
        const rawData = {
            placa: extractPlaca(text),
            renavam: extractRenavam(text),
            ano: extractAno(text),
            uf: extractUF(text),
            chassi: extractChassi(text),
            marca: extractMarca(text),
            modelo: extractModelo(text), // Extrai modelo (não precisa de marca)
            cor: extractCor(text), // Extrai cor do veículo
            vehicleType: extractVehicleType(text), // Extrai tipo: 'carro' ou 'moto'
            rawText: text, // Mantém texto original para debug
        };
        
        Logger.log('✅ Dados extraídos (raw):', rawData);
        
        // 3. Normalizar dados usando catálogo
        const normalizedData = normalizeVehicleData(rawData);
        Logger.log('✅ Dados normalizados:', normalizedData);
        
        // 4. Validar dados
        const validation = validateExtractedData({
            ...rawData,
            ...normalizedData
        });
        
        return {
            success: true,
            data: {
                // Dados canônicos (prioridade)
                ...normalizedData,
                // Dados raw (fallback se normalização falhou)
                placa: normalizedData.plate || rawData.placa,
                renavam: normalizedData.renavam || rawData.renavam,
                ano: normalizedData.year || rawData.ano,
                uf: normalizedData.uf || rawData.uf,
                chassi: normalizedData.chassi || rawData.chassi,
                cor: rawData.cor, // Cor extraída (não precisa normalização)
                vehicleType: normalizedData.vehicle_type || rawData.vehicleType,
                // Dados originais para auditoria
                raw_brand: rawData.marca,
                raw_model: rawData.modelo,
                rawText: text
            },
            validation,
            confidence: normalizedData.confidence || 0.9,
            needs_manual_review: normalizedData.needs_manual_review
        };
        
    } catch (error) {
        Logger.error('❌ Erro no processamento:', error);
        return {
            success: false,
            error: error.message || 'Erro ao processar texto do PDF',
            data: null,
        };
    }
}

/**
 * Processa PDF do CRLV
 * Nota: Em produção, você precisaria converter PDF para texto primeiro
 * Isso pode ser feito no backend ou usando uma biblioteca como react-native-pdf
 * 
 * @param {string} pdfUri - URI do PDF
 * @returns {Promise<Object>} Dados extraídos
 */
export async function processCRLVPDF(pdfUri) {
    // Por enquanto, o PDF será processado no backend
    // O backend deve extrair o texto e chamar processCRLVText
    return {
        success: false,
        error: 'Processamento de PDF será feito no backend. O arquivo será enviado para processamento.',
        data: null,
        pdfUri: pdfUri,
    };
}

// Funções já exportadas inline acima
// export { ... } removido para evitar duplicação

