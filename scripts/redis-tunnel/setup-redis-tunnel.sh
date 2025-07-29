#!/bin/bash

# Redis Tunnel Setup for Firebase Functions
# Data: 29/07/2025
# Status: ✅ REDIS TUNNEL

# Configurações
REDIS_HOST="localhost"
REDIS_PORT="6379"
TUNNEL_PORT="6380"
FIREBASE_PROJECT="leaf-reactnative"

# Cores para output
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

# Função de logging
log_message() {
    echo -e "${GREEN}[$(date '+%Y-%m-%d %H:%M:%S')] $1${NC}"
}

log_error() {
    echo -e "${RED}[$(date '+%Y-%m-%d %H:%M:%S')] ERROR: $1${NC}"
}

log_warning() {
    echo -e "${YELLOW}[$(date '+%Y-%m-%d %H:%M:%S')] WARNING: $1${NC}"
}

# Verificar se Redis está rodando
check_redis() {
    if ! redis-cli ping > /dev/null 2>&1; then
        log_error "Redis não está rodando. Inicie o Redis primeiro."
        exit 1
    fi
    log_message "Redis está rodando"
}

# Instalar ngrok
install_ngrok() {
    if ! command -v ngrok &> /dev/null; then
        log_message "Instalando ngrok..."
        
        # Download ngrok
        wget https://bin.equinox.io/c/bNyj1mQVY4c/ngrok-v3-stable-linux-amd64.tgz
        tar -xzf ngrok-v3-stable-linux-amd64.tgz
        sudo mv ngrok /usr/local/bin/
        rm ngrok-v3-stable-linux-amd64.tgz
        
        log_message "ngrok instalado"
    else
        log_message "ngrok já está instalado"
    fi
}

# Configurar ngrok
setup_ngrok() {
    log_message "Configurando ngrok..."
    
    # Criar diretório de configuração
    mkdir -p ~/.ngrok2
    
    # Configurar authtoken (você precisa se registrar em ngrok.com)
    if [ -z "$NGROK_AUTHTOKEN" ]; then
        log_warning "NGROK_AUTHTOKEN não configurado. Configure sua authtoken:"
        echo "1. Acesse https://ngrok.com"
        echo "2. Faça login e obtenha sua authtoken"
        echo "3. Execute: ngrok authtoken YOUR_TOKEN"
        echo "4. Ou configure a variável NGROK_AUTHTOKEN"
    else
        ngrok authtoken $NGROK_AUTHTOKEN
        log_message "ngrok authtoken configurado"
    fi
}

# Criar túnel para Redis
create_redis_tunnel() {
    log_message "Criando túnel para Redis..."
    
    # Parar túneis existentes
    pkill -f "ngrok.*redis" || true
    
    # Criar túnel
    ngrok tcp $REDIS_PORT > /tmp/ngrok.log 2>&1 &
    NGROK_PID=$!
    
    # Aguardar túnel estar pronto
    sleep 5
    
    # Obter URL do túnel
    TUNNEL_URL=$(curl -s http://localhost:4040/api/tunnels | jq -r '.tunnels[0].public_url' | sed 's/tcp:////')
    
    if [ -z "$TUNNEL_URL" ] || [ "$TUNNEL_URL" = "null" ]; then
        log_error "Falha ao criar túnel ngrok"
        exit 1
    fi
    
    # Extrair host e porta
    TUNNEL_HOST=$(echo $TUNNEL_URL | cut -d':' -f1)
    TUNNEL_PORT=$(echo $TUNNEL_URL | cut -d':' -f2)
    
    log_message "Túnel criado: $TUNNEL_HOST:$TUNNEL_PORT"
    
    # Salvar configuração
    cat > /tmp/redis-tunnel-config.json << EOF
{
    "tunnel_host": "$TUNNEL_HOST",
    "tunnel_port": $TUNNEL_PORT,
    "local_host": "$REDIS_HOST",
    "local_port": $REDIS_PORT,
    "created_at": "$(date -Iseconds)",
    "ngrok_pid": $NGROK_PID
}
EOF
    
    echo $TUNNEL_HOST:$TUNNEL_PORT > /tmp/redis-tunnel-url.txt
    
    log_message "Configuração salva em /tmp/redis-tunnel-config.json"
}

# Configurar Firebase Functions
setup_firebase_functions() {
    log_message "Configurando Firebase Functions..."
    
    # Criar arquivo de configuração para Firebase Functions
    cat > functions/redis-tunnel-config.js << EOF
// Redis Tunnel Configuration for Firebase Functions
// Data: $(date '+%Y-%m-%d %H:%M:%S')

const tunnelConfig = {
    host: '$TUNNEL_HOST',
    port: $TUNNEL_PORT,
    password: process.env.REDIS_PASSWORD || null,
    db: process.env.REDIS_DB || 0,
    
    // Configurações de timeout
    connectTimeout: 10000,
    commandTimeout: 5000,
    
    // Configurações de retry
    retryDelayOnFailover: 100,
    maxRetriesPerRequest: 3,
    
    // Configurações de TLS (se necessário)
    tls: process.env.REDIS_TLS === 'true' ? {} : undefined
};

module.exports = tunnelConfig;
EOF
    
    log_message "Configuração do Firebase Functions criada"
}

# Atualizar configuração do Redis no Firebase Functions
update_firebase_redis_config() {
    log_message "Atualizando configuração do Redis no Firebase Functions..."
    
    # Ler configuração do túnel
    if [ -f /tmp/redis-tunnel-config.json ]; then
        TUNNEL_HOST=$(jq -r '.tunnel_host' /tmp/redis-tunnel-config.json)
        TUNNEL_PORT=$(jq -r '.tunnel_port' /tmp/redis-tunnel-config.json)
        
        # Atualizar arquivo de configuração do Redis
        cat > functions/redis-config.js << EOF
// Redis Configuration for Firebase Functions
// Data: $(date '+%Y-%m-%d %H:%M:%S')

const REDIS_CONFIG = {
    host: '$TUNNEL_HOST',
    port: $TUNNEL_PORT,
    password: process.env.REDIS_PASSWORD || null,
    db: process.env.REDIS_DB || 0,
    
    // Configurações de timeout
    connectTimeout: 10000,
    commandTimeout: 5000,
    
    // Configurações de retry
    retryDelayOnFailover: 100,
    maxRetriesPerRequest: 3,
    
    // Configurações de TLS (se necessário)
    tls: process.env.REDIS_TLS === 'true' ? {} : undefined
};

module.exports = REDIS_CONFIG;
EOF
        
        log_message "Configuração do Redis atualizada"
    else
        log_error "Arquivo de configuração do túnel não encontrado"
        exit 1
    fi
}

# Testar conexão
test_connection() {
    log_message "Testando conexão com Redis via túnel..."
    
    if [ -f /tmp/redis-tunnel-config.json ]; then
        TUNNEL_HOST=$(jq -r '.tunnel_host' /tmp/redis-tunnel-config.json)
        TUNNEL_PORT=$(jq -r '.tunnel_port' /tmp/redis-tunnel-config.json)
        
        # Testar conexão usando netcat
        if timeout 5 nc -z $TUNNEL_HOST $TUNNEL_PORT; then
            log_message "✅ Conexão com Redis via túnel funcionando"
        else
            log_error "❌ Falha na conexão com Redis via túnel"
            exit 1
        fi
    else
        log_error "Arquivo de configuração do túnel não encontrado"
        exit 1
    fi
}

# Deploy para Firebase Functions
deploy_firebase_functions() {
    log_message "Deployando Firebase Functions..."
    
    cd functions
    
    # Instalar dependências
    npm install
    
    # Deploy
    firebase deploy --only functions
    
    if [ $? -eq 0 ]; then
        log_message "✅ Firebase Functions deployado com sucesso"
    else
        log_error "❌ Falha no deploy do Firebase Functions"
        exit 1
    fi
    
    cd ..
}

# Criar script de monitoramento
create_monitoring_script() {
    log_message "Criando script de monitoramento..."
    
    cat > /home/leaf/scripts/monitor-redis-tunnel.sh << 'EOF'
#!/bin/bash

# Monitor Redis Tunnel
# Data: 29/07/2025

TUNNEL_CONFIG="/tmp/redis-tunnel-config.json"
LOG_FILE="/var/log/redis-tunnel.log"

log_message() {
    echo "$(date '+%Y-%m-%d %H:%M:%S') - $1" | tee -a $LOG_FILE
}

# Verificar se túnel está ativo
check_tunnel() {
    if [ ! -f "$TUNNEL_CONFIG" ]; then
        log_message "ERROR: Configuração do túnel não encontrada"
        return 1
    fi
    
    TUNNEL_HOST=$(jq -r '.tunnel_host' $TUNNEL_CONFIG)
    TUNNEL_PORT=$(jq -r '.tunnel_port' $TUNNEL_CONFIG)
    NGROK_PID=$(jq -r '.ngrok_pid' $TUNNEL_CONFIG)
    
    # Verificar se processo ngrok está rodando
    if ! kill -0 $NGROK_PID 2>/dev/null; then
        log_message "ERROR: Processo ngrok não está rodando"
        return 1
    fi
    
    # Testar conexão
    if timeout 5 nc -z $TUNNEL_HOST $TUNNEL_PORT; then
        log_message "INFO: Túnel Redis funcionando"
        return 0
    else
        log_message "ERROR: Falha na conexão do túnel"
        return 1
    fi
}

# Reiniciar túnel se necessário
restart_tunnel() {
    log_message "Reiniciando túnel Redis..."
    
    # Parar túnel atual
    pkill -f "ngrok.*redis" || true
    
    # Aguardar
    sleep 2
    
    # Recriar túnel
    ngrok tcp 6379 > /tmp/ngrok.log 2>&1 &
    NGROK_PID=$!
    
    sleep 5
    
    # Atualizar configuração
    TUNNEL_URL=$(curl -s http://localhost:4040/api/tunnels | jq -r '.tunnels[0].public_url' | sed 's/tcp:////')
    TUNNEL_HOST=$(echo $TUNNEL_URL | cut -d':' -f1)
    TUNNEL_PORT=$(echo $TUNNEL_URL | cut -d':' -f2)
    
    cat > $TUNNEL_CONFIG << EOF
{
    "tunnel_host": "$TUNNEL_HOST",
    "tunnel_port": $TUNNEL_PORT,
    "local_host": "localhost",
    "local_port": 6379,
    "created_at": "$(date -Iseconds)",
    "ngrok_pid": $NGROK_PID
}
EOF
    
    log_message "Túnel reiniciado"
}

# Loop principal
while true; do
    if ! check_tunnel; then
        restart_tunnel
    fi
    
    sleep 60
done
EOF
    
    chmod +x /home/leaf/scripts/monitor-redis-tunnel.sh
    log_message "Script de monitoramento criado"
}

# Função principal
main() {
    log_message "=== CONFIGURAÇÃO REDIS TUNNEL PARA FIREBASE FUNCTIONS ==="
    
    # Verificações
    check_redis
    
    # Instalação e configuração
    install_ngrok
    setup_ngrok
    create_redis_tunnel
    setup_firebase_functions
    update_firebase_redis_config
    
    # Testes
    test_connection
    
    # Deploy
    deploy_firebase_functions
    
    # Monitoramento
    create_monitoring_script
    
    log_message "=== CONFIGURAÇÃO CONCLUÍDA ==="
    log_message "🌐 Túnel Redis: $TUNNEL_HOST:$TUNNEL_PORT"
    log_message "🔗 Firebase Functions conectado ao Redis local"
    log_message "📊 Monitoramento ativo em /home/leaf/scripts/monitor-redis-tunnel.sh"
    log_message ""
    log_message "Para iniciar monitoramento:"
    log_message "nohup /home/leaf/scripts/monitor-redis-tunnel.sh > /dev/null 2>&1 &"
}

# Executar função principal
main "$@" 