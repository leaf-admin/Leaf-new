# Leaf Support Agent Orchestrator

Servico desacoplado para preparar a camada de agents de suporte da Leaf sem alterar o nucleo do backend atual.

## Objetivo

- Ler tickets, chat e fila de suporte pelas APIs ja existentes.
- Consultar somente playbook/base aprovada, sem internet livre.
- Classificar atendimento em N1/N2/N3, prioridade e categoria.
- Gerar sugestao de resposta e handoff para humano.
- Expor uma API pequena para o dashboard consumir status e analises.

## Como rodar

```bash
cd services/support-agent-orchestrator
cp .env.example .env
npm install
npm run dev
```

Por padrao o servico sobe em `http://localhost:3015`.

## Endpoints

- `GET /health`: healthcheck simples.
- `GET /v1/status`: status operacional do orquestrador.
- `GET /v1/runs`: ultimas execucoes de analise.
- `GET /v1/runs/:runId/actions`: acoes aprovadas/auditadas de uma execucao.
- `GET /v1/runs/:runId/audit`: trilha de auditoria da execucao.
- `POST /v1/runs/:runId/actions`: executa acao segura apos aprovacao humana.
- `GET /v1/tickets/:ticketId/analysis`: retorna analise existente ou cria uma analise sob demanda.
- `POST /v1/tickets/:ticketId/analyze`: força nova analise de um ticket.
- `GET /v1/tickets/:ticketId/actions`: acoes aprovadas/auditadas de um ticket.
- `GET /v1/tickets/:ticketId/audit`: trilha de auditoria do ticket.
- `POST /v1/tickets/:ticketId/actions`: executa acao segura a partir da ultima analise do ticket.
- `POST /v1/chat/analyze`: analisa uma conversa enviada pelo caller.

## Contrato de integracao

O contrato operacional esta documentado na secao `17. Orquestrador de Agents` de `../../docs/support/LEAF_SUPPORT_PLAYBOOK.md`.

Fluxo recomendado para o dashboard ou sistema de tickets:

1. Ao abrir um ticket, chamar `GET /v1/tickets/:ticketId/analysis`.
2. Exibir categoria, prioridade, confianca, flags de risco e referencias do playbook.
3. Tratar toda recomendacao como sugestao assistida e exigir acao humana.
4. Respeitar `recommendation.execution.autoSend=false` e `autoResolve=false`.
5. Para aplicar uma sugestao, chamar `POST /v1/runs/:runId/actions` com `approvedBy`, `action` e `idempotencyKey`.
6. Ao rotear, responder ou escalar, registrar `run.id`, `playbookVersion` e `confidence` no ticket.

Exemplo para chat em tempo real:

```bash
curl -X POST http://localhost:3015/v1/chat/analyze \
  -H "Content-Type: application/json" \
  -H "x-orchestrator-token: $SUPPORT_ORCHESTRATOR_TOKEN" \
  -d '{
    "userId": "user_123",
    "ticket": {
      "id": "SUP-123",
      "subject": "PIX pago mas app nao confirmou",
      "category": "payment",
      "metadata": {
        "bookingId": "booking_123",
        "paymentId": "pay_123",
        "chargeId": "charge_123"
      }
    },
    "messages": [
      {
        "senderType": "customer",
        "message": "Paguei no pix e ainda aparece aguardando pagamento."
      }
    ]
  }'
```

## Modo de seguranca

O contrato atual e sempre `guarded_copilot`. A variavel `SUPPORT_AUTONOMOUS_MODE` fica registrada como intencao/config solicitada, mas nao libera resposta ao cliente, autoresolucao ou mutacao externa. Ele nao executa acoes sensiveis nem responde automaticamente quando:

- a confianca fica abaixo de `SUPPORT_MIN_CONFIDENCE`;
- o assunto envolve seguranca, fraude, emergencia, vazamento, pagamento sensivel ou documento/KYC;
- o playbook nao cobre o caso;
- `SUPPORT_AUTONOMOUS_MODE=false`.

Mesmo com `SUPPORT_AUTONOMOUS_MODE=true`, o contrato atual continua em modo `guarded_copilot`: o orquestrador classifica, recomenda, audita e executa somente acoes seguras aprovadas por humano. Nao ha autosend para cliente nem autoresolve.

Toda analise persistida grava `audit.mode=guarded_copilot`, `audit.replay` e a lista de acoes bloqueadas. Um `POST /v1/tickets/:ticketId/analyze` gera replay auditado quando ja existe run anterior para o ticket.

## Acoes aprovadas

A execucao real fica restrita a duas acoes:

- `internal_note`: registra uma nota interna no ticket usando `messageType=internal_note`.
- `escalate_ticket`: escala o ticket com motivo revisado por humano.

Payload minimo:

```bash
curl -X POST http://localhost:3015/v1/runs/run_123/actions \
  -H "Content-Type: application/json" \
  -H "x-orchestrator-token: $SUPPORT_ORCHESTRATOR_TOKEN" \
  -d '{
    "action": "internal_note",
    "approvedBy": "agent@leaf.app.br",
    "message": "Cliente reportou PIX pendente. Validar paymentId no PSP antes da resposta.",
    "idempotencyKey": "SUP-123:internal-note:payment-check-v1"
  }'
```

O `idempotencyKey` evita execucao duplicada quando o dashboard repetir a chamada por timeout, reload ou retry.

Se uma acao falhar, a mesma `idempotencyKey` continua terminal e idempotente. Para tentar de novo apos corrigir o payload, gere uma nova chave com motivo claro, por exemplo `SUP-123:internal-note:payment-check-v2`.

## Runbook operacional

O runbook N0/N1/N2/N3 fica em `RUNBOOK.md` neste diretorio. Use ele para operacao, replay, recuperacao de store persistido e criterios de escalonamento.

## Fontes permitidas

- Playbook versionado em `docs/support/LEAF_SUPPORT_PLAYBOOK.md`.
- APIs internas Leaf.
- Chat/tickets/fila existentes.
- Redis/Socket.IO internos quando habilitados.
- Logs, metricas e traces internos quando a camada de ingestao for conectada.

Nao ha web search neste servico.
