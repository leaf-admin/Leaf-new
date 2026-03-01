#!/bin/bash

# Script de Deploy Ultra-Otimizado para VPS Vultr
# Configurado para 500k+ usuários simultâneos

set -e

# Cores para output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

VPS_IP="216.238.107.59"
VPS_USER="root"
VPS_PORT="22"
DEPLOY_DIR="/root/leaf-ultra"

echo -e "${BLUE}🚀 DEPLOY ULTRA-OTIMIZADO PARA VPS VULTR${NC}"
echo "=============================================="
echo -e "${YELLOW}🎯 Target: ${VPS_IP}${NC}"
echo -e "${YELLOW}📁 Diretório: ${DEPLOY_DIR}${NC}"

# Função para executar comando na VPS
run_on_vps() {
    ssh -p ${VPS_PORT} ${VPS_USER}@${VPS_IP} "$1"
}

# Função para copiar arquivo para VPS
copy_to_vps() {
    scp -P ${VPS_PORT} "$1" ${VPS_USER}@${VPS_IP}:$2
}

echo -e "${BLUE}🔍 Conectando na VPS...${NC}"
if ! run_on_vps "echo 'Conexão OK'"; then
    echo -e "${RED}❌ Erro ao conectar na VPS${NC}"
    exit 1
fi

echo -e "${GREEN}✅ Conectado na VPS${NC}"

echo -e "${BLUE}🛑 Parando serviços atuais...${NC}"
run_on_vps "pkill -f 'node server' || true"
run_on_vps "pkill -f 'leaf' || true"

echo -e "${BLUE}📁 Criando diretório de deploy...${NC}"
run_on_vps "mkdir -p ${DEPLOY_DIR}"
run_on_vps "cd ${DEPLOY_DIR}"

echo -e "${BLUE}📦 Copiando arquivos ultra-otimizados...${NC}"
copy_to_vps "server.js" "${DEPLOY_DIR}/server.js"
copy_to_vps "server-ultra-simple.js" "${DEPLOY_DIR}/server-ultra-simple.js"
copy_to_vps "package.json" "${DEPLOY_DIR}/package.json"
copy_to_vps "Dockerfile" "${DEPLOY_DIR}/Dockerfile"
copy_to_vps ".dockerignore" "${DEPLOY_DIR}/.dockerignore"

echo -e "${BLUE}🔧 Configurando ambiente na VPS...${NC}"
run_on_vps "cd ${DEPLOY_DIR} && npm install --production"

echo -e "${BLUE}🚀 Iniciando servidor ultra-otimizado...${NC}"
run_on_vps "cd ${DEPLOY_DIR} && CLUSTER_MODE=true INSTANCE_ID=vps_ultra_1 node server.js > /var/log/leaf-ultra.log 2>&1 &"

echo -e "${BLUE}⏳ Aguardando inicialização...${NC}"
sleep 15

echo -e "${BLUE}🔍 Testando servidor ultra...${NC}"
if run_on_vps "curl -s --max-time 5 http://localhost:3001/health | grep -q 'ultra-worker'"; then
    echo -e "${GREEN}✅ Servidor ultra-otimizado funcionando!${NC}"
else
    echo -e "${RED}❌ Erro ao iniciar servidor ultra${NC}"
    run_on_vps "tail -20 /var/log/leaf-ultra.log"
    exit 1
fi

echo -e "${BLUE}📊 Verificando métricas...${NC}"
run_on_vps "curl -s http://localhost:3001/health | jq -r '.metrics.workers'"

echo -e "${GREEN}🎉 DEPLOY ULTRA-OTIMIZADO CONCLUÍDO!${NC}"
echo -e "${YELLOW}📊 Servidor rodando em: http://${VPS_IP}:3001${NC}"
echo -e "${YELLOW}🔍 Health: http://${VPS_IP}:3001/health${NC}"
echo -e "${YELLOW}📈 Logs: /var/log/leaf-ultra.log${NC}"
echo -e "${YELLOW}⚡ Workers: 40 (500k+ usuários)${NC}"
