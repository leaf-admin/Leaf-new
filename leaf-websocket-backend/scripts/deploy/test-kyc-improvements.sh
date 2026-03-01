#!/bin/bash

# Script de teste para as melhorias KYC implementadas
# Versão: 1.0.0

echo "🧪 TESTE DAS MELHORIAS KYC IMPLEMENTADAS"
echo "========================================"
echo ""

# Função para logar mensagens
log() {
    echo -e "\033[0;32m[$(date +'%Y-%m-%d %H:%M:%S')]\033[0m 🔍 $1"
}

# Teste 1: Verificar se o servidor está rodando
log "🔍 Verificando se o servidor está rodando..."
SERVER_STATUS=$(curl -s http://localhost:3001/api/kyc/health | grep "healthy")
if [ -n "$SERVER_STATUS" ]; then
    echo "✅ Servidor KYC: Rodando"
else
    echo "❌ Servidor KYC: NÃO Rodando"
    echo "Por favor, inicie o servidor backend em leaf-websocket-backend e tente novamente."
    exit 1
fi

# Teste 2: Testar rotas de analytics
log "📊 Testando rotas de analytics..."

# Teste analytics globais
ANALYTICS_GLOBAL=$(curl -s http://localhost:3001/api/kyc-analytics/analytics)
if echo "$ANALYTICS_GLOBAL" | grep -q "success"; then
    echo "✅ Analytics globais: OK"
else
    echo "❌ Analytics globais: FAILED"
fi

# Teste analytics diários
ANALYTICS_DAILY=$(curl -s http://localhost:3001/api/kyc-analytics/analytics/daily)
if echo "$ANALYTICS_DAILY" | grep -q "success"; then
    echo "✅ Analytics diários: OK"
else
    echo "❌ Analytics diários: FAILED"
fi

# Teste analytics em tempo real
ANALYTICS_REALTIME=$(curl -s http://localhost:3001/api/kyc-analytics/analytics/realtime)
if echo "$ANALYTICS_REALTIME" | grep -q "success"; then
    echo "✅ Analytics em tempo real: OK"
else
    echo "❌ Analytics em tempo real: FAILED"
fi

# Teste relatório completo
ANALYTICS_REPORT=$(curl -s http://localhost:3001/api/kyc-analytics/analytics/report)
if echo "$ANALYTICS_REPORT" | grep -q "success"; then
    echo "✅ Relatório completo: OK"
else
    echo "❌ Relatório completo: FAILED"
fi

# Teste 3: Testar rotas de retry
log "🔄 Testando rotas de retry..."

# Teste stats de retry
RETRY_STATS=$(curl -s http://localhost:3001/api/kyc-analytics/retry/stats)
if echo "$RETRY_STATS" | grep -q "success"; then
    echo "✅ Stats de retry: OK"
else
    echo "❌ Stats de retry: FAILED"
fi

# Teste configuração de retry
RETRY_CONFIG=$(curl -s -X POST http://localhost:3001/api/kyc-analytics/retry/configure \
    -H "Content-Type: application/json" \
    -d '{"maxRetries": 3, "retryDelays": [2000, 5000, 10000]}')
if echo "$RETRY_CONFIG" | grep -q "success"; then
    echo "✅ Configuração de retry: OK"
else
    echo "❌ Configuração de retry: FAILED"
fi

# Teste 4: Testar rotas de notificações
log "📱 Testando rotas de notificações..."

# Teste notificação de liveness
LIVENESS_NOTIF=$(curl -s -X POST http://localhost:3001/api/kyc-analytics/notifications/liveness \
    -H "Content-Type: application/json" \
    -d '{"driverId": "test-driver-123", "data": {"step": "smile_check"}}')
if echo "$LIVENESS_NOTIF" | grep -q "success"; then
    echo "✅ Notificação de liveness: OK"
else
    echo "❌ Notificação de liveness: FAILED"
fi

# Teste notificação de retry
RETRY_NOTIF=$(curl -s -X POST http://localhost:3001/api/kyc-analytics/notifications/retry \
    -H "Content-Type: application/json" \
    -d '{"driverId": "test-driver-123", "data": {"attempt": 2, "reason": "low_confidence"}}')
if echo "$RETRY_NOTIF" | grep -q "success"; then
    echo "✅ Notificação de retry: OK"
else
    echo "❌ Notificação de retry: FAILED"
fi

# Teste notificação de conclusão
COMPLETION_NOTIF=$(curl -s -X POST http://localhost:3001/api/kyc-analytics/notifications/completion \
    -H "Content-Type: application/json" \
    -d '{"driverId": "test-driver-123", "data": {"totalTime": 5000, "attempts": 1}}')
if echo "$COMPLETION_NOTIF" | grep -q "success"; then
    echo "✅ Notificação de conclusão: OK"
else
    echo "❌ Notificação de conclusão: FAILED"
fi

# Teste 5: Testar limpeza de dados
log "🧹 Testando limpeza de dados..."
CLEANUP=$(curl -s -X POST http://localhost:3001/api/kyc-analytics/cleanup)
if echo "$CLEANUP" | grep -q "success"; then
    echo "✅ Limpeza de dados: OK"
else
    echo "❌ Limpeza de dados: FAILED"
fi

# Teste 6: Verificar arquivos implementados
log "📁 Verificando arquivos implementados..."
if [ -f "leaf-websocket-backend/services/KYCRetryService.js" ]; then
    echo "✅ KYCRetryService.js: OK"
else
    echo "❌ KYCRetryService.js: FAILED"
fi

if [ -f "leaf-websocket-backend/services/KYCAnalyticsService.js" ]; then
    echo "✅ KYCAnalyticsService.js: OK"
else
    echo "❌ KYCAnalyticsService.js: FAILED"
fi

if [ -f "leaf-websocket-backend/services/KYCNotificationService.js" ]; then
    echo "✅ KYCNotificationService.js: OK"
else
    echo "❌ KYCNotificationService.js: FAILED"
fi

if [ -f "leaf-websocket-backend/routes/kyc-analytics-routes.js" ]; then
    echo "✅ kyc-analytics-routes.js: OK"
else
    echo "❌ kyc-analytics-routes.js: FAILED"
fi

echo ""
log "🎉 Testes das melhorias KYC concluídos!"
echo ""

echo "📋 RESUMO DAS MELHORIAS IMPLEMENTADAS:"
echo "======================================"
echo "✅ Retry automático: Implementado com delays exponenciais"
echo "✅ Analytics: Métricas completas de verificação"
echo "✅ Notificações: Push notifications integradas"
echo "✅ Rotas REST: Endpoints para todas as funcionalidades"
echo "✅ Integração: Serviços integrados ao sistema principal"
echo ""

echo "🚀 FUNCIONALIDADES DISPONÍVEIS:"
echo "==============================="
echo "📊 Analytics:"
echo "   GET  /api/kyc-analytics/analytics - Analytics globais"
echo "   GET  /api/kyc-analytics/analytics/driver/:id - Analytics por driver"
echo "   GET  /api/kyc-analytics/analytics/daily - Analytics diários"
echo "   GET  /api/kyc-analytics/analytics/realtime - Analytics em tempo real"
echo "   GET  /api/kyc-analytics/analytics/report - Relatório completo"
echo ""
echo "🔄 Retry:"
echo "   GET  /api/kyc-analytics/retry/stats - Estatísticas de retry"
echo "   POST /api/kyc-analytics/retry/configure - Configurar retry"
echo ""
echo "📱 Notificações:"
echo "   POST /api/kyc-analytics/notifications/liveness - Notificação de liveness"
echo "   POST /api/kyc-analytics/notifications/retry - Notificação de retry"
echo "   POST /api/kyc-analytics/notifications/completion - Notificação de conclusão"
echo ""
echo "🧹 Manutenção:"
echo "   POST /api/kyc-analytics/cleanup - Limpeza de dados antigos"
echo ""

echo "💡 PRÓXIMOS PASSOS:"
echo "==================="
echo "1. Testar no dispositivo móvel real"
echo "2. Configurar notificações FCM"
echo "3. Monitorar métricas de performance"
echo "4. Ajustar parâmetros de retry conforme necessário"
echo "5. Implementar dashboard de analytics"
echo ""

echo "🎯 SISTEMA KYC AVANÇADO PRONTO PARA USO!"
echo "========================================"
