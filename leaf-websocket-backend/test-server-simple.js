const express = require('express');
const cors = require('cors');
const DockerMonitor = require('./monitoring/docker-monitor');

const app = express();
app.use(cors());
app.use(express.json());

// Instanciar DockerMonitor
const dockerMonitor = new DockerMonitor();

// Rota de teste
app.get('/', (req, res) => {
    res.json({ 
        status: 'running', 
        message: 'Teste de métricas funcionando!',
        timestamp: new Date().toISOString()
    });
});

// Rota de métricas
app.get('/metrics', async (req, res) => {
    try {
        console.log('📊 Obtendo métricas...');
        
        // Executar verificação
        await dockerMonitor.performChecks();
        
        // Obter relatório
        const report = dockerMonitor.getFullReport();
        
        console.log('📊 Relatório obtido:', {
            containerStatus: report.container?.status,
            redisStatus: report.redis?.status,
            uptime: report.container?.uptime,
            alerts: report.alerts?.length
        });
        
        res.json({
            timestamp: new Date().toISOString(),
            container: report.container,
            redis: report.redis,
            system: report.system,
            host: report.host,
            alerts: report.alerts,
            summary: report.summary
        });
        
    } catch (error) {
        console.error('❌ Erro ao obter métricas:', error);
        res.status(500).json({ 
            error: error.message,
            stack: error.stack 
        });
    }
});

// Inicializar servidor
const PORT = 3001;
app.listen(PORT, () => {
    console.log(`🚀 Servidor de teste rodando na porta ${PORT}`);
    console.log(`🔗 URL: http://localhost:${PORT}`);
    console.log('✅ Pronto para testar métricas!');
}); 