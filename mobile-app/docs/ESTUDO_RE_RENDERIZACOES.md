# 🔄 Estudo: Re-Renderizações Excessivas no Mobile App

**Data:** 2025-12-18  
**Objetivo:** Identificar e corrigir causas de re-renderizações excessivas que impactam performance

---

## 📊 Análise Geral

### **Estatísticas do Código**

- **Total de arquivos analisados:** ~660 arquivos JS/JSX
- **Uso de `useSelector`:** 326 ocorrências em 81 arquivos
- **Uso de `useState/useEffect`:** 147 ocorrências em 11 arquivos principais
- **Uso de `React.memo/useMemo/useCallback`:** 19 ocorrências (BAIXO)
- **Estilos inline:** 724 ocorrências em 14 arquivos
- **setInterval/setTimeout:** 307 ocorrências em 100 arquivos

### **Problema Identificado**

**Razão de Otimização:** `19 / 147 = 12.9%`  
**Conclusão:** ⚠️ **BAIXO USO DE OTIMIZAÇÕES** - Apenas 12.9% dos componentes usam memoização

---

## 🔴 Problemas Críticos Identificados

### **1. Componentes Grandes sem Memoização** 🔴 CRÍTICO

#### **PassengerUI.js (6.613 linhas)**

**Problemas:**
- Componente gigante sem `React.memo`
- Múltiplos `useSelector` sem seletores otimizados
- Props que mudam a cada render
- Funções criadas inline

**Impacto:**
- Re-renderiza a cada mudança no Redux store
- Re-renderiza quando qualquer prop muda
- Re-renderiza filhos desnecessariamente

**Código Problemático:**
```javascript
// ❌ PROBLEMA: Múltiplos useSelector sem seletores
const auth = useSelector(state => state?.auth);
const tripdata = useSelector(state => state?.tripdata);
const settings = useSelector(state => state?.settingsdata?.settings);
const cars = useSelector(state => state?.cartypes?.cars);
const estimatedata = useSelector(state => state?.estimatedata);

// ❌ PROBLEMA: Função criada inline
const handleDriverLocationUpdate = ((location) => {
    setDriverLocation(location);
}, []); // useCallback sem dependências corretas
```

**Solução:**
```javascript
// ✅ SOLUÇÃO: Seletores memoizados
const auth = useSelector(state => state?.auth, shallowEqual);
const tripdata = useSelector(state => state?.tripdata, shallowEqual);

// ✅ SOLUÇÃO: useCallback com dependências
const handleDriverLocationUpdate = useCallback((location) => {
    setDriverLocation(location);
}, []);

// ✅ SOLUÇÃO: Memoizar componente
export default React.memo(PassengerUI);
```

---

#### **DriverUI.js (4.258 linhas)**

**Problemas:**
- Componente gigante sem `React.memo`
- Atualizações de localização frequentes (setInterval)
- Estado que muda constantemente

**Impacto:**
- Re-renderiza a cada atualização de localização
- Re-renderiza filhos desnecessariamente

---

#### **NewMapScreen.js (1.820 linhas)**

**Problemas:**
- Componente principal sem memoização
- Múltiplos `useSelector` sem otimização
- Callbacks criados inline

**Código Problemático:**
```javascript
// ❌ PROBLEMA: Callback sem useCallback
const handleDriverLocationUpdate = ((location) => {
    setDriverLocation(location);
}, []); // useCallback mal usado

// ❌ PROBLEMA: Função render criada a cada render
const renderUI = () => {
    // ... lógica complexa
};
```

---

### **2. Context Providers que Atualizam Frequentemente** 🔴 CRÍTICO

#### **LanguageProvider**

**Problema:**
- Context atualiza quando idioma muda
- Todos os consumidores re-renderizam

**Código:**
```javascript
const LanguageProvider = ({ children }) => {
  const [currentLang, setCurrentLang] = useState('en');
  // ... atualizações frequentes
};
```

**Solução:**
```javascript
// ✅ Dividir context em value e setters
const LanguageContext = createContext();
const LanguageActionsContext = createContext();

// ✅ Memoizar value
const value = useMemo(() => ({
  currentLang,
  t,
  formatCurrency
}), [currentLang]);
```

---

#### **AuthProvider**

**Problema:**
- Atualizações frequentes de estado de autenticação
- Todos os consumidores re-renderizam

---

### **3. Redux Selectors Não Otimizados** 🔴 CRÍTICO

**Problema:**
- 326 usos de `useSelector` sem seletores memoizados
- Seletores criam novos objetos a cada chamada
- Comparação de referência sempre falha

**Exemplo Problemático:**
```javascript
// ❌ PROBLEMA: Cria novo objeto a cada render
const settings = useSelector(state => state?.settingsdata?.settings);

// Se settingsdata mudar, mesmo que settings seja igual, re-renderiza
```

**Solução:**
```javascript
// ✅ SOLUÇÃO: Seletor memoizado
const settingsSelector = useMemo(
  () => (state) => state?.settingsdata?.settings,
  []
);
const settings = useSelector(settingsSelector, shallowEqual);

// ✅ OU: Usar reselect
import { createSelector } from 'reselect';
const settingsSelector = createSelector(
  (state) => state.settingsdata,
  (settingsdata) => settingsdata?.settings
);
```

---

### **4. Estilos Inline (724 ocorrências)** 🟡 IMPORTANTE

**Problema:**
- Estilos criados como objetos inline
- Nova referência a cada render
- Componentes filhos re-renderizam

**Exemplo:**
```javascript
// ❌ PROBLEMA: Novo objeto a cada render
<View style={{ flex: 1, backgroundColor: '#1A330E' }} />

// ✅ SOLUÇÃO: StyleSheet ou useMemo
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#1A330E' }
});
<View style={styles.container} />
```

---

### **5. Event Handlers Inline** 🟡 IMPORTANTE

**Problema:**
- Funções criadas inline em props
- Nova referência a cada render
- Componentes filhos re-renderizam

**Exemplo:**
```javascript
// ❌ PROBLEMA: Nova função a cada render
<TouchableOpacity onPress={() => handlePress()} />

// ✅ SOLUÇÃO: useCallback
const handlePress = useCallback(() => {
  // ...
}, [dependencies]);
<TouchableOpacity onPress={handlePress} />
```

---

### **6. Atualizações Frequentes de Localização** 🔴 CRÍTICO

**Problema:**
- `setInterval` atualizando localização a cada 2-5 segundos
- Estado atualizado constantemente
- Componentes re-renderizam a cada atualização

**Código Problemático:**
```javascript
// ❌ PROBLEMA: setInterval sem throttling adequado
useEffect(() => {
    const interval = setInterval(() => {
        setDriverLocation(location); // Re-renderiza a cada atualização
    }, 2000);
    return () => clearInterval(interval);
}, []);
```

**Solução:**
```javascript
// ✅ SOLUÇÃO: Throttling e memoização
const throttledLocation = useMemo(() => location, [
    Math.floor(location.lat * 1000), // Arredondar para reduzir atualizações
    Math.floor(location.lng * 1000)
]);

// ✅ OU: Usar ref para evitar re-renders
const locationRef = useRef(location);
locationRef.current = location; // Atualiza sem re-render
```

---

### **7. WebSocket Listeners sem Otimização** 🔴 CRÍTICO

**Problema:**
- Listeners WebSocket atualizam estado diretamente
- Cada evento causa re-render
- Múltiplos listeners ativos simultaneamente

**Código Problemático:**
```javascript
// ❌ PROBLEMA: Atualiza estado a cada evento
useWebSocketListeners('TripTracking', {
    onDriverLocationUpdated: (data) => {
        setDriverLocation(data); // Re-renderiza a cada atualização
    },
    onTripStarted: (data) => {
        setTripStatus('em_andamento'); // Re-renderiza
    }
});
```

**Solução:**
```javascript
// ✅ SOLUÇÃO: Throttling e batching
const locationUpdatesRef = useRef([]);
const flushLocationUpdates = useCallback(() => {
    if (locationUpdatesRef.current.length > 0) {
        const latest = locationUpdatesRef.current[locationUpdatesRef.current.length - 1];
        setDriverLocation(latest);
        locationUpdatesRef.current = [];
    }
}, []);

useEffect(() => {
    const interval = setInterval(flushLocationUpdates, 1000); // Batch a cada 1s
    return () => clearInterval(interval);
}, [flushLocationUpdates]);
```

---

### **8. Componentes sem React.memo** 🟡 IMPORTANTE

**Problemas:**
- Componentes filhos re-renderizam quando pai re-renderiza
- Props podem não ter mudado
- Comparação de referência sempre falha

**Componentes Afetados:**
- `PassengerUI` (6.613 linhas)
- `DriverUI` (4.258 linhas)
- `NewMapScreen` (1.820 linhas)
- `PriceCard`
- `RatingModal`
- `DriverMarkerWithRadar`
- E muitos outros...

**Solução:**
```javascript
// ✅ SOLUÇÃO: Memoizar componentes
export default React.memo(PassengerUI, (prevProps, nextProps) => {
    // Comparação customizada
    return (
        prevProps.currentLocation?.lat === nextProps.currentLocation?.lat &&
        prevProps.currentLocation?.lng === nextProps.currentLocation?.lng &&
        prevProps.booking?.status === nextProps.booking?.status
    );
});
```

---

### **9. Dependências Incorretas em useEffect** 🟡 IMPORTANTE

**Problema:**
- `useEffect` com dependências incorretas
- Executa mais vezes que necessário
- Causa re-renders desnecessários

**Exemplo:**
```javascript
// ❌ PROBLEMA: Dependência de objeto completo
useEffect(() => {
    // ...
}, [tripdata]); // Re-executa se qualquer propriedade mudar

// ✅ SOLUÇÃO: Dependência específica
useEffect(() => {
    // ...
}, [tripdata.pickup, tripdata.drop]);
```

---

### **10. Renderização Condicional Complexa** 🟡 IMPORTANTE

**Problema:**
- Função `renderUI()` criada a cada render
- Lógica complexa executada a cada render
- Não memoizada

**Código Problemático:**
```javascript
// ❌ PROBLEMA: Função criada a cada render
const renderUI = () => {
    const userType = auth.profile?.usertype;
    const bookingStatus = booking?.status;
    // ... lógica complexa
    return <Component />;
};

// ✅ SOLUÇÃO: useMemo
const ui = useMemo(() => {
    const userType = auth.profile?.usertype;
    const bookingStatus = booking?.status;
    // ... lógica
    return <Component />;
}, [auth.profile?.usertype, booking?.status]);
```

---

## 📊 Impacto Estimado

### **Antes das Otimizações**

- **Re-renders por minuto:** ~60-120 (localização + WebSocket)
- **Componentes afetados:** ~15-20 por re-render
- **Tempo de render:** ~50-100ms por ciclo
- **Performance:** ⚠️ Degradada em dispositivos mais fracos

### **Depois das Otimizações (Estimado)**

- **Re-renders por minuto:** ~10-20 (apenas mudanças significativas)
- **Componentes afetados:** ~3-5 por re-render
- **Tempo de render:** ~20-40ms por ciclo
- **Performance:** ✅ Melhorada significativamente

**Melhoria Estimada:** 70-80% de redução em re-renders

---

## ✅ Plano de Correção

### **FASE 1: Críticos (Prioridade Alta)**

1. **Memoizar componentes grandes**
   - `PassengerUI` → `React.memo`
   - `DriverUI` → `React.memo`
   - `NewMapScreen` → `React.memo`

2. **Otimizar Redux selectors**
   - Criar seletores memoizados
   - Usar `shallowEqual` ou `reselect`

3. **Throttling de localização**
   - Implementar throttling adequado
   - Usar refs quando possível

4. **Otimizar WebSocket listeners**
   - Batch updates
   - Throttling de eventos

**Tempo estimado:** 2-3 dias

---

### **FASE 2: Importantes (Prioridade Média)**

5. **Memoizar event handlers**
   - Converter para `useCallback`
   - Corrigir dependências

6. **Mover estilos inline para StyleSheet**
   - Criar StyleSheet.create
   - Usar `useMemo` quando necessário

7. **Otimizar Context providers**
   - Dividir contexts
   - Memoizar values

**Tempo estimado:** 2-3 dias

---

### **FASE 3: Melhorias (Prioridade Baixa)**

8. **Memoizar componentes filhos**
   - Aplicar `React.memo` em componentes menores
   - Otimizar comparações

9. **Corrigir dependências de useEffect**
   - Revisar todas as dependências
   - Usar valores específicos

10. **Otimizar renderização condicional**
    - Converter para `useMemo`
    - Extrair lógica complexa

**Tempo estimado:** 1-2 dias

---

## 🛠️ Ferramentas de Diagnóstico

### **1. React DevTools Profiler**

```bash
# Instalar React DevTools
npm install -g react-devtools

# Usar Profiler para identificar re-renders
```

### **2. why-did-you-render**

```bash
npm install @welldone-software/why-did-you-render --save-dev
```

```javascript
// config.js
if (__DEV__) {
  const whyDidYouRender = require('@welldone-software/why-did-you-render');
  whyDidYouRender(React, {
    trackAllPureComponents: true,
  });
}
```

### **3. React Native Performance Monitor**

```javascript
// Adicionar ao App.js
import { PerformanceObserver } from 'react-native-performance';

const observer = new PerformanceObserver((list) => {
  for (const entry of list.getEntries()) {
    if (entry.entryType === 'measure') {
      console.log(`⏱️ ${entry.name}: ${entry.duration}ms`);
    }
  }
});

observer.observe({ entryTypes: ['measure'] });
```

---

## 📋 Checklist de Otimização

### **Componentes**

- [ ] `PassengerUI` memoizado
- [ ] `DriverUI` memoizado
- [ ] `NewMapScreen` memoizado
- [ ] Componentes filhos memoizados
- [ ] Comparações customizadas implementadas

### **Redux**

- [ ] Seletores memoizados criados
- [ ] `shallowEqual` ou `reselect` implementado
- [ ] Reducers otimizados

### **Event Handlers**

- [ ] `useCallback` aplicado
- [ ] Dependências corretas
- [ ] Handlers inline removidos

### **Estilos**

- [ ] Estilos inline movidos para StyleSheet
- [ ] `useMemo` para estilos dinâmicos
- [ ] Refs para estilos que não precisam re-render

### **Localização/WebSocket**

- [ ] Throttling implementado
- [ ] Batch updates configurado
- [ ] Refs usados quando apropriado

### **Context**

- [ ] Contexts divididos
- [ ] Values memoizados
- [ ] Consumers otimizados

---

## 🎯 Priorização

### **Alto Impacto / Baixo Esforço**

1. ✅ Memoizar componentes grandes (2-3 horas)
2. ✅ Otimizar Redux selectors (2-3 horas)
3. ✅ Throttling de localização (1-2 horas)

### **Alto Impacto / Médio Esforço**

4. ✅ Otimizar WebSocket listeners (3-4 horas)
5. ✅ Memoizar event handlers (4-6 horas)

### **Médio Impacto / Baixo Esforço**

6. ✅ Mover estilos inline (2-3 horas)
7. ✅ Otimizar Context providers (2-3 horas)

---

## 📚 Referências

- [React Performance Optimization](https://react.dev/learn/render-and-commit)
- [React.memo Documentation](https://react.dev/reference/react/memo)
- [useMemo/useCallback Best Practices](https://react.dev/reference/react/useMemo)
- [Redux Performance](https://redux.js.org/usage/deriving-data-selectors)

---

**Status:** 🔴 **CRÍTICO - REQUER AÇÃO IMEDIATA**

**Próximo passo:** Implementar Fase 1 (Componentes Críticos)

