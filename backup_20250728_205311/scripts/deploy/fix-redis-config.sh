#!/bin/bash

echo "🔧 CORRIGINDO CONFIGURAÇÃO DO REDIS"
echo "===================================="

# Conectar à VPS e corrigir configuração
ssh root@147.93.66.253 << 'EOF'
echo "🔧 Corrigindo configuração do Redis..."

# Parar PM2
pm2 stop leaf-api

# Corrigir configuração do Redis no server.js
cd /opt/leaf-app
sed -i 's/password: process.env.REDIS_PASSWORD || '\''leaf_redis_2024'\'',/password: null,/' server.js

# Verificar se a correção foi aplicada
echo "✅ Configuração corrigida:"
grep -n "password:" server.js

# Reiniciar PM2
pm2 start leaf-api

# Verificar status
echo "📊 Status do PM2:"
pm2 status

# Testar Redis
echo "🔴 Testando Redis:"
redis-cli ping

echo "✅ Correção concluída!"
EOF

echo "🎯 Correção aplicada com sucesso!"
echo "🧪 Execute novamente: node test-self-hosted-api.cjs" 