require('dotenv').config();
const { initializeFirebase, getFirestore } = require('./firebase-config');
const DashboardWebSocketService = require('./services/dashboard-websocket');
const redis = require('./utils/redis-pool');

async function testMetrics() {
    try {
        // Inicializa o Firebase e o Firestore
        initializeFirebase();
        const firestore = getFirestore();
        if (!firestore) throw new Error("Falha ao inicializar o Firestore");
        console.log('Firebase App initialized at test-script');

        // Mock socket object
        const ioMock = {
            of: () => ({
                on: () => { },
                emit: () => { }
            })
        };

        const service = new DashboardWebSocketService(ioMock, redis);

        console.log('Fetching real-time metrics...');
        const metrics = await service.getRealTimeMetrics();
        console.log('\n--- REAL TIME METRICS RESULT ---\n');
        console.log(JSON.stringify(metrics, null, 2));
    } catch (e) {
        console.error(e);
    } finally {
        redis.quit();
        process.exit(0);
    }
}
testMetrics();
