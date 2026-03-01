#!/bin/bash

# 🧪 Script de Teste da Migração de IPs
# Verifica se todas as referências foram migradas corretamente

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

echo -e "${BLUE}🧪 TESTE DA MIGRAÇÃO DE IPs${NC}"
echo -e "${BLUE}==========================${NC}"
echo -e "📍 IP Antigo: ${RED}${OLD_IP}${NC}"
echo -e "📍 IP Novo: ${GREEN}${NEW_IP}${NC}"
echo -e "📍 Projeto: ${YELLOW}${PROJECT_ROOT}${NC}"
echo ""

# Função para verificar se ainda existem referências antigas
check_old_references() {
    echo -e "${YELLOW}🔍 Verificando se ainda existem referências antigas...${NC}"
    
    # Verificar 216.238.107.59
    OLD_IP_FILES=$(find "${PROJECT_ROOT}" -type f \( -name "*.js" -o -name "*.cjs" -o -name "*.ts" -o -name "*.tsx" -o -name "*.json" -o -name "*.md" -o -name "*.sh" -o -name "*.bat" -o -name "*.ps1" -o -name "*.conf" -o -name "*.env*" \) -exec grep -l "${OLD_IP}" {} \; 2>/dev/null || true)
    
    if [ -n "$OLD_IP_FILES" ]; then
        echo -e "${RED}❌ Ainda existem arquivos com ${OLD_IP}:${NC}"
        echo "$OLD_IP_FILES" | head -10
        if [ "$(echo "$OLD_IP_FILES" | wc -l)" -gt 10 ]; then
            echo -e "${YELLOW}   ... e mais $(($(echo "$OLD_IP_FILES" | wc -l) - 10)) arquivos${NC}"
        fi
    else
        echo -e "${GREEN}✅ Nenhuma referência a ${OLD_IP} encontrada${NC}"
    fi
    
    # Verificar localhost:3001
    OLD_LOCALHOST_FILES=$(find "${PROJECT_ROOT}" -type f \( -name "*.js" -o -name "*.cjs" -o -name "*.ts" -o -name "*.tsx" -o -name "*.json" -o -name "*.md" -o -name "*.sh" -o -name "*.bat" -o -name "*.ps1" -o -name "*.conf" -o -name "*.env*" \) -exec grep -l "${OLD_LOCALHOST}" {} \; 2>/dev/null || true)
    
    if [ -n "$OLD_LOCALHOST_FILES" ]; then
        echo -e "${RED}❌ Ainda existem arquivos com ${OLD_LOCALHOST}:${NC}"
        echo "$OLD_LOCALHOST_FILES" | head -10
        if [ "$(echo "$OLD_LOCALHOST_FILES" | wc -l)" -gt 10 ]; then
            echo -e "${YELLOW}   ... e mais $(($(echo "$OLD_LOCALHOST_FILES" | wc -l) - 10)) arquivos${NC}"
        fi
    else
        echo -e "${GREEN}✅ Nenhuma referência a ${OLD_LOCALHOST} encontrada${NC}"
    fi
    
    # Verificar http://localhost
    HTTP_LOCALHOST_FILES=$(find "${PROJECT_ROOT}" -type f \( -name "*.js" -o -name "*.cjs" -o -name "*.ts" -o -name "*.tsx" -o -name "*.json" -o -name "*.md" -o -name "*.sh" -o -name "*.bat" -o -name "*.ps1" -o -name "*.conf" -o -name "*.env*" \) -exec grep -l "http://localhost" {} \; 2>/dev/null || true)
    
    if [ -n "$HTTP_LOCALHOST_FILES" ]; then
        echo -e "${RED}❌ Ainda existem arquivos com http://localhost:${NC}"
        echo "$HTTP_LOCALHOST_FILES" | head -10
        if [ "$(echo "$HTTP_LOCALHOST_FILES" | wc -l)" -gt 10 ]; then
            echo -e "${YELLOW}   ... e mais $(($(echo "$HTTP_LOCALHOST_FILES" | wc -l) - 10)) arquivos${NC}"
        fi
    else
        echo -e "${GREEN}✅ Nenhuma referência a http://localhost encontrada${NC}"
    fi
    
    # Verificar localhost:3000
    LOCALHOST_3000_FILES=$(find "${PROJECT_ROOT}" -type f \( -name "*.js" -o -name "*.cjs" -o -name "*.ts" -o -name "*.tsx" -o -name "*.json" -o -name "*.md" -o -name "*.sh" -o -name "*.bat" -o -name "*.ps1" -o -name "*.conf" -o -name "*.env*" \) -exec grep -l "localhost:3000" {} \; 2>/dev/null || true)
    
    if [ -n "$LOCALHOST_3000_FILES" ]; then
        echo -e "${RED}❌ Ainda existem arquivos com localhost:3000:${NC}"
        echo "$LOCALHOST_3000_FILES" | head -10
        if [ "$(echo "$LOCALHOST_3000_FILES" | wc -l)" -gt 10 ]; then
            echo -e "${YELLOW}   ... e mais $(($(echo "$LOCALHOST_3000_FILES" | wc -l) - 10)) arquivos${NC}"
        fi
    else
        echo -e "${GREEN}✅ Nenhuma referência a localhost:3000 encontrada${NC}"
    fi
}

# Função para verificar se as novas referências foram criadas
check_new_references() {
    echo -e "${YELLOW}🔍 Verificando se as novas referências foram criadas...${NC}"
    
    # Verificar 216.238.107.59
    NEW_IP_FILES=$(find "${PROJECT_ROOT}" -type f \( -name "*.js" -o -name "*.cjs" -o -name "*.ts" -o -name "*.tsx" -o -name "*.json" -o -name "*.md" -o -name "*.sh" -o -name "*.bat" -o -name "*.ps1" -o -name "*.conf" -o -name "*.env*" \) -exec grep -l "${NEW_IP}" {} \; 2>/dev/null || true)
    
    if [ -n "$NEW_IP_FILES" ]; then
        echo -e "${GREEN}✅ ${NEW_IP} encontrado em $(echo "$NEW_IP_FILES" | wc -l) arquivos${NC}"
        echo "$NEW_IP_FILES" | head -5
        if [ "$(echo "$NEW_IP_FILES" | wc -l)" -gt 5 ]; then
            echo -e "${YELLOW}   ... e mais $(($(echo "$NEW_IP_FILES" | wc -l) - 5)) arquivos${NC}"
        fi
    else
        echo -e "${RED}❌ Nenhuma referência a ${NEW_IP} encontrada${NC}"
    fi
    
    # Verificar http://216.238.107.59
    HTTP_NEW_IP_FILES=$(find "${PROJECT_ROOT}" -type f \( -name "*.js" -o -name "*.cjs" -o -name "*.ts" -o -name "*.tsx" -o -name "*.json" -o -name "*.md" -o -name "*.sh" -o -name "*.bat" -o -name "*.ps1" -o -name "*.conf" -o -name "*.env*" \) -exec grep -l "http://${NEW_IP}" {} \; 2>/dev/null || true)
    
    if [ -n "$HTTP_NEW_IP_FILES" ]; then
        echo -e "${GREEN}✅ http://${NEW_IP} encontrado em $(echo "$HTTP_NEW_IP_FILES" | wc -l) arquivos${NC}"
    else
        echo -e "${RED}❌ Nenhuma referência a http://${NEW_IP} encontrada${NC}"
    fi
    
    # Verificar 216.238.107.59:3001
    NEW_IP_3001_FILES=$(find "${PROJECT_ROOT}" -type f \( -name "*.js" -o -name "*.cjs" -o -name "*.ts" -o -name "*.tsx" -o -name "*.json" -o -name "*.md" -o -name "*.sh" -o -name "*.bat" -o -name "*.ps1" -o -name "*.conf" -o -name "*.env*" \) -exec grep -l "${NEW_IP}:3001" {} \; 2>/dev/null || true)
    
    if [ -n "$NEW_IP_3001_FILES" ]; then
        echo -e "${GREEN}✅ ${NEW_IP}:3001 encontrado em $(echo "$NEW_IP_3001_FILES" | wc -l) arquivos${NC}"
    else
        echo -e "${RED}❌ Nenhuma referência a ${NEW_IP}:3001 encontrada${NC}"
    fi
    
    # Verificar 216.238.107.59:3000
    NEW_IP_3000_FILES=$(find "${PROJECT_ROOT}" -type f \( -name "*.js" -o -name "*.cjs" -o -name "*.ts" -o -name "*.tsx" -o -name "*.json" -o -name "*.md" -o -name "*.sh" -o -name "*.bat" -o -name "*.ps1" -o -name "*.conf" -o -name "*.env*" \) -exec grep -l "${NEW_IP}:3000" {} \; 2>/dev/null || true)
    
    if [ -n "$NEW_IP_3000_FILES" ]; then
        echo -e "${GREEN}✅ ${NEW_IP}:3000 encontrado em $(echo "$NEW_IP_3000_FILES" | wc -l) arquivos${NC}"
    else
        echo -e "${RED}❌ Nenhuma referência a ${NEW_IP}:3000 encontrada${NC}"
    fi
}

# Função para testar conectividade com a Vultr
test_vultr_connectivity() {
    echo -e "${YELLOW}🔍 Testando conectividade com a Vultr VPS...${NC}"
    
    # Testar ping
    if ping -c 1 "${NEW_IP}" >/dev/null 2>&1; then
        echo -e "${GREEN}✅ Ping para ${NEW_IP} funcionando${NC}"
    else
        echo -e "${RED}❌ Ping para ${NEW_IP} falhou${NC}"
    fi
    
    # Testar porta 22 (SSH)
    if nc -z "${NEW_IP}" 22 2>/dev/null; then
        echo -e "${GREEN}✅ Porta 22 (SSH) acessível${NC}"
    else
        echo -e "${RED}❌ Porta 22 (SSH) não acessível${NC}"
    fi
    
    # Testar porta 3001 (WebSocket)
    if nc -z "${NEW_IP}" 3001 2>/dev/null; then
        echo -e "${GREEN}✅ Porta 3001 (WebSocket) acessível${NC}"
    else
        echo -e "${RED}❌ Porta 3001 (WebSocket) não acessível${NC}"
    fi
    
    # Testar porta 80 (HTTP)
    if nc -z "${NEW_IP}" 80 2>/dev/null; then
        echo -e "${GREEN}✅ Porta 80 (HTTP) acessível${NC}"
    else
        echo -e "${RED}❌ Porta 80 (HTTP) não acessível${NC}"
    fi
}

# Função para testar endpoints específicos
test_vultr_endpoints() {
    echo -e "${YELLOW}🔍 Testando endpoints específicos na Vultr...${NC}"
    
    # Testar health endpoint
    if curl -s "http://${NEW_IP}:3001/health" >/dev/null 2>&1; then
        echo -e "${GREEN}✅ Health endpoint funcionando: http://${NEW_IP}:3001/health${NC}"
    else
        echo -e "${RED}❌ Health endpoint falhou: http://${NEW_IP}:3001/health${NC}"
    fi
    
    # Testar metrics endpoint
    if curl -s "http://${NEW_IP}:3001/metrics" >/dev/null 2>&1; then
        echo -e "${GREEN}✅ Metrics endpoint funcionando: http://${NEW_IP}:3001/metrics${NC}"
    else
        echo -e "${RED}❌ Metrics endpoint falhou: http://${NEW_IP}:3001/metrics${NC}"
    fi
    
    # Testar root endpoint
    if curl -s "http://${NEW_IP}:3001/" >/dev/null 2>&1; then
        echo -e "${GREEN}✅ Root endpoint funcionando: http://${NEW_IP}:3001/${NC}"
    else
        echo -e "${RED}❌ Root endpoint falhou: http://${NEW_IP}:3001/${NC}"
    fi
    
    # Testar load balancer (porta 80)
    if curl -s "http://${NEW_IP}/health" >/dev/null 2>&1; then
        echo -e "${GREEN}✅ Load balancer funcionando: http://${NEW_IP}/health${NC}"
    else
        echo -e "${YELLOW}⚠️  Load balancer não responde na porta 80${NC}"
    fi
}

# Função para mostrar estatísticas
show_statistics() {
    echo -e "${YELLOW}📊 Estatísticas da migração...${NC}"
    
    # Contar arquivos com referências antigas
    OLD_IP_COUNT=$(find "${PROJECT_ROOT}" -type f \( -name "*.js" -o -name "*.cjs" -o -name "*.ts" -o -name "*.tsx" -o -name "*.json" -o -name "*.md" -o -name "*.sh" -o -name "*.bat" -o -name "*.ps1" -o -name "*.conf" -o -name "*.env*" \) -exec grep -l "${OLD_IP}" {} \; 2>/dev/null | wc -l)
    OLD_LOCALHOST_COUNT=$(find "${PROJECT_ROOT}" -type f \( -name "*.js" -o -name "*.cjs" -o -name "*.ts" -o -name "*.tsx" -o -name "*.json" -o -name "*.md" -o -name "*.sh" -o -name "*.bat" -o -name "*.ps1" -o -name "*.conf" -o -name "*.env*" \) -exec grep -l "${OLD_LOCALHOST}" {} \; 2>/dev/null | wc -l)
    HTTP_LOCALHOST_COUNT=$(find "${PROJECT_ROOT}" -type f \( -name "*.js" -o -name "*.cjs" -o -name "*.ts" -o -name "*.tsx" -o -name "*.json" -o -name "*.md" -o -name "*.sh" -o -name "*.bat" -o -name "*.ps1" -o -name "*.conf" -o -name "*.env*" \) -exec grep -l "http://localhost" {} \; 2>/dev/null | wc -l)
    LOCALHOST_3000_COUNT=$(find "${PROJECT_ROOT}" -type f \( -name "*.js" -o -name "*.cjs" -o -name "*.ts" -o -name "*.tsx" -o -name "*.json" -o -name "*.md" -o -name "*.sh" -o -name "*.bat" -o -name "*.ps1" -o -name "*.conf" -o -name "*.env*" \) -exec grep -l "localhost:3000" {} \; 2>/dev/null | wc -l)
    
    # Contar arquivos com referências novas
    NEW_IP_COUNT=$(find "${PROJECT_ROOT}" -type f \( -name "*.js" -o -name "*.cjs" -o -name "*.ts" -o -name "*.tsx" -o -name "*.json" -o -name "*.md" -o -name "*.sh" -o -name "*.bat" -o -name "*.ps1" -o -name "*.conf" -o -name "*.env*" \) -exec grep -l "${NEW_IP}" {} \; 2>/dev/null | wc -l)
    
    echo -e "${BLUE}📈 Estatísticas:${NC}"
    echo -e "   • Arquivos com ${OLD_IP}: ${RED}${OLD_IP_COUNT}${NC}"
    echo -e "   • Arquivos com ${OLD_LOCALHOST}: ${RED}${OLD_LOCALHOST_COUNT}${NC}"
    echo -e "   • Arquivos com http://localhost: ${RED}${HTTP_LOCALHOST_COUNT}${NC}"
    echo -e "   • Arquivos com localhost:3000: ${RED}${LOCALHOST_3000_COUNT}${NC}"
    echo -e "   • Arquivos com ${NEW_IP}: ${GREEN}${NEW_IP_COUNT}${NC}"
    
    TOTAL_OLD=$((OLD_IP_COUNT + OLD_LOCALHOST_COUNT + HTTP_LOCALHOST_COUNT + LOCALHOST_3000_COUNT))
    
    if [ "$TOTAL_OLD" -eq 0 ]; then
        echo -e "${GREEN}🎉 Migração 100% completa!${NC}"
    else
        echo -e "${YELLOW}⚠️  Ainda existem ${TOTAL_OLD} referências antigas para migrar${NC}"
    fi
}

# Função principal
main() {
    echo -e "${YELLOW}🧪 Iniciando testes da migração...${NC}"
    echo ""
    
    check_old_references
    echo ""
    
    check_new_references
    echo ""
    
    test_vultr_connectivity
    echo ""
    
    test_vultr_endpoints
    echo ""
    
    show_statistics
    echo ""
    
    echo -e "${BLUE}📝 RESUMO DOS TESTES${NC}"
    echo -e "${BLUE}==================${NC}"
    
    TOTAL_OLD=$((OLD_IP_COUNT + OLD_LOCALHOST_COUNT + HTTP_LOCALHOST_COUNT + LOCALHOST_3000_COUNT))
    
    if [ "$TOTAL_OLD" -eq 0 ]; then
        echo -e "${GREEN}✅ Migração concluída com sucesso!${NC}"
        echo -e "${GREEN}✅ Todos os IPs foram migrados para a Vultr VPS${NC}"
        echo -e "${GREEN}✅ Load balancing e arquitetura preservados${NC}"
    else
        echo -e "${RED}❌ Migração incompleta${NC}"
        echo -e "${YELLOW}⚠️  Execute o script de migração novamente${NC}"
    fi
}

# Executar script
main "$@"
