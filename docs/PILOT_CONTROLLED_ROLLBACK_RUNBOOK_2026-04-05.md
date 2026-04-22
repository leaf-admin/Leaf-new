# Pilot Controlled Rollback Runbook

Data: 2026-04-05
Uso: incidente operacional durante o piloto controlado.

## 1. Quando acionar rollback

- pagamentos falhando ou duplicando
- rides presas sem conclusao
- dispatch erratico ou corridas indo para motoristas inelegiveis
- reconnect quebrando corrida ativa
- degradacao geral de health, websocket ou Redis

## 2. Acao imediata

- parar entrada de novos motoristas do piloto
- restringir novas corridas na praca piloto
- comunicar no canal operacional que o piloto entrou em contingencia
- manter rides ativas sendo acompanhadas manualmente ate conclusao ou cancelamento seguro

## 3. Congelamento de superficie

- manter `pilot_controlled`
- manter:
  - `ENABLE_DRIVER_WITHDRAWALS=false`
  - `ENABLE_REFERRAL_PROGRAMS=false`
  - `ENABLE_SOFT_BAN_ENFORCEMENT=false`
  - `ENABLE_ADMIN_MUTATIONS=false`
- se necessario, desligar temporariamente categorias da praca piloto

## 4. Diagnostico minimo

- checar `/health`
- checar websocket auth e active rides
- checar taxa de `noDriversFound`
- checar webhook Woovi e backlog de pagamento
- checar logs do booking afetado

## 5. Mitigacao manual

- corrida sem motorista: cancelar com comunicacao ao passageiro
- corrida aceita e presa: acompanhar motorista e passageiro manualmente ate conclusao ou cancelamento
- problema de pagamento: registrar charge, rideId e passageiro; nao reemitir sem reconciliar
- problema de repasse: manter fora do app e resolver em operacao assistida

## 6. Criterio para reabrir

- causa raiz identificada
- fix publicado
- rerun dos cenarios P0 afetados
- health, websocket e pagamento estabilizados
- responsavel operacional concorda em reabrir a janela
