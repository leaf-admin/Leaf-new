# Deploy modular do backend na Contabo

O backend de produção usa dois arquivos canônicos:

- `docker-compose.production.yml`: Redis, gateway principal, workers e Nginx.
- `docker-compose.gateway-scale.yml`: gateways adicionais, queue worker e limites de escala.
- `docker-compose.ops-workers.yml`: materialização de pricing e monitor de saúde das corridas.

O deploy não executa `docker compose down`, não remove volumes e não reinicia o
Redis. Os gateways são substituídos individualmente, com health check antes de
avançar para o próximo processo.

## Pré-requisitos

- Docker Compose disponível localmente e na VPS.
- Chave SSH local.
- `.env` e `firebase-credentials.json` já provisionados em `/opt/leaf-app`.
- Acesso aos domínios `api.leaf.app.br` e `socket.leaf.app.br`.

## Executar

```bash
cd leaf-websocket-backend

CONFIRM_PRODUCTION_DEPLOY=true \
CONTABO_HOST=<host> \
CONTABO_KEY="$HOME/.ssh/leaf_contabo_20260412_ed25519" \
./scripts/deploy-contabo-docker.sh
```

O wrapper da raiz também pode ser usado:

```bash
CONFIRM_PRODUCTION_DEPLOY=true \
CONTABO_HOST=<host> \
CONTABO_KEY="$HOME/.ssh/leaf_contabo_20260412_ed25519" \
./scripts/deploy-contabo-completo.sh
```

## Ordem do rollout

1. Validação local de compose, config e runtime modular.
2. Snapshot de compose, imagens e código remoto.
3. Sincronização sem `.env`, credenciais, logs, certificados ou volumes.
4. Build dos gateways e workers.
5. Troca de `websocket-gateway-2`, `websocket-gateway-3` e `websocket`.
6. Atualização isolada dos workers.
7. Health local, Nginx e endpoints públicos.

## Rollback

Cada execução cria:

```text
/opt/leaf-app/backups/modular-rollout-YYYYMMDD-HHMMSS
```

O diretório contém os compose anteriores, inventário das imagens e o pacote do
código anterior. Restaure esses arquivos e faça o mesmo rollout gateway a
gateway. Redis e seu volume permanecem intactos durante deploy e rollback.
