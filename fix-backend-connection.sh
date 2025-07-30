#!/bin/bash

echo "🔧 Corrigindo conectividade do backend..."

# 1. Verificar se o processo está rodando
echo "1. Verificando processo..."
ssh root@216.238.107.59 "ps aux | grep 'node server.js'"

# 2. Reiniciar o backend
echo "2. Reiniciando backend..."
ssh root@216.238.107.59 "pkill -f 'node server.js'"
sleep 2
ssh root@216.238.107.59 "cd /var/www/leaf-websocket-backend && nohup node server.js > server.log 2>&1 &"
sleep 3

# 3. Testar conectividade local
echo "3. Testando conectividade local..."
ssh root@216.238.107.59 "curl -s http://localhost:3001/health"

# 4. Testar via nginx
echo "4. Testando via nginx..."
ssh root@216.238.107.59 "curl -s -k -H 'Host: api.leaf.app.br' https://localhost/health"

# 5. Testar login
echo "5. Testando login..."
ssh root@216.238.107.59 "curl -s -k -H 'Host: api.leaf.app.br' https://localhost/auth/login -X POST -H 'Content-Type: application/json' -d '{\"username\":\"admin\",\"password\":\"password\"}'"

echo "✅ Correção concluída!" 