#!/bin/bash

# 🚀 DEPLOY RÁPIDO - Places Cache para VPS
# Envia apenas os arquivos novos do Places Cache

set -e

# Cores
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

# Configurações VPS
VPS_IP="216.238.107.59"
VPS_USER="root"
VPS_PATH="/root/leaf-websocket-backend"  # Ajustar se necessário

echo -e "${BLUE}🚀 DEPLOY PLACES CACHE PARA VPS${NC}"
echo "=================================="
echo -e "${YELLOW}📍 VPS: ${VPS_IP}${NC}"
echo -e "${YELLOW}📁 Path: ${VPS_PATH}${NC}"
echo ""

# Verificar se arquivos existem
echo -e "${BLUE}🔍 Verificando arquivos...${NC}"
FILES=(
  "leaf-websocket-backend/services/places-cache-service.js"
  "leaf-websocket-backend/routes/places-routes.js"
  "leaf-websocket-backend/utils/places-normalizer.js"
  "leaf-websocket-backend/server.js"
)

for file in "${FILES[@]}"; do
  if [ ! -f "$file" ]; then
    echo -e "${RED}❌ Arquivo não encontrado: $file${NC}"
    exit 1
  fi
done

echo -e "${GREEN}✅ Todos os arquivos encontrados${NC}"
echo ""

# Testar conexão SSH
echo -e "${BLUE}🔌 Testando conexão SSH...${NC}"
if ! ssh -o ConnectTimeout=5 $VPS_USER@$VPS_IP "echo 'SSH OK'" 2>/dev/null; then
  echo -e "${RED}❌ Erro ao conectar na VPS${NC}"
  echo -e "${YELLOW}💡 Verifique:${NC}"
  echo "   - SSH configurado?"
  echo "   - IP correto: $VPS_IP"
  echo "   - Usuário correto: $VPS_USER"
  exit 1
fi

echo -e "${GREEN}✅ Conexão SSH OK${NC}"
echo ""

# Fazer backup do server.js atual
echo -e "${BLUE}💾 Fazendo backup do server.js atual...${NC}"
ssh $VPS_USER@$VPS_IP "cd $VPS_PATH && cp server.js server.js.backup-\$(date +%Y%m%d-%H%M%S) 2>/dev/null || echo 'Sem backup anterior'"
echo -e "${GREEN}✅ Backup criado${NC}"
echo ""

# Criar diretórios se não existirem
echo -e "${BLUE}📁 Criando diretórios...${NC}"
ssh $VPS_USER@$VPS_IP "mkdir -p $VPS_PATH/services $VPS_PATH/routes $VPS_PATH/utils"
echo -e "${GREEN}✅ Diretórios criados${NC}"
echo ""

# Enviar arquivos
echo -e "${BLUE}📤 Enviando arquivos para VPS...${NC}"

echo "   📤 places-cache-service.js"
scp leaf-websocket-backend/services/places-cache-service.js $VPS_USER@$VPS_IP:$VPS_PATH/services/

echo "   📤 places-routes.js"
scp leaf-websocket-backend/routes/places-routes.js $VPS_USER@$VPS_IP:$VPS_PATH/routes/

echo "   📤 places-normalizer.js"
scp leaf-websocket-backend/utils/places-normalizer.js $VPS_USER@$VPS_IP:$VPS_PATH/utils/

echo "   📤 server.js (atualizado)"
scp leaf-websocket-backend/server.js $VPS_USER@$VPS_IP:$VPS_PATH/

echo -e "${GREEN}✅ Arquivos enviados${NC}"
echo ""

# Instalar dependências (se necessário)
echo -e "${BLUE}📦 Verificando dependências...${NC}"
ssh $VPS_USER@$VPS_IP "cd $VPS_PATH && npm list node-fetch 2>/dev/null || npm install node-fetch@^3.3.2"
echo -e "${GREEN}✅ Dependências OK${NC}"
echo ""

# Reiniciar servidor
echo -e "${BLUE}🔄 Reiniciando servidor...${NC}"
echo -e "${YELLOW}⚠️  Escolha como o servidor está rodando:${NC}"
echo "   1) PM2"
echo "   2) systemd"
echo "   3) nohup/node direto"
echo "   4) Docker"
echo ""
read -p "Opção (1-4): " option

case $option in
  1)
    echo -e "${BLUE}🔄 Reiniciando via PM2...${NC}"
    ssh $VPS_USER@$VPS_IP "cd $VPS_PATH && pm2 restart leaf-websocket-backend || pm2 restart all || echo 'PM2 não encontrado'"
    ;;
  2)
    echo -e "${BLUE}🔄 Reiniciando via systemd...${NC}"
    ssh $VPS_USER@$VPS_IP "systemctl restart leaf-backend || systemctl restart leaf-websocket || echo 'systemd não configurado'"
    ;;
  3)
    echo -e "${BLUE}🔄 Parando processo atual...${NC}"
    ssh $VPS_USER@$VPS_IP "pkill -f 'node.*server.js' || true"
    echo -e "${BLUE}🚀 Iniciando servidor...${NC}"
    ssh $VPS_USER@$VPS_IP "cd $VPS_PATH && nohup node server.js > server.log 2>&1 &"
    sleep 5
    ;;
  4)
    echo -e "${BLUE}🔄 Reiniciando via Docker...${NC}"
    ssh $VPS_USER@$VPS_IP "cd $VPS_PATH && docker-compose restart || docker restart leaf-backend || echo 'Docker não encontrado'"
    ;;
  *)
    echo -e "${YELLOW}⚠️  Opção inválida. Servidor NÃO foi reiniciado.${NC}"
    echo -e "${YELLOW}💡 Reinicie manualmente após verificar os arquivos.${NC}"
    ;;
esac

echo ""
echo -e "${BLUE}⏳ Aguardando servidor inicializar...${NC}"
sleep 10

# Testar endpoints
echo -e "${BLUE}🧪 Testando endpoints...${NC}"
echo ""

echo -e "${BLUE}1️⃣ Health Check:${NC}"
HEALTH=$(curl -s http://$VPS_IP:3001/api/places/health 2>&1)
if echo "$HEALTH" | grep -q "healthy\|status"; then
  echo -e "${GREEN}✅ Health Check: OK${NC}"
  echo "$HEALTH" | head -5
else
  echo -e "${RED}❌ Health Check: FALHOU${NC}"
  echo "$HEALTH"
fi
echo ""

echo -e "${BLUE}2️⃣ Metrics:${NC}"
METRICS=$(curl -s http://$VPS_IP:3001/api/places/metrics 2>&1)
if echo "$METRICS" | grep -q "hits\|metrics"; then
  echo -e "${GREEN}✅ Metrics: OK${NC}"
  echo "$METRICS" | head -10
else
  echo -e "${RED}❌ Metrics: FALHOU${NC}"
  echo "$METRICS"
fi
echo ""

# Verificar logs
echo -e "${BLUE}📋 Últimas linhas do log do servidor:${NC}"
ssh $VPS_USER@$VPS_IP "cd $VPS_PATH && tail -20 server.log 2>/dev/null || tail -20 /var/log/leaf-backend.log 2>/dev/null || echo 'Log não encontrado'"
echo ""

echo -e "${GREEN}🎉 DEPLOY CONCLUÍDO!${NC}"
echo "=================================="
echo ""
echo -e "${BLUE}📊 Endpoints disponíveis:${NC}"
echo "   Health: http://$VPS_IP:3001/api/places/health"
echo "   Metrics: http://$VPS_IP:3001/api/places/metrics"
echo "   Search: POST http://$VPS_IP:3001/api/places/search"
echo "   Save: POST http://$VPS_IP:3001/api/places/save"
echo ""
echo -e "${YELLOW}💡 Próximo passo:${NC}"
echo "   Atualizar URL da API no dashboard para: http://$VPS_IP:3001"





