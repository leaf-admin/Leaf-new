# 📊 APIs Chamadas por Corrida - Quantidade e Valores

## 🎯 **RESUMO EXECUTIVO**

### Primeira Corrida (Sem Cache):
- **Total de APIs**: 5 chamadas
- **Custo Total**: R$ 0,43

### Segunda Corrida (Com Cache):
- **Total de APIs**: 3 chamadas (2 do cache)
- **Custo Total**: R$ 0,07

---

## 📋 **DETALHAMENTO COMPLETO POR API**

### 1️⃣ **PLACES API - Autocomplete (Session)**

**O que faz:** Busca sugestões de endereços enquanto o usuário digita

**Quantidade por corrida:**
- **Origem (Pickup)**: 1 sessão
- **Destino (Drop)**: 1 sessão
- **Total**: 2 sessões

**Custo:**
- **Por sessão**: R$ 0,095
- **Total por corrida (sem cache)**: 2 × R$ 0,095 = **R$ 0,190**
- **Total por corrida (com cache - 95% hit)**: 0,1 × R$ 0,095 = **R$ 0,009**

**Status:** ✅ Resolvido pelo cache (95% de economia)

---

### 2️⃣ **PLACES API - Place Details**

**O que faz:** Converte Place ID em coordenadas (lat/lng) do endereço selecionado

**Quantidade por corrida:**
- **Origem (Pickup)**: 1 request
- **Destino (Drop)**: 1 request
- **Total**: 2 requests

**Custo:**
- **Por request**: R$ 0,093
- **Total por corrida (sem cache)**: 2 × R$ 0,093 = **R$ 0,186**
- **Total por corrida (com cache - 95% hit)**: 0,1 × R$ 0,093 = **R$ 0,009**

**Status:** ✅ Resolvido pelo cache (95% de economia)

---

### 3️⃣ **DISTANCE MATRIX API**

**O que faz:** Calcula tempo de chegada dos motoristas próximos ao ponto de origem

**Quantidade por corrida:**
- **Busca de motoristas**: 1 request
- **Total**: 1 request

**Custo:**
- **Por request**: R$ 0,025
- **Total por corrida**: 1 × R$ 0,025 = **R$ 0,025**

**Status:** ❌ Não afetado pelo cache (sempre precisa buscar motoristas atuais)

---

### 4️⃣ **DIRECTIONS API**

**O que faz:** Calcula rota entre origem e destino (distância, tempo, trânsito)

**Quantidade por corrida:**
- **Estimativa de tarifa**: 1 request
- **Rota da corrida**: 0-1 request (reutiliza estimativa na maioria dos casos)
- **Atualizações (opcional)**: 0-2 requests
- **Total**: 1-3 requests (média: 1 request)

**Custo:**
- **Por request**: R$ 0,025
- **Total por corrida (mínimo)**: 1 × R$ 0,025 = **R$ 0,025**
- **Total por corrida (máximo)**: 3 × R$ 0,025 = **R$ 0,075**
- **Total por corrida (média)**: 1 × R$ 0,025 = **R$ 0,025**

**Status:** ❌ Não afetado pelo cache (rota muda com trânsito em tempo real)

**Nota:** O request de estimativa é REUTILIZADO para a rota da corrida (economia de 1 request)

---

## 📊 **TABELA COMPLETA - PRIMEIRA CORRIDA (SEM CACHE)**

| API | Quantidade | Custo Unitário | Custo Total | Status |
|-----|------------|----------------|------------|--------|
| **Places Autocomplete** | 2 sessões | R$ 0,095 | **R$ 0,190** | ❌ Sem cache |
| **Place Details** | 2 requests | R$ 0,093 | **R$ 0,186** | ❌ Sem cache |
| **Distance Matrix** | 1 request | R$ 0,025 | **R$ 0,025** | ✅ Sempre necessário |
| **Directions API** | 1 request | R$ 0,025 | **R$ 0,025** | ✅ Sempre necessário |
| **TOTAL** | **6 operações** | - | **R$ 0,426** | - |

**Arredondando: R$ 0,43 por corrida**

---

## 📊 **TABELA COMPLETA - SEGUNDA CORRIDA (COM CACHE - 95% Hit Rate)**

| API | Quantidade | Custo Unitário | Custo Total | Status |
|-----|------------|----------------|------------|--------|
| **Places Autocomplete** | 0,1 sessão | R$ 0,095 | **R$ 0,009** | ✅ Cache (95% hit) |
| **Place Details** | 0,1 request | R$ 0,093 | **R$ 0,009** | ✅ Cache (95% hit) |
| **Distance Matrix** | 1 request | R$ 0,025 | **R$ 0,025** | ✅ Sempre necessário |
| **Directions API** | 1 request | R$ 0,025 | **R$ 0,025** | ✅ Sempre necessário |
| **TOTAL** | **2,2 operações** | - | **R$ 0,068** | - |

**Arredondando: R$ 0,07 por corrida**

---

## 💰 **COMPARAÇÃO DETALHADA**

### Primeira Corrida (Sem Cache):

```
┌─────────────────────────────────────┐
│ Places API                          │
├─────────────────────────────────────┤
│ • Autocomplete: 2 sessões × R$ 0,095│ = R$ 0,190
│ • Place Details: 2 × R$ 0,093      │ = R$ 0,186
│ Subtotal Places:                    │ R$ 0,376
├─────────────────────────────────────┤
│ Distance Matrix: 1 × R$ 0,025       │ = R$ 0,025
├─────────────────────────────────────┤
│ Directions API: 1 × R$ 0,025        │ = R$ 0,025
├─────────────────────────────────────┤
│ TOTAL:                              │ R$ 0,426
└─────────────────────────────────────┘
```

### Segunda Corrida (Com Cache):

```
┌─────────────────────────────────────┐
│ Places API (Cache 95%)              │
├─────────────────────────────────────┤
│ • Autocomplete: 0,1 × R$ 0,095      │ = R$ 0,009
│ • Place Details: 0,1 × R$ 0,093     │ = R$ 0,009
│ Subtotal Places:                    │ R$ 0,018
├─────────────────────────────────────┤
│ Distance Matrix: 1 × R$ 0,025       │ = R$ 0,025
├─────────────────────────────────────┤
│ Directions API: 1 × R$ 0,025        │ = R$ 0,025
├─────────────────────────────────────┤
│ TOTAL:                              │ R$ 0,068
└─────────────────────────────────────┘
```

---

## 📈 **CUSTO MÉDIO POR CORRIDA (Cenário Realista)**

### Distribuição:
- **20%** das corridas: Primeira vez (sem cache) = R$ 0,43
- **80%** das corridas: Segunda vez+ (com cache) = R$ 0,07

### Cálculo:
```
(20% × R$ 0,43) + (80% × R$ 0,07) = 
R$ 0,086 + R$ 0,056 = 
R$ 0,142 por corrida
```

**Arredondando: R$ 0,14 por corrida (custo médio)**

---

## 🎯 **RESUMO POR API**

### Places API (Autocomplete + Place Details):

| Métrica | Sem Cache | Com Cache | Economia |
|---------|-----------|-----------|----------|
| **Quantidade** | 4 operações | 0,2 operações | 95% |
| **Custo** | R$ 0,38 | R$ 0,02 | R$ 0,36 |

### Distance Matrix API:

| Métrica | Sem Cache | Com Cache | Economia |
|---------|-----------|-----------|----------|
| **Quantidade** | 1 request | 1 request | 0% |
| **Custo** | R$ 0,025 | R$ 0,025 | R$ 0,00 |

### Directions API:

| Métrica | Sem Cache | Com Cache | Economia |
|---------|-----------|-----------|----------|
| **Quantidade** | 1 request | 1 request | 0% |
| **Custo** | R$ 0,025 | R$ 0,025 | R$ 0,00 |

---

## 📊 **TABELA FINAL - TODAS AS APIs**

| API | Quantidade (Sem Cache) | Quantidade (Com Cache) | Custo Unitário | Custo Total (Sem Cache) | Custo Total (Com Cache) | Economia |
|-----|------------------------|------------------------|----------------|-------------------------|-------------------------|----------|
| **Places Autocomplete** | 2 sessões | 0,1 sessão | R$ 0,095 | R$ 0,190 | R$ 0,009 | R$ 0,181 |
| **Place Details** | 2 requests | 0,1 request | R$ 0,093 | R$ 0,186 | R$ 0,009 | R$ 0,177 |
| **Distance Matrix** | 1 request | 1 request | R$ 0,025 | R$ 0,025 | R$ 0,025 | R$ 0,00 |
| **Directions API** | 1 request | 1 request | R$ 0,025 | R$ 0,025 | R$ 0,025 | R$ 0,00 |
| **TOTAL** | **6 operações** | **2,2 operações** | - | **R$ 0,426** | **R$ 0,068** | **R$ 0,358** |

---

## ✅ **CONCLUSÃO**

### APIs Chamadas por Corrida:

**Primeira Corrida (Sem Cache):**
- Places Autocomplete: **2 sessões** = R$ 0,190
- Place Details: **2 requests** = R$ 0,186
- Distance Matrix: **1 request** = R$ 0,025
- Directions API: **1 request** = R$ 0,025
- **TOTAL: 6 operações = R$ 0,43**

**Segunda Corrida (Com Cache):**
- Places Autocomplete: **0,1 sessão** = R$ 0,009
- Place Details: **0,1 request** = R$ 0,009
- Distance Matrix: **1 request** = R$ 0,025
- Directions API: **1 request** = R$ 0,025
- **TOTAL: 2,2 operações = R$ 0,07**

**Custo Médio (20% sem cache + 80% com cache): R$ 0,14 por corrida**






