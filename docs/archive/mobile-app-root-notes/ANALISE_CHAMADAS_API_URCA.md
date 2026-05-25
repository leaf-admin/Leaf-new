# 📊 ANÁLISE DE CHAMADAS DE API - Busca "Urca"

## 🔍 EVENTO: Usuário digitou "Morro da urca" e selecionou destino

### **CHAMADAS IDENTIFICADAS NOS LOGS:**

#### **1. Google Places Autocomplete API** (Busca de lugares)
- **Quantidade:** **1 chamada**
- **Quando:** Durante a digitação "Morro da urca"
- **Evidência nos logs:**
  ```
  LOG  📡 Resposta da API Google Places: {"predictions": [{"description": "Morro da Urca - Urca, Rio de Janeiro - RJ, Brasil", ...}, ...]}
  LOG  ✅ Resultados convertidos: 5
  LOG  ✅ Places API retornou: 5 resultados
  ```
- **Endpoint:** `https://maps.googleapis.com/maps/api/place/autocomplete/json`
- **Resultado:** ✅ **5 resultados** retornados

#### **2. Google Place Details API** (Obter coordenadas do lugar selecionado)
- **Quantidade:** **1 chamada**
- **Quando:** Após selecionar "Morro da Urca - Urca, Rio de Janeiro - RJ, Brasil"
- **Evidência nos logs:**
  ```
  LOG  📍 fetchCoordsfromPlace chamado com place_id: ChIJS28qhBeAmQARybbg3efCZBA
  LOG  🌐 URL da API Place Details: https://maps.googleapis.com/maps/api/place/details/json?place_id=ChIJS28qhBeAmQARybbg3efCZBA&key=...
  LOG  📡 Resposta da API Google Place Details: {"html_attributions": [], "result": {"formatted_address": "Morro da Urca - Urca, Rio de Janeiro - RJ, Brasil", "geometry": {"location": {...}}, "name": "Morro da Urca"}, "status": "OK"}
  LOG  ✅ Coordenadas obtidas: {"formatted_address": "Morro da Urca - Urca, Rio de Janeiro - RJ, Brasil", "lat": -22.950571, "lng": -43.1642683, "name": "Morro da Urca"}
  ```
- **Endpoint:** `https://maps.googleapis.com/maps/api/place/details/json`
- **Resultado:** ✅ **Coordenadas obtidas** com sucesso

#### **3. Google Directions API** (Cálculo de rota e estimativas)
- **Quantidade:** **2 chamadas**
- **Quando:** Após definir pickup e drop, para calcular estimativas para cada tipo de carro
- **Evidência nos logs:**
  ```
  LOG  📍 Chamando getDirectionsApi SEM waypoints: {"destLoc": "-22.950571,-43.1642683", "startLoc": "-22.9207996,-43.406029"}
  LOG  🚗 Processando carro: Leaf Plus
  LOG  📞 Chamando prepareEstimateObject para Leaf Plus
  [... primeira chamada ...]
  LOG  🚗 Processando carro: Leaf Elite
  LOG  📞 Chamando prepareEstimateObject para Leaf Elite
  [... segunda chamada ...]
  ```
- **Chamadas:**
  1. **Primeira chamada** para **Leaf Plus** (linha 791 dos logs)
  2. **Segunda chamada** para **Leaf Elite** (linha 868 dos logs)
- **Endpoint:** `https://maps.googleapis.com/maps/api/directions/json`
- **Resultado:** ❌ **Ambas falharam** (código antigo ainda estava sendo usado, causando erro `[SyntaxError: JSON Parse error: Unexpected character: I]`)

---

## 📈 RESUMO TOTAL DE CHAMADAS

| API | Quantidade | Status | Detalhes |
|-----|------------|--------|----------|
| **Google Places Autocomplete** | **1** | ✅ Sucesso | Busca "Morro da urca" → 5 resultados |
| **Google Place Details** | **1** | ✅ Sucesso | Obtém coordenadas do lugar selecionado |
| **Google Directions** | **2** | ❌ Falhou | Uma por tipo de carro (Leaf Plus + Leaf Elite) |

### **TOTAL: 4 chamadas de API**

---

## 🎯 FLUXO COMPLETO DETALHADO

### **Fase 1: Busca do lugar (1 chamada)**
1. Usuário digita **"Morro da urca"**
   - → **1 chamada** para **Places Autocomplete API**
   - → Retorna **5 sugestões** (Morro da Urca, Pão de Açúcar, Urca, Trilha do Morro da Urca, Bondinho Pão de Açúcar)

### **Fase 2: Seleção do lugar (1 chamada)**
2. Usuário seleciona **"Morro da Urca - Urca, Rio de Janeiro - RJ, Brasil"**
   - → **1 chamada** para **Place Details API**
   - → Obtém coordenadas: `lat: -22.950571, lng: -43.1642683`
   - → Atualiza Redux com `UPDATE_TRIP_DROP`

### **Fase 3: Cálculo de estimativas (2 chamadas)**
3. Sistema detecta que pickup e drop estão definidos
   - → Dispara `fetchEstimates` para calcular estimativas
   - → **1 chamada** para **Directions API** (Leaf Plus)
   - → **1 chamada** para **Directions API** (Leaf Elite)
   - → ❌ Ambas falharam devido ao código antigo ainda em uso

---

## ✅ APÓS CORREÇÃO (Esperado)

Com as correções aplicadas nos arquivos:
- `mobile-app/common/src/other/GoogleAPIFunctions.js`
- `mobile-app/common/common-packages/src/other/GoogleAPIFunctions.js`

**Espera-se:**
- **2 chamadas bem-sucedidas** para Directions API (uma por tipo de carro)
- **Total: 4 chamadas** (mesma quantidade, mas todas funcionando corretamente)
- Rotas calculadas com sucesso
- Polyline gerada para exibição no mapa
- Estimativas de preço e tempo exibidas nos cards

---

## 💰 CUSTO ESTIMADO (Google Cloud)

- **Places Autocomplete API:** ~$0.017 por 1000 requisições
- **Place Details API:** ~$0.017 por 1000 requisições  
- **Directions API:** ~$0.005 por requisição

**Total estimado para esta operação:** ~$0.012 (muito baixo)

---

**Data da análise:** 2025-01-06
**Status:** Análise baseada nos logs fornecidos anteriormente




