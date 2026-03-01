#!/bin/bash

# DEPLOY ULTRA-RÁPIDO PARA VULTR - 10 MINUTOS
set -e

VULTR_IP="216.238.107.59"
VULTR_USER="root"
VULTR_SSH_KEY="~/.ssh/id_rsa"

echo "🚀 DEPLOY ULTRA-RÁPIDO - 10 MINUTOS"
echo "====================================="

# 1. Conectar e instalar Docker rapidamente
echo "🐳 Instalando Docker..."
ssh -i "$VULTR_SSH_KEY" "$VULTR_USER@$VULTR_IP" << 'EOF'
    # Instalar Docker em 1 comando
    curl -fsSL https://get.docker.com -o get-docker.sh && sh get-docker.sh
    
    # Configurar usuário
    sudo usermod -aG docker $USER
    
    # Iniciar e habilitar Docker
    sudo systemctl start docker
    sudo systemctl enable docker
    
    # Aguardar Docker inicializar
    sleep 5
    
    # Verificar se Docker está rodando
    if ! sudo systemctl is-active --quiet docker; then
        echo "❌ Docker não está rodando, tentando iniciar..."
        sudo systemctl start docker
        sleep 3
    fi
    
    # Instalar Docker Compose
    sudo curl -L "https://github.com/docker/compose/releases/download/v2.20.0/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
    sudo chmod +x /usr/local/bin/docker-compose
    
    # Testar Docker
    sudo docker --version
    sudo docker-compose --version
    
    echo "✅ Docker instalado e rodando!"
EOF

# 2. Copiar apenas arquivos essenciais
echo "📁 Copiando arquivos essenciais..."
ssh -i "$VULTR_SSH_KEY" "$VULTR_USER@$VULTR_IP" "mkdir -p ~/leaf-system"

# Copiar apenas o necessário
scp -i "$VULTR_SSH_KEY" docker-compose-vultr-8gb.yml "$VULTR_USER@$VULTR_IP:~/leaf-system/"
scp -i "$VULTR_SSH_KEY" nginx-vultr.conf "$VULTR_USER@$VULTR_IP:~/leaf-system/"
scp -i "$VULTR_SSH_KEY" Dockerfile "$VULTR_USER@$VULTR_IP:~/leaf-system/"
scp -i "$VULTR_SSH_KEY" package.json "$VULTR_USER@$VULTR_IP:~/leaf-system/"

# 3. Build e deploy direto na Vultr
echo "🔨 Build e deploy direto..."
ssh -i "$VULTR_SSH_KEY" "$VULTR_USER@$VULTR_IP" << 'EOF'
    cd ~/leaf-system
    
    # Verificar se Docker está rodando
    if ! sudo systemctl is-active --quiet docker; then
        echo "❌ Docker não está rodando, iniciando..."
        sudo systemctl start docker
        sleep 5
    fi
    
    # Build da imagem
    echo "🔨 Fazendo build da imagem..."
    sudo docker build -t leaf-backend .
    
    # Iniciar sistema
    echo "🚀 Iniciando sistema..."
    sudo docker-compose -f docker-compose-vultr-8gb.yml up -d
    
    echo "🎉 Sistema iniciado!"
    
    # Status
    sudo docker-compose -f docker-compose-vultr-8gb.yml ps
EOF

echo "✅ DEPLOY CONCLUÍDO EM 10 MINUTOS!"
echo "🌐 Acesse: http://$VULTR_IP"
