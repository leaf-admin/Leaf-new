# ✅ PARÂMETROS DEFINIDOS - PLANO DE TESTES LEAF APP

**Data de Atualização:** 29/01/2025

---

## 📝 **ESCLARECIMENTOS DE PARÂMETROS**

### **1. HEARTBEAT_INTERVAL - ⚠️ REGRA ESPECIAL**
**Definição do Cliente:**
- **Status online/offline é EXPLÍCITO:** apenas quando driver marca manualmente
- Heartbeat **NÃO deve presumir status offline** automaticamente
- **Exceção crítica:** Se driver perder sinal durante corrida, NÃO pode marcar como offline (pode ser apenas queda temporária de rede)

**Proposta de Implementação:**
```
REGRA_HEARTBEAT:
- Heartbeat serve apenas para detectar CONECTIVIDADE, não status
- Status "online/offline" é controlado APENAS por ação explícita do driver
- Se perder heartbeat DURANTE corrida ativa:
  → Marcar como "sem conexão" (flag interna)
  → MANTER status anterior (busy, in_progress, etc.)
  → NÃO mudar para offline
  → Tentar reconexão em background
  
- Se perder heartbeat quando driver está "available":
  → Após timeout longo (ex: 5 minutos), marcar como "indisponível temporariamente"
  → Mas NÃO mudar status explícito para offline
  → Ao reconectar, restaurar status anterior se dentro do timeout

- Heartbeat serve para:
  ✓ Detectar queda de conexão
  ✓ Tentar reconexão automática
  ✓ Sincronizar estado ao reconectar
  ✗ NÃO serve para mudar status online/offline automaticamente
```

**Parâmetros Necessários:**
- `HEARTBEAT_INTERVAL`: 30 segundos (envio de heartbeat)
- `HEARTBEAT_TIMEOUT_AVAILABLE`: 5 minutos (se perder conexão quando available, marcar como indisponível temporariamente)
- `HEARTBEAT_TIMEOUT_IN_TRIP`: **NUNCA** (durante corrida, não muda status mesmo sem heartbeat)

---

### **2. REASSIGN_DELAY - ✅ DEFINIDO**
**Definição do Cliente:**
- Disparo de corrida é para **TODOS os motoristas simultaneamente** no raio de 3km
- Se nenhum aceitar no **primeiro minuto**, expande raio para 5km
- Delay de 5 segundos aplicado após recusa/timeout antes de reatribuir

**Lógica Implementada:**
```
FLUXO_REATRIBUICAO:
1. Corrida criada → enviada para TODOS drivers no raio de 3km (simultâneo)
2. Se nenhum aceitar em 60 segundos → expande para 5km
3. Após recusa/timeout individual → aguarda 5s (REASSIGN_DELAY) antes de considerar para reatribuição
4. Continuar tentando até customer cancelar ou corrida ser aceita
```

**Valor Definido:** 5 segundos

---

### **3. ALERT_BEFORE_TIMEOUT - ✅ DEFINIDO**
**Definição do Cliente:**
- Nos últimos 5 segundos antes do timeout expirar
- Modal/card deve **piscar** ou ter **indicativo gráfico visual**
- Não é um alerta de texto, mas um **feedback visual** de urgência

**Implementação Sugerida:**
```
VISUAL_FEEDBACK_LAST_5_SECONDS:
- Modal/card de corrida pisca (opacidade alternando)
- Ou borda vermelha piscante
- Ou contador regressivo destacado (5, 4, 3, 2, 1)
- Ou animação de "pulso" visual
- Manter até timeout expirar ou driver responder
```

**Valor Definido:** 5 segundos (aplicado nos últimos 5s do `RIDE_REQUEST_TIMEOUT`)

---

## ✅ **PARÂMETROS DEFINIDOS**

### **⏱️ TIMEOUTS**

| Parâmetro | Valor Definido | Observações |
|-----------|----------------|-------------|
| `RIDE_REQUEST_TIMEOUT` | **15 segundos** | Tempo máximo para driver aceitar/recusar |
| `RIDE_REQUEST_EXPAND_TIMEOUT` | **60 segundos** | Tempo para expandir raio de 3km para 5km se nenhum aceitar |
| `NO_SHOW_TIMEOUT_DRIVER` | **2 minutos** | Driver espera no pickup |
| `NO_SHOW_TIMEOUT_CUSTOMER` | **2 minutos** | Customer espera no pickup |
| `PAYMENT_PIX_TIMEOUT` | **5 minutos** | QR Code PIX válido por 5 min |
| `WEBSOCKET_RECONNECT_TIMEOUT` | **5 segundos** | Tempo para tentar reconexão |
| `GPS_UPDATE_INTERVAL` | **2 segundos** | ✅ Já definido anteriormente |
| `HEARTBEAT_INTERVAL` | **30 segundos** | Envio de heartbeat (não muda status) |
| `HEARTBEAT_TIMEOUT_AVAILABLE` | **5 minutos** | Se perder conexão quando available, marcar indisponível temporariamente |
| `HEARTBEAT_TIMEOUT_IN_TRIP` | **NUNCA** | Durante corrida, não muda status mesmo sem heartbeat |
| `REASSIGN_DELAY` | **5 segundos** | ✅ Tempo antes de reatribuir após recusa/timeout |

---

### **📏 RAIOS E DISTÂNCIAS**

| Parâmetro | Valor Definido | Observações |
|-----------|----------------|-------------|
| `DRIVER_SEARCH_RADIUS_INITIAL` | **3 km** | Raio inicial de busca |
| `DRIVER_SEARCH_RADIUS_EXPAND` | **5 km** | Raio expandido se não encontrar |
| `PICKUP_PROXIMITY_RADIUS` | **50 metros** | Distância mínima para "chegou no pickup" |
| `LOCATION_ACCURACY_THRESHOLD` | **50 metros** | Precisão mínima GPS aceitável |

---

### **💰 VALORES E LIMITES**

| Parâmetro | Valor Definido | Observações |
|-----------|----------------|-------------|
| `MINIMUM_FARE` | **R$ 8,50** | Tarifa mínima |
| `MAXIMUM_FARE` | **Não existe** | Sem limite máximo |
| `FARE_DIVERGENCE_THRESHOLD` | **ZERO TOLERÂNCIA** | Estimativa e final devem ser o mesmo valor exato |
| `CANCEL_FEE_DRIVER` | **R$ 4,90** | Taxa fixa de cancelamento pelo driver |
| `CANCEL_FEE_CUSTOMER` | **Regra Complexa** | ⬇️ Ver detalhes abaixo |
| `NO_SHOW_FEE` | **R$ 2,90** | Taxa fixa de no-show |
| Tarifa por km (Leaf Plus) | **R$ 1,22/km** | ✅ Já no escopo |
| Tarifa por minuto (Leaf Plus) | **R$ 15,00/hora** (R$ 0,25/min) | ✅ Já no escopo |
| Tarifa por km (Leaf Elite) | **R$ 2,18/km** | ✅ Já no escopo |
| Tarifa por minuto (Leaf Elite) | **R$ 17,40/hora** (R$ 0,29/min) | ✅ Já no escopo |

**Detalhamento CANCEL_FEE_CUSTOMER:**
- **Até 2 minutos** após driver aceitar: **SEM TAXA**
- **Após 2 minutos** após driver aceitar: **Cálculo** = `(distância + tempo percorrido pelo motorista) * tarifas + R$ 0,80`

---

### **🎯 REGRAS DE NEGÓCIO**

| Parâmetro | Valor Definido | Observações |
|-----------|----------------|-------------|
| `MAX_RECUSAS_DRIVER` | **10 recusas** | Máximo antes de alertar (sem bloqueio) |
| `MAX_CANCELAMENTOS_DRIVER` | **5 cancelamentos** | Após isso, apenas alerta na tela (warning) |
| `MAX_CANCELAMENTOS_CUSTOMER` | **Indefinido** | Sem limite, mas taxa aplicada se for o caso |
| `REASSIGN_MAX_ATTEMPTS` | **Infinito** | Continuar tentando até customer cancelar |
| `RATING_MIN_STARS` | **4 estrelas** | Se atingir 4 estrelas → notificar para entrar em contato via suporte |

---

### **🔔 NOTIFICAÇÕES E FEEDBACK VISUAL**

| Parâmetro | Valor Definido | Observações |
|-----------|----------------|-------------|
| `NOTIFICATION_SOUND_ENABLED` | **true** | Som habilitado |
| `NOTIFICATION_VIBRATION_ENABLED` | **true** | Vibração habilitada |
| `ALERT_BEFORE_TIMEOUT` | **5 segundos** | ✅ Feedback visual nos últimos 5s (modal pisca/indicação gráfica) |

---

### **📋 POLÍTICAS DE NEGÓCIO**

| Política | Valor Definido | Observações |
|----------|----------------|-------------|
| **Status Inicial** | **Offline** | Motorista começa offline após login |
| **Status Automático** | **Sim** | Volta para `available` após completar corrida até clicar offline |
| **Sessão Simultânea** | **Bloqueada** | Driver e customer não podem estar em múltiplos dispositivos |
| **Taxa de Cancelamento** | **Conforme regra acima** | Ver `CANCEL_FEE_CUSTOMER` e `CANCEL_FEE_DRIVER` |
| **Política de Reembolso** | **Regra Complexa** | ⬇️ Ver detalhes abaixo |
| **Tarifa Dinâmica** | **✅ JÁ IMPLEMENTADA** | Surge pricing com fórmula: `fator = 1 + K * ((P/M) - 1)` |
| **Retenção de Saldo** | **Regra Complexa** | ⬇️ Ver detalhes abaixo |
| **Estorno** | **✅ DEFINIDO** | ⬇️ Ver detalhes abaixo |

**Detalhamento Política de Reembolso:**
- Reembolso de corridas **feitas parcialmente**
- Cálculo: Debitar custos operacionais + proporcionais aos km e tempo de deslocamento
- Fórmula: `Valor pago - (custos operacionais + km proporcionais + tempo proporcional)`

**Detalhamento Retenção de Saldo:**
- **Padrão:** Retenção por **30 minutos**
- **Se avaliação 1 estrela:** Retenção por **2 horas**
- Após período, saldo liberado

**Detalhamento Casos de Estorno:**
- **Estorno COMPLETO** (valor pago integral):
  1. Corrida não ocorreu (cancelamento antes de iniciar)
  2. Driver iniciou corrida sem passageiro embarcar (comprovado)
  
- **Estorno PARCIAL** (descontando proporcional):
  3. Cancelamento durante a corrida (já iniciada)
     - Cálculo: `Valor pago - (km percorridos * tarifa_km + tempo * tarifa_min)`
     - Saldo do motorista fica **RETIDO** para possível disputa
     - Customer pode abrir reclamação (analisada em até 24 horas)
     - Se reclamação validada → saldo retido não liberado
     - Se reclamação rejeitada → saldo liberado para motorista

**Processo de Disputa:**
- Customer pode abrir reclamação após estorno parcial
- Análise manual em até **24 horas**
- Durante análise, saldo do motorista permanece retido
- Resultado da análise define liberação ou não do saldo

---

## 🔄 **FLUXO COMPLETO DE DISTRIBUIÇÃO DE CORRIDAS**

### **Diagrama de Fluxo:**

```
1. CUSTOMER CRIA CORRIDA
   ↓
2. SERVIDOR BUSCA DRIVERS NO RAIO DE 3KM
   ↓
3. ENVIA PARA TODOS OS DRIVERS SIMULTANEAMENTE (broadcast)
   ├─ Driver 1 recebe → tem 15s para responder
   ├─ Driver 2 recebe → tem 15s para responder
   ├─ Driver 3 recebe → tem 15s para responder
   └─ ...
   ↓
4. AGUARDA 60 SEGUNDOS (RIDE_REQUEST_EXPAND_TIMEOUT)
   ├─ Se ALGUM driver aceitar → CORRIDA ACEITA ✅
   ├─ Se TODOS recusarem → vai para passo 5
   └─ Se NENHUM responder em 15s → timeout individual → aguarda 5s → reatribui
   ↓
5. SE NENHUM ACEITOU EM 60s → EXPANDE RAIO PARA 5KM
   ├─ Busca novos drivers no raio expandido
   ├─ Envia para TODOS simultaneamente
   └─ Repete processo (15s timeout individual + reatribuição)
   ↓
6. CONTINUA TENTANDO ATÉ:
   ├─ Customer cancelar busca
   ├─ Algum driver aceitar
   └─ (Não há limite de tentativas)
```

### **Regras Importantes:**
- ✅ Disparo inicial é **broadcast** (todos recebem ao mesmo tempo)
- ✅ Cada driver tem **15 segundos** individuais para responder
- ✅ Após **60 segundos** sem aceitação, expande raio
- ✅ Após recusa/timeout individual, aguarda **5 segundos** antes de reatribuir
- ✅ Reatribuição continua até customer cancelar ou alguém aceitar

---

## ✅ **TODOS OS PARÂMETROS DEFINIDOS**

### **Status Final:**

✅ **`FARE_DIVERGENCE_THRESHOLD`** - ZERO TOLERÂNCIA (estimativa = final exato)  
✅ **`RATING_MIN_STARS`** - 4 estrelas (com notificação para suporte)  
✅ **Casos de Estorno** - Completamente definidos (ver seção acima)  
✅ **Tarifa por km e por minuto** - Definidas por tipo de veículo (Leaf Plus e Leaf Elite)

**Nenhum parâmetro pendente! 🎉**

---

## 💰 **TARIFAS POR TIPO DE VEÍCULO**

### **Resumo Completo:**

| Tipo de Veículo | Tarifa Mínima | Tarifa Base | Por Km | Por Hora | Por Minuto |
|-----------------|---------------|-------------|--------|----------|------------|
| **Leaf Plus** | R$ 8,50 | R$ 3,13 | **R$ 1,42/km** | **R$ 16,20/hora** | **R$ 0,27/min** |
| **Leaf Elite** | R$ 11,50 | R$ 5,59 | **R$ 2,29/km** | **R$ 18,00/hora** | **R$ 0,30/min** |

### **Fórmula de Cálculo:**
```
Tarifa Base = base_fare + (distância_km * rate_per_unit_distance) + (tempo_horas * rate_per_hour)
Tarifa Final = max(Tarifa Base, min_fare)
```

**Observações:**
- ✅ Valores já implementados no código (`PassengerUI.js`, `MapScreen.js`)
- ✅ Leaf Plus tem tarifa mínima: R$ 8,50
- ✅ Leaf Elite tem tarifa mínima: R$ 11,50
- ✅ Leaf Elite é mais caro por km e por hora (veículo premium)

---

## 🎯 **TARIFA DINÂMICA (SURGE PRICING)**

### **Fórmula Implementada:**
```
fator_dinamico = 1 + K * ((P / M) - 1)
```

**Onde:**
- `M` = Número de motoristas disponíveis na região
- `P` = Número de pedidos ativos na região
- `K` = Fator de correção (padrão: 0.3)
- `minFactor` = Limite mínimo (ex: 1.0x)
- `maxFactor` = Limite máximo (ex: 3.0x)

**Tarifa Final:**
```
tarifa_final = tarifa_base * fator_dinamico
```

**Status:** ✅ Já implementado em `DynamicPricingService.js`

---

## 📊 **RESUMO DE STATUS**

| Categoria | Definidos | Pendentes | Total |
|-----------|-----------|-----------|-------|
| **Timeouts** | **11/11** ✅ | 0 | 11 |
| **Raios/Distâncias** | **4/4** ✅ | 0 | 4 |
| **Valores/Limites** | **10/10** ✅ | 0 | 10 |
| **Regras Negócio** | **5/5** ✅ | 0 | 5 |
| **Notificações** | **3/3** ✅ | 0 | 3 |
| **Políticas** | **10/10** ✅ | 0 | 10 |
| **TOTAL** | **43/43** ✅ | **0** | **43** |

**Progresso:** **100% dos parâmetros definidos! 🎉**

**Observação:** Parâmetros adicionais foram criados para cobrir regras especiais:
- `RIDE_REQUEST_EXPAND_TIMEOUT` (novo)
- `HEARTBEAT_TIMEOUT_AVAILABLE` (novo)
- `HEARTBEAT_TIMEOUT_IN_TRIP` (novo)

---

## 🚀 **PRÓXIMOS PASSOS**

### ✅ **PARÂMETROS DEFINIDOS E CONSOLIDADOS:**
1. ✅ `HEARTBEAT_INTERVAL = 30 segundos` (com regras especiais documentadas)
2. ✅ `REASSIGN_DELAY = 5 segundos`
3. ✅ `ALERT_BEFORE_TIMEOUT = 5 segundos` (feedback visual)
4. ✅ `RIDE_REQUEST_EXPAND_TIMEOUT = 60 segundos` (expansão de raio)
5. ✅ `FARE_DIVERGENCE_THRESHOLD = ZERO TOLERÂNCIA` (estimativa = final exato)
6. ✅ `RATING_MIN_STARS = 4 estrelas` (com notificação para suporte)
7. ✅ **Casos de Estorno** - Completamente definidos (estorno completo/parcial com processo de disputa)
8. ✅ **Tarifas por tipo de veículo** - Leaf Plus e Leaf Elite (valores documentados)

### 📋 **PRÓXIMA FASE - TESTES AUTOMATIZADOS:**
- ✅ **Todos os parâmetros definidos!**
- 🎯 **Criar scripts de teste automatizados para os 85 cenários do `PLANO_TESTES_COMPLETO.md`**
- 🎯 **Executar testes sequenciais**
- 🎯 **Documentar resultados e gaps encontrados**
- 🎯 **Implementar correções necessárias**

**Status:** ✅ **PRONTO PARA INICIAR FASE DE TESTES!**

---

**Documento criado em:** 29/01/2025  
**Última atualização:** 29/01/2025 (TODOS OS PARÂMETROS DEFINIDOS - 100% completo)

**Histórico de atualizações:**
- 29/01/2025 - Criação inicial com parâmetros básicos
- 29/01/2025 - Esclarecimentos de HEARTBEAT, REASSIGN_DELAY e ALERT_BEFORE_TIMEOUT
- 29/01/2025 - Definições finais: FARE_DIVERGENCE_THRESHOLD, RATING_MIN_STARS, Casos de Estorno e Tarifas

