/**
 * 🧾 ROUTES DE RECIBOS
 * 
 * APIs para geração e gerenciamento de recibos de corridas
 */

const express = require('express');
const router = express.Router();
const ReceiptService = require('../services/receipt-service');
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

    return res.status(500).json({
        success: false,
        error: 'Erro interno do servidor'
    });
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

        // Buscar dados da corrida e gerar recibo
        const receipt = await receiptService.getReceiptByRideId(
            rideId,
            req.app.locals.redis,
            req.app.locals.firebaseDb
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

        logger.info(`📋 Listando recibos do usuário: ${userId} (${role})`);

        const firebaseDb = req.app.locals.firebaseDb;
        if (!firebaseDb) {
            return res.status(503).json({
                success: false,
                error: 'Serviço de database não disponível'
            });
        }

        // Buscar corridas do usuário
        let query;
        if (role === 'customer') {
            query = firebaseDb.ref('bookings').orderByChild('customer').equalTo(userId);
        } else if (role === 'driver') {
            query = firebaseDb.ref('bookings').orderByChild('driver').equalTo(userId);
        } else {
            return res.status(400).json({
                success: false,
                error: 'Role deve ser "customer" ou "driver"'
            });
        }

        const snapshot = await query.limitToLast(parseInt(limit)).once('value');
        const bookings = snapshot.val() || {};

        // Filtrar apenas corridas concluídas
        const completedRides = Object.entries(bookings)
            .filter(([_, booking]) =>
                booking.status === 'COMPLETE' ||
                booking.status === 'PAID' ||
                booking.status === 'completed'
            )
            .slice(parseInt(offset));

        // Gerar recibos resumidos
        const receipts = await Promise.all(
            completedRides.map(async ([rideId, rideData]) => {
                try {
                    const receipt = await receiptService.generateReceipt(rideId, rideData);

                    // Retornar versão resumida
                    return {
                        receiptId: receipt.receiptId,
                        rideId: rideId,
                        date: receipt.trip.endTime,
                        totalAmount: receipt.financial.totalPaid.formatted,
                        pickup: receipt.trip.pickup.address,
                        dropoff: receipt.trip.dropoff.address,
                        distance: receipt.trip.distance.actual,
                        duration: receipt.trip.durationFormatted
                    };
                } catch (error) {
                    logger.warn(`⚠️ Erro ao gerar recibo resumido para ${rideId}:`, error.message);
                    return null;
                }
            })
        );

        // Filtrar recibos válidos
        const validReceipts = receipts.filter(receipt => receipt !== null);

        res.json({
            success: true,
            receipts: validReceipts,
            total: validReceipts.length,
            hasMore: completedRides.length === parseInt(limit)
        });

    } catch (error) {
        logger.error(`❌ Erro ao listar recibos do usuário:`, error);
        res.status(500).json({
            success: false,
            error: 'Erro interno do servidor'
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
        const firebaseDb = req.app.locals.firebaseDb;
        const redis = req.app.locals.redis;

        let rideData = null;

        // Tentar Redis primeiro
        if (redis) {
            const redisData = await redis.hget('bookings:active', rideId);
            if (redisData) {
                rideData = JSON.parse(redisData);
            }
        }

        // Buscar no Firebase se não encontrou no Redis
        if (!rideData && firebaseDb) {
            const snapshot = await firebaseDb.ref(`bookings/${rideId}`).once('value');
            rideData = snapshot.val();
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
