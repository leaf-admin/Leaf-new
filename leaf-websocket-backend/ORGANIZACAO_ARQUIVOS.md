# 📁 Organização de Arquivos - Plano de Execução

## ✅ Arquivos CRÍTICOS (NÃO MOVER - são importados)
- `server.js` - Servidor principal
- `firebase-config.js` - Configuração Firebase (usado em muitos lugares)
- `logger.js` - Logger (usado em muitos lugares)
- `async-queue.js` - Fila assíncrona (usado em alguns lugares)
- `firebase-batch.js` - Batch Firebase (usado em alguns lugares)
- `healthChecker.js` - Health checker (usado em alguns lugares)
- `redis-cluster-pool.js` - Pool Redis cluster (usado em alguns lugares)
- `redis-pool-fixed.js` - Pool Redis fixo (usado em alguns lugares)
- `intelligent-cache.js` - Cache inteligente (usado em alguns lugares)
- `ssl-config.js` - Configuração SSL (pode ser usado)
- `firebase-structure.js` - Estrutura Firebase (pode ser usado)

## 📦 Estrutura de Pastas Criada
- `scripts/tests/` - Scripts de teste
- `scripts/deploy/` - Scripts de deploy
- `scripts/utils/` - Scripts utilitários
- `scripts/maintenance/` - Scripts de manutenção
- `docs/analysis/` - Documentação de análises
- `docs/implementation/` - Documentação de implementação
- `docs/reports/` - Relatórios
- `docs/kyc/` - Documentação KYC
- `config/docker/` - Configurações Docker
- `config/nginx/` - Configurações Nginx
- `config/redis/` - Configurações Redis

## 🔄 Arquivos a Mover

### Scripts de Teste (test-*.js) → `scripts/tests/`
- Todos os arquivos `test-*.js` (146 arquivos)

### Scripts de Deploy (*.sh) → `scripts/deploy/`
- Scripts de deploy e autoscaling

### Documentação (*.md) → `docs/`
- Análises → `docs/analysis/`
- Implementações → `docs/implementation/`
- Relatórios → `docs/reports/`
- KYC → `docs/kyc/`

### Configurações → `config/`
- Docker compose → `config/docker/`
- Nginx → `config/nginx/`

