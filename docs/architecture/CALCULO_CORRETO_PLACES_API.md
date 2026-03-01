# 💰 Cálculo Correto: Custo de Places API por Corrida

## 🔍 **CHAMADAS DE PLACES API POR CORRIDA**

### Por corrida completa, temos:

1. **Origem (Pickup)**
   - 1 sessão de **Autocomplete** (usuário digita e seleciona)
   - 1 chamada de **Place Details** (converter place_id em lat/lng)
   - **Total: 1 sessão + 1 request**

2. **Destino (Drop)**
   - 1 sessão de **Autocomplete** (usuário digita e seleciona)
   - 1 chamada de **Place Details** (converter place_id em lat/lng)
   - **Total: 1 sessão + 1 request**

**Total por corrida: 2 sessões Autocomplete + 2 Place Details**

---

## 💵 **PREÇOS GOOGLE PLACES API (2024)**

### Preços em USD:
- **Places Autocomplete (Session)**: **$0,0173** por sessão
- **Place Details**: **$0,017** por request
- **Conversão USD → BRL**: ~R$ 5,50 (cotação atual)

### Preços em BRL:
- **Places Autocomplete (Session)**: $0,0173 × R$ 5,50 = **R$ 0,095**
- **Place Details**: $0,017 × R$ 5,50 = **R$ 0,093**

---

## 📊 **CÁLCULO POR CORRIDA**

### Custo de Places API por corrida:

```
2 sessões Autocomplete × R$ 0,095 = R$ 0,190
2 Place Details × R$ 0,093 = R$ 0,186
─────────────────────────────────────
TOTAL: R$ 0,376 por corrida
```

**Arredondando: R$ 0,38 por corrida**

---

## ✅ **CENÁRIO COM CACHE (95% Hit Rate)**

### Por corrida (com cache):
```
2 sessões Autocomplete × 5% (miss) = 0,1 sessão
2 Place Details × 5% (miss) = 0,1 request

0,1 × R$ 0,095 = R$ 0,0095 (Autocomplete)
0,1 × R$ 0,093 = R$ 0,0093 (Place Details)
─────────────────────────────────────
TOTAL: R$ 0,019 por corrida
```

**Arredondando: R$ 0,02 por corrida**

---

## 💰 **ECONOMIA REAL**

### Por Corrida:
```
Sem cache: R$ 0,38
Com cache: R$ 0,02
ECONOMIA: R$ 0,36 por corrida (95% de redução)
```

### Por Mês (5.000 corridas):
```
Sem cache: R$ 1.900,00
Com cache: R$ 100,00
ECONOMIA: R$ 1.800,00/mês (95% de redução)
```

---

## 📝 **CORREÇÃO DO CÁLCULO ANTERIOR**

### ❌ **Cálculo Anterior (ERRADO)**:
- Assumiu 6 chamadas por corrida
- Custo: R$ 0,564 por corrida
- **Problema**: Incluiu chamadas que não são de Places API

### ✅ **Cálculo Correto**:
- 2 sessões Autocomplete + 2 Place Details = 4 operações
- Custo: **R$ 0,38 por corrida**
- **Foco**: Apenas Places API (o que o cache resolve)

---

## 🎯 **RESUMO CORRETO**

| Métrica | Valor |
|---------|-------|
| **Custo sem cache** | R$ 0,38 |
| **Custo com cache** | R$ 0,02 |
| **Economia por corrida** | **R$ 0,36** |
| **% de redução** | **95%** |

### Por Mês (5.000 corridas):
- **Economia mensal**: R$ 1.800,00
- **Economia anual**: R$ 21.600,00

---

## ⚠️ **NOTA IMPORTANTE**

O custo total de APIs do Google Maps por corrida inclui:
- **Places API**: R$ 0,38 (resolvido pelo cache)
- **Directions API**: R$ 0,025 - R$ 0,075 (não afetado pelo cache)
- **Distance Matrix**: R$ 0,025 (não afetado pelo cache)

**Total geral**: R$ 0,43 - R$ 0,48 por corrida (com todas as APIs)

**O cache de Places resolve apenas a parte de Places API (R$ 0,38), economizando R$ 0,36 por corrida.**






