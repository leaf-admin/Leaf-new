# 🔧 GUIA: Como Ajustar o Zoom da Rota e Ver no Celular

## 📱 MÉTODO 1: Ajustar valores e recarregar (RECOMENDADO)

### **Passos:**

1. **Edite os valores de padding** em `NewMapScreen.js` (linhas 278-284):
```javascript
mapRef.current.fitToCoordinates(allCoordinates, {
    edgePadding: {
        top: 140,      // ← Ajuste este valor
        right: 50,    // ← Ajuste este valor
        bottom: 340,   // ← Ajuste este valor
        left: 50       // ← Ajuste este valor
    },
    animated: true
});
```

2. **Salve o arquivo** (Ctrl+S / Cmd+S)

3. **No celular, recarregue o app:**
   - **React Native:** Agite o celular → "Reload" ou pressione `r` no terminal
   - **Expo:** O hot reload deve atualizar automaticamente

4. **Teste novamente:** Selecione um destino e veja o zoom ajustado

---

## 📱 MÉTODO 2: Usar logs para ver valores atuais

### **Adicione logs temporários:**

```javascript
const fitRouteToVisibleArea = useCallback(() => {
    // ... código existente ...
    
    console.log('🔧 VALORES DE PADDING ATUAIS:', {
        top: 140,
        right: 50,
        bottom: 340,
        left: 50
    });
    
    mapRef.current.fitToCoordinates(allCoordinates, {
        edgePadding: {
            top: 140,
            right: 50,
            bottom: 340,
            left: 50
        },
        animated: true
    });
}, [routePolyline, tripdata]);
```

**No celular:** Veja os logs no Metro Bundler ou React Native Debugger

---

## 📱 MÉTODO 3: Criar variáveis no topo do arquivo (FÁCIL DE AJUSTAR)

### **Modifique o código para usar constantes:**

```javascript
// No topo do arquivo, após os imports
const ZOOM_PADDING = {
    top: 140,      // Header + margem
    right: 50,     // Padding lateral
    bottom: 340,   // AddressFields + CarCard + margem
    left: 50       // Padding lateral
};

// Na função fitRouteToVisibleArea:
mapRef.current.fitToCoordinates(allCoordinates, {
    edgePadding: ZOOM_PADDING,
    animated: true
});
```

**Vantagem:** Todos os valores ficam em um lugar só, fácil de ajustar!

---

## 📱 MÉTODO 4: Usar valores dinâmicos baseados em Dimensions

### **Calcular padding baseado no tamanho da tela:**

```javascript
import { Dimensions } from 'react-native';

const { width, height } = Dimensions.get('window');

const fitRouteToVisibleArea = useCallback(() => {
    // ... código existente ...
    
    // Calcular padding baseado em porcentagem da tela
    const ZOOM_PADDING = {
        top: height * 0.15,      // 15% do topo
        right: width * 0.05,     // 5% de cada lado
        bottom: height * 0.40,   // 40% da parte inferior
        left: width * 0.05       // 5% de cada lado
    };
    
    console.log('🔧 PADDING CALCULADO:', ZOOM_PADDING);
    
    mapRef.current.fitToCoordinates(allCoordinates, {
        edgePadding: ZOOM_PADDING,
        animated: true
    });
}, [routePolyline, tripdata]);
```

**Vantagem:** Adapta-se automaticamente a diferentes tamanhos de tela!

---

## 🎯 VALORES SUGERIDOS PARA TESTE

### **Se a rota está cortada no topo:**
- Aumente `top` (ex: de 140 para 160)

### **Se a rota está cortada na parte inferior:**
- Aumente `bottom` (ex: de 340 para 380)

### **Se a rota está cortada nas laterais:**
- Aumente `left` e `right` (ex: de 50 para 70)

### **Se a rota está muito "apertada" (zoom muito próximo):**
- Aumente todos os valores proporcionalmente

### **Se a rota está muito "aberta" (zoom muito distante):**
- Diminua todos os valores proporcionalmente

---

## 🔍 COMO VER O RESULTADO NO CELULAR

### **Opção A: Hot Reload (Mais Rápido)**
1. Salve o arquivo
2. O app recarrega automaticamente (se hot reload estiver ativo)
3. Selecione um destino novamente

### **Opção B: Reload Manual**
1. No terminal do Metro Bundler, pressione `r`
2. Ou agite o celular → "Reload"

### **Opção C: Rebuild Completo (Se necessário)**
```bash
cd mobile-app
npx react-native start --reset-cache
```

---

## 📊 EXEMPLO DE AJUSTE PROGRESSIVO

### **Teste 1: Valores iniciais**
```javascript
top: 140, bottom: 340, left: 50, right: 50
```

### **Teste 2: Se cortou embaixo, aumentar bottom**
```javascript
top: 140, bottom: 380, left: 50, right: 50
```

### **Teste 3: Se cortou em cima também, aumentar top**
```javascript
top: 160, bottom: 380, left: 50, right: 50
```

### **Teste 4: Ajuste fino**
```javascript
top: 150, bottom: 360, left: 50, right: 50
```

---

## 💡 DICA: Use console.log para debug

Adicione este log para ver exatamente o que está sendo aplicado:

```javascript
console.log('🔧 APLICANDO ZOOM COM PADDING:', {
    top: 140,
    right: 50,
    bottom: 340,
    left: 50,
    coordinatesCount: allCoordinates.length
});
```

**Veja os logs no terminal do Metro Bundler ou no React Native Debugger!**

---

**Data:** 2025-01-06
**Status:** Guia prático para ajustes



