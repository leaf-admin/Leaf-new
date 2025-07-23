// Configuração para testes realistas do sistema Leaf
// Fluxo: Mobile → WebSocket → Backend → Redis/Firebase

const TEST_CONFIG = {
    // Configuração do backend WebSocket
    WEBSOCKET: {
        HOST: 'localhost',
        PORT: 3001, // Corrigido para a porta correta do backend
        URL: 'http://localhost:3001'
    },
    
    // Configuração do Firebase (usar as mesmas do projeto)
    FIREBASE: {
        apiKey: "AIzaSyChYseG1IcmffYHHVYT7MqtLlzfdWKE_fc",
        authDomain: "leaf-reactnative.firebaseapp.com",
        databaseURL: "https://leaf-reactnative-default-rtdb.firebaseio.com",
        projectId: "leaf-reactnative",
        storageBucket: "leaf-reactnative.firebasestorage.app",
        messagingSenderId: "106504629884",
        appId: "1:106504629884:web:ada50a78fcf7bf3ea1a3f9",
        measurementId: "G-22368DBCY9"
    },
    
    // Configuração do Redis
    REDIS: {
        HOST: 'localhost',
        PORT: 6379,
        URL: 'redis://localhost:6379'
    },
    
    // Timeouts e intervalos
    TIMEOUTS: {
        WEBSOCKET_CONNECTION: 10000, // 10 segundos
        LOCATION_UPDATE: 3000,       // 3 segundos
        RIDE_REQUEST: 5000,          // 5 segundos
        RESPONSE_TIME: 2000,         // 2 segundos
        CLEANUP: 1000                // 1 segundo
    },
    
    // Coordenadas de teste (São Paulo)
    TEST_LOCATIONS: {
        SÃO_PAULO_CENTER: {
            lat: -23.5505,
            lng: -46.6333,
            address: 'Av. Paulista, 1000'
        },
        SÃO_PAULO_NEARBY: {
            lat: -23.5605,
            lng: -46.6433,
            address: 'Rua Augusta, 500'
        }
    },
    
    // IDs de teste
    TEST_IDS: {
        DRIVER_PREFIX: 'test_driver_',
        PASSENGER_PREFIX: 'test_passenger_',
        BOOKING_PREFIX: 'test_booking_'
    }
};

// Função para verificar se o backend está rodando
async function checkBackendStatus() {
    const WebSocket = require('ws');
    
    return new Promise((resolve) => {
        try {
            const ws = new WebSocket(TEST_CONFIG.WEBSOCKET.URL);
            
            ws.on('open', () => {
                ws.close();
                resolve(true);
            });
            
            ws.on('error', () => {
                resolve(false);
            });
            
            // Timeout de 5 segundos
            setTimeout(() => {
                resolve(false);
            }, 5000);
            
        } catch (error) {
            resolve(false);
        }
    });
}

// Função para obter configuração de teste
function getTestConfig() {
    return TEST_CONFIG;
}

// Função para gerar IDs únicos de teste
function generateTestId(prefix) {
    return `${prefix}${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

module.exports = {
    TEST_CONFIG,
    checkBackendStatus,
    getTestConfig,
    generateTestId
}; 