const cron = require('node-cron');
const { logStructured } = require('../utils/logger');
const dailySubscriptionService = require('../services/daily-subscription-service');

async function processSubscriptions() {
    const result = await dailySubscriptionService.processAllDailyCharges();
    logStructured('info', 'Processamento de assinatura via worker de compatibilidade concluído', {
        service: 'cron-subscription',
        success: result.success,
        total: result.total || 0,
        processed: result.processed || 0,
        skipped: result.skipped || 0,
        failed: result.failed || 0
    });
    return result;
}

// Age aos Domingos às 00:00 (Para testes locais, você pode mudar o cron)
const SCHEDULE = '0 0 * * 0';

if (process.env.ENABLE_LEGACY_WEEKLY_SUBSCRIPTION_CRON === 'true') {
    cron.schedule(SCHEDULE, () => {
        processSubscriptions();
    });
    logStructured('warn', `Worker legado de assinatura semanal habilitado. Padrão: ${SCHEDULE}`, { service: 'cron-subscription' });
} else {
    logStructured('info', 'Worker legado semanal de assinatura desabilitado (usa scheduler diário pró-rata no server.js)', { service: 'cron-subscription' });
}

// Se executado diretamente via terminal, a gente roda 1x para teste:
if (require.main === module) {
    processSubscriptions().then(() => {
        console.log('Finalizando mock test script local.');
        process.exit(0);
    });
}

module.exports = {
    processSubscriptions
};
