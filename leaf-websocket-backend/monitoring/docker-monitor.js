const { exec } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(exec);
const { Redis } = require('ioredis'); // Adicionado para conexão direta

class DockerMonitor {
    constructor() {
        this.metrics = {
            container: {
                name: 'redis-taxi-app',
                status: 'unknown',
                cpu: 0,
                memory: {
                    usage: 0,
                    limit: 0,
                    percentage: 0
                },
                network: {
                    rx: 0,
                    tx: 0
                },
                uptime: 0,
                lastCheck: 0
            },
            redis: {
                status: 'unknown',
                connections: 0,
                memory: 0,
                operations: 0,
                errors: 0,
                latency: 0,
                lastCheck: 0
            },
            system: {
                totalContainers: 0,
                runningContainers: 0,
                totalImages: 0,
                diskUsage: 0,
                lastCheck: 0
            },
            host: {
                cpu: 0,
                memory: 0,
                uptime: 0,
                lastCheck: 0
            }
        };
        
        this.alerts = [];
        this.monitoringInterval = null;
        this.containerName = 'redis-taxi-app'; // Container Redis que existe
        
        this.startMonitoring();
    }

    // Iniciar monitoramento
    startMonitoring() {
        // Executar verificações imediatamente
        this.performChecks();
        
        // Configurar intervalo
        this.monitoringInterval = setInterval(() => {
            this.performChecks();
        }, 30000); // Verificar a cada 30 segundos
        
        console.log('🐳 Monitoramento Docker iniciado');
    }
    
    // Executar todas as verificações
    async performChecks() {
        try {
            await this.checkContainerStatus();
            await this.checkRedisHealth();
            await this.checkSystemResources();
            await this.checkHostResources();
            this.checkAlerts();
        } catch (error) {
            console.error('❌ Erro durante verificações:', error);
        }
    }

    // Detectar nome do container automaticamente
    async detectContainerName() {
        try {
            const { stdout } = await execAsync('docker ps --format "{{.Names}}"');
            const containers = stdout.trim().split('\n').filter(name => name.trim());
            
            // Procurar por containers que contenham 'leaf', 'websocket', 'backend'
            const possibleNames = ['leaf-websocket-backend', 'leaf-backend', 'websocket-backend', 'backend', 'leaf'];
            
            for (const name of possibleNames) {
                if (containers.includes(name)) {
                    this.containerName = name;
                    console.log(`🐳 Container detectado: ${this.containerName}`);
                    return;
                }
            }
            
            // Se não encontrar container do backend, procurar por Redis
            const redisContainers = containers.filter(name => name.includes('redis'));
            if (redisContainers.length > 0) {
                this.containerName = redisContainers[0];
                console.log(`🐳 Container Redis detectado: ${this.containerName}`);
                return;
            }
            
            // Se não encontrar nenhum container específico, usar o primeiro disponível
            if (containers.length > 0) {
                this.containerName = containers[0];
                console.log(`🐳 Usando primeiro container disponível: ${this.containerName}`);
            } else {
                console.log(`🐳 Nenhum container encontrado, usando nome padrão: ${this.containerName}`);
            }
            
        } catch (error) {
            console.log(`🐳 Erro ao detectar container, usando nome padrão: ${this.containerName}`);
        }
    }

    // Verificar status do container
    async checkContainerStatus() {
        try {
            // Primeiro, tentar detectar o container se não estiver definido
            if (!this.containerName || this.containerName === 'leaf-websocket-backend') {
                await this.detectContainerName();
            }
            
            // Verificar se o container está rodando
            const { stdout: inspectOutput } = await execAsync(`docker inspect ${this.containerName} --format='{{.State.Status}}'`);
            const containerStatus = inspectOutput.trim().replace(/['"]/g, ''); // Remover aspas
            
            if (containerStatus === 'running') {
                try {
                    // Obter estatísticas do container
                    const { stdout } = await execAsync(`docker stats ${this.containerName} --no-stream --format "table {{.CPUPerc}}\t{{.MemUsage}}\t{{.NetIO}}\t{{.BlockIO}}"`);
                    
                    if (stdout.trim()) {
                        const lines = stdout.trim().split('\n');
                        if (lines.length > 1) {
                            const stats = lines[1].split(/\s+/);
                            
                            // Parsear CPU
                            const cpuPercent = parseFloat(stats[0].replace('%', ''));
                            
                            // Parsear memória
                            const memUsage = stats[1];
                            const [used, limit] = memUsage.split('/');
                            const usedBytes = this.parseMemoryString(used);
                            const limitBytes = this.parseMemoryString(limit);
                            const memPercentage = (usedBytes / limitBytes) * 100;
                            
                            // Parsear rede
                            const netIO = stats[2];
                            const [rx, tx] = netIO.split('/');
                            
                            this.metrics.container = {
                                name: this.containerName,
                                status: 'running',
                                cpu: cpuPercent,
                                memory: {
                                    usage: usedBytes,
                                    limit: limitBytes,
                                    percentage: memPercentage
                                },
                                network: {
                                    rx: this.parseMemoryString(rx),
                                    tx: this.parseMemoryString(tx)
                                },
                                uptime: await this.getContainerUptime(),
                                lastCheck: Date.now()
                            };
                        }
                    } else {
                        // Container rodando mas sem estatísticas
                        this.metrics.container = {
                            name: this.containerName,
                            status: 'running',
                            cpu: 0,
                            memory: { usage: 0, limit: 0, percentage: 0 },
                            network: { rx: 0, tx: 0 },
                            uptime: await this.getContainerUptime(),
                            lastCheck: Date.now()
                        };
                    }
                } catch (statsError) {
                    // Se não conseguir obter stats, pelo menos marcar como rodando
                    this.metrics.container = {
                        name: this.containerName,
                        status: 'running',
                        cpu: 0,
                        memory: { usage: 0, limit: 0, percentage: 0 },
                        network: { rx: 0, tx: 0 },
                        uptime: await this.getContainerUptime(),
                        lastCheck: Date.now()
                    };
                    console.log(`⚠️ Container ${this.containerName} está rodando mas não foi possível obter estatísticas detalhadas`);
                }
            } else {
                // Container não está rodando
                this.metrics.container.status = containerStatus;
                this.addAlert('CONTAINER_STOPPED', `Container ${this.containerName} não está rodando (status: ${containerStatus})`, 'critical');
            }
            
        } catch (error) {
            this.metrics.container.status = 'error';
            this.addAlert('CONTAINER_ERROR', `Erro ao verificar container: ${error.message}`, 'error');
            console.error('❌ Erro ao verificar container:', error);
        }
    }

    // Verificar saúde do Redis (dentro do Docker)
    async checkRedisHealth() {
        try {
            const startTime = Date.now();
            
            // Tentar diferentes nomes de container Redis
            let redisContainerName = 'redis-taxi-app';
            let stdout = '';
            
            try {
                // Primeiro tenta o container detectado
                stdout = (await execAsync(`docker exec ${redisContainerName} redis-cli ping`)).stdout;
            } catch (error) {
                try {
                    // Depois tenta 'redis'
                    stdout = (await execAsync('docker exec redis redis-cli ping')).stdout;
                    redisContainerName = 'redis';
                } catch (error2) {
                    try {
                        // Depois tenta 'leaf-redis'
                        stdout = (await execAsync('docker exec leaf-redis redis-cli ping')).stdout;
                        redisContainerName = 'leaf-redis';
                    } catch (error3) {
                        // Por último, tenta conectar diretamente
                        const redis = new Redis({
                            host: 'localhost',
                            port: 6379,
                            lazyConnect: true,
                            retryDelayOnFailover: 100,
                            maxRetriesPerRequest: 3
                        });
                        await redis.ping();
                        await redis.disconnect();
                        stdout = 'PONG';
                        redisContainerName = 'localhost';
                    }
                }
            }
            
            if (stdout.trim() === 'PONG') {
                // Obter informações do Redis
                let info, memory, stats;
                
                if (redisContainerName !== 'localhost') {
                    try {
                        info = await execAsync(`docker exec ${redisContainerName} redis-cli info`);
                        memory = await execAsync(`docker exec ${redisContainerName} redis-cli info memory`);
                        stats = await execAsync(`docker exec ${redisContainerName} redis-cli info stats`);
                    } catch (error) {
                        // Se não conseguir obter info do container, usar conexão direta
                        const redis = new Redis({
                            host: 'localhost',
                            port: 6379,
                            lazyConnect: true
                        });
                        info = { stdout: await redis.info() };
                        memory = { stdout: await redis.info('memory') };
                        stats = { stdout: await redis.info('stats') };
                        await redis.disconnect();
                    }
                } else {
                    // Se conectando diretamente, usar comandos locais
                    const redis = new Redis({
                        host: 'localhost',
                        port: 6379,
                        lazyConnect: true
                    });
                    info = { stdout: await redis.info() };
                    memory = { stdout: await redis.info('memory') };
                    stats = { stdout: await redis.info('stats') };
                    await redis.disconnect();
                }
                
                // Parsear informações
                const memoryInfo = this.parseRedisInfo(memory.stdout);
                const statsInfo = this.parseRedisInfo(stats.stdout);
                
                this.metrics.redis = {
                    status: 'connected',
                    connections: parseInt(statsInfo.connected_clients || 0),
                    memory: parseInt(memoryInfo.used_memory_human || 0),
                    operations: parseInt(statsInfo.total_commands_processed || 0),
                    errors: parseInt(statsInfo.total_errors_received || 0),
                    latency: Date.now() - startTime,
                    lastCheck: Date.now(),
                    memoryUsage: memoryInfo.used_memory_human,
                    memoryPeak: memoryInfo.used_memory_peak_human
                };
                
                console.log(`🔴 Redis conectado: ${this.metrics.redis.connections} conexões, ${this.metrics.redis.latency}ms latência`);
            } else {
                this.metrics.redis.status = 'disconnected';
                this.addAlert('REDIS_DISCONNECTED', 'Redis não está respondendo', 'critical');
            }
            
        } catch (error) {
            this.metrics.redis.status = 'error';
            this.metrics.redis.errors++;
            this.addAlert('REDIS_ERROR', `Erro ao conectar com Redis: ${error.message}`, 'error');
            console.error('❌ Erro ao verificar Redis:', error);
        }
    }

    // Verificar recursos do sistema Docker
    async checkSystemResources() {
        try {
            // Obter informações do sistema Docker (compatível com Windows)
            const { stdout: containers } = await execAsync('docker ps -q');
            const { stdout: runningContainers } = await execAsync('docker ps --format "table {{.Names}}"');
            const { stdout: images } = await execAsync('docker images -q');
            const { stdout: diskUsage } = await execAsync('docker system df --format "table {{.Type}}\t{{.TotalCount}}\t{{.Size}}"');
            
            // Contar containers (Windows não tem wc, então contamos manualmente)
            const containerCount = containers.trim() ? containers.trim().split('\n').length : 0;
            const runningCount = runningContainers.trim() ? runningContainers.trim().split('\n').length - 1 : 0; // Subtrair header
            const imageCount = images.trim() ? images.trim().split('\n').length : 0;
            
            this.metrics.system = {
                totalContainers: containerCount,
                runningContainers: runningCount,
                totalImages: imageCount,
                diskUsage: this.parseDockerDiskUsage(diskUsage),
                lastCheck: Date.now()
            };
            
            console.log(`📊 Sistema Docker: ${runningCount} containers rodando, ${imageCount} imagens, ${this.metrics.system.diskUsage} bytes em uso`);
            
        } catch (error) {
            console.error('❌ Erro ao verificar recursos do sistema Docker:', error);
            // Definir valores padrão em caso de erro
            this.metrics.system = {
                totalContainers: 0,
                runningContainers: 0,
                totalImages: 0,
                diskUsage: 0,
                lastCheck: Date.now()
            };
        }
    }

    // Verificar recursos do host (Windows) - DESABILITADO para focar no container
    async checkHostResources() {
        // Desabilitado - foco apenas no container
        this.metrics.host = {
            cpu: 0,
            memory: 0,
            uptime: 0,
            lastCheck: Date.now(),
            totalMemory: 0,
            usedMemory: 0,
            freeMemory: 0
        };
    }

    // Obter uptime do container
    async getContainerUptime() {
        try {
            // Usar docker inspect para obter StartedAt
            const { stdout } = await execAsync(`docker inspect ${this.containerName} --format='{{.State.StartedAt}}'`);
            const startTimeStr = stdout.trim();
            
            if (!startTimeStr || startTimeStr === '') {
                console.log('⚠️ Não foi possível obter StartedAt do container');
                return 0;
            }
            
            const startTime = new Date(startTimeStr);
            const uptimeSeconds = Math.floor((Date.now() - startTime.getTime()) / 1000);
            
            console.log(`📅 Container ${this.containerName} uptime: ${uptimeSeconds}s (${Math.floor(uptimeSeconds / 3600)}h ${Math.floor((uptimeSeconds % 3600) / 60)}m)`);
            
            return uptimeSeconds;
        } catch (error) {
            console.error('❌ Erro ao obter uptime do container:', error.message);
            return 0;
        }
    }

    // Parsear string de memória (ex: "5.6MB", "1.2GB")
    parseMemoryString(memoryStr) {
        const match = memoryStr.match(/^([\d.]+)([KMGT]?B)$/);
        if (!match) return 0;
        
        const [, value, unit] = match;
        const numValue = parseFloat(value);
        
        switch (unit) {
            case 'B': return numValue;
            case 'KB': return numValue * 1024;
            case 'MB': return numValue * 1024 * 1024;
            case 'GB': return numValue * 1024 * 1024 * 1024;
            case 'TB': return numValue * 1024 * 1024 * 1024 * 1024;
            default: return numValue;
        }
    }

    // Parsear informações do Redis
    parseRedisInfo(info) {
        const lines = info.split('\r\n');
        const result = {};
        
        for (const line of lines) {
            if (line.includes(':')) {
                const [key, value] = line.split(':');
                result[key] = value;
            }
        }
        
        return result;
    }

    // Parsear uso de disco do Docker
    parseDockerDiskUsage(diskUsage) {
        try {
            const lines = diskUsage.trim().split('\n');
            let totalSize = 0;
            
            for (const line of lines) {
                if (line.includes('Images') || line.includes('Containers') || line.includes('Volumes')) {
                    const parts = line.split(/\s+/);
                    if (parts.length >= 3) {
                        totalSize += this.parseMemoryString(parts[2]);
                    }
                }
            }
            
            return totalSize;
        } catch (error) {
            return 0;
        }
    }

    // Adicionar alerta
    addAlert(type, message, severity = 'warning') {
        // Limpar alertas antigos primeiro
        this.cleanupOldAlerts();
        
        const alert = {
            id: `${type}_${Date.now()}`,
            type,
            message,
            severity,
            timestamp: Date.now(),
            acknowledged: false
        };
        
        this.alerts.push(alert);
        
        // Manter apenas os últimos 20 alertas (reduzido de 50)
        if (this.alerts.length > 20) {
            this.alerts = this.alerts.slice(-20);
        }
        
        console.log(`🚨 ALERTA DOCKER [${severity.toUpperCase()}]: ${message}`);
        
        return alert;
    }

    // Verificar alertas
    checkAlerts() {
        const now = Date.now();
        
        // Verificar uso de CPU do container
        if (this.metrics.container.cpu > 80) {
            this.addAlert('HIGH_CPU', `Uso de CPU alto: ${this.metrics.container.cpu.toFixed(2)}%`, 'warning');
        }
        
        // Verificar uso de memória do container
        if (this.metrics.container.memory.percentage > 80) {
            this.addAlert('HIGH_MEMORY', `Uso de memória alto: ${this.metrics.container.memory.percentage.toFixed(2)}%`, 'warning');
        }
        
        // Verificar latência do Redis
        if (this.metrics.redis.latency > 1000) { // Aumentado de 100ms para 1000ms
            this.addAlert('REDIS_HIGH_LATENCY', `Latência do Redis alta: ${this.metrics.redis.latency}ms`, 'warning');
        }
        
        // Verificar se o container está respondendo
        if (now - this.metrics.container.lastCheck > 60000) {
            this.addAlert('CONTAINER_UNRESPONSIVE', 'Container não está respondendo', 'critical');
        }
        
        // Verificar se o Redis está respondendo
        if (now - this.metrics.redis.lastCheck > 60000) {
            this.addAlert('REDIS_UNRESPONSIVE', 'Redis não está respondendo', 'critical');
        }
    }

    // Obter relatório completo
    getFullReport() {
        return {
            timestamp: Date.now(),
            container: this.metrics.container,
            redis: this.metrics.redis,
            system: this.metrics.system,
            host: this.metrics.host,
            alerts: this.alerts.filter(alert => !alert.acknowledged),
            summary: this.getSummary()
        };
    }

    // Obter resumo
    getSummary() {
        const activeAlerts = this.alerts.filter(alert => !alert.acknowledged);
        const criticalAlerts = activeAlerts.filter(alert => alert.severity === 'critical');
        const errorAlerts = activeAlerts.filter(alert => alert.severity === 'error');
        const warningAlerts = activeAlerts.filter(alert => alert.severity === 'warning');
        
        return {
            status: criticalAlerts.length > 0 ? 'critical' : 
                   errorAlerts.length > 0 ? 'error' : 
                   warningAlerts.length > 0 ? 'warning' : 'healthy',
            totalAlerts: activeAlerts.length,
            criticalAlerts: criticalAlerts.length,
            errorAlerts: errorAlerts.length,
            warningAlerts: warningAlerts.length,
            containerStatus: this.metrics.container.status,
            redisStatus: this.metrics.redis.status,
            uptime: this.metrics.container.uptime
        };
    }

    // Reconhecer alerta
    acknowledgeAlert(alertId) {
        const alert = this.alerts.find(a => a.id === alertId);
        if (alert) {
            alert.acknowledged = true;
            console.log(`✅ Alerta reconhecido: ${alertId}`);
        }
    }

    // Limpar alertas antigos
    cleanupOldAlerts() {
        const oneHourAgo = Date.now() - 3600000; // 1 hora atrás (reduzido de 1 dia)
        const beforeCount = this.alerts.length;
        this.alerts = this.alerts.filter(alert => alert.timestamp > oneHourAgo);
        const afterCount = this.alerts.length;
        
        if (beforeCount !== afterCount) {
            console.log(`🧹 Limpos ${beforeCount - afterCount} alertas antigos (mantidos ${afterCount})`);
        }
    }

    // Parar monitoramento
    stopMonitoring() {
        if (this.monitoringInterval) {
            clearInterval(this.monitoringInterval);
            this.monitoringInterval = null;
            console.log('🛑 Monitoramento Docker parado');
        }
    }

    // Destruir instância
    destroy() {
        this.stopMonitoring();
        this.alerts = [];
        this.metrics = null;
    }
}

module.exports = DockerMonitor; 