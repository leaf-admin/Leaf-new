/**
 * Auto-Scaler para LEAF WebSocket Backend
 * 
 * Monitora métricas do sistema e escala automaticamente baseado em:
 * - CPU usage
 * - Memory usage
 * - Active connections
 * - Request rate
 * 
 * Uso:
 *   node scripts/utils/auto-scaler.js
 * 
 * Ou como serviço:
 *   pm2 start scripts/utils/auto-scaler.js --name leaf-auto-scaler
 */

const axios = require('axios');
const { exec } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(exec);

class AutoScaler {
    constructor() {
        this.config = {
            // Limites de instâncias
            minInstances: parseInt(process.env.MIN_INSTANCES || '2'),
            maxInstances: parseInt(process.env.MAX_INSTANCES || '10'),
            
            // Thresholds para scale up
            scaleUpThreshold: {
                cpu: parseFloat(process.env.SCALE_UP_CPU || '70'),
                memory: parseFloat(process.env.SCALE_UP_MEMORY || '75'),
                connections: parseInt(process.env.SCALE_UP_CONNECTIONS || '8000'),
                requestRate: parseInt(process.env.SCALE_UP_REQUEST_RATE || '1000')
            },
            
            // Thresholds para scale down
            scaleDownThreshold: {
                cpu: parseFloat(process.env.SCALE_DOWN_CPU || '30'),
                memory: parseFloat(process.env.SCALE_DOWN_MEMORY || '40'),
                connections: parseInt(process.env.SCALE_DOWN_CONNECTIONS || '2000'),
                requestRate: parseInt(process.env.SCALE_DOWN_REQUEST_RATE || '200')
            },
            
            // Intervalo de verificação (segundos)
            checkInterval: parseInt(process.env.CHECK_INTERVAL || '60'),
            
            // Cooldown entre escalas (segundos)
            scaleCooldown: parseInt(process.env.SCALE_COOLDOWN || '300'), // 5 minutos
            
            // URLs
            metricsUrl: process.env.METRICS_URL || 'http://localhost:3001/api/metrics',
            dockerServiceName: process.env.DOCKER_SERVICE_NAME || 'leaf-websocket'
        };
        
        this.lastScaleTime = 0;
        this.currentInstances = this.config.minInstances;
    }

    /**
     * Obter métricas do sistema
     */
    async getMetrics() {
        try {
            const response = await axios.get(this.config.metricsUrl, {
                timeout: 5000,
                validateStatus: () => true
            });
            
            if (response.status === 200 && response.data) {
                return {
                    cpu: response.data.cpu || null,
                    memory: response.data.memory || null,
                    connections: response.data.connections || null,
                    requestRate: response.data.requestRate || null,
                    timestamp: Date.now()
                };
            }
        } catch (error) {
            console.error('❌ Erro ao obter métricas:', error.message);
        }
        
        // Fallback: métricas do sistema via Docker
        return await this.getDockerMetrics();
    }

    /**
     * Obter métricas via Docker stats
     */
    async getDockerMetrics() {
        try {
            const { stdout } = await execAsync(
                `docker stats --no-stream --format "{{.CPUPerc}},{{.MemPerc}}" ${this.config.dockerServiceName} | head -1`
            );
            
            const [cpu, memory] = stdout.trim().split(',').map(v => parseFloat(v.replace('%', '')));
            
            return {
                cpu: cpu || null,
                memory: memory || null,
                connections: null,
                requestRate: null,
                timestamp: Date.now(),
                source: 'docker'
            };
        } catch (error) {
            console.error('❌ Erro ao obter métricas Docker:', error.message);
            return {
                cpu: null,
                memory: null,
                connections: null,
                requestRate: null,
                timestamp: Date.now(),
                source: 'fallback'
            };
        }
    }

    /**
     * Obter número atual de instâncias
     */
    async getCurrentInstances() {
        try {
            // Docker Swarm
            const { stdout } = await execAsync(
                `docker service ls --filter name=${this.config.dockerServiceName} --format "{{.Replicas}}"`
            );
            
            const replicas = stdout.trim();
            if (replicas) {
                const [current, desired] = replicas.split('/');
                return parseInt(desired) || this.currentInstances;
            }
            
            // Docker Compose
            const { stdout: composeStdout } = await execAsync(
                `docker-compose -f config/docker/docker-compose-ha.yml ps --services --filter "status=running" | grep websocket | wc -l`
            );
            
            return parseInt(composeStdout.trim()) || this.currentInstances;
        } catch (error) {
            console.warn('⚠️ Não foi possível obter número de instâncias, usando cache');
            return this.currentInstances;
        }
    }

    /**
     * Verificar se deve escalar para cima
     */
    shouldScaleUp(metrics) {
        const now = Date.now();
        const timeSinceLastScale = (now - this.lastScaleTime) / 1000;
        
        if (timeSinceLastScale < this.config.scaleCooldown) {
            return false; // Ainda em cooldown
        }
        
        if (this.currentInstances >= this.config.maxInstances) {
            return false; // Já no máximo
        }
        
        // Verificar se algum threshold foi ultrapassado
        const thresholds = this.config.scaleUpThreshold;
        let shouldScale = false;
        
        if (metrics.cpu !== null && metrics.cpu >= thresholds.cpu) {
            console.log(`📈 CPU acima do threshold: ${metrics.cpu}% >= ${thresholds.cpu}%`);
            shouldScale = true;
        }
        
        if (metrics.memory !== null && metrics.memory >= thresholds.memory) {
            console.log(`📈 Memória acima do threshold: ${metrics.memory}% >= ${thresholds.memory}%`);
            shouldScale = true;
        }
        
        if (metrics.connections !== null && metrics.connections >= thresholds.connections) {
            console.log(`📈 Conexões acima do threshold: ${metrics.connections} >= ${thresholds.connections}`);
            shouldScale = true;
        }
        
        if (metrics.requestRate !== null && metrics.requestRate >= thresholds.requestRate) {
            console.log(`📈 Taxa de requisições acima do threshold: ${metrics.requestRate} >= ${thresholds.requestRate}`);
            shouldScale = true;
        }
        
        return shouldScale;
    }

    /**
     * Verificar se deve escalar para baixo
     */
    shouldScaleDown(metrics) {
        const now = Date.now();
        const timeSinceLastScale = (now - this.lastScaleTime) / 1000;
        
        if (timeSinceLastScale < this.config.scaleCooldown) {
            return false; // Ainda em cooldown
        }
        
        if (this.currentInstances <= this.config.minInstances) {
            return false; // Já no mínimo
        }
        
        // Verificar se todos os thresholds estão abaixo
        const thresholds = this.config.scaleDownThreshold;
        let allBelow = true;
        
        if (metrics.cpu !== null && metrics.cpu > thresholds.cpu) {
            allBelow = false;
        }
        
        if (metrics.memory !== null && metrics.memory > thresholds.memory) {
            allBelow = false;
        }
        
        if (metrics.connections !== null && metrics.connections > thresholds.connections) {
            allBelow = false;
        }
        
        if (metrics.requestRate !== null && metrics.requestRate > thresholds.requestRate) {
            allBelow = false;
        }
        
        return allBelow;
    }

    /**
     * Escalar para cima
     */
    async scaleUp() {
        const newInstances = this.currentInstances + 1;
        
        if (newInstances > this.config.maxInstances) {
            console.log(`⚠️ Já no máximo de instâncias: ${this.config.maxInstances}`);
            return;
        }
        
        try {
            console.log(`🚀 Escalando para cima: ${this.currentInstances} → ${newInstances} instâncias`);
            
            // Docker Swarm
            await execAsync(
                `docker service scale ${this.config.dockerServiceName}=${newInstances}`
            );
            
            // Docker Compose (adicionar nova instância)
            // await execAsync(
            //     `docker-compose -f config/docker/docker-compose-ha.yml up -d --scale websocket=${newInstances}`
            // );
            
            this.currentInstances = newInstances;
            this.lastScaleTime = Date.now();
            
            console.log(`✅ Escalado para ${newInstances} instâncias`);
        } catch (error) {
            console.error('❌ Erro ao escalar para cima:', error.message);
        }
    }

    /**
     * Escalar para baixo
     */
    async scaleDown() {
        const newInstances = this.currentInstances - 1;
        
        if (newInstances < this.config.minInstances) {
            console.log(`⚠️ Já no mínimo de instâncias: ${this.config.minInstances}`);
            return;
        }
        
        try {
            console.log(`📉 Escalando para baixo: ${this.currentInstances} → ${newInstances} instâncias`);
            
            // Docker Swarm
            await execAsync(
                `docker service scale ${this.config.dockerServiceName}=${newInstances}`
            );
            
            this.currentInstances = newInstances;
            this.lastScaleTime = Date.now();
            
            console.log(`✅ Escalado para ${newInstances} instâncias`);
        } catch (error) {
            console.error('❌ Erro ao escalar para baixo:', error.message);
        }
    }

    /**
     * Verificar e escalar se necessário
     */
    async checkAndScale() {
        try {
            const metrics = await this.getMetrics();
            this.currentInstances = await this.getCurrentInstances();
            
            console.log(`\n📊 [AutoScaler] Verificando métricas...`);
            console.log(`   CPU: ${metrics.cpu !== null ? metrics.cpu.toFixed(1) + '%' : 'N/A'}`);
            console.log(`   Memória: ${metrics.memory !== null ? metrics.memory.toFixed(1) + '%' : 'N/A'}`);
            console.log(`   Conexões: ${metrics.connections !== null ? metrics.connections : 'N/A'}`);
            console.log(`   Instâncias atuais: ${this.currentInstances}`);
            
            if (this.shouldScaleUp(metrics)) {
                await this.scaleUp();
            } else if (this.shouldScaleDown(metrics)) {
                await this.scaleDown();
            } else {
                console.log(`✅ Métricas dentro dos limites, sem necessidade de escalar`);
            }
        } catch (error) {
            console.error('❌ Erro ao verificar e escalar:', error);
        }
    }

    /**
     * Iniciar auto-scaler
     */
    start() {
        console.log('🚀 Auto-Scaler iniciado');
        console.log(`   Intervalo de verificação: ${this.config.checkInterval}s`);
        console.log(`   Instâncias: ${this.config.minInstances} - ${this.config.maxInstances}`);
        console.log(`   Scale Up: CPU > ${this.config.scaleUpThreshold.cpu}% | Mem > ${this.config.scaleUpThreshold.memory}%`);
        console.log(`   Scale Down: CPU < ${this.config.scaleDownThreshold.cpu}% | Mem < ${this.config.scaleDownThreshold.memory}%`);
        
        // Verificação inicial
        this.checkAndScale();
        
        // Verificações periódicas
        setInterval(() => {
            this.checkAndScale();
        }, this.config.checkInterval * 1000);
    }
}

// Executar se chamado diretamente
if (require.main === module) {
    const scaler = new AutoScaler();
    scaler.start();
}

module.exports = AutoScaler;

