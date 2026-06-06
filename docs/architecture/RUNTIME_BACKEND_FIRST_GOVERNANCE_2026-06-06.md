# Runtime Backend-First, Flags e Canary Leaf

Data: 2026-06-06
Branch de execucao: `codex/runtime-config-rollout`

## Objetivo

O app mobile deve receber decisoes operacionais do backend. A build continua contendo defaults conservadores, mas o backend passa a ser a fonte de verdade para:

- perfil de pagamento e Woovi sandbox/producao;
- biometria/KYC strict mode;
- flags de produto;
- politica de Google Maps, Places e Routes;
- push e notificacoes persistidas;
- regras para motorista ficar online;
- superficies de campanha;
- URLs legais;
- politica de suporte.

Esse modelo reduz rebuilds, evita custo acidental de APIs externas no app e permite canary/rollback por backend.

## Contrato principal

### `GET /api/app/runtime-config`

Endpoint publico seguro para o mobile. Pode receber auth opcional, mas sem auth retorna uma configuracao global segura.

Campos obrigatorios:

- `schemaVersion`
- `environment`
- `generatedAt`
- `cacheTtlSeconds`
- `staleTtlSeconds`
- `paymentRuntime`
- `biometricRuntime`
- `featureGates`
- `mapsRoutingPolicy`
- `notificationPolicy`
- `driverOnlinePolicy`
- `campaignSurfaces`
- `legalUrls`
- `supportPolicy`

Regras:

- nao expor secrets, chaves Google, Woovi, Firebase ou credenciais;
- nao chamar Google, Woovi ou Firebase client-side a partir do dashboard/browser;
- pagamento, KYC e safety falham fechados;
- campanhas e UI podem falhar silenciosamente;
- mapas continuam backend/cache only em producao.

### `GET /api/drivers/me/online-policy`

Endpoint autenticado para consultar se o motorista pode ficar online.

### `POST /api/drivers/me/online-intent`

Endpoint autenticado para tentativa real de ficar online. O backend decide com base em:

- documentos;
- veiculo;
- KYC/liveness/face compare;
- bloqueios;
- cidade/geofence;
- versao minima;
- corrida ativa;
- risco/safety;
- pendencias.

O app nunca deve disparar validacao facial durante corrida em andamento.

## Precedencia no mobile

O `RuntimeConfigService` usa a seguinte ordem:

1. runtime config fresca do backend;
2. ultima config valida em cache dentro do stale TTL;
3. defaults de build;
4. default conservador hardcoded.

Defaults conservadores nao contam como override operacional. Isso evita que fallback local sobrescreva o perfil de lancamento quando o backend estiver indisponivel.

## Dashboard operacional

Pagina: `/runtime-flags`

Funcoes:

- ver config efetiva por dominio;
- ver overrides ativos e pausados;
- publicar override com escopo, expiração, prioridade e motivo;
- pausar override;
- rollback para pausar override ativo;
- exibir payload tecnico.

Dominios permitidos para override:

- `featureGates`
- `mapsRoutingPolicy`
- `notificationPolicy`
- `driverOnlinePolicy`
- `campaignSurfaces`
- `legalUrls`
- `supportPolicy`
- `biometricRuntime`

`paymentRuntime` nao usa override generico. Pagamento continua controlado pelo painel de perfil de pagamento.

## Pode subir via OTA/Expo Update

Normalmente pode OTA:

- copy e textos;
- UI JS;
- bugfix JS sem dependencia nativa;
- flags e politicas vindas do backend;
- campanhas;
- ajustes de card/tela sem modulo nativo novo;
- logica de consumo de runtime config ja embarcada;
- ajustes de dashboard/backend independentes da build.

Antes de OTA:

1. rodar smoke local;
2. validar iOS e Android em debug quando tocar UI;
3. conferir `runtimeVersion`;
4. validar que nao ha permissao/plugin/SDK nativo novo;
5. registrar rollback esperado.

## Exige nova build

Exige build nova:

- permissao nativa;
- bundle/package ID;
- `GoogleService-Info.plist` ou `google-services.json`;
- plugin Expo;
- native module novo ou alterado;
- splash/icon;
- associated domains/universal links/app links nativos;
- push native/categorias nativas que dependam de manifest;
- maps native/config nativa;
- incompatibilidade de `runtimeVersion`.

## Canary checklist

Antes de canary real:

- `/health` ok;
- socket publico conecta;
- `/api/app/runtime-config` responde sem secrets;
- `/api/admin/runtime-config` protegido por RBAC;
- Woovi sandbox/producao resolvido pelo backend;
- `qa:production-guards` passa;
- dashboard `/runtime-flags`, `/dashboard`, `/support`, `/campaign-center`, `/drivers/review-queue` e `/financial-reconciliation` abrem;
- passageiro: boot, destino, categoria, Pix sandbox e corrida mock;
- motorista: boot hidratado, online intent, KYC quando necessario e corrida mock;
- push: FCM token, push simples e notificacao persistida;
- mapas: app nao chama Google direto em producao;
- custo: dashboard nao chama provedores pagos do browser.

## Rollback

Rollback preferencial:

1. pausar override em `/runtime-flags`;
2. voltar perfil de pagamento em `/payment-runtime`;
3. desabilitar feature gate no backend;
4. usar OTA somente se o bug estiver em JS/UI;
5. nova build apenas se houver regressao nativa.

Flags criticas sempre exigem motivo operacional no dashboard e auditoria no backend.

## Evidencias da implementacao

Validações executadas nesta rodada:

- backend runtime config unit tests;
- mobile runtime config, runtime access policy, pilot launch profile e driver online policy tests;
- notificacao persistida respeitando notification policy;
- dashboard lint/build com rota `/runtime-flags`;
- production guards reforcados para fallback Google depender do backend.

