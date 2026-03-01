/**
 * SETUP LISTENERS
 * 
 * Configura todos os listeners do sistema.
 */

const { getEventBus } = require('./index');
const { EVENT_TYPES } = require('../events');
const notifyPassenger = require('./onRideAccepted.notifyPassenger');
const notifyDriver = require('./onRideAccepted.notifyDriver');
const sendPush = require('./onRideAccepted.sendPush');
const notifyDrivers = require('./onRideRequested.notifyDrivers');
const startTripTimer = require('./onRideStarted.startTripTimer');
const { logger } = require('../utils/logger');

/**
 * Configurar todos os listeners
 * @param {Object} io - Socket.IO instance
 */
function setupListeners(io) {
    const eventBus = getEventBus(io);

    // ✅ ARCHITECTURE SHIFT: EDA Refactoring
    // Todos os listeners de negócio pesado (notifyPassenger, notifyDriver, sendPush, startTripTimer, etc)
    // foram movidos para `workers/listener-worker.js`. Eles agora consomem o Redis Stream `ride_events`
    // garantindo processamento distribuído, retry e sobrevivência do estado entre reinicializações do Node.

    logger.info('✅ [setupListeners] O EventBus local foi enxugado (Listeners migrados para WorkerManager)');

    return eventBus;
}

module.exports = setupListeners;

