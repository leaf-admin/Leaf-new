# Fase 4 - Falha e Resiliencia (2026-03-26)

## Escopo
- Validacao tecnica de reidratacao de corrida ativa com reconnect forcado em dois momentos criticos:
  - `ACCEPTED`
  - `IN_PROGRESS`
- Perfis cobertos:
  - passageiro `11999999999` -> UID `OjML1wSzdNRaynjqMRlSW1Y0LVy2`
  - motorista `11888888888` -> UID `8vg2kxxqi3TYKlpD6eBlWgYseIq2`
- Backend alvo:
  - API `https://api.147.182.204.181.sslip.io`
  - WS `https://socket.147.182.204.181.sslip.io`

## Metodo
- Harness dedicado: [phase4_resilience_validation.cjs](/Users/izaakdias/Documents/Leaf-new/leaf-websocket-backend/tmp/phase4_resilience_validation.cjs)
- Estrategia usada:
  - cria corrida paga real com bypass controlado de QA
  - aceita corrida
  - desconecta e reconecta passageiro e motorista com novo socket apos `ACCEPTED`
  - marca chegada e inicia corrida
  - desconecta e reconecta passageiro e motorista com novo socket apos `IN_PROGRESS`
  - conclui corrida e valida limpeza de estado nos dois lados
- Observacao de execucao:
  - por restricao de rede do ambiente local desta sessao, o harness foi executado a partir da propria VPS
  - a `FIREBASE_API_KEY` foi injetada apenas no processo do teste, sem persistencia em arquivo de ambiente

## Resultado final
- `PASS` socket connect
- `PASS` auth passageiro e motorista
- `PASS` cleanup de corrida residual
- `PASS` motorista online com `onlineRedis=true`
- `PASS` corrida paga criada e ofertada
- `PASS` aceite com payload completo
- `PASS` `syncActiveRide` do passageiro apos reconnect em `ACCEPTED`
- `PASS` `syncActiveRide` do motorista apos reconnect em `ACCEPTED`
- `PASS` chegada ao embarque apos reconnect
- `PASS` `tripStarted`
- `PASS` `syncActiveRide` do passageiro apos reconnect em `IN_PROGRESS`
- `PASS` `syncActiveRide` do motorista apos reconnect em `IN_PROGRESS`
- `PASS` `tripCompleted` apos reconnect
- `PASS` limpeza de estado apos conclusao para passageiro e motorista
- `PASS` motorista offline com ack coerente

## Evidencia chave
### Reidratação em `ACCEPTED`
```json
{
  "name": "passenger_sync_after_accept_reconnect",
  "ok": true,
  "payload": {
    "hasActiveRide": true,
    "bookingId": "booking_1774496141108_OjML1wSzdNRaynjqMRlSW1Y0LVy2",
    "status": "ACCEPTED"
  }
}
```

### Reidratação em `IN_PROGRESS`
```json
{
  "name": "driver_sync_after_started_reconnect",
  "ok": true,
  "payload": {
    "hasActiveRide": true,
    "bookingId": "booking_1774496141108_OjML1wSzdNRaynjqMRlSW1Y0LVy2",
    "status": "IN_PROGRESS"
  }
}
```

### Limpeza correta após conclusão
```json
{
  "name": "passenger_sync_after_completion",
  "ok": true,
  "payload": {
    "hasActiveRide": false,
    "bookingId": null
  }
}
```

## Achados
- O contrato de `syncActiveRide` sustentou a corrida viva para os dois perfis nos dois estados validados.
- A reidratacao automatica em `auth_rehydrate` e a sincronizacao explicita continuaram coerentes com o mesmo `bookingId`.
- Nao houve estado impossivel apos reconnect.
- O fluxo voltou a `hasActiveRide=false` corretamente depois de `tripCompleted`.

## Limites desta bateria
- Esta fase validou o contrato tecnico de reconnect com novos sockets.
- Ainda falta a validacao manual/visual de comportamento de telas em background/foreground real do app, que pertence mais a Fase 5 de navegacao e estados.

## Veredito da Fase 4
- `GO` para resiliencia tecnica de corrida ativa no backend/runtime.
- Sem blocker novo aberto nesta fase.
