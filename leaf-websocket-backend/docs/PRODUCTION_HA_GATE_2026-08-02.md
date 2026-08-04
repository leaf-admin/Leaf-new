# Gate de alta disponibilidade para lançamento amplo

## Objetivo

Impedir que `LEAF_BROAD_LAUNCH_APPROVED=true` libere o gateway de produção
enquanto Redis ou borda ainda forem pontos únicos de falha.

O gate não altera piloto controlado, `geofence_validation`,
`ride_flow_validation`, regra comercial, API ou experiência do aplicativo.

O lançamento amplo também depende do gate de recuperação descrito em
`FIRESTORE_STORAGE_RECOVERY_RUNBOOK_2026-08-02.md`. Ele exige recibos recentes e
íntegros dos restores isolados de Redis e Firestore antes do rolling deploy.

## Contrato exigido

Para um gateway de produção em lançamento amplo, `config:validate` exige:

1. Redis em `REDIS_MODE=sentinel`, com no mínimo três Sentinels distintos,
   credenciais válidas para produção e ao menos três domínios de falha distintos.
2. Drill de failover do Redis identificado e executado nos últimos 30 dias.
3. Borda em `managed_load_balancer` ou `self_managed_failover`, distribuída em ao
   menos dois domínios de falha distintos.
4. Drill de failover da borda identificado e executado nos últimos 30 dias.

Gateways e workers isolados de `trip-location`, `pricing-baseline` e
`ride-health-monitor` recebem o mesmo conjunto explícito de descoberta,
autenticação e TLS do Sentinel. Os workers não importam o `.env` inteiro, para
evitar ampliar o alcance de segredos não relacionados. Em modo `standalone`, os
valores atuais de `REDIS_HOST`/`REDIS_URL` continuam sendo usados sem mudança de
comportamento.

As variáveis e exemplos ficam em `config/redis-sentinel.env.example`.

## Limite da comprovação

O validador comprova consistência do contrato e atualidade da evidência; ele não
consulta Contabo, Cloudflare ou outro provedor. Os identificadores devem apontar
para logs imutáveis do drill e os domínios declarados devem corresponder à
topologia efetivamente provisionada. Declarar valores fictícios não constitui
evidência operacional.

## Procedimento de liberação

1. Provisionar Redis e borda nos domínios independentes aprovados.
2. Executar failover do Redis e confirmar leitura do valor previamente
   reconhecido e escrita após promoção.
3. Derrubar uma instância de borda e confirmar reconexão Socket.IO e saúde HTTP
   pelo endpoint público.
4. Registrar IDs e horários UTC das duas execuções no ambiente de produção.
5. Executar `npm run config:validate` antes de iniciar ou promover o gateway.

## Rollback

Em falha real ou evidência vencida, remover a aprovação de lançamento amplo e
retornar a um perfil controlado. Não desabilitar o gate e não manter aprovação
ampla com uma topologia degradada.
