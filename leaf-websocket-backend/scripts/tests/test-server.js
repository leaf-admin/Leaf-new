const express = require('express');
const app = express();
const PORT = 3001;

// Middleware básico
app.use(express.json());
app.use(cors());

// Rota de teste
app.get('/health', (req, res) => {
    res.json({ 
        status: 'healthy', 
        timestamp: new Date().toISOString(),
        message: 'Servidor de teste funcionando!'
    });
});

// Rota de métricas
app.get('/metrics', (req, res) => {
    res.json({
        status: 'success',
        data: {
            totalUsers: 150,
            activeDrivers: 25,
            completedTrips: 1200,
            revenue: 15000.50
        },
        timestamp: new Date().toISOString()
    });
});

// Iniciar servidor
app.listen(PORT, () => {
    console.log(`🚀 Servidor de teste rodando na porta ${PORT}`);
    console.log(`🔗 URL: http://localhost:${PORT}`);
    console.log('✅ Endpoints disponíveis:');
    console.log('   - GET /health');
    console.log('   - GET /metrics');
});

// Tratamento de erros
process.on('uncaughtException', (err) => {
    console.error('❌ Erro não capturado:', err);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('❌ Promise rejeitada não tratada:', reason);
});


