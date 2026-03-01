#!/bin/bash

# 🚀 Script de Migração de IPs para Vultr VPS
# Migra todas as referências de localhost/216.238.107.59 para o IP da Vultr
# MANTÉM as portas originais para preservar o load balancing

set -e

# Cores para output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuração
OLD_IP="127.0.0.1"
OLD_LOCALHOST="localhost:3001"
NEW_IP="216.238.107.59"
PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo -e "${BLUE}🚀 MIGRAÇÃO DE IPs PARA VULTR VPS${NC}"
echo -e "${BLUE}================================${NC}"
echo -e "📍 IP Antigo: ${RED}${OLD_IP}${NC}"
echo -e "📍 IP Novo: ${GREEN}${NEW_IP}${NC}"
echo -e "📍 Projeto: ${YELLOW}${PROJECT_ROOT}${NC}"
echo ""
echo -e "${YELLOW}⚠️  IMPORTANTE: As portas serão mantidas para preservar o load balancing${NC}"
echo -e "${YELLOW}   • Load Balancer: ${NEW_IP}:80 (HTTP) e ${NEW_IP}:443 (HTTPS)${NC}"
echo -e "${YELLOW}   • WebSocket Backends: ${NEW_IP}:3001, ${NEW_IP}:3002, ${NEW_IP}:3003, ${NEW_IP}:3004${NC}"
echo -e "${YELLOW}   • Redis: ${NEW_IP}:6379${NC}"
echo ""

# Função para fazer backup
backup_files() {
    echo -e "${YELLOW}📦 Criando backup dos arquivos...${NC}"
    BACKUP_DIR="${PROJECT_ROOT}/backup_$(date +%Y%m%d_%H%M%S)"
    mkdir -p "${BACKUP_DIR}"
    
    # Copiar arquivos importantes
    cp -r "${PROJECT_ROOT}/tests" "${BACKUP_DIR}/" 2>/dev/null || true
    cp -r "${PROJECT_ROOT}/leaf-dashboard" "${BACKUP_DIR}/" 2>/dev/null || true
    cp -r "${PROJECT_ROOT}/scripts" "${BACKUP_DIR}/" 2>/dev/null || true
    cp -r "${PROJECT_ROOT}/docs" "${BACKUP_DIR}/" 2>/dev/null || true
    cp -r "${PROJECT_ROOT}/documentation" "${BACKUP_DIR}/" 2>/dev/null || true
    
    echo -e "${GREEN}✅ Backup criado em: ${BACKUP_DIR}${NC}"
}

# Função para migrar IPs em arquivos
migrate_ips() {
    echo -e "${YELLOW}🔄 Migrando IPs nos arquivos...${NC}"
    
    # Contador de alterações
    TOTAL_CHANGES=0
    
    # 1. Migrar 127.0.0.1 para 216.238.107.59 (MANTENDO PORTAS)
    echo -e "${BLUE}   📍 Migrando 127.0.0.1 → 216.238.107.59${NC}"
    CHANGES=$(find "${PROJECT_ROOT}" -type f \( -name "*.js" -o -name "*.cjs" -o -name "*.ts" -o -name "*.tsx" -o -name "*.json" -o -name "*.md" -o -name "*.sh" -o -name "*.bat" -o -name "*.ps1" -o -name "*.conf" -o -name "*.env*" \) -exec grep -l "${OLD_IP}" {} \; | wc -l)
    
    if [ "$CHANGES" -gt 0 ]; then
        find "${PROJECT_ROOT}" -type f \( -name "*.js" -o -name "*.cjs" -o -name "*.ts" -o -name "*.tsx" -o -name "*.json" -o -name "*.md" -o -name "*.sh" -o -name "*.bat" -o -name "*.ps1" -o -name "*.conf" -o -name "*.env*" \) -exec sed -i "s/${OLD_IP}/${NEW_IP}/g" {} \;
        echo -e "${GREEN}   ✅ ${CHANGES} arquivos atualizados${NC}"
        TOTAL_CHANGES=$((TOTAL_CHANGES + CHANGES))
    else
        echo -e "${YELLOW}   ℹ️  Nenhum arquivo com 127.0.0.1 encontrado${NC}"
    fi
    
    # 2. Migrar localhost:3001 para 216.238.107.59:3001 (MANTENDO PORTA)
    echo -e "${BLUE}   📍 Migrando localhost:3001 → 216.238.107.59:3001${NC}"
    CHANGES=$(find "${PROJECT_ROOT}" -type f \( -name "*.js" -o -name "*.cjs" -o -name "*.ts" -o -name "*.tsx" -o -name "*.json" -o -name "*.md" -o -name "*.sh" -o -name "*.bat" -o -name "*.ps1" -o -name "*.conf" -o -name "*.env*" \) -exec grep -l "${OLD_LOCALHOST}" {} \; | wc -l)
    
    if [ "$CHANGES" -gt 0 ]; then
        find "${PROJECT_ROOT}" -type f \( -name "*.js" -o -name "*.cjs" -o -name "*.ts" -o -name "*.tsx" -o -name "*.json" -o -name "*.md" -o -name "*.sh" -o -name "*.bat" -o -name "*.ps1" -o -name "*.conf" -o -name "*.env*" \) -exec sed -i "s/${OLD_LOCALHOST}/${NEW_IP}:3001/g" {} \;
        echo -e "${GREEN}   ✅ ${CHANGES} arquivos atualizados${NC}"
        TOTAL_CHANGES=$((TOTAL_CHANGES + CHANGES))
    else
        echo -e "${YELLOW}   ℹ️  Nenhum arquivo com localhost:3001 encontrado${NC}"
    fi
    
    # 3. Migrar http://localhost para http://216.238.107.59 (MANTENDO PORTAS)
    echo -e "${BLUE}   📍 Migrando http://localhost → http://216.238.107.59${NC}"
    CHANGES=$(find "${PROJECT_ROOT}" -type f \( -name "*.js" -o -name "*.cjs" -o -name "*.ts" -o -name "*.tsx" -o -name "*.json" -o -name "*.md" -o -name "*.sh" -o -name "*.bat" -o -name "*.ps1" -o -name "*.conf" -o -name "*.env*" \) -exec grep -l "http://localhost" {} \; | wc -l)
    
    if [ "$CHANGES" -gt 0 ]; then
        find "${PROJECT_ROOT}" -type f \( -name "*.js" -o -name "*.cjs" -o -name "*.ts" -o -name "*.tsx" -o -name "*.json" -o -name "*.md" -o -name "*.sh" -o -name "*.bat" -o -name "*.ps1" -o -name "*.conf" -o -name "*.env*" \) -exec sed -i "s|http://localhost|http://${NEW_IP}|g" {} \;
        echo -e "${GREEN}   ✅ ${CHANGES} arquivos atualizados${NC}"
        TOTAL_CHANGES=$((TOTAL_CHANGES + CHANGES))
    else
        echo -e "${YELLOW}   ℹ️  Nenhum arquivo com http://localhost encontrado${NC}"
    fi
    
    # 4. Migrar ws://localhost para ws://216.238.107.59 (MANTENDO PORTAS)
    echo -e "${BLUE}   📍 Migrando ws://localhost → ws://216.238.107.59${NC}"
    CHANGES=$(find "${PROJECT_ROOT}" -type f \( -name "*.js" -o -name "*.cjs" -o -name "*.ts" -o -name "*.tsx" -o -name "*.json" -o -name "*.md" -o -name "*.sh" -o -name "*.bat" -o -name "*.ps1" -o -name "*.conf" -o -name "*.env*" \) -exec grep -l "ws://localhost" {} \; | wc -l)
    
    if [ "$CHANGES" -gt 0 ]; then
        find "${PROJECT_ROOT}" -type f \( -name "*.js" -o -name "*.cjs" -o -name "*.ts" -o -name "*.tsx" -o -name "*.json" -o -name "*.md" -o -name "*.sh" -o -name "*.bat" -o -name "*.ps1" -o -name "*.conf" -o -name "*.env*" \) -exec sed -i "s|ws://localhost|ws://${NEW_IP}|g" {} \;
        echo -e "${GREEN}   ✅ ${CHANGES} arquivos atualizados${NC}"
        TOTAL_CHANGES=$((TOTAL_CHANGES + CHANGES))
    else
        echo -e "${YELLOW}   ℹ️  Nenhum arquivo com ws://localhost encontrado${NC}"
    fi
    
    # 5. Migrar localhost:3000 para 216.238.107.59:3000 (Dashboard)
    echo -e "${BLUE}   📍 Migrando localhost:3000 → 216.238.107.59:3000${NC}"
    CHANGES=$(find "${PROJECT_ROOT}" -type f \( -name "*.js" -o -name "*.cjs" -o -name "*.ts" -o -name "*.tsx" -o -name "*.json" -o -name "*.md" -o -name "*.sh" -o -name "*.bat" -o -name "*.ps1" -o -name "*.conf" -o -name "*.env*" \) -exec grep -l "localhost:3000" {} \; | wc -l)
    
    if [ "$CHANGES" -gt 0 ]; then
        find "${PROJECT_ROOT}" -type f \( -name "*.js" -o -name "*.cjs" -o -name "*.ts" -o -name "*.tsx" -o -name "*.json" -o -name "*.md" -o -name "*.sh" -o -name "*.bat" -o -name "*.ps1" -o -name "*.conf" -o -name "*.env*" \) -exec sed -i "s/localhost:3000/${NEW_IP}:3000/g" {} \;
        echo -e "${GREEN}   ✅ ${CHANGES} arquivos atualizados${NC}"
        TOTAL_CHANGES=$((TOTAL_CHANGES + CHANGES))
    else
        echo -e "${YELLOW}   ℹ️  Nenhum arquivo com localhost:3000 encontrado${NC}"
    fi
    
    echo -e "${GREEN}✅ Total de alterações: ${TOTAL_CHANGES}${NC}"
}

# Função para verificar se a Vultr está acessível
test_vultr_connection() {
    echo -e "${YELLOW}🔍 Testando conexão com Vultr VPS...${NC}"
    
    if ping -c 1 "${NEW_IP}" >/dev/null 2>&1; then
        echo -e "${GREEN}✅ Vultr VPS está acessível${NC}"
        
        # Testar se o WebSocket está rodando
        if curl -s "http://${NEW_IP}:3001/health" >/dev/null 2>&1; then
            echo -e "${GREEN}✅ WebSocket backend está rodando na Vultr${NC}"
        else
            echo -e "${RED}❌ WebSocket backend não está rodando na Vultr${NC}"
        fi
        
        # Testar se o load balancer está funcionando
        if curl -s "http://${NEW_IP}/health" >/dev/null 2>&1; then
            echo -e "${GREEN}✅ Load balancer está funcionando na Vultr${NC}"
        else
            echo -e "${YELLOW}⚠️  Load balancer não está respondendo (pode estar configurado para porta específica)${NC}"
        fi
    else
        echo -e "${RED}❌ Vultr VPS não está acessível${NC}"
        echo -e "${YELLOW}⚠️  Verifique se o IP está correto e se a VPS está rodando${NC}"
    fi
}

# Função para mostrar resumo das alterações
show_summary() {
    echo ""
    echo -e "${BLUE}📊 RESUMO DA MIGRAÇÃO${NC}"
    echo -e "${BLUE}==================${NC}"
    echo -e "📍 IP Antigo: ${RED}${OLD_IP}${NC}"
    echo -e "📍 IP Novo: ${GREEN}${NEW_IP}${NC}"
    echo -e "📍 Backup: ${YELLOW}${BACKUP_DIR}${NC}"
    echo ""
    echo -e "${GREEN}✅ Migração concluída com sucesso!${NC}"
    echo ""
    echo -e "${BLUE}🌐 ARQUITETURA FINAL NA VULTR:${NC}"
    echo -e "   • Load Balancer: ${GREEN}http://${NEW_IP}${NC} (porta 80)"
    echo -e "   • WebSocket 1: ${GREEN}http://${NEW_IP}:3001${NC}"
    echo -e "   • WebSocket 2: ${GREEN}http://${NEW_IP}:3002${NC}"
    echo -e "   • WebSocket 3: ${GREEN}http://${NEW_IP}:3003${NC}"
    echo -e "   • WebSocket 4: ${GREEN}http://${NEW_IP}:3004${NC}"
    echo -e "   • Dashboard: ${GREEN}http://${NEW_IP}:3000${NC}"
    echo -e "   • Redis: ${GREEN}${NEW_IP}:6379${NC}"
    echo ""
    echo -e "${YELLOW}📝 PRÓXIMOS PASSOS:${NC}"
    echo -e "   1. Testar as integrações com o novo IP"
    echo -e "   2. Verificar se todos os serviços estão funcionando"
    echo -e "   3. Executar testes de carga na Vultr"
    echo -e "   4. Configurar SSL/HTTPS se necessário"
}

# Função principal
main() {
    echo -e "${YELLOW}⚠️  ATENÇÃO: Este script irá alterar TODOS os arquivos do projeto${NC}"
    echo -e "${YELLOW}⚠️  Certifique-se de que você tem um backup ou está em um branch de desenvolvimento${NC}"
    echo ""
    
    read -p "🤔 Continuar com a migração? (y/N): " -n 1 -r
    echo ""
    
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        echo -e "${RED}❌ Migração cancelada${NC}"
        exit 1
    fi
    
    # Executar migração
    backup_files
    migrate_ips
    test_vultr_connection
    show_summary
}

# Executar script
main "$@"
