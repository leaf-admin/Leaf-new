#!/bin/bash

# Script para instalar e iniciar o Leaf Dashboard
echo "🚀 Iniciando Leaf Dashboard..."

# Verificar se Node.js está instalado
if ! command -v node &> /dev/null; then
    echo "❌ Node.js não encontrado. Instalando..."
    curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
    sudo apt-get install -y nodejs
fi

# Verificar se npm está instalado
if ! command -v npm &> /dev/null; then
    echo "❌ npm não encontrado. Instalando..."
    sudo apt-get install -y npm
fi

# Instalar dependências
echo "📦 Instalando dependências..."
npm install

# Verificar se a instalação foi bem-sucedida
if [ $? -eq 0 ]; then
    echo "✅ Dependências instaladas com sucesso!"
else
    echo "❌ Erro ao instalar dependências"
    exit 1
fi

# Iniciar o dashboard em modo de desenvolvimento
echo "🌐 Iniciando dashboard em modo de desenvolvimento..."
echo "📍 URL: http://localhost:3002"
echo "🔄 Para parar: Ctrl+C"
echo ""

npm run dev 