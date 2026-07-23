/**
 * 🧾 ROUTES DE RECIBOS
 * 
 * APIs para geração e gerenciamento de recibos de corridas
 */

const express = require('express');
const router = express.Router();
const ReceiptService = require('../services/receipt-service');
const firebaseConfig = require('../firebase-config');
const {
    resolveUserPersistenceScope,
    assertStoredRecordMatchesScope
} = require('../services/sandbox-persistence-context');
const {
    authenticateSupport,
    requireSupportRoles,
    isSupportAgent,
    canAccessUserScope
} = require('../middleware/support-auth');
const { logger } = require('../utils/logger');

// Instanciar serviço de recibos
const receiptService = new ReceiptService();

const RECEIPT_ADMIN_ROLES = ['admin', 'manager', 'super-admin', 'support', 'development'];

function normalizeId(value) {
    return String(value || '').trim();
}

function resolveRealtimeDb(req) {
    if (req.app?.locals?.firebaseDb) {
        return req.app.locals.firebaseDb;
    }

    if (typeof firebaseConfig?.getRealtimeDB === 'function') {
        return firebaseConfig.getRealtimeDB();
    }

    return null;
}

function collectRideOwnerIds(rideData = {}) {
    return [
        rideData.customer,
        rideData.customerId,
        rideData.customer_id,
        rideData.customerUid,
        rideData.customer_uid,
        rideData.passengerId,
        rideData.passenger_id,
        rideData.passengerUid,
        rideData.passenger_uid,
        rideData.userId,
        rideData.riderId,
        rideData.driver,
        rideData.driverId,
        rideData.driver_id,
        rideData.driverUid,
        rideData.driver_uid,
        rideData.customer?.id,
        rideData.driver?.id
    ]
        .map(normalizeId)
        .filter(Boolean);
}

function collectReceiptOwnerIds(receipt = {}) {
    return [
        receipt.customer?.id,
        receipt.driver?.id,
        receipt.passengerId,
        receipt.passenger_id,
        receipt.driverId,
        receipt.driver_id,
        receipt.userId
    ]
        .map(normalizeId)
        .filter(Boolean);
}

function canAccessOwnerScopedData(user, ownerIds = []) {
    const requesterId = normalizeId(user?.uid || user?.id);
    if (requesterId && ownerIds.includes(requesterId)) {
        return true;
    }

    return isSupportAgent(user);
}

function requireReceiptUserScope(req, res, next) {
    const { userId } = req.params;
    if (!canAccessUserScope(req.user, userId)) {
        return res.status(403).json({
            success: false,
            error: 'Acesso negado para este usuário'
        });
    }

    return next();
}

async function resolveAuthenticatedReceiptScope(req, targetUserId = null) {
    const actorId = normalizeId(req.user?.uid || req.user?.id);
    const userId = normalizeId(targetUserId || actorId);
    return resolveUserPersistenceScope({
        userId,
        actor: req.user
    });
}

function isReceiptFinancialSnapshotIncomplete(error) {
    return error?.code === 'RECEIPT_FINANCIAL_SNAPSHOT_INCOMPLETE' || error?.statusCode === 409;
}

function sendReceiptRouteError(res, error) {
    if (isReceiptFinancialSnapshotIncomplete(error)) {
        return res.status(409).json({
            success: false,
            code: 'RECEIPT_FINANCIAL_SNAPSHOT_INCOMPLETE',
            error: 'Recibo ainda não reconciliado',
            details: error.details || null
        });
    }

    if (error?.code === 'PERSISTENCE_USER_CLASSIFICATION_UNAVAILABLE') {
        return res.status(503).json({
            success: false,
            code: error.code,
            error: 'Classificação do ambiente do usuário indisponível'
        });
    }

    return res.status(500).json({
        success: false,
        error: 'Erro interno do servidor'
    });
}

function formatReceiptMoney(value) {
    const numeric = Number(value);
    return `R$ ${(Number.isFinite(numeric) ? numeric : 0).toFixed(2).replace('.', ',')}`;
}

function buildStoredReceiptSummary(receipt = {}, role = 'customer') {
    const financial = receipt.financial || {};
    const breakdown = financial.breakdown || {};
    const grossAmount = Number(financial.totalPaid?.amount || 0);
    const driverNetAmount = Number(
        breakdown.driverAmount?.amount ||
        financial.totals?.driverReceived ||
        0
    );
    const operationalFee = Number(
        breakdown.operationalCost?.amount ||
        financial.totals?.leafOperational ||
        0
    );
    const paymentIntermediationFee = Number(
        breakdown.wooviFee?.amount ||
        financial.totals?.wooviFee ||
        0
    );
    const totalFees = Number(
        financial.totals?.retainedFees ||
        operationalFee + paymentIntermediationFee
    );
    const tollAmount = Number(
        breakdown.tollPassThrough?.amount ||
        financial.totals?.tollPassThrough ||
        0
    );
    const completedAt = receipt.trip?.dateTime || receipt.completedAt || receipt.savedAt || receipt.issueDate || null;
    const distanceKm = Number(receipt.trip?.distance?.actual || 0);
    const durationMinutes = Number(receipt.trip?.duration || 0);

    return {
        receiptId: receipt.receiptId,
        rideId: receipt.rideId,
        status: 'completed',
        date: completedAt,
        completedAt,
        totalAmount: financial.totalPaid?.formatted || formatReceiptMoney(grossAmount),
        grossAmount,
        ...(role === 'driver' ? { driverNetAmount } : {}),
        operationalFee,
        paymentIntermediationFee,
        totalFees,
        tollAmount,
        pickup: receipt.trip?.pickup?.address || 'Origem indisponível',
        dropoff: receipt.trip?.dropoff?.address || 'Destino indisponível',
        pickupAddress: receipt.trip?.pickup?.address || 'Origem indisponível',
        destinationAddress: receipt.trip?.dropoff?.address || 'Destino indisponível',
        distance: distanceKm,
        distanceKm,
        duration: durationMinutes,
        durationMinutes,
        driverId: receipt.driver?.id || null,
        driverName: receipt.driver?.name || null,
        passengerId: receipt.customer?.id || null,
        passengerName: receipt.customer?.name || null,
        vehicleLabel: receipt.driver?.vehicle?.brandModel || null,
        vehiclePlate: receipt.driver?.vehicle?.plate || null,
        authoritativeSnapshot: receipt.metadata?.authoritativeSnapshot === true,
        financialSnapshotSource: receipt.metadata?.financialSnapshotSource || null
    };
}

/**
 * 📋 GET /api/receipts/health
 * Health check do serviço de recibos
 */
router.get('/api/receipts/health', (req, res) => {
    res.json({
        success: true,
        service: 'Receipt Service',
        status: 'healthy',
        timestamp: new Date().toISOString(),
        features: {
            receiptGeneration: true,
            mapImages: !!receiptService.GOOGLE_MAPS_API_KEY,
            pdfGeneration: true
        }
    });
});

/**
 * 📋 GET /api/receipts/:rideId
 * Busca e gera recibo para uma corrida específica
 */
router.get('/api/receipts/:rideId', authenticateSupport, async (req, res) => {
    try {
        const { rideId } = req.params;
        const { format = 'json' } = req.query;

        logger.info(`📋 Solicitação de recibo para corrida: ${rideId}`);

        const persistenceScope = await resolveAuthenticatedReceiptScope(req);

        // Buscar dados da corrida e gerar recibo
        const receipt = await receiptService.getReceiptByRideId(
            rideId,
            req.app.locals.redis,
            resolveRealtimeDb(req),
            persistenceScope.financialContext
        );

        if (!receipt) {
            return res.status(404).json({
                success: false,
                error: 'Recibo não encontrado'
            });
        }

        if (!canAccessOwnerScopedData(req.user, collectReceiptOwnerIds(receipt))) {
            return res.status(403).json({
                success: false,
                error: 'Acesso negado para este recibo'
            });
        }

        // Responder conforme formato solicitado
        if (format === 'pdf') {
            try {
                const pdfBuffer = await receiptService.generatePDFReceipt(receipt);

                res.setHeader('Content-Type', 'application/pdf');
                res.setHeader('Content-Disposition', `attachment; filename=recibo-${receipt.receiptId}.pdf`);
                return res.send(pdfBuffer);
            } catch (pdfError) {
                logger.error(`❌ Erro ao gerar PDF do recibo:`, pdfError);
                return res.status(500).json({
                    success: false,
                    error: 'Erro ao gerar o arquivo PDF'
                });
            }
        }

        res.json({
            success: true,
            receipt: receipt
        });

    } catch (error) {
        logger.error(`❌ Erro ao buscar recibo:`, error);
        sendReceiptRouteError(res, error);
    }
});

/**
 * 📋 POST /api/receipts/generate
 * Gera recibo a partir de dados fornecidos
 */
router.post(
    '/api/receipts/generate',
    authenticateSupport,
    requireSupportRoles(RECEIPT_ADMIN_ROLES),
    async (req, res) => {
        try {
            const { rideId, rideData } = req.body;

            if (!rideId || !rideData) {
                return res.status(400).json({
                    success: false,
                    error: 'rideId e rideData são obrigatórios'
                });
            }

            logger.info(`📋 Gerando recibo personalizado para corrida: ${rideId}`);

            const receipt = await receiptService.generateReceipt(rideId, rideData);

            res.json({
                success: true,
                receipt: receipt
            });

        } catch (error) {
            logger.error(`❌ Erro ao gerar recibo:`, error);
            sendReceiptRouteError(res, error);
        }
    }
);

/**
 * 📋 GET /api/receipts/user/:userId
 * Lista recibos de um usuário específico
 */
router.get('/api/receipts/user/:userId', authenticateSupport, requireReceiptUserScope, async (req, res) => {
    try {
        const { userId } = req.params;
        const { limit = 10, offset = 0, role = 'customer' } = req.query;
        const safeLimit = Math.min(50, Math.max(1, Number.parseInt(limit, 10) || 10));
        const safeOffset = Math.max(0, Number.parseInt(offset, 10) || 0);

        if (!['customer', 'driver'].includes(role)) {
            return res.status(400).json({
                success: false,
                error: 'Role deve ser "customer" ou "driver"'
            });
        }

        logger.info(`📋 Listando recibos do usuário: ${userId} (${role})`);

        const firebaseDb = resolveRealtimeDb(req);
        if (!firebaseDb) {
            return res.status(503).json({
                success: false,
                error: 'Serviço de database não disponível'
            });
        }

        const persistenceScope = await resolveAuthenticatedReceiptScope(req, userId);
        const result = await receiptService.listStoredReceiptsByUser({
            firebaseDb,
            userId,
            role,
            financialContext: persistenceScope.financialContext,
            limit: safeLimit,
            offset: safeOffset
        });
        const receipts = result.receipts.map((receipt) => buildStoredReceiptSummary(receipt, role));

        res.json({
            success: true,
            receipts,
            total: result.total,
            limit: result.limit,
            offset: result.offset,
            nextOffset: result.nextOffset,
            hasMore: result.hasMore
        });

    } catch (error) {
        logger.error(`❌ Erro ao listar recibos do usuário:`, error);
        res.status(error?.statusCode || 500).json({
            success: false,
            error: error?.statusCode && error.statusCode < 500
                ? error.message
                : 'Erro interno do servidor'
        });
    }
});

/**
 * 📋 GET /api/receipts/:rideId/map
 * Retorna apenas a URL da imagem do mapa para uma corrida
 */
router.get('/api/receipts/:rideId/map', authenticateSupport, async (req, res) => {
    try {
        const { rideId } = req.params;

        logger.info(`🗺️ Solicitação de mapa para corrida: ${rideId}`);

        // Buscar dados da corrida
        const firebaseDb = resolveRealtimeDb(req);
        const redis = req.app.locals.redis;
        const persistenceScope = await resolveAuthenticatedReceiptScope(req);

        let rideData = null;

        // Tentar Redis primeiro
        if (redis) {
            const redisData = await redis.hget('bookings:active', rideId);
            if (redisData) {
                rideData = JSON.parse(redisData);
                assertStoredRecordMatchesScope(rideData, persistenceScope);
            }
        }

        // Buscar no Firebase se não encontrou no Redis
        if (!rideData && firebaseDb) {
            const snapshot = await firebaseDb
                .ref(`${persistenceScope.collections.bookings}/${rideId}`)
                .once('value');
            rideData = snapshot.val();
            if (rideData) {
                assertStoredRecordMatchesScope(rideData, persistenceScope);
            }
        }

        if (!rideData) {
            return res.status(404).json({
                success: false,
                error: 'Corrida não encontrada'
            });
        }

        if (!canAccessOwnerScopedData(req.user, collectRideOwnerIds(rideData))) {
            return res.status(403).json({
                success: false,
                error: 'Acesso negado para este mapa'
            });
        }

        // Gerar URL da imagem do mapa
        const mapImageUrl = receiptService.generateStaticMapImage(rideData);

        if (!mapImageUrl) {
            return res.status(404).json({
                success: false,
                error: 'Não foi possível gerar imagem do mapa'
            });
        }

        res.json({
            success: true,
            mapImageUrl: mapImageUrl,
            pickup: rideData.pickup,
            dropoff: rideData.drop
        });

    } catch (error) {
        logger.error(`❌ Erro ao gerar mapa da corrida:`, error);
        res.status(500).json({
            success: false,
            error: 'Erro interno do servidor'
        });
    }
});

module.exports = router;
