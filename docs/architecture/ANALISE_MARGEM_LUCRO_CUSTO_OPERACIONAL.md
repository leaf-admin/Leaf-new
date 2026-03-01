# 💰 Análise de Margem de Lucro: Custo Operacional vs Custos de API

## 📊 **CENÁRIO ATUAL - CUSTO OPERACIONAL COBRADO**

### Faixas de Custo Operacional:
- **Corridas até R$ 10,00**: R$ 0,79 de custo operacional
- **Corridas entre R$ 10,01 e R$ 25,00**: R$ 0,99 de custo operacional
- **Corridas acima de R$ 25,00**: R$ 1,49 de custo operacional

---

## 💵 **CUSTOS DE API DO GOOGLE MAPS**

### Custo por Corrida (com cache implementado):

#### Primeira Corrida (sem cache):
- **Total**: R$ 0,43
  - Places API: R$ 0,38
  - Distance Matrix: R$ 0,025
  - Directions API: R$ 0,025

#### Segunda Corrida (com cache - 95% hit rate):
- **Total**: R$ 0,07
  - Places API: R$ 0,02 (cache hit)
  - Distance Matrix: R$ 0,025
  - Directions API: R$ 0,025

### Custo Médio Estimado (considerando cache):

**Cenário Realista:**
- Primeira semana: 20% das corridas (sem cache) = R$ 0,43
- Restante: 80% das corridas (com cache) = R$ 0,07

**Cálculo:**
```
(20% × R$ 0,43) + (80% × R$ 0,07) = 
R$ 0,086 + R$ 0,056 = 
R$ 0,142 por corrida (média)
```

**Arredondando: R$ 0,14 por corrida (custo médio de API)**

---

## 📈 **ANÁLISE POR FAIXA DE VALOR**

### Faixa 1: Corridas até R$ 10,00

**Custo Operacional Cobrado:** R$ 0,79
**Custo de API:** R$ 0,14
**Lucro Líquido:** R$ 0,79 - R$ 0,14 = **R$ 0,65**

**Margem de Lucro:** (R$ 0,65 / R$ 0,79) × 100 = **82,3%**

---

### Faixa 2: Corridas entre R$ 10,01 e R$ 25,00

**Custo Operacional Cobrado:** R$ 0,99
**Custo de API:** R$ 0,14
**Lucro Líquido:** R$ 0,99 - R$ 0,14 = **R$ 0,85**

**Margem de Lucro:** (R$ 0,85 / R$ 0,99) × 100 = **85,9%**

---

### Faixa 3: Corridas acima de R$ 25,00

**Custo Operacional Cobrado:** R$ 1,49
**Custo de API:** R$ 0,14
**Lucro Líquido:** R$ 1,49 - R$ 0,14 = **R$ 1,35**

**Margem de Lucro:** (R$ 1,35 / R$ 1,49) × 100 = **90,6%**

---

## 📊 **RESUMO COMPARATIVO**

| Faixa de Valor | Custo Operacional Cobrado | Custo de API | Lucro Líquido | Margem de Lucro |
|----------------|---------------------------|--------------|---------------|-----------------|
| **Até R$ 10** | R$ 0,79 | R$ 0,14 | **R$ 0,65** | **82,3%** |
| **R$ 10,01 - R$ 25** | R$ 0,99 | R$ 0,14 | **R$ 0,85** | **85,9%** |
| **Acima de R$ 25** | R$ 1,49 | R$ 0,14 | **R$ 1,35** | **90,6%** |

---

## 💰 **CÁLCULO DE MÉDIA PONDERADA**

### Cenário Realista de Distribuição de Corridas:

Assumindo distribuição típica de app de transporte:
- **40%** das corridas: até R$ 10,00
- **45%** das corridas: entre R$ 10,01 e R$ 25,00
- **15%** das corridas: acima de R$ 25,00

### Cálculo da Média Ponderada:

**Lucro por Faixa:**
- Faixa 1 (40%): R$ 0,65
- Faixa 2 (45%): R$ 0,85
- Faixa 3 (15%): R$ 1,35

**Média Ponderada:**
```
(40% × R$ 0,65) + (45% × R$ 0,85) + (15% × R$ 1,35) =
R$ 0,26 + R$ 0,3825 + R$ 0,2025 =
R$ 0,845 por corrida
```

**Arredondando: R$ 0,85 por corrida (lucro médio)**

---

## 📈 **MARGEM MÉDIA DE LUCRO**

### Custo Operacional Médio Cobrado:

```
(40% × R$ 0,79) + (45% × R$ 0,99) + (15% × R$ 1,49) =
R$ 0,316 + R$ 0,4455 + R$ 0,2235 =
R$ 0,985 por corrida
```

**Arredondando: R$ 0,99 por corrida (custo operacional médio cobrado)**

### Margem Média de Lucro:

```
Lucro Médio: R$ 0,85
Custo Operacional Médio: R$ 0,99
Custo de API: R$ 0,14

Margem = (R$ 0,85 / R$ 0,99) × 100 = 85,9%
```

---

## 🎯 **RESUMO EXECUTIVO**

### Lucro Líquido por Corrida (após custos de API):

| Faixa | Lucro Líquido |
|-------|---------------|
| Até R$ 10 | **R$ 0,65** |
| R$ 10,01 - R$ 25 | **R$ 0,85** |
| Acima de R$ 25 | **R$ 1,35** |
| **MÉDIA** | **R$ 0,85** |

### Margem de Lucro:

| Faixa | Margem |
|-------|--------|
| Até R$ 10 | **82,3%** |
| R$ 10,01 - R$ 25 | **85,9%** |
| Acima de R$ 25 | **90,6%** |
| **MÉDIA** | **85,9%** |

---

## 📊 **PROJEÇÃO MENSAL**

### Assumindo 5.000 corridas/mês:

**Distribuição:**
- 2.000 corridas (40%) até R$ 10: 2.000 × R$ 0,65 = R$ 1.300,00
- 2.250 corridas (45%) entre R$ 10-25: 2.250 × R$ 0,85 = R$ 1.912,50
- 750 corridas (15%) acima de R$ 25: 750 × R$ 1,35 = R$ 1.012,50

**Total de Lucro Mensal:**
```
R$ 1.300,00 + R$ 1.912,50 + R$ 1.012,50 = R$ 4.225,00/mês
```

**Ou pela média:**
```
5.000 corridas × R$ 0,85 = R$ 4.250,00/mês
```

---

## ⚠️ **CENÁRIOS ALTERNATIVOS**

### Cenário 1: Sem Cache (100% das corridas pagam API completa)

**Custo de API:** R$ 0,43 por corrida

| Faixa | Custo Operacional | Custo API | Lucro | Margem |
|-------|-------------------|-----------|-------|--------|
| Até R$ 10 | R$ 0,79 | R$ 0,43 | R$ 0,36 | 45,6% |
| R$ 10-25 | R$ 0,99 | R$ 0,43 | R$ 0,56 | 56,6% |
| Acima R$ 25 | R$ 1,49 | R$ 0,43 | R$ 1,06 | 71,1% |
| **MÉDIA** | **R$ 0,99** | **R$ 0,43** | **R$ 0,56** | **56,6%** |

**Impacto:** Lucro médio cai de R$ 0,85 para R$ 0,56 (34% de redução)

---

### Cenário 2: Cache Perfeito (100% hit rate)

**Custo de API:** R$ 0,05 por corrida (apenas Distance Matrix + Directions)

| Faixa | Custo Operacional | Custo API | Lucro | Margem |
|-------|-------------------|-----------|-------|--------|
| Até R$ 10 | R$ 0,79 | R$ 0,05 | R$ 0,74 | 93,7% |
| R$ 10-25 | R$ 0,99 | R$ 0,05 | R$ 0,94 | 94,9% |
| Acima R$ 25 | R$ 1,49 | R$ 0,05 | R$ 1,44 | 96,6% |
| **MÉDIA** | **R$ 0,99** | **R$ 0,05** | **R$ 0,94** | **94,9%** |

**Impacto:** Lucro médio aumenta de R$ 0,85 para R$ 0,94 (10,6% de aumento)

---

## ✅ **CONCLUSÃO**

### Situação Atual (com cache implementado):

**Lucro Médio por Corrida:** **R$ 0,85**
**Margem Média de Lucro:** **85,9%**

### Comparação:

| Cenário | Lucro Médio | Margem |
|---------|-------------|--------|
| **Atual (com cache)** | **R$ 0,85** | **85,9%** |
| Sem cache | R$ 0,56 | 56,6% |
| Cache perfeito | R$ 0,94 | 94,9% |

### Impacto do Cache:

O cache de Places API gera um **incremento de R$ 0,29 por corrida** em lucro (R$ 0,85 vs R$ 0,56 sem cache), representando um **aumento de 52% no lucro** comparado ao cenário sem cache.

---

## 🎯 **RESPOSTA DIRETA**

**Quanto sobra ao cobrir os custos de API como lucro?**

**Média: R$ 0,85 por corrida (85,9% de margem)**

**Por faixa:**
- Até R$ 10: **R$ 0,65** (82,3% de margem)
- R$ 10-25: **R$ 0,85** (85,9% de margem)
- Acima de R$ 25: **R$ 1,35** (90,6% de margem)






