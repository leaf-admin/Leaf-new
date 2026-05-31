# Leaf Support Agent Orchestrator Runbook

Runbook operacional para o `leaf-support-agent-orchestrator` apos LEA-75.

## Contrato atual

- Modo unico de execucao: `guarded_copilot`.
- `SUPPORT_AUTONOMOUS_MODE` e registrado em auditoria como pedido de config, mas nao libera autosend, autoresolve ou fechamento.
- Acoes externas permitidas apenas apos aprovacao humana: `internal_note` e `escalate_ticket`.
- Toda chamada de acao precisa de `approvedBy` e `idempotencyKey`.
- Internet livre, mutacao direta em banco/Redis/Firebase/PSP e acesso a documentos completos seguem proibidos.

## Operacao N0/N1/N2/N3

### N0: ingestao e pre-triagem

Objetivo: normalizar ticket/chat e preparar contexto.

Pode:

- ler ticket, mensagens recentes e metadata operacional mascarada;
- criar uma run com `GET /v1/tickets/:ticketId/analysis` ou `POST /v1/chat/analyze`;
- registrar `run.id`, `confidence`, `riskFlags`, `supportTier` e referencias do playbook no ticket.

Nao pode:

- responder usuario;
- resolver ou fechar ticket;
- executar acao externa sem aprovacao humana.

### N1: atendimento assistido

Objetivo: responder duvidas simples com macro/playbook e coletar contexto.

Pode:

- usar sugestao do `n1-agent` como rascunho;
- pedir detalhe objetivo ao usuario;
- aprovar `internal_note` para registrar triagem;
- escalar para N2 quando houver pagamento, KYC, bug, corrida presa ou dados insuficientes.

Nao pode:

- aprovar/rejeitar documentos;
- prometer reembolso, ajuste financeiro, desbloqueio ou punicao;
- enviar resposta automatica sem revisao.

### N2: operacao especializada

Objetivo: validar pagamento, KYC, corrida, app, campanha e estados operacionais.

Pode:

- usar recomendacao do `n2-router` para roteamento;
- validar IDs operacionais em sistemas aprovados;
- aprovar `escalate_ticket` com motivo objetivo;
- pedir replay com `POST /v1/tickets/:ticketId/analyze` apos nova evidencia.

Nao pode:

- mutar producao fora dos runbooks aprovados;
- fazer correcao financeira sem trilha idempotente e aprovacao do processo financeiro.

### N3: engenharia, safety, security e risco

Objetivo: diagnosticar incidente, fraude, safety, LGPD, falha sistemica ou estado impossivel.

Pode:

- usar checklist do `n3-diagnostics`;
- correlacionar logs, traces e incidentes;
- acionar safety/security/legal conforme politica;
- abrir plano de mitigacao e registrar decisoes.

Nao pode:

- deixar o orquestrador corrigir producao sozinho;
- expor ao app motivo sensivel de revalidacao ou investigacao.

## Replay auditado

Use replay quando chegar nova evidencia, mensagem relevante ou ajuste de playbook.

```bash
curl -X POST "$SUPPORT_ORCHESTRATOR_URL/v1/tickets/SUP-123/analyze" \
  -H "x-orchestrator-token: $SUPPORT_ORCHESTRATOR_TOKEN"
```

Resultado esperado:

- nova run com `audit.replay.isReplay=true`;
- `audit.replay.previousRunId` apontando para a run anterior;
- evento persistido `run_replayed` em `/v1/tickets/:ticketId/audit`;
- sem execucao automatica de resposta ou resolucao.

Se o replay nao apontar para run anterior, confirme se o ticket ja tinha run persistida em `SUPPORT_STORE_PATH`.

## Idempotencia de acoes aprovadas

Padrao recomendado de chave:

```text
<ticketId>:<action>:<reason-or-playbook-step>:v<N>
```

Exemplos:

- `SUP-123:internal-note:pix-check:v1`
- `SUP-123:escalate:n2-payments:v1`

Regras:

- repetir a mesma chave nunca reexecuta a acao;
- se a primeira tentativa falhou, a mesma chave retorna a falha anterior;
- para retry apos corrigir payload, use nova chave versionada e registre motivo;
- timeouts do dashboard devem repetir a mesma chave ate receber resposta.

## Auditoria persistida

Store padrao:

```text
services/support-agent-orchestrator/.data/support-orchestrator-store.json
```

O arquivo persiste:

- `runs`;
- `actions`;
- `auditEvents`.

Endpoints uteis:

- `GET /v1/runs/:runId/audit`
- `GET /v1/tickets/:ticketId/audit`
- `GET /v1/runs/:runId/actions`
- `GET /v1/tickets/:ticketId/actions`

Checklist de investigacao:

1. Consultar `/audit` do ticket.
2. Confirmar `mode=guarded_copilot`.
3. Confirmar `autoSend=false` e `autoResolve=false`.
4. Validar se houve `run_replayed` apos nova evidencia.
5. Validar se a acao aplicada tem `approvedBy` e `idempotencyKey`.
6. Comparar `playbookVersion` da run com o playbook vigente.

## Incidentes e rollback operacional

Se houver sugestao incorreta:

1. Parar uso operacional do dashboard para aquela categoria.
2. Consultar `/v1/tickets/:ticketId/audit`.
3. Abrir replay com nova evidencia.
4. Corrigir playbook antes de reabilitar a categoria.

Se houver acao duplicada:

1. Verificar se o caller enviou `idempotencyKey`.
2. Buscar `/actions` por ticket.
3. Confirmar se a duplicidade veio de chaves diferentes.
4. Corrigir caller/runbook para chave estavel.

Se houver store corrompido:

1. Parar o servico.
2. Fazer backup do JSON atual.
3. Restaurar ultimo backup valido.
4. Subir o servico e consultar `/v1/status`.
5. Reexecutar replay apenas nos tickets afetados.

## Health e smoke

```bash
npm run check
npm test
curl "$SUPPORT_ORCHESTRATOR_URL/health"
curl "$SUPPORT_ORCHESTRATOR_URL/v1/status" \
  -H "x-orchestrator-token: $SUPPORT_ORCHESTRATOR_TOKEN"
```

Aceite minimo:

- `/v1/status.mode` igual a `guarded_copilot`;
- `/v1/status.execution.autoSend=false`;
- `/v1/status.execution.autoResolve=false`;
- testes do pacote passando;
- store gravando `auditEvents` apos analise e acao aprovada.
