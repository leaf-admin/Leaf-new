#!/bin/bash

# 🚀 Script de Deploy da Landing Page Leaf
# Versão: 1.0.0

echo "🚀 DEPLOY DA LANDING PAGE LEAF"
echo "==============================="
echo ""

# Cores
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# Verificar se está no diretório correto
if [ ! -f "index.html" ]; then
    echo -e "${RED}❌ Erro: Execute este script dentro da pasta landing-page!${NC}"
    exit 1
fi

echo -e "${BLUE}📋 Escolha o método de deploy:${NC}"
echo ""
echo "1) Cloudflare Pages (Recomendado)"
echo "2) Preparar arquivos para upload manual"
echo "3) Criar package para VPS"
echo ""
read -p "Digite a opção (1-3): " option

case $option in
    1)
        echo -e "${GREEN}✅ Cloudflare Pages selecionado${NC}"
        echo ""
        echo "📝 Passos:"
        echo "1. Acesse: https://dash.cloudflare.com/"
        echo "2. Vá em Pages → Create a project"
        echo "3. Conecte seu repositório Git"
        echo "4. Build command: (deixe vazio)"
        echo "5. Build output: /landing-page"
        echo "6. Root directory: /landing-page"
        echo ""
        echo "✨ Pronto! Deploy automático ativado."
        ;;
    2)
        echo -e "${YELLOW}📦 Preparando arquivos para upload manual...${NC}"
        
        # Criar diretório temporário
        TEMP_DIR="../temp-deploy-leaf"
        rm -rf $TEMP_DIR
        mkdir -p $TEMP_DIR
        
        # Copiar arquivos essenciais
        cp index.html $TEMP_DIR/
        cp em-breve.html $TEMP_DIR/
        cp privacy-policy.html $TEMP_DIR/ 2>/dev/null || echo "⚠️  privacy-policy.html não encontrado"
        cp excluir-conta.html $TEMP_DIR/ 2>/dev/null || echo "⚠️  excluir-conta.html não encontrado"
        cp -r assets $TEMP_DIR/
        
        # Criar .gitignore
        cat > $TEMP_DIR/.gitignore << EOF
index-novo.html
index-old.html
*.old
.DS_Store
EOF
        
        echo -e "${GREEN}✅ Arquivos preparados em: $TEMP_DIR${NC}"
        echo ""
        echo "📋 Próximos passos:"
        echo "1. Vá em Cloudflare Pages"
        echo "2. Clique em 'Upload assets'"
        echo "3. Faça upload da pasta $TEMP_DIR"
        echo ""
        
        # Mostrar o que foi copiado
        echo "📂 Arquivos copiados:"
        ls -lah $TEMP_DIR/
        ;;
    3)
        echo -e "${YELLOW}📦 Preparando package para VPS...${NC}"
        
        PACKAGE_NAME="leaf-landing-$(date +%Y%m%d-%H%M%S).tar.gz"
        
        # Criar package
        tar -czf $PACKAGE_NAME *.html assets/
        
        echo -e "${GREEN}✅ Package criado: $PACKAGE_NAME${NC}"
        echo ""
        echo "📋 Próximos passos para VPS:"
        echo "1. Transferir arquivo:"
        echo "   scp $PACKAGE_NAME user@vps:/var/www/"
        echo ""
        echo "2. No VPS, extrair:"
        echo "   cd /var/www/"
        echo "   tar -xzf $PACKAGE_NAME"
        echo ""
        echo "3. Configurar Nginx (ver DEPLOY_CLOUDFLARE.md)"
        ;;
    *)
        echo -e "${RED}❌ Opção inválida!${NC}"
        exit 1
        ;;
esac

echo ""
echo -e "${GREEN}✅ Concluído!${NC}"
echo ""
echo "📖 Para mais detalhes, consulte: DEPLOY_CLOUDFLARE.md"


