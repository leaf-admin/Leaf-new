#!/bin/bash

# Script para rodar Android com Metro bundler e logs visíveis
# Uso: npm run android:dev

set -e  # Parar em caso de erro

echo "🚀 Iniciando Metro bundler..."
echo ""

# Verificar se node_modules existe
if [ ! -d "node_modules/expo" ]; then
    echo "❌ ERRO: node_modules/expo não encontrado!"
    echo "   Execute: npm install primeiro"
    exit 1
fi

# Criar arquivo de log para Metro
METRO_LOG="/tmp/metro-bundler.log"
> "$METRO_LOG"  # Limpar log anterior

echo "📝 Logs do Metro serão salvos em: $METRO_LOG"
echo ""

# Iniciar Metro bundler em background com redirecionamento de erros
echo "🔄 Iniciando Metro bundler..."
node node_modules/expo/bin/cli start --dev-client > "$METRO_LOG" 2>&1 &
METRO_PID=$!

# Aguardar Metro iniciar e verificar se está rodando
sleep 3

if ! kill -0 $METRO_PID 2>/dev/null; then
    echo "❌ ERRO: Metro bundler não iniciou!"
    echo ""
    echo "📋 Últimas linhas do log:"
    tail -30 "$METRO_LOG"
    echo ""
    echo "💡 Verifique o log completo em: $METRO_LOG"
    exit 1
fi

echo "✅ Metro bundler iniciado (PID: $METRO_PID)"
echo ""

# Aguardar mais um pouco para Metro estar pronto
sleep 2

echo "📱 Abrindo app no dispositivo..."
adb shell am start -n host.exp.exponent/.LauncherActivity 2>/dev/null || \
adb shell am start -n com.leaf.app/.MainActivity 2>/dev/null || \
echo "⚠️  Abra o app manualmente"

echo ""
echo "📊 Limpando logs antigos..."
adb logcat -c

echo ""
echo "════════════════════════════════════════"
echo "   📱 METRO BUNDLER + LOGS ATIVOS"
echo "════════════════════════════════════════"
echo ""
echo "💡 Pressione Ctrl+C para parar tudo"
echo "📝 Log do Metro: $METRO_LOG"
echo ""

# Função para mostrar erros do Metro em tempo real
show_metro_errors() {
    tail -f "$METRO_LOG" 2>/dev/null | grep --color=always -E "(ERROR|Error|error|Failed|failed|Exception|exception)" || true
}

# Mostrar erros do Metro em background
show_metro_errors &
METRO_TAIL_PID=$!

# Mostrar logs do React Native em tempo real
adb logcat *:S ReactNative:V ReactNativeJS:V | grep --color=always -E "(ReactNativeJS|ERROR|WARN|LOG|KYC|AuthFlow|KYCDocumentStep)" || \
adb logcat *:S ReactNative:V ReactNativeJS:V

# Quando parar, matar tudo
cleanup() {
    echo ""
    echo "🛑 Parando Metro bundler..."
    kill $METRO_PID 2>/dev/null
    kill $METRO_TAIL_PID 2>/dev/null
    echo "✅ Parado"
    exit
}

trap cleanup INT TERM

