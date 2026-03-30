# Ride Lifecycle Readiness - 2026-03-29

## Status
**GO COM RISCO CONTROLADO**

## 1. O que já está provado
### Core da corrida
- corrida normal na VPS: `request -> accept -> arrived -> start -> complete -> rating`
- `startTrip` bloqueado antes da chegada
- tolerância real de `20m` para `Cheguei ao embarque`
- `tripCompleted` com snapshot autoritativo do backend

### Extensão de corrida
- passageiro solicita novo destino
- motorista aceita ou recusa
- Pix complementar é obrigatório para confirmar o novo destino
- recusa e expiração foram validadas

### Encerramento prematuro por passageiro
- `cancelRide` foi bloqueado após o início
- `endTripEarlyByRider` foi validado
- refund e líquido do motorista saem do backend

### Interrupção operacional + segundo motorista
- motorista 1 interrompe por motivo operacional
- passageiro pode continuar com outro parceiro
- motorista 2 recebe oferta marcada como continuação
- corrida fecha com `rideLegs`
- taxa operacional e intermediação da segunda perna aparecem absorvidas pela plataforma

## 2. Resultados chave dos smokes
### Corrida normal
Fonte: [normal-ride-smoke-vps-1774753364124.json](/Users/izaakdias/Documents/Leaf-new/leaf-websocket-backend/reports/normal-ride-smoke-vps-1774753364124.json)
- `completionType=COMPLETED`
- `authoritativeSnapshot=true`
- `fare=R$ 27,50`
- `driverNetAmount=R$ 25,51`

### Extensão + early end
Fonte: [ride-lifecycle-smoke-vps-1774753389691.json](/Users/izaakdias/Documents/Leaf-new/leaf-websocket-backend/reports/ride-lifecycle-smoke-vps-1774753389691.json)
- extensão confirmada: `CONFIRMED`
- complemento Pix validado: `R$ 7,25`
- nova tarifa: `R$ 34,75`
- extensão recusada: `DRIVER_DECLINED`
- extensão expirada: `EXPIRED`
- early end: `EARLY_ENDED_BY_RIDER`
- refund estimado: `R$ 20,62`
- líquido do motorista no trecho executado: `R$ 5,39`

### Interrupção operacional + continuação
Fonte: [operational-reassignment-smoke-vps-1774751630780.json](/Users/izaakdias/Documents/Leaf-new/leaf-websocket-backend/reports/operational-reassignment-smoke-vps-1774751630780.json)
- oferta de continuação entregue ao motorista 2: `true`
- conclusão da continuidade: `COMPLETED`
- `rideLegs=2`
- `platformAbsorbedOperationalFee` na perna 2: `R$ 1,49`
- `platformAbsorbedPaymentIntermediationFee` na perna 2: `R$ 0,50`
- encerramento sem continuidade: `INTERRUPTED_OPERATIONAL_ENDED`
- refund estimado ao passageiro nesse cenário: `R$ 27,50`

## 3. Custos técnicos por cenário
Fonte: [scenario-service-window-summary-1774753771638.json](/Users/izaakdias/Documents/Leaf-new/leaf-websocket-backend/reports/scenario-service-window-summary-1774753771638.json)

| Cenário | Firestore reads | Firestore writes | Est. Firestore USD | RTDB sent bytes | RTDB api hits | Cloud Functions exec | Cloud Run req |
|---|---:|---:|---:|---:|---:|---:|---:|
| Corrida normal | 127 | 0 | 0.0000381 | 27.077 | 47 | 1 | 2 |
| Extensão + early end | 152 | 10 | 0.0000546 | 27.958 | 55 | 3 | 4 |
| Reassign operacional | 147 | 0 | 0.0000441 | 31.206 | 44 | 2 | 1 |

Leitura correta:
- o custo incremental de Firestore por corrida continua muito baixo
- `Google Places/Routes` não apareceram nesses smokes porque as rotas foram controladas por coordenadas fixas e o runtime atual ainda resolve boa parte disso no cliente
- ainda existe ruído residual de RTDB/`bookingScheduler`/Woovi webhook em janelas curtas; isso mostra que o legado não é mais central, mas ainda não está fisicamente desligado

## 4. O que melhorou operacionalmente
- o contrato de destino mais caro agora é determinístico: aceite do motorista + Pix complementar
- o encerramento prematuro por passageiro deixou de ser um “cancelamento torto” e passou a gerar settlement autoritativo
- a continuidade com outro motorista ficou rastreável por `rideLegs`
- o recibo final do motorista e o fluxo visual principal ficaram coerentes com os estados de negócio
- a absorção da taxa da segunda perna pela plataforma foi validada no payload final

## 5. Riscos / pendências reais
### P0
- Android físico não apareceu no `adb`; falta smoke final no device real desta rodada
- rebuild local do iOS Simulator ainda sofre com pod duplicado de `react-native-google-maps`
- screenshots automatizadas do passageiro para estados de extensão/interrupção ainda sofrem com reidratação agressiva do runtime

### P1
- `EARLY_ENDED_REVIEW` ainda não foi implementado ponta a ponta
- `bookingScheduler` continua gerando ruído residual em Cloud Functions/Run
- o projeto ainda carrega tráfego residual de RTDB em janelas curtas

### P2
- consolidar ainda mais o settlement num único serviço
- tornar o bônus de continuidade do motorista 2 configurável
- criar painel operacional com contagem de `rideLegs`, `REASSIGNMENT_PENDING` e expiração de extensão

## 6. Validação mobile
### iOS
- fluxo base do motorista validado com screenshots reais
- UI do passageiro no `17 Pro` revisitada e correta na home

### Android
- build release continua gerando
- smoke desta rodada bloqueado por ausência de device conectado no `adb`

## 7. Classificação por domínio
| Domínio | Status | Leitura |
|---|---|---|
| Corrida normal | GO | pronto e provado |
| Extensão de corrida | GO | pronto e provado |
| Early end por passageiro | GO | pronto e provado |
| Reassign operacional + multi-leg | GO com risco controlado | backend provado, mobile visual do passageiro ainda precisa capturas melhores |
| Android physical QA | NO-GO temporário | falta device conectado |
| Billing exato por SKU | NO-GO temporário | Cloud Billing API continua indisponível |

## 8. Próximos passos para produção em escala
### P0 produção
1. fechar smoke Android físico do fluxo novo do motorista e do recibo final
2. resolver o build local iOS (`react-native-google-maps` duplicado em pods)
3. implementar `EARLY_ENDED_REVIEW` para segurança/falha técnica/controvérsia
4. criar alerta operacional para `REASSIGNMENT_PENDING` preso

### P1 robustez
1. tornar o state seed/rehydration do prototype observável e previsível
2. criar screenshots determinísticas do passageiro para extensão/interrupção/receipt
3. reduzir ainda mais o ruído de RTDB e o barulho do `bookingScheduler`
4. adicionar painéis de operação com legs por corrida, extensão expirada e early end por motivo

### P2 eficiência e polimento
1. expor breakdown expandível por perna no recibo do passageiro
2. configurar bônus de continuidade do motorista 2
3. consolidar relatórios de custo técnico por cenário num job recorrente interno
