#!/bin/bash
echo "🔍 Monitorando build Android..."
echo ""

while pgrep -f "gradle.*assembleRelease" > /dev/null; do
    echo -ne "\r⏳ Build em andamento... $(date +%H:%M:%S)"
    sleep 2
done

echo ""
echo ""

if [ -f "mobile-app/android/app/build/outputs/apk/release/app-release.apk" ]; then
    echo "✅ BUILD CONCLUÍDA COM SUCESSO!"
    echo ""
    ls -lh mobile-app/android/app/build/outputs/apk/release/app-release.apk
    echo ""
    echo "📱 APK gerado em:"
    echo "   $(pwd)/mobile-app/android/app/build/outputs/apk/release/app-release.apk"
else
    echo "❌ Build concluída mas APK não encontrado"
    echo "Verifique os logs em /tmp/gradle-build.log"
fi
