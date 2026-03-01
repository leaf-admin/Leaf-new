#!/bin/bash

# Script de Deploy do KYC Service Otimizado
# Versão: 2.0.0
# Data: $(date)

set -e

echo "🚀 DEPLOY DO KYC SERVICE OTIMIZADO"
echo "=================================="
echo ""

# Cores para output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Função para log colorido
log() {
    echo -e "${GREEN}[$(date +'%Y-%m-%d %H:%M:%S')]${NC} $1"
}

error() {
    echo -e "${RED}[ERROR]${NC} $1"
    exit 1
}

warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

# Verificar se estamos no diretório correto
if [ ! -f "requirements.txt" ]; then
    error "Arquivo requirements.txt não encontrado. Execute este script no diretório do KYC service."
fi

# Verificar Python
if ! command -v python3 &> /dev/null; then
    error "Python3 não está instalado"
fi

# Verificar pip
if ! command -v pip3 &> /dev/null; then
    error "pip3 não está instalado"
fi

log "Iniciando deploy do KYC Service Otimizado..."

# PASSO 1: Instalar dependências
log "📦 Instalando dependências Python..."
pip3 install -r requirements.txt

# Verificar se as dependências foram instaladas corretamente
log "🔍 Verificando dependências críticas..."
python3 -c "import cv2, mediapipe, numpy, redis, fastapi, uvicorn" || error "Falha ao importar dependências críticas"

# PASSO 2: Configurar Redis
log "🔧 Configurando Redis..."
if ! command -v redis-server &> /dev/null; then
    warning "Redis não está instalado. Instalando..."
    if command -v apt-get &> /dev/null; then
        sudo apt-get update
        sudo apt-get install -y redis-server
    elif command -v yum &> /dev/null; then
        sudo yum install -y redis
    elif command -v brew &> /dev/null; then
        brew install redis
    else
        error "Não foi possível instalar Redis automaticamente"
    fi
fi

# Iniciar Redis se não estiver rodando
if ! pgrep -x "redis-server" > /dev/null; then
    log "🔄 Iniciando Redis..."
    redis-server --daemonize yes
    sleep 2
fi

# Verificar conexão Redis
log "🔍 Verificando conexão Redis..."
python3 -c "
import redis
try:
    r = redis.Redis(host='localhost', port=6379, db=0)
    r.ping()
    print('✅ Redis conectado com sucesso')
except Exception as e:
    print(f'❌ Erro ao conectar Redis: {e}')
    exit(1)
"

# PASSO 3: Criar diretórios necessários
log "📁 Criando diretórios necessários..."
mkdir -p logs
mkdir -p temp
mkdir -p uploads
mkdir -p profiles

# PASSO 4: Configurar permissões
log "🔐 Configurando permissões..."
chmod +x scripts/*.sh
chmod 755 src/
chmod 755 config/

# PASSO 5: Testar configuração
log "🧪 Testando configuração..."
python3 -c "
import sys
sys.path.append('src')
from services.face_preprocessing import FacePreprocessor
from services.optimized_face_comparator import OptimizedFaceComparator
from services.redis_streams import RedisStreamManager

print('✅ Todos os módulos importados com sucesso')

# Testar inicialização dos serviços
try:
    preprocessor = FacePreprocessor()
    comparator = OptimizedFaceComparator()
    redis_manager = RedisStreamManager()
    print('✅ Todos os serviços inicializados com sucesso')
except Exception as e:
    print(f'❌ Erro ao inicializar serviços: {e}')
    exit(1)
"

# PASSO 6: Criar arquivo de configuração de produção
log "⚙️ Criando configuração de produção..."
cat > config/production_config.py << 'EOF'
# Configuração de Produção - KYC Service
import os

# Redis Configuration
REDIS_HOST = os.getenv('REDIS_HOST', 'localhost')
REDIS_PORT = int(os.getenv('REDIS_PORT', 6379))
REDIS_DB = int(os.getenv('REDIS_DB', 0))
REDIS_PASSWORD = os.getenv('REDIS_PASSWORD', None)

# API Configuration
API_HOST = os.getenv('API_HOST', '0.0.0.0')
API_PORT = int(os.getenv('API_PORT', 8000))

# KYC Configuration
MIN_FACE_CONFIDENCE = float(os.getenv('MIN_FACE_CONFIDENCE', 0.7))
MIN_LIVENESS_CONFIDENCE = float(os.getenv('MIN_LIVENESS_CONFIDENCE', 0.8))
SMILE_THRESHOLD = float(os.getenv('SMILE_THRESHOLD', 0.5))
BLINK_THRESHOLD = float(os.getenv('BLINK_THRESHOLD', 0.3))
MOTION_THRESHOLD = float(os.getenv('MOTION_THRESHOLD', 0.4))

# Stream Configuration
KYC_STREAM_KEY = os.getenv('KYC_STREAM_KEY', 'kyc:events')
KYC_GROUP_NAME = os.getenv('KYC_GROUP_NAME', 'kyc_group')
KYC_CONSUMER_NAME = os.getenv('KYC_CONSUMER_NAME', 'kyc_consumer')

# Logging Configuration
LOG_LEVEL = os.getenv('LOG_LEVEL', 'INFO')
LOG_FILE = os.getenv('LOG_FILE', 'logs/kyc_service.log')

# Performance Configuration
MAX_WORKERS = int(os.getenv('MAX_WORKERS', 4))
MAX_REQUESTS = int(os.getenv('MAX_REQUESTS', 1000))
TIMEOUT = int(os.getenv('TIMEOUT', 30))
EOF

# PASSO 7: Criar script de inicialização
log "🚀 Criando script de inicialização..."
cat > start_kyc_service.sh << 'EOF'
#!/bin/bash

# Script de Inicialização do KYC Service
# Versão: 2.0.0

set -e

echo "🚀 Iniciando KYC Service Otimizado..."
echo "====================================="

# Configurar variáveis de ambiente
export PYTHONPATH="${PYTHONPATH}:$(pwd)/src"
export LOG_LEVEL="INFO"
export MAX_WORKERS="4"

# Verificar se Redis está rodando
if ! pgrep -x "redis-server" > /dev/null; then
    echo "🔄 Iniciando Redis..."
    redis-server --daemonize yes
    sleep 2
fi

# Verificar conexão Redis
python3 -c "
import redis
try:
    r = redis.Redis(host='localhost', port=6379, db=0)
    r.ping()
    print('✅ Redis conectado')
except Exception as e:
    print(f'❌ Erro Redis: {e}')
    exit(1)
"

# Iniciar serviço
echo "🚀 Iniciando API FastAPI..."
cd src/api
python3 optimized_api.py

EOF

chmod +x start_kyc_service.sh

# PASSO 8: Criar script de monitoramento
log "📊 Criando script de monitoramento..."
cat > monitor_kyc_service.sh << 'EOF'
#!/bin/bash

# Script de Monitoramento do KYC Service
# Versão: 2.0.0

echo "📊 MONITORAMENTO DO KYC SERVICE"
echo "================================"

# Função para verificar status
check_status() {
    echo "🔍 Verificando status dos serviços..."
    
    # Verificar Redis
    if pgrep -x "redis-server" > /dev/null; then
        echo "✅ Redis: Rodando"
    else
        echo "❌ Redis: Parado"
    fi
    
    # Verificar API
    if curl -s http://localhost:8000/health > /dev/null; then
        echo "✅ API: Rodando"
    else
        echo "❌ API: Parada"
    fi
    
    # Verificar estatísticas
    echo ""
    echo "📈 Estatísticas do serviço:"
    curl -s http://localhost:8000/stats | python3 -m json.tool
}

# Função para verificar logs
check_logs() {
    echo ""
    echo "📋 Últimas 10 linhas do log:"
    if [ -f "logs/kyc_service.log" ]; then
        tail -10 logs/kyc_service.log
    else
        echo "Arquivo de log não encontrado"
    fi
}

# Função para verificar performance
check_performance() {
    echo ""
    echo "⚡ Performance do sistema:"
    
    # CPU
    echo "CPU: $(top -bn1 | grep "Cpu(s)" | awk '{print $2}' | cut -d'%' -f1)%"
    
    # Memória
    echo "Memória: $(free -h | awk '/^Mem:/ {print $3 "/" $2}')"
    
    # Disco
    echo "Disco: $(df -h . | awk 'NR==2 {print $3 "/" $2 " (" $5 ")"}')"
}

# Executar verificações
check_status
check_logs
check_performance

EOF

chmod +x monitor_kyc_service.sh

# PASSO 9: Criar script de teste
log "🧪 Criando script de teste..."
cat > test_kyc_service.sh << 'EOF'
#!/bin/bash

# Script de Teste do KYC Service
# Versão: 2.0.0

set -e

echo "🧪 TESTE DO KYC SERVICE"
echo "========================"

# Função para testar endpoint
test_endpoint() {
    local endpoint=$1
    local method=${2:-GET}
    local data=${3:-""}
    
    echo "🔍 Testando $method $endpoint..."
    
    if [ "$method" = "GET" ]; then
        response=$(curl -s -w "%{http_code}" -o /tmp/response.json "http://localhost:8000$endpoint")
    else
        response=$(curl -s -w "%{http_code}" -o /tmp/response.json -X "$method" -H "Content-Type: application/json" -d "$data" "http://localhost:8000$endpoint")
    fi
    
    if [ "$response" = "200" ]; then
        echo "✅ $endpoint: OK"
        cat /tmp/response.json | python3 -m json.tool
    else
        echo "❌ $endpoint: HTTP $response"
        cat /tmp/response.json
    fi
    
    echo ""
}

# Verificar se o serviço está rodando
if ! curl -s http://localhost:8000/health > /dev/null; then
    echo "❌ Serviço não está rodando. Execute ./start_kyc_service.sh primeiro"
    exit 1
fi

# Testar endpoints
test_endpoint "/health"
test_endpoint "/stats"

# Testar upload de imagem (exemplo)
echo "📤 Testando upload de imagem..."
if [ -f "test_images/test_profile.jpg" ]; then
    curl -s -X POST -F "user_id=test-user-123" -F "image=@test_images/test_profile.jpg" http://localhost:8000/upload_profile_image
    echo ""
else
    echo "⚠️ Imagem de teste não encontrada. Criando imagem de teste..."
    mkdir -p test_images
    # Criar imagem de teste simples
    python3 -c "
from PIL import Image
import numpy as np

# Criar imagem de teste
img = Image.new('RGB', (200, 200), color='white')
img.save('test_images/test_profile.jpg')
print('✅ Imagem de teste criada')
"
fi

echo "✅ Testes concluídos!"

EOF

chmod +x test_kyc_service.sh

# PASSO 10: Criar arquivo de configuração do sistema
log "⚙️ Criando configuração do sistema..."
cat > /etc/systemd/system/kyc-service.service << 'EOF'
[Unit]
Description=KYC Service Optimized
After=network.target redis.service

[Service]
Type=simple
User=root
WorkingDirectory=/opt/kyc-service
ExecStart=/opt/kyc-service/start_kyc_service.sh
Restart=always
RestartSec=10
Environment=PYTHONPATH=/opt/kyc-service/src
Environment=LOG_LEVEL=INFO

[Install]
WantedBy=multi-user.target
EOF

# PASSO 11: Finalizar deploy
log "🎉 Deploy concluído com sucesso!"
echo ""
echo "📋 PRÓXIMOS PASSOS:"
echo "==================="
echo ""
echo "1. Iniciar o serviço:"
echo "   ./start_kyc_service.sh"
echo ""
echo "2. Monitorar o serviço:"
echo "   ./monitor_kyc_service.sh"
echo ""
echo "3. Testar o serviço:"
echo "   ./test_kyc_service.sh"
echo ""
echo "4. Configurar como serviço do sistema:"
echo "   sudo systemctl enable kyc-service"
echo "   sudo systemctl start kyc-service"
echo ""
echo "5. Verificar logs:"
echo "   tail -f logs/kyc_service.log"
echo ""
echo "🌐 API disponível em: http://localhost:8000"
echo "📚 Documentação: http://localhost:8000/docs"
echo ""

# Verificar se tudo está funcionando
log "🔍 Verificação final..."
if [ -f "start_kyc_service.sh" ] && [ -f "monitor_kyc_service.sh" ] && [ -f "test_kyc_service.sh" ]; then
    echo "✅ Todos os scripts criados com sucesso"
else
    error "Falha ao criar scripts"
fi

echo ""
echo "🎯 KYC SERVICE OTIMIZADO PRONTO PARA USO!"
echo "=========================================="

