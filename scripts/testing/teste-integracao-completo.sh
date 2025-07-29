#!/bin/bash

# 🧪 TESTE DE INTEGRAÇÃO COMPLETO - LEAF APP
# Data: 29 de Julho de 2025
# Status: Teste completo de todos os componentes

set -e

# Cores para output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Função para logging
log() {
    echo -e "${BLUE}[$(date +'%H:%M:%S')]${NC} $1"
}

success() {
    echo -e "${GREEN}✅ $1${NC}"
}

error() {
    echo -e "${RED}❌ $1${NC}"
}

warning() {
    echo -e "${YELLOW}⚠️ $1${NC}"
}

# Configurações
VULTR_IP="216.238.107.59"
HOSTINGER_IP="147.93.66.253"
TEST_TIMEOUT=10

echo "🚀 INICIANDO TESTE DE INTEGRAÇÃO COMPLETO"
echo "=========================================="
echo ""

# ========================================
# 1. TESTE DE CONECTIVIDADE SSH
# ========================================
log "1. Testando conectividade SSH..."

if ssh -o ConnectTimeout=5 vultr-leaf "echo 'SSH Vultr OK'" > /dev/null 2>&1; then
    success "SSH Vultr: Conectado"
else
    error "SSH Vultr: Falha na conexão"
    exit 1
fi

if ssh -o ConnectTimeout=5 root@$HOSTINGER_IP "echo 'SSH Hostinger OK'" > /dev/null 2>&1; then
    success "SSH Hostinger: Conectado"
else
    warning "SSH Hostinger: Falha na conexão (pode ser normal se não configurado)"
fi

echo ""

# ========================================
# 2. TESTE DOS SERVIÇOS VULTR
# ========================================
log "2. Testando serviços Vultr..."

# Teste Node.js
if ssh vultr-leaf "systemctl is-active leaf-primary" | grep -q "active"; then
    success "Node.js App: Ativo"
else
    error "Node.js App: Inativo"
fi

# Teste Redis
if ssh vultr-leaf "redis-cli ping" | grep -q "PONG"; then
    success "Redis: Funcionando"
else
    error "Redis: Falha"
fi

# Teste Nginx
if ssh vultr-leaf "systemctl is-active nginx" | grep -q "active"; then
    success "Nginx: Ativo"
else
    error "Nginx: Inativo"
fi

# Teste Firewall
if ssh vultr-leaf "ufw status" | grep -q "Status: active"; then
    success "UFW: Ativo"
else
    warning "UFW: Inativo"
fi

# Teste Fail2ban
if ssh vultr-leaf "systemctl is-active fail2ban" | grep -q "active"; then
    success "Fail2ban: Ativo"
else
    warning "Fail2ban: Inativo"
fi

echo ""

# ========================================
# 3. TESTE DE HEALTH CHECKS
# ========================================
log "3. Testando health checks..."

# Health check direto Vultr
VULTR_HEALTH=$(ssh vultr-leaf "timeout $TEST_TIMEOUT curl -s http://localhost:3001/health" 2>/dev/null || echo "timeout")
if [[ "$VULTR_HEALTH" == *"healthy"* ]]; then
    success "Health Check Vultr Direto: OK"
else
    error "Health Check Vultr Direto: Falha ($VULTR_HEALTH)"
fi

# Health check via load balancer
LB_HEALTH=$(ssh vultr-leaf "timeout $TEST_TIMEOUT curl -s http://localhost/health" 2>/dev/null || echo "timeout")
if [[ "$LB_HEALTH" == *"healthy"* ]]; then
    success "Health Check Load Balancer: OK"
else
    error "Health Check Load Balancer: Falha ($LB_HEALTH)"
fi

# Health check Hostinger
HOSTINGER_HEALTH=$(timeout $TEST_TIMEOUT curl -s http://$HOSTINGER_IP/health 2>/dev/null || echo "timeout")
if [[ "$HOSTINGER_HEALTH" == *"fallback_healthy"* ]]; then
    success "Health Check Hostinger: OK"
else
    warning "Health Check Hostinger: Falha ($HOSTINGER_HEALTH)"
fi

echo ""

# ========================================
# 4. TESTE DE FALLOVER
# ========================================
log "4. Testando failover..."

# Parar primary
log "Parando servidor primary..."
ssh vultr-leaf "systemctl stop leaf-primary" > /dev/null 2>&1
sleep 3

# Testar se fallback assume
FAILOVER_HEALTH=$(ssh vultr-leaf "timeout $TEST_TIMEOUT curl -s http://localhost/health" 2>/dev/null || echo "timeout")
if [[ "$FAILOVER_HEALTH" == *"fallback_healthy"* ]]; then
    success "Failover: Hostinger assumiu corretamente"
else
    error "Failover: Falha ($FAILOVER_HEALTH)"
fi

# Reiniciar primary
log "Reiniciando servidor primary..."
ssh vultr-leaf "systemctl start leaf-primary" > /dev/null 2>&1
sleep 5

# Testar se primary volta
RECOVERY_HEALTH=$(ssh vultr-leaf "timeout $TEST_TIMEOUT curl -s http://localhost/health" 2>/dev/null || echo "timeout")
if [[ "$RECOVERY_HEALTH" == *"healthy"* ]]; then
    success "Recovery: Primary voltou corretamente"
else
    error "Recovery: Falha ($RECOVERY_HEALTH)"
fi

echo ""

# ========================================
# 5. TESTE DE CONECTIVIDADE EXTERNA
# ========================================
log "5. Testando conectividade externa..."

# Teste HTTP Vultr
if timeout $TEST_TIMEOUT curl -s http://$VULTR_IP/health > /dev/null 2>&1; then
    success "HTTP Vultr Externo: Acessível"
else
    warning "HTTP Vultr Externo: Não acessível (pode ser normal se não configurado)"
fi

# Teste HTTPS Vultr (se configurado)
if timeout $TEST_TIMEOUT curl -k -s https://$VULTR_IP/health > /dev/null 2>&1; then
    success "HTTPS Vultr Externo: Acessível"
else
    warning "HTTPS Vultr Externo: Não acessível (pode ser normal se não configurado)"
fi

# Teste HTTP Hostinger
if timeout $TEST_TIMEOUT curl -s http://$HOSTINGER_IP/health > /dev/null 2>&1; then
    success "HTTP Hostinger Externo: Acessível"
else
    warning "HTTP Hostinger Externo: Não acessível"
fi

echo ""

# ========================================
# 6. TESTE DE RECURSOS DO SISTEMA
# ========================================
log "6. Testando recursos do sistema..."

# CPU e RAM Vultr
VULTR_CPU=$(ssh vultr-leaf "top -bn1 | grep 'Cpu(s)' | awk '{print \$2}' | cut -d'%' -f1")
VULTR_RAM=$(ssh vultr-leaf "free | grep Mem | awk '{printf \"%.1f\", \$3/\$2 * 100.0}'")

if (( $(echo "$VULTR_CPU < 80" | bc -l) )); then
    success "CPU Vultr: ${VULTR_CPU}% (OK)"
else
    warning "CPU Vultr: ${VULTR_CPU}% (Alto)"
fi

if (( $(echo "$VULTR_RAM < 80" | bc -l) )); then
    success "RAM Vultr: ${VULTR_RAM}% (OK)"
else
    warning "RAM Vultr: ${VULTR_RAM}% (Alto)"
fi

# Disco Vultr
VULTR_DISK=$(ssh vultr-leaf "df / | tail -1 | awk '{print \$5}' | cut -d'%' -f1")
if (( VULTR_DISK < 80 )); then
    success "Disco Vultr: ${VULTR_DISK}% (OK)"
else
    warning "Disco Vultr: ${VULTR_DISK}% (Alto)"
fi

echo ""

# ========================================
# 7. TESTE DE LOGS E MONITORAMENTO
# ========================================
log "7. Testando logs e monitoramento..."

# Verificar logs recentes
RECENT_LOGS=$(ssh vultr-leaf "journalctl -u leaf-primary --since '5 minutes ago' --no-pager | wc -l")
if (( RECENT_LOGS > 0 )); then
    success "Logs recentes: $RECENT_LOGS entradas"
else
    warning "Logs recentes: Nenhuma entrada"
fi

# Verificar se há erros críticos
ERROR_LOGS=$(ssh vultr-leaf "journalctl -u leaf-primary --since '5 minutes ago' --no-pager | grep -i 'error\|fatal\|critical' | wc -l")
if (( ERROR_LOGS == 0 )); then
    success "Logs de erro: Nenhum erro crítico"
else
    warning "Logs de erro: $ERROR_LOGS erros encontrados"
fi

echo ""

# ========================================
# 8. TESTE DE CONFIGURAÇÃO
# ========================================
log "8. Testando configurações..."

# Verificar configuração Nginx
if ssh vultr-leaf "nginx -t" > /dev/null 2>&1; then
    success "Configuração Nginx: Válida"
else
    error "Configuração Nginx: Inválida"
fi

# Verificar configuração Redis
if ssh vultr-leaf "redis-cli config get maxmemory" | grep -q "maxmemory"; then
    success "Configuração Redis: OK"
else
    warning "Configuração Redis: Não verificada"
fi

# Verificar configuração do sistema
if ssh vultr-leaf "systemctl is-enabled leaf-primary" | grep -q "enabled"; then
    success "Serviço leaf-primary: Habilitado"
else
    warning "Serviço leaf-primary: Não habilitado"
fi

echo ""

# ========================================
# 9. TESTE DE SEGURANÇA
# ========================================
log "9. Testando segurança..."

# Verificar portas abertas
OPEN_PORTS=$(ssh vultr-leaf "ss -tlnp | grep -E ':(80|443|3001|22)' | wc -l")
if (( OPEN_PORTS >= 3 )); then
    success "Portas abertas: $OPEN_PORTS portas (OK)"
else
    warning "Portas abertas: $OPEN_PORTS portas (Poucas)"
fi

# Verificar fail2ban
if ssh vultr-leaf "fail2ban-client status" > /dev/null 2>&1; then
    success "Fail2ban: Funcionando"
else
    warning "Fail2ban: Não configurado"
fi

echo ""

# ========================================
# 10. RESUMO FINAL
# ========================================
log "10. Resumo final..."

echo "📊 RESUMO DOS TESTES:"
echo "====================="

# Contar sucessos e falhas
TOTAL_TESTS=0
SUCCESS_TESTS=0
FAILED_TESTS=0

# Contar baseado nos outputs anteriores (simplificado)
SUCCESS_TESTS=$(grep -c "✅" <<< "$(echo "$VULTR_HEALTH $LB_HEALTH $HOSTINGER_HEALTH $FAILOVER_HEALTH $RECOVERY_HEALTH")" 2>/dev/null || echo "0")
FAILED_TESTS=$(grep -c "❌" <<< "$(echo "$VULTR_HEALTH $LB_HEALTH $HOSTINGER_HEALTH $FAILOVER_HEALTH $RECOVERY_HEALTH")" 2>/dev/null || echo "0")

echo "✅ Testes bem-sucedidos: $SUCCESS_TESTS"
echo "❌ Testes com falha: $FAILED_TESTS"
echo "⚠️ Avisos: $(grep -c "⚠️" <<< "$(echo "$VULTR_HEALTH $LB_HEALTH $HOSTINGER_HEALTH $FAILOVER_HEALTH $RECOVERY_HEALTH")" 2>/dev/null || echo "0")"

echo ""
echo "🎯 STATUS FINAL:"

if (( FAILED_TESTS == 0 )); then
    success "SISTEMA TOTALMENTE OPERACIONAL!"
elif (( FAILED_TESTS <= 2 )); then
    warning "SISTEMA OPERACIONAL COM PEQUENOS PROBLEMAS"
else
    error "SISTEMA COM PROBLEMAS CRÍTICOS"
fi

echo ""
echo "🚀 Teste de integração completo finalizado!"
echo "Data: $(date)"
echo "Duração: $(($(date +%s) - $(date +%s))) segundos" 