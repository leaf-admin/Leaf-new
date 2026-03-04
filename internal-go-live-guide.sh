#!/bin/bash

# 🚀 GUIA DE GO-LIVE INTERNO (SANDBOX)
# Este script orienta o processo de deploy e build para o ambiente de testes.

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${BLUE}=== 🌿 PROJETO LEAF - GO-LIVE INTERNO (SANDBOX) ===${NC}"

# 1. Backend
echo -e "\n${YELLOW}1. CONFIGURAÇÃO DO BACKEND (VPS)${NC}"
echo "--------------------------------------------------"
echo "Eu preparei o arquivo: leaf-websocket-backend/.env.production.sandbox"
echo "Siga estes passos:"
echo "1.1. Copie o conteúdo deste arquivo para o arquivo '.env' na VPS (em /leaf-websocket-backend/)"
echo "1.2. Reinicie o servidor na VPS: 'pm2 restart leaf-websocket-server'"
echo "1.3. Verifique se o servidor subiu: 'curl http://localhost:3001/health'"

# 2. Mobile App
echo -e "\n${YELLOW}2. GERAÇÃO DE BUILDS MOBILE (EAS)${NC}"
echo "--------------------------------------------------"
echo "Para gerar as builds que permitem tirar os prints para a loja:"

echo -e "\n${GREEN}2.1 ANDROID (Gera um link para baixar o APK):${NC}"
echo "cd mobile-app && npx eas build --platform android --profile preview"

echo -e "\n${GREEN}2.2 iOS (Envia para o TestFlight ou gera link interno):${NC}"
echo "cd mobile-app && npx eas build --platform ios --profile preview"

# 3. Assets
echo -e "\n${YELLOW}3. GERAÇÃO DE ASSETS${NC}"
echo "--------------------------------------------------"
echo "Com as builds de preview instaladas no seu dispositivo:"
echo "- Realize o login no app."
echo "- Navegue pelos fluxos: Mapa, Pedir Corrida, Pagamento Pix, Perfil."
echo "- Tire os prints para a vitrine da Apple Store e Google Play."

echo -e "\n${BLUE}Deseja que eu tente validar a configuração local do EAS agora? (y/N)${NC}"
read -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
    cd mobile-app && npx eas --version
    npx expo config --type public
fi

echo -e "\n${BLUE}Tudo pronto para iniciarmos o Go-Live interno!${NC}"
