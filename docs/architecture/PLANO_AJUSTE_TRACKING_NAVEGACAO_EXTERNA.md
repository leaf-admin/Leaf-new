# Plano de Ajuste: Tracking com Navegacao Externa (Waze/Google Maps)

Data: 2026-03-16
Status: planejamento executivo

## Objetivo

Garantir:
- navegacao externa no app do motorista (Waze/Google Maps por escolha do motorista);
- tracking da corrida a cada 2 segundos sem perda de dados;
- sincronismo com backend e persistencia integra da corrida ativa;
- eliminacao de duplicidade de eventos de localizacao;
- preservacao da localizacao em tempo real renderizada na interface do app.

## Diagnostico Atual (stack e negocio)

- Mobile (React Native/Expo) envia localizacao por mais de um caminho no `DriverUI`, com risco de duplicidade.
- Backend (Socket.IO + Redis) persiste posicao do motorista em GEO + hash com TTL, e faz broadcast para passageiro.
- Maquina de estados de corrida ja existe no backend (PENDING -> SEARCHING -> ACCEPTED -> IN_PROGRESS -> COMPLETED/CANCELED) e deve ser mantida como fonte de verdade de negocio.
- Event sourcing ja existe para trilha de auditoria de estados; devemos estender o modelo para localizacao de corrida.
- Navegacao externa ja esta implementada no app via deep link e pode continuar sem uso continuo de Directions API.

## Arquitetura Alvo

1. Um pipeline unico de localizacao no app do motorista.
2. Envio de localizacao em batch curto com fila local persistente (offline-first).
3. Ingestao backend com idempotencia por `tripId + seq`.
4. Redis GEO para "posicao atual" (tempo real) e stream/evento para "historico de rota".
5. Persistencia duravel assicrona da trilha da corrida.
6. Estado da corrida ativa indexado por motorista para lookup O(1), sem `KEYS booking:*`.

## Plano de Execucao (to-do)

## Fase 1: saneamento de duplicidade no app

- [x] Remover caminho duplicado de `updateLocation` no `DriverUI` e manter um unico emissor.
- [x] Padronizar frequencia: `2s` em `IN_PROGRESS`; `5s` fora de corrida.
- [x] Manter `driverHeartbeat` separado a cada `30s` apenas para presenca/TTL.
- [x] Garantir que o emissor usa `tripId` e `seq` monotonicos por corrida.
- [x] Garantir fallback offline com fila local (persistente) e reenvio ordenado por `seq`.

## Fase 2: contrato de evento de localizacao

- [x] Definir payload canonico `trip.location.v1`:
- [x] Campos obrigatorios: `tripId`, `driverId`, `seq`, `capturedAt`, `lat`, `lng`.
- [x] Campos recomendados: `accuracy`, `heading`, `speed`, `source`, `appState`.
- [x] Definir regra de idempotencia no backend: rejeitar duplicado por `tripId + seq`.
- [x] Definir janela de aceitacao de atraso e politica para pontos fora de ordem.

## Fase 3: backend de ingestao sem hotspots

- [x] Criar/usar indice `active_trip_by_driver:{driverId} -> tripId`.
- [x] Substituir lookup por `KEYS booking:*` no caminho quente de localizacao.
- [x] Processar localizacao por transacao simples:
- [x] validar corrida ativa + ownership do motorista;
- [x] deduplicar (`SETNX` com TTL por `tripId:seq`);
- [x] atualizar GEO/estado atual;
- [x] publicar evento de localizacao para persistencia assicrona;
- [x] emitir para room do passageiro.

## Fase 4: persistencia integra da rota

- [x] Criar stream de localizacao por corrida (`trip_location_events`) ou namespace em stream existente.
- [x] Worker assicrono grava trilha consolidada em storage duravel.
- [x] Snapshot final na conclusao da corrida com resumo: distancia, duracao, total de pontos, gaps.
- [x] Definir retencao: historico completo de auditoria + camada compactada para consulta.

## Fase 5: UI e continuidade operacional

- [ ] Manter renderizacao em tempo real do motorista para passageiro via websocket.
- [x] Implementar continuidade de coleta com contexto de corrida ativa + `BackgroundLocationService`.
- [ ] Confirmar que abrir Waze/Google Maps nao interrompe coleta/filas (validacao em device real).
- [ ] Garantir resume correto apos app voltar do background.
- [ ] Implementar alarme quando taxa de perda/deduplicacao ultrapassar limite.

## Fase 6: testes e rollout seguro

- [x] Teste unitario de idempotencia e ordem (`seq`).
- [ ] Teste de resiliencia offline/online com reenvio.
- [ ] Teste de corrida longa (>=90 min) com 2s e validacao de trilha.
- [ ] Teste de concorrencia (varios motoristas) sem degradacao de latencia.
- [ ] Deploy gradual com feature flag do novo pipeline.
- [ ] Plano de rollback para pipeline antigo por flag.

## Criterios de aceite (Definition of Done)

- [ ] Nenhuma duplicidade funcional de ponto de localizacao por corrida (dedupe <= limite esperado de retransmissao).
- [ ] Zero perda relevante de trilha em corrida longa (gaps dentro do SLO).
- [ ] Interface continua renderizando localizacao em tempo real sem regressao perceptivel.
- [ ] Corrida ativa persiste corretamente entre foreground/background/reconexao.
- [ ] Navegacao externa (Waze/Google Maps) funcionando por preferencia do motorista.
- [ ] Sem chamadas recorrentes de Directions API durante corrida em andamento.

## Riscos e Mitigacoes

1. Risco: duplicidade de pontos por multiplos emissores no app.
Mitigacao: pipeline unico + `seq` + dedupe server-side.

2. Risco: perda de pontos em oscilacao de rede.
Mitigacao: fila local persistente + reenvio ordenado + ACK.

3. Risco: custo/latencia por lookup ineficiente (`KEYS`) no hot path.
Mitigacao: indice `active_trip_by_driver` e consulta O(1).

4. Risco: corrida longa aumentar consumo de infraestrutura.
Mitigacao: batch curto, compressao/compactacao assicrona e limites por tenant/motorista.

5. Risco: inconsistencias de estado da corrida.
Mitigacao: manter `RideStateManager` como regra oficial de transicao + validacao por estado no ingest.

6. Risco: regressao na UX de mapa em tempo real.
Mitigacao: contrato de evento estavel + testes E2E de renderizacao.

## Viabilidade do Modelo

Conclusao: viavel e recomendado.

Motivos:
- Alinha com regra de negocio (corrida ativa integra + trilha auditavel).
- Mantem custo de mapas baixo (navegacao externa).
- Preserva UX em tempo real.
- Escala melhor que o modelo atual ao remover hotspots e duplicidade.

Condicao para viabilidade plena:
- executar Fase 1 e Fase 3 antes de ampliar volume de corridas.
