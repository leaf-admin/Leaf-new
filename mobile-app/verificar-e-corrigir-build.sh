#!/bin/bash

# Script para verificar e corrigir tudo antes de gerar builds

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${BLUE}════════════════════════════════════════${NC}"
echo -e "${BLUE}   VERIFICAÇÃO E CORREÇÃO PARA BUILD${NC}"
echo -e "${BLUE}════════════════════════════════════════${NC}"
echo ""

# 1. Verificar se está no diretório correto
if [ ! -f "package.json" ]; then
    echo -e "${RED}❌ Erro: Execute este script dentro de mobile-app/${NC}"
    exit 1
fi

echo -e "${GREEN}✅ 1. Verificando estrutura do projeto...${NC}"

# 2. Verificar node_modules
if [ ! -d "node_modules" ]; then
    echo -e "${YELLOW}⚠️  node_modules não existe. Instalando...${NC}"
    npm install --legacy-peer-deps
else
    echo -e "${GREEN}   ✅ node_modules existe${NC}"
fi

# 3. Verificar arquivos de configuração
echo ""
echo -e "${GREEN}✅ 2. Verificando arquivos de configuração...${NC}"

if [ ! -f "google-services.json" ]; then
    echo -e "${RED}   ❌ google-services.json não existe${NC}"
    echo -e "${YELLOW}   ⚠️  Necessário para build Android${NC}"
else
    echo -e "${GREEN}   ✅ google-services.json existe${NC}"
fi

if [ ! -f "GoogleService-Info.plist" ]; then
    echo -e "${RED}   ❌ GoogleService-Info.plist não existe${NC}"
    echo -e "${YELLOW}   ⚠️  Necessário para build iOS${NC}"
else
    echo -e "${GREEN}   ✅ GoogleService-Info.plist existe${NC}"
fi

if [ ! -f "app.config.js" ]; then
    echo -e "${RED}   ❌ app.config.js não existe${NC}"
    exit 1
else
    echo -e "${GREEN}   ✅ app.config.js existe${NC}"
fi

if [ ! -f "eas.json" ]; then
    echo -e "${RED}   ❌ eas.json não existe${NC}"
    exit 1
else
    echo -e "${GREEN}   ✅ eas.json existe${NC}"
fi

# 4. Verificar se expo está instalado
echo ""
echo -e "${GREEN}✅ 3. Verificando dependências...${NC}"

if ! npm list expo &>/dev/null; then
    echo -e "${YELLOW}   ⚠️  expo não encontrado. Instalando...${NC}"
    npm install expo --legacy-peer-deps
else
    echo -e "${GREEN}   ✅ expo instalado${NC}"
fi

# 5. Verificar EAS CLI
echo ""
echo -e "${GREEN}✅ 4. Verificando EAS CLI...${NC}"

if ! command -v eas &> /dev/null && ! npx eas --version &> /dev/null; then
    echo -e "${YELLOW}   ⚠️  EAS CLI não encontrado${NC}"
    echo -e "${YELLOW}   💡 Será usado via npx${NC}"
else
    echo -e "${GREEN}   ✅ EAS CLI disponível${NC}"
fi

# 6. Verificar autenticação EAS
echo ""
echo -e "${GREEN}✅ 5. Verificando autenticação EAS...${NC}"

EAS_USER=$(npx eas whoami 2>&1 | grep -E "Logged in as|Not logged in" || echo "Erro ao verificar")
if echo "$EAS_USER" | grep -q "Not logged in"; then
    echo -e "${YELLOW}   ⚠️  Não autenticado no EAS${NC}"
    echo -e "${YELLOW}   💡 Execute: npx eas login${NC}"
else
    echo -e "${GREEN}   ✅ Autenticado no EAS${NC}"
    echo "   $EAS_USER"
fi

# 7. Verificar configuração do app.config.js
echo ""
echo -e "${GREEN}✅ 6. Verificando app.config.js...${NC}"

# Tentar executar app.config.js para ver se tem erros
if node -e "require('./app.config.js')" 2>&1 | grep -q "Error"; then
    echo -e "${RED}   ❌ Erro ao carregar app.config.js${NC}"
    node -e "require('./app.config.js')" 2>&1
else
    echo -e "${GREEN}   ✅ app.config.js válido${NC}"
fi

# 8. Resumo
echo ""
echo -e "${BLUE}════════════════════════════════════════${NC}"
echo -e "${BLUE}   RESUMO${NC}"
echo -e "${BLUE}════════════════════════════════════════${NC}"
echo ""
echo "Pronto para gerar builds? Verifique os itens acima."
echo ""
echo "Para gerar builds:"
echo "  npx eas build --platform android --profile preview"
echo "  npx eas build --platform ios --profile preview"
echo ""

