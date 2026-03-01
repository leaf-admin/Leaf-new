#!/bin/bash
# Script para executar todos os stress tests

echo "🧪 Executando todos os stress tests..."
echo ""

# Verificar se servidor está rodando
if ! curl -s http://localhost:3001/health > /dev/null 2>&1; then
    echo "⚠️  Servidor não está rodando em http://localhost:3001"
    echo "   Inicie o servidor antes de executar os testes."
    exit 1
fi

echo "1️⃣  Command Flood (1.000 requisições)..."
node scripts/stress-test/command-flood.js --count 1000 --concurrency 10
echo ""

echo "2️⃣  Listener Backpressure (10.000 eventos)..."
node scripts/stress-test/listener-backpressure.js --events 10000 --rate 100
echo ""

echo "3️⃣  External Failure - Firebase (60s)..."
node scripts/stress-test/external-failure.js --service firebase --duration 60 --rate 10
echo ""

echo "4️⃣  Peak Scenario (5k drivers, 2k rides)..."
node scripts/stress-test/peak-scenario.js --drivers 5000 --rides 2000 --duration 30
echo ""

echo "5️⃣  Capacity Report..."
node scripts/stress-test/capacity-report.js
echo ""

echo "✅ Todos os testes concluídos!"
echo ""
echo "📊 Relatórios gerados:"
ls -lh stress-test-*.json capacity-report-*.json 2>/dev/null | tail -5

