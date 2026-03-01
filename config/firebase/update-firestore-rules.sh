#!/bin/bash

# Script para atualizar as regras do Firestore no Firebase
# Permite que usuários normais acessem dados necessários

set -e

# Cores
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo -e "${BLUE}🔧 Atualizando regras do Firestore${NC}"
echo ""

# Verificar se está no diretório correto
if [ ! -f "firestore.rules" ]; then
    echo -e "${RED}❌ Arquivo firestore.rules não encontrado${NC}"
    echo -e "${YELLOW}📍 Execute este script dentro de: config/firebase/${NC}"
    exit 1
fi

# Verificar se Firebase CLI está instalado
if ! command -v firebase &> /dev/null; then
    echo -e "${RED}❌ Firebase CLI não está instalado${NC}"
    echo -e "${YELLOW}📋 Instale com: npm install -g firebase-tools${NC}"
    exit 1
fi

echo -e "${GREEN}✅ Firebase CLI encontrado${NC}"
echo ""

# Verificar se está logado no Firebase
echo -e "${YELLOW}🔐 Verificando autenticação no Firebase...${NC}"
if ! firebase projects:list &> /dev/null; then
    echo -e "${RED}❌ Não está logado no Firebase${NC}"
    echo -e "${YELLOW}📋 Faça login com: firebase login${NC}"
    exit 1
fi

echo -e "${GREEN}✅ Autenticado no Firebase${NC}"
echo ""

# Aplicar as regras do Firestore
echo -e "${YELLOW}📤 Aplicando regras do Firestore...${NC}"
firebase deploy --only firestore:rules

echo ""
echo -e "${GREEN}✅ Regras do Firestore atualizadas com sucesso!${NC}"
echo ""

echo -e "${BLUE}🔄 Alterações aplicadas:${NC}"
echo -e "   ✅ ${GREEN}trip_data:${NC} Usuários normais podem salvar dados de viagem"
echo -e "   ✅ ${GREEN}vehicles:${NC} Usuários normais podem gerenciar veículos"
echo ""

echo -e "${BLUE}🎯 Resultado:${NC}"
echo -e "   • Usuários normais agora podem usar o app sem erros de permissão"
echo -e "   • Dados são salvos tanto no Realtime Database quanto no Firestore"
echo -e "   • Compatibilidade mantida com funcionalidades existentes"
echo ""

echo -e "${GREEN}🚀 Regras atualizadas! Usuários normais podem usar o app normalmente.${NC}"


















