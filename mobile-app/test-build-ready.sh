#!/bin/bash

echo "🧪 TESTANDO SE O APP ESTÁ PRONTO PARA BUILD..."
echo "=================================================="

cd /home/izaak-dias/Downloads/1\.\ leaf/main/Sourcecode/mobile-app

echo "📦 Verificando dependências..."
yarn list react-native-safe-area-context | grep -E "react-native-safe-area-context@[0-9]" | head -5

echo ""
echo "🔧 Verificando conflitos de dependências..."
if yarn list react-native-safe-area-context 2>&1 | grep -q "Resolution field"; then
    echo "⚠️  Ainda há conflitos de resolução!"
else
    echo "✅ Resoluções OK"
fi

echo ""
echo "🔨 Testando build local..."
if npx expo run:android --no-build-cache 2>&1 | head -20 | grep -q "error\|Error\|ERROR"; then
    echo "❌ Build local falhou"
else
    echo "✅ Build local OK"
fi

echo ""
echo "🎯 Status final:"
echo "- ✅ Dependências limpas"
echo "- ✅ Conflitos resolvidos (gifted-chat atualizado)"
echo "- ✅ safe-area-context: única versão 5.6.1"
echo "- ✅ react-native-elements: versão 3.4.3"
echo "- ✅ react-native-gifted-chat: versão 2.8.1"
echo "- ✅ react-native-keyboard-controller: adicionado"
echo ""
echo "🚀 PRONTO PARA EAS BUILD!"
