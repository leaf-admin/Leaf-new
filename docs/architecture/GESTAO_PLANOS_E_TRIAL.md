# 💳 GESTÃO DE PLANOS E PERÍODO DE TRIAL

**Data:** 29/01/2025  
**Objetivo:** Documentar planos disponíveis, gestão e período de trial sem cobrança

---

## 📋 PLANOS DISPONÍVEIS

### **Plano 1: Leaf Plus**
```
Valor: R$ 49,90 por semana
ID: 'plus'
Período: Semanal (renovação automática)
```

**Benefícios:**
- ✅ Corridas ilimitadas
- ✅ Suporte básico
- ✅ 100% das corridas para você
- ✅ App premium
- ✅ Sem taxa por corrida

---

### **Plano 2: Leaf Elite**
```
Valor: R$ 99,90 por semana
ID: 'elite'
Período: Semanal (renovação automática)
Popular: Sim (mais escolhido)
```

**Benefícios:**
- ✅ Corridas ilimitadas
- ✅ Suporte premium 24/7
- ✅ 100% das corridas para você
- ✅ Prioridade nas corridas
- ✅ App premium
- ✅ Sem taxa por corrida
- ✅ Relatórios avançados
- ✅ Treinamento exclusivo

---

## 🎁 PERÍODO DE TRIAL (SEM COBRANÇA)

### **1. Trial para Primeiros 500 Motoristas**
```
Duração: 90 dias (3 meses)
Condição: Motoristas dos primeiros 500 cadastrados
Flag: is_first_500 = true
Status: Gratuito, sem cobrança semanal durante o período
```

**Como funciona:**
- Primeiros 500 motoristas cadastrados recebem **90 dias grátis**
- Durante esse período, **não há cobrança semanal**
- Após 90 dias, cobrança semanal inicia normalmente
- Campos no sistema:
  - `free_trial_start`: Data de início
  - `free_trial_end`: Data de término (start + 90 dias)
  - `is_first_500`: true para elegíveis

---

### **2. Sistema de Convites (Months Grátis)**
```
Máximo de meses grátis: 12 meses
Máximo de convites por motorista: 3 convites
Meses grátis por convite aceito: 1 mês
Requisito: Convidado deve completar 10 corridas antes de receber o mês grátis
```

**Como funciona:**
- Motorista pode convidar até **3 novos motoristas**
- Cada convite aceito e completado (10 corridas) = **1 mês grátis** para ambos
- Máximo acumulado: **12 meses grátis** (limite global)
- Durante os meses grátis, **não há cobrança semanal**

**Campos no sistema:**
- `free_months`: Quantidade de meses grátis acumulados
- `max_free_months`: Limite máximo (12 meses)
- `used_invites`: Quantidade de convites já utilizados
- `max_invites`: Limite de convites (3)

---

## 💰 GESTÃO DE COBRANÇA SEMANAL

### **Período de Cobrança:**
```
Início: Segunda-feira (00:00)
Fim: Domingo (23:59)
Vencimento: 2 dias após início da semana (Quarta-feira)
Renovação: Automática toda segunda-feira
```

### **Ciclo de Cobrança:**
1. **Segunda-feira 00:00:** Nova semana inicia
2. **Sistema verifica:**
   - Se motorista está em período de trial → **NÃO cobra**
   - Se motorista tem meses grátis ativos → **NÃO cobra**
   - Se período de trial/meses grátis expirou → **COBRA**
3. **Quarta-feira:** Data de vencimento da cobrança
4. **Após vencimento:** Motorista pode ser marcado como `overdue` (em atraso)

---

## 🔧 STATUS DE ASSINATURA

### **Status Possíveis:**
```
'active' - Assinatura ativa e em dia
'pending' - Aguardando ativação/aprovação
'overdue' - Pagamento em atraso
'suspended' - Suspensa (pagamentos atrasados)
```

### **Verificação de Cobrança:**
```
1. Verifica se motorista está em trial (is_first_500 e free_trial_end > hoje)
2. Verifica se motorista tem meses grátis (free_months > 0)
3. Se nenhum dos dois → processa cobrança semanal
4. Se trial ou meses grátis ativos → pula cobrança (gratuito)
```

---

## 📊 EXEMPLO PRÁTICO

### **Cenário 1: Motorista dos Primeiros 500**
```
Cadastro: 01/01/2025
free_trial_start: 01/01/2025
free_trial_end: 01/04/2025 (90 dias depois)
is_first_500: true

Cobrança:
- Semanas 1-12 (jan-mar): GRÁTIS (período de trial)
- Semana 13 em diante: Cobrança semanal R$ 49,90 ou R$ 99,90
```

### **Cenário 2: Motorista com Convites**
```
free_months: 3 meses
free_months_start: 01/02/2025
free_months_end: 01/05/2025

Cobrança:
- Fevereiro: GRÁTIS (mês grátis 1)
- Março: GRÁTIS (mês grátis 2)
- Abril: GRÁTIS (mês grátis 3)
- Maio em diante: Cobrança semanal normal
```

### **Cenário 3: Motorista Normal (Sem Trial/Convites)**
```
Cadastro: 15/01/2025
is_first_500: false
free_months: 0

Cobrança:
- Semana 1 (15/01): R$ 49,90 ou R$ 99,90
- Semana 2: R$ 49,90 ou R$ 99,90
- Semana 3: R$ 49,90 ou R$ 99,90
- ... (cobrança semanal contínua)
```

---

## 🎯 RESUMO DE PERÍODOS SEM COBRANÇA

### **1. Trial Primeiros 500**
- **Duração:** 90 dias (3 meses)
- **Quem recebe:** Primeiros 500 motoristas cadastrados
- **Flag:** `is_first_500 = true`

### **2. Meses Grátis por Convites**
- **Duração:** Até 12 meses (máximo)
- **Como ganhar:** Convites aceitos e completados (10 corridas cada)
- **Ganho por convite:** 1 mês grátis (convidador + convidado)

### **3. Período Total Possível (Trial + Convites)**
```
Trial inicial: 90 dias (3 meses)
Convites máximos: 12 meses
Total teórico: 15 meses grátis
```

**Observação:** Trial e meses grátis são contabilizados separadamente. Se um motorista dos primeiros 500 também usar convites, terá trial + meses grátis.

---

## 🔄 GESTÃO AUTOMÁTICA

### **Renovação Semanal:**
```
Schedule: Toda segunda-feira às 00:00
Processo:
1. Busca todos os motoristas ativos
2. Verifica trial_end e free_months
3. Se dentro do período grátis → não cobra
4. Se fora do período → cria cobrança semanal
5. Envia notificação para motorista
```

### **Verificação de Trial:**
```javascript
const now = new Date();
const freeTrialEnd = new Date(driverData.free_trial_end);
const isInFreeTrial = now < freeTrialEnd && driverData.is_first_500 === true;

if (isInFreeTrial) {
  // Não cobra - período grátis ativo
} else {
  // Processa cobrança semanal
}
```

### **Verificação de Meses Grátis:**
```javascript
const freeMonthsRemaining = driverData.free_months || 0;
const freeMonthsEnd = driverData.free_months_end;

if (freeMonthsRemaining > 0 && now < freeMonthsEnd) {
  // Não cobra - meses grátis ativos
} else {
  // Processa cobrança semanal
}
```

---

## 📝 CAMPOS NO SISTEMA

### **Para Trial (Primeiros 500):**
- `is_first_500`: boolean (true para elegíveis)
- `free_trial_start`: Date (data de início)
- `free_trial_end`: Date (data de término = start + 90 dias)

### **Para Convites (Meses Grátis):**
- `free_months`: number (quantidade acumulada, max 12)
- `max_free_months`: number (12)
- `free_months_start`: Date (quando começou)
- `free_months_end`: Date (quando termina)
- `used_invites`: number (quantos convites usou, max 3)
- `max_invites`: number (3)

### **Para Assinatura:**
- `plan_type`: 'plus' ou 'elite'
- `weeklyFee`: 49.90 ou 99.90
- `status`: 'active', 'pending', 'overdue', 'suspended'
- `billing_status`: 'active' ou 'suspended'
- `currentPeriod.start`: Date (início da semana)
- `currentPeriod.end`: Date (fim da semana)
- `currentPeriod.paymentStatus`: 'pending', 'paid', 'overdue'

---

## 🎯 CONCLUSÕES

### **✅ RESUMO:**

1. **Planos:** 2 planos (Plus R$ 49,90 e Elite R$ 99,90) - cobrança semanal
2. **Trial Primeiros 500:** 90 dias grátis (3 meses) - sem cobrança semanal
3. **Sistema de Convites:** Até 12 meses grátis - sem cobrança semanal durante o período
4. **Gestão:** Automática via Firebase Functions (renovação toda segunda-feira)
5. **Verificação:** Sistema verifica trial e meses grátis antes de cobrar

### **💰 IMPORTANTE:**
- Durante período de trial ou meses grátis → **ZERO cobrança semanal**
- Após expiração → Cobrança semanal normal inicia automaticamente
- Máximo possível de período grátis: ~15 meses (trial 3 meses + convites 12 meses)

---

**Documento criado em:** 29/01/2025  
**Baseado em:** Análise do código de planos, trial e sistema de convites


