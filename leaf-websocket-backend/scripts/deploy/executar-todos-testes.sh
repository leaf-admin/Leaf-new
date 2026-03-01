#!/bin/bash

# Script para executar todos os testes e gerar relatório consolidado

cd "$(dirname "$0")"

echo "🚀 Executando todos os testes..."
echo ""

RESULTS_FILE="test-results-$(date +%Y%m%d-%H%M%S).txt"
TOTAL_PASSED=0
TOTAL_FAILED=0
TOTAL_TESTS=0

# Teste 1: No-Show e Reembolsos
echo "📋 Teste 1: No-Show e Reembolsos"
echo "================================" >> "$RESULTS_FILE"
echo "Teste 1: No-Show e Reembolsos" >> "$RESULTS_FILE"
echo "================================" >> "$RESULTS_FILE"
timeout 400 node test-noshow-reembolsos.js >> "$RESULTS_FILE" 2>&1
EXIT_CODE=$?
if [ $EXIT_CODE -eq 0 ]; then
    echo "✅ Passou"
    PASSED=$(grep -o "Passou: [0-9]*" "$RESULTS_FILE" | tail -1 | awk '{print $2}')
    FAILED=$(grep -o "Falhou: [0-9]*" "$RESULTS_FILE" | tail -1 | awk '{print $2}')
    TOTAL=$(grep -o "Total: [0-9]*" "$RESULTS_FILE" | tail -1 | awk '{print $2}')
    TOTAL_PASSED=$((TOTAL_PASSED + PASSED))
    TOTAL_FAILED=$((TOTAL_FAILED + FAILED))
    TOTAL_TESTS=$((TOTAL_TESTS + TOTAL))
else
    echo "❌ Falhou"
    TOTAL_FAILED=$((TOTAL_FAILED + 1))
fi
echo ""

# Teste 2: Chat, Incidentes e Suporte
echo "📋 Teste 2: Chat, Incidentes e Suporte"
echo "================================" >> "$RESULTS_FILE"
echo "Teste 2: Chat, Incidentes e Suporte" >> "$RESULTS_FILE"
echo "================================" >> "$RESULTS_FILE"
timeout 60 node test-chat-incidentes-suporte.js >> "$RESULTS_FILE" 2>&1
EXIT_CODE=$?
if [ $EXIT_CODE -eq 0 ]; then
    echo "✅ Passou"
    PASSED=$(grep -o "Passou: [0-9]*" "$RESULTS_FILE" | tail -1 | awk '{print $2}')
    FAILED=$(grep -o "Falhou: [0-9]*" "$RESULTS_FILE" | tail -1 | awk '{print $2}')
    TOTAL=$(grep -o "Total: [0-9]*" "$RESULTS_FILE" | tail -1 | awk '{print $2}')
    TOTAL_PASSED=$((TOTAL_PASSED + PASSED))
    TOTAL_FAILED=$((TOTAL_FAILED + FAILED))
    TOTAL_TESTS=$((TOTAL_TESTS + TOTAL))
else
    echo "❌ Falhou"
    TOTAL_FAILED=$((TOTAL_FAILED + 1))
fi
echo ""

# Teste 3: Histórico e Relatórios
echo "📋 Teste 3: Histórico e Relatórios"
echo "================================" >> "$RESULTS_FILE"
echo "Teste 3: Histórico e Relatórios" >> "$RESULTS_FILE"
echo "================================" >> "$RESULTS_FILE"
timeout 60 node test-historico-relatorios.js >> "$RESULTS_FILE" 2>&1
EXIT_CODE=$?
if [ $EXIT_CODE -eq 0 ]; then
    echo "✅ Passou"
    PASSED=$(grep -o "Passou: [0-9]*" "$RESULTS_FILE" | tail -1 | awk '{print $2}')
    FAILED=$(grep -o "Falhou: [0-9]*" "$RESULTS_FILE" | tail -1 | awk '{print $2}')
    TOTAL=$(grep -o "Total: [0-9]*" "$RESULTS_FILE" | tail -1 | awk '{print $2}')
    TOTAL_PASSED=$((TOTAL_PASSED + PASSED))
    TOTAL_FAILED=$((TOTAL_FAILED + FAILED))
    TOTAL_TESTS=$((TOTAL_TESTS + TOTAL))
else
    echo "❌ Falhou"
    TOTAL_FAILED=$((TOTAL_FAILED + 1))
fi
echo ""

# Resumo Final
echo "================================" >> "$RESULTS_FILE"
echo "RESUMO FINAL" >> "$RESULTS_FILE"
echo "================================" >> "$RESULTS_FILE"
echo "Total de Testes: $TOTAL_TESTS" >> "$RESULTS_FILE"
echo "Passou: $TOTAL_PASSED" >> "$RESULTS_FILE"
echo "Falhou: $TOTAL_FAILED" >> "$RESULTS_FILE"

SUCCESS_RATE=0
if [ $TOTAL_TESTS -gt 0 ]; then
    SUCCESS_RATE=$(echo "scale=1; ($TOTAL_PASSED * 100) / $TOTAL_TESTS" | bc)
fi

echo "Taxa de Sucesso: $SUCCESS_RATE%" >> "$RESULTS_FILE"

echo ""
echo "=========================================="
echo "📊 RESUMO FINAL"
echo "=========================================="
echo "Total de Testes: $TOTAL_TESTS"
echo "✅ Passou: $TOTAL_PASSED"
echo "❌ Falhou: $TOTAL_FAILED"
echo "📈 Taxa de Sucesso: $SUCCESS_RATE%"
echo "=========================================="
echo ""
echo "📄 Resultados completos salvos em: $RESULTS_FILE"

exit $TOTAL_FAILED


