// System Monitor with Alerts
// Data: 29/07/2025
// Status: ✅ MONITORING SYSTEM

const os = require('os');
const fs = require('fs');
const { exec } = require('child_process');
const nodemailer = require('nodemailer');

class SystemMonitor {
    constructor() {
        this.config = {
            // Thresholds
            cpuThreshold: 80, // %
            memoryThreshold: 85, // %
            diskThreshold: 90, // %
            redisMemoryThreshold: 100, // MB
            
            // Alert intervals (minutes)
            alertInterval: 5,
            
            // Notification settings
            email: {
                host: 'smtp.gmail.com',
                port: 587,
                secure: false,
                auth: {
                    user: 'alerts@leafapp.com',
                    pass: process.env.EMAIL_PASSWORD
                }
            },
            
            // Recipients
            recipients: ['admin@leafapp.com', 'tech@leafapp.com']
        };
        
        this.alerts = new Map();
        this.metrics = {};
        
        console.log('🔍 System Monitor iniciado...');
    }
    
    // Get CPU usage
    async getCpuUsage() {
        return new Promise((resolve) => {
            exec('top -bn1 | grep "Cpu(s)" | awk \'{print $2}\' | cut -d\'%\' -f1', (error, stdout) => {
                if (error) {
                    resolve(0);
                } else {
                    resolve(parseFloat(stdout.trim()));
                }
            });
        });
    }
    
    // Get memory usage
    async getMemoryUsage() {
        const totalMem = os.totalmem();
        const freeMem = os.freemem();
        const usedMem = totalMem - freeMem;
        return Math.round((usedMem / totalMem) * 100);
    }
    
    // Get disk usage
    async getDiskUsage() {
        return new Promise((resolve) => {
            exec('df / | awk \'NR==2 {print $5}\' | cut -d\'%\' -f1', (error, stdout) => {
                if (error) {
                    resolve(0);
                } else {
                    resolve(parseInt(stdout.trim()));
                }
            });
        });
    }
    
    // Get Redis memory usage
    async getRedisMemoryUsage() {
        return new Promise((resolve) => {
            exec('redis-cli info memory | grep used_memory_human', (error, stdout) => {
                if (error) {
                    resolve(0);
                } else {
                    const match = stdout.match(/(\d+(?:\.\d+)?)([KMGT])B/);
                    if (match) {
                        const value = parseFloat(match[1]);
                        const unit = match[2];
                        const multiplier = { 'K': 1, 'M': 1024, 'G': 1024*1024, 'T': 1024*1024*1024 };
                        resolve(Math.round(value * multiplier[unit]));
                    } else {
                        resolve(0);
                    }
                }
            });
        });
    }
    
    // Check if services are running
    async checkServices() {
        const services = {
            redis: 'redis-server',
            websocket: 'node',
            api: 'node'
        };
        
        const results = {};
        
        for (const [service, process] of Object.entries(services)) {
            results[service] = await this.isProcessRunning(process);
        }
        
        return results;
    }
    
    // Check if process is running
    async isProcessRunning(processName) {
        return new Promise((resolve) => {
            exec(`pgrep -f "${processName}"`, (error) => {
                resolve(!error);
            });
        });
    }
    
    // Send email alert
    async sendAlert(subject, message) {
        try {
            const transporter = nodemailer.createTransporter(this.config.email);
            
            const mailOptions = {
                from: this.config.email.auth.user,
                to: this.config.recipients.join(', '),
                subject: `🚨 LEAF APP ALERT: ${subject}`,
                html: `
                    <h2>🚨 Sistema de Monitoramento - LEAF APP</h2>
                    <p><strong>Alerta:</strong> ${subject}</p>
                    <p><strong>Mensagem:</strong> ${message}</p>
                    <p><strong>Timestamp:</strong> ${new Date().toISOString()}</p>
                    <hr>
                    <p><em>Este é um alerta automático do sistema de monitoramento.</em></p>
                `
            };
            
            await transporter.sendMail(mailOptions);
            console.log(`📧 Alerta enviado: ${subject}`);
        } catch (error) {
            console.error('❌ Erro ao enviar alerta:', error.message);
        }
    }
    
    // Check for alerts
    async checkAlerts() {
        const alerts = [];
        
        // CPU Alert
        if (this.metrics.cpu > this.config.cpuThreshold) {
            alerts.push({
                type: 'CPU',
                message: `CPU usage: ${this.metrics.cpu}% (threshold: ${this.config.cpuThreshold}%)`
            });
        }
        
        // Memory Alert
        if (this.metrics.memory > this.config.memoryThreshold) {
            alerts.push({
                type: 'MEMORY',
                message: `Memory usage: ${this.metrics.memory}% (threshold: ${this.config.memoryThreshold}%)`
            });
        }
        
        // Disk Alert
        if (this.metrics.disk > this.config.diskThreshold) {
            alerts.push({
                type: 'DISK',
                message: `Disk usage: ${this.metrics.disk}% (threshold: ${this.config.diskThreshold}%)`
            });
        }
        
        // Redis Memory Alert
        if (this.metrics.redisMemory > this.config.redisMemoryThreshold) {
            alerts.push({
                type: 'REDIS',
                message: `Redis memory: ${this.metrics.redisMemory}MB (threshold: ${this.config.redisMemoryThreshold}MB)`
            });
        }
        
        // Service Alerts
        for (const [service, running] of Object.entries(this.metrics.services)) {
            if (!running) {
                alerts.push({
                    type: 'SERVICE',
                    message: `Service ${service} is not running`
                });
            }
        }
        
        return alerts;
    }
    
    // Process alerts
    async processAlerts(alerts) {
        for (const alert of alerts) {
            const alertKey = `${alert.type}_${Date.now()}`;
            
            // Check if we already sent this alert recently
            const lastAlert = this.alerts.get(alert.type);
            if (lastAlert && (Date.now() - lastAlert) < (this.config.alertInterval * 60 * 1000)) {
                continue; // Skip if alert was sent recently
            }
            
            // Send alert
            await this.sendAlert(alert.type, alert.message);
            
            // Update alert timestamp
            this.alerts.set(alert.type, Date.now());
            
            console.log(`🚨 ALERTA: ${alert.type} - ${alert.message}`);
        }
    }
    
    // Collect all metrics
    async collectMetrics() {
        this.metrics = {
            timestamp: new Date().toISOString(),
            cpu: await this.getCpuUsage(),
            memory: await this.getMemoryUsage(),
            disk: await this.getDiskUsage(),
            redisMemory: await this.getRedisMemoryUsage(),
            services: await this.checkServices()
        };
        
        return this.metrics;
    }
    
    // Save metrics to file
    saveMetrics() {
        const metricsFile = '/var/log/leaf-metrics.json';
        const metricsData = {
            timestamp: this.metrics.timestamp,
            metrics: this.metrics
        };
        
        try {
            fs.writeFileSync(metricsFile, JSON.stringify(metricsData, null, 2));
        } catch (error) {
            console.error('❌ Erro ao salvar métricas:', error.message);
        }
    }
    
    // Generate status report
    generateStatusReport() {
        const report = {
            timestamp: new Date().toISOString(),
            status: 'OK',
            metrics: this.metrics,
            alerts: this.alerts.size
        };
        
        // Check if any service is down
        for (const [service, running] of Object.entries(this.metrics.services)) {
            if (!running) {
                report.status = 'CRITICAL';
                break;
            }
        }
        
        // Check if any metric is above threshold
        if (this.metrics.cpu > this.config.cpuThreshold ||
            this.metrics.memory > this.config.memoryThreshold ||
            this.metrics.disk > this.config.diskThreshold) {
            report.status = 'WARNING';
        }
        
        return report;
    }
    
    // Start monitoring
    async start() {
        console.log('🚀 Iniciando monitoramento do sistema...');
        
        // Initial metrics collection
        await this.collectMetrics();
        
        // Start monitoring loop
        setInterval(async () => {
            try {
                // Collect metrics
                await this.collectMetrics();
                
                // Save metrics
                this.saveMetrics();
                
                // Check for alerts
                const alerts = await this.checkAlerts();
                await this.processAlerts(alerts);
                
                // Log status
                const report = this.generateStatusReport();
                console.log(`📊 Status: ${report.status} | CPU: ${this.metrics.cpu}% | RAM: ${this.metrics.memory}% | Disk: ${this.metrics.disk}%`);
                
            } catch (error) {
                console.error('❌ Erro no monitoramento:', error.message);
            }
        }, 30000); // Check every 30 seconds
    }
}

// Export for use
module.exports = SystemMonitor;

// Start if run directly
if (require.main === module) {
    const monitor = new SystemMonitor();
    monitor.start();
} 