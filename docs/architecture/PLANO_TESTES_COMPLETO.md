# 📋 PLANO DE TESTES COMPLETO - LEAF APP
## Modelo de Negócio: Uber/99 (Pagamento Apenas PIX)

---

## 📊 **MATRIZ DE PARÂMETROS POR CATEGORIA**

### **⏱️ TIMEOUTS**
| Parâmetro | Descrição | Valor Sugerido | Onde Aplicar |
|-----------|-----------|----------------|--------------|
| `RIDE_REQUEST_TIMEOUT` | Tempo máximo para driver responder (aceitar/recusar) | ? segundos | Cenários 4, 5 |
| `NO_SHOW_TIMEOUT_DRIVER` | Tempo de espera do driver no pickup antes de considerar no-show | ? minutos | Cenário 7 |
| `NO_SHOW_TIMEOUT_CUSTOMER` | Tempo de espera do customer no pickup antes de considerar no-show | ? minutos | Cenário 7 |
| `PAYMENT_PIX_TIMEOUT` | Tempo para pagamento PIX expirar (QR Code) | ? minutos | Cenário 11 |
| `WEBSOCKET_RECONNECT_TIMEOUT` | Tempo para tentar reconexão após queda | ? segundos | Cenário 1, 14 |
| `GPS_UPDATE_INTERVAL` | Intervalo entre atualizações de localização | ? segundos | Cenário 2, 9 |
| `HEARTBEAT_INTERVAL` | Intervalo de heartbeat/presença | ? segundos | Cenário 2 |
| `REASSIGN_DELAY` | Tempo de espera antes de reatribuir corrida | ? segundos | Cenário 6 |

### **📏 RAIOS E DISTÂNCIAS**
| Parâmetro | Descrição | Valor Sugerido | Onde Aplicar |
|-----------|-----------|----------------|--------------|
| `DRIVER_SEARCH_RADIUS_INITIAL` | Raio inicial de busca de drivers (km) | ? km | Cenário 3 |
| `DRIVER_SEARCH_RADIUS_EXPAND` | Raio expandido se não encontrar (km) | ? km | Cenário 3 |
| `PICKUP_PROXIMITY_RADIUS` | Raio mínimo para considerar "chegou no pickup" (metros) | ? metros | Cenário 8 |
| `LOCATION_ACCURACY_THRESHOLD` | Precisão mínima aceitável do GPS (metros) | ? metros | Cenário 2, 9 |

### **💰 VALORES E LIMITES**
| Parâmetro | Descrição | Valor Sugerido | Onde Aplicar |
|-----------|-----------|----------------|--------------|
| `MINIMUM_FARE` | Tarifa mínima da corrida | R$ ? | Cenário 3, 10 |
| `MAXIMUM_FARE` | Tarifa máxima (proteção anti-fraude) | R$ ? | Cenário 3, 10 |
| `FARE_DIVERGENCE_THRESHOLD` | Diferença aceitável entre estimada e final (%) | ? % | Cenário 10 |
| `CANCEL_FEE_DRIVER` | Taxa de cancelamento pelo driver (se aplicável) | R$ ? | Cenário 7 |
| `CANCEL_FEE_CUSTOMER` | Taxa de cancelamento pelo customer (se aplicável) | R$ ? | Cenário 7 |
| `NO_SHOW_FEE` | Taxa de no-show | R$ ? | Cenário 7 |

### **🎯 REGRAS DE NEGÓCIO**
| Parâmetro | Descrição | Valor Sugerido | Onde Aplicar |
|-----------|-----------|----------------|--------------|
| `MAX_RECUSAS_DRIVER` | Número máximo de recusas consecutivas antes de penalizar | ? recusas | Cenário 5 |
| `MAX_CANCELAMENTOS_DRIVER` | Número máximo de cancelamentos por período | ? cancelamentos / ? horas | Cenário 7 |
| `MAX_CANCELAMENTOS_CUSTOMER` | Número máximo de cancelamentos por período | ? cancelamentos / ? horas | Cenário 7 |
| `REASSIGN_MAX_ATTEMPTS` | Número máximo de tentativas de reatribuição | ? tentativas | Cenário 6 |
| `RATING_MIN_STARS` | Avaliação mínima para driver continuar ativo | ? estrelas | Cenário 12 |

### **🔔 NOTIFICAÇÕES E ALERTAS**
| Parâmetro | Descrição | Valor Sugerido | Onde Aplicar |
|-----------|-----------|----------------|--------------|
| `NOTIFICATION_SOUND_ENABLED` | Habilitar som em notificações | true/false | Cenário 4 |
| `NOTIFICATION_VIBRATION_ENABLED` | Habilitar vibração | true/false | Cenário 4 |
| `ALERT_BEFORE_TIMEOUT` | Alerta X segundos antes do timeout expirar | ? segundos | Cenário 4, 5 |

---

## 🧪 **CENÁRIOS DE TESTE DETALHADOS**

---

### **1. AUTENTICAÇÃO E IDENTIDADE**

#### **TC-001: Login Driver - Primeiro Acesso**
- **Parâmetros Necessários:**
  - Nenhum específico (dados de login do driver)
- **Critérios de Aceite:**
  - Driver autenticado com sucesso
  - Evento `authenticated` recebido
  - Status inicial: `offline` ou `online` (configurável?)
- **Observações:**
  - Definir status inicial padrão após login

#### **TC-002: Login Customer - Primeiro Acesso**
- **Parâmetros Necessários:**
  - Nenhum específico (dados de login do customer)
- **Critérios de Aceite:**
  - Customer autenticado com sucesso
  - Evento `authenticated` recebido
- **Observações:**
  - Customer não recebe eventos de driver (filtragem)

#### **TC-003: Reconexão WebSocket Após Queda de Rede**
- **Parâmetros Necessários:**
  - `WEBSOCKET_RECONNECT_TIMEOUT`: ? segundos
  - `HEARTBEAT_INTERVAL`: ? segundos
- **Critérios de Aceite:**
  - Reconecta automaticamente dentro do timeout
  - Estado anterior preservado (corrida em andamento, status, etc.)
  - Eventos não duplicados após reconexão
- **Observações:**
  - Testar com corrida em diferentes estados (aguardando, em viagem, pagamento)

#### **TC-004: Sessão Simultânea em Múltiplos Dispositivos**
- **Parâmetros Necessários:**
  - Nenhum específico
- **Critérios de Aceite:**
  - Bloquear ou permitir? (definir política)
  - Se bloquear: desconectar dispositivo anterior
  - Se permitir: sincronizar estado entre dispositivos
- **Observações:**
  - Definir política de negócio

---

### **2. STATUS DO MOTORISTA E PRESENÇA**

#### **TC-005: Alternar Status Online/Offline**
- **Parâmetros Necessários:**
  - Nenhum específico
- **Critérios de Aceite:**
  - Status atualizado no servidor imediatamente
  - Evento `driverStatusChanged` recebido por outros componentes
  - Driver não recebe corridas quando `offline`
- **Observações:**
  - Verificar persistência em banco de dados

#### **TC-006: Alternar Status Available/Busy**
- **Parâmetros Necessários:**
  - Nenhum específico
- **Critérios de Aceite:**
  - Status `busy` bloqueia recebimento de novas corridas
  - Status `available` permite receber corridas
  - Transição automática após completar corrida? (definir regra)
- **Observações:**
  - Definir se `busy` é manual ou automático (após aceitar corrida)

#### **TC-007: Detecção de Presença/Heartbeat**
- **Parâmetros Necessários:**
  - `HEARTBEAT_INTERVAL`: ? segundos
  - Timeout de presença: ? segundos (sem heartbeat = offline?)
- **Critérios de Aceite:**
  - Heartbeat enviado a cada intervalo
  - Se ausente por X segundos, marca como `offline` automaticamente
  - Reconexão restaura presença
- **Observações:**
  - Definir se heartbeat é obrigatório ou opcional

#### **TC-008: Atualização de Localização em Tempo Real**
- **Parâmetros Necessários:**
  - `GPS_UPDATE_INTERVAL`: ? segundos
  - `LOCATION_ACCURACY_THRESHOLD`: ? metros
- **Critérios de Aceite:**
  - Localização atualizada no servidor a cada intervalo
  - Evento `locationUpdated` recebido
  - Perda temporária de GPS não quebra fluxo
- **Observações:**
  - Testar com GPS fraco/sem sinal

---

### **3. SOLICITAÇÃO DE CORRIDA**

#### **TC-009: Criar Booking - Rota Curta (< 5km)**
- **Parâmetros Necessários:**
  - Coordenadas de origem e destino
  - `MINIMUM_FARE`: R$ ?
  - `DRIVER_SEARCH_RADIUS_INITIAL`: ? km
- **Critérios de Aceite:**
  - Booking criado com sucesso
  - Valor calculado >= `MINIMUM_FARE`
  - Evento `bookingCreated` recebido pelo customer
  - Evento `newBookingAvailable` ou `rideRequest` recebido pelos drivers no raio
- **Observações:**
  - Verificar se tarifa mínima é aplicada

#### **TC-010: Criar Booking - Rota Longa (> 50km)**
- **Parâmetros Necessários:**
  - Coordenadas de origem e destino
  - `MAXIMUM_FARE`: R$ ? (se aplicável)
- **Critérios de Aceite:**
  - Booking criado com sucesso
  - Valor calculado corretamente (distância + tempo)
  - Se `MAXIMUM_FARE` existir, valor <= máximo
- **Observações:**
  - Verificar cálculo de tarifa por km/minuto

#### **TC-011: Criar Booking - Área com Baixa Cobertura**
- **Parâmetros Necessários:**
  - Coordenadas em área remota
  - `DRIVER_SEARCH_RADIUS_INITIAL`: ? km
  - `DRIVER_SEARCH_RADIUS_EXPAND`: ? km
- **Critérios de Aceite:**
  - Se não encontrar drivers no raio inicial, expande raio
  - Evento `noDriversAvailable` se não encontrar após expansão
  - Sugestões de alternativas apresentadas (se aplicável)
- **Observações:**
  - Definir quantas expansões de raio são permitidas

#### **TC-012: Validação de Endereços Inválidos**
- **Parâmetros Necessários:**
  - Endereço inválido ou coordenadas fora da área
- **Critérios de Aceite:**
  - Erro retornado ao customer
  - Booking não criado
  - Mensagem de erro clara
- **Observações:**
  - Definir área de cobertura (cidades atendidas)

#### **TC-013: Deduplicação de Solicitações Duplicadas**
- **Parâmetros Necessários:**
  - Timeout de deduplicação: ? segundos
- **Critérios de Aceite:**
  - Segunda solicitação idêntica (mesmo customer, mesma rota) em X segundos é ignorada
  - Apenas um booking criado
  - Mensagem informando que já existe solicitação ativa
- **Observações:**
  - Definir janela de tempo para considerar "duplicado"

---

### **4. DISTRIBUIÇÃO E NOTIFICAÇÃO AO DRIVER**

#### **TC-014: Notificação com App em Foreground**
- **Parâmetros Necessários:**
  - `NOTIFICATION_SOUND_ENABLED`: true/false
  - `NOTIFICATION_VIBRATION_ENABLED`: true/false
- **Critérios de Aceite:**
  - Card de corrida aparece imediatamente
  - Som/vibração acionados (se habilitados)
  - Dados normalizados corretamente (bookingId, pickup.add, drop.add, estimate)
- **Observações:**
  - Já validado com sucesso (confirmado pelo usuário)

#### **TC-015: Notificação com App em Background**
- **Parâmetros Necessários:**
  - `NOTIFICATION_SOUND_ENABLED`: true/false
  - `NOTIFICATION_VIBRATION_ENABLED`: true/false
- **Critérios de Aceite:**
  - Notificação push aparece
  - Ao abrir app, card de corrida aparece
  - Dados preservados e normalizados
- **Observações:**
  - Testar com diferentes estados do SO (iOS/Android)

#### **TC-016: Notificação com App Travado/Fechado**
- **Parâmetros Necessários:**
  - `RIDE_REQUEST_TIMEOUT`: ? segundos
- **Critérios de Aceite:**
  - Notificação push recebida
  - Ao abrir app, se dentro do timeout, corrida ainda disponível
  - Se timeout expirou, corrida não mais disponível
- **Observações:**
  - Definir comportamento quando app abre após timeout

#### **TC-017: Latência de Entrega da Notificação**
- **Parâmetros Necessários:**
  - SLA esperado: ? segundos (máximo)
- **Critérios de Aceite:**
  - Notificação chega em <= SLA
  - Medir tempo entre `createBooking` no servidor e `newBookingAvailable` no app
- **Observações:**
  - Medir em diferentes condições de rede

#### **TC-018: Alerta Antes do Timeout Expirar**
- **Parâmetros Necessários:**
  - `RIDE_REQUEST_TIMEOUT`: ? segundos
  - `ALERT_BEFORE_TIMEOUT`: ? segundos
- **Critérios de Aceite:**
  - Se driver não responder, alerta aparece X segundos antes do timeout
  - Contagem regressiva visível (se aplicável)
  - Após timeout, corrida expira e é reatribuída
- **Observações:**
  - Definir se alerta é opcional ou obrigatório

---

### **5. ACEITAÇÃO E RECUSA DO MOTORISTA**

#### **TC-019: Aceitar Corrida com Sucesso**
- **Parâmetros Necessários:**
  - Nenhum específico
- **Critérios de Aceite:**
  - Evento `rideAccepted` recebido pelo customer e servidor
  - Corrida bloqueada para outros drivers
  - Driver muda status para `busy` (se automático)
  - `currentBooking` preenchido com dados normalizados
- **Observações:**
  - Verificar idempotência (duplo clique não aceita duas vezes)

#### **TC-020: Tentativa de Aceitar Corrida Já Aceita**
- **Parâmetros Necessários:**
  - Nenhum específico
- **Critérios de Aceite:**
  - Erro retornado: "Corrida já aceita por outro driver"
  - Card removido da lista de disponíveis
  - Driver não recebe confirmação de aceitação
- **Observações:**
  - Testar condição de corrida (race condition)

#### **TC-021: Recusar Corrida com Motivo**
- **Parâmetros Necessários:**
  - Motivos disponíveis: ? (lista)
  - `MAX_RECUSAS_DRIVER`: ? recusas consecutivas
- **Critérios de Aceite:**
  - Evento `rideRejected` enviado ao servidor
  - Card removido da lista
  - Motivo registrado (se aplicável)
  - Se atingir `MAX_RECUSAS_DRIVER`, ação tomada? (alertar/bloquear)
- **Observações:**
  - Definir política de penalização por recusas

#### **TC-022: Timeout de Resposta do Driver**
- **Parâmetros Necessários:**
  - `RIDE_REQUEST_TIMEOUT`: ? segundos
- **Critérios de Aceite:**
  - Se driver não responder, corrida expira após timeout
  - Card removido automaticamente
  - Corrida disponível para reatribuição
- **Observações:**
  - Definir se timeout conta como recusa (para `MAX_RECUSAS_DRIVER`)

---

### **6. REATRIBUIÇÃO E FALLBACK**

#### **TC-023: Reatribuição Após Recusa**
- **Parâmetros Necessários:**
  - `REASSIGN_DELAY`: ? segundos
  - `REASSIGN_MAX_ATTEMPTS`: ? tentativas
- **Critérios de Aceite:**
  - Após recusa, aguarda `REASSIGN_DELAY` segundos
  - Corrida redistribuída para próximo driver no raio
  - Se não houver mais drivers, evento `noDriversAvailable`
- **Observações:**
  - Definir se aguarda ou redistribui imediatamente

#### **TC-024: Reatribuição Após Timeout**
- **Parâmetros Necessários:**
  - `RIDE_REQUEST_TIMEOUT`: ? segundos
  - `REASSIGN_DELAY`: ? segundos
- **Critérios de Aceite:**
  - Após timeout, corrida redistribuída automaticamente
  - Novo driver recebe notificação
  - Histórico de tentativas preservado
- **Observações:**
  - Evitar enviar para mesmo driver que já recusou

#### **TC-025: Reatribuição Após Cancelamento do Driver**
- **Parâmetros Necessários:**
  - `REASSIGN_DELAY`: ? segundos
  - `REASSIGN_MAX_ATTEMPTS`: ? tentativas
- **Critérios de Aceite:**
  - Corrida redistribuída após cancelamento
  - Customer notificado (se aplicável)
  - Se `REASSIGN_MAX_ATTEMPTS` atingido, cancelar booking?
- **Observações:**
  - Definir limite de tentativas antes de cancelar

#### **TC-026: Reatribuição Quando Driver Perde Conexão**
- **Parâmetros Necessários:**
  - `WEBSOCKET_RECONNECT_TIMEOUT`: ? segundos
  - `REASSIGN_DELAY`: ? segundos
- **Critérios de Aceite:**
  - Se driver desconecta após aceitar, aguarda timeout de reconexão
  - Se não reconectar, reatribui automaticamente
  - Customer notificado (se aplicável)
- **Observações:**
  - Definir se dá tempo de reconexão antes de reatribuir

---

### **7. CANCELAMENTOS**

#### **TC-027: Cancelamento pelo Customer - Antes do Início**
- **Parâmetros Necessários:**
  - `CANCEL_FEE_CUSTOMER`: R$ ? (se aplicável)
  - Taxa aplicada em quais casos? (antes/depois de X minutos?)
- **Critérios de Aceite:**
  - Booking cancelado
  - Taxa aplicada (se regra exigir)
  - Driver notificado (se já aceito)
  - Status atualizado para `cancelled`
- **Observações:**
  - Definir política de taxa: sempre? apenas após X minutos? nunca?

#### **TC-028: Cancelamento pelo Driver - Antes do Início**
- **Parâmetros Necessários:**
  - `CANCEL_FEE_DRIVER`: R$ ? (se aplicável)
  - `MAX_CANCELAMENTOS_DRIVER`: ? cancelamentos / ? horas
- **Critérios de Aceite:**
  - Booking cancelado
  - Customer notificado
  - Taxa aplicada ao driver (se regra exigir)
  - Corrida reatribuída (se aplicável)
  - Se atingir `MAX_CANCELAMENTOS_DRIVER`, ação tomada?
- **Observações:**
  - Definir política de penalização

#### **TC-029: No-Show do Customer (Driver Espera no Pickup)**
- **Parâmetros Necessários:**
  - `NO_SHOW_TIMEOUT_CUSTOMER`: ? minutos
  - `NO_SHOW_FEE`: R$ ?
- **Critérios de Aceite:**
  - Driver aguarda no pickup por X minutos
  - Se customer não aparecer, marca como no-show
  - Taxa `NO_SHOW_FEE` aplicada (se aplicável)
  - Driver pode cancelar após timeout
- **Observações:**
  - Definir como driver confirma "chegou no pickup"

#### **TC-030: No-Show do Driver (Customer Espera no Pickup)**
- **Parâmetros Necessários:**
  - `NO_SHOW_TIMEOUT_DRIVER`: ? minutos
  - `NO_SHOW_FEE`: R$ ? (ao driver?)
- **Critérios de Aceite:**
  - Customer aguarda no pickup por X minutos
  - Se driver não chegar, marca como no-show
  - Taxa aplicada ao driver (se aplicável)
  - Corrida reatribuída automaticamente
- **Observações:**
  - Definir como customer confirma "chegou no pickup"

#### **TC-031: Reembolso/Estorno PIX**
- **Parâmetros Necessários:**
  - Política de reembolso: quais casos? (cancelamento customer, no-show driver, etc.)
  - Prazo de reembolso: ? dias
- **Critérios de Aceite:**
  - Reembolso processado corretamente via PIX
  - Customer notificado
  - Valor correto (valor pago - taxas, se aplicável)
- **Observações:**
  - Definir casos em que reembolso é aplicável

---

### **8. INÍCIO DA VIAGEM**

#### **TC-032: Confirmar Embarque com Sucesso**
- **Parâmetros Necessários:**
  - `PICKUP_PROXIMITY_RADIUS`: ? metros
- **Critérios de Aceite:**
  - Driver confirma embarque apenas se estiver dentro do raio
  - Evento `tripStarted` emitido
  - Status atualizado para `in_progress`
  - Timestamp de início registrado
- **Observações:**
  - Validar se validação de proximidade é obrigatória ou opcional

#### **TC-033: Tentativa de Iniciar Sem Estar Próximo**
- **Parâmetros Necessários:**
  - `PICKUP_PROXIMITY_RADIUS`: ? metros
- **Critérios de Aceite:**
  - Erro retornado: "Você precisa estar próximo do ponto de embarque"
  - Corrida não inicia
  - Mensagem clara para driver
- **Observações:**
  - Definir se bloqueia ou apenas alerta

#### **TC-034: Iniciar Viagem Offline (Reconciliação)**
- **Parâmetros Necessários:**
  - `WEBSOCKET_RECONNECT_TIMEOUT`: ? segundos
- **Critérios de Aceite:**
  - Se app offline, estado salvo localmente
  - Ao reconectar, estado sincronizado
  - Viagem iniciada corretamente após reconexão
- **Observações:**
  - Testar persistência local (AsyncStorage/SQLite)

---

### **9. DURANTE A VIAGEM**

#### **TC-035: Atualização de Localização Contínua**
- **Parâmetros Necessários:**
  - `GPS_UPDATE_INTERVAL`: ? segundos
  - `LOCATION_ACCURACY_THRESHOLD`: ? metros
- **Critérios de Aceite:**
  - Localização atualizada a cada intervalo
  - Evento `locationUpdated` enviado ao servidor
  - Customer vê posição do driver em tempo real
  - Rota calculada e exibida corretamente
- **Observações:**
  - Testar com GPS fraco/precisão baixa

#### **TC-036: Perda Temporária de GPS Durante Viagem**
- **Parâmetros Necessários:**
  - `GPS_UPDATE_INTERVAL`: ? segundos
  - Timeout de GPS perdido: ? segundos
- **Critérios de Aceite:**
  - Se GPS perdido, última posição conhecida mantida
  - Ao restaurar GPS, atualizações retomadas
  - Viagem não interrompida
  - Alerta ao driver (se aplicável)
- **Observações:**
  - Definir se alerta customer sobre perda de sinal

#### **TC-037: Mudança de Rota pelo Driver**
- **Parâmetros Necessários:**
  - Nenhum específico
- **Critérios de Aceite:**
  - Nova rota calculada automaticamente
  - Estimativa atualizada (se aplicável)
  - Customer notificado (se aplicável)
- **Observações:**
  - Definir se customer precisa aprovar mudança de rota

#### **TC-038: Evento SOS/Demergência**
- **Parâmetros Necessários:**
  - Contatos de emergência: ? (lista)
  - Polícia: ? (número)
  - Suporte Leaf: ? (número/email)
- **Critérios de Aceite:**
  - Botão SOS visível durante viagem
  - Ao acionar, notifica contatos de emergência
  - Localização compartilhada
  - Chamada automática iniciada (se aplicável)
  - Evento registrado para auditoria
- **Observações:**
  - Definir quem recebe notificação (polícia, suporte, contatos)

---

### **10. FINALIZAÇÃO DA VIAGEM**

#### **TC-039: Finalizar Viagem com Cálculo Correto**
- **Parâmetros Necessários:**
  - `MINIMUM_FARE`: R$ ?
  - Tarifa por km: R$ ? / km
  - Tarifa por minuto: R$ ? / minuto
  - `FARE_DIVERGENCE_THRESHOLD`: ? % (diferença entre estimada e final)
- **Critérios de Aceite:**
  - Distância e tempo medidos corretamente
  - Tarifa calculada: `max(MINIMUM_FARE, (distância * tarifa_km) + (tempo * tarifa_min))`
  - Evento `tripCompleted` emitido
  - `finalFare` salvo em `currentBooking`
  - Dados normalizados corretamente
- **Observações:**
  - Verificar arredondamento (2 casas decimais)

#### **TC-040: Finalizar Viagem - Divergência de Valor**
- **Parâmetros Necessários:**
  - `FARE_DIVERGENCE_THRESHOLD`: ? %
- **Critérios de Aceite:**
  - Se diferença > threshold, alerta apresentado
  - Customer pode aprovar/rejeitar (se aplicável)
  - Se rejeitado, processo de disputa iniciado
- **Observações:**
  - Definir se customer aprova ou apenas notificado

#### **TC-041: Finalizar Viagem Offline**
- **Parâmetros Necessários:**
  - `WEBSOCKET_RECONNECT_TIMEOUT`: ? segundos
- **Critérios de Aceite:**
  - Estado salvo localmente
  - Ao reconectar, estado sincronizado
  - `tripCompleted` enviado ao servidor
  - Dados preservados (finalFare, distance)
- **Observações:**
  - Testar idempotência (não duplicar ao reconectar)

#### **TC-042: Deduplicação de tripCompleted**
- **Parâmetros Necessários:**
  - Nenhum específico
- **Critérios de Aceite:**
  - Se `tripCompleted` emitido duas vezes (duplo clique), apenas uma vez processado
  - Servidor ignora duplicatas (validação por `bookingId` + timestamp)
- **Observações:**
  - Verificar idempotência no servidor

---

### **11. PAGAMENTO PIX**

#### **TC-043: Fluxo Completo PIX - Pagamento Imediato**
- **Parâmetros Necessários:**
  - `PAYMENT_PIX_TIMEOUT`: ? minutos (QR Code válido)
  - Integração com PSP: ? (Woovi/outro)
- **Critérios de Aceite:**
  - QR Code gerado imediatamente após `tripCompleted`
  - Customer escaneia e paga
  - Webhook de confirmação recebido
  - Evento `paymentConfirmed` emitido
  - Driver recebe confirmação
  - Saldo do driver atualizado
  - `finalFare` preservado e calculado corretamente
- **Observações:**
  - Validar integração com PSP (Woovi já implementado?)

#### **TC-044: Pagamento PIX Expirado (QR Code Vencido)**
- **Parâmetros Necessários:**
  - `PAYMENT_PIX_TIMEOUT`: ? minutos
- **Critérios de Aceite:**
  - Após timeout, QR Code expira
  - Novo QR Code gerado (se aplicável)
  - Customer notificado
  - Processo reiniciado
- **Observações:**
  - Definir se gera novo QR ou cancela booking

#### **TC-045: Valor Pago Menor que Esperado**
- **Parâmetros Necessários:**
  - Tolerância de diferença: R$ ? (centavos?)
- **Critérios de Aceite:**
  - Se diferença > tolerância, alerta apresentado
  - Processo de complemento iniciado (segunda cobrança?)
  - Se diferença <= tolerância, aceito automaticamente
- **Observações:**
  - Definir política: aceitar pequenas diferenças ou sempre exigir valor exato

#### **TC-046: Valor Pago Maior que Esperado**
- **Parâmetros Necessários:**
  - Nenhum específico
- **Critérios de Aceite:**
  - Valor maior aceito
  - Diferença registrada (estorno automático ou crédito?)
  - Driver recebe apenas valor devido (`finalFare`)
- **Observações:**
  - Definir se estorna diferença ou mantém como crédito

#### **TC-047: Falha de Webhook/PSP Down**
- **Parâmetros Necessários:**
  - Timeout de webhook: ? segundos
  - Número de retries: ? tentativas
  - Intervalo entre retries: ? segundos
- **Critérios de Aceite:**
  - Se webhook não chegar, polling iniciado (se aplicável)
  - Após X retries, marca como "aguardando confirmação"
  - Processo manual disponível (se aplicável)
  - Notificação ao suporte
- **Observações:**
  - Definir estratégia de fallback (polling, manual, etc.)

#### **TC-048: Idempotência de Webhooks**
- **Parâmetros Necessários:**
  - Nenhum específico
- **Critérios de Aceite:**
  - Se webhook duplicado, ignorado
  - Apenas uma confirmação de pagamento processada
  - `paymentConfirmed` emitido apenas uma vez
- **Observações:**
  - Validar identificador único do webhook (idempotency key)

#### **TC-049: Estorno/Devolução PIX**
- **Parâmetros Necessários:**
  - Casos de estorno: ? (lista - cancelamento customer, no-show driver, etc.)
  - Prazo de estorno: ? dias
- **Critérios de Aceite:**
  - Estorno processado via PIX
  - Customer notificado
  - Driver notificado (se aplicável)
  - Status atualizado
- **Observações:**
  - Definir quais casos geram estorno automático vs manual

#### **TC-050: Conciliação Diária de Pagamentos**
- **Parâmetros Necessários:**
  - Horário de conciliação: ? (ex: 00:00)
- **Critérios de Aceite:**
  - Relatório gerado com todas as transações do dia
  - Discrepâncias identificadas
  - Saldos validados
  - Relatório disponível para admin/driver
- **Observações:**
  - Definir formato do relatório (CSV, PDF, dashboard)

---

### **12. PÓS-CORRIDA**

#### **TC-051: Envio de Avaliação pelo Customer**
- **Parâmetros Necessários:**
  - `RATING_MIN_STARS`: ? estrelas (para driver continuar ativo)
  - Campos de avaliação: ? (estrelas, comentário, tags?)
- **Critérios de Aceite:**
  - Customer pode avaliar após pagamento
  - Avaliação enviada via `submitRating`
  - Evento `ratingReceived` recebido pelo driver
  - Média atualizada
  - Se média < `RATING_MIN_STARS`, ação tomada?
- **Observações:**
  - Definir política de penalização por baixa avaliação

#### **TC-052: Recebimento de Avaliação pelo Driver**
- **Parâmetros Necessários:**
  - Nenhum específico
- **Critérios de Aceite:**
  - Driver recebe notificação de nova avaliação
  - Avaliação exibida no histórico
  - Média atualizada
- **Observações:**
  - Validar se driver pode responder avaliação

#### **TC-053: Bloqueio de Rating Duplicado**
- **Parâmetros Necessários:**
  - Nenhum específico
- **Critérios de Aceite:**
  - Customer não pode avaliar duas vezes a mesma corrida
  - Se tentar, erro retornado: "Você já avaliou esta corrida"
- **Observações:**
  - Validar idempotência no servidor

#### **TC-054: Recibo para Customer**
- **Parâmetros Necessários:**
  - Formato: ? (PDF, email, app)
- **Critérios de Aceite:**
  - Recibo gerado com: valor, distância, tempo, data, driver
  - Recibo enviado por email (se aplicável)
  - Recibo disponível no app
- **Observações:**
  - Definir se recibo é obrigatório ou opcional

#### **TC-055: Extrato para Driver**
- **Parâmetros Necessários:**
  - Formato: ? (PDF, email, app)
  - Detalhamento: comissões, taxas, repasses
- **Critérios de Aceite:**
  - Extrato mostra: valor bruto, taxas, valor líquido
  - Extrato enviado por email (se aplicável)
  - Extrato disponível no app
- **Observações:**
  - Definir se inclui histórico completo ou apenas última corrida

#### **TC-056: Atualização de Saldo do Driver**
- **Parâmetros Necessários:**
  - Taxa da plataforma: ? % ou R$ fixo
  - Taxa PIX (Woovi): ? % ou R$ fixo
  - Taxa operacional: ? % ou R$ fixo
- **Critérios de Aceite:**
  - Saldo atualizado imediatamente após `paymentConfirmed`
  - Cálculo correto: `finalFare - (taxas)`
  - Driver pode sacar (se aplicável)
- **Observações:**
  - Validar cálculo de `calculateDriverNetValue` (já implementado?)

#### **TC-057: Retenções e Liberação de Saldo**
- **Parâmetros Necessários:**
  - Política de retenção: ? (porcentagem, período)
  - Prazo de liberação: ? dias
- **Critérios de Aceite:**
  - Se retenção aplicável, valor retido
  - Após prazo, valor liberado
  - Driver notificado sobre liberação
- **Observações:**
  - Definir se retenção existe ou não

---

### **13. REGRAS DE PREÇO E DINÂMICA**

#### **TC-058: Tarifa Dinâmica (Surge Pricing)**
- **Parâmetros Necessários:**
  - Fatores de aumento: ? (demanda alta, chuva, eventos)
  - Multiplicador mínimo: ? (ex: 1.0x)
  - Multiplicador máximo: ? (ex: 3.0x)
- **Critérios de Aceite:**
  - Se demanda alta, tarifa aumenta
  - Multiplicador visível para customer e driver
  - Valor final calculado: `tarifa_base * multiplicador`
- **Observações:**
  - Definir se tarifa dinâmica está no escopo atual

#### **TC-059: Tarifa Mínima**
- **Parâmetros Necessários:**
  - `MINIMUM_FARE`: R$ ?
- **Critérios de Aceite:**
  - Se cálculo < `MINIMUM_FARE`, aplica mínimo
  - Customer e driver informados sobre mínimo
- **Observações:**
  - Validar em rotas muito curtas

#### **TC-060: Transparência de Preços**
- **Parâmetros Necessários:**
  - Nenhum específico
- **Critérios de Aceite:**
  - Customer vê estimativa antes de confirmar
  - Driver vê estimativa antes de aceitar
  - Valor final não diverge muito da estimativa (dentro do threshold)
- **Observações:**
  - Validar se estimativa é sempre fornecida

---

### **14. CONECTIVIDADE E RESILIÊNCIA**

#### **TC-061: Queda de Rede Durante Solicitação**
- **Parâmetros Necessários:**
  - `WEBSOCKET_RECONNECT_TIMEOUT`: ? segundos
- **Critérios de Aceite:**
  - Solicitação salva localmente
  - Ao reconectar, tentativa de envio automática
  - Se sucesso, booking criado
  - Se falha após retries, erro apresentado
- **Observações:**
  - Validar persistência local (AsyncStorage)

#### **TC-062: Queda de Rede Durante Aceitação**
- **Parâmetros Necessários:**
  - `WEBSOCKET_RECONNECT_TIMEOUT`: ? segundos
- **Critérios de Aceite:**
  - Estado salvo localmente
  - Ao reconectar, tentativa de envio automática
  - Se corrida ainda disponível, aceita com sucesso
  - Se corrida já aceita, erro apresentado
- **Observações:**
  - Validar sincronização de estado

#### **TC-063: Queda de Rede Durante Viagem**
- **Parâmetros Necessários:**
  - `GPS_UPDATE_INTERVAL`: ? segundos
  - `WEBSOCKET_RECONNECT_TIMEOUT`: ? segundos
- **Critérios de Aceite:**
  - Localizações acumuladas localmente
  - Ao reconectar, localizações enviadas em lote
  - Viagem não interrompida
  - Customer vê última posição conhecida
- **Observações:**
  - Validar se localizações são perdidas ou preservadas

#### **TC-064: Queda de Rede Durante Pagamento**
- **Parâmetros Necessários:**
  - `PAYMENT_PIX_TIMEOUT`: ? minutos
  - `WEBSOCKET_RECONNECT_TIMEOUT`: ? segundos
- **Critérios de Aceite:**
  - Estado de pagamento salvo localmente
  - Ao reconectar, verifica status do pagamento
  - Se pagamento confirmado, evento `paymentConfirmed` emitido
  - Se ainda pendente, QR Code mantido
- **Observações:**
  - Validar polling de status de pagamento

#### **TC-065: Deduplicação de Eventos Após Reconexão**
- **Parâmetros Necessários:**
  - Nenhum específico
- **Critérios de Aceite:**
  - Eventos não duplicados após reconexão
  - Estado sincronizado corretamente
  - Histórico preservado
- **Observações:**
  - Validar lógica de idempotência no servidor

#### **TC-066: Modo Background e Economia de Bateria**
- **Parâmetros Necessários:**
  - Nenhum específico
- **Critérios de Aceite:**
  - App continua funcionando em background (limitado pelo SO)
  - Notificações push funcionam
  - GPS atualiza mesmo em background (se permitido)
  - Ao reabrir, estado atualizado
- **Observações:**
  - Testar limites do iOS/Android

---

### **15. SEGURANÇA E CONFORMIDADE**

#### **TC-067: Isolamento de Roles (Driver ≠ Customer)**
- **Parâmetros Necessários:**
  - Nenhum específico
- **Critérios de Aceite:**
  - Driver não recebe eventos de customer (`createBooking`, etc.)
  - Customer não recebe eventos de driver (`rideRequest`, etc.)
  - Filtragem correta no servidor
- **Observações:**
  - Validar se um usuário pode ser ambos (driver e customer)

#### **TC-068: Proteção de Dados Pessoais**
- **Parâmetros Necessários:**
  - Nenhum específico
- **Critérios de Aceite:**
  - Dados sensíveis (CPF, telefone completo) não enviados em eventos públicos
  - Apenas dados necessários compartilhados
  - LGPD/GDPR compliance
- **Observações:**
  - Validar payloads de eventos

#### **TC-069: Auditoria e Logs**
- **Parâmetros Necessários:**
  - Nenhum específico
- **Critérios de Aceite:**
  - Todos os eventos críticos logados
  - Timestamps precisos
  - Identificação de usuário em cada ação
  - Logs disponíveis para análise
- **Observações:**
  - Definir retenção de logs (dias)

---

### **16. OBSERVABILIDADE E OPERAÇÃO**

#### **TC-070: Métricas de Matching**
- **Parâmetros Necessários:**
  - SLA de matching: ? segundos (médio)
- **Critérios de Aceite:**
  - Tempo entre `createBooking` e `rideAccepted` medido
  - Métrica disponível no dashboard
  - Alertas se SLA não atendido
- **Observações:**
  - Definir SLA esperado

#### **TC-071: Métricas de Latência**
- **Parâmetros Necessários:**
  - SLA de latência de eventos: ? segundos (máximo)
- **Critérios de Aceite:**
  - Tempo de entrega de eventos medido
  - Métrica disponível no dashboard
  - Alertas se SLA não atendido
- **Observações:**
  - Validar em diferentes condições de rede

#### **TC-072: Alarmes de Sistema**
- **Parâmetros Necessários:**
  - Thresholds: ? (taxa de falha, latência, etc.)
- **Critérios de Aceite:**
  - Alarme dispara quando threshold ultrapassado
  - Notificação ao time técnico
  - Ações corretivas sugeridas
- **Observações:**
  - Definir canais de notificação (email, Slack, etc.)

---

### **17. DASHBOARD/ADMIN**

#### **TC-073: Visualização de Corridas em Tempo Real**
- **Parâmetros Necessários:**
  - Nenhum específico
- **Critérios de Aceite:**
  - Dashboard mostra todas as corridas ativas
  - Status atualizado em tempo real
  - Filtros disponíveis (status, data, driver, customer)
- **Observações:**
  - Validar se dashboard existe e está funcional

#### **TC-074: Ações Manuais (Cancelar, Reatribuir)**
- **Parâmetros Necessários:**
  - Nenhum específico
- **Critérios de Aceite:**
  - Admin pode cancelar corrida
  - Admin pode reatribuir corrida
  - Admin pode emitir reembolso
  - Admin pode travar/bloquear usuário
  - Ações registradas em auditoria
- **Observações:**
  - Validar se dashboard admin existe

#### **TC-075: Consistência Mobile ↔ Dashboard**
- **Parâmetros Necessários:**
  - Nenhum específico
- **Critérios de Aceite:**
  - Status sincronizado entre mobile e dashboard
  - Mudanças no dashboard refletem no mobile
  - Mudanças no mobile refletem no dashboard
- **Observações:**
  - Validar sincronização bidirecional

---

### **18. INTEGRAÇÃO E DADOS**

#### **TC-076: Normalização de Payloads**
- **Parâmetros Necessários:**
  - Nenhum específico
- **Critérios de Aceite:**
  - `bookingId` normalizado (aceita `bookingId`, `rideId`, `id`)
  - `pickup.add` normalizado (aceita `pickupLocation.address`, `pickup.add`)
  - `drop.add` normalizado (aceita `destinationLocation.address`, `drop.add`)
  - `estimate` normalizado (aceita `estimatedFare`, `estimate`)
  - Função `normalizeBookingData` idempotente
- **Observações:**
  - **JÁ VALIDADO COM SUCESSO** (confirmado pelo usuário)

#### **TC-077: Idempotência por bookingId/eventId**
- **Parâmetros Necessários:**
  - Nenhum específico
- **Critérios de Aceite:**
  - Eventos duplicados ignorados
  - Validação por `bookingId` + `eventId` (se aplicável)
  - Estado não corrompido por duplicatas
- **Observações:**
  - Validar em todos os handlers críticos

#### **TC-078: Armazenamento e Reprocessamento**
- **Parâmetros Necessários:**
  - Nenhum específico
- **Critérios de Aceite:**
  - Eventos críticos persistidos
  - Possibilidade de reprocessamento (se aplicável)
  - DLQ (Dead Letter Queue) para eventos falhados
- **Observações:**
  - Validar se sistema de filas existe

#### **TC-079: Export/Relatórios**
- **Parâmetros Necessários:**
  - Formato: ? (CSV, Excel, PDF)
- **Critérios de Aceite:**
  - Relatórios exportáveis
  - Dados completos e precisos
  - Filtros disponíveis
- **Observações:**
  - Definir se export existe ou está planejado

---

### **19. ESCALABILIDADE E LIMITES**

#### **TC-080: Múltiplas Solicitações Simultâneas**
- **Parâmetros Necessários:**
  - Número de solicitações: ? (teste de carga)
- **Critérios de Aceite:**
  - Sistema processa múltiplas solicitações sem degradação
  - Latência mantida dentro do SLA
  - Sem perda de eventos
- **Observações:**
  - Testar com 10, 50, 100 solicitações simultâneas

#### **TC-081: Múltiplos Drivers Próximos (Broadcast)**
- **Parâmetros Necessários:**
  - Número de drivers: ? (teste de carga)
- **Critérios de Aceite:**
  - Broadcast eficiente para múltiplos drivers
  - Latência mantida dentro do SLA
  - Sem sobrecarga no servidor
- **Observações:**
  - Testar com 10, 50, 100 drivers no raio

#### **TC-082: Backpressure no Cliente**
- **Parâmetros Necessários:**
  - Nenhum específico
- **Critérios de Aceite:**
  - Se eventos chegarem muito rápido, fila processada ordenadamente
  - UI não trava
  - Eventos não perdidos
- **Observações:**
  - Validar processamento assíncrono

---

### **20. EXPERIÊNCIA DO USUÁRIO (UX)**

#### **TC-083: Mensagens de Erro Claras**
- **Parâmetros Necessários:**
  - Nenhum específico
- **Critérios de Aceite:**
  - Mensagens de erro compreensíveis
  - Ações sugeridas quando aplicável
  - Sem mensagens técnicas expostas
- **Observações:**
  - Revisar todas as mensagens de erro

#### **TC-084: Feedback Visual Consistente**
- **Parâmetros Necessários:**
  - Nenhum específico
- **Critérios de Aceite:**
  - Loading states visíveis
  - Estados de sucesso/erro claros
  - Transições suaves
- **Observações:**
  - Validar em todos os fluxos principais

#### **TC-085: Fluxos Previsíveis**
- **Parâmetros Necessários:**
  - Nenhum específico
- **Critérios de Aceite:**
  - Cards não desaparecem sem motivo
  - Estados consistentes
  - Navegação intuitiva
- **Observações:**
  - Validar que estados são sempre previsíveis

---

## 📝 **RESUMO DE PARÂMETROS NECESSÁRIOS**

### **⏱️ TIMEOUTS (8 parâmetros)**
1. `RIDE_REQUEST_TIMEOUT` - Tempo para driver responder
2. `NO_SHOW_TIMEOUT_DRIVER` - Tempo de espera do driver no pickup
3. `NO_SHOW_TIMEOUT_CUSTOMER` - Tempo de espera do customer no pickup
4. `PAYMENT_PIX_TIMEOUT` - Tempo de expiração do QR Code PIX
5. `WEBSOCKET_RECONNECT_TIMEOUT` - Tempo para reconexão
6. `GPS_UPDATE_INTERVAL` - Intervalo de atualização GPS
7. `HEARTBEAT_INTERVAL` - Intervalo de heartbeat
8. `REASSIGN_DELAY` - Tempo antes de reatribuir

### **📏 RAIOS E DISTÂNCIAS (4 parâmetros)**
1. `DRIVER_SEARCH_RADIUS_INITIAL` - Raio inicial de busca
2. `DRIVER_SEARCH_RADIUS_EXPAND` - Raio expandido
3. `PICKUP_PROXIMITY_RADIUS` - Raio para considerar "chegou no pickup"
4. `LOCATION_ACCURACY_THRESHOLD` - Precisão mínima do GPS

### **💰 VALORES E LIMITES (8 parâmetros)**
1. `MINIMUM_FARE` - Tarifa mínima
2. `MAXIMUM_FARE` - Tarifa máxima (se aplicável)
3. `FARE_DIVERGENCE_THRESHOLD` - Diferença aceitável entre estimada e final
4. `CANCEL_FEE_DRIVER` - Taxa de cancelamento pelo driver
5. `CANCEL_FEE_CUSTOMER` - Taxa de cancelamento pelo customer
6. `NO_SHOW_FEE` - Taxa de no-show
7. Tarifa por km: R$ ? / km
8. Tarifa por minuto: R$ ? / minuto

### **🎯 REGRAS DE NEGÓCIO (5 parâmetros)**
1. `MAX_RECUSAS_DRIVER` - Máximo de recusas consecutivas
2. `MAX_CANCELAMENTOS_DRIVER` - Máximo de cancelamentos por período
3. `MAX_CANCELAMENTOS_CUSTOMER` - Máximo de cancelamentos por período
4. `REASSIGN_MAX_ATTEMPTS` - Máximo de tentativas de reatribuição
5. `RATING_MIN_STARS` - Avaliação mínima para driver continuar ativo

### **🔔 NOTIFICAÇÕES (3 parâmetros)**
1. `NOTIFICATION_SOUND_ENABLED` - Habilitar som
2. `NOTIFICATION_VIBRATION_ENABLED` - Habilitar vibração
3. `ALERT_BEFORE_TIMEOUT` - Alerta antes do timeout

### **📋 POLÍTICAS E REGRAS (múltiplas)**
- Status inicial após login (online/offline)
- Transição automática de status após completar corrida
- Política de sessão simultânea (bloquear/permitir)
- Política de penalização por recusas
- Política de taxa de cancelamento (quando aplicável)
- Política de reembolso (quais casos)
- Política de retenção de saldo (se aplicável)
- Política de tarifa dinâmica (se aplicável)
- Casos de estorno automático vs manual
- Formato de recibos/extratos
- Retenção de logs

---

## ✅ **PRÓXIMOS PASSOS**

1. **Você fornece os valores dos parâmetros acima**
2. **Crio scripts de teste automatizados para cada cenário**
3. **Executamos os testes sequencialmente**
4. **Documentamos resultados e gaps encontrados**
5. **Implementamos correções necessárias**

**Aguardando seus parâmetros para prosseguir! 🚀**



