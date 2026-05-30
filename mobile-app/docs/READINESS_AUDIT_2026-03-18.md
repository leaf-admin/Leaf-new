# Readiness Audit (2026-03-18)

## Objetivo
Responder de forma objetiva se o protótipo está realmente pronto para build/teste físico com cobertura de cenários reais.

## Execuções realizadas nesta rodada

### 1) Integridade de ambiente iOS local
- `pod --version` = `1.16.2`
- `npx expo-doctor` = `17/17 checks passed`
- `pod install` concluído com sucesso (136 dependencies / 171 pods)

### 2) Runtime iOS no simulador
- Simulador bootado: `iPhone 16e`
- Launch do app: `xcrun simctl launch booted br.com.leaf.ride` (sucesso)
- Evidência visual:
  - `/Users/izaakdias/Documents/Leaf-new/mobile-app/test-results/live_ios_simulator_20260318_174044.png`

### 3) Smoke backend/socket (fluxo completo com mockPayment)
- Script: `scripts/qa-simulate-ride-flow.cjs`
- Resultado: **PASS**
- Evidência:
  - `/Users/izaakdias/Documents/Leaf-new/mobile-app/test-results/live_qa_simulated_ride_20260318_173135.json`
- Estágios concluídos:
  - signin -> websocket auth -> driver online -> nearby/search drivers -> booking -> payment_confirmed -> ride_accepted -> trip_started -> trip_completed

### 4) Fluxo real de pagamento (sem `mockPayment`)
- Validação executada:
  - `POST /api/payment/advance` (criação de charge real Woovi sandbox)
  - `POST /api/woovi/test-webhook` (processamento webhook no backend)
  - verificação de evento `paymentConfirmed` no socket do passageiro
  - sequência ride_accepted -> trip_started -> trip_completed
- Resultado: **PASS**
- Evidência:
  - `/Users/izaakdias/Documents/Leaf-new/mobile-app/test-results/live_qa_real_woovi_flow_20260318_173640.json`
- Observação de status do provider após webhook de teste:
  - `/Users/izaakdias/Documents/Leaf-new/mobile-app/test-results/live_woovi_charge_status_20260318_174206.json`
  - retorno: `status=ACTIVE` (esperado em cenário sem quitação real no dashboard, com webhook de teste apenas no backend)

### 5) Endpoints e infraestrutura backend
- Runtime endpoints hardcode scan: **PASS**
  - `scripts/check-runtime-endpoints.sh`
- Redis em VPS: saudável e estável (health dedicado)
  - ver relatório histórico: `/Users/izaakdias/Documents/Leaf-new/docs/archive/legacy-infra-2026-05-29/mobile-app/REDIS_VPS_DIAGNOSTICO_2026-03-18.md`

## Achados importantes (riscos remanescentes)

1. **Não existe cobertura automática de UX real ponta a ponta**
- Hoje os testes cobrem bem backend/socket/eventos.
- Ainda falta validação sistemática de gestos, camadas de modal, transições e comportamento visual de todas as telas no app rodando (principalmente fluxo humano completo).

2. **Pagamento “real Woovi concluído” ainda depende de ação externa**
- Nesta rodada, o pipeline backend de webhook foi validado com sucesso.
- Porém, a confirmação de pagamento por transação realmente concluída no provedor (dashboard/sandbox com charge quitada de fato) ainda não foi automatizada no teste.

3. **Ruído de erro em log (não bloqueante para corrida)**
- Log observado no backend:
  - `Erro ao obter tokens FCM ... Cannot read properties of null (reading 'hgetall')`
- Não derrubou os fluxos críticos testados, mas deve ser corrigido antes de escalar.

## Veredito objetivo
- **Backend/runtime do protótipo: pronto para continuidade de testes.**
- **Produto “100% pronto” (incluindo UX real e comportamento de uso humano): ainda não.**

## Falta para chamar de 100%
1. Rodada manual guiada (passageiro + motorista) cobrindo os estados principais no iOS real.
2. Fechar pelo menos 1 corrida com pagamento Woovi efetivamente concluído via dashboard/sandbox (não só webhook de teste).
3. Sanear o erro de FCM token no backend.
