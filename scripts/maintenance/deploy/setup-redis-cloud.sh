#!/bin/bash

echo "🚀 SETUP REDIS CLOUD - LEAF APP"
echo "================================="

# Verificar se as variáveis estão definidas
if [ -z "$REDIS_HOST" ] || [ -z "$REDIS_PASSWORD" ]; then
    echo "❌ Variáveis de ambiente não configuradas!"
    echo ""
    echo "📋 Configure as seguintes variáveis:"
    echo "export REDIS_HOST=seu_host_redis"
    echo "export REDIS_PORT=443"
    echo "export REDIS_PASSWORD=sua_senha_redis"
    echo "export REDIS_TLS=true"
    echo ""
    echo "🔗 Obtenha as credenciais em:"
    echo "   - Upstash: https://upstash.com/"
    echo "   - Redis Cloud: https://redis.com/try-free/"
    echo ""
    exit 1
fi

echo "✅ Variáveis de ambiente configuradas!"
echo "📍 Host: $REDIS_HOST"
echo "🔌 Porta: $REDIS_PORT"
echo "🔐 TLS: $REDIS_TLS"

# Testar conexão
echo ""
echo "🧪 Testando conexão com Redis Cloud..."
cd ..

# Deploy das functions
echo ""
echo "🚀 Fazendo deploy das functions..."
firebase deploy --only functions:get_redis_stats,functions:health,functions:update_user_location,functions:get_user_location,functions:get_nearby_drivers,functions:start_trip_tracking,functions:update_trip_location,functions:end_trip_tracking,functions:get_trip_data

# Testar APIs
echo ""
echo "🧪 Testando APIs Redis..."
cd mobile-app
node test-redis-apis-final.cjs

echo ""
echo "✅ Setup concluído!"
echo "🎉 APIs Redis devem estar funcionando agora!" 