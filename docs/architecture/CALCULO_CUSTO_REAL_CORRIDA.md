# 💰 CÁLCULO DO CUSTO REAL DE UMA CORRIDA - PONTA A PONTA

**Data:** 29/01/2025  
**Modelo Atual:** Leaf App

---

## 📋 FÓRMULA COMPLETA DE CÁLCULO

### **ETAPA 1: Tarifa Base**
```
Tarifa Base = base_fare + (distância_km × rate_per_km) + (tempo_horas × rate_per_hour)
```

**Onde:**
- `base_fare` = Taxa inicial fixa (bandeira)
- `distância_km` = Distância percorrida em quilômetros
- `rate_per_km` = Tarifa por quilômetro
- `tempo_horas` = Tempo decorrido em horas (tempo/3600)
- `rate_per_hour` = Tarifa por hora

---

### **ETAPA 2: Garantir Mínimo**
```
Tarifa Base Final = max(Tarifa Base, min_fare)
```

**Onde:**
- `min_fare` = Tarifa mínima (R$ 8,50)

---

### **ETAPA 3: Adicionar Pedágio (se houver)**
```
Tarifa com Pedágio = Tarifa Base Final + Pedágio
```

---

### **ETAPA 4: Taxa de Conveniência**
```
Taxa Conveniência = (Tarifa com Pedágio × percentual_conveniência) OU valor_fixo
```

**Onde:**
- Se `convenience_fee_type = 'percentage'`: percentual sobre o total
- Se `convenience_fee_type = 'flat'`: valor fixo

---

### **ETAPA 5: Tarifa Dinâmica (Surge Pricing) - OPCIONAL**
```
Fator Dinâmico = 1 + K × ((P / M) - 1)
Tarifa com Surge = Tarifa com Conveniência × Fator Dinâmico
```

**Onde:**
- `K` = Fator de correção (padrão: 0.3)
- `P` = Número de pedidos ativos na região
- `M` = Número de motoristas disponíveis na região
- `minFactor` = 1.0x (mínimo)
- `maxFactor` = 3.0x (máximo)

---

### **ETAPA 6: Valor Final**
```
Valor Final = Tarifa com Surge (ou Tarifa com Conveniência se não houver surge)
```

---

## 💵 TARIFAS POR TIPO DE VEÍCULO

### **Leaf Plus (Veículo Padrão)**

| Componente | Valor |
|------------|-------|
| **Tarifa Mínima** | R$ 8,50 |
| **Tarifa Base (Bandeira)** | R$ 3,13 |
| **Por Quilômetro** | R$ 1,42/km |
| **Por Hora** | R$ 16,20/hora |
| **Por Minuto** | R$ 0,27/min |

### **Leaf Elite (Veículo Premium)**

| Componente | Valor |
|------------|-------|
| **Tarifa Mínima** | R$ 11,50 |
| **Tarifa Base (Bandeira)** | R$ 5,59 |
| **Por Quilômetro** | R$ 2,29/km |
| **Por Hora** | R$ 18,00/hora |
| **Por Minuto** | R$ 0,30/min |

---

## 📊 EXEMPLOS PRÁTICOS DE CÁLCULO

### **Exemplo 1: Corrida Curta - Leaf Plus**
**Cenário:**
- Distância: 3 km
- Tempo: 15 minutos (900 segundos = 0.25 horas)
- Pedágio: R$ 0,00
- Taxa de Conveniência: Não especificada (assumir 0% ou valor fixo R$ 0,00)
- Surge: 1.0x (sem demanda alta)

**Cálculo:**
```
1. Tarifa Base = 2.98 + (3 × 1.22) + (0.25 × 15.00)
               = 2.98 + 3.66 + 3.75
               = R$ 10,39

2. Tarifa Mínima = max(10.39, 8.50) = R$ 10,39 ✅

3. Com Pedágio = 10.39 + 0.00 = R$ 10,39

4. Taxa Conveniência = (assumir 0%) = R$ 0,00

5. Valor Final = 10.39 × 1.0 = R$ 10,39
```

**💰 CUSTO REAL: R$ 10,39**

---

### **Exemplo 2: Corrida Média - Leaf Elite**
**Cenário:**
- Distância: 10 km
- Tempo: 30 minutos (1800 segundos = 0.5 horas)
- Pedágio: R$ 5,00
- Taxa de Conveniência: Não especificada (assumir 0% ou valor fixo R$ 0,00)
- Surge: 1.0x (sem demanda alta)

**Cálculo:**
```
1. Tarifa Base = 5.32 + (10 × 2.18) + (0.5 × 17.40)
               = 5.32 + 21.80 + 8.70
               = R$ 35,82

2. Tarifa Mínima = max(35.82, 8.50) = R$ 35,82 ✅

3. Com Pedágio = 35.82 + 5.00 = R$ 40,82

4. Taxa Conveniência = (assumir 0%) = R$ 0,00

5. Valor Final = 40.82 × 1.0 = R$ 40,82
```

**💰 CUSTO REAL: R$ 40,82**

---

### **Exemplo 3: Corrida Longa - Leaf Plus com Surge**
**Cenário:**
- Distância: 25 km
- Tempo: 45 minutos (2700 segundos = 0.75 horas)
- Pedágio: R$ 10,00
- Taxa de Conveniência: Não especificada (assumir 0% ou valor fixo R$ 0,00)
- Surge: 1.5x (demanda moderada: P=15, M=10, K=0.3)
  - Fator = 1 + 0.3 × ((15/10) - 1) = 1 + 0.3 × 0.5 = 1.15x (limitado a 1.5x conforme configurado)

**Cálculo:**
```
1. Tarifa Base = 2.98 + (25 × 1.22) + (0.75 × 15.00)
               = 2.98 + 30.50 + 11.25
               = R$ 44,73

2. Tarifa Mínima = max(44.73, 8.50) = R$ 44,73 ✅

3. Com Pedágio = 44.73 + 10.00 = R$ 54,73

4. Taxa Conveniência = (assumir 0%) = R$ 0,00

5. Valor Final = 54.73 × 1.5 = R$ 82,10
```

**💰 CUSTO REAL: R$ 82,10**

---

### **Exemplo 4: Corrida Mínima - Leaf Elite**
**Cenário:**
- Distância: 1 km
- Tempo: 5 minutos (300 segundos = 0.083 horas)
- Pedágio: R$ 0,00
- Taxa de Conveniência: Não especificada (assumir 0% ou valor fixo R$ 0,00)
- Surge: 1.0x

**Cálculo:**
```
1. Tarifa Base = 5.32 + (1 × 2.18) + (0.083 × 17.40)
               = 5.32 + 2.18 + 1.44
               = R$ 8,94

2. Tarifa Mínima = max(8.94, 8.50) = R$ 8,94 ✅

3. Com Pedágio = 8.94 + 0.00 = R$ 8,94

4. Taxa Conveniência = (assumir 0%) = R$ 0,00

5. Valor Final = 8.94 × 1.0 = R$ 8,94
```

**💰 CUSTO REAL: R$ 8,94**

---

## ⚠️ COMPONENTES QUE PODEM AUMENTAR O CUSTO

### **1. Taxa de Conveniência**
- **Status:** ⚠️ **Não especificada nos parâmetros**
- **Possibilidade:** Pode ser percentual (ex: 5-10%) ou valor fixo
- **Impacto:** Depende da configuração

### **2. Surge Pricing**
- **Status:** ✅ **Implementado**
- **Variação:** 1.0x a 3.0x
- **Impacto:** Pode aumentar o valor em até 300% em horários de pico

### **3. Pedágio**
- **Status:** ✅ **Implementado**
- **Cálculo:** Baseado na rota ou valor externo
- **Impacto:** Variável conforme a rota

### **4. Opções Extras** (se aplicável)
- Parcelas/Entregas
- Opções selecionadas pelo cliente
- Status: ✅ Implementado no código

---

## 📝 RESUMO DAS FÓRMULAS

### **Fórmula Simplificada (sem conveniência e sem surge):**
```
CUSTO = max(min_fare, base_fare + (distância × rate_per_km) + (tempo/3600 × rate_per_hour)) + pedágio
```

### **Fórmula Completa:**
```
1. Tarifa Base = base_fare + (distância × rate_per_km) + (tempo/3600 × rate_per_hour)
2. Garantir Mínimo = max(Tarifa Base, min_fare)
3. Com Pedágio = Garantir Mínimo + pedágio
4. Conveniência = (Com Pedágio × %conveniência) OU valor_fixo
5. Total = Com Pedágio + Conveniência
6. Surge (se aplicável) = Total × fator_dinâmico
7. VALOR FINAL = Surge OU Total (se não houver surge)
```

---

## 🎯 CUSTOS ADICIONAIS (Fora da Corrida)

### **Taxas de Cancelamento:**
- **Driver cancela:** R$ 4,90 fixo
- **Customer cancela:**
  - Até 2 minutos após aceitação: **SEM TAXA**
  - Após 2 minutos: `(distância + tempo do motorista) × tarifas + R$ 0,80`

### **Taxa de No-Show:**
- **Valor:** R$ 2,90 fixo

---

## ⚠️ NOTA IMPORTANTE

**Taxa de Conveniência:** Não foi especificada nos parâmetros definidos. Precisaria verificar:
1. Se existe no sistema
2. Se é percentual ou fixo
3. Qual o valor/percentual

**Recomendação:** Verificar no código ou configurar se não existir.

---

## 💡 CONCLUSÃO

**O custo real de uma corrida é composto por:**

1. ✅ **Tarifa Base** (bandeira + distância + tempo) - DEFINIDO
2. ✅ **Garantia de Mínimo** (R$ 8,50) - DEFINIDO
3. ✅ **Pedágio** (se houver) - IMPLEMENTADO
4. ⚠️ **Taxa de Conveniência** - PRECISA VERIFICAR
5. ✅ **Surge Pricing** (1.0x a 3.0x) - IMPLEMENTADO
6. ✅ **Opções Extras** (parcelas, etc.) - IMPLEMENTADO

**Valores base (sem conveniência, sem surge, sem pedágio):**
- **Leaf Plus:** min R$ 8,50 | R$ 2,98 + R$ 1,22/km + R$ 15,00/hora
- **Leaf Elite:** min R$ 8,50 | R$ 5,32 + R$ 2,18/km + R$ 17,40/hora

---

**Documento criado em:** 29/01/2025


