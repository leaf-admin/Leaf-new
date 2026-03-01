#!/bin/bash

echo "🧪 TESTANDO IMPLEMENTAÇÕES DE OBSERVABILIDADE"
echo "========================================="
echo ""

echo "1. HEALTH CHECKS"
echo "----------------------------------------"
echo "📊 Health Check Liveness:"
curl -s http://localhost:3001/health/liveness | head -20
echo ""
echo "⚡ Health Check Quick:"
curl -s http://localhost:3001/health/quick | head -20
echo ""
echo "✅ Readiness Probe:"
curl -s http://localhost:3001/health/readiness | head -20
echo ""
echo "📊 Health Check Completo:"
curl -s http://localhost:3001/health | head -30
echo ""

echo ""
echo "2. ALERTAS"
echo "----------------------------------------"
echo "📋 Listar Alertas:"
curl -s http://localhost:3001/api/alerts | head -30
echo ""
echo "📊 Estatísticas de Alertas:"
curl -s http://localhost:3001/api/alerts/stats
echo ""

echo ""
echo "3. MÉTRICAS PROMETHEUS"
echo "----------------------------------------"
echo "📈 Métricas (primeiras 30 linhas):"
curl -s http://localhost:3001/api/metrics/prometheus | head -30
echo ""
echo "🔍 Métricas específicas:"
curl -s http://localhost:3001/api/metrics/prometheus | grep -E "leaf_commands_total|leaf_redis_duration|leaf_websocket_connections|leaf_health" | head -10
echo ""

echo ""
echo "✅ TESTES CONCLUÍDOS!"

