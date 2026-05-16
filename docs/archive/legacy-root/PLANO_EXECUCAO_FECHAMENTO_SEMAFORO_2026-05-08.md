# Plano de Execucao: Fechamento do Semaforo (30 dias)

Data de criacao: 2026-05-08  
Periodo de execucao: **2026-05-11 a 2026-06-09**  
Base: `docs/RESUMO_EXECUTIVO_SEMAFORO_WHITE_LABEL_2026-05-08.md`

---

## 1) Objetivo final (Definition of Done)

Fechar os pontos amarelo/vermelho do semaforo com 3 entregas:

1. **Fonte unica da verdade comercial** publicada e aplicada no runtime.  
2. **Matriz oficial de contrato por canal** (`app`, `dashboard`, `backend`) publicada e validada.  
3. **Corte de legado em 3 ondas** concluido com reducao mensuravel de superficie legada.

---

## 2) Baseline (foto de partida em 2026-05-08)

### 2.1 Superficie legada (backend)

Fonte: `leaf-websocket-backend/reports/legacy-runtime-surface-1778256412102.json`

- `legacy_feature_flags`: **48**
- `rtdb_access`: **85**
- `legacy_routes`: **4**
- `legacy_fallback_logs`: **22**

### 2.2 Narrativa comercial (inconsistencia semanal vs diaria)

Contagem inicial (busca por referencias no codigo):

- referencias `weekly`: **71**
- referencias `daily`: **61**

Leitura: o motor diario existe, mas narrativa/contrato ainda misturam semanal e diario em superficies diferentes.

---

## 3) Metas numericas por onda

## Onda 1 (ate 2026-05-20)

- `legacy_feature_flags <= 32`
- `rtdb_access <= 60`
- `legacy_routes <= 3`
- `legacy_fallback_logs <= 16`
- Documento de fonte unica comercial em versao `v1`.

## Onda 2 (ate 2026-05-27)

- `legacy_feature_flags <= 20`
- `rtdb_access <= 40`
- `legacy_routes <= 2`
- `legacy_fallback_logs <= 10`
- Matriz de contrato por canal `v1` publicada.

## Onda 3 (ate 2026-06-03)

- `legacy_feature_flags <= 8`
- `rtdb_access <= 20`
- `legacy_routes = 0` (publicas)
- `legacy_fallback_logs <= 5`
- Fluxos criticos operando no contrato novo sem fallback de runtime legado.

## Fechamento (ate 2026-06-09)

- `legacy_feature_flags <= 5`
- `rtdb_access <= 12`
- `legacy_routes = 0`
- `legacy_fallback_logs <= 3`
- references `weekly <= 15` e sem contradicao com regra comercial final.

---

## 4) Frentes de trabalho (workstreams)

## WS1 - Fonte unica da verdade comercial

Objetivo: padronizar plano/taxa/isencao/retencao em uma regra oficial.

Entregas:

- `docs/business/FONTE_UNICA_VERDADE_COMERCIAL.md`
- `docs/business/GLOSSARIO_COMERCIAL_RUNTIME.md`
- tabela oficial de estados e semantica: `planType`, `dailyFeeCents`, `pendingFeeCents`, `collectionMode`, `isFeeExempt`, `feeExemptUntil`.

Aceite:

- Nenhum campo comercial muda de significado entre `app`, `dashboard` e `backend`.

## WS2 - Matriz de contrato por canal

Objetivo: explicitar para cada endpoint/tela/evento qual payload e regra comercial valem.

Entregas:

- `docs/business/MATRIZ_CONTRATO_CANAL_APP_DASH_BACKEND.md`
- inventario de payloads criticos:
  - auth (`/api/auth/password/*`, `/api/auth/otp/*`)
  - booking/pagamento
  - assinatura/saldo/saque
  - promocao/referral

Aceite:

- Toda alteracao de payload critico exige atualizacao da matriz.

## WS3 - Corte de legado (3 ondas)

Objetivo: remover trilhas legacy do runtime critico sem quebrar operacao.

Escopo tecnico:

- flags `ENABLE_LEGACY_*`
- rotas `/api/legacy/*`
- acessos diretos RTDB no hot path
- fallbacks de legado em fluxos criticos.

Aceite:

- Sem rota publica legacy ativa.
- Sem fallback legacy em fluxo critico de corrida/pagamento/auth.

## WS4 - Validacao e rollout seguro

Objetivo: cada onda entra com teste, evidencias e rollback claro.

Entregas:

- checklists por onda
- evidencias de teste automatizado
- relatorio de regressao por onda em `docs/`.

Aceite:

- Zero regressao P0 (auth, booking, pagamento, localizacao, saque).

---

## 5) Cronograma fechado (datas absolutas)

## Fase 0 - Preparacao (2026-05-11 a 2026-05-13)

1. Congelar escopo do ciclo (sem features novas fora do plano).  
2. Publicar baseline oficial (legado + comercial).  
3. Definir donos por frente (WS1..WS4).  
4. Abrir board de execucao com cards por onda.

## Onda 1 - Normalizacao comercial + corte inicial (2026-05-14 a 2026-05-20)

1. Publicar `FONTE_UNICA_VERDADE_COMERCIAL.md` v1.  
2. Remover/fechar primeiras flags de legado fora de fluxo critico.  
3. Parar criacao de novos fallbacks legacy.  
4. Rodar suite minima obrigatoria e emitir relatorio Onda 1.

## Onda 2 - Matriz de contrato + migracao de superfices (2026-05-21 a 2026-05-27)

1. Publicar `MATRIZ_CONTRATO_CANAL_APP_DASH_BACKEND.md` v1.  
2. Ajustar inconsistencias semanal vs diario nas superfices de produto e APIs de leitura.  
3. Migrar bloco principal de acessos RTDB para fonte alvo definida no contrato.  
4. Rodar suite completa e emitir relatorio Onda 2.

## Onda 3 - Corte duro do legado publico (2026-05-28 a 2026-06-03)

1. Desativar rotas legacy publicas remanescentes.  
2. Remover fallback legacy dos fluxos criticos restantes.  
3. Fechar flags de compatibilidade nao essenciais.  
4. Rodar validacao de regressao e emitir relatorio Onda 3.

## Fechamento e hardening (2026-06-04 a 2026-06-09)

1. Auditoria final de superficie legada.  
2. Ajustes finais de contrato e comunicacao comercial.  
3. Go/No-Go final com evidencias.  
4. Publicar relatorio de encerramento do ciclo.

---

## 6) Checklist operacional por onda

## Comandos de controle (executar no inicio e no fim de cada onda)

```bash
# 1) baseline legado
node leaf-websocket-backend/scripts/ops/report-legacy-runtime-surface.cjs

# 2) guardas de runtime/producao backend
cd leaf-websocket-backend && npm run config:validate && npm run test:route-guards

# 3) guardas de runtime/producao mobile
cd mobile-app && npm run qa:production-guards

# 4) testes de contratos criticos backend
cd leaf-websocket-backend && npx jest --config config/jest.integration.config.js \
  tests/integration/contracts/create-booking-availability-precheck.contract.test.js \
  tests/integration/contracts/create-booking-payment-validation.contract.test.js \
  tests/integration/contracts/ride-lifecycle-contract.integration.test.js

# 5) regressao geral
cd /Users/izaakdias/Documents/Leaf-new && npm run test:all
```

## Evidencias minimas por onda

1. JSON do `report-legacy-runtime-surface`.  
2. Saida de `config:validate` e `qa:production-guards`.  
3. Resultado dos contratos criticos.  
4. Diff da matriz de contrato e da fonte unica comercial.  
5. Relatorio de decisao Go/No-Go.

---

## 7) Matriz de risco e resposta

## R1 - Regressao em auth/pagamento

- Mitigacao: contratos criticos obrigatorios por onda + rollback rapido.

## R2 - Equipe dispersar em novas features

- Mitigacao: freeze de escopo ate 2026-06-09.

## R3 - Semantica comercial continuar mista

- Mitigacao: PR bloqueado sem atualizar matriz de contrato e fonte unica.

## R4 - Legado voltar via atalhos

- Mitigacao: guard no CI para barrar novos `ENABLE_LEGACY_*` sem aprovacao.

---

## 8) Tracker de execucao (usar no dia a dia)

## Semana 1 (2026-05-11..2026-05-17)

- [ ] baseline oficial salvo em `docs/`
- [ ] fonte unica comercial v1 publicada
- [ ] primeira reducao de flags e fallback

## Semana 2 (2026-05-18..2026-05-24)

- [ ] matriz de contrato v1 publicada
- [ ] inconsistencias semanal vs diario reduzidas
- [ ] alvo Onda 1 batido

## Semana 3 (2026-05-25..2026-05-31)

- [ ] migracao principal de RTDB concluida nos fluxos criticos
- [ ] rotas legacy em desativacao
- [ ] alvo Onda 2 batido

## Semana 4 (2026-06-01..2026-06-07)

- [ ] rotas legacy publicas zeradas
- [ ] fallback legacy residual minimo
- [ ] alvo Onda 3 batido

## Fechamento (ate 2026-06-09)

- [ ] metas finais numericas batidas
- [ ] relatorio final de encerramento publicado
- [ ] semaforo atualizado para novo status

---

## 9) Regra de governanca (simples)

1. Reuniao diaria de 15 min por 30 dias (bloqueios e decisoes).  
2. Reuniao de gate ao final de cada onda (Go/No-Go).  
3. Nenhum merge de mudanca comercial sem atualizar:
   - fonte unica comercial
   - matriz de contrato por canal.

