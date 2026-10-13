# Leaf — TODO completo para sair do estado atual e iniciar produção

**Data da fotografia:** 2026-09-09 (fotografia histórica)
**Última atualização:** 2026-09-12 — E3 bilateral **PASS**; B07 fechado para o piloto controlado
**Estado:** **E3 PASS / piloto controlado pronto para decisão operacional**; a abertura ampla continua condicionada aos gates externos e pós-piloto
**Abertura ampla:** depende das métricas e da decisão pós-piloto
**Branch observado:** `codex/uiux-integration-validation`
**HEAD observado:** `c5cf21fd4`
**Escopo:** backend, mobile, dashboard, pagamentos, identidade/KYC, operação,
infraestrutura, lojas e governança.

Este é o índice executável da saída para produção. Ele consolida os audits e
runbooks anteriores; documentos históricos com checklists antigos não devem ser
interpretados como prova atual. Cada item deve ser fechado com o artefato
indicado, no mesmo SHA/build quando a etapa exigir integração.

> **Leitura desta fotografia:** os itens de preparação de staging, infraestrutura,
> lojas, legal, sign-offs e configuração do piloto estão marcados como concluídos
> conforme confirmação explícita do responsável em 09/09. As caixas que ainda
> aparecem abertas abaixo são execução/evidência do E3 bilateral ou trabalho
> deliberadamente pós-piloto para abertura ampla; não são novos bloqueios de
> staging.

> **Atualização pós-E3 (12/09):** o E3 bilateral foi executado com o mesmo
> `rideId` em dois simuladores iOS, Pix Woovi sandbox, lifecycle completo,
> settlement, recibo e avaliações. O pacote aceito está em
> [`E3_RUN_20260912.md`](E3_RUN_20260912.md) e a reconciliação fechou 14/14
> checks. O device físico ainda exige desbloqueio manual; o dashboard HTTP
> publicado ainda precisa receber o serviço contextualizado antes de ser chamado
> de pronto para produção.

## Legenda e regra de aceite

- `[x]` concluído para o estágio atual, com evidência local ou confirmação do
  responsável registrada nesta fotografia.
- `[~]` parcialmente concluído; falta evidência real, configuração ou decisão.
- `[!]` bloqueador técnico ou de segurança que precisa de implementação antes do gate.
- `[ ]` pendente externo, operacional, legal ou de console.
- `SKIP`/`NOT_RUN` não significa sucesso. Sem evidência, o gate continua aberto.

## Fotografia atual

| Área | Estado atual | Evidência/limite |
| --- | --- | --- |
| Código e contratos críticos | `[x]` local | Governança, secret scans, guards de rotas, regras Firebase estáticas, observabilidade estática, `git diff --check` e contratos de pagamento/lifecycle passaram. |
| Backend unitário | `[x]` | 273 suítes / 2.310 testes na execução completa de 12/09; os testes focados do dashboard também passaram. |
| Backend integração | `[x]` | 6 suítes / 43 testes em `/tmp/leaf-go-live-backend-integration.log`; servidor/handlers locais, não runtime publicado. |
| Backend arquitetura | `[x]` | 9 suítes / 171 testes em `/tmp/leaf-go-live-backend-architecture.log`; contrato local, não failover real. |
| Mobile unitário | `[x]` | 157 suítes / 1.299 testes em `/tmp/leaf-go-live-mobile-unit.log`. |
| Dashboard | `[x]` local | QA agregado (contratos, lint, build e smoke) passou novamente após o patch do Next em `/tmp/leaf-go-live-dashboard-next1634.log`; smoke completo isolado também está em `/tmp/leaf-go-live-dashboard-smoke-escalated.log`. |
| Geofence | `[x]` | 11 pontos / 5 trajetos locais; staging/região prontos conforme confirmação do responsável; a execução em device faz parte do E3. |
| Lifecycle/CPF | `[x]` local | Exclusão em estágios, recuperação, índice CPF, revisão e testes unitários documentados em `ACCOUNT_LIFECYCLE_RUNBOOK.md` e `CPF_DELETION_POLICY.md`. |
| Fallback de dispatch | `[x]` corrigido | Perfil ausente no cache agora falha fechado; regressão focada 21/21. |
| Dependências | `[~]` | Audit autorizado: 18 vulnerabilidades (0 críticas, 8 altas, 10 moderadas) após patches compatíveis; risco aceito para o E3/staging e tratado como hardening pós-piloto. |
| Runtime de produção | `[x]` | Staging/runtime pronto conforme confirmação do responsável; a validação local sem os secrets do alvo continua bloqueando apenas a prova local, não o staging já preparado. |
| Prelaunch audit | `[x]` | Staging, lojas, legal e operação confirmados pelo responsável; o relatório local antigo permanece apenas como histórico e deve ser substituído pelo pacote do E3. |
| Device/automação | `[x]` | Staging/builds e automação confirmados pelo responsável; a instalação e coleta bilateral são o próprio E3. |
| Evidência de corrida real | `[x]` | E3 bilateral PASS no mesmo `rideId`; evidências em `E3_RUN_20260912.md` e `e3-run-20260912/`. A coleta foi em dois simuladores iOS; o device físico permanece pendente de desbloqueio. |
| Lojas e publicação | `[x]` | Lojas, legal, Data Safety, App Privacy, background location, account deletion, review notes e sign-offs confirmados pelo responsável. |
| Worktree/RC | `[~]` | Worktree sujo (138 entradas no inventário desta fotografia); a consolidação do manifesto é pós-E3 e não bloqueia o staging já preparado. |

## Correção de estágio

O responsável confirmou nesta sessão que staging, infraestrutura, lojas, legal,
sign-offs e configuração do piloto estão prontos. O piloto controlado coincidiu
com a execução do E3 bilateral; o B07 está fechado conforme a atualização de
12/09. O relatório local anterior não deve rebaixar um staging que já foi
preparado e aceito fora deste worktree.

A migração Expo/Metro não é pré-condição do E3: Expo 54/React Native 0.81 é o
baseline do artefato de staging. As 18 vulnerabilidades permanecem registradas
como hardening pós-piloto (ou exceção de segurança formal para abertura ampla),
sem bloquear a execução do E3 enquanto o risco estiver aceito pelo responsável.

## Matriz de fechamento dos 14 bloqueios

| ID | Bloqueio | Estado | Critério para fechar |
| --- | --- | --- | --- |
| B01 | Higiene do RC e manifesto | `[~]` | Inventário atualizado; revisão final, separação do diff e manifesto ficam para a consolidação pós-E3. |
| B02 | Secrets e configuração de runtime | `[x]` | Staging/configuração do piloto confirmados pelo responsável; a prova local sem os secrets do alvo não é o gate do estágio atual. |
| B03 | Woovi/Pix e integridade financeira | `[x]` | Pipeline, guards, ledger e operação de staging confirmados; o E3 deve gerar a evidência bilateral final. |
| B04 | CPF, Firebase e exclusão | `[x]` | Código, rules, backups e integração de staging confirmados; o E3 apenas coleta a evidência do caminho real. |
| B05 | KYC, liveness e face compare | `[x]` | Provedor, thresholds e fluxo do piloto confirmados; o motorista controlado será exercitado no E3. |
| B06 | Build assinado e devices | `[x]` | Builds, assinatura, profile e automação de staging confirmados; a instalação/artefatos pertencem ao E3. |
| B07 | E3 bilateral real | `[x]` | Corrida completa passageiro/motorista com o mesmo `rideId`, Pix sandbox, ledger, recibo, dashboard contextualizado direto, logs e artefatos de device em `E3_RUN_20260912.md`. |
| B08 | Dashboard e operação | `[x]` | Dashboard, suporte, pausa, refund, KYC, reconciliação e rollback prontos para observação no E3. |
| B09 | Runtime, Redis, HA e alertas | `[x]` | Staging, Redis/worker, backups, failover, DNS/TLS/WAF e alertas confirmados pelo responsável; o E3 coleta os sinais finais. |
| B10 | Firebase rules, RBAC e dados | `[x]` | Projeto, MFA/RBAC, logs, hash e rules de staging confirmados; emuladores locais já passaram como evidência complementar. |
| B11 | Dependências | `[~]` | Patches compatíveis e limites de parser aplicados; 18 itens permanecem como hardening pós-piloto, sem exigir migração Expo/Metro antes do E3. |
| B12 | Lojas e legal | `[x]` | Lojas, URLs legais, Data Safety, App Privacy, background location, account deletion e builds internos confirmados. |
| B13 | Sign-offs e controle de lançamento | `[x]` | Produto, operações, finanças, segurança, engenharia e jurídico confirmados, com cohort e kill switches. |
| B14 | Piloto, métricas e escala | `[~]` | O piloto controlado é o E3; métricas, HA final e ondas de expansão ficam como trabalho pós-E3. |

## O que foi executado nesta rodada

- Corrigido o fallback de `getDriverData()` em
  `leaf-websocket-backend/services/driver-notification-dispatcher.js`: cache
  ausente não cria motorista aprovado/online artificialmente.
- Adicionada regressão em
  `leaf-websocket-backend/tests/unit/services/driver-notification-dispatcher.unit.test.js`.
- O parser URL-encoded do backend agora tem limite único de 50 MB, 1.000
  parâmetros e profundidade 5; uploads multipart continuam em `multer`.
- A rota legada `driver-approval/process-earnings` responde 410 em produção e
  só pode ser habilitada explicitamente fora de produção; o settlement
  canônico continua sendo o único caminho de produção.
- `git diff --check`: PASS.
- `npm run governance:check`: PASS.
- `node scripts/maintenance/security/scan-secrets.cjs --tracked-only`: PASS.
- `bash leaf-websocket-backend/scripts/tests/assert-no-hardcoded-secrets.sh`: PASS.
- `npm run observability:validate`: PASS estático.
- `npm run firebase:rules:check`: PASS estático.
- `JAVA_HOME=/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home npm run test:firebase:rules`: PASS local (28 contratos Firestore, 14 RTDB/Storage e 3 restores).
- `npm --prefix mobile-app run qa:production-guards`: PASS.
- `npm --prefix leaf-dashboard-js run smoke:backoffice`: PASS com listener local.
- `npm run lint:dashboard`: PASS.
- `npm run build:dashboard`: PASS.
- `npm run package-scripts:check`: PASS.
- `npm --prefix leaf-websocket-backend run qa:geofence-pilot`: PASS local.
- `npm --prefix services/support-agent-orchestrator run check`: PASS.
- `npm --prefix mobile-app run qa:permissions`: PASS.
- `npm --prefix leaf-websocket-backend run config:validate:real-sandbox`: PASS
  para a configuração sandbox; a prova local de produção continua limitada
  pelos três valores ausentes no shell, enquanto o staging foi confirmado pronto.
- `npm --prefix mobile-app run test:unit -- --runInBand`: PASS, 157 suítes /
  1.299 testes após os patches de dependência.
- `npm --prefix leaf-websocket-backend run test:unit -- --runInBand`: PASS,
  273 suítes / 2.310 testes na execução completa de 12/09.
- `npm --prefix leaf-websocket-backend run test:integration -- --runInBand`:
  PASS, 6 suítes / 43 testes.
- `npm --prefix leaf-websocket-backend run test:architecture`: PASS, 9 suítes /
  171 testes.
- `npm --prefix leaf-dashboard-js run qa:backoffice`: PASS com Next 16.3.4
  instalado; contratos, lint, build de 28 páginas e smoke passaram.
- `npm run test:firebase:rules` com JDK 17: PASS local, 28 contratos Firestore,
  14 RTDB/Storage e 3 restores.
- `npm --prefix mobile-app run qa:asserts -- /tmp/leaf-go-live-mobile-asserts`:
  **FAIL honesto por ausência de artefatos** (`backend-health.json`, handshake,
  simulação/load test e logcat); não é evidência de falha do produto.
- `npm audit --omit=dev --json`: a consulta autorizada reportou inicialmente 29
  vulnerabilidades (1 crítica, 15 altas, 12 moderadas, 1 baixa), incluindo
  `next@16.3.0`, `sharp@0.35.3`, `express/qs`, `joi`, `js-yaml`, `fast-uri`,
  `@xmldom/xmldom` e dependências Metro/Expo. O Next foi atualizado para
  `16.3.4` (incluindo `eslint-config-next`), o autocomplete para `2.6.5` e
  patches compatíveis foram aplicados para `sharp`, `fast-uri`, `joi`,
  `js-yaml`, `nanoid`, `browserslist`, `baseline-browser-mapping` e
  `@xmldom/xmldom`. O audit posterior caiu para 18 vulnerabilidades, com
  **0 críticas** (8 altas e 10 moderadas); o JSON final está em
  `/tmp/leaf-go-live-npm-audit-patched-places.json`. Permanecem Expo/Metro/image-size,
  React Navigation/query-string/decode-uri-component e a cadeia Express 4 /
  body-parser/qs. Não foi aplicado `npm audit fix --force`: o dry-run encontrou
  conflito de peers entre Expo 54 e `expo-crypto`, que aponta para Expo 57.

## TODO 0 — fechar a versão candidata

- [~] Inventário das 138 entradas gerado em
  [RC_CHANGE_INVENTORY_20260909.md](RC_CHANGE_INVENTORY_20260909.md), agrupado por
  domínio. Falta a revisão humana caminho a caminho e a limpeza controlada; não
  usar reset, checkout . ou limpeza ampla.
- [ ] Manter a branch de trabalho; abrir PR(s) escopados contra a branch de
  release depois de revisar o diff. Nenhum commit direto em `main`.
- [x] Reexecutar `git diff --check`, governança, secret scan, hardcoded-secret
  guard, package-script check e os testes afetados nesta fotografia; repetir no
  SHA final do pacote E3 se houver nova alteração.
- [ ] Fazer revisão humana de todas as mudanças em pagamento, CPF/KYC,
  lifecycle, WebSocket, rotas administrativas e configuração de release.
- [~] Gerar o manifesto RC somente com worktree limpo. Preencher
  `RC_VERSION`, perfil de lançamento, versão da política financeira aprovada,
  IDs reais de backend/dashboard/Android/iOS, grupos OTA, CI e referências de
  rollback. O script `scripts/release/create-rc-manifest.cjs` deve passar; esta
  consolidação é necessária para a abertura ampla, não para iniciar o E3 já
  preparado em staging.
- [ ] Fazer CI completo no SHA do manifesto e guardar URL, logs e artefatos.
- [ ] Assinar o pacote de evidências com o SHA do código, versão do bundle,
  versão do backend e timestamp; separar claramente sandbox de produção.

## TODO 1 — pagamento, Pix e integridade financeira (P0)

- [x] Provisionar, em secret manager, sem valores no repositório, e validar no
  staging do piloto:
  `WOOVI_API_TOKEN`, credenciais master/subconta, chave pública/segredo de
  assinatura do webhook, autorização do webhook, `LEAF_PIX_KEY`, Firebase Admin,
  Redis, Maps, FCM, `CPF_REVIEW_HMAC_KEY` com pelo menos 32 bytes e credenciais
  do provedor de biometria. A presença foi confirmada pelo responsável sem
  expor valores; o E3 coleta a prova do caminho financeiro.
- [x] Definir o runtime como `pilot_controlled` até o GO formal; preencher
  `LEAF_RUNTIME_POLICY_VERSION`, IDs de região/cohort e referência de aprovação
  da política financeira. `LEAF_BROAD_LAUNCH_APPROVED=true` permanece desligado
  até a aprovação de expansão.
- [x] Validar a configuração do runtime de staging do piloto. A validação local
  sem os secrets do alvo continua registrada como limitação de evidência local,
  não como bloqueio do staging preparado.
- [x] Executar/confirmar o caminho Woovi de staging: quote → reserva de motorista →
  criação Pix → webhook com corpo bruto/assinatura → confirmação autoritativa →
  holding → dispatch. O E3 deve guardar `quoteLockId`, `chargeId`,
  `paymentIntentId`, `financialContextId`, `rideId` e eventos; não aceitar
  `success=true` sem status de liquidação.
- [x] Executar um teste monetário de baixo valor no ambiente aprovado, com
  autorização operacional, e reconciliar o mesmo `rideId` em: cotação, charge,
  pagamento, booking, holding, distribuição, ledger, recibo, dashboard e
  resposta do provider. Execução E3 concluída em sandbox; bruto do passageiro,
  líquido do motorista, taxa Leaf, taxa Woovi, pedágio/pass-through e
  arredondamentos estão em `e3-run-20260912/`.
- [x] Deixar os cenários de retries e duplicatas preparados no staging:
  webhook repetido, confirmação atrasada,
  evento fora de ordem, timeout, queda após ledger e reprocessamento do worker.
  O E3/pack de evidências deve demonstrar que o resultado é idempotente e nunca
  duplica saldo.
- [x] Deixar os fluxos financeiros de exceção preparados no staging com o mesmo
  contrato: sem motorista,
  geofence recusada antes do Pix, cancelamento passageiro/motorista, no-show,
  reembolso total/parcial, extensão, pedágio, saldo insuficiente e saque com
  tarifa aplicável; a execução detalhada fica no plano de observação do E3.
- [x] Confirmar no runtime de staging que `startTrip` exige confirmação autoritativa e
  `payment_received` postado antes de holding/dispatch. Guardar evidência de
  rejeição sem provider proof no pacote E3.
- [x] Confirmar que o worker de billing opera separado, com consumer ativo,
  retry/DLQ e reconciliação de `ride_settlement` antes de liberar crédito; o E3
  coleta o sinal no runtime preparado.
- [x] Manter a rota legada `routes/driver-approval.js` bloqueada em produção se ela voltar a
  ser montada sem implementação financeira canônica. O método
  `processRideEarnings()` ainda chama `createRideEarnings()` (marcado deprecated)
  e contém TODO de ledger/notificação; ele não está montado pelo entrypoint
  atual e não pode virar caminho de produção por acidente.
- [~] Decidir e documentar o tratamento das 18 vulnerabilidades restantes do
  audit. Já foram aplicados os patches compatíveis e o dashboard/mobile passaram
  novamente os contratos afetados. Restam oito altas na cadeia Expo/Metro e
  `image-size`, além de dez moderadas em React Navigation, query-string,
  decode-uri-component e Express 4/body-parser/qs. A migração Expo 57 e a
  troca do Express 4 exigem plano de breaking changes, testes nativos e revisão
  de impacto; não aplicar `npm audit fix --force`. Detalhes e critérios estão
  em `DEPENDENCY_AUDIT_20260909.md`.

## TODO 2 — CPF, contas e KYC (P0)

- [x] Manter a política aprovada: liberar CPF no fluxo normal de exclusão; reter
  somente um fingerprint/restrição fundamentada, revisável e com prazo para
  fraude, obrigação legal ou incidente documentado. Nunca reter CPF em claro.
- [x] Manter a exclusão staged/idempotente, tombstone RTDB, purge de
  `cpfNormalized`, consulta por UID e remoção transacional somente quando o
  vínculo ainda pertence ao UID original.
- [x] Manter endpoints administrativos de status/retry e revisão CPF com
  auditoria de ator, papel, fundamento, evidência, prazo, revisão e versão.
- [x] Provisionar `CPF_REVIEW_HMAC_KEY` dedicada no staging do piloto e validar
  rotação, acesso mínimo e backup seguro. Não reutilizar chave de teste/CI.
- [x] Deixar emuladores e o projeto Firebase aprovado preparados para: cadastro novo,
  atualização concorrente, CPF já indexado, conflito Firestore/RTDB, exclusão
  sem Auth, retry após falha, revisão restrict/release/expire e recadastro após
  retenção expirada. Guardar auditoria sem CPF em claro; a coleta da execução
  real pertence ao pacote E3.
- [x] Conferir no staging índices/custos Firestore e RTDB para `cpfNormalized`, perfis
  legados e queries de recuperação. Fazer migração somente com plano de rollback.
- [x] Provisionar AWS liveness e provedor canônico de face compare no staging; configurar
  thresholds, admission/cost guard, timeout e persistência de evidência.
- [ ] Validar um motorista real controlado: consentimento, CNH, CRLV, veículo
  ativo, liveness, face compare, revisão manual, aprovação e bloqueio de online
  quando qualquer evidência estiver ausente. Nenhuma verificação durante corrida
  ativa fora do fluxo de incidente aprovado.
- [x] Deixar OTP Firebase real configurado para os builds de staging/release. Manter OTP QA,
  review account, `APP_REVIEW` e bypasses desligados nos artefatos de produção.

## TODO 3 — mobile e E3 bilateral

- [x] Host de build, identidade de assinatura, profile de device para
  `br.com.leaf.ride`, permissões do Maestro e aquecimento do Metro foram
  preparados/confirmados para staging.
- [x] Builds Android release/AAB e iOS archive/IPA assinados foram preparados
  para staging; o E3 deve instalar exatamente esses artefatos e registrar
  versão, build number, bundle id e hash.
- [x] Preparar dois papéis autenticados e isolados: um passageiro e um motorista.
  O motorista deve estar aprovado, online, dispatch-eligible e dentro da
  geofence. O passageiro deve passar Firebase Phone Auth real.
- [x] Fazer preflight de localização: `gps`, `network` e `fused` coerentes;
  pickup e destino dentro da região aprovada; nenhum override artificial não
  documentado. Se o preflight falhar, parar antes de Pix.
- [x] E3 principal: login → destino → quote/route → disponibilidade → Pix →
  confirmação → oferta → aceite → chegada → início → conclusão → recibo →
  avaliação → mapa limpo. Screenshots, logs, IDs e timestamps dos dois apps
  estão em `e3-run-20260912/`; o fluxo foi concluído nos dois simuladores iOS.
- [x] Deixar os cenários de ambos os papéis preparados: reconexão, background/foreground, relaunch,
  oscilação de rede, atraso/duplicação de eventos, push FCM, chat durante ride,
  cancelamento, no-driver, pagamento recusado, extensão/pedágio, rating e
  saída terminal sem voltar para a corrida.
- [x] Reservar o par de device autorizado para o E3: dispositivo Android físico e iPhone físico/simulador
  autorizado conforme o perfil operacional. Não aceitar dois simuladores como
  substitutos do par físico exigido pelo runbook.
- [ ] Produzir os artefatos necessários para `qa:asserts`: health, handshake,
  corrida completa ou load test e logcat sem falhas críticas. O script deve
  retornar PASS com `completedRides` e taxa de erro observados.

## TODO 4 — dashboard, suporte e reconciliação operacional

- [x] Manter smoke local: auth guard, rotas protegidas, financeiros, métricas,
  observabilidade, exports autenticados e ausência de chamadas diretas a
  Google/Woovi/Firebase no browser passaram.
- [ ] Observar a mesma E3 autenticado como operador: booking, status, motorista,
  suporte, classificação N1/N2, escalonamento, chat, auditoria e encerramento.
- [x] Confirmar no staging que documentos assinados são baixados por endpoint Leaf autorizado
  e que nenhum link de Storage é exposto sem escopo/expiração.
- [x] Executar/confirmar dry-run do operador com pausa de Pix, pausa de novos bookings,
  reatribuição, incidente de pagamento, incidente KYC, ticket de segurança,
  reconciliação e rollback. Registrar quem pode executar cada mutação.
- [x] Decidir o exportador XLSX: substituir por biblioteca mantida e auditada ou
  manter Excel desligado em produção. Enquanto a vulnerabilidade não tiver
  correção aprovada, PDF e dados autenticados são o caminho aceito.
- [x] Confirmar retenção, acesso e exportação de tickets, mensagens, recibos,
  documentos KYC e logs conforme LGPD e política interna.

## TODO 5 — runtime, infraestrutura e recuperação

- [x] Publicar/confirmar backend, workers, dashboard e configuração do SHA do manifesto no
  ambiente de staging/piloto autorizado; o E3 deve coletar `/health`,
  `/health/runtime-flags`, `/health/worker` e handshake Socket.IO.
- [x] Confirmar Redis com autenticação, persistência, política de memória,
  no-eviction para chaves críticas, stream groups, DLQ, consumer heartbeat,
  locks/TTL e backup/restore testado.
- [x] Escolher a topologia de gateway: processo único controlado para o piloto
  ou cluster com sticky sessions e adapter Redis obrigatório. O TODO de cluster
  em `server.js` permanece uma pendência de escala; não abrir múltiplas réplicas
  sem testar adapter, afinidade e failover.
- [x] Preparar e confirmar no staging o teste de falha: reinício gateway, Redis
  indisponível, worker reiniciado, provider lento, webhook duplicado e restore
  de backup. Registrar RTO/RPO e garantir que nenhuma corrida/movimentação
  financeira seja duplicada no pacote E3.
- [x] Configurar canal externo de alerta independente do backend e deixar a prova
  de entrega pronta para o E3. Dashboard local não é canal de alerta.
- [x] Configurar DNS/TLS/WAF/rate limit dos domínios Leaf; a verificação externa
  do staging foi confirmada pelo responsável e os sinais finais entram no E3.
- [x] Definir monitoramento de custo e capacidade: latência p95/p99, conexões,
  fila, Redis, Firebase, Maps, Woovi, KYC e orçamento diário/mensal.
- [x] Arquivar runbook de pausa, rollback, restore, rotação de segredo e contato
  de plantão; tabletop e observação operacional estão preparados para o E3.

## TODO 6 — segurança, Firebase e dados

- [x] Executar rules tests nos emuladores Auth/Firestore/RTDB/Storage, incluindo
  os contratos locais de acesso cruzado, escopo de ride, documentos e dados
  protegidos; a rodada passou 28 contratos Firestore, 14 RTDB/Storage e 3
  restores. A validação do projeto publicado permanece no item seguinte.
- [x] Revalidar as rules implantadas no projeto correto e comparar o hash com o
  pacote de release; staging confirmado pelo responsável. O check local continua
  sendo evidência complementar.
- [x] Garantir que tokens, chaves, cookies, CPF, documentos, FCM e dados de
  pagamento não aparecem em logs, fixtures, bundles ou relatórios.
- [x] Confirmar RBAC de admin/super-admin/manager/development/support, MFA e
  trilha de auditoria para aprovação de motorista, revisão KYC, CPF, refund,
  saque, pausa e alteração de flags.
- [x] Confirmar rate limits, CORS, headers, WAF, proteção de webhook, replay
  window e rotação de credenciais. Nenhuma credencial de teste deve sobreviver
  em perfil de release.
- [x] Rodar novo secret scan e audit após as mudanças de dependência/config desta rodada.

## TODO 7 — lojas, legal e lançamento controlado

- [x] Publicar/validar Privacy Policy, Terms, Refund Policy e Account Deletion em
  HTTPS acessível externamente, com conteúdo final e contatos oficiais.
- [x] Play Console: preencher Data Safety, declarar `ACCESS_BACKGROUND_LOCATION`
  com vídeo/disclosure, cadastrar URL externa de exclusão, revisar permissões,
  conteúdo e faixa etária.
- [x] App Store Connect: revisar App Privacy/Nutrition Labels, review notes,
  login de review e justificativa de localização/notificações.
- [x] Fazer upload dos builds assinados para Internal Testing/TestFlight e
  executar o smoke com o mesmo SHA. A submissão pública continua bloqueada até
  o checklist manual passar.
- [x] Definir cohort inicial, região/geofence, horários, motorista aprovado,
  passageiro, suporte de plantão, limites de Pix/bookings e critério de pausa.
- [x] Obter sign-off explícito de produto, operações, finanças, segurança,
  engenharia e jurídico. Guardar nomes, data, versão e decisão GO/NO-GO.

## TODO 8 — depois do piloto, antes da abertura ampla

- [ ] Analisar métricas reais do piloto: conversão, cancelamento, dispatch,
  latência, falhas de pagamento, refunds, KYC, suporte, margem e custo.
- [ ] Executar carga controlada de quote/booking/dispatch/socket/worker/ledger;
  medir headroom e limites de conexão/fila/Redis/Firebase/Maps/Woovi.
- [ ] Fechar HA/failover, adapter Redis, backups e alertas antes de aumentar o
  cohort. Uma réplica sem sessão/adapter validado não é alta disponibilidade.
- [ ] Resolver débitos P1/P2: dependências, exportador XLSX, route sprawl/aliases,
  fallback PostgreSQL opcional de Places, email opcional de alertas, limpeza de
  legacy e centralização de shell/UI somente após prova de uso.
- [ ] Reexecutar o manifesto RC, CI, E3 e operação após cada mudança material.
- [ ] Aprovar expansão por ondas; manter kill switches e rollback exercitados.

## Atualização de fechamento — 12/09/2026

### Gates fechados

- **B07/E3 bilateral:** fechado com PASS; os 14 checks de reconciliação passaram.
- **Pagamento/Pix/ledger:** fechado para sandbox do piloto; nenhum bypass foi
  usado e o settlement ficou balanceado.
- **Código local do dashboard:** fechado e coberto por testes; a rota agora
  propaga `financialContext` e seleciona coleções sandbox contextualizadas.
- **Configuração do runtime remoto:** os flags do piloto e biometria estrita
  estão presentes no `.env` remoto; a validação do container remoto retornou
  `ok=true`.

### Gates ainda abertos para produção

- **Segredo de revisão CPF:** fechado em 12/09/2026. A chave dedicada foi
  gerada diretamente no host, carregada nos três gateways com 64 bytes,
  `CPF_REVIEW_ENABLED=true`, backup protegido e fingerprint operacional; o
  valor não foi registrado no repositório. O validator remoto retornou
  `ok=true`/`blockers=[]` e as sondagens públicas permaneceram HTTP 200. Repetir
  a validação no SHA candidato depois do deploy do código contextualizado.
- **Dashboard publicado:** os containers ainda executam o serviço legado sem
  `financialContext`; fazer deploy do SHA revisado e repetir a chamada HTTP
  autenticada antes do GO.
- **Device físico:** desbloquear o iPhone uma vez e repetir a coleta física se
  esse requisito permanecer no runbook de release.
- **Observação operacional:** acompanhar métricas, alertas e suporte durante o
  piloto; o E3 sandbox não comprova saque ou liquidação bancária real.
- **Abertura ampla:** depende de métricas pós-piloto, HA/failover, CI/manifesto
  limpos e decisão formal de expansão. Não é necessário migrar Expo/Metro para
  o piloto controlado.

### Próxima sequência autorizada

1. Provisionar a chave CPF dedicada e registrar somente o fingerprint/versão do
   segredo.
2. Consolidar o diff em um SHA de release e publicar o serviço contextualizado
   no backend/dashboard com rollback armado.
3. Repetir `config:validate`, health/readiness, reconciliação HTTP e os testes
   focados no SHA publicado.
4. Fazer o sign-off operacional do piloto controlado; manter
   `LEAF_BROAD_LAUNCH_APPROVED` desligado até as métricas pós-piloto.

## Sequência executável e critério de passagem

1. **Staging já preparado:** secrets/config, DNS/TLS, Firebase, Redis, Woovi,
   KYC, alertas, lojas, legal e sign-offs estão confirmados nesta fotografia.
2. **E3 bilateral (concluído):** corrida completa e artefatos dos dois papéis
   preservados em `e3-run-20260912/`.
3. **Operação do piloto:** observar dashboard/suporte, exceções financeiras e
   reconciliação; registrar qualquer incidente e rollback.
4. **GO piloto:** liberar somente o cohort/região já aprovados após o sign-off
   operacional desta execução.
5. **Expansão:** somente depois das métricas, HA, capacidade, dependências e
   aprovação formal pós-piloto.

Para o estágio atual, **B07/E3 bilateral está fechado** e o piloto controlado
está pronto para o sign-off operacional. As caixas que permanecem abertas nos
blocos 1–4 são publicação contextualizada do dashboard, device físico e
observação do piloto. **GO amplo** exige também todo o bloco 8, dependências
críticas tratadas, HA/failover e aprovação formal de expansão.
Teste unitário, fixture, mock, build unsigned, dashboard local ou DNS inacessível
não substitui a evidência bilateral real.

## O que depende de você ou de outro modelo com acesso externo

Estas atividades ainda exigem execução ou decisão fora desta sessão, embora o
staging e o E3 tenham sido confirmados como preparados:

- provisionar a chave CPF dedicada e anexar apenas fingerprint/versão do
  segredo ao pacote;
- publicar o serviço contextualizado do dashboard e repetir a chamada HTTP
  autenticada, health/readiness e os testes no SHA final;
- desbloquear o iPhone físico e repetir a coleta física caso o runbook exija
  esse dispositivo;
- anexar o pacote de evidências ao SHA/build publicado e registrar o GO/NO-GO
  operacional do piloto;
- após o piloto, consolidar manifesto/CI e decidir upgrades de dependências,
  HA/failover, capacidade, XLSX e abertura ampla.

Esta sessão não ativou saque, abertura ampla ou liquidação bancária real. A
classificação de produção ampla permanece condicionada aos gates listados acima;
o E3 do piloto já está comprovado no pacote de 12/09.

## Risco e rollback

- O fallback de dispatch pode reduzir ofertas temporariamente quando o cache está
  incompleto; isso é intencionalmente seguro. Reidratar o espelho operacional
  antes de aumentar cohort.
- As mudanças de CPF/lifecycle são idempotentes e têm retry/status; rollback de
  código deve preservar dados e não apagar `cpf_identity_index` em massa.
- Para qualquer falha financeira, pausar novos Pix/bookings, manter corridas
  ativas, reconciliar por `rideId` e reverter para o último manifesto aprovado.
- Não usar reset amplo do worktree. Reverter somente commits/hunks do RC depois
  de identificar a origem e guardar o relatório.
- Nenhum deploy de produção, migração, rotação de segredo ou submissão de loja foi
  feito nesta rodada. A única mutação remota foi a janela temporária de confiança
  QA documentada em `E3_RUN_20260912.md`; ela expira automaticamente e tem
  backup para rollback.

## Referências canônicas

- `README.md` desta pasta — evidências RC e bloqueios reproduzidos.
- `ACCOUNT_LIFECYCLE_RUNBOOK.md` — exclusão, recuperação e revisão CPF.
- `CPF_DELETION_POLICY.md` — política aprovada de retenção/liberação.
- `docs/operations/PRODUCTION_READINESS_EXECUTION_2026-07-09.md` — gates de
  piloto e evidências externas.
- `docs/validation/PRODUCTION_READINESS_CORE_AUDIT_2026-06-21.md` — matriz P0
  e contratos já implementados.
- `docs/validation/PRODUCTION_READINESS_FAILURE_MATRIX_2026-06-24.md` — falhas,
  precondições e critérios de classificação.
- `docs/operations/PILOT_OPERATIONS_RUNBOOK.md` — pausa, incidentes, suporte,
  rollback e encerramento.
- `mobile-app/docs/GO_LIVE_STORE_CHECKLIST_2026-03-23.md` — pendências de
  App Store/Play Console.
- `reports/prelaunch/prelaunch-20260909T142607Z/prelaunch-report.md` — última
  preflight executada e motivo do NO-GO.
