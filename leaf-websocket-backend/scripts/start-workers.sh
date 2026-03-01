#!/bin/bash
# Script para iniciar workers

echo "🚀 Iniciando workers..."

# Verificar se PM2 está instalado
if ! command -v pm2 &> /dev/null; then
    echo "❌ PM2 não está instalado. Instale com: npm install -g pm2"
    exit 1
fi

# Navegar para o diretório do projeto
cd "$(dirname "$0")/.."

# Iniciar workers usando PM2
pm2 start workers/pm2.config.js

# Salvar configuração PM2
pm2 save

echo "✅ Workers iniciados!"
echo ""
echo "Comandos úteis:"
echo "  pm2 list              - Listar workers"
echo "  pm2 logs              - Ver logs"
echo "  pm2 stop all           - Parar todos"
echo "  pm2 restart all        - Reiniciar todos"
echo "  pm2 monit              - Monitorar em tempo real"

