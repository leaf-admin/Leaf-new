# Validação: promoção de tarifa operacional para motoristas (2026-10-22)

Tarefa somente leitura. Nenhum código foi alterado, nenhum commit foi feito, nenhum servidor foi acessado.

- Repositório: `/Users/izaakdias/Documents/leaf-wave`
- Branch atual: `feat/driver-passenger-wave`, HEAD `422760e1a`, árvore limpa. A base pedida era `main`; as referências abaixo são do estado atual do worktree.

## Pergunta do dono

> Temos ativação de condição promocional pelo dashboard (ou via agente), com início, manutenção e fim? Exemplo: no lançamento de 01/11, todos os motoristas cadastrados, nas primeiras 25 corridas, pagam só R$ 0,99 de tarifa fixa (custo da Woovi embutido); depois disso a tarifa fixa segue R$ 1,49.

## Resposta curta

- Existe ativação de promoção pelo dashboard com início e fim, mas ela concede benefícios de assinatura, desconto (sem efeito) ou extensão de trial. Ela não altera a tarifa operacional por corrida.
- Existe campanha (banner in-app) com início, fim e público por papel e cidade. Ela também não altera tarifa.
- A tarifa operacional do motorista é calculada por faixa de valor da corrida, com valores fixos no código. Nenhuma das duas ferramentas consegue trocá-la.
- Não há contador de corridas por motorista em nenhum dos dois sistemas.
- Agentes do openbot-org não ativam nada: só leem a API e as regras proíbem campanha, preço ou cupom sem aprovação específica do Izaak.
- O exemplo exige código novo e aprovação de regra de tarifa.

## 1. O que já existe (arquivo:linha)

### 1.1 Tarifa operacional do motorista (regra atual)

| Item | Onde | Valor |
|---|---|---|
| Faixas e percentuais | `leaf-websocket-backend/services/payment-service.js:31-37` | até R$10 = 0,79; R$10–25 = 0,99; R$25–50 = 1,49; acima de R$50 = 3% |
| Política duplicada | `leaf-websocket-backend/services/ride-financial-contract.js:3-13` (`DEFAULT_POLICY`) | mesmos valores |
| Resolução da faixa | `leaf-websocket-backend/services/ride-financial-contract.js:23-52` (`resolveOperationalFee`) | faixa pelo valor bruto da corrida, sem pedágio |
| Contrato da corrida | `leaf-websocket-backend/services/ride-financial-contract.js:~135-160` (`buildRideFinancialContract`) | `leafOperationalFeeCents` (linha 147) é a tarifa do motorista |
| Passagem da política | `leaf-websocket-backend/services/payment-service/05-distribution.js:29-37` | injeta os valores de `payment-service.js` no contrato |
| Uso na distribuição | `leaf-websocket-backend/services/payment-service/05-distribution.js:56`, `:591` (sobrescrita final), `:136-143` (snapshot travado) | |
| Estimativa de rota | `leaf-websocket-backend/routes/pricing.js:623-645` | usa `resolveOperationalFee` |
| Custo da Woovi | `payment-service.js:38-39`; `ride-financial-contract.js:12-13` | 0,8% do total, mínimo R$0,50, descontado depois da tarifa operacional (linhas 150-152 do contrato) |
| Estimativa no app | `mobile-app/src/services/CostMonitoringService.js:205-211` | tabela duplicada para estimativa de custo; não cobra nada |
| Testes | `leaf-websocket-backend/tests/unit/services/ride-financial-contract.unit.test.js`, `tests/unit/contracts/mobile-driver-fee-policy-contract.unit.test.js` | |

Os valores não vêm de variável de ambiente. Mudar exige alterar código e fazer deploy, e a regra exige aprovação do dono (AGENTS.md, "Business Rules").

Observação de nomenclatura: `taxa_fixa` em `leaf-websocket-backend/services/pricing/calculateFare.js:22`, `:33`, `:44` (1,10 / 1,80 / 0,80) é componente do preço do passageiro (`tarifaBase`, linha 104). Não é a tarifa do motorista. O exemplo de R$ 1,49 corresponde à faixa de R$25–50, não ao `taxa_fixa`.

### 1.2 Campanha in-app (banners)

- Serviço: `leaf-websocket-backend/services/campaign-center-service.js`
  - Constantes de coleção, linhas 9-12; modelos comerciais, linha 15.
  - `normalizeAudience`, linhas 308-321: papéis (`roles`), plataformas, cidades, `userIds`, `minCompletedTrips`/`maxCompletedTrips`.
  - `normalizeRules`, linhas 324-335: limites de impressão, cooldown, rotação.
  - `normalizeCommercial`, linhas 337-349: valor, CPM/CPC, anunciante. Campo comercial, não tarifa.
  - `normalizeCampaign`, linhas 351-389: `startAt`/`endAt` nas linhas 373-374.
  - `createCampaign` 792; `updateCampaign` 812-847 (aceita patch de `audience`, `rules`, `commercial`, `content`, `startAt`, `endAt`, `status`; nenhum campo de tarifa).
  - `campaignIsActive` 862-869 (janela de datas); `campaignMatchesContext` 903-924; `resolveEligibleCampaigns` 926.
  - Campanhas padrão em `buildDefaultCampaigns` (491+). A campanha "Taxa zero passageiro" (linhas 529-540) tem texto "Hoje a taxa é nossa", sem nenhuma regra de tarifa por trás.
- Rotas: `leaf-websocket-backend/routes/campaign-center.js`
  - `POST /campaigns` 139; `PATCH /campaigns/:id` 189 (ADMIN_ROLES + `requireAdminMutationsEnabled`); `POST preview-eligibility` 225; `GET /eligible` 352; eventos 365-386.
  - Auditoria estruturada em criação (150) e atualização (207), via `logStructured`.
  - Montagem em `leaf-websocket-backend/bootstrap/register-http-routes.js:132-133` (`/api/campaign-center`).
- Flags: `leaf-websocket-backend/utils/pilot-launch-flags.js:52` (`campaignCenterEnabled`, default true) e `:59` (`adminMutationsEnabled`, default true). Os exemplos de env (`config/soft-release.env.example:111`, `:118`; `config/pilot-controlled.env.example:46`, `:53`) trazem `false`.
- Dashboard: `leaf-dashboard-js/app/campaign-center/page.js`
  - Formulário com `startAt`/`endAt` (linhas 424-425), público, valor comercial, custo.
  - Chamadas: `createInAppCampaign` (375), `updateInAppCampaign` com `status` (492), `previewInAppCampaign` (508).
- Consumidores fora da rota: apenas `leaf-websocket-backend/services/backoffice-command-center-service.js:4,467`. Nenhum caminho de corrida, pagamento ou ledger lê campanha.
- Testes: `leaf-websocket-backend/tests/unit/services/campaign-center-service.unit.test.js` (9 casos), `tests/unit/routes/campaign-center-routes.unit.test.js`.

### 1.3 Promoções de motorista (o sistema que tem início e fim)

- Serviço: `leaf-websocket-backend/services/promotion-service.js`
  - `createPromotion` 384-431: nome, tipo, benefício, elegibilidade, `startDate`, `endDate`, `maxRedemptions`.
  - `checkEligibility` 541-590: status ativo, janela de início/fim (linhas 553-564), limite global de resgates (`maxRedemptions`, linha 565), uma vez por motorista (linha 569).
  - `checkEligibilityCriteria` 592-614: critérios `first_n_drivers`, `registration_date_range`, `all_drivers`, `specific_drivers`. Não existe critério de corridas.
  - `checkFirstNDrivers` 616-652: posição entre todos os cadastros por `createdAt` (não corridas); respeita data limite do cadastro.
  - `checkRegistrationDateRange` 654-673: cadastro entre duas datas. Serve para "cadastrados até a data" se `startDate` for antigo.
  - `applyPromotion` 682-740; `applyBenefit` 742-758.
  - Benefícios: `free_subscription` (760, grava `promotion_free_end` no perfil legado), `trial_extension` (837), `discount` (827-835, **não faz nada**: devolve o número do desconto e não toca em tarifa).
  - `checkAndApplyEligiblePromotions` 877: aplicação automática, chamada na aprovação do motorista (`leaf-websocket-backend/services/driver-approval-service.js:632-633`) e em `routes/dashboard/08-driver-plans-and-status.js:1352-1353`.
- Rotas: `leaf-websocket-backend/routes/dashboard/07-promotions.js`: `POST /api/promotions` 18, `PATCH /api/promotions/:id` 122, `POST /api/promotions/:id/apply/:driverId` 172. Guard: `DASHBOARD_OPERATION_MUTATION_ROLES` e `requireAdminMutationsEnabled`. Não há `logStructured` nem log de auditoria no arquivo (0 ocorrências).
- Dashboard: `leaf-dashboard-js/app/promotions/page.js`. Tipos: "Assinatura grátis" e outros (~linha 258). Critérios: "Todos os motoristas", "Primeiros N motoristas", "Lista específica" (~linhas 270-280). Não há critério de corridas. Datas de início e fim (linhas ~305-314).
- Uso na corrida: `promotionService` não é chamado por nenhum caminho de cálculo de tarifa, de pedido de corrida ou de conclusão. Só por socket legado (`bootstrap/register-socket-legacy-bridge-handler.js`), rotas do dashboard e aprovação.
- Testes: nenhum teste unitário dedicado ao `promotion-service.js`. Só `tests/unit/routes/dashboard-vehicle-config-crlv-gate.unit.test.js` o menciona.

### 1.4 Outros mecanismos que tocam dinheiro (fora do exemplo)

- `services/passenger-discount-benefit-service.js`: benefício de desconto do passageiro por convite, sobre o valor pago pelo passageiro (`grossFare`/`payableFare`). Não encontrei ligação com a tarifa operacional do motorista.
- Assinatura diária do motorista: `payment-service.js:41-46` (`SUBSCRIPTION_DAILY_*`) e `subscriptionRetainedFeeCents` (`ride-financial-contract.js`). Modelo separado da tarifa por corrida, desligado por padrão (`SUBSCRIPTION_DAILY_BILLING_ENABLED=false`).

## 2. Tabela: consegue / não consegue (cada parte do exemplo)

| Parte do exemplo | Consegue? | Pelo que existe hoje | Evidência |
|---|---|---|---|
| Público: motoristas cadastrados até a data | **Parcial** | Promoção consegue elegibilidade por cadastro (`registration_date_range` com `startDate` antigo ou `first_n_drivers`). Campanha não consegue (só papel/cidade/IDs). Mas a elegibilidade só resulta em benefício, não em tarifa. | promotion-service.js:616-673; campaign-center-service.js:308-321 |
| Janela de datas (início, manutenção, fim) | **Sim, para a promoção** | `startDate`/`endDate` e status (pausar/ativar/encerrar) no dashboard. Campanha tem `startAt`/`endAt`. Ambos não mudam tarifa. | promotion-service.js:541-566; campaign-center-service.js:862-869; promotions/page.js ~305-314 |
| Limite de 25 corridas por motorista | **Não** | Não há contador de corridas. `maxRedemptions` limita resgates globais, não corridas. `minCompletedTrips` de campanha vem só da query (campaign-center.js:113) e não é aplicado na corrida. | promotion-service.js:565; campaign-center.js:113 |
| Tarifa fixa R$0,99 nas primeiras 25 corridas | **Não** | Tarifa vem de `resolveOperationalFee` por faixa, com valores fixos. Nenhum benefício altera `leafOperationalFeeCents`. O benefício `discount` é no-op. (Para corrida de R$10–25 o valor já é 0,99; para R$25–50 é 1,49.) | payment-service.js:31-37; ride-financial-contract.js:23-52, 147; promotion-service.js:827-835 |
| Volta para R$1,49 depois | **Não** | Mesmo motivo. Além disso, 1,49 é a faixa de R$25–50; para corridas até R$25 a regra atual é 0,79 / 0,99. É preciso definir o que "1,49" significa. | payment-service.js:31-33 |
| Quem ativa: dashboard | **Parcial** | Dashboard cria, pausa, ativa e encerra promoção e campanha (benefícios e banners). Não ativa tarifa. | routes/dashboard/07-promotions.js:18, 122; campaign-center.js:189 |
| Quem ativa: agente (openbot-org) | **Não** | Agente de dados (`src/skills/leaf-dados/scripts/leaf-dados.mjs`) só faz GET na API Leaf (login em :448, `leafGet` em :465; POSTs são Google, Apple, UptimeRobot, Cloudflare e Discord). Regras proíbem campanha, preço, cupom e promoção sem aprovação específica do Izaak: `src/live/agents.json` linhas 185, 269, 299, 723. | leaf-bots-workspace/openbot-org |
| Auditoria | **Parcial** | Campanha: log estruturado de criação e atualização (routes/campaign-center.js:150, 207), com ator. Promoção: `createdBy` gravado, sem log de auditoria na rota. Nenhuma das duas grava a mudança de tarifa, porque ela não existe. | campaign-center.js:150,207; 07-promotions.js (0 logs) |
| Feature flag de desligar | **Sim** | `ENABLE_CAMPAIGN_CENTER` e `ENABLE_ADMIN_MUTATIONS`. Padrão do código é ligado; exemplos de env trazem desligado. | pilot-launch-flags.js:52,59 |

## 3. Lacunas

1. Não existe regra de tarifa por campanha, por período ou por motorista. A tarifa é constante no código, em três lugares: `payment-service.js:31-37`, `ride-financial-contract.js:3-13` e `mobile-app/src/services/CostMonitoringService.js:205-211`. Qualquer mudança precisa atingir os três.
2. Não existe contador de corridas por motorista para promoção. Hoje só há contagem de cadastro (`first_n_drivers`) e resgate global.
3. O benefício `discount` existe no dashboard, mas não faz nada (`promotion-service.js:827-835`). Um operador pode criar uma promoção "de desconto" e achar que ela funciona.
4. O custo Woovi é descontado depois da tarifa operacional (`ride-financial-contract.js` ~150-152). O exemplo diz "custo da Woovi embutido" em R$0,99. Pelo código, o motorista pagaria R$0,99 mais a taxa de intermediação (0,8%, mínimo R$0,50). Isso precisa ser decidido antes de codar. Para uma corrida de R$12, a taxa Woovi mínima (R$0,50) sobra R$0,49 para a Leaf.
5. Texto de campanha sem regra: "Hoje a taxa é nossa" (`campaign-center-service.js:529-540`) é só banner. Se o banner ficar ativo sem a regra, o app promete taxa zero que não existe. Risco de comunicação.
6. Dois conceitos de "taxa fixa": `taxa_fixa` do preço do passageiro (`calculateFare.js`) e tarifa operacional do motorista (`payment-service.js`). Nomes parecidos, sem separação no painel.
7. Sem testes unitários de `promotion-service.js`.
8. Sem auditoria de mudança de promoção nas rotas do dashboard.

## 4. Menor plano para cobrir o exemplo

Pré-requisito: decisão do Izaak (regra de tarifa exige aprovação; não implementar antes).

Decisões a fechar, em uma resposta só:
- O valor de R$0,99 é a tarifa Leaf total (com a Woovi dentro) ou a Leaf fica com R$0,99 e a Woovi é cobrada à parte?
- Elegibilidade: cadastro até qual data exata (inclui motoristas aprovados depois?).
- Contagem: corridas concluídas, a partir de quando, e como tratar corrida cancelada ou encerrada antecipadamente.
- Depois da 25ª corrida, a faixa volta para a tabela atual (0,79/0,99/1,49/3%) ou para R$1,49 fixo em todas as faixas?
- Janela: início 01/11 às 00h (America/Sao_Paulo) e fim?

Implementação mínima (depois da aprovação):

1. Reaproveitar `promotions` (início, fim, pausar, auditoria no dashboard) com um novo tipo de benefício `operational_fee_override` (ex.: `{feeCents: 99, maxRides: 25}`), e não um sistema novo.
2. Contador por motorista em documento próprio (ex.: `driver_fee_promo_usage/{driverId}`), incrementado na conclusão da corrida dentro de transação, idempotente por `bookingId`.
3. Em `ride-financial-contract.js`, `resolveOperationalFee` consulta a promoção ativa e o contador: se elegível e restam corridas, retorna `feeCents: 99` com `feeType: 'launch_promo'`. Senão, mantém a regra atual. O contrato já é travado na corrida (`05-distribution.js:136-143`) e no quote (`quote-lock-service.js:143-179`), então a taxa não muda no meio da corrida.
4. Dashboard: exibir contador "corridas usadas x 25" e botão de pausar/encerrar, com log de auditoria (padrão de `campaign-center.js:150,207`).
5. Agentes: nada de ativação. Só leitura do contador via `leaf-dados` (GET) para relatório.
6. Testes: `ride-financial-contract.unit.test.js` (faixas, 25ª e 26ª corrida, data de corte, promoção pausada), teste de idempotência do contador em `CompleteTripCommand`, teste de cancelamento e encerramento antecipado.
7. Validação do AGENTS.md: `npm --prefix leaf-websocket-backend run test:unit -- --runInBand` e `npm --prefix leaf-dashboard-js run qa:backoffice`. Evidência em produção só com sessão real.
8. Rollback: desligar a promoção (status pausado) faz a regra voltar à tabela atual. Nenhum dado de ledger precisa ser reescrito. Se for preciso remover o código, reverter o commit.

Riscos: concorrência no contador (duas corridas concluídas juntas), corrida cancelada depois de contada, motorista aprovado depois do corte, e divergência entre estimativa (`routes/pricing.js`) e corrida final.

## 5. Conclusão

Hoje a ferramenta do dashboard cobre datas, público e status, mas não tem a alavanca de tarifa nem o contador de corridas. Agentes não ativam nada. O exemplo do dono exige código novo na cadeia de tarifa (`ride-financial-contract.js`), um contador por motorista e uma decisão de regra sobre a Woovi. Nada disso foi implementado nesta tarefa.
