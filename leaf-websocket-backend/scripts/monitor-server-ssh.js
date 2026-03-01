/**
 * Monitor de Recursos do Servidor via SSH
 * 
 * Coleta métricas de CPU, memória, conexões, etc. do servidor VPS
 */

const { exec } = require('child_process');
const { promisify } = require('util');

const execAsync = promisify(exec);

class ServerMonitor {
    constructor(sshConfig) {
        this.sshHost = sshConfig.host;
        this.sshUser = sshConfig.user || 'root';
        this.sshKey = sshConfig.key || null;
    }
    
    /**
     * Executar comando SSH remoto
     */
    async executeSSHCommand(command) {
        const sshCommand = this.sshKey
            ? `ssh -i ${this.sshKey} -o StrictHostKeyChecking=no ${this.sshUser}@${this.sshHost} "${command}"`
            : `ssh -o StrictHostKeyChecking=no ${this.sshUser}@${this.sshHost} "${command}"`;
        
        try {
            const { stdout, stderr } = await execAsync(sshCommand, { timeout: 5000 });
            if (stderr && !stderr.includes('Warning: Permanently added')) {
                throw new Error(stderr);
            }
            return stdout.trim();
        } catch (error) {
            console.error(`❌ Erro ao executar comando SSH: ${error.message}`);
            return null;
        }
    }
    
    /**
     * Obter uso de CPU
     */
    async getCPUUsage() {
        const result = await this.executeSSHCommand(
            "top -bn1 | grep 'Cpu(s)' | sed 's/.*, *\\([0-9.]*\\)%* id.*/\\1/' | awk '{print 100 - $1}'"
        );
        return result ? parseFloat(result) : null;
    }
    
    /**
     * Obter uso de memória
     */
    async getMemoryUsage() {
        const result = await this.executeSSHCommand(
            "free | grep Mem | awk '{printf \"%.2f\", ($3/$2) * 100.0}'"
        );
        return result ? parseFloat(result) : null;
    }
    
    /**
     * Obter número de conexões ativas
     */
    async getActiveConnections() {
        const result = await this.executeSSHCommand(
            "netstat -an | grep :3003 | grep ESTABLISHED | wc -l"
        );
        return result ? parseInt(result) : null;
    }
    
    /**
     * Obter carga do sistema
     */
    async getLoadAverage() {
        const result = await this.executeSSHCommand("uptime | awk -F'load average:' '{print $2}'");
        return result ? result.trim() : null;
    }
    
    /**
     * Obter uso de disco
     */
    async getDiskUsage() {
        const result = await this.executeSSHCommand(
            "df -h / | awk 'NR==2 {print $5}' | sed 's/%//'"
        );
        return result ? parseFloat(result) : null;
    }
    
    /**
     * Obter processos Node.js
     */
    async getNodeProcesses() {
        const result = await this.executeSSHCommand("ps aux | grep node | grep -v grep | wc -l");
        return result ? parseInt(result) : null;
    }
    
    /**
     * Obter todas as métricas
     */
    async getAllMetrics() {
        const [cpu, memory, connections, load, disk, nodeProcesses] = await Promise.all([
            this.getCPUUsage(),
            this.getMemoryUsage(),
            this.getActiveConnections(),
            this.getLoadAverage(),
            this.getDiskUsage(),
            this.getNodeProcesses(),
        ]);
        
        return {
            timestamp: Date.now(),
            cpu,
            memory,
            connections,
            loadAverage: load,
            diskUsage: disk,
            nodeProcesses,
        };
    }
}

module.exports = ServerMonitor;


