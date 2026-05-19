# Backlog de Seguranca e Safety - Pos Aprovacao das Lojas

Data: 2026-04-27  
Status: Congelado para app review (Apple/Google)  
Regra: Nao executar alteracoes deste backlog antes da aprovacao dos apps nas lojas.

---

## Objetivo

Registrar as correcoes de seguranca/safety ja identificadas, com prioridade e criterio de aceite, para execucao controlada apos aprovacao nas lojas, evitando qualquer impacto no processo de review atual.

---

## Gate de Execucao

- Gate unico: iniciar somente apos status "Approved" na Apple App Store e Google Play.
- Durante review: permitido apenas documentacao, observacao e preparo de plano.
- Fora do gate: proibido alterar runtime, segredos, contratos de auth/OTP, CORS, webhook validation, compose e pipelines de deploy.

---

## P0 - Critico (executar primeiro)

1. secret-leak-keystore-git-history
- Contexto: senha de keystore Android em texto claro versionada.
- Escopo:
  - rotacionar keystore/senhas afetadas;
  - migrar para secrets CI/EAS e variaveis locais ignoradas;
  - remover segredos do historico Git (rewrite + force push coordenado).
- Aceite:
  - nenhum segredo em texto claro no repositorio/historico;
  - build/release funcionando com secrets externos;
  - evidencias de rotacao registradas em runbook interno.

2. woovi-webhook-signature-production-enforcement
- Contexto: ambiente de producao sem enforcement robusto de validacao de webhook.
- Escopo:
  - tornar validacao obrigatoria no runtime de producao;
  - manter `validate-runtime-config` como gate bloqueante de deploy;
  - ajustar documentacao conforme modelo oficial da Woovi/OpenPix adotado no projeto.
- Modelo adotado:
  - em producao, o webhook deve chegar assinado e validado por `WOOVI_WEBHOOK_PUBLIC_KEY` ou `WOOVI_WEBHOOK_SIGNATURE_SECRET`;
  - `WOOVI_WEBHOOK_REQUIRE_SIGNATURE=true` e `WOOVI_WEBHOOK_ALLOW_UNSIGNED=false` sao obrigatorios em deploy publico;
  - webhook sem assinatura fica permitido apenas fora de producao, para sandbox/desenvolvimento controlado.
- Aceite:
  - deploy bloqueia se variaveis/validacoes obrigatorias nao estiverem presentes;
  - webhook invalido e rejeitado com log auditavel;
  - webhook valido segue processamento normal.

---

## P1 - Alto (executar apos P0)

3. docker-compose-production-insecure-defaults
- Contexto: defaults inseguros no compose de producao (senha redis hardcoded, CORS wildcard, fallback JWT).
- Escopo:
  - remover hardcoded secrets e fallbacks inseguros;
  - tornar variaveis obrigatorias e fail-fast no boot;
  - revisar exemplos para evitar reuso acidental inseguro.
- Aceite:
  - compose nao sobe em modo producao sem env obrigatoria;
  - nenhum fallback inseguro ativo para prod.

4. cors-base-whitelist-runtime-alignment
- Contexto: risco de host de producao nao refletido na whitelist base.
- Escopo:
  - alinhar whitelist base ao host runtime vigente e dominios oficiais;
  - bloquear origens privadas/ngrok por padrao em producao.
- Aceite:
  - dashboard/mobile com CORS estavel no host oficial;
  - origens nao autorizadas bloqueadas.

5. tracer-null-safe-end-ride-review
- Contexto: fluxo pode quebrar quando tracer nao estiver inicializado.
- Escopo:
  - fallback defensivo para `getTracer()` indefinido;
  - manter execucao da regra de negocio sem crash.
- Aceite:
  - testes unitarios passando para cenario sem tracer;
  - fluxo de encerramento com review permanece funcional.

---

## P1 - Safety e Operacao (complementar)

6. security-ci-guardrails
- Escopo: adicionar scanner de segredo em commit/CI e bloquear pipeline quando houver vazamento.
- Aceite: push/pipeline falham automaticamente para segredo detectado.

7. deploy-parity-hardening
- Escopo: corrigir verificacoes de paridade de VPS/host atual e checks de hash confiavel.
- Aceite: script de paridade valida host correto e retorna status confiavel.

8. safety-runbook-and-rollback
- Escopo: atualizar runbook de incidentes de safety, rollback e comunicacao operacional.
- Aceite: checklist de incidente testado em simulacao.

---

## Ordem Recomendada de Execucao (apos lojas)

Wave 1 (P0): itens 1 e 2  
Wave 2 (P1 runtime): itens 3, 4 e 5  
Wave 3 (operacao/guardrails): itens 6, 7 e 8

Cada wave exige:
- deploy controlado,
- smoke backend,
- 1 corrida E2E release,
- monitoramento de erro e rollback pronto.

---

## Observacao

Este documento foi criado para preservar estabilidade durante review das lojas. Nenhum item acima deve ser aplicado antes da aprovacao final Apple/Google.
