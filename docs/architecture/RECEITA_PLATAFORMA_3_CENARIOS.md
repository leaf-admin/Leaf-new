# 💰 ANÁLISE DE RECEITA DA PLATAFORMA - 3 CENÁRIOS

**Data:** 29/01/2025  
**Objetivo:** Calcular receita, custos e lucro operacional baseado em TAXAS FIXAS por faixa de valor

---

## 📊 TAXAS OPERACIONAIS POR FAIXA DE VALOR

| Faixa de Valor | Taxa Operacional Fixa |
|----------------|----------------------|
| **Até R$ 10,00** | **R$ 0,79** |
| **Acima de R$ 10,00 e abaixo de R$ 20,00** | **R$ 0,99** |
| **Acima de R$ 20,00** | **R$ 1,49** |

---

## 📊 DISTRIBUIÇÃO DE VOLUME DE CORRIDAS

| Faixa | Percentual do Volume | Taxa Aplicada |
|-------|----------------------|---------------|
| **Faixa 1** | **30%** | < R$ 10,00 → **R$ 0,79** |
| **Faixa 2** | **40%** | R$ 10,00 - R$ 25,00 → **R$ 0,99** (para R$ 10-20) e **R$ 1,49** (para > R$ 20) |
| **Faixa 3** | **30%** | > R$ 25,00 → **R$ 1,49** |

**Observação:** A Faixa 2 (40%) contém corridas que podem estar na faixa R$ 10-20 (taxa R$ 0,99) ou R$ 20-25 (taxa R$ 1,49). Vou considerar proporcionalmente.

---

## 💰 PARÂMETROS DE CÁLCULO

### **Custo Operacional por Corrida:**
- **R$ 0,127752** (custo fixo de infraestrutura por corrida)

---

## 🎯 CENÁRIO 1: CONSERVADOR

### **Valores e Taxas por Faixa:**

#### **Faixa 1 - 30% das corridas (< R$ 10,00)**
```
Valor médio: R$ 8,50
Taxa operacional: R$ 0,79 (fixa)
Custo fixo: R$ 0,127752
Lucro: R$ 0,79 - R$ 0,127752 = R$ 0,662248
Margem: (R$ 0,662248 / R$ 0,79) × 100 = 83,83%
```

#### **Faixa 2 - 40% das corridas (R$ 10,00 - R$ 25,00)**
**Subdividindo proporcionalmente:**
- 60% da Faixa 2 = R$ 10-20 → Taxa R$ 0,99 (24% do total)
- 40% da Faixa 2 = R$ 20-25 → Taxa R$ 1,49 (16% do total)

**Sub-faixa 2a (24% do total - R$ 15,00 médio):**
```
Valor médio: R$ 15,00
Taxa operacional: R$ 0,99 (fixa)
Custo fixo: R$ 0,127752
Lucro: R$ 0,99 - R$ 0,127752 = R$ 0,862248
Margem: (R$ 0,862248 / R$ 0,99) × 100 = 87,10%
```

**Sub-faixa 2b (16% do total - R$ 22,50 médio):**
```
Valor médio: R$ 22,50
Taxa operacional: R$ 1,49 (fixa)
Custo fixo: R$ 0,127752
Lucro: R$ 1,49 - R$ 0,127752 = R$ 1,362248
Margem: (R$ 1,362248 / R$ 1,49) × 100 = 91,43%
```

#### **Faixa 3 - 30% das corridas (> R$ 25,00)**
```
Valor médio: R$ 35,00
Taxa operacional: R$ 1,49 (fixa)
Custo fixo: R$ 0,127752
Lucro: R$ 1,49 - R$ 0,127752 = R$ 1,362248
Margem: (R$ 1,362248 / R$ 1,49) × 100 = 91,43%
```

### **📊 MÉDIA PONDERADA - CENÁRIO 1:**
```
Receita média = (30% × R$ 0,79) + (24% × R$ 0,99) + (16% × R$ 1,49) + (30% × R$ 1,49)
Receita média = R$ 0,237 + R$ 0,2376 + R$ 0,2384 + R$ 0,447
Receita média = R$ 1,16

Lucro médio = (30% × R$ 0,662248) + (24% × R$ 0,862248) + (16% × R$ 1,362248) + (30% × R$ 1,362248)
Lucro médio = R$ 0,198674 + R$ 0,206940 + R$ 0,217960 + R$ 0,408674
Lucro médio = R$ 1,032248

Margem média = (R$ 1,032248 / R$ 1,16) × 100 = 89,02%
```

---

## 🎯 CENÁRIO 2: REALISTA

### **Valores e Taxas por Faixa:**

#### **Faixa 1 - 30% das corridas (< R$ 10,00)**
```
Valor médio: R$ 9,00
Taxa operacional: R$ 0,79 (fixa)
Custo fixo: R$ 0,127752
Lucro: R$ 0,79 - R$ 0,127752 = R$ 0,662248
Margem: (R$ 0,662248 / R$ 0,79) × 100 = 83,83%
```

#### **Faixa 2 - 40% das corridas (R$ 10,00 - R$ 25,00)**
**Subdividindo proporcionalmente:**
- 60% da Faixa 2 = R$ 10-20 → Taxa R$ 0,99 (24% do total)
- 40% da Faixa 2 = R$ 20-25 → Taxa R$ 1,49 (16% do total)

**Sub-faixa 2a (24% do total - R$ 17,50 médio):**
```
Valor médio: R$ 17,50
Taxa operacional: R$ 0,99 (fixa)
Custo fixo: R$ 0,127752
Lucro: R$ 0,99 - R$ 0,127752 = R$ 0,862248
Margem: (R$ 0,862248 / R$ 0,99) × 100 = 87,10%
```

**Sub-faixa 2b (16% do total - R$ 22,50 médio):**
```
Valor médio: R$ 22,50
Taxa operacional: R$ 1,49 (fixa)
Custo fixo: R$ 0,127752
Lucro: R$ 1,49 - R$ 0,127752 = R$ 1,362248
Margem: (R$ 1,362248 / R$ 1,49) × 100 = 91,43%
```

#### **Faixa 3 - 30% das corridas (> R$ 25,00)**
```
Valor médio: R$ 45,00
Taxa operacional: R$ 1,49 (fixa)
Custo fixo: R$ 0,127752
Lucro: R$ 1,49 - R$ 0,127752 = R$ 1,362248
Margem: (R$ 1,362248 / R$ 1,49) × 100 = 91,43%
```

### **📊 MÉDIA PONDERADA - CENÁRIO 2:**
```
Receita média = (30% × R$ 0,79) + (24% × R$ 0,99) + (16% × R$ 1,49) + (30% × R$ 1,49)
Receita média = R$ 0,237 + R$ 0,2376 + R$ 0,2384 + R$ 0,447
Receita média = R$ 1,16

Lucro médio = (30% × R$ 0,662248) + (24% × R$ 0,862248) + (16% × R$ 1,362248) + (30% × R$ 1,362248)
Lucro médio = R$ 0,198674 + R$ 0,206940 + R$ 0,217960 + R$ 0,408674
Lucro médio = R$ 1,032248

Margem média = (R$ 1,032248 / R$ 1,16) × 100 = 89,02%
```

---

## 🎯 CENÁRIO 3: OTIMISTA

### **Valores e Taxas por Faixa:**

#### **Faixa 1 - 30% das corridas (< R$ 10,00)**
```
Valor médio: R$ 9,50
Taxa operacional: R$ 0,79 (fixa)
Custo fixo: R$ 0,127752
Lucro: R$ 0,79 - R$ 0,127752 = R$ 0,662248
Margem: (R$ 0,662248 / R$ 0,79) × 100 = 83,83%
```

#### **Faixa 2 - 40% das corridas (R$ 10,00 - R$ 25,00)**
**Subdividindo proporcionalmente:**
- 60% da Faixa 2 = R$ 10-20 → Taxa R$ 0,99 (24% do total)
- 40% da Faixa 2 = R$ 20-25 → Taxa R$ 1,49 (16% do total)

**Sub-faixa 2a (24% do total - R$ 17,50 médio):**
```
Valor médio: R$ 17,50
Taxa operacional: R$ 0,99 (fixa)
Custo fixo: R$ 0,127752
Lucro: R$ 0,99 - R$ 0,127752 = R$ 0,862248
Margem: (R$ 0,862248 / R$ 0,99) × 100 = 87,10%
```

**Sub-faixa 2b (16% do total - R$ 22,50 médio):**
```
Valor médio: R$ 22,50
Taxa operacional: R$ 1,49 (fixa)
Custo fixo: R$ 0,127752
Lucro: R$ 1,49 - R$ 0,127752 = R$ 1,362248
Margem: (R$ 1,362248 / R$ 1,49) × 100 = 91,43%
```

#### **Faixa 3 - 30% das corridas (> R$ 25,00)**
```
Valor médio: R$ 60,00
Taxa operacional: R$ 1,49 (fixa)
Custo fixo: R$ 0,127752
Lucro: R$ 1,49 - R$ 0,127752 = R$ 1,362248
Margem: (R$ 1,362248 / R$ 1,49) × 100 = 91,43%
```

### **📊 MÉDIA PONDERADA - CENÁRIO 3:**
```
Receita média = (30% × R$ 0,79) + (24% × R$ 0,99) + (16% × R$ 1,49) + (30% × R$ 1,49)
Receita média = R$ 0,237 + R$ 0,2376 + R$ 0,2384 + R$ 0,447
Receita média = R$ 1,16

Lucro médio = (30% × R$ 0,662248) + (24% × R$ 0,862248) + (16% × R$ 1,362248) + (30% × R$ 1,362248)
Lucro médio = R$ 0,198674 + R$ 0,206940 + R$ 0,217960 + R$ 0,408674
Lucro médio = R$ 1,032248

Margem média = (R$ 1,032248 / R$ 1,16) × 100 = 89,02%
```

---

## 📊 RESUMO COMPARATIVO DOS 3 CENÁRIOS

**Observação:** Como as taxas são FIXAS por faixa de valor, a receita média é a mesma nos 3 cenários, variando apenas os valores médios das corridas (que não afetam a receita, apenas a margem percentual sobre o valor da corrida).

| Métrica | Todos os Cenários |
|---------|------------------|
| **Receita Média/Corrida** | **R$ 1,16** |
| **Lucro Média/Corrida** | **R$ 1,032248** |
| **Margem sobre Receita** | **89,02%** |

---

## 📊 BREAKDOWN DETALHADO POR FAIXA E TAXA

### **Taxa R$ 0,79 (Corridas < R$ 10,00) - 30% do volume**
```
Receita: R$ 0,79 (fixa)
Custo: R$ 0,127752
Lucro: R$ 0,662248
Margem: 83,83%
```

### **Taxa R$ 0,99 (Corridas R$ 10,00 - R$ 20,00) - 24% do volume**
```
Receita: R$ 0,99 (fixa)
Custo: R$ 0,127752
Lucro: R$ 0,862248
Margem: 87,10%
```

### **Taxa R$ 1,49 (Corridas > R$ 20,00) - 46% do volume (16% + 30%)**
```
Receita: R$ 1,49 (fixa)
Custo: R$ 0,127752
Lucro: R$ 1,362248
Margem: 91,43%
```

---

## 💡 EXEMPLO PRÁTICO: 100 CORRIDAS

### **Distribuição e Cálculo:**

**30 corridas (30%) - Valor < R$ 10,00:**
- Taxa: R$ 0,79 cada
- Receita: 30 × R$ 0,79 = R$ 23,70
- Lucro: 30 × R$ 0,662248 = R$ 19,87

**24 corridas (24%) - Valor R$ 10,00 - R$ 20,00:**
- Taxa: R$ 0,99 cada
- Receita: 24 × R$ 0,99 = R$ 23,76
- Lucro: 24 × R$ 0,862248 = R$ 20,69

**16 corridas (16%) - Valor R$ 20,00 - R$ 25,00:**
- Taxa: R$ 1,49 cada
- Receita: 16 × R$ 1,49 = R$ 23,84
- Lucro: 16 × R$ 1,362248 = R$ 21,80

**30 corridas (30%) - Valor > R$ 25,00:**
- Taxa: R$ 1,49 cada
- Receita: 30 × R$ 1,49 = R$ 44,70
- Lucro: 30 × R$ 1,362248 = R$ 40,87

**TOTAL 100 CORRIDAS:**
- Receita total: R$ 116,00
- Lucro total: R$ 103,23
- Receita média: R$ 1,16
- Lucro médio: R$ 1,032248
- Margem: 89,02%

---

## 📈 PROJEÇÕES MENSAIS

### **Para 30.000 corridas/mês:**
```
Receita mensal: 30.000 × R$ 1,16 = R$ 34.800
Lucro mensal: 30.000 × R$ 1,032248 = R$ 30.967
Margem: 89,02%
```

---

## 🎯 CONCLUSÕES

### **✅ TAXAS FIXAS APLICADAS:**
- **< R$ 10,00:** R$ 0,79 por corrida
- **R$ 10,00 - R$ 20,00:** R$ 0,99 por corrida
- **> R$ 20,00:** R$ 1,49 por corrida

### **💰 RESULTADOS:**
- **Receita média por corrida:** R$ 1,16 (fixa, não varia com valor da corrida)
- **Lucro médio por corrida:** R$ 1,032248
- **Margem sobre receita:** 89,02%
- **Todas as faixas são lucrativas** (margem mínima de 83,83%)

### **🚀 VIABILIDADE:**
**ALTAMENTE VIÁVEL** - Sistema de taxas fixas garante receita previsível e lucrativa, independente do valor da corrida.

---

**Documento criado em:** 29/01/2025  
**Método:** Cálculo baseado em TAXAS FIXAS por faixa de valor da corrida
