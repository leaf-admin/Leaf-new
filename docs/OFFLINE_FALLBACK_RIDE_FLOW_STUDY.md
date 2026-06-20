# Estudo: fallback local para corrida com perda de internet ou bateria

## Objetivo

Definir onde faz sentido ter fallback local no aparelho do passageiro e do motorista sem enfraquecer o backend como fonte de verdade para pagamento, despacho, aceite, inicio, fim, tarifas e seguranca.

## Principio central

O app pode armazenar o ultimo estado conhecido e enfileirar intencoes locais, mas nao deve confirmar transacoes criticas sozinho.

Estados financeiros e transacionais continuam backend-canonicos:

- pagamento confirmado;
- motorista aceitou;
- motorista chegou;
- corrida iniciou;
- corrida finalizou;
- cancelamento com impacto financeiro;
- reembolso;
- split, taxa Leaf e liquido do motorista.

## Onde o fallback local faz sentido

### Passageiro durante corrida ativa

Manter localmente:

- booking id;
- status canonico mais recente;
- motorista, veiculo, placa e cor;
- endereco de embarque/destino;
- valor bruto pago;
- taxa/recibo quando ja recebido;
- ultima localizacao conhecida do motorista com timestamp;
- rota e polyline validas mais recentes;
- canal de suporte e instrucoes de seguranca.

Comportamento recomendado:

- Se ficar offline, mostrar estado atual com indicador claro de conexao perdida.
- Nao permitir nova corrida enquanto houver corrida ativa local nao reconciliada.
- Permitir abrir suporte, ligar para motorista e ver recibo ja recebido.
- Permitir criar uma intencao de cancelamento local, mas marcar como "pendente de sincronizacao" ate ack do backend.
- Se motorista ficar sem atualizar localizacao, exibir "ultima atualizacao ha X min" em vez de mover marcador de forma inventada.

### Motorista durante corrida ativa

Manter localmente:

- booking id;
- status canonico mais recente;
- passageiro e enderecos;
- valor liquido esperado;
- rota atual;
- checkpoints ja confirmados pelo backend;
- buffer de localizacao com timestamps.

Comportamento recomendado:

- Continuar gravando pontos de GPS em buffer local quando a internet cair.
- Ao reconectar, enviar lote de localizacoes com idempotency key, sequence number e timestamp.
- Acoes de chegada, inicio e finalizacao podem ser registradas localmente como intencao, mas so viram estado final apos ack do backend.
- Nao permitir aceite de nova corrida offline.
- Nao permitir alterar valor, taxa ou recibo offline.

### Perda de bateria

Nao existe fallback real no aparelho desligado. O sistema deve tratar por heartbeat backend:

- Se motorista para de enviar heartbeat durante corrida ativa, passageiro ve estado "sinal do motorista perdido" com tempo da ultima atualizacao.
- Backend pode acionar politica de seguranca/suporte apos TTL.
- Ao reabrir app, motorista e passageiro hidratam do backend pelo booking id ativo.
- Se o backend ja concluiu/cancelou a corrida, o app deve aceitar o estado mais novo e limpar estado local antigo.

## Onde o fallback local nao deve existir

- Confirmar Pix offline.
- Criar recibo final offline.
- Aceitar corrida offline.
- Iniciar/finalizar corrida como definitivo sem ack backend.
- Recalcular tarifa localmente para substituir a cotacao backend.
- Aplicar taxa, split, reembolso ou saldo de motorista localmente.
- Chamar provider pago diretamente pelo app.

## Modelo tecnico recomendado

### Local ride snapshot

Persistir um snapshot por usuario/dispositivo:

```json
{
  "bookingId": "booking_123",
  "role": "passenger",
  "canonicalStatus": "started",
  "serverVersion": 42,
  "lastServerEventAt": "2026-06-20T09:00:00.000Z",
  "lastLocalSeenAt": "2026-06-20T09:00:05.000Z",
  "financialSnapshot": {
    "grossAmount": 76.95,
    "leafFee": 2.93,
    "driverNet": 74.02,
    "currency": "BRL"
  },
  "routeSnapshot": {
    "polylineSource": "backend_routes",
    "trafficSegments": []
  }
}
```

### Outbox idempotente

Toda intencao local precisa de:

- `idempotencyKey`;
- `bookingId`;
- `userId`;
- `role`;
- `eventType`;
- `clientSequence`;
- `clientCreatedAt`;
- payload minimo;
- status `pending`, `acked` ou `rejected`.

O backend deve rejeitar evento fora de ordem ou incompatível com o estado canonico.

### Resolucao de conflito

- Backend sempre vence em estados canonicos.
- App pode mostrar "sincronizando" quando uma intencao local ainda nao foi aceita.
- Se backend rejeitar, app deve mostrar estado canonico atualizado e registrar erro tecnico no relatorio/telemetria.
- Eventos duplicados devem ser tratados como sucesso idempotente quando o idempotency key ja foi processado.

## TTLs sugeridos

- Localizacao do motorista: stale visual apos 30 segundos sem atualizacao.
- Alerta de conexao ruim: apos 10 segundos offline durante corrida ativa.
- Buffer de localizacao: reter ate 24 horas ou ate ack completo.
- Snapshot de corrida ativa: reter ate backend confirmar `completed`, `cancelled` ou expiracao operacional.
- Recibo local: pode permanecer cacheado apos finalizacao.

## Estado atual do projeto

Ja existem bases uteis no mobile:

- `LocationBufferService`: buffer local de localizacao.
- `OfflinePersistenceService`: fila offline e persistencia de estado.
- `BackgroundLocationService`: tarefa de localizacao em background.
- `FCMNotificationService`: fila de notificacoes em background.
- `IntelligentCacheService`: cache de eventos/conectividade.

O que ainda falta para producao:

- Unificar snapshot canonico de corrida para passageiro e motorista.
- Adicionar outbox idempotente especifica para eventos de corrida.
- Exigir `serverVersion` ou sequencia monotônica nos eventos de corrida.
- Criar UI explicita de estado offline em corrida ativa.
- Testar reconexao com eventos pendentes e rejeicao backend.
- Definir politica operacional para motorista sem heartbeat.

## Plano recomendado

### P0

- Criar `RideLocalSnapshotService` para persistir o ultimo estado canonico por booking.
- Criar `RideEventOutboxService` com idempotency key e retry exponencial.
- Backend validar idempotencia e ordem para eventos `arrived`, `started`, `completed` e `cancel_requested`.
- UI de corrida ativa mostrar conexao perdida sem regredir estado.
- Testes unitarios de conflito: evento local antigo nao pode sobrescrever estado backend mais novo.

### P1

- Flush de buffer de localizacao com lote e sequencia.
- Indicador de ultima localizacao do motorista para passageiro.
- Monitor backend de heartbeat ausente em corrida ativa.
- Playbook de suporte para corrida com motorista sem sinal.

### P2

- Simulacao automatizada de airplane mode no smoke Android.
- Painel dashboard para corridas com eventos offline pendentes/rejeitados.
- Alertas operacionais por taxa de reconexao, fila local e eventos rejeitados.

## Criterio de aceite

O fallback local so deve ser considerado pronto quando:

- uma corrida ativa nao some nem regride visualmente ao ficar offline;
- nenhum evento financeiro ou transacional e confirmado sem backend;
- reconexao sincroniza eventos idempotentes sem duplicar cobranca, recibo ou saldo;
- app relancado hidrata backend e descarta snapshot local mais antigo;
- passageiro e motorista sempre entendem se o dado exibido e atual ou ultimo conhecido.
