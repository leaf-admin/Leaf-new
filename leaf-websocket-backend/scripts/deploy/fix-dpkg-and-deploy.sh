#!/bin/bash

# SCRIPT PARA CORRIGIR DPKG E FAZER DEPLOY
set -e

VULTR_IP="216.238.107.59"
VULTR_USER="root"
VULTR_SSH_KEY="~/.ssh/id_rsa"

echo "🔧 CORRIGINDO DPKG E FAZENDO DEPLOY"
echo "===================================="

# 1. Conectar e corrigir dpkg primeiro
echo "🔧 Corrigindo dpkg..."
ssh -i "$VULTR_SSH_KEY" "$VULTR_USER@$VULTR_IP" << 'EOF'
    echo "🧹 Limpando sistema de pacotes..."
    
    # Matar processos apt travados
    sudo pkill -f "apt" 2>/dev/null || echo "Nenhum processo apt para matar"
    sudo pkill -f "dpkg" 2>/dev/null || echo "Nenhum processo dpkg para matar"
    
    # Aguardar
    sleep 3
    
    # Remover locks
    sudo rm -f /var/lib/dpkg/lock-frontend 2>/dev/null || echo "Lock frontend não encontrado"
    sudo rm -f /var/lib/apt/lists/lock 2>/dev/null || echo "Lock lists não encontrado"
    sudo rm -f /var/cache/apt/archives/lock 2>/dev/null || echo "Lock archives não encontrado"
    sudo rm -f /var/lib/dpkg/lock 2>/dev/null || echo "Lock dpkg não encontrado"
    
    # Reconfigurar dpkg
    echo "🔧 Reconfigurando dpkg..."
    sudo dpkg --configure -a
    
    # Limpar cache
    sudo apt clean
    
    echo "✅ Dpkg corrigido!"
EOF

# 2. Agora instalar Docker corretamente
echo "🐳 Instalando Docker..."
ssh -i "$VULTR_SSH_KEY" "$VULTR_USER@$VULTR_IP" << 'EOF'
    echo "🔧 Instalando dependências..."
    
    # Instalar dependências necessárias
    export DEBIAN_FRONTEND=noninteractive
    sudo apt-get update
    sudo apt-get install -y ca-certificates curl gnupg lsb-release
    
    echo "🐳 Adicionando repositório Docker..."
    
    # Adicionar chave GPG do Docker
    sudo mkdir -p /etc/apt/keyrings
    curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
    
    # Adicionar repositório
    echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu $(lsb_release -cs) stable" | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
    
    echo "🐳 Instalando Docker..."
    
    # Atualizar e instalar Docker
    sudo apt-get update
    sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
    
    echo "🔧 Configurando Docker..."
    
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
    
    # Testar Docker
    echo "🧪 Testando Docker..."
    sudo docker --version
    sudo docker run hello-world
    
    echo "✅ Docker instalado e funcionando!"
EOF

# 3. Copiar arquivos essenciais
echo "📁 Copiando arquivos essenciais..."
ssh -i "$VULTR_SSH_KEY" "$VULTR_USER@$VULTR_IP" "mkdir -p ~/leaf-system"

# Copiar apenas o necessário
scp -i "$VULTR_SSH_KEY" docker-compose-vultr-8gb.yml "$VULTR_USER@$VULTR_IP:~/leaf-system/"
scp -i "$VULTR_SSH_KEY" nginx-vultr.conf "$VULTR_USER@$VULTR_IP:~/leaf-system/"
scp -i "$VULTR_SSH_KEY" Dockerfile "$VULTR_USER@$VULTR_IP:~/leaf-system/"
scp -i "$VULTR_SSH_KEY" package.json "$VULTR_USER@$VULTR_IP:~/leaf-system/"

# 4. Build e deploy
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

echo "✅ DEPLOY CONCLUÍDO!"
echo "🌐 Acesse: http://$VULTR_IP"
