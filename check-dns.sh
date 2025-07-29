#!/bin/bash

echo "🔍 Verificando propagação do DNS para dashboard.leaf.app.br..."
echo "⏳ Aguardando propagação do DNS..."

while true; do
    if nslookup dashboard.leaf.app.br >/dev/null 2>&1; then
        echo "✅ DNS propagado! dashboard.leaf.app.br está resolvendo."
        echo "🌐 IP resolvido:"
        nslookup dashboard.leaf.app.br | grep "Address:"
        echo ""
        echo "🚀 Próximos passos:"
        echo "1. Obter certificado SSL: certbot --nginx -d dashboard.leaf.app.br"
        echo "2. Acessar: https://dashboard.leaf.app.br"
        break
    else
        echo "⏳ DNS ainda não propagou... aguardando 30 segundos..."
        sleep 30
    fi
done 