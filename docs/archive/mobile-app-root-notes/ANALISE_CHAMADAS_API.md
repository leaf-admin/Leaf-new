# 📊 ANÁLISE DE CHAMADAS DE API - Busca "Urca"

## 🔍 EVENTO: Usuário digitou "Morro da urca" e selecionou destino

### **CHAMADAS IDENTIFICADAS NOS LOGS:**

#### **1. Google Places Autocomplete API** (Busca de lugares)
- **Quantidade:** 1 chamada
- **Quando:** Durante a digitação "Morro da urca"
- **Log identificado:**
  ```
  LOG  📡 Resposta da API Google Places: {"predictions": [...]}
  ```
- **Resultado:** 5 resultados retornados (Morro da Urca, Pão de Açúcar, etc.)

#### **2. Google Place Details API** (Coordenadas do lugar selecionado)
- **Quantidade:** 1 chamada
- **Quando:** Após selecionar "Morro da Urca - Urca, Rio de Janeiro - RJ, Brasil"
- **Log identificado:**
  ```
  LOG  📍 fetchCoordsfromPlace chamado com place_id: ChIJS28qhBeAmQARybbg3efCZBA
  LOG  🌐 URL da API Place Details: https://maps.googleapis.com/maps/api/place/details/json?place_id=...
  LOG  📡 Resposta da API Google Place Details: {"html_attributions": [], "result": {...}}
  ```
- **Resultado:** Coordenadas obtidas: `lat: -22.950571, lng: -43.1642683`

#### **3. Google Directions API** (Cálculo de rota)
- **Quantidade:** 2 chamadas
- **Quando:** Após definir pickup e drop, para calcular estimativas
- **Log identificado:**
  ```
  LOG  📍 Chamando getDirectionsApi SEM waypoints: {...}
  ```
- **Chamadas:**
  1. Primeira chamada para **Leaf Plus** (linha 791)
  2. Segunda chamada para **Leaf Elite** (linha 868)
- **Resultado:** Ambas falharam com erro `[SyntaxError: JSON Parse error: Unexpected character: I]` (código antigo)

---

## 📈 RESUMO TOTAL DE CHAMADAS

| API | Quantidade | Status |
|-----|------------|--------|
| **Google Places Autocomplete** | 1 | ✅ Sucesso |
| **Google Place Details** | 1 | ✅ Sucesso |
| **Google Directions** | 2 | ❌ Falhou (código antigo) |

### **TOTAL: 4 chamadas**

---

## 🎯 FLUXO COMPLETO

1. **Usuário digita "Morro da urca"**
   - → 1 chamada para Places Autocomplete API
   - → Retorna 5 sugestões

2. **Usuário seleciona "Morro da Urca - Urca, Rio de Janeiro - RJ, Brasil"**
   - → 1 chamada para Place Details API
   - → Obtém coordenadas: `-22.950571, -43.1642683`

3. **Sistema calcula estimativas para os carros**
   - → 2 chamadas para Directions API (uma por tipo de carro)
   - → ❌ Ambas falharam (código antigo ainda em uso)

---

## ✅ APÓS CORREÇÃO

Com as correções aplicadas, espera-se:
- **2 chamadas bem-sucedidas** para Directions API (uma por tipo de carro)
- **Total: 4 chamadas** (mesma quantidade, mas todas funcionando)

---

**Data da análise:** $(date)
**Status:** Análise baseada nos logs fornecidos




