#!/bin/bash

# Script MANUAL para aplicar regras do Firestore
# Execute APÓS fazer login no Firebase

echo "🔧 Aplicando regras corrigidas do Firestore..."
echo ""

# Aplicar regras
firebase deploy --only firestore:rules

echo ""
echo "✅ Regras do Firestore atualizadas!"
echo ""
echo "🎯 Agora usuários normais podem:"
echo "   • Salvar dados de viagem no Firestore"
echo "   • Gerenciar veículos"
echo "   • Usar o app sem erros de permissão"
echo ""
echo "🚀 Reinicie o app para testar!"


















