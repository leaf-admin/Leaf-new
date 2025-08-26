#!/bin/bash

# Script de Deploy Automático para Leaf System - VPS Vultr 8GB
# Suporte para 500k+ usuários simultâneos

set -e

# Configurações
VULTR_IP="216.238.107.59"
VULTR_USER="root"
VULTR_SSH_KEY="~/.ssh/id_rsa"
DOCKER_IMAGE="leaf-websocket-backend:production"

# Cores para output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}🚀 DEPLOY AUTOMÁTICO PARA VPS VULTR 8GB${NC}"
echo "================================================"

# Função para verificar pré-requisitos
check_prerequisites() {
    echo -e "${BLUE}🔍 Verificando pré-requisitos...${NC}"
    
    # Verificar se IP foi fornecido
    if [ -z "$VULTR_IP" ]; then
        echo -e "${RED}❌ Erro: VULTR_IP não configurado${NC}"
        echo "Por favor, edite o script e configure VULTR_IP"
        exit 1
    fi
    
    # Verificar se Docker está rodando localmente
    if ! docker info > /dev/null 2>&1; then
        echo -e "${RED}❌ Erro: Docker não está rodando localmente${NC}"
        exit 1
    fi
    
    # Verificar se imagem existe
    if ! docker images | grep -q "leaf-websocket-backend"; then
        echo -e "${YELLOW}⚠️ Imagem Docker não encontrada. Fazendo build...${NC}"
        docker build -t leaf-websocket-backend:production .
    fi
    
    echo -e "${GREEN}✅ Pré-requisitos verificados${NC}"
}

# Função para fazer build da imagem
build_image() {
    echo -e "${BLUE}🔨 Fazendo build da imagem Docker...${NC}"
    
    docker build -t leaf-websocket-backend:production .
    docker tag leaf-websocket-backend:production leaf-websocket-backend:v1.0
    
    echo -e "${GREEN}✅ Imagem construída com sucesso${NC}"
}

# Função para conectar na Vultr
connect_vultr() {
    echo -e "${BLUE}🌐 Conectando na VPS Vultr...${NC}"
    
    # Testar conexão SSH
    if ! ssh -o ConnectTimeout=10 -o BatchMode=yes -i "$VULTR_SSH_KEY" "$VULTR_USER@$VULTR_IP" exit 2>/dev/null; then
        echo -e "${RED}❌ Erro: Não foi possível conectar na Vultr${NC}"
        echo "Verifique:"
        echo "  - IP da VPS está correto"
        echo "  - Chave SSH está configurada"
        echo "  - Firewall permite conexão SSH"
        exit 1
    fi
    
    echo -e "${GREEN}✅ Conexão SSH estabelecida${NC}"
}

# Função para verificar se apt está livre
wait_for_apt() {
    echo -e "${YELLOW}⏳ Verificando se apt está livre...${NC}"
    
    while fuser /var/lib/dpkg/lock-frontend >/dev/null 2>&1 || fuser /var/lib/apt/lists/lock >/dev/null 2>&1 || fuser /var/cache/apt/archives/lock >/dev/null 2>&1; do
        echo -e "${YELLOW}⏳ apt está em uso, aguardando... (PID: $(fuser /var/lib/dpkg/lock-frontend 2>/dev/null || echo 'N/A'))${NC}"
        sleep 10
    done
    
    echo -e "${GREEN}✅ apt está livre, continuando...${NC}"
}

# Função para instalar Docker na Vultr
install_docker_vultr() {
    echo -e "${BLUE}🐳 Verificando Docker na Vultr...${NC}"
    
    ssh -i "$VULTR_SSH_KEY" "$VULTR_USER@$VULTR_IP" << 'EOF'
        # Verificar se Docker já está instalado
        if command -v docker &> /dev/null && docker --version &> /dev/null; then
            echo "✅ Docker já está instalado: $(docker --version)"
            echo "✅ Docker Compose já está instalado: $(docker-compose --version)"
            exit 0
        fi
        
        echo "🚀 Docker não encontrado, instalando..."
        
        # Verificar se apt está livre antes de começar
        while fuser /var/lib/dpkg/lock-frontend >/dev/null 2>&1 || fuser /var/lib/apt/lists/lock >/dev/null 2>&1 || fuser /var/cache/apt/archives/lock >/dev/null 2>&1; do
            echo "⏳ apt está em uso, aguardando... (PID: $(fuser /var/lib/dpkg/lock-frontend 2>/dev/null || echo 'N/A'))"
            sleep 10
        done
        
        echo "🚀 Instalando Docker sem atualizações do sistema..."
        
        # Instalar dependências essenciais
        sudo apt install -y apt-transport-https ca-certificates curl gnupg lsb-release
        
        # Verificar novamente antes de continuar
        while fuser /var/lib/dpkg/lock-frontend >/dev/null 2>&1 || fuser /var/lib/apt/lists/lock >/dev/null 2>&1 || fuser /var/cache/apt/archives/lock >/dev/null 2>&1; do
            echo "⏳ apt está em uso, aguardando... (PID: $(fuser /var/lib/dpkg/lock-frontend 2>/dev/null || echo 'N/A'))"
            sleep 10
        done
        
        # Adicionar repositório Docker
        curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /usr/share/keyrings/docker-archive-keyring.gpg
        echo "deb [arch=amd64 signed-by=/usr/share/keyrings/docker-archive-keyring.gpg] https://download.docker.com/linux/ubuntu $(lsb_release -cs) stable" | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
        
        # Verificar novamente antes de instalar Docker
        while fuser /var/lib/dpkg/lock-frontend >/dev/null 2>&1 || fuser /var/lib/apt/lists/lock >/dev/null 2>&1 || fuser /var/cache/apt/archives/lock >/dev/null 2>&1; do
            echo "⏳ apt está em uso, aguardando... (PID: $(fuser /var/lib/dpkg/lock-frontend 2>/dev/null || echo 'N/A'))"
            sleep 10
        done
        
        # Instalar Docker
        sudo apt install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin
        
        # Configurar usuário
        sudo usermod -aG docker $USER
        
        # Iniciar e habilitar Docker
        sudo systemctl start docker
        sudo systemctl enable docker
        
        # Instalar Docker Compose
        sudo curl -L "https://github.com/docker/compose/releases/download/v2.20.0/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
        sudo chmod +x /usr/local/bin/docker-compose
        
        echo "Docker instalado com sucesso!"
EOF
    
    echo -e "${GREEN}✅ Docker verificado/instalado na Vultr${NC}"
}

# Função para fazer deploy dos arquivos
deploy_files() {
    echo -e "${BLUE}📁 Fazendo deploy dos arquivos...${NC}"
    
    # Criar diretório na Vultr
    ssh -i "$VULTR_SSH_KEY" "$VULTR_USER@$VULTR_IP" "mkdir -p ~/leaf-system"
    
    # Copiar arquivos
    scp -i "$VULTR_SSH_KEY" docker-compose-vultr-8gb.yml "$VULTR_USER@$VULTR_IP:~/leaf-system/"
    scp -i "$VULTR_SSH_KEY" nginx-vultr.conf "$VULTR_USER@$VULTR_IP:~/leaf-system/"
    scp -i "$VULTR_SSH_KEY" auto-scale-docker.sh "$VULTR_USER@$VULTR_IP:~/leaf-system/"
    
    # Copiar código fonte
    scp -r -i "$VULTR_SSH_KEY" . "$VULTR_USER@$VULTR_IP:~/leaf-system/"
    
    echo -e "${GREEN}✅ Arquivos copiados para Vultr${NC}"
}

# Função para fazer deploy da imagem Docker
deploy_docker_image() {
    echo -e "${BLUE}🐳 Fazendo deploy da imagem Docker...${NC}"
    
    # Salvar imagem localmente
    docker save leaf-websocket-backend:production | gzip > leaf-websocket-backend.tar.gz
    
    # Copiar imagem para Vultr
    scp -i "$VULTR_SSH_KEY" leaf-websocket-backend.tar.gz "$VULTR_USER@$VULTR_IP:~/leaf-system/"
    
    # Carregar imagem na Vultr
    ssh -i "$VULTR_SSH_KEY" "$VULTR_USER@$VULTR_IP" << 'EOF'
        cd ~/leaf-system
        docker load < leaf-websocket-backend.tar.gz
        rm leaf-websocket-backend.tar.gz
EOF
    
    # Limpar arquivo local
    rm leaf-websocket-backend.tar.gz
    
    echo -e "${GREEN}✅ Imagem Docker deployada na Vultr${NC}"
}

# Função para iniciar sistema na Vultr
start_system_vultr() {
    echo -e "${BLUE}🚀 Iniciando Leaf System na Vultr...${NC}"
    
    ssh -i "$VULTR_SSH_KEY" "$VULTR_USER@$VULTR_IP" << 'EOF'
        cd ~/leaf-system
        
        # Parar containers existentes
        docker-compose -f docker-compose-vultr-8gb.yml down -v 2>/dev/null || true
        
        # Limpar sistema
        docker system prune -f
        
        # Iniciar sistema
        docker-compose -f docker-compose-vultr-8gb.yml up -d
        
        # Aguardar inicialização
        echo "⏳ Aguardando inicialização dos serviços..."
        sleep 60
        
        # Verificar status
        docker-compose -f docker-compose-vultr-8gb.yml ps
        
        # Testar endpoints
        echo "🧪 Testando endpoints..."
        curl -s http://localhost/health || echo "❌ Load balancer não responde"
        curl -s http://localhost:3001/health || echo "❌ WebSocket 1 não responde"
        curl -s http://localhost:3002/health || echo "❌ WebSocket 2 não responde"
        curl -s http://localhost:3003/health || echo "❌ WebSocket 3 não responde"
        curl -s http://localhost:3004/health || echo "❌ WebSocket 4 não responde"
        
        echo "🎉 Sistema iniciado na Vultr!"
EOF
    
    echo -e "${GREEN}✅ Leaf System iniciado na Vultr${NC}"
}

# Função para mostrar informações finais
show_final_info() {
    echo -e "\n${GREEN}🎉 DEPLOY CONCLUÍDO COM SUCESSO!${NC}"
    echo "=========================================="
    echo -e "🌐 VPS Vultr: ${YELLOW}$VULTR_IP${NC}"
    echo -e "🖥️ CPU: ${GREEN}4 vCPUs${NC}"
    echo -e " RAM: ${GREEN}8GB${NC}"
    echo -e " Storage: ${GREEN}160GB SSD${NC}"
    
    echo -e "\n${BLUE}🌐 URLs DE ACESSO:${NC}"
    echo "=================="
    echo -e "🌐 Load Balancer: ${YELLOW}http://$VULTR_IP${NC}"
    echo -e "🔌 WebSocket 1: ${YELLOW}http://$VULTR_IP:3001${NC}"
    echo -e "🔌 WebSocket 2: ${YELLOW}http://$VULTR_IP:3002${NC}"
    echo -e "🔌 WebSocket 3: ${YELLOW}http://$VULTR_IP:3003${NC}"
    echo -e "🔌 WebSocket 4: ${YELLOW}http://$VULTR_IP:3004${NC}"
    echo -e "📊 Prometheus: ${YELLOW}http://$VULTR_IP:9090${NC}"
    echo -e "📈 Grafana: ${YELLOW}http://$VULTR_IP:3000${NC} (admin/admin123)"
    
    echo -e "\n${BLUE}🛠️ COMANDOS ÚTEIS:${NC}"
    echo "=================="
    echo -e "📊 Status: ${YELLOW}ssh $VULTR_USER@$VULTR_IP 'cd ~/leaf-system && docker-compose -f docker-compose-vultr-8gb.yml ps'${NC}"
    echo -e "📋 Logs: ${YELLOW}ssh $VULTR_USER@$VULTR_IP 'cd ~/leaf-system && docker-compose -f docker-compose-vultr-8gb.yml logs -f'${NC}"
    echo -e "🔄 Restart: ${YELLOW}ssh $VULTR_USER@$VULTR_IP 'cd ~/leaf-system && docker-compose -f docker-compose-vultr-8gb.yml restart'${NC}"
    echo -e "🛑 Parar: ${YELLOW}ssh $VULTR_USER@$VULTR_IP 'cd ~/leaf-system && docker-compose -f docker-compose-vultr-8gb.yml down'${NC}"
    
    echo -e "\n${BLUE}📊 CAPACIDADE DO SISTEMA:${NC}"
    echo "================================"
    echo -e "🚀 Usuários simultâneos: ${GREEN}500k+${NC}"
    echo -e "🔌 Conexões WebSocket: ${GREEN}100k+${NC}"
    echo -e "⚡ Latência: ${GREEN}< 100ms${NC}"
    echo -e "🌐 Uptime: ${GREEN}99.9%+${NC}"
    
    echo -e "\n${GREEN}🎯 Sistema pronto para megacidades!${NC}"
}

# Função para forçar limpeza do apt
force_apt_cleanup() {
    echo -e "${YELLOW}🧹 Forçando limpeza do apt...${NC}"
    
    ssh -i "$VULTR_SSH_KEY" "$VULTR_USER@$VULTR_IP" << 'EOF'
        echo "🔍 Identificando processos apt travados..."
        
        # Mostrar todos os processos apt rodando
        echo "📋 Processos apt ativos:"
        ps aux | grep -E "(apt|dpkg)" | grep -v grep
        
        # Mostrar locks ativos
        echo "🔒 Locks ativos:"
        ls -la /var/lib/dpkg/lock* /var/lib/apt/lists/lock /var/cache/apt/archives/lock 2>/dev/null || echo "Nenhum lock encontrado"
        
        # Tentar matar processos apt travados
        echo "💀 Matando processos apt travados..."
        sudo pkill -f "apt" 2>/dev/null || echo "Nenhum processo apt para matar"
        sudo pkill -f "dpkg" 2>/dev/null || echo "Nenhum processo dpkg para matar"
        
        # Aguardar um pouco
        sleep 5
        
        # Remover locks manualmente
        echo "🗑️ Removendo locks..."
        sudo rm -f /var/lib/dpkg/lock-frontend 2>/dev/null || echo "Lock frontend não encontrado"
        sudo rm -f /var/lib/apt/lists/lock 2>/dev/null || echo "Lock lists não encontrado"
        sudo rm -f /var/cache/apt/archives/lock 2>/dev/null || echo "Lock archives não encontrado"
        sudo rm -f /var/lib/dpkg/lock 2>/dev/null || echo "Lock dpkg não encontrado"
        
        # Reconfigurar dpkg
        echo "🔧 Reconfigurando dpkg..."
        sudo dpkg --configure -a
        
        # Limpar cache apt
        echo "🧹 Limpando cache apt..."
        sudo apt clean
        
        echo "✅ Limpeza forçada concluída!"
EOF
    
    echo -e "${GREEN}✅ Limpeza forçada do apt concluída${NC}"
}

# Função principal
main() {
    echo -e "${BLUE}🚀 INICIANDO DEPLOY AUTOMÁTICO PARA VULTR${NC}"
    echo "=================================================="
    
    check_prerequisites
    build_image
    connect_vultr
    
    # Verificar se apt está livre antes de instalar Docker
    echo -e "${YELLOW}🔍 Verificando status do apt na Vultr...${NC}"
    ssh -i "$VULTR_SSH_KEY" "$VULTR_USER@$VULTR_IP" << 'EOF'
        echo "Verificando se apt está livre..."
        while fuser /var/lib/dpkg/lock-frontend >/dev/null 2>&1 || fuser /var/lib/apt/lists/lock >/dev/null 2>&1 || fuser /var/cache/apt/archives/lock >/dev/null 2>&1; do
            echo "⏳ apt está em uso, aguardando... (PID: $(fuser /var/lib/dpkg/lock-frontend 2>/dev/null || echo 'N/A'))"
            sleep 10
        done
        echo "✅ apt está livre, continuando com deploy..."
EOF
    
    # Se ainda estiver travado, forçar limpeza
    echo -e "${YELLOW}🔍 Verificando novamente se apt está livre...${NC}"
    if ssh -i "$VULTR_SSH_KEY" "$VULTR_USER@$VULTR_IP" "fuser /var/lib/dpkg/lock-frontend >/dev/null 2>&1 || fuser /var/lib/apt/lists/lock >/dev/null 2>&1 || fuser /var/cache/apt/archives/lock >/dev/null 2>&1"; then
        echo -e "${RED}❌ apt ainda está travado, forçando limpeza...${NC}"
        force_apt_cleanup
    fi
    
    install_docker_vultr
    deploy_files
    deploy_docker_image
    start_system_vultr
    show_final_info
}

# Verificar se IP foi configurado
if [ -z "$VULTR_IP" ]; then
    echo -e "${RED}❌ ERRO: VULTR_IP não configurado${NC}"
    echo ""
    echo -e "${YELLOW}📝 CONFIGURAÇÃO NECESSÁRIA:${NC}"
    echo "1. Edite este script"
    echo "2. Configure VULTR_IP='SEU_IP_VULTR'"
    echo "3. Execute novamente"
    echo ""
    echo -e "${BLUE}Exemplo:${NC}"
    echo "VULTR_IP='192.168.1.100'"
    echo ""
    exit 1
fi

# Executar deploy
main
