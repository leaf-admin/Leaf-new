#!/bin/bash

# Script para aplicar regras do Firestore - EXECUTE MANUALMENTE

echo "🔧 Aplicando regras corrigidas do Firestore..."
echo "Projeto: leaf-reactnative"
echo ""

# Selecionar projeto
firebase use leaf-reactnative

# Aplicar regras
firebase deploy --only firestore:rules

echo ""
echo "✅ SUCESSO! Regras aplicadas."
echo ""
echo "🎯 Usuários normais agora podem:"
echo "   • Salvar dados de viagem no Firestore"
echo "   • Gerenciar veículos"
echo "   • Usar o app sem permission-denied"


















