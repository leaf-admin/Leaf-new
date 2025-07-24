# Estratégia Híbrida Firebase → Redis → Firestore

Este projeto implementa uma estratégia híbrida otimizada que utiliza:
- **Redis** para dados em tempo real (localização, status ativo)
- **Firebase Realtime Database** como fallback
- **Firestore** para persistência e histórico (após finalização)

## 🚀 Configuração Rápida

### 1. Pré-requisitos
- Docker Desktop instalado e rodando
- Node.js 14+ instalado
- Dependências do projeto instaladas (`npm install`)

### 2. Iniciar Redis com Docker

**Opção A: Script Automático (Recomendado)**
```bash
# Windows
start-redis.bat

# Linux/Mac
./start-redis.sh
```

**Opção B: Comando Manual**
```bash
docker run -d --name redis-taxi-app -p 6379:6379 --restart unless-stopped redis:7-alpine
```

### 3. Testar Configuração
```bash
node test-redis.js
```

## 📁 Estrutura dos Arquivos

```
common/src/
├── config/
│   └── redisConfig.js              # Configuração principal
├── services/
│   ├── redisLocationService.js     # Serviço de localização (Redis)
│   ├── redisTrackingService.js     # Serviço de tracking (Redis)
│   └── firestorePersistenceService.js # Serviço de persistência (Firestore)
└── actions/
    └── locationactions.js          # Actions integradas

mobile-app/src/
├── hooks/
│   ├── useLocationWithRedis.js     # Hook para localização
│   ├── useTripTracking.js          # Hook para tracking
│   └── useTripHistory.js           # Hook para histórico (Firestore)
└── components/
    └── RedisLocationDemo.js        # Componente de demonstração

Arquivos de Configuração:
├── redis-config.env                # Variáveis de ambiente
├── start-redis.bat                 # Script para iniciar Redis
├── test-hybrid-strategy.cjs        # Testes da estratégia híbrida
└── REDIS-MIGRATION-README.md       # Esta documentação
```

## ⚙️ Configuração

### Feature Flags

Configure as variáveis de ambiente no arquivo `redis-config.env`:

```env
# Estratégia Híbrida Otimizada
ENABLE_REDIS=true
REDIS_PRIMARY=true           # Redis como fonte primária
FIREBASE_FALLBACK=true       # Firebase RT como fallback
FIRESTORE_PERSISTENCE=true   # Firestore para persistência
DUAL_WRITE=false             # Não duplicar dados
AUTO_MIGRATE=true            # Migrar automaticamente para Firestore
USE_GEO_COMMANDS=true        # Comandos GEO do Redis
```

### Estratégias de Migração

1. **Estratégia Híbrida (Recomendado)**
   - `REDIS_PRIMARY=true`, `FIREBASE_FALLBACK=true`, `FIRESTORE_PERSISTENCE=true`
   - Redis para tempo real, Firebase RT como fallback, Firestore para persistência
   - Performance otimizada com confiabilidade

2. **Redis Primário com Fallback**
   - `REDIS_PRIMARY=true`, `FIREBASE_FALLBACK=true`, `FIRESTORE_PERSISTENCE=false`
   - Usa Redis como primário, Firebase RT como backup

3. **Firebase Only (Legado)**
   - `ENABLE_REDIS=false`
   - Volta ao comportamento original

4. **Migração Gradual**
   - `DUAL_WRITE=true` (temporariamente)
   - Escreve em ambos durante transição

## 🔧 Serviços Implementados

### RedisLocationService

**Funcionalidades:**
- ✅ Atualizar localização do usuário
- ✅ Obter localização do usuário
- ✅ Buscar usuários próximos (com fallback para versões sem GEO)
- ✅ Remover localização do usuário
- ✅ Estatísticas do serviço
- ✅ Limpeza automática de dados expirados

**Comandos GEO:**
- `GEOADD` - Adicionar localização
- `GEORADIUS` - Buscar usuários próximos
- `GEOREM` - Remover localização

**Fallback (sem GEO):**
- Usa `HASH` para armazenar localizações
- Calcula distâncias com fórmula de Haversine
- Busca sequencial com filtro por distância

### RedisTrackingService

**Funcionalidades:**
- ✅ Iniciar tracking de viagem
- ✅ Atualizar localização durante viagem
- ✅ Obter dados da viagem
- ✅ Obter histórico de localizações
- ✅ Finalizar/cancelar tracking
- ✅ Buscar viagens por motorista/passageiro
- ✅ Estatísticas de viagens
- ✅ Limpeza automática

**Estrutura de Dados:**
- `trip:{tripId}` - Dados principais da viagem (HASH)
- `trip_path:{tripId}` - Histórico de localizações (LIST)
- `active_trips` - Viagens ativas (SET)
- `completed_trips` - Viagens finalizadas (SET)
- `cancelled_trips` - Viagens canceladas (SET)

## 🧪 Testes

### Executar Testes Completos
```bash
node test-redis.js
```

### Testes Incluídos:
1. **Inicialização do Redis**
2. **Serviço de Localização**
   - Atualizar localização
   - Obter localização
   - Buscar usuários próximos
   - Estatísticas

3. **Serviço de Tracking**
   - Iniciar tracking
   - Atualizar localização
   - Obter dados da viagem
   - Finalizar tracking
   - Estatísticas

4. **Comandos GEO**
   - Teste de GEOADD
   - Teste de GEORADIUS

5. **Limpeza**
   - Limpeza automática de dados expirados

## 📊 Monitoramento

### Verificar Status do Redis
```bash
# Verificar se Redis está rodando
docker ps | grep redis-taxi-app

# Conectar ao Redis CLI
docker exec -it redis-taxi-app redis-cli

# Verificar estatísticas
docker exec redis-taxi-app redis-cli info
```

### Logs do Redis
```bash
# Ver logs do container
docker logs redis-taxi-app

# Ver logs em tempo real
docker logs -f redis-taxi-app
```

## 🔄 Comandos Úteis

### Gerenciar Container Redis
```bash
# Parar Redis
docker stop redis-taxi-app

# Iniciar Redis
docker start redis-taxi-app

# Reiniciar Redis
docker restart redis-taxi-app

# Remover Redis
docker rm -f redis-taxi-app

# Ver logs
docker logs redis-taxi-app
```

### Testar Conexão
```bash
# Teste básico
docker exec redis-taxi-app redis-cli ping

# Teste de comandos GEO
docker exec redis-taxi-app redis-cli GEOADD test 13.361389 38.115556 "Palermo"

# Limpar teste
docker exec redis-taxi-app redis-cli DEL test
```

## 🚨 Troubleshooting

### Problemas Comuns

**1. Docker não está rodando**
```
ERRO: Docker nao esta rodando!
```
**Solução:** Inicie o Docker Desktop

**2. Porta 6379 já em uso**
```
Error response from daemon: Ports are not available
```
**Solução:** 
```bash
# Parar Redis local se estiver rodando
netstat -ano | findstr :6379
taskkill /PID <PID> /F

# Ou usar porta diferente
docker run -d --name redis-taxi-app -p 6380:6379 redis:7-alpine
```

**3. Comandos GEO não disponíveis**
```
⚠️ Comandos GEO não disponíveis
```
**Solução:** 
- Use Docker com Redis 6.2+ (recomendado)
- O sistema funciona com fallback automático

**4. Erro de conexão Redis**
```
❌ Redis retry time exhausted
```
**Solução:**
- Verificar se Redis está rodando: `docker ps`
- Verificar logs: `docker logs redis-taxi-app`
- Reiniciar container: `docker restart redis-taxi-app`

### Logs de Debug

Para habilitar logs detalhados, adicione ao `redis-config.env`:
```env
DEBUG=true
```

## 📈 Performance

### Vantagens do Redis vs Firebase

**Redis:**
- ✅ Latência ultra-baixa (< 1ms)
- ✅ Comandos GEO nativos
- ✅ Melhor para dados temporários
- ✅ Custo menor para alta frequência

**Firebase:**
- ✅ Persistência automática
- ✅ Sincronização em tempo real
- ✅ Backup automático
- ✅ Escalabilidade global

### Métricas Esperadas

- **Latência de escrita:** < 1ms (Redis) vs 50-200ms (Firebase)
- **Busca por proximidade:** < 5ms (Redis GEO) vs 100-500ms (Firebase)
- **Throughput:** 100k+ ops/sec (Redis) vs 1k-10k ops/sec (Firebase)

## 🔐 Segurança

### Configurações Recomendadas

```env
# Produção
REDIS_PASSWORD=senha_forte_aqui
REDIS_HOST=redis.internal
REDIS_PORT=6379

# Desenvolvimento
REDIS_PASSWORD=
REDIS_HOST=localhost
REDIS_PORT=6379
```

### Firewall
- Bloquear porta 6379 externamente
- Usar rede interna para comunicação
- Configurar autenticação Redis

## 📝 Próximos Passos

1. **Testar em ambiente de desenvolvimento**
2. **Configurar monitoramento**
3. **Implementar backup automático**
4. **Migrar gradualmente em produção**
5. **Otimizar configurações de performance**

## 🤝 Suporte

Para dúvidas ou problemas:
1. Verificar logs do Redis
2. Executar testes: `node test-redis.js`
3. Verificar configurações no `redis-config.env`
4. Consultar esta documentação

---

**Última atualização:** Dezembro 2024
**Versão:** 1.0.0 