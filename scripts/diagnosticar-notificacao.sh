#!/bin/bash

# 🔍 Script de Diagnóstico: Por que motorista não recebe notificação?

echo "=== 🔍 DIAGNÓSTICO DE NOTIFICAÇÃO DE CORRIDA ==="
echo ""

# Cores
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# Solicitar IDs
echo -e "${BLUE}Digite o ID do motorista (ex: test_driver_xxx ou test-user-dev-xxx):${NC}"
read DRIVER_ID

echo -e "${BLUE}Digite o ID da corrida (ex: booking_xxx) ou pressione Enter para pular:${NC}"
read BOOKING_ID

echo ""
echo "=== VERIFICAÇÃO DO MOTORISTA ==="
echo ""

# 1. Motorista no GEO
echo -n "1. Motorista no GEO driver_locations: "
if redis-cli ZRANGE driver_locations 0 -1 2>/dev/null | grep -q "$DRIVER_ID"; then
    echo -e "${GREEN}✅ SIM${NC}"
else
    echo -e "${RED}❌ NÃO${NC}"
    echo -e "${YELLOW}   → Problema: Motorista não está no GEO. Localização não está sendo salva.${NC}"
fi

# 2. Hash do motorista
echo ""
echo "2. Hash driver:$DRIVER_ID:"
HASH_DATA=$(redis-cli HGETALL "driver:$DRIVER_ID" 2>/dev/null)
if [ -z "$HASH_DATA" ] || [ "$HASH_DATA" = "" ]; then
    echo -e "${RED}❌ Hash não existe ou está vazio${NC}"
    echo -e "${YELLOW}   → Problema: saveDriverLocation não está salvando o hash.${NC}"
else
    echo -e "${GREEN}✅ Hash existe${NC}"
    echo "$HASH_DATA" | head -15
    
    # Verificar campos críticos
    IS_ONLINE=$(redis-cli HGET "driver:$DRIVER_ID" isOnline 2>/dev/null)
    STATUS=$(redis-cli HGET "driver:$DRIVER_ID" status 2>/dev/null)
    
    echo ""
    echo -n "   isOnline: "
    if [ "$IS_ONLINE" = "true" ]; then
        echo -e "${GREEN}✅ $IS_ONLINE${NC}"
    else
        echo -e "${RED}❌ $IS_ONLINE (deve ser 'true')${NC}"
        echo -e "${YELLOW}   → Problema: Motorista não está marcado como online.${NC}"
    fi
    
    echo -n "   status: "
    if [ "$STATUS" = "AVAILABLE" ]; then
        echo -e "${GREEN}✅ $STATUS${NC}"
    else
        echo -e "${RED}❌ $STATUS (deve ser 'AVAILABLE')${NC}"
        echo -e "${YELLOW}   → Problema: Status incorreto. Motorista não está disponível.${NC}"
    fi
fi

# 3. TTL
echo ""
echo -n "3. TTL do hash: "
TTL=$(redis-cli TTL "driver:$DRIVER_ID" 2>/dev/null)
if [ "$TTL" -gt 0 ]; then
    echo -e "${GREEN}✅ $TTL segundos${NC}"
elif [ "$TTL" -eq -2 ]; then
    echo -e "${RED}❌ Hash não existe${NC}"
elif [ "$TTL" -eq -1 ]; then
    echo -e "${YELLOW}⚠️  Sem TTL (problema)${NC}"
fi

# 4. Posição GEO
echo ""
echo -n "4. Posição GEO: "
GEO_POS=$(redis-cli GEOPOS "driver_locations" "$DRIVER_ID" 2>/dev/null)
if [ -z "$GEO_POS" ] || [ "$GEO_POS" = "(nil)" ]; then
    echo -e "${RED}❌ Não encontrada${NC}"
else
    echo -e "${GREEN}✅ $GEO_POS${NC}"
fi

# Verificar corrida se fornecida
if [ -n "$BOOKING_ID" ]; then
    echo ""
    echo "=== VERIFICAÇÃO DA CORRIDA ==="
    echo ""
    
    # 5. Corrida criada
    echo -n "5. Corrida booking:$BOOKING_ID existe: "
    if redis-cli EXISTS "booking:$BOOKING_ID" 2>/dev/null | grep -q "1"; then
        echo -e "${GREEN}✅ SIM${NC}"
    else
        echo -e "${RED}❌ NÃO${NC}"
        echo -e "${YELLOW}   → Problema: Corrida não foi criada.${NC}"
    fi
    
    # 6. Corrida na fila
    echo ""
    echo -n "6. Corrida na fila: "
    REGION=$(redis-cli HGET "booking:$BOOKING_ID" region 2>/dev/null)
    if [ -n "$REGION" ]; then
        echo "Região: $REGION"
        if redis-cli ZRANGE "ride_queue:$REGION:pending" 0 -1 2>/dev/null | grep -q "$BOOKING_ID"; then
            echo -e "${GREEN}   ✅ SIM${NC}"
        else
            echo -e "${RED}   ❌ NÃO${NC}"
            echo -e "${YELLOW}   → Problema: Corrida não está na fila.${NC}"
        fi
    else
        echo -e "${YELLOW}⚠️  Região não encontrada${NC}"
    fi
    
    # 7. Motoristas notificados
    echo ""
    echo "7. Motoristas notificados para esta corrida:"
    NOTIFIED=$(redis-cli SMEMBERS "ride_notifications:$BOOKING_ID" 2>/dev/null)
    if [ -z "$NOTIFIED" ]; then
        echo -e "${YELLOW}   ⚠️  Nenhum motorista notificado${NC}"
    else
        echo "$NOTIFIED" | while read driver; do
            if [ "$driver" = "$DRIVER_ID" ]; then
                echo -e "${GREEN}   ✅ $driver (ESTE MOTORISTA)${NC}"
            else
                echo "   - $driver"
            fi
        done
    fi
fi

# Verificar locks
echo ""
echo "=== VERIFICAÇÃO DE LOCKS ==="
echo ""
echo -n "8. Motorista tem lock ativo: "
LOCK=$(redis-cli GET "driver_lock:$DRIVER_ID" 2>/dev/null)
if [ -z "$LOCK" ] || [ "$LOCK" = "(nil)" ]; then
    echo -e "${GREEN}✅ NÃO${NC}"
else
    echo -e "${RED}❌ SIM${NC}"
    echo -e "${YELLOW}   → Problema: Motorista está bloqueado. Lock: $LOCK${NC}"
fi

# Resumo
echo ""
echo "=== 📊 RESUMO ==="
echo ""

PROBLEMAS=0

if ! redis-cli ZRANGE driver_locations 0 -1 2>/dev/null | grep -q "$DRIVER_ID"; then
    echo -e "${RED}❌ Motorista não está no GEO${NC}"
    PROBLEMAS=$((PROBLEMAS + 1))
fi

HASH_DATA=$(redis-cli HGETALL "driver:$DRIVER_ID" 2>/dev/null)
if [ -z "$HASH_DATA" ] || [ "$HASH_DATA" = "" ]; then
    echo -e "${RED}❌ Hash do motorista está vazio${NC}"
    PROBLEMAS=$((PROBLEMAS + 1))
fi

IS_ONLINE=$(redis-cli HGET "driver:$DRIVER_ID" isOnline 2>/dev/null)
if [ "$IS_ONLINE" != "true" ]; then
    echo -e "${RED}❌ Motorista não está online (isOnline: $IS_ONLINE)${NC}"
    PROBLEMAS=$((PROBLEMAS + 1))
fi

STATUS=$(redis-cli HGET "driver:$DRIVER_ID" status 2>/dev/null)
if [ "$STATUS" != "AVAILABLE" ]; then
    echo -e "${RED}❌ Status incorreto (status: $STATUS)${NC}"
    PROBLEMAS=$((PROBLEMAS + 1))
fi

if [ -n "$LOCK" ] && [ "$LOCK" != "(nil)" ]; then
    echo -e "${RED}❌ Motorista tem lock ativo${NC}"
    PROBLEMAS=$((PROBLEMAS + 1))
fi

echo ""
if [ $PROBLEMAS -eq 0 ]; then
    echo -e "${GREEN}✅ Nenhum problema encontrado no Redis!${NC}"
    echo ""
    echo "Próximos passos:"
    echo "1. Verificar logs do servidor durante criação de corrida"
    echo "2. Verificar se QueueWorker está processando"
    echo "3. Verificar se DriverNotificationDispatcher está sendo chamado"
    echo "4. Verificar se motorista está autenticado e no room correto"
else
    echo -e "${RED}❌ $PROBLEMAS problema(s) encontrado(s)${NC}"
    echo ""
    echo "Correções necessárias:"
    echo "1. Garantir que motorista está enviando localização"
    echo "2. Garantir que saveDriverLocation está salvando hash"
    echo "3. Garantir que isOnline: 'true' e status: 'AVAILABLE'"
    echo "4. Limpar lock se necessário"
fi

echo ""
echo "=== 📋 COMANDOS ÚTEIS ==="
echo ""
echo "Ver logs do servidor:"
echo "  pm2 logs server | grep -E '(Dispatcher|QueueWorker|createBooking|newRideRequest|$DRIVER_ID)'"
echo ""
echo "Verificar autenticação:"
echo "  pm2 logs server | grep -E '(authenticate|$DRIVER_ID)'"
echo ""
echo "Limpar lock (se necessário):"
echo "  redis-cli DEL driver_lock:$DRIVER_ID"
echo ""
echo "Limpar notificações (se necessário):"
if [ -n "$BOOKING_ID" ]; then
    echo "  redis-cli DEL ride_notifications:$BOOKING_ID"
fi


