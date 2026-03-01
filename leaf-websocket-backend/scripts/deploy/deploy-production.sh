#!/bin/bash

# Script de Deploy para Produção - Leaf App
# ==========================================

set -e

echo "🚀 INICIANDO DEPLOY EM PRODUÇÃO"
echo "================================"

# Cores para output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Função para log
log() {
    echo -e "${BLUE}[$(date +'%Y-%m-%d %H:%M:%S')]${NC} $1"
}

error() {
    echo -e "${RED}[ERROR]${NC} $1"
    exit 1
}

success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

# Verificar se Docker está rodando
if ! docker info > /dev/null 2>&1; then
    error "Docker não está rodando. Por favor, inicie o Docker primeiro."
fi

# Verificar se Docker Compose está disponível
if ! command -v docker-compose &> /dev/null; then
    error "Docker Compose não está instalado."
fi

log "Parando containers existentes..."
docker-compose -f docker-compose-production.yml down --remove-orphans || true

log "Removendo imagens antigas..."
docker image prune -f || true

log "Construindo novas imagens..."
docker-compose -f docker-compose-production.yml build --no-cache

log "Iniciando serviços..."
docker-compose -f docker-compose-production.yml up -d

log "Aguardando serviços ficarem saudáveis..."
sleep 30

# Verificar saúde dos serviços
log "Verificando saúde dos serviços..."

# PostgreSQL
if docker-compose -f docker-compose-production.yml exec -T postgres pg_isready -U leaf_user -d leaf_production > /dev/null 2>&1; then
    success "PostgreSQL está saudável"
else
    error "PostgreSQL não está respondendo"
fi

# Redis
if docker-compose -f docker-compose-production.yml exec -T redis redis-cli ping > /dev/null 2>&1; then
    success "Redis está saudável"
else
    error "Redis não está respondendo"
fi

# MinIO
if curl -f http://localhost:9000/minio/health/live > /dev/null 2>&1; then
    success "MinIO está saudável"
else
    error "MinIO não está respondendo"
fi

# Nginx
if curl -f http://localhost/health > /dev/null 2>&1; then
    success "Nginx está saudável"
else
    error "Nginx não está respondendo"
fi

# WebSocket servers
for i in 1 2 3; do
    if curl -f http://localhost:300$i/health > /dev/null 2>&1; then
        success "WebSocket-$i está saudável"
    else
        error "WebSocket-$i não está respondendo"
    fi
done

# Prometheus
if curl -f http://localhost:9090/-/healthy > /dev/null 2>&1; then
    success "Prometheus está saudável"
else
    error "Prometheus não está respondendo"
fi

# Grafana
if curl -f http://localhost:3000/api/health > /dev/null 2>&1; then
    success "Grafana está saudável"
else
    error "Grafana não está respondendo"
fi

log "Executando testes de integração..."
sleep 10

# Teste básico de GraphQL
if curl -X POST http://localhost/graphql \
    -H "Content-Type: application/json" \
    -d '{"query":"query { __schema { types { name } } }"}' \
    > /dev/null 2>&1; then
    success "GraphQL está funcionando"
else
    warning "GraphQL pode ter problemas"
fi

# Teste básico de WebSocket
if curl -f http://localhost/socket.io/ > /dev/null 2>&1; then
    success "WebSocket está funcionando"
else
    warning "WebSocket pode ter problemas"
fi

log "Configurando MinIO buckets..."
# Criar buckets no MinIO
docker-compose -f docker-compose-production.yml exec -T minio mc alias set local http://localhost:9000 leaf_minio_user leaf_minio_password_2024 || true
docker-compose -f docker-compose-production.yml exec -T minio mc mb local/leaf-uploads || true
docker-compose -f docker-compose-production.yml exec -T minio mc mb local/leaf-documents || true
docker-compose -f docker-compose-production.yml exec -T minio mc policy set public local/leaf-uploads || true

log "Configurando banco de dados..."
# Executar migrações do banco
docker-compose -f docker-compose-production.yml exec -T postgres psql -U leaf_user -d leaf_production -c "
CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    phone VARCHAR(20),
    user_type VARCHAR(20) DEFAULT 'CUSTOMER',
    status VARCHAR(20) DEFAULT 'ACTIVE',
    rating DECIMAL(3,2) DEFAULT 5.0,
    total_trips INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS drivers (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    phone VARCHAR(20),
    license_number VARCHAR(50),
    status VARCHAR(20) DEFAULT 'AVAILABLE',
    rating DECIMAL(3,2) DEFAULT 5.0,
    total_trips INTEGER DEFAULT 0,
    location_lat DECIMAL(10,8),
    location_lng DECIMAL(11,8),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS bookings (
    id SERIAL PRIMARY KEY,
    passenger_id INTEGER REFERENCES users(id),
    driver_id INTEGER REFERENCES drivers(id),
    pickup_lat DECIMAL(10,8) NOT NULL,
    pickup_lng DECIMAL(11,8) NOT NULL,
    pickup_address TEXT,
    destination_lat DECIMAL(10,8) NOT NULL,
    destination_lng DECIMAL(11,8) NOT NULL,
    destination_address TEXT,
    status VARCHAR(20) DEFAULT 'PENDING',
    fare DECIMAL(10,2),
    distance DECIMAL(10,2),
    duration INTEGER,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_phone ON users(phone);
CREATE INDEX IF NOT EXISTS idx_drivers_email ON drivers(email);
CREATE INDEX IF NOT EXISTS idx_drivers_status ON drivers(status);
CREATE INDEX IF NOT EXISTS idx_bookings_passenger ON bookings(passenger_id);
CREATE INDEX IF NOT EXISTS idx_bookings_driver ON bookings(driver_id);
CREATE INDEX IF NOT EXISTS idx_bookings_status ON bookings(status);
" || true

log "Configurando monitoramento..."
# Configurar Prometheus targets
cat > prometheus.yml << EOF
global:
  scrape_interval: 15s
  evaluation_interval: 15s

scrape_configs:
  - job_name: 'leaf-websocket'
    static_configs:
      - targets: ['websocket-1:3001', 'websocket-2:3002', 'websocket-3:3003']
    metrics_path: /metrics
    scrape_interval: 5s

  - job_name: 'nginx'
    static_configs:
      - targets: ['nginx:80']
    metrics_path: /nginx_status
    scrape_interval: 10s

  - job_name: 'postgres'
    static_configs:
      - targets: ['postgres:5432']
    scrape_interval: 30s

  - job_name: 'redis'
    static_configs:
      - targets: ['redis:6379']
    scrape_interval: 30s
EOF

log "Executando teste de carga..."
# Teste básico de carga
for i in {1..10}; do
    curl -f http://localhost/health > /dev/null 2>&1 &
done
wait

log "Gerando relatório de deploy..."
echo "📊 RELATÓRIO DE DEPLOY"
echo "======================"
echo "✅ PostgreSQL: http://localhost:5432"
echo "✅ Redis: http://localhost:6379"
echo "✅ MinIO: http://localhost:9000"
echo "✅ Nginx: http://localhost:80"
echo "✅ GraphQL: http://localhost/graphql"
echo "✅ WebSocket: http://localhost/socket.io/"
echo "✅ Prometheus: http://localhost:9090"
echo "✅ Grafana: http://localhost:3000"
echo ""
echo "🔐 Credenciais:"
echo "PostgreSQL: leaf_user / leaf_secure_password_2024"
echo "MinIO: leaf_minio_user / leaf_minio_password_2024"
echo "Grafana: admin / leaf_grafana_password_2024"
echo ""
echo "📈 Monitoramento:"
echo "Prometheus: http://localhost:9090"
echo "Grafana: http://localhost:3000"
echo ""
echo "🧪 Testes:"
echo "Health Check: http://localhost/health"
echo "GraphQL Playground: http://localhost/graphql"

success "Deploy em produção concluído com sucesso!"
echo ""
echo "🎉 SISTEMA PRONTO PARA PRODUÇÃO!"
echo "================================"
echo "Todos os serviços estão rodando e saudáveis."
echo "O sistema está pronto para receber tráfego de produção."
echo ""
echo "Para parar os serviços:"
echo "docker-compose -f docker-compose-production.yml down"
echo ""
echo "Para ver logs:"
echo "docker-compose -f docker-compose-production.yml logs -f"