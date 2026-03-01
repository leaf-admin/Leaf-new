#!/bin/bash

# Script para monitorar builds locais

echo ""
echo "════════════════════════════════════════"
echo "   📊 MONITORANDO BUILDS LOCAIS"
echo "════════════════════════════════════════"
echo ""

RELEASE_APK="android/app/build/outputs/apk/release/app-release.apk"
DEBUG_APK="android/app/build/outputs/apk/debug/app-debug.apk"

while true; do
    clear
    echo ""
    echo "════════════════════════════════════════"
    echo "   📊 STATUS DAS BUILDS"
    echo "════════════════════════════════════════"
    echo ""
    
    # Verificar build RELEASE
    if [ -f "$RELEASE_APK" ]; then
        SIZE=$(du -h "$RELEASE_APK" | cut -f1)
        echo "✅ Build RELEASE (motorista):"
        echo "   • APK gerado: $RELEASE_APK"
        echo "   • Tamanho: $SIZE"
        echo ""
    else
        echo "⏳ Build RELEASE (motorista):"
        echo "   • Em execução..."
        echo ""
    fi
    
    # Verificar build DEVELOPMENT
    if [ -f "$DEBUG_APK" ]; then
        SIZE=$(du -h "$DEBUG_APK" | cut -f1)
        echo "✅ Build DEVELOPMENT (passageiro):"
        echo "   • APK gerado: $DEBUG_APK"
        echo "   • Tamanho: $SIZE"
        echo ""
    else
        echo "⏳ Build DEVELOPMENT (passageiro):"
        echo "   • Em execução..."
        echo ""
    fi
    
    # Verificar processos
    EXPO_PROCESS=$(ps aux | grep "expo.*run:android" | grep -v grep | wc -l)
    GRADLE_PROCESS=$(ps aux | grep "gradle" | grep -v grep | wc -l)
    
    if [ "$EXPO_PROCESS" -gt 0 ] || [ "$GRADLE_PROCESS" -gt 0 ]; then
        echo "🔄 Processos ativos:"
        [ "$EXPO_PROCESS" -gt 0 ] && echo "   • Expo CLI: rodando"
        [ "$GRADLE_PROCESS" -gt 0 ] && echo "   • Gradle: rodando"
        echo ""
    fi
    
    # Se ambas as builds estiverem prontas, sair
    if [ -f "$RELEASE_APK" ] && [ -f "$DEBUG_APK" ]; then
        echo "════════════════════════════════════════"
        echo "   ✅ TODAS AS BUILDS CONCLUÍDAS!"
        echo "════════════════════════════════════════"
        echo ""
        echo "📱 APKs gerados:"
        echo "   • RELEASE: $RELEASE_APK"
        echo "   • DEVELOPMENT: $DEBUG_APK"
        echo ""
        echo "💡 Para instalar a DEVELOPMENT em outro dispositivo:"
        echo "   adb -s <device-id> install $DEBUG_APK"
        echo ""
        break
    fi
    
    sleep 5
done

