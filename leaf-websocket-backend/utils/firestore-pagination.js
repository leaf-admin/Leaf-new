/**
 * Utilitário para paginação em Firestore
 * 
 * Arquitetura:
 * - Firestore: dados finais e persistentes apenas
 *   - Início/fim da corrida
 *   - Valor final
 *   - Motorista/passageiro
 *   - Logs básicos
 * - NÃO usar Firestore para: polling, tempo real, status volátil, localização
 * 
 * Este utilitário implementa paginação eficiente para evitar
 * carregar todos os dados de uma vez.
 */

const { logger } = require('./logger');

class FirestorePagination {
    /**
     * Paginar query do Firestore
     * @param {Query} query - Query do Firestore
     * @param {number} page - Número da página (começa em 1)
     * @param {number} limit - Limite de documentos por página
     * @param {string} orderBy - Campo para ordenação
     * @param {string} orderDirection - Direção da ordenação ('asc' ou 'desc')
     * @returns {Promise<{data: Array, pagination: Object}>}
     */
    static async paginateQuery(query, page = 1, limit = 50, orderBy = 'createdAt', orderDirection = 'desc') {
        try {
            // Validar parâmetros
            const pageNum = Math.max(1, parseInt(page) || 1);
            const limitNum = Math.min(100, Math.max(1, parseInt(limit) || 50)); // Máximo 100 por página
            const offset = (pageNum - 1) * limitNum;

            // Aplicar ordenação
            let orderedQuery = query.orderBy(orderBy, orderDirection);

            // Se não é a primeira página, precisamos usar startAfter (cursor-based pagination)
            // Para primeira página, apenas limitar
            if (pageNum === 1) {
                orderedQuery = orderedQuery.limit(limitNum);
            } else {
                // Para páginas seguintes, precisamos buscar a página anterior primeiro
                // (Firestore não suporta offset direto)
                const previousPageQuery = query.orderBy(orderBy, orderDirection).limit(offset);
                const previousSnapshot = await previousPageQuery.get();
                
                if (previousSnapshot.empty || previousSnapshot.size < offset) {
                    // Não há dados suficientes para esta página
                    return {
                        data: [],
                        pagination: {
                            page: pageNum,
                            limit: limitNum,
                            total: 0,
                            totalPages: 0,
                            hasNext: false,
                            hasPrev: false
                        }
                    };
                }

                // Último documento da página anterior
                const lastDoc = previousSnapshot.docs[previousSnapshot.docs.length - 1];
                orderedQuery = orderedQuery.startAfter(lastDoc).limit(limitNum);
            }

            // Executar query
            const snapshot = await orderedQuery.get();
            
            // Converter para array
            const data = snapshot.docs.map(doc => ({
                id: doc.id,
                ...doc.data()
            }));

            // Calcular total (aproximado - Firestore não retorna total exato sem contar tudo)
            // Para performance, vamos estimar baseado no tamanho da página atual
            const hasNext = snapshot.size === limitNum; // Se retornou exatamente o limite, provavelmente há mais
            const estimatedTotal = hasNext ? (pageNum * limitNum) + 1 : (pageNum - 1) * limitNum + data.length;

            return {
                data,
                pagination: {
                    page: pageNum,
                    limit: limitNum,
                    total: estimatedTotal, // Estimativa
                    totalPages: Math.ceil(estimatedTotal / limitNum),
                    hasNext,
                    hasPrev: pageNum > 1
                }
            };
        } catch (error) {
            logger.error(`❌ [FirestorePagination] Erro ao paginar query:`, error);
            throw error;
        }
    }

    /**
     * Paginar query do Firebase Realtime Database
     * @param {Reference} ref - Referência do Firebase
     * @param {number} page - Número da página
     * @param {number} limit - Limite de documentos por página
     * @param {string} orderBy - Campo para ordenação
     * @param {string} orderDirection - Direção da ordenação
     * @returns {Promise<{data: Array, pagination: Object}>}
     */
    static async paginateRealtimeDB(ref, page = 1, limit = 50, orderBy = 'createdAt', orderDirection = 'desc') {
        try {
            const pageNum = Math.max(1, parseInt(page) || 1);
            const limitNum = Math.min(100, Math.max(1, parseInt(limit) || 50));
            
            // Firebase Realtime DB não tem paginação nativa eficiente
            // Vamos buscar tudo e paginar em memória (não ideal, mas necessário)
            // TODO: Migrar para Firestore para ter paginação real
            
            let query = ref.orderByChild(orderBy);
            
            if (orderDirection === 'desc') {
                query = query.limitToLast(limitNum * pageNum);
            } else {
                query = query.limitToFirst(limitNum * pageNum);
            }

            const snapshot = await query.once('value');
            const allData = snapshot.val() || {};
            
            // Converter para array e ordenar
            let dataArray = Object.keys(allData).map(key => ({
                id: key,
                ...allData[key]
            }));

            // Ordenar em memória (Firebase Realtime DB ordena, mas precisamos inverter se desc)
            if (orderDirection === 'desc') {
                dataArray = dataArray.reverse();
            }

            // Aplicar paginação
            const startIndex = (pageNum - 1) * limitNum;
            const endIndex = startIndex + limitNum;
            const paginatedData = dataArray.slice(startIndex, endIndex);

            return {
                data: paginatedData,
                pagination: {
                    page: pageNum,
                    limit: limitNum,
                    total: dataArray.length,
                    totalPages: Math.ceil(dataArray.length / limitNum),
                    hasNext: endIndex < dataArray.length,
                    hasPrev: pageNum > 1
                }
            };
        } catch (error) {
            logger.error(`❌ [FirestorePagination] Erro ao paginar Realtime DB:`, error);
            throw error;
        }
    }

    /**
     * Paginar array em memória (fallback)
     * @param {Array} array - Array para paginar
     * @param {number} page - Número da página
     * @param {number} limit - Limite por página
     * @returns {Object}
     */
    static paginateArray(array, page = 1, limit = 50) {
        const pageNum = Math.max(1, parseInt(page) || 1);
        const limitNum = Math.min(100, Math.max(1, parseInt(limit) || 50));
        
        const startIndex = (pageNum - 1) * limitNum;
        const endIndex = startIndex + limitNum;
        const paginatedData = array.slice(startIndex, endIndex);

        return {
            data: paginatedData,
            pagination: {
                page: pageNum,
                limit: limitNum,
                total: array.length,
                totalPages: Math.ceil(array.length / limitNum),
                hasNext: endIndex < array.length,
                hasPrev: pageNum > 1
            }
        };
    }
}

module.exports = FirestorePagination;

