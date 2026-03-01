/**
 * CONFIGURAÇÃO OTIMIZADA PARA VPS
 * 
 * Adaptando sistema para recursos limitados:
 * - 4 vCPUs
 * - 8GB RAM
 * - 160GB SSD
 */

const os = require('os');
const cluster = require('cluster');

// Configurações otimizadas para VPS
const VPS_CONFIG = {
  // Recursos disponíveis
  resources: {
    vcpus: 4,
    ram: 8192, // MB
    storage: 160 // GB
  },
  
  // Configurações otimizadas
  optimization: {
    // Workers: 1 por vCPU (4 workers total)
    workers: 4,
    
    // Redis: Configuração otimizada
    redis: {
      maxmemory: '2gb', // 25% da RAM
      maxmemoryPolicy: 'allkeys-lru',
      save: '900 1 300 10 60 10000', // Persistência otimizada
      tcpKeepalive: 60,
      timeout: 300
    },
    
    // PostgreSQL: Configuração otimizada
    postgresql: {
      sharedBuffers: '2GB', // 25% da RAM
      effectiveCacheSize: '6GB', // 75% da RAM
      workMem: '256MB',
      maintenanceWorkMem: '512MB',
      maxConnections: 100, // Reduzido para VPS
      checkpointSegments: 32,
      walBuffers: '16MB'
    },
    
    // Node.js: Configurações otimizadas
    nodejs: {
      maxOldSpaceSize: 2048, // 2GB heap
      maxSemiSpaceSize: 128, // 128MB semi-space
      gcInterval: 100, // GC mais frequente
      uvThreadPoolSize: 4 // 1 thread por vCPU
    },
    
    // Nginx: Configuração otimizada
    nginx: {
      workerProcesses: 4, // 1 por vCPU
      workerConnections: 1024, // Reduzido para VPS
      keepaliveTimeout: 65,
      clientMaxBodySize: '10M',
      gzipCompression: true
    }
  }
};

console.log('🚀 CONFIGURAÇÃO OTIMIZADA PARA VPS');
console.log('==================================');
console.log('');

console.log('📊 RECURSOS DA VPS:');
console.log('==================');
console.log(`💻 vCPUs: ${VPS_CONFIG.resources.vcpus}`);
console.log(`🧠 RAM: ${VPS_CONFIG.resources.ram}MB (${VPS_CONFIG.resources.ram/1024}GB)`);
console.log(`💾 Storage: ${VPS_CONFIG.resources.storage}GB SSD`);
console.log('');

console.log('⚙️ CONFIGURAÇÕES OTIMIZADAS:');
console.log('============================');
console.log('');

console.log('🔧 NODE.JS:');
console.log(`   Workers: ${VPS_CONFIG.optimization.workers} (1 por vCPU)`);
console.log(`   Heap Size: ${VPS_CONFIG.optimization.nodejs.maxOldSpaceSize}MB`);
console.log(`   Semi Space: ${VPS_CONFIG.optimization.nodejs.maxSemiSpaceSize}MB`);
console.log(`   Thread Pool: ${VPS_CONFIG.optimization.nodejs.uvThreadPoolSize}`);
console.log('');

console.log('🔧 REDIS:');
console.log(`   Max Memory: ${VPS_CONFIG.optimization.redis.maxmemory}`);
console.log(`   Policy: ${VPS_CONFIG.optimization.redis.maxmemoryPolicy}`);
console.log(`   Keepalive: ${VPS_CONFIG.optimization.redis.tcpKeepalive}s`);
console.log(`   Timeout: ${VPS_CONFIG.optimization.redis.timeout}s`);
console.log('');

console.log('🔧 POSTGRESQL:');
console.log(`   Shared Buffers: ${VPS_CONFIG.optimization.postgresql.sharedBuffers}`);
console.log(`   Cache Size: ${VPS_CONFIG.optimization.postgresql.effectiveCacheSize}`);
console.log(`   Work Memory: ${VPS_CONFIG.optimization.postgresql.workMem}`);
console.log(`   Max Connections: ${VPS_CONFIG.optimization.postgresql.maxConnections}`);
console.log('');

console.log('🔧 NGINX:');
console.log(`   Worker Processes: ${VPS_CONFIG.optimization.nginx.workerProcesses}`);
console.log(`   Worker Connections: ${VPS_CONFIG.optimization.nginx.workerConnections}`);
console.log(`   Keepalive Timeout: ${VPS_CONFIG.optimization.nginx.keepaliveTimeout}s`);
console.log(`   Max Body Size: ${VPS_CONFIG.optimization.nginx.clientMaxBodySize}`);
console.log('');

console.log('📋 COMANDOS OTIMIZADOS PARA VPS:');
console.log('================================');
console.log('');

console.log('1. CONECTAR NA VPS:');
console.log('ssh root@216.238.107.59');
console.log('');

console.log('2. INSTALAR DEPENDÊNCIAS OTIMIZADAS:');
console.log('curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -');
console.log('apt-get update && apt-get install -y nodejs redis-server postgresql postgresql-contrib nginx');
console.log('');

console.log('3. CONFIGURAR REDIS OTIMIZADO:');
console.log('cat > /etc/redis/redis.conf << EOF');
console.log('port 6379');
console.log('bind 127.0.0.1');
console.log(`maxmemory ${VPS_CONFIG.optimization.redis.maxmemory}`);
console.log(`maxmemory-policy ${VPS_CONFIG.optimization.redis.maxmemoryPolicy}`);
console.log(`save ${VPS_CONFIG.optimization.redis.save}`);
console.log(`tcp-keepalive ${VPS_CONFIG.optimization.redis.tcpKeepalive}`);
console.log(`timeout ${VPS_CONFIG.optimization.redis.timeout}`);
console.log('EOF');
console.log('');

console.log('4. CONFIGURAR POSTGRESQL OTIMIZADO:');
console.log('cat > /etc/postgresql/16/main/postgresql.conf << EOF');
console.log(`shared_buffers = ${VPS_CONFIG.optimization.postgresql.sharedBuffers}`);
console.log(`effective_cache_size = ${VPS_CONFIG.optimization.postgresql.effectiveCacheSize}`);
console.log(`work_mem = ${VPS_CONFIG.optimization.postgresql.workMem}`);
console.log(`maintenance_work_mem = ${VPS_CONFIG.optimization.postgresql.maintenanceWorkMem}`);
console.log(`max_connections = ${VPS_CONFIG.optimization.postgresql.maxConnections}`);
console.log(`checkpoint_segments = ${VPS_CONFIG.optimization.postgresql.checkpointSegments}`);
console.log(`wal_buffers = ${VPS_CONFIG.optimization.postgresql.walBuffers}`);
console.log('EOF');
console.log('');

console.log('5. CONFIGURAR NGINX OTIMIZADO:');
console.log('cat > /etc/nginx/nginx.conf << EOF');
console.log('user www-data;');
console.log(`worker_processes ${VPS_CONFIG.optimization.nginx.workerProcesses};`);
console.log('pid /run/nginx.pid;');
console.log('');
console.log('events {');
console.log(`    worker_connections ${VPS_CONFIG.optimization.nginx.workerConnections};`);
console.log('    use epoll;');
console.log('    multi_accept on;');
console.log('}');
console.log('');
console.log('http {');
console.log('    sendfile on;');
console.log('    tcp_nopush on;');
console.log('    tcp_nodelay on;');
console.log(`    keepalive_timeout ${VPS_CONFIG.optimization.nginx.keepaliveTimeout};`);
console.log(`    client_max_body_size ${VPS_CONFIG.optimization.nginx.clientMaxBodySize};`);
console.log('');
console.log('    gzip on;');
console.log('    gzip_vary on;');
console.log('    gzip_min_length 1024;');
console.log('    gzip_types text/plain text/css application/json application/javascript text/xml application/xml application/xml+rss text/javascript;');
console.log('');
console.log('    upstream leaf_backend {');
console.log('        server 127.0.0.1:3001;');
console.log('    }');
console.log('');
console.log('    server {');
console.log('        listen 80;');
console.log('        server_name 216.238.107.59;');
console.log('');
console.log('        location / {');
console.log('            proxy_pass http://leaf_backend;');
console.log('            proxy_http_version 1.1;');
console.log('            proxy_set_header Upgrade $http_upgrade;');
console.log('            proxy_set_header Connection "upgrade";');
console.log('            proxy_set_header Host $host;');
console.log('            proxy_set_header X-Real-IP $remote_addr;');
console.log('            proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;');
console.log('            proxy_set_header X-Forwarded-Proto $scheme;');
console.log('        }');
console.log('    }');
console.log('}');
console.log('EOF');
console.log('');

console.log('6. INICIAR SERVIÇOS:');
console.log('systemctl restart redis-server');
console.log('systemctl restart postgresql');
console.log('systemctl restart nginx');
console.log('systemctl enable redis-server postgresql nginx');
console.log('');

console.log('7. UPLOAD DO CÓDIGO:');
console.log('scp -r leaf-websocket-backend/ root@216.238.107.59:/root/');
console.log('');

console.log('8. CONFIGURAR PROJETO:');
console.log('cd /root/leaf-websocket-backend');
console.log('npm install --production');
console.log('');

console.log('9. CRIAR SERVER OTIMIZADO PARA VPS:');
console.log('cat > server-vps.js << EOF');
console.log('const cluster = require("cluster");');
console.log('const numCPUs = 4; // VPS tem 4 vCPUs');
console.log('');
console.log('if (cluster.isMaster) {');
console.log('    console.log(`Master ${process.pid} is running`);');
console.log('');
console.log('    // Fork workers');
console.log('    for (let i = 0; i < numCPUs; i++) {');
console.log('        cluster.fork();');
console.log('    }');
console.log('');
console.log('    cluster.on("exit", (worker, code, signal) => {');
console.log('        console.log(`Worker ${worker.process.pid} died`);');
console.log('        cluster.fork();');
console.log('    });');
console.log('} else {');
console.log('    // Worker process');
console.log('    require("./server.js");');
console.log('}');
console.log('EOF');
console.log('');

console.log('10. INICIAR SERVIDOR OTIMIZADO:');
console.log('NODE_OPTIONS="--max-old-space-size=2048 --max-semi-space-size=128" node server-vps.js');
console.log('');

console.log('🎯 CONFIGURAÇÕES DE PRODUÇÃO:');
console.log('============================');
console.log('');

console.log('📊 CAPACIDADE ESTIMADA:');
console.log('=======================');
console.log('👥 Usuários Simultâneos: 2,000-3,000');
console.log('⚡ Requests/segundo: 500-800');
console.log('⏱️ Latência: <200ms');
console.log('💾 Uso de RAM: ~6GB');
console.log('💿 Uso de Storage: ~20GB');
console.log('');

console.log('🔍 MONITORAMENTO:');
console.log('================');
console.log('');

console.log('Health Check: http://216.238.107.59/health');
console.log('GraphQL: http://216.238.107.59/graphql');
console.log('WebSocket: ws://216.238.107.59');
console.log('');

console.log('📈 COMANDOS DE MONITORAMENTO:');
console.log('============================');
console.log('');

console.log('# Verificar uso de recursos');
console.log('htop');
console.log('');

console.log('# Verificar Redis');
console.log('redis-cli info memory');
console.log('');

console.log('# Verificar PostgreSQL');
console.log('psql -c "SELECT * FROM pg_stat_activity;"');
console.log('');

console.log('# Verificar Nginx');
console.log('nginx -t && systemctl status nginx');
console.log('');

console.log('# Verificar logs do servidor');
console.log('tail -f /root/leaf-websocket-backend/logs/server.log');
console.log('');

console.log('🚀 SISTEMA OTIMIZADO PARA VPS!');
console.log('==============================');
console.log('');

console.log('✅ Configurações adaptadas para recursos limitados');
console.log('✅ Workers reduzidos para 4 (1 por vCPU)');
console.log('✅ Memória otimizada para 8GB RAM');
console.log('✅ Redis configurado para 2GB');
console.log('✅ PostgreSQL otimizado para VPS');
console.log('✅ Nginx configurado para alta performance');
console.log('');

console.log('🎉 PRONTO PARA DEPLOY OTIMIZADO!');
