#!/bin/bash

echo "🚀 ABRIR LEAF APP NO DISPOSITIVO"
echo "================================="

# Verificar se há dispositivos conectados
if ! adb devices | grep -q "device$"; then
    echo "❌ Nenhum dispositivo conectado"
    exit 1
fi

echo "✅ Dispositivo conectado"
echo "📱 Abrindo Leaf App..."

# Tentar diferentes métodos para abrir o app
echo "Método 1: Monkey..."
adb shell monkey -p br.com.leaf.ride -c android.intent.category.LAUNCHER 1

sleep 2

echo "Método 2: Intent..."
adb shell am start -n br.com.leaf.ride/.MainActivity 2>/dev/null || echo "MainActivity não encontrada"

echo "Método 3: Intent alternativo..."
adb shell am start -n br.com.leaf.ride/expo.modules.devlauncher.launcher.DevLauncherActivity 2>/dev/null || echo "DevLauncherActivity não encontrada"

echo ""
echo "✅ Comandos executados!"
echo ""
echo "📊 Para verificar se o app abriu:"
echo "adb shell dumpsys activity | grep 'com.leaf.app'"
echo ""
echo "📱 Para ver logs do app:"
echo "adb logcat | grep -E '(Leaf|FCM|WebSocket|🧪)'"
