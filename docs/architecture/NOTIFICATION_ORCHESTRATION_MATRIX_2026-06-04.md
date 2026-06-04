# Notification Orchestration Matrix

Data: 2026-06-04

## Objetivo

Definir a camada operacional de notificacoes automaticas da Leaf sem alterar backend, mobile ou gerar nova build nesta rodada.

Este documento vira o contrato de produto para uma implementacao futura:

- notificacoes transacionais do ciclo de vida do app;
- notificacoes persistidas dentro do app;
- push FCM para passageiro e motorista;
- preparacao para smart push/ML quando houver dados suficientes.

## Principios

1. Notificacao transacional e diferente de notificacao comportamental.
2. Push nunca deve ser disparado direto de varios pontos do codigo sem orquestracao.
3. Toda notificacao precisa ter idempotencia, dedupe e janela de validade.
4. O app deve funcionar mesmo se push falhar.
5. Smart push por ML deve sugerir, nao decidir sozinho no primeiro rollout.
6. Nenhuma notificacao deve aumentar chamadas pagas externas sem necessidade.
7. Eventos sensiveis precisam de auditoria e fallback operacional.

## Canais

| Canal | Uso | Observacao |
| --- | --- | --- |
| Push FCM | Avisos urgentes ou relevantes fora do app | Requer token valido e permissao |
| Notificacao persistida | Historico dentro do app | Fonte de verdade para o usuario ver depois |
| In-app realtime | Estado vivo durante corrida | Preferir socket quando usuario esta com app aberto |
| Backoffice alert | Operacao interna | Suporte, cadastro, risco, pagamento |
| Email | Recibo, boas-vindas e comunicacoes formais | Nao substitui push de evento urgente |

## Severidade

| Nivel | Nome | Quando usar | Quiet hours |
| --- | --- | --- | --- |
| P0 | Critico | Seguranca, conta bloqueada, corrida ativa, pagamento critico | Pode furar |
| P1 | Alta | Evento do ciclo de corrida, motorista aprovado, documento pendente | Pode furar se operacional |
| P2 | Normal | Recibo, campanha relevante, status de chamado | Respeita |
| P3 | Baixa | Educacional, dicas, marketing leve | Respeita sempre |

## Matriz de eventos transacionais

| Evento | Publico | Push | Persistida | Prioridade | Dedupe/idempotencia | Janela | Fallback |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `auth.otp_requested` | Passageiro/motorista | Nao | Opcional | P3 | telefone + janela 5 min | 5 min | Tela de OTP |
| `auth.login_sensitive` | Passageiro/motorista | Sim se risco | Sim | P1 | usuario + device + hora | 10 min | Suporte/conta |
| `account.created` | Passageiro/motorista | Opcional | Sim | P2 | usuario | 24 h | Inbox |
| `driver.docs_pending` | Motorista | Sim | Sim | P1 | motorista + tipo_doc | 48 h | Dashboard cadastro |
| `driver.docs_rejected` | Motorista | Sim | Sim | P1 | motorista + tipo_doc + revisao | 48 h | Suporte/cadastro |
| `driver.approved` | Motorista | Sim | Sim | P1 | motorista + versao_aprovacao | 7 dias | Dashboard cadastro |
| `driver.waitlist_position_changed` | Motorista | Sim se relevante | Sim | P2 | motorista + posicao | 24 h | Waitlist |
| `ride.requested` | Passageiro | Nao se app aberto | Sim | P2 | bookingId | 15 min | Card app |
| `ride.offer_sent` | Motorista | Sim | Sim | P0 | bookingId + driverId | TTL oferta | Reoferta/busca |
| `ride.offer_expired` | Motorista | Nao | Sim | P2 | bookingId + driverId | 15 min | Busca continua |
| `ride.accepted` | Passageiro | Sim | Sim | P0 | bookingId + status | Corrida ativa | Card app |
| `ride.driver_en_route` | Passageiro | Sim se app fechado | Sim | P1 | bookingId + status | Corrida ativa | Card app |
| `ride.driver_arrived` | Passageiro | Sim | Sim | P0 | bookingId + status | Corrida ativa | Card app |
| `ride.started` | Passageiro/motorista | Sim se app fechado | Sim | P1 | bookingId + status | Corrida ativa | Card app |
| `ride.completed` | Passageiro/motorista | Sim | Sim | P1 | bookingId + status | 24 h | Recibo |
| `ride.cancelled` | Passageiro/motorista | Sim | Sim | P1 | bookingId + status | 24 h | Suporte |
| `payment.pix_created` | Passageiro | Nao se tela aberta | Sim | P1 | paymentId + bookingId | TTL PIX | Tela Pix |
| `payment.pix_approved` | Passageiro | Sim se app fechado | Sim | P0 | paymentId + bookingId | 15 min | Busca motorista |
| `payment.pix_expired` | Passageiro | Sim | Sim | P1 | paymentId | 30 min | Recriar Pix |
| `payment.pix_failed` | Passageiro | Sim | Sim | P1 | paymentId + erro_normalizado | 30 min | Tentar novamente |
| `receipt.available` | Passageiro/motorista | Opcional | Sim | P2 | bookingId + receiptId | 7 dias | Tela recibo |
| `support.chat_message` | Passageiro/motorista | Sim | Sim | P1 | conversationId + messageId | 24 h | Inbox suporte |
| `support.ticket_updated` | Passageiro/motorista | Sim se acao requerida | Sim | P2 | ticketId + status | 7 dias | Suporte |
| `support.ticket_resolved` | Passageiro/motorista | Opcional | Sim | P2 | ticketId + status | 7 dias | Suporte |
| `campaign.in_app_available` | Passageiro/motorista | Nao por default | Sim/in-app | P3 | campaignId + userId | campanha | Campaign center |
| `safety.identity_recheck_required` | Motorista | Sim fora de corrida | Sim | P0 | motorista + challengeId | 24 h | Soft block/suporte |

## Regras de dedupe

| Tipo | Chave sugerida | TTL |
| --- | --- | --- |
| Corrida/status | `notification:ride:{bookingId}:{status}:{userId}` | 24 h |
| Oferta motorista | `notification:offer:{bookingId}:{driverId}` | TTL da oferta |
| Pagamento | `notification:payment:{paymentId}:{status}:{userId}` | 24 h |
| Documento | `notification:driver-doc:{driverId}:{docType}:{revision}` | 72 h |
| Suporte | `notification:support:{ticketId}:{status}:{userId}` | 24 h |
| Campanha | `notification:campaign:{campaignId}:{userId}` | Janela da campanha |
| ML/smart push | `notification:ml:{modelVersion}:{recommendationId}:{userId}` | Definido pela campanha |

## Quiet hours e rate limit

| Categoria | Regra |
| --- | --- |
| Corrida ativa | Pode enviar a qualquer hora enquanto a corrida esta ativa |
| Pagamento Pix | Pode enviar enquanto o pagamento esta em aberto ou acabou de mudar status |
| KYC/safety | Pode enviar se bloqueia operacao, nunca durante corrida em andamento |
| Suporte | Pode enviar se ha resposta ou acao pendente |
| Campanha/marketing | Respeitar quiet hours e opt-out |
| ML/smart push | Respeitar quiet hours, opt-out, frequencia maxima e score minimo |

Rate limit inicial recomendado:

- maximo 3 pushes de marketing/comportamental por usuario por semana;
- maximo 1 smart push por usuario por dia;
- maximo 1 lembrete de documento pendente por dia;
- sem limite artificial para eventos P0 de corrida ativa, mas sempre com dedupe por status.

## Contrato futuro para smart push/ML

O modelo de ML nao deve chamar FCM diretamente. Ele deve criar uma recomendacao para a camada de orquestracao avaliar.

Payload conceitual:

```json
{
  "recommendationId": "ml-20260604-user-123-h3-abc",
  "modelVersion": "leaf-demand-v0.1",
  "userId": "user_123",
  "userType": "driver",
  "surface": "push",
  "intent": "demand_hint",
  "score": 0.82,
  "reason": "Alta chance de corrida nos proximos 20 minutos perto da sua area usual",
  "validFrom": "2026-06-04T18:00:00.000Z",
  "validUntil": "2026-06-04T18:20:00.000Z",
  "quietHoursEligible": false,
  "campaignId": null,
  "h3Cell": "89a8a...",
  "metadata": {
    "expectedLift": 0.12,
    "confidence": "medium"
  }
}
```

Decisao da orquestracao:

| Checagem | Resultado esperado |
| --- | --- |
| Usuario tem opt-out? | Suprime |
| Usuario esta em corrida? | Suprime smart push |
| Score abaixo do minimo? | Suprime |
| Ja recebeu smart push hoje? | Suprime |
| Janela expirada? | Suprime |
| Push permitido? | Envia e persiste |
| Push falhou? | Persiste erro e nao reenvia em loop |

## Feedback loop

Toda notificacao enviada deve registrar, quando disponivel:

- `queued`;
- `sent`;
- `delivered`;
- `opened`;
- `actioned`;
- `dismissed`;
- `suppressed`;
- `failed`;
- motivo de falha/supressao.

Para ML, esses eventos alimentam treino/avaliacao futura, mas nao devem ativar envio automatico sem revisao operacional.

## Backoffice necessario

Painel minimo:

- total enviado por tipo;
- falhas por tipo e plataforma;
- taxa de abertura;
- taxa de acao;
- top motivos de supressao;
- custo estimado de envio, quando aplicavel;
- filtros por periodo, usuario, tipo de evento e publico;
- modo dry-run para smart push.

## Criterios de aceite da implementacao futura

1. Existe uma camada unica de orquestracao.
2. Eventos criticos usam chaves idempotentes.
3. Push e notificacao persistida sao tratados como canais separados.
4. O app nao depende de push para funcionar em corrida ativa.
5. Dashboard mostra envio, falha e supressao.
6. Smart push entra primeiro em dry-run.
7. Nenhum modelo de ML dispara notificacao direta.
8. Nenhuma chamada externa paga e feita pelo dashboard para montar estas metricas.

## Relacao com tickets

- `LEA-16`: hardening FCM.
- `LEA-80`: modelo v0 de predicao de demanda e smart push.
- `LEA-93`: orquestracao do ciclo de vida e preparacao para smart push.

## Estado desta rodada

Somente documentacao e decisao operacional.

Nao houve:

- alteracao de backend;
- alteracao de mobile;
- build nova;
- deploy;
- chamada externa paga.
