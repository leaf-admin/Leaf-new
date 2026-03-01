#!/bin/bash

# Script para mostrar apenas logs do React Native
# Uso: npm run android:logs

echo "📊 Limpando logs antigos..."
adb logcat -c

echo ""
echo "════════════════════════════════════════"
echo "   📱 LOGS DO REACT NATIVE"
echo "════════════════════════════════════════"
echo ""
echo "💡 Pressione Ctrl+C para parar"
echo ""

# Mostrar logs filtrados
adb logcat *:S ReactNative:V ReactNativeJS:V | grep --color=always -E "(ReactNativeJS|ERROR|WARN|LOG|KYC|AuthFlow|KYCDocumentStep)" || \
adb logcat *:S ReactNative:V ReactNativeJS:V

