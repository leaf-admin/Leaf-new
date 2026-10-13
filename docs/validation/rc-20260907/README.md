# Preparação do piloto — fotografia corrigida de 09/09/2026

## Objetivo

Consolidar uma versão candidata verificável e fechar os gates até um piloto pago
controlado. Esta rodada cobre revisão e QA local, com o estado de staging
confirmado pelo responsável. **Na fotografia de 09/09, o único gate aberto para
o piloto controlado era o E3 bilateral.** A abertura ampla continua condicionada
às métricas e à decisão pós-piloto. Esta sessão não fez deploy, cobrança, chamada a
provider de pagamento, mutação de conta, alteração de política ou submissão a
loja.

O plano executável consolidado desta fotografia está em
[GO_LIVE_TODO_20260909.md](GO_LIVE_TODO_20260909.md). Ele é a fonte de trabalho
para separar preparação já aceita em staging da evidência operacional ainda
necessária no E3, sem converter `SKIP`, mock ou `NOT_RUN` em evidência de
produção.

## Atualização pós-E3 — 12/09/2026

O E3 bilateral foi executado e passou: motorista e passageiro autenticados,
geofence válida, Pix Woovi sandbox, aceite, chegada, embarque, navegação,
conclusão, settlement, recibo e avaliações no mesmo `rideId`. A reconciliação
fechou 14/14 checks e está documentada em
[`E3_RUN_20260912.md`](E3_RUN_20260912.md). O piloto controlado está pronto para
decisão operacional. Abertura de produção ampla ainda exige chave CPF dedicada,
publicação do serviço contextualizado no dashboard, confirmação do device físico
se exigida pelo runbook e gates pós-piloto de métricas/HA.
O quadro executável está em
[`PRODUCTION_GATES_STATUS_20260912.md`](PRODUCTION_GATES_STATUS_20260912.md).

## Estado corrigido em 09/09

O responsável confirmou que staging, infraestrutura, lojas, legal, sign-offs e
configuração do piloto estão prontos. Na fotografia de 09/09, o piloto
controlado era o próprio E3 bilateral e B07 era o único bloqueio funcional. A baseline
Expo 54/React Native 0.81 continua válida para este estágio. A migração
Expo/Metro e a resolução das 18 vulnerabilidades restantes são hardening
pós-piloto ou exceção formal para abertura ampla, não pré-condição do E3.

O relatório local de prelaunch que registra NO-GO continua arquivado como
histórico da sondagem deste worktree; ele não rebaixa o staging já preparado.

## Verificação interna de 09/09

Na fotografia de 09/09 não havia no repositório um pacote de E3 bilateral aceito. Os artefatos
existentes comprovam E2 por papel, autenticação Firebase, canary Woovi isolado e
preflights; não comprovam uma mesma corrida com passageiro, motorista, Socket.IO,
Pix, ledger, recibo e dashboard.

O documento [`UX_STATE_REBRAND_TODO.md`](../UX_STATE_REBRAND_TODO.md) registra o
último estado operacional detalhado de 03/09 e deve ser lido como histórico para
os bloqueios de device/geofence/KYC daquela rodada. A confirmação de staging de
09/09 atualiza a prontidão do ambiente, mas não substitui a evidência integrada
que o E3 precisa produzir.

O prelaunch automático de 09/09 rodou em modo `audit`: falhou ao resolver os
domínios públicos e pulou as corridas manuais. Isso explica o NO-GO daquele
relatório, sem provar que o staging informado está indisponível e sem constituir
um E3.

## Entrada e rastreabilidade

- Branch: `codex/uiux-integration-validation`.
- HEAD: `c5cf21fd4` (SHA completo em `review-inputs.json`).
- 19 commits à frente da `main` local, sem atualização remota nesta rodada.
- 138 entradas pendentes individualizadas no inventário desta fotografia; o
  inventário com SHA-256 permanece em `review-inputs.json`.
- O inventário é uma fotografia de revisão, **não um manifesto de release**.
- Alterações anteriores do usuário foram preservadas, sem stage, commit ou reset.

## Validação concluída

| Check | Resultado e limite |
| --- | --- |
| Mobile unitário | 157 suítes / 1.299 testes PASS, repetidos após as correções desta rodada |
| Backend unitário | 273 suítes / 2.310 testes PASS após os patches de segurança e o fechamento do fallback de dispatch |
| Dashboard contratos, lint e build | PASS nesta rodada com Next 16.3.4; 28 páginas estáticas geradas |
| Dashboard smoke | PASS nesta rodada, com APIs simuladas e bloqueio de providers pagos; não é evidência de sessão administrativa real |
| Governança e entrypoints dos scripts | PASS nesta rodada |
| Production guards mobile e guards de segredos | PASS, repetidos após as correções |
| Diff whitespace | PASS nesta rodada |
| Host QA local (histórico) | 14 checks OK, 2 alertas e 1 falha na sondagem local; não é o gate do staging confirmado |

Os logs e seus hashes estão em `validation-evidence.json`. A primeira tentativa do
smoke foi bloqueada por `listen EPERM`; apenas o smoke foi repetido com permissão
local ampliada, preservando o build aprovado. A sondagem do host em
`host-readiness.json` registrou limitações de ADB, Maestro, keychain e Metro;
isso é uma fotografia local histórica e não contradiz a confirmação de que o
staging e os builds do piloto estão prontos. Havia aproximadamente 16,9 GiB
disponíveis para um mínimo de 15 GiB. Isto não comprova espaço suficiente para
qualquer build nativo novo.

Não executados na fotografia de 09/09: CI remoto, E3 bilateral, cobrança/saque/refund
observados de ponta a ponta, login administrativo real e a coleta dos artefatos
bilaterais. O responsável confirmou a configuração correspondente no staging;
esta sessão não mutou o ambiente publicado. As rules Firebase foram executadas
nos emuladores com JDK 17 (28 contratos Firestore, 14 RTDB/Storage e 3 restores);
isso é evidência complementar. Aprovação unitária não substitui o E3 real.

## Bloqueios de código reproduzidos

### RC-01 — preservar o corpo assinado no novo webhook Woovi

Prioridade: P1 de código; bloqueia aceite do Pix integrado.

O alias `POST /api/webhooks/woovi`, adicionado em `routes/woovi.js`, usa o handler
canônico, mas `bootstrap/http-middleware.js:3` só captura `rawBody` nos dois
endereços antigos. `getWebhookRawBody` então serializa novamente `req.body`.
Espaços, quebras de linha e outras diferenças de representação alteram os bytes
sobre os quais a assinatura é verificada.

Reprodução local com JSON formatado e HMAC de fixture (nenhum segredo/provider):

| URL | Corpo bruto preservado | Assinatura coincide |
| --- | --- | --- |
| `/api/woovi/webhook` | sim | sim |
| `/api/woovi-webhook` | sim | sim |
| `/api/webhooks/woovi` | não | não |

Correção documentada em `woovi-raw-body-proposed.patch`, **aplicada e validada**: acrescentar
o alias à captura existente. Manter autenticação, algoritmo e idempotência.
Não há mudança de regra financeira ou aumento de chamadas ao provider.

Teste implementado e aprovado: exercitar o callback `verify` efetivamente registrado no parser
JSON com os três caminhos, JSON não compacto, query string e assinatura sobre
os bytes originais; assinatura adulterada deve continuar inválida. Cobrir também
um endpoint comum, que não deve adquirir captura de webhook.

Arquivos alterados: `leaf-websocket-backend/bootstrap/http-middleware.js` e
`leaf-websocket-backend/tests/unit/routes/woovi-webhook-guards.unit.test.js`.
Os quatro novos casos falharam inicialmente por um erro no harness; após ajustar
o harness, somente os dois casos do alias novo falharam. A correção do middleware
fechou 38/38 testes na suíte, incluindo adulteração de assinatura. Rollback: reverter somente esse delta;
manter o alias sem captura não é configuração apta para aceite.

### RC-02 — impedir falso positivo de confirmação no gate financeiro

Prioridade: P1 de QA; bloqueia uso do gate como aceite financeiro.

`mobile-app/scripts/qa/validate-same-ride-reconciliation.cjs:397` trata `success`
genérico como confirmação. Na linha 711, um OR permite que esse booleano prevaleça
sobre um status de cobrança não confirmado.

Reprodução: carregar `buildGoodEvidence` da suíte existente, manter os outros
artefatos sintéticos e `payment.response.success=true`, e variar
`payment.charge.status`. **ACTIVE, PENDING, EXPIRED e FAILED produziram `ok=true`
e nenhuma falha.** São falsos positivos de fixtures, não pagamentos observados.

Correção aplicada: sucesso do transporte/operação não equivale a liquidação.
O validador exige status explícito de confirmação, reconhece
`response.providerConfirmation.status` emitido pelo confirmador sandbox e exige
que todos os status informados sejam de confirmação. Removeu-se `success` genérico
da lista de status pagos; booleanos de sucesso/confirmação sozinhos não bastam.
Evidência insuficiente permanece não aceita (`pix_confirmed=NOT_RUN` quando não há
status); status negativos ou contraditórios falham. Taxas, saldo, política de
estorno e runtime financeiro não foram alterados.

Arquivos alterados: o validador acima e
`mobile-app/__tests__/same-ride-reconciliation-contract.test.js`.
Testes: 15/15 aprovados, incluindo quatro negativos reproduzidos, status genérico
`success`, `success=true` sem confirmação, conflito
entre envelopes, status pago legítimo, artefato do confirmador canônico,
preservação de identidade/namespace e detecção de valores divergentes.
Rollback: reverter o delta de QA, mantendo o gate inabilitado para aceite até
nova correção. A versão corrigida pode validar artefatos legítimos; nenhum artefato
E3 real foi coletado nesta rodada. Antes do fix, os testes novos demonstraram
oito falhas; depois do fix os 15 testes focados passaram.

## Histórico técnico e evidência do E3

### RC-04 — indisponibilidade da transação de CPF

A consulta de perfis legados já traduzia falhas para
`PROFILE_CPF_UNIQUENESS_UNAVAILABLE`/503, mas a transação do índice propagava
o erro interno sem esse contrato. A correção em
`services/cpf-identity-registry-service.js` preserva `CpfIdentityError` (incluindo
colisão 409) e traduz falhas inesperadas da transação para a mesma indisponibilidade
503. Não há nova consulta, retry, mudança de unicidade ou escrita remota.

Foram adicionados quatro testes em
`tests/unit/services/cpf-identity-registry-service.unit.test.js`: transação
indisponível, retry pelo titular, colisão apenas no RTDB e consulta RTDB
indisponível. Antes do fix: 1 falha / 8 aprovados, precisamente na transação.
Depois: 9/9; junto da aprovação/subconta Woovi: 15/15. Logs:
`/tmp/leaf-rc-cpf-outage-red.log` e `/tmp/leaf-rc-cpf-outage-green.log`.
Rollback: reverter somente o try/catch e os quatro testes desta rodada;
preservar o registro de CPF anterior do usuário.

### Perfil para o próximo E3

O helper `current-flow-e2e-debug-env.sh` ainda habilita por padrão o OTP QA
forçado e o fallback customizado. Não usar esses defaults como prova do fluxo
Firebase já validado. Na preparação E3, declarar explicitamente
`EXPO_PUBLIC_ENABLE_QA_OTP_FORCE_FLOW=false`,
`EXPO_PUBLIC_ENABLE_CUSTOM_OTP_FALLBACK=false`, `APP_REVIEW=false`,
`EXPO_PUBLIC_APP_REVIEW=false`, `EXPO_PUBLIC_ENABLE_TEST_USER_TOOLS=false`,
`EXPO_PUBLIC_FORCE_PAYMENT_BYPASS=false` e `EXPO_PUBLIC_BYPASS_PAYMENTS=false`.
O provider financeiro deve ser resolvido pelo backend para a sessão QA antes
da cobrança. Não foi modificado o helper usado por outras baterias isoladas.
O aparelho físico continua sendo pré-condição externa; não iniciar cenários
ou tratar fixtures como substitutas enquanto o par não estiver pronto.

### RC-03 — exclusão do CPF normalizado (continuação de 07/09)

O novo cadastro salva `users.cpfNormalized`, mas a lista
`USER_PII_FIELDS_TO_DELETE` só removia `cpf`. Foi acrescentado `cpfNormalized`
à limpeza existente em `routes/account-routes.js`, com teste de regressão do
endpoint em `tests/unit/routes/account-routes.unit.test.js`.

**Estado: corrigido e validado localmente.** Após o usuário solicitar nova
tentativa, a execução foi autorizada: 31/31 testes da rota de conta e a suíte
completa do backend (271 suítes / 2.267 testes) passaram. Sintaxe, guards de
segredos e `git diff --check` também passaram. A recusa anterior por limite de
uso foi superada na nova tentativa autorizada; não houve exclusão real nem
chamada a provider. Não foi executado red/green anterior ao fix.

Rollback: remover somente a entrada adicionada e
o novo teste; isso reabre a retenção indevida do campo no perfil. Não excluir
o índice `cpf_identity_index`: retenção e reutilização de identidade ainda
dependem de política explícita. Essa pendência impede o aceite integral de CPF.

- O registro de CPF acrescenta consultas a `users` no Firestore e RTDB em
  atualizações de perfil e aprovação. Os índices RTDB rastreados não incluem
  `cpf`/`cpfNormalized`. Revisar custo, índices, perfis legados, atomicidade entre
  reserva do CPF e gravação do perfil e tratamento de exclusão. Não foi feita
  chamada remota para estimar custo nem alterada regra de unicidade.
- A janela temporária KYC tem allowlist, prazo e namespace sandbox; conferir
  autorização histórica e configuração efetivamente implantada antes de incluir
  seu uso em qualquer evidência. Não vale como prova de KYC real.
- A revisão realizada priorizou os caminhos críticos acima. Não é aceite linha
  a linha das 138 entradas nem autorização para consolidar todo o diff cegamente;
  essa revisão e a consolidação do manifesto ficam pós-E3.

## Ordem de execução e critérios de saída

| Gate | Trabalho | Estado | Critério de saída |
| --- | --- | --- | --- |
| 1A | RC-01 e RC-02 | concluído localmente | Correções e testes negativos/positivos PASS; não implantadas |
| 1B | Revisar pendências por Pix, identidade, QA, UI e build | preparado para E3 | Escopo e política claros; a execução observável será registrada no pacote bilateral |
| 1C | Consolidar commits/PRs e CI | pós-E3 | Worktree de release limpo, CI correspondente ao SHA e revisão humana antes de merge |
| 1D | Manifesto RC | pós-E3 | IDs reais dos quatro builds, OTA, política aprovada, CI e rollback |
| 2 | Preparar runtime e par QA | pronto em staging | Metro, dois papéis, motorista elegível, geofence e sandbox confirmados pelo responsável |
| 3 | E3 bilateral sandbox | **único gate aberto** | Cotação → pagamento → oferta → aceite → chegada → início → conclusão → recibo → avaliação pelos apps |
| 4 | Integridade transacional | dentro do E3 | Mesmo rideId entre cotação, Pix, recibo, dashboard e ledger; taxas/pass-through/líquido preservados; retries/duplicatas/estorno/saque observados |
| 5 | Acesso, documentos e KYC | dentro do E3 | Cadastro comum, recuperação, CNH/CRLV, liveness, comparação, revisão e bloqueios governados pelo backend |
| 6 | Exceções e devices | dentro do E3 | Rede, relaunch, eventos atrasados, cancelamento/replacement/extensão, push/chat/suporte em Android e iPhone |
| 7 | Operação e transação real | preparado para E3 | Cohort/região/responsáveis, alertas, pausa segura, restore/rollback e teste monetário conforme autorização operacional |
| 8 | Piloto e expansão | pós-E3 | Métricas, capacidade/HA e aprovação de expansão antes da abertura ampla |

RC-01/RC-02 estão fechados localmente; o E3 deve usar a versão alvo que os
inclui. A localização física fora da região documentada em 03/09 precisa ser
revalidada durante o E3; não contornar geofence para obter PASS.

## Responsabilidades e autorização de implementação

`AGENTS.md` atribui planejamento/revisão/QA ao Codex e implementação ao OpenCode.
O CLI `opencode` não foi encontrado no PATH; o app instalado não respondeu à
tentativa de acesso (timeout). O usuário autorizou explicitamente **“Autorizar
Codex para correções locais”** nesta sessão. As duas correções foram executadas
sob essa autorização. Deploys, providers reais, consoles, alterações de política
e merge permanecem nos gates específicos. Nenhuma solicitação `/oc` foi enviada
nem credencial de executor foi configurada.

Inventário de dispositivos ao final: `adb devices -l` sem aparelhos conectados;
`xcrun simctl list devices booted` sem simuladores ligados. Preparar o Android
físico autorizado e o segundo papel antes de iniciar cenário. Não é falha do app.

## Escopo concluído, arquivos e rollback desta rodada

Concluído: inventário com hashes, QA adicional do dashboard, preflight do host,
dois bloqueios reproduzidos e corrigidos com regressão, e plano de aceite. Além
dos documentos desta pasta, foram alterados os quatro arquivos explicitados em
RC-01 e RC-02. Os testes e o validador mobile já eram arquivos não rastreados do
trabalho anterior; seu conteúdo anterior foi preservado fora do delta focado.

Rollback: reverter somente os hunks de RC-01/RC-02 descritos acima e remover os
documentos desta pasta, se necessário. Não usar reset/checkout amplo nem descartar
os arquivos do usuário listados em `review-inputs.json`. Retirar o fix reabre os
bloqueios de aceite. Credenciais, configuração remota, políticas financeiras/KYC,
legado, dados e versões publicadas permanecem intocados. Nenhum commit, push,
merge ou manifesto RC final foi realizado; a consolidação integral continua pendente.

Validação RC-04 completa: 271 suítes / 2.271 testes backend PASS; guards de
segredos e diff PASS. Evidência em `/tmp/leaf-rc-backend-cpf-outage-final.log`.

## Histórico — continuação de 07/09 (supersedido pela fotografia de 09/09)

Os números e limites desta seção registram a rodada anterior. Para aceite atual,
usar a matriz e as evidências de `GO_LIVE_TODO_20260909.md`.

- Arquitetura: 9 suítes / 157 testes PASS, incluindo entrypoint único e guards
  de rotas sensíveis. A primeira execução parou em `listen EPERM`; o retry
  autorizado passou (`/tmp/leaf-rc-architecture-retry.log`).
- Integração local: 6 suítes / 43 testes PASS. Executada com `ENV_FILE` apontando
  para um arquivo vazio; usa servidor de teste e handlers simulados. Não prova
  lifecycle de produção nem E3. Log: `/tmp/leaf-rc-integration.log`.
- Geofence versionada: 11 pontos e 5 trajetos, zero falhas; polígonos locais,
  sem consulta remota ou alteração da região aprovada.
- `observability:validate` e `firebase:rules:check`: PASS estático. Emuladores
  Firebase, entrega de alertas e rules implantadas não foram validados aqui.
- `config:validate`: PASS com os valores fictícios extraídos do step
  `Validate production runtime guard` do workflow versionado, em processo com
  ambiente isolado e arquivo vazio. Não foram carregadas credenciais locais.
  Avisos de Firebase/Maps ausentes, kernel Redis e consumidor vivo são limites
  esperados dessa prova estática, não aceite do runtime real.
- Nova consulta ADB/CoreSimulator: nenhum aparelho conectado ou simulador
  ligado. Não foi aberto app ou iniciado cenário.

Nenhum código de produto foi alterado nesta continuação; somente README e
`validation-evidence.json` foram atualizados. Não há motivo para repetir as
suítes unitárias completas sem novo delta. Rollback deste bloco: reverter
somente esta seção e os três registros de evidência correspondentes.

Foram solicitadas ao usuário a política aprovada de retenção/reutilização do
índice CPF e a conexão do Android físico. As respostas permanecem pendentes.
Não inferir aprovação de política a partir de uma instrução genérica para
continuar. O release ainda depende da revisão/consolidação do diff anterior,
CI do SHA final, builds identificados e evidência externa dos gates 2–8.


### RC-05 — política aprovada e liberação de CPF após exclusão

O usuário aprovou liberar CPF na exclusão normal e reservar retenção fundamentada
e revisável às exceções. Implementação local e limites documentados em
[CPF_DELETION_POLICY.md](CPF_DELETION_POLICY.md). Busca por UID e remoção
transacional protegem contra apagar vínculo transferido; falhas de limpeza não
são sucesso. Backend: 271 suítes / 2.280 testes PASS. Governança e segurança PASS.
Política deixou de estar aguardando decisão; implementação operacional de
exceções, recuperação de falhas sem Auth e revisão de concorrência permanecem
pendências para aceite integral de identidade. Nenhum deploy ou migração real.


### RC-06 — concorrência, recuperação manual e revisão de CPF

Os três pontos foram implementados localmente e documentados em
[ACCOUNT_LIFECYCLE_RUNBOOK.md](ACCOUNT_LIFECYCLE_RUNBOOK.md). Substitui as pendências
de implementação listadas em RC-05. Evidência, limites, configuração obrigatória,
fila operacional e reversão estão no runbook. A abertura ampla continua
dependendo de chave dedicada autorizada, fundamentos/prazos validados e validação
de integração real. Staging foi confirmado como preparado; nenhuma ação remota
foi executada por esta sessão.

### RC-07 — fechamento local do dispatch e índice executável de go-live

O fallback de `getDriverData()` em
`leaf-websocket-backend/services/driver-notification-dispatcher.js` foi fechado
em modo seguro: perfil ausente no cache operacional retorna `null` e não fabrica
status online/aprovado. A regressão focada passou 21/21 e a suíte backend final
passou 273 suítes / 2.310 testes na execução completa de 12/09.

Após auditoria externa autorizada, `next`/`eslint-config-next` foram atualizados
de `16.3.0` para `16.3.4`, o autocomplete para `2.6.5` e patches compatíveis
foram aplicados para as dependências transitivas corrigíveis. O dashboard passou
novamente contratos, lint, build e smoke com Next 16.3.4 em
`/tmp/leaf-go-live-dashboard-next1634.log`. O audit caiu de 29 para 18
vulnerabilidades, com 0 críticas; Expo/Metro, Express 4/qs e React Navigation
ainda exigem migração coordenada ou decisão de risco. A fotografia completa está
em [DEPENDENCY_AUDIT_20260909.md](DEPENDENCY_AUDIT_20260909.md).

O inventário completo de fechamento está em
[GO_LIVE_TODO_20260909.md](GO_LIVE_TODO_20260909.md), com status, comandos,
evidências, responsáveis externos, critérios GO/NO-GO, riscos e rollback. O
staging estava pronto e o estado do piloto era **READY FOR E3**; a corrida
bilateral foi concluída em 12/09 e está documentada no relatório E3. O worktree
continua sem commit/manifesto, e a abertura ampla permanece condicionada ao
pós-piloto.

### Atualização de 09/09 — reforços adicionais

- O parser URL-encoded passou a usar um limite único de 50 MB, 1.000 parâmetros
  e profundidade 5; o teste de webhook validou a configuração.
- `POST /driver-approval/process-earnings` retorna 410 em produção e exige uma
  flag explícita fora de produção; ganhos devem seguir o settlement canônico.
- Os testes focados desses dois pontos passaram 44/44; a arquitetura passou
  9 suítes / 171 testes, com listener local autorizado.
- A validação local de produção continua limitada pela ausência de
  `CPF_REVIEW_HMAC_KEY`, perfil de lançamento e biometria estrita no shell desta
  sessão; isso não contradiz o staging confirmado pelo responsável. Não foram
  carregados nem exibidos valores de secrets.
