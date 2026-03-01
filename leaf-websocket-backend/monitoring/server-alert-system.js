/**
 * Sistema de Alertas de Monitoramento do Servidor
 * 
 * Monitora métricas do servidor e envia alertas quando limites são atingidos
 * 
 * Canais de alerta:
 * - Console (logs)
 * - Dashboard (via API)
 * - Email (opcional)
 * - Webhook (opcional - para integração com Slack, Discord, etc)
 * - Arquivo de log
 */

const axios = require('axios');
const fs = require('fs');
const path = require('path');

// Configurações
const CONFIG = {
    // Intervalo de verificação (em segundos)
    CHECK_INTERVAL: 60, // 1 minuto
    
    // Thresholds de alerta
    THRESHOLDS: {
        CPU_WARNING: 70,      // Aviso quando CPU > 70%
        CPU_CRITICAL: 75,     // Crítico quando CPU > 75%
        MEMORY_WARNING: 75,   // Aviso quando RAM > 75%
        MEMORY_CRITICAL: 80,  // Crítico quando RAM > 80%
        CONNECTIONS_WARNING: 7000,  // Aviso quando conexões > 7k (70%)
        CONNECTIONS_CRITICAL: 8000, // Crítico quando conexões > 8k (80%)
        LATENCY_WARNING: 300, // Aviso quando latência P95 > 300ms
        LATENCY_CRITICAL: 500, // Crítico quando latência P95 > 500ms
        ERROR_RATE_WARNING: 0.5,  // Aviso quando taxa de erro > 0.5%
        ERROR_RATE_CRITICAL: 1.0,  // Crítico quando taxa de erro > 1%
    },
    
    // Cooldown entre alertas do mesmo tipo (em minutos)
    ALERT_COOLDOWN: 30, // 30 minutos
    
    // URLs e endpoints
    SERVER_URL: process.env.SERVER_URL || 'http://216.238.107.59:3001',
    DASHBOARD_API: process.env.DASHBOARD_API || 'http://216.238.107.59:3001/api/alerts',
    
    // Configurações de email (opcional)
    EMAIL: {
        enabled: process.env.EMAIL_ALERTS_ENABLED === 'true',
        smtp: {
            host: process.env.SMTP_HOST,
            port: process.env.SMTP_PORT || 587,
            secure: process.env.SMTP_SECURE === 'true',
            auth: {
                user: process.env.SMTP_USER,
                pass: process.env.SMTP_PASS
            }
        },
        to: process.env.ALERT_EMAIL_TO?.split(',') || []
    },
    
    // Configurações de webhook (opcional)
    WEBHOOK: {
        enabled: process.env.WEBHOOK_ALERTS_ENABLED === 'true',
        url: process.env.WEBHOOK_URL,
        headers: process.env.WEBHOOK_HEADERS ? JSON.parse(process.env.WEBHOOK_HEADERS) : {}
    },
    
    // Arquivo de log
    LOG_FILE: process.env.ALERT_LOG_FILE || '/var/log/leaf-server-alerts.log'
};

// Estado de alertas (para cooldown)
const alertState = {
    lastAlerts: new Map(), // { metric: timestamp }
    alertHistory: [] // Histórico de alertas
};

/**
 * Obter métricas do servidor
 */
async function getServerMetrics() {
    try {
        // Tentar obter via API do servidor
        const response = await axios.get(`${CONFIG.SERVER_URL}/api/metrics`, {
            timeout: 5000,
            validateStatus: () => true
        });
        
        if (response.status === 200 && response.data) {
            return {
                cpu: response.data.cpu || null,
                memory: response.data.memory || null,
                connections: response.data.connections || null,
                activeRides: response.data.activeRides || null,
                latency: response.data.latency || null,
                errorRate: response.data.errorRate || null,
                timestamp: Date.now(),
                source: 'api'
            };
        }
    } catch (error) {
        // Se API não disponível, usar métricas do sistema
    }
    
    // Fallback: métricas básicas do sistema (via SSH ou local)
    return {
        cpu: null,
        memory: null,
        connections: null,
        activeRides: null,
        latency: null,
        errorRate: null,
        timestamp: Date.now(),
        source: 'fallback',
        note: 'API de métricas não disponível'
    };
}

/**
 * Verificar se alerta deve ser enviado (cooldown)
 */
function shouldSendAlert(metric, severity) {
    const key = `${metric}_${severity}`;
    const lastAlert = alertState.lastAlerts.get(key);
    
    if (!lastAlert) {
        return true;
    }
    
    const timeSinceLastAlert = (Date.now() - lastAlert) / 1000 / 60; // minutos
    return timeSinceLastAlert >= CONFIG.ALERT_COOLDOWN;
}

/**
 * Registrar alerta enviado
 */
function recordAlert(metric, severity) {
    const key = `${metric}_${severity}`;
    alertState.lastAlerts.set(key, Date.now());
    
    alertState.alertHistory.push({
        metric,
        severity,
        timestamp: new Date().toISOString()
    });
    
    // Manter apenas últimos 100 alertas
    if (alertState.alertHistory.length > 100) {
        alertState.alertHistory.shift();
    }
}

/**
 * Enviar alerta para console
 */
function sendConsoleAlert(alert) {
    const emoji = alert.severity === 'critical' ? '🔴' : '🟡';
    const timestamp = new Date().toLocaleString('pt-BR');
    
    console.log(`\n${emoji} [ALERTA ${alert.severity.toUpperCase()}] ${timestamp}`);
    console.log(`   Métrica: ${alert.metric}`);
    console.log(`   Valor: ${alert.value}${alert.unit || ''}`);
    console.log(`   Limite: ${alert.threshold}${alert.unit || ''}`);
    console.log(`   Mensagem: ${alert.message}`);
    console.log('');
}

/**
 * Enviar alerta para arquivo de log
 */
function sendLogAlert(alert) {
    try {
        const logDir = path.dirname(CONFIG.LOG_FILE);
        if (!fs.existsSync(logDir)) {
            fs.mkdirSync(logDir, { recursive: true });
        }
        
        const logEntry = `[${new Date().toISOString()}] [${alert.severity.toUpperCase()}] ${alert.metric}: ${alert.value}${alert.unit || ''} (limite: ${alert.threshold}${alert.unit || ''}) - ${alert.message}\n`;
        fs.appendFileSync(CONFIG.LOG_FILE, logEntry);
    } catch (error) {
        console.error('❌ Erro ao escrever no log:', error.message);
    }
}

/**
 * Enviar alerta para dashboard via API
 */
async function sendDashboardAlert(alert) {
    try {
        await axios.post(CONFIG.DASHBOARD_API, {
            type: 'server_alert',
            severity: alert.severity,
            metric: alert.metric,
            value: alert.value,
            threshold: alert.threshold,
            unit: alert.unit,
            message: alert.message,
            timestamp: new Date().toISOString()
        }, {
            timeout: 5000,
            validateStatus: () => true
        });
    } catch (error) {
        // Silenciosamente falhar se dashboard não disponível
    }
}

/**
 * Enviar alerta via email
 */
async function sendEmailAlert(alert) {
    if (!CONFIG.EMAIL.enabled || !CONFIG.EMAIL.to.length) {
        return;
    }
    
    try {
        // Implementar envio de email (nodemailer ou similar)
        // Por enquanto, apenas log
        console.log(`📧 [EMAIL] Alert seria enviado para: ${CONFIG.EMAIL.to.join(', ')}`);
    } catch (error) {
        console.error('❌ Erro ao enviar email:', error.message);
    }
}

/**
 * Enviar alerta via webhook (Slack)
 */
async function sendWebhookAlert(alert) {
    if (!CONFIG.WEBHOOK.enabled || !CONFIG.WEBHOOK.url) {
        return;
    }
    
    try {
        // Formato Slack Incoming Webhook
        const slackPayload = {
            text: `🚨 *Alerta do Servidor LEAF*`,
            attachments: [{
                color: alert.severity === 'critical' ? 'danger' : 'warning',
                title: `${alert.severity === 'critical' ? '🔴 CRÍTICO' : '🟡 AVISO'}: ${alert.metric}`,
                fields: [
                    { title: 'Métrica', value: alert.metric, short: true },
                    { title: 'Valor Atual', value: `${alert.value}${alert.unit || ''}`, short: true },
                    { title: 'Limite', value: `${alert.threshold}${alert.unit || ''}`, short: true },
                    { title: 'Severidade', value: alert.severity.toUpperCase(), short: true },
                    { title: 'Servidor', value: process.env.SERVER_NAME || 'LEAF Production', short: true },
                    { title: 'Timestamp', value: new Date(alert.timestamp).toLocaleString('pt-BR'), short: true }
                ],
                text: alert.message,
                footer: 'LEAF Server Monitor',
                footer_icon: 'https://platform.slack-edge.com/img/default_application_icon.png',
                ts: Math.floor(new Date(alert.timestamp).getTime() / 1000)
            }]
        };
        
        await axios.post(CONFIG.WEBHOOK.url, slackPayload, {
            headers: {
                'Content-Type': 'application/json',
                ...CONFIG.WEBHOOK.headers
            },
            timeout: 5000,
            validateStatus: () => true
        });
        
        console.log(`✅ Alerta enviado para Slack: ${alert.metric} (${alert.severity})`);
    } catch (error) {
        console.error('❌ Erro ao enviar webhook para Slack:', error.message);
        if (error.response) {
            console.error('   Resposta:', error.response.status, error.response.data);
        }
    }
}

/**
 * Enviar alerta através de todos os canais
 */
async function sendAlert(metric, value, threshold, severity, unit = '') {
    const alert = {
        metric,
        value,
        threshold,
        severity,
        unit,
        message: `${metric} está em ${value}${unit}, acima do limite de ${threshold}${unit}`,
        timestamp: new Date().toISOString()
    };
    
    // Verificar cooldown
    if (!shouldSendAlert(metric, severity)) {
        return; // Não enviar se ainda estiver em cooldown
    }
    
    // Enviar para todos os canais
    sendConsoleAlert(alert);
    sendLogAlert(alert);
    await sendDashboardAlert(alert);
    await sendEmailAlert(alert);
    await sendWebhookAlert(alert);
    
    // Registrar alerta
    recordAlert(metric, severity);
}

/**
 * Verificar métricas e enviar alertas
 */
async function checkMetrics() {
    const metrics = await getServerMetrics();
    
    // Verificar CPU
    if (metrics.cpu !== null) {
        if (metrics.cpu >= CONFIG.THRESHOLDS.CPU_CRITICAL) {
            await sendAlert('CPU', metrics.cpu, CONFIG.THRESHOLDS.CPU_CRITICAL, 'critical', '%');
        } else if (metrics.cpu >= CONFIG.THRESHOLDS.CPU_WARNING) {
            await sendAlert('CPU', metrics.cpu, CONFIG.THRESHOLDS.CPU_WARNING, 'warning', '%');
        }
    }
    
    // Verificar Memória
    if (metrics.memory !== null) {
        if (metrics.memory >= CONFIG.THRESHOLDS.MEMORY_CRITICAL) {
            await sendAlert('Memória', metrics.memory, CONFIG.THRESHOLDS.MEMORY_CRITICAL, 'critical', '%');
        } else if (metrics.memory >= CONFIG.THRESHOLDS.MEMORY_WARNING) {
            await sendAlert('Memória', metrics.memory, CONFIG.THRESHOLDS.MEMORY_WARNING, 'warning', '%');
        }
    }
    
    // Verificar Conexões
    if (metrics.connections !== null) {
        if (metrics.connections >= CONFIG.THRESHOLDS.CONNECTIONS_CRITICAL) {
            await sendAlert('Conexões', metrics.connections, CONFIG.THRESHOLDS.CONNECTIONS_CRITICAL, 'critical');
        } else if (metrics.connections >= CONFIG.THRESHOLDS.CONNECTIONS_WARNING) {
            await sendAlert('Conexões', metrics.connections, CONFIG.THRESHOLDS.CONNECTIONS_WARNING, 'warning');
        }
    }
    
    // Verificar Latência
    if (metrics.latency !== null) {
        if (metrics.latency >= CONFIG.THRESHOLDS.LATENCY_CRITICAL) {
            await sendAlert('Latência P95', metrics.latency, CONFIG.THRESHOLDS.LATENCY_CRITICAL, 'critical', 'ms');
        } else if (metrics.latency >= CONFIG.THRESHOLDS.LATENCY_WARNING) {
            await sendAlert('Latência P95', metrics.latency, CONFIG.THRESHOLDS.LATENCY_WARNING, 'warning', 'ms');
        }
    }
    
    // Verificar Taxa de Erro
    if (metrics.errorRate !== null) {
        if (metrics.errorRate >= CONFIG.THRESHOLDS.ERROR_RATE_CRITICAL) {
            await sendAlert('Taxa de Erro', metrics.errorRate, CONFIG.THRESHOLDS.ERROR_RATE_CRITICAL, 'critical', '%');
        } else if (metrics.errorRate >= CONFIG.THRESHOLDS.ERROR_RATE_WARNING) {
            await sendAlert('Taxa de Erro', metrics.errorRate, CONFIG.THRESHOLDS.ERROR_RATE_WARNING, 'warning', '%');
        }
    }
}

/**
 * Obter status do sistema de alertas
 */
function getAlertStatus() {
    return {
        enabled: true,
        lastCheck: alertState.alertHistory[alertState.alertHistory.length - 1]?.timestamp || null,
        totalAlerts: alertState.alertHistory.length,
        recentAlerts: alertState.alertHistory.slice(-10),
        channels: {
            console: true,
            log: true,
            dashboard: true,
            email: CONFIG.EMAIL.enabled,
            webhook: CONFIG.WEBHOOK.enabled
        }
    };
}

/**
 * Iniciar monitoramento
 */
function startMonitoring() {
    console.log('🚀 Sistema de Alertas do Servidor iniciado');
    console.log(`📊 Verificando métricas a cada ${CONFIG.CHECK_INTERVAL} segundos`);
    console.log(`📝 Logs salvos em: ${CONFIG.LOG_FILE}`);
    console.log(`\n📋 Canais de alerta:`);
    console.log(`   ✅ Console (sempre ativo)`);
    console.log(`   ✅ Arquivo de log: ${CONFIG.LOG_FILE}`);
    console.log(`   ✅ Dashboard: ${CONFIG.DASHBOARD_API}`);
    console.log(`   ${CONFIG.EMAIL.enabled ? '✅' : '❌'} Email: ${CONFIG.EMAIL.enabled ? 'Ativo' : 'Desativado'}`);
    console.log(`   ${CONFIG.WEBHOOK.enabled ? '✅' : '❌'} Webhook: ${CONFIG.WEBHOOK.enabled ? 'Ativo' : 'Desativado'}`);
    console.log(`\n🚨 Thresholds:`);
    console.log(`   CPU: ${CONFIG.THRESHOLDS.CPU_WARNING}% (aviso) / ${CONFIG.THRESHOLDS.CPU_CRITICAL}% (crítico)`);
    console.log(`   Memória: ${CONFIG.THRESHOLDS.MEMORY_WARNING}% (aviso) / ${CONFIG.THRESHOLDS.MEMORY_CRITICAL}% (crítico)`);
    console.log(`   Conexões: ${CONFIG.THRESHOLDS.CONNECTIONS_WARNING} (aviso) / ${CONFIG.THRESHOLDS.CONNECTIONS_CRITICAL} (crítico)`);
    console.log(`   Latência: ${CONFIG.THRESHOLDS.LATENCY_WARNING}ms (aviso) / ${CONFIG.THRESHOLDS.LATENCY_CRITICAL}ms (crítico)`);
    console.log(`   Taxa de Erro: ${CONFIG.THRESHOLDS.ERROR_RATE_WARNING}% (aviso) / ${CONFIG.THRESHOLDS.ERROR_RATE_CRITICAL}% (crítico)`);
    console.log(`\n⏱️  Cooldown entre alertas: ${CONFIG.ALERT_COOLDOWN} minutos\n`);
    
    // Verificação inicial
    checkMetrics();
    
    // Verificações periódicas
    setInterval(checkMetrics, CONFIG.CHECK_INTERVAL * 1000);
}

// Executar se chamado diretamente
if (require.main === module) {
    startMonitoring();
}

module.exports = {
    startMonitoring,
    checkMetrics,
    getAlertStatus,
    sendAlert
};


