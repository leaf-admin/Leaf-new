# Growth, Safety e Operacao Assistida - 2026-05-19

## Objetivo

Consolidar as frentes novas que ficaram em estudo preliminar em um pacote executavel, sem quebrar a build aprovada e sem misturar mudanca visual com contrato critico de corrida.

## Fotografia Antes

- Suporte N1/N2/N3 ja existia no backend/dashboard, mas o microservico `support-agent-orchestrator` nao tinha teste automatizado proprio.
- Convite e waitlist ja tinham base backend e dashboard, mas ainda precisam de produto mobile dedicado para passageiro/motorista e regras de ativacao.
- Leaf Delas tinha dado de genero via KYC/onboarding, mas nao tinha preferencia de corrida nem filtro de dispatch.
- Destino do motorista tinha destino da corrida na oferta, mas nao tinha modo "vou para tal regiao" filtrando corridas compativeis.
- Tarifa dinamica ja tinha engine backend, mas o prototipo novo calculava valor local antes do Pix.
- Demanda/smart push ja tinha H3/read model e notificacao heuristica, mas nao tinha modelo versionado de predicao.
- Valor liquido do motorista ja estava coberto por snapshots em telas de oferta/corrida, com fallback para bruto quando o net nao chega.

## Entrega Desta Rodada

### Suporte N1/N2/N3

- Adicionado teste do `support-agent-orchestrator` cobrindo classificacao, escalonamento N3 e cache de analise por ticket.
- Adicionado script `npm test` no microservico.
- Mantido modo copilot por padrao: recomendacao e roteamento, sem resposta autonoma irrestrita.

### Convites e Waitlist

- Criado service mobile `referralProgramService` para:
  - listar convites do usuario em `/api/programs/referrals/invites/me`;
  - criar convite de passageiro em `/api/programs/referrals/invites/passenger`;
  - criar convite de motorista em `/api/programs/referrals/invites/driver`;
  - aceitar codigo em `/api/programs/referrals/invites/accept`.
- Criado service mobile `driverWaitlistService` para status, entrada e saida da waitlist do motorista.
- Nova tela Leaf para passageiro: `RobotaxiInvitesScreen`, com criacao de convite, codigo/link, compartilhamento e aceite por codigo.
- Nova tela Leaf para motorista: `RobotaxiDriverWaitlistScreen`, com status da cidade, entrada na fila e criacao de convite de motorista.
- Menu e navegacao do prototipo agora expõem:
  - `RobotaxiPrototypeInvites`;
  - `RobotaxiPrototypeDriverWaitlist`.

### Leaf Delas e Destino do Motorista

- Novo servico backend `ride-dispatch-preference-service`:
  - filtra Leaf Delas para motoristas com genero feminino;
  - avalia modo destino do motorista por progresso em direcao ao alvo;
  - retorna motivo estruturado para auditoria de dispatch.
- Integrado nos pontos de disponibilidade, criacao de booking, confirmacao de pagamento, expansao de raio e dispatcher.
- O payload mobile agora carrega `preferences` em availability e createBooking.
- O cache de availability no mobile agora inclui assinatura de preferencias, evitando reaproveitar resultado comum em uma corrida Leaf Delas.
- O card de cotacao do passageiro agora tem o controle `Leaf Delas`, com copy curta e envio imediato de `leafDelas/femaleDriverOnly` para disponibilidade e solicitacao de corrida.
- O card do motorista agora permite ativar/desativar destino preferido nas preferencias de trabalho.
- O runtime mobile persiste `driverDestinationMode` e reenviara esse modo ao ficar online.
- `setDriverStatus` no app e nos sockets backend agora transporta e grava os campos de modo destino no Redis, mantendo compatibilidade com clientes antigos quando nenhum payload e enviado.

### Categoria e Matching

- O dispatcher passa a aplicar elegibilidade de categoria quando `carType` existe.
- Expansao de raio tambem propaga `carType`, destino e preferencias.
- `findAvailableDriversForPickup` passa a respeitar categoria, preferencias e destino tanto no server modular quanto no `server.vps.js`.

### Tarifa Dinamica

- `RobotaxiDestinationScreen` busca `/api/pricing/quote` antes do Pix para o plano selecionado.
- O valor da quote backend substitui a tarifa local quando chega valido.
- Badge simples de tarifa dinamica aparece quando `pricingPayload.dynamic_percentage` ou `passenger_notice` indicam pressao.
- O lock financeiro de pagamento segue sendo autoridade no backend.

### Demanda e Smart Push

- Novo servico `demand-prediction-service` com modelo versionado `leaf-demand-v0.1-heuristic`.
- Nova rota de preview `POST /api/demand/predictions/preview`.
- Saida inclui score, nivel, features e recomendacoes de smart push para motoristas/passageiros.
- Esta e uma base v0 heuristica e versionada; o proximo passo de ML real e gravar serie temporal H3 + feedback de push para treino.

### UI Financeira Do Motorista

- Rodada de validacao confirmou os testes de snapshot financeiro, resumo de corrida e overlay do motorista.
- O contrato atual prioriza `driverNetAmount`/`estimatedDriverNetAmount` e snapshots financeiros quando presentes.
- A pendencia de produto permanece em copy/telemetria: quando o net explicito nao vier, a UI deve usar copy neutra em vez de chamar bruto de liquido.

## Contratos

### Preferences de Corrida

```json
{
  "preferences": {
    "leafDelas": true,
    "femaleDriverOnly": true
  }
}
```

Aplicado em:

- `checkRideAvailability`
- `createBooking`
- precheck de disponibilidade apos pagamento
- dispatch e expansao de raio

### Modo Destino Do Motorista

Campos lidos no Redis `driver:{driverId}`:

- `destinationModeActive`
- `destinationModeLat`
- `destinationModeLng`
- `destinationModeExpiresAt`
- `destinationModeMinProgressKm`
- `destinationModeArrivalRadiusKm`

Regra: uma corrida e elegivel se aproxima o motorista do destino alvo pelo progresso minimo configurado ou se encerra dentro do raio de chegada.

### Quote Dinamica Mobile

Payload enviado:

```json
{
  "pickupLocation": { "lat": -22.9711, "lng": -43.1822 },
  "destinationLocation": { "lat": -22.9104, "lng": -43.1631 },
  "carType": "Leaf Plus",
  "routeDistanceKm": 4.7,
  "routeDurationSecs": 540,
  "clientEstimatedFare": 13.42
}
```

## Testes Executados

Rodada incremental apos UI/contrato de Leaf Delas e modo destino:

```bash
node --check leaf-websocket-backend/bootstrap/register-socket-driver-control-handlers.js
node --check leaf-websocket-backend/server.vps.js
```

Resultado: sem erro de sintaxe.

```bash
cd leaf-websocket-backend
npx jest --config config/jest.unit.config.js --runInBand \
  tests/unit/services/ride-dispatch-preference-service.unit.test.js \
  tests/unit/services/create-booking-availability-precheck.unit.test.js \
  tests/unit/services/demand-prediction-service.unit.test.js
```

Resultado: 3 suites, 13 testes, todos passando.

```bash
cd mobile-app
npx jest --config jest.config.js --runInBand \
  __tests__/destination-quote-recalculation.test.js \
  __tests__/driver-home-overlay.test.js
```

Resultado: 2 suites, 12 testes, todos passando. Observacao: a suite de destino ainda emite avisos `act(...)` por efeitos assincronos ja existentes.

```bash
cd mobile-app
npx jest --config jest.config.js --runInBand \
  __tests__/prototype-ride-screens.test.js \
  __tests__/prototype-new-surfaces.test.js
```

Resultado: 2 suites, 29 testes, todos passando.

```bash
cd mobile-app
npx jest --config jest.config.js --runInBand \
  __tests__/prototype-new-surfaces.test.js
```

Resultado apos convites/waitlist: 1 suite, 7 testes, todos passando.

```bash
cd services/support-agent-orchestrator
npm test
npm run check
```

Resultado: testes e syntax check passando.

```bash
cd mobile-app
npx jest --config jest.config.js --runInBand \
  __tests__/driver-offer-pricing-snapshot.test.js \
  __tests__/prototype-ride-runtime-financial-snapshot.test.js \
  __tests__/trip-financial-summary.test.js \
  __tests__/driver-live-ride-overlay.test.js
```

Resultado: 4 suites, 21 testes, todos passando.

```bash
node --check leaf-websocket-backend/server.vps.js
node --check leaf-websocket-backend/server.js
node --check leaf-websocket-backend/bootstrap/register-socket-confirm-payment-handler.js
node --check leaf-websocket-backend/services/driver-notification-dispatcher.js
node --check mobile-app/src/screens/prototype/RobotaxiDestinationScreen.js
node --check mobile-app/src/screens/prototype/prototypeRideRuntime.js
git diff --check -- <arquivos alterados>
```

Resultado: sem erro.

## Pendencias Controladas

- Evoluir Leaf Delas de toggle operacional para produto completo: disponibilidade/copy de fallback quando nao houver motorista mulher e flag de rollout.
- Evoluir modo destino com expiracao visivel, sugestoes inline, limite de uso diario e telemetria de match/recusa.
- Unificar dados historicos entre waitlist landing, waitlist operacional e convites para metricas/cohorts no dashboard.
- Adicionar dashboard de cohorts/flags para ativacao de waitlist/referral/Leaf Delas.
- Persistir feedback de smart push (`sent`, `opened`, `actioned`, `suppressed`) para evoluir de v0 heuristico para modelo treinado.
- Garantir que telas do motorista mostrem "liquido" somente quando houver snapshot net explicito; caso contrario usar copy neutra.
