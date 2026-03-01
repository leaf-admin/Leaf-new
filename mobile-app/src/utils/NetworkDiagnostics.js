import Logger from './Logger';
// NetworkDiagnostics.js
// Ferramenta de diagnóstico de rede para desenvolvimento

import { Platform } from 'react-native';
import { validateNetworkConfig, getWebSocketURL, getApiURL, getNotificationsURL } from './NetworkConfig';


class NetworkDiagnostics {
    constructor() {
        this.diagnostics = [];
        this.isRunning = false;
    }

    // Executar diagnóstico completo
    async runFullDiagnostics() {
        Logger.log('🔍 Iniciando diagnóstico de rede...');
        this.isRunning = true;
        this.diagnostics = [];

        try {
            // 1. Validar configuração
            await this.validateConfiguration();
            
            // 2. Testar conectividade WebSocket
            await this.testWebSocketConnection();
            
            // 3. Testar conectividade API
            await this.testApiConnection();
            
            // 4. Testar conectividade de notificações
            await this.testNotificationsConnection();
            
            // 5. Verificar configurações do dispositivo
            await this.checkDeviceConfiguration();
            
            // 6. Gerar relatório
            this.generateReport();
            
        } catch (error) {
            Logger.error('❌ Erro durante diagnóstico:', error);
            this.addDiagnostic('error', 'Erro geral', error.message);
        } finally {
            this.isRunning = false;
        }
    }

    // Validar configuração
    async validateConfiguration() {
        try {
            const validation = validateNetworkConfig();
            
            if (validation.isValid) {
                this.addDiagnostic('success', 'Configuração', 'Configuração de rede válida');
            } else {
                validation.issues.forEach(issue => {
                    this.addDiagnostic('warning', 'Configuração', issue);
                });
            }
        } catch (error) {
            this.addDiagnostic('error', 'Configuração', `Erro na validação: ${error.message}`);
        }
    }

    // Testar conexão WebSocket
    async testWebSocketConnection() {
        try {
            const wsUrl = getWebSocketURL();
            Logger.log(`🔌 Testando WebSocket: ${wsUrl}`);
            
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 10000);
            
            const response = await fetch(`${wsUrl}/health`, {
                method: 'GET',
                signal: controller.signal
            });
            
            clearTimeout(timeoutId);
            
            if (response.ok) {
                const data = await response.json();
                this.addDiagnostic('success', 'WebSocket', `Conectado com sucesso (${data.status})`);
            } else {
                this.addDiagnostic('error', 'WebSocket', `Erro HTTP: ${response.status}`);
            }
        } catch (error) {
            if (error.name === 'AbortError') {
                this.addDiagnostic('error', 'WebSocket', 'Timeout na conexão');
            } else {
                this.addDiagnostic('error', 'WebSocket', `Erro: ${error.message}`);
            }
        }
    }

    // Testar conexão API
    async testApiConnection() {
        try {
            const apiUrl = getApiURL();
            Logger.log(`🌐 Testando API: ${apiUrl}`);
            
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 10000);
            
            const response = await fetch(`${apiUrl}/metrics`, {
                method: 'GET',
                signal: controller.signal
            });
            
            clearTimeout(timeoutId);
            
            if (response.ok) {
                this.addDiagnostic('success', 'API', 'API acessível');
            } else {
                this.addDiagnostic('error', 'API', `Erro HTTP: ${response.status}`);
            }
        } catch (error) {
            if (error.name === 'AbortError') {
                this.addDiagnostic('error', 'API', 'Timeout na conexão');
            } else {
                this.addDiagnostic('error', 'API', `Erro: ${error.message}`);
            }
        }
    }

    // Testar conexão de notificações
    async testNotificationsConnection() {
        try {
            const notificationsUrl = getNotificationsURL();
            Logger.log(`📱 Testando Notificações: ${notificationsUrl}`);
            
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 10000);
            
            const response = await fetch(`${notificationsUrl}/api/update-token`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    token: 'test-token',
                    userId: 'test-user',
                    platform: Platform.OS,
                    timestamp: new Date().toISOString()
                }),
                signal: controller.signal
            });
            
            clearTimeout(timeoutId);
            
            if (response.ok || response.status === 404) {
                this.addDiagnostic('success', 'Notificações', 'Endpoint de notificações acessível');
            } else {
                this.addDiagnostic('warning', 'Notificações', `Resposta HTTP: ${response.status}`);
            }
        } catch (error) {
            if (error.name === 'AbortError') {
                this.addDiagnostic('error', 'Notificações', 'Timeout na conexão');
            } else {
                this.addDiagnostic('error', 'Notificações', `Erro: ${error.message}`);
            }
        }
    }

    // Verificar configurações do dispositivo
    async checkDeviceConfiguration() {
        try {
            const deviceInfo = {
                platform: Platform.OS,
                version: Platform.Version,
                isDevice: Platform.isPad || Platform.isTV || !__DEV__
            };
            
            this.addDiagnostic('info', 'Dispositivo', `Plataforma: ${deviceInfo.platform} ${deviceInfo.version}`);
            
            if (__DEV__) {
                this.addDiagnostic('info', 'Ambiente', 'Modo de desenvolvimento ativo');
            } else {
                this.addDiagnostic('info', 'Ambiente', 'Modo de produção');
            }
            
        } catch (error) {
            this.addDiagnostic('error', 'Dispositivo', `Erro: ${error.message}`);
        }
    }

    // Adicionar diagnóstico
    addDiagnostic(type, category, message) {
        this.diagnostics.push({
            type,
            category,
            message,
            timestamp: new Date().toISOString()
        });
        
        const emoji = {
            success: '✅',
            warning: '⚠️',
            error: '❌',
            info: 'ℹ️'
        };
        
        Logger.log(`${emoji[type]} [${category}] ${message}`);
    }

    // Gerar relatório
    generateReport() {
        Logger.log('\n📊 RELATÓRIO DE DIAGNÓSTICO DE REDE');
        Logger.log('=====================================');
        
        const categories = {};
        this.diagnostics.forEach(diag => {
            if (!categories[diag.category]) {
                categories[diag.category] = [];
            }
            categories[diag.category].push(diag);
        });
        
        Object.keys(categories).forEach(category => {
            Logger.log(`\n📋 ${category.toUpperCase()}:`);
            categories[category].forEach(diag => {
                const emoji = {
                    success: '✅',
                    warning: '⚠️',
                    error: '❌',
                    info: 'ℹ️'
                };
                Logger.log(`  ${emoji[diag.type]} ${diag.message}`);
            });
        });
        
        // Resumo
        const errors = this.diagnostics.filter(d => d.type === 'error').length;
        const warnings = this.diagnostics.filter(d => d.type === 'warning').length;
        const successes = this.diagnostics.filter(d => d.type === 'success').length;
        
        Logger.log('\n📈 RESUMO:');
        Logger.log(`  ✅ Sucessos: ${successes}`);
        Logger.log(`  ⚠️ Avisos: ${warnings}`);
        Logger.log(`  ❌ Erros: ${errors}`);
        
        if (errors === 0) {
            Logger.log('\n🎉 Diagnóstico concluído: Rede funcionando corretamente!');
        } else {
            Logger.log('\n🔧 Diagnóstico concluído: Problemas encontrados. Verifique os erros acima.');
        }
        
        return {
            total: this.diagnostics.length,
            errors,
            warnings,
            successes,
            diagnostics: this.diagnostics
        };
    }

    // Obter diagnósticos
    getDiagnostics() {
        return this.diagnostics;
    }

    // Limpar diagnósticos
    clearDiagnostics() {
        this.diagnostics = [];
    }

    // Verificar se está rodando
    isDiagnosticsRunning() {
        return this.isRunning;
    }
}

// Exportar instância singleton
export default new NetworkDiagnostics();


