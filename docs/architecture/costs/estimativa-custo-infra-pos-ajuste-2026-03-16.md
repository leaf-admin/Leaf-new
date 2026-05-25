# Estimativa de Custo de Infra por Corrida (Pos Ajuste de Tracking)

Data: 2026-03-16
Contexto: navegacao externa (Waze/Google Maps), tracking em 2s em corrida iniciada, persistencia da rota por stream.

## Premissas usadas

- Corrida base: 28 minutos.
- Fase pre-inicio/aceitacao: 8 minutos em 5s (`96` updates).
- Fase corrida iniciada: 20 minutos em 2s (`600` updates).
- Heartbeat: 30s (`56` heartbeats).
- Mensageria:
- `updateLocation` (driver -> backend)
- `driverLocation` (backend -> passageiro)
- `locationUpdated` ACK (backend -> driver)
- `driverHeartbeat` (driver -> backend)
- Pricing de referencia:
- Google Maps request: R$ 0,025
- Redis operacao: R$ 0,000005
- WebSocket mensagem: R$ 0,000005
- WebSocket conexao: R$ 0,001 por corrida (2 conexoes)
- Location update: R$ 0,000005
- Mobile API baseline: 28 chamadas = R$ 0,00014
- Firebase baseline: R$ 0,000022

## Custo por componente (corrida base 28 min)

- Redis: `R$ 0,031280`
- WebSocket: `R$ 0,011240`
- Location updates: `R$ 0,003480`
- Mobile API baseline: `R$ 0,000140`
- Firebase baseline: `R$ 0,000022`
- Persistencia da rota (chunks Firestore): `~R$ 0,00022` (estimado, 20-30 writes/corrida)

Google Maps (cenarios):
- Conservador (3 requests): `R$ 0,075000`
- Otimizado (2 requests): `R$ 0,050000`

## Total estimado por corrida

- Cenario conservador (Maps 3 req): `R$ 0,121382`
- Cenario otimizado (Maps 2 req): `R$ 0,096382`

## Corrida longa (60 min) - sensibilidade

Premissa:
- 10 min pre-inicio a 5s
- 50 min em corrida iniciada a 2s

Total estimado:
- Conservador (Maps 3 req): `R$ 0,182962`
- Otimizado (Maps 2 req): `R$ 0,157962`

## Observacoes importantes

- Esta estimativa e linear por volume de updates e depende fortemente da duracao da corrida.
- O ajuste elimina lookup caro por `KEYS booking:*` no caminho quente e reduz risco de degradacao operacional.
- O valor real em producao pode ficar abaixo da estimativa se:
- custo unitario efetivo de Redis/WebSocket for menor no plano contratado;
- houver compressao/batch adicional sem degradar UX.
