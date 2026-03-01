/**
 * Utilitário para normalizar queries de Places
 * Converte diferentes variações do mesmo lugar em uma chave única
 * 
 * Exemplo:
 * - "BarraShopping" → "barra_shopping"
 * - "Barra Shopping" → "barra_shopping"
 * - "barra shopping center" → "barra_shopping_center"
 */

/**
 * Normaliza uma query de busca para criar uma chave única de cache
 * @param {string} query - Query original do usuário
 * @returns {string} - Query normalizada
 */
function normalizeQuery(query) {
  if (!query || typeof query !== 'string') {
    return '';
  }

  return query
    .trim()                           // Remove espaços
    // Adicionar underscore antes de letras maiúsculas (camelCase) - ANTES de toLowerCase
    .replace(/([a-z])([A-Z])/g, '$1_$2')
    .toLowerCase()                    // Minúsculas
    .normalize('NFD')                 // Normaliza caracteres especiais
    .replace(/[\u0300-\u036f]/g, '')  // Remove acentos
    .replace(/[^\w\s]/g, '')          // Remove pontuação
    .replace(/\s+/g, '_')             // Espaços vira underscore
    .replace(/_+/g, '_')              // Múltiplos underscores vira um
    .replace(/^_|_$/g, '');           // Remove underscores no início/fim
}

/**
 * Gera variações de uma query para aumentar hit rate
 * @param {string} query - Query original
 * @returns {string[]} - Array de variações normalizadas
 */
function generateQueryVariations(query) {
  const normalized = normalizeQuery(query);
  const variations = [normalized];

  // Remover palavras comuns que podem variar
  const commonWords = ['shopping', 'center', 'centro', 'mall'];
  const words = normalized.split('_');
  
  // Adicionar variação sem palavras comuns
  const withoutCommon = words
    .filter(word => !commonWords.includes(word))
    .join('_');
  
  if (withoutCommon && withoutCommon !== normalized) {
    variations.push(withoutCommon);
  }

  return variations;
}

/**
 * Valida se uma query é válida para busca
 * @param {string} query - Query a validar
 * @returns {boolean} - true se válida
 */
function isValidQuery(query) {
  if (!query || typeof query !== 'string') {
    return false;
  }

  const normalized = normalizeQuery(query);
  
  // Mínimo 3 caracteres após normalização
  if (normalized.length < 3) {
    return false;
  }

  return true;
}

module.exports = {
  normalizeQuery,
  generateQueryVariations,
  isValidQuery
};



