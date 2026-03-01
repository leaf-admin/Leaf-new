const os = require('os');
const { exec } = require('child_process');
const util = require('util');
const execAsync = util.promisify(exec);
const { logStructured, logError } = require('./logger');

// Configurações dos VPSs
const VPS_CONFIGS = {
  vultr: {
    name: 'VPS Vultr (Principal)',
    ip: '216.238.107.59',
    location: 'São Paulo, BR',
    provider: 'Vultr'
  },
  hostinger: {
    name: 'VPS Hostinger (Backup)',
    ip: '147.93.66.253',
    location: 'São Paulo, BR',
    provider: 'Hostinger'
  }
};

// Função para obter métricas do sistema atual
async function getCurrentSystemMetrics() {
  try {
    // CPU Usage
    const cpuUsage = os.loadavg();
    const cpuPercent = Math.round(cpuUsage[0] * 100);

    // Memory Usage
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const usedMem = totalMem - freeMem;
    const memoryPercent = Math.round((usedMem / totalMem) * 100);

    // Disk Usage
    const { stdout: dfOutput } = await execAsync('df -h / | tail -1');
    const diskUsage = parseInt(dfOutput.split(/\s+/)[4].replace('%', ''));

    // Uptime
    const uptime = os.uptime();
    const days = Math.floor(uptime / 86400);
    const hours = Math.floor((uptime % 86400) / 3600);
    const minutes = Math.floor((uptime % 3600) / 60);
    const uptimeStr = `${days}d ${hours}h ${minutes}m`;

    // Network Stats
    const networkInterfaces = os.networkInterfaces();
    let networkIn = 0;
    let networkOut = 0;

    // Tentar obter estatísticas de rede
    try {
      const { stdout: netstatOutput } = await execAsync('cat /proc/net/dev | grep -E "(eth0|ens3|enp0s3)" | head -1');
      if (netstatOutput) {
        const parts = netstatOutput.trim().split(/\s+/);
        networkIn = parseInt(parts[1] || 0);
        networkOut = parseInt(parts[9] || 0);
      }
    } catch (error) {
      logStructured('warn', 'Não foi possível obter estatísticas de rede detalhadas', {
        service: 'vps-metrics',
        operation: 'getNetworkStats'
      });
    }

    return {
      cpu: cpuPercent,
      memory: memoryPercent,
      disk: diskUsage,
      uptime: uptimeStr,
      network: {
        in: Math.round(networkIn / 1024 / 1024), // MB
        out: Math.round(networkOut / 1024 / 1024) // MB
      },
      hostname: os.hostname(),
      platform: os.platform(),
      arch: os.arch(),
      cores: os.cpus().length
    };
  } catch (error) {
    logError(error, 'Erro ao obter métricas do sistema', {
      service: 'vps-metrics',
      operation: 'getCurrentSystemMetrics'
    });
    throw error;
  }
}

// Função para obter métricas de um VPS específico
async function getVPSMetrics(vpsId) {
  try {
    const config = VPS_CONFIGS[vpsId];
    if (!config) {
      throw new Error(`VPS ${vpsId} não configurado`);
    }

    // Se for o VPS atual (vultr), usar métricas reais
    if (vpsId === 'vultr') {
      const metrics = await getCurrentSystemMetrics();
      return {
        id: vpsId,
        name: config.name,
        provider: config.provider,
        location: config.location,
        ip: config.ip,
        status: 'online',
        ...metrics
      };
    }

    // Para outros VPSs, tentar conectar via SSH (se configurado)
    if (vpsId === 'hostinger') {
      try {
        // Tentar obter métricas via SSH (requer chave SSH configurada)
        const { stdout } = await execAsync(`ssh -o ConnectTimeout=5 -o StrictHostKeyChecking=no root@${config.ip} '
          echo "CPU: $(top -bn1 | grep "Cpu(s)" | awk "{print \$2}" | cut -d"%" -f1)"
          echo "MEMORY: $(free | grep Mem | awk "{print int(\$3/\$2 * 100.0)}")"
          echo "DISK: $(df / | tail -1 | awk "{print \$5}" | sed "s/%//")"
          echo "UPTIME: $(uptime -p | sed "s/up //")"
        '`);
        
        const lines = stdout.split('\n');
        const cpu = parseFloat(lines[0].split(': ')[1]) || 0;
        const memory = parseInt(lines[1].split(': ')[1]) || 0;
        const disk = parseInt(lines[2].split(': ')[1]) || 0;
        const uptime = lines[3].split(': ')[1] || 'N/A';

        return {
          id: vpsId,
          name: config.name,
          provider: config.provider,
          location: config.location,
          ip: config.ip,
          status: 'online',
          cpu: Math.round(cpu),
          memory: memory,
          disk: disk,
          uptime: uptime,
          network: {
            in: 0, // Será implementado se necessário
            out: 0
          }
        };
      } catch (sshError) {
        logStructured('warn', 'Não foi possível conectar ao VPS via SSH', {
          service: 'vps-metrics',
          operation: 'getVPSMetrics',
          vpsId,
          error: sshError.message
        });
        
        // Retornar dados básicos se SSH falhar
        return {
          id: vpsId,
          name: config.name,
          provider: config.provider,
          location: config.location,
          ip: config.ip,
          status: 'offline',
          cpu: 0,
          memory: 0,
          disk: 0,
          uptime: 'N/A',
          network: {
            in: 0,
            out: 0
          },
          error: 'Não foi possível conectar ao VPS'
        };
      }
    }

    throw new Error(`VPS ${vpsId} não suportado`);
  } catch (error) {
    logError(error, 'Erro ao obter métricas do VPS', {
      service: 'vps-metrics',
      operation: 'getVPSMetrics',
      vpsId
    });
    throw error;
  }
}

// Função para obter métricas do Redis
async function getRedisMetrics() {
  try {
    const { stdout } = await execAsync('redis-cli info');
    const lines = stdout.split('\n');
    const metrics = {};

    lines.forEach(line => {
      if (line.includes(':')) {
        const [key, value] = line.split(':');
        metrics[key] = value;
      }
    });

    return {
      status: 'online',
      memory: {
        used: parseInt(metrics.used_memory_human?.replace('M', '') || '0'),
        peak: parseInt(metrics.used_memory_peak_human?.replace('M', '') || '0'),
        total: parseInt(metrics.maxmemory_human?.replace('M', '') || '0')
      },
      keys: {
        total: parseInt(metrics.db0?.split(',')[0]?.split('=')[1] || '0'),
        expired: parseInt(metrics.expired_keys || '0'),
        evicted: parseInt(metrics.evicted_keys || '0')
      },
      opsPerSec: parseInt(metrics.instantaneous_ops_per_sec || '0'),
      latency: parseInt(metrics.avg_ttl || '0'),
      connections: parseInt(metrics.connected_clients || '0'),
      hitRate: parseFloat(metrics.keyspace_hits || '0') / (parseFloat(metrics.keyspace_hits || '0') + parseFloat(metrics.keyspace_misses || '0')) * 100
    };
  } catch (error) {
    logError(error, 'Erro ao obter métricas do Redis', {
      service: 'vps-metrics',
      operation: 'getRedisMetrics'
    });
    return {
      status: 'offline',
      memory: { used: 0, peak: 0, total: 0 },
      keys: { total: 0, expired: 0, evicted: 0 },
      opsPerSec: 0,
      latency: 0,
      connections: 0,
      hitRate: 0,
      error: 'Redis não está disponível'
    };
  }
}

// Função para obter métricas do WebSocket
function getWebSocketMetrics(io) {
  if (!io) {
    return {
      status: 'offline',
      connections: 0,
      rooms: 0,
      latency: 0,
      error: 'WebSocket não está disponível'
    };
  }

  const connectedSockets = io.sockets.sockets.size;
  const rooms = io.sockets.adapter.rooms;
  
  let totalRooms = 0;
  let totalClientsInRooms = 0;
  
  rooms.forEach((clients, room) => {
    if (room !== room) { // Ignorar salas que são IDs de socket
      totalRooms++;
      totalClientsInRooms += clients.size;
    }
  });

  return {
    status: 'online',
    connections: connectedSockets,
    rooms: totalRooms,
    clientsInRooms: totalClientsInRooms,
    latency: 0, // Será calculado pelo sistema de métricas
    messagesPerSec: 0 // Será calculado pelo sistema de métricas
  };
}

module.exports = {
  getCurrentSystemMetrics,
  getVPSMetrics,
  getRedisMetrics,
  getWebSocketMetrics,
  VPS_CONFIGS
}; 