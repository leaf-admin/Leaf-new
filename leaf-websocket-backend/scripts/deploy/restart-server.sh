#!/bin/bash

# Script para reiniciar o servidor Leaf na VPS

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
DEPLOY_DIR="/home/leaf/leaf-websocket-backend"
LEAF_USER="leaf"

echo -e "${BLUE}🔄 REINICIANDO SERVIDOR LEAF${NC}"
echo "=============================================="
echo -e "${YELLOW}🎯 Target: ${VPS_IP}${NC}"

# Função para executar comando na VPS
run_on_vps() {
    ssh -p ${VPS_PORT} ${VPS_USER}@${VPS_IP} "$1"
}

echo -e "${BLUE}🔍 Conectando na VPS...${NC}"
if ! run_on_vps "echo 'Conexão OK'"; then
    echo -e "${RED}❌ Erro ao conectar na VPS${NC}"
    exit 1
fi

echo -e "${GREEN}✅ Conectado na VPS${NC}"

echo -e "${BLUE}🛑 Parando servidor...${NC}"

# Verificar processos Node rodando
echo -e "${YELLOW}🔍 Verificando processos Node...${NC}"
NODE_PROCESSES=$(run_on_vps "ps aux | grep -E 'node.*server\.js|node.*leaf' | grep -v grep | awk '{print \$2}'" || echo "")

if [ -n "$NODE_PROCESSES" ]; then
    echo -e "${YELLOW}📦 Encontrados processos Node, parando...${NC}"
    # Parar como root (pode matar processos do usuário leaf)
    run_on_vps "pkill -f 'node.*server\.js' || pkill -f 'node.*leaf' || true"
    sleep 3
    echo -e "${GREEN}✅ Processos parados${NC}"
else
    echo -e "${YELLOW}⚠️ Nenhum processo Node encontrado${NC}"
fi

echo -e "${BLUE}🚀 Iniciando servidor...${NC}"

# Iniciar servidor como usuário leaf no diretório correto
if run_on_vps "test -d ${DEPLOY_DIR}"; then
    echo -e "${GREEN}📁 Diretório encontrado: ${DEPLOY_DIR}${NC}"
    # Executar como usuário leaf usando su ou sudo
    run_on_vps "su - ${LEAF_USER} -c 'cd ${DEPLOY_DIR} && nohup node server.js > /var/log/leaf-server.log 2>&1 &' || sudo -u ${LEAF_USER} bash -c 'cd ${DEPLOY_DIR} && nohup node server.js > /var/log/leaf-server.log 2>&1 &'"
    echo -e "${GREEN}✅ Servidor iniciado em ${DEPLOY_DIR} como usuário ${LEAF_USER}${NC}"
else
    echo -e "${RED}❌ Diretório ${DEPLOY_DIR} não encontrado${NC}"
    exit 1
fi

echo -e "${BLUE}⏳ Aguardando inicialização...${NC}"
sleep 5

echo -e "${BLUE}🔍 Verificando saúde do servidor...${NC}"
if run_on_vps "curl -s --max-time 5 http://localhost:3001/health > /dev/null"; then
    echo -e "${GREEN}✅ Servidor reiniciado com sucesso!${NC}"
    echo -e "${YELLOW}📊 Health: http://${VPS_IP}:3001/health${NC}"
else
    echo -e "${YELLOW}⚠️ Servidor pode estar ainda inicializando...${NC}"
    echo -e "${YELLOW}📋 Verifique os logs: ssh ${VPS_USER}@${VPS_IP} 'tail -50 /var/log/leaf-server.log'${NC}"
fi

echo -e "${GREEN}🎉 REINÍCIO CONCLUÍDO!${NC}"

