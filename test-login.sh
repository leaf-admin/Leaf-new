#!/bin/bash

echo "🔐 Testando login do dashboard..."

# Testar login local
echo "📡 Testando login local..."
curl -s -X POST http://localhost:3001/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"password"}' \
  | jq .

echo ""
echo "🌐 Testando login via HTTPS..."
curl -s -X POST https://api.leaf.app.br/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"password"}' \
  | jq . 