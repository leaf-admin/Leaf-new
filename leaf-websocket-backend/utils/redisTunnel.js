const { spawn } = require('child_process');
const { logger } = require('./logger');

class RedisTunnel {
    constructor() {
        this.tunnelProcess = null;
        this.isRunning = false;
        this.tunnelUrl = null;
        this.localPort = 6379;
        this.remotePort = 6379;
    }
    
    // Iniciar túnel usando ngrok
    async startNgrokTunnel() {
        try {
            logger.info('Iniciando túnel Redis com ngrok', {
                localPort: this.localPort,
                timestamp: new Date().toISOString()
            });
            
            // Verificar se ngrok está instalado
            const ngrokCheck = spawn('ngrok', ['version']);
            
            ngrokCheck.on('error', (error) => {
                logger.error('ngrok não encontrado. Instalando...', {
                    error: error.message,
                    timestamp: new Date().toISOString()
                });
                
                // Tentar instalar ngrok
                this.installNgrok();
            });
            
            ngrokCheck.on('close', (code) => {
                if (code === 0) {
                    this.startTunnel();
                } else {
                    logger.error('ngrok não está funcionando corretamente', {
                        exitCode: code,
                        timestamp: new Date().toISOString()
                    });
                }
            });
            
        } catch (error) {
            logger.error('Erro ao iniciar túnel ngrok', {
                error: error.message,
                timestamp: new Date().toISOString()
            });
        }
    }
    
    // Instalar ngrok
    async installNgrok() {
        try {
            logger.info('Instalando ngrok...', {
                timestamp: new Date().toISOString()
            });
            
            const installProcess = spawn('npm', ['install', '-g', 'ngrok']);
            
            installProcess.on('close', (code) => {
                if (code === 0) {
                    logger.info('ngrok instalado com sucesso', {
                        timestamp: new Date().toISOString()
                    });
                    this.startTunnel();
                } else {
                    logger.error('Falha ao instalar ngrok', {
                        exitCode: code,
                        timestamp: new Date().toISOString()
                    });
                }
            });
            
        } catch (error) {
            logger.error('Erro ao instalar ngrok', {
                error: error.message,
                timestamp: new Date().toISOString()
            });
        }
    }
    
    // Iniciar túnel
    startTunnel() {
        try {
            this.tunnelProcess = spawn('ngrok', ['tcp', this.localPort.toString()]);
            
            this.tunnelProcess.stdout.on('data', (data) => {
                const output = data.toString();
                logger.info('ngrok output', {
                    output: output.trim(),
                    timestamp: new Date().toISOString()
                });
                
                // Extrair URL do túnel
                const urlMatch = output.match(/tcp:\/\/([^:]+):(\d+)/);
                if (urlMatch) {
                    this.tunnelUrl = `tcp://${urlMatch[1]}:${urlMatch[2]}`;
                    logger.info('Túnel Redis criado com sucesso', {
                        tunnelUrl: this.tunnelUrl,
                        timestamp: new Date().toISOString()
                    });
                }
            });
            
            this.tunnelProcess.stderr.on('data', (data) => {
                const error = data.toString();
                logger.error('ngrok error', {
                    error: error.trim(),
                    timestamp: new Date().toISOString()
                });
            });
            
            this.tunnelProcess.on('close', (code) => {
                this.isRunning = false;
                logger.warn('Túnel ngrok fechado', {
                    exitCode: code,
                    timestamp: new Date().toISOString()
                });
            });
            
            this.isRunning = true;
            
        } catch (error) {
            logger.error('Erro ao iniciar túnel', {
                error: error.message,
                timestamp: new Date().toISOString()
            });
        }
    }
    
    // Parar túnel
    stopTunnel() {
        if (this.tunnelProcess) {
            this.tunnelProcess.kill();
            this.tunnelProcess = null;
            this.isRunning = false;
            this.tunnelUrl = null;
            
            logger.info('Túnel Redis parado', {
                timestamp: new Date().toISOString()
            });
        }
    }
    
    // Obter status do túnel
    getStatus() {
        return {
            isRunning: this.isRunning,
            tunnelUrl: this.tunnelUrl,
            localPort: this.localPort,
            remotePort: this.remotePort,
            timestamp: new Date().toISOString()
        };
    }
    
    // Testar conectividade do túnel
    async testTunnel() {
        if (!this.tunnelUrl) {
            return {
                success: false,
                error: 'Túnel não está ativo',
                timestamp: new Date().toISOString()
            };
        }
        
        try {
            const Redis = require('ioredis');
            const testRedis = new Redis({
                host: this.tunnelUrl.split('://')[1].split(':')[0],
                port: parseInt(this.tunnelUrl.split(':')[2]),
                connectTimeout: 5000,
                commandTimeout: 3000
            });
            
            await testRedis.ping();
            await testRedis.disconnect();
            
            logger.info('Teste de conectividade do túnel bem-sucedido', {
                tunnelUrl: this.tunnelUrl,
                timestamp: new Date().toISOString()
            });
            
            return {
                success: true,
                tunnelUrl: this.tunnelUrl,
                timestamp: new Date().toISOString()
            };
            
        } catch (error) {
            logger.error('Teste de conectividade do túnel falhou', {
                error: error.message,
                tunnelUrl: this.tunnelUrl,
                timestamp: new Date().toISOString()
            });
            
            return {
                success: false,
                error: error.message,
                tunnelUrl: this.tunnelUrl,
                timestamp: new Date().toISOString()
            };
        }
    }
}

module.exports = RedisTunnel; 