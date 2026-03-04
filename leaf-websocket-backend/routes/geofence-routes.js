const express = require('express');
const router = express.Router();
const { isWithinOperatingArea } = require('../utils/geofence');
const { logStructured, logError } = require('../utils/logger');

/**
 * GET /api/geofence/check
 * Verifica se uma coordenada está dentro da área de operação
 * Query params: lat, lng
 */
router.get('/check', (req, res) => {
    try {
        const { lat, lng } = req.query;

        if (!lat || !lng) {
            return res.status(400).json({
                success: false,
                message: 'Latitude e Longitude são obrigatórias na query (?lat=X&lng=Y)'
            });
        }

        const latitude = parseFloat(lat);
        const longitude = parseFloat(lng);

        if (isNaN(latitude) || isNaN(longitude)) {
            return res.status(400).json({
                success: false,
                message: 'Latitude e Longitude devem ser números válidos'
            });
        }

        const checkResult = isWithinOperatingArea(latitude, longitude);

        res.json({
            success: true,
            isAllowed: checkResult.isAllowed,
            reason: checkResult.reason,
            coordinates: { lat: latitude, lng: longitude }
        });
    } catch (error) {
        logError(error, 'Erro ao verificar geofence', { service: 'geofence-routes' });
        res.status(500).json({
            success: false,
            message: 'Erro interno ao validar área de operação'
        });
    }
});

module.exports = router;
