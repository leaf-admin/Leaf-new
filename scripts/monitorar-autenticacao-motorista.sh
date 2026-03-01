#!/bin/bash
# Script para monitorar autenticação do motorista

echo "🔍 Monitorando autenticação do motorista..."
echo "📱 Dispositivo: $(adb devices | grep device | head -1 | awk '{print $1}')"
echo ""
echo "⏳ Aguardando logs do app (30 segundos)..."
echo "💡 Abra o app como motorista e deixe online"
echo ""

# Limpar logs anteriores
adb logcat -c

# Monitorar logs com filtro específico
timeout 30 adb logcat | grep --line-buffered -E "DRIVERUI|WebSocket|authenticate|Motorista|🔐|🔌|✅|❌|driver|userType" | while read line; do
    echo "$line"
done

echo ""
echo "✅ Monitoramento concluído"
echo "📊 Verificando conexões no servidor..."


