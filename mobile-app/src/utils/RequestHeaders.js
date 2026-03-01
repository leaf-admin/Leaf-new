/**
 * Gera headers padrão para requisições autenticadas
 * @param {string} token - Token de autenticação
 * @param {Object} additionalHeaders - Headers adicionais
 * @returns {Object} Objeto com headers configurados
 */
export function getAuthenticatedHeaders(token, additionalHeaders = {}) {
    return {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'Authorization': `Bearer ${token}`,
        ...additionalHeaders
    };
}

/**
 * Gera headers padrão para requisições não autenticadas
 * @param {Object} additionalHeaders - Headers adicionais
 * @returns {Object} Objeto com headers configurados
 */
export function getDefaultHeaders(additionalHeaders = {}) {
    return {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        ...additionalHeaders
    };
}

