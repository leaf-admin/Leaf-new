#!/bin/bash

echo "🔍 Testando backend..."

echo "1. Testando health check local..."
ssh root@216.238.107.59 "curl -s http://localhost:3001/health"

echo ""
echo "2. Testando login local..."
ssh root@216.238.107.59 "curl -s -X POST http://localhost:3001/auth/login -H 'Content-Type: application/json' -d '{\"username\":\"admin\",\"password\":\"password\"}'"

echo ""
echo "3. Testando via HTTPS..."
curl -s -X POST https://api.leaf.app.br/auth/login -H "Content-Type: application/json" -d '{"username":"admin","password":"password"}'

echo ""
echo "4. Verificando logs..."
ssh root@216.238.107.59 "tail -5 /var/www/leaf-websocket-backend/server.log" 