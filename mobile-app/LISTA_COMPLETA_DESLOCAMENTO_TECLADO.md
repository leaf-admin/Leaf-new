# 📋 LISTA COMPLETA: Códigos que Deslocam Card e Botão quando Teclado Abre

## 🔍 TODAS AS FUNÇÕES E CÓDIGOS ENCONTRADOS

### **1. AndroidManifest.xml** ⚠️ **PRINCIPAL CULPADO**
**Arquivo:** `mobile-app/android/app/src/main/AndroidManifest.xml`
**Linha:** 29
```xml
android:windowSoftInputMode="adjustNothing"
```
**Status:** Já está configurado, mas pode não estar sendo aplicado corretamente
**Ação:** Pode precisar de rebuild completo

---

### **2. React Navigation - AppNavigator.js** ⚠️ **PODE ESTAR CAUSANDO**
**Arquivo:** `mobile-app/src/navigation/AppNavigator.js`
**Linhas:** 146-170
```javascript
<Stack.Screen 
  name="Map" 
  component={NewMapScreen}
  options={{
    keyboardHandlingEnabled: false  // ✅ JÁ ADICIONADO
  }}
/>
```
**Status:** Já configurado, mas pode não estar funcionando
**Ação:** Verificar se a opção está sendo aplicada

---

### **3. NewMapScreen.js - useFocusEffect** ⚠️ **PODE ESTAR CAUSANDO**
**Arquivo:** `mobile-app/src/screens/NewMapScreen.js`
**Linhas:** 230-237
```javascript
useFocusEffect(
    useCallback(() => {
        navigation.setOptions({
            keyboardHandlingEnabled: false
        });
    }, [navigation])
);
```
**Status:** Já adicionado, mas pode não estar funcionando
**Ação:** Verificar se está sendo executado

---

### **4. NewMapScreen.js - Keyboard Listeners** ⚠️ **TENTANDO CORRIGIR MAS PODE ESTAR CONFLITANDO**
**Arquivo:** `mobile-app/src/screens/NewMapScreen.js`
**Linhas:** 240-266
```javascript
useEffect(() => {
    if (Platform.OS !== 'android') return;
    
    const keyboardDidShowListener = Keyboard.addListener('keyboardDidShow', () => {
        if (containerRef.current) {
            containerRef.current.setNativeProps({
                style: { flex: 1, transform: [] }
            });
        }
    });
    
    const keyboardDidHideListener = Keyboard.addListener('keyboardDidHide', () => {
        if (containerRef.current) {
            containerRef.current.setNativeProps({
                style: { flex: 1, transform: [] }
            });
        }
    });
    
    return () => {
        keyboardDidShowListener.remove();
        keyboardDidHideListener.remove();
    };
}, []);
```
**Status:** Tentando corrigir, mas pode não estar funcionando
**Ação:** Verificar se os listeners estão sendo executados

---

### **5. NewMapScreen.js - Container com collapsable** ⚠️ **PODE ESTAR CAUSANDO**
**Arquivo:** `mobile-app/src/screens/NewMapScreen.js`
**Linhas:** 1135-1141
```javascript
<View 
    ref={containerRef}
    style={styles.container} 
    keyboardShouldPersistTaps="handled"
    collapsable={false}  // ✅ JÁ ADICIONADO
>
```
**Status:** Já adicionado
**Ação:** Verificar se está funcionando

---

### **6. PassengerUI.js - Keyboard Listeners** ⚠️ **TENTANDO CORRIGIR MAS PODE ESTAR CONFLITANDO**
**Arquivo:** `mobile-app/src/components/map/PassengerUI.js`
**Linhas:** 96-132
```javascript
useEffect(() => {
    if (Platform.OS !== 'android') return;
    
    const keyboardWillShowListener = Keyboard.addListener('keyboardDidShow', () => {
        if (carOptionsContainerRef.current) {
            carOptionsContainerRef.current.setNativeProps({
                style: { bottom: 93, transform: [] }
            });
        }
        if (bookButtonContainerRef.current) {
            bookButtonContainerRef.current.setNativeProps({
                style: { bottom: 5, transform: [] }
            });
        }
    });
    
    const keyboardWillHideListener = Keyboard.addListener('keyboardDidHide', () => {
        if (carOptionsContainerRef.current) {
            carOptionsContainerRef.current.setNativeProps({
                style: { bottom: 93, transform: [] }
            });
        }
        if (bookButtonContainerRef.current) {
            bookButtonContainerRef.current.setNativeProps({
                style: { bottom: 5, transform: [] }
            });
        }
    });
    
    return () => {
        keyboardWillShowListener.remove();
        keyboardWillHideListener.remove();
    };
}, []);
```
**Status:** Tentando corrigir, mas pode não estar funcionando
**Ação:** Verificar se os listeners estão sendo executados e se as refs estão corretas

---

### **7. PassengerUI.js - Container onLayout** ⚠️ **VAZIO, NÃO FAZ NADA**
**Arquivo:** `mobile-app/src/components/map/PassengerUI.js`
**Linhas:** 1748-1750
```javascript
onLayout={(e) => {
    // Forçar que o container não se ajuste ao teclado
}}
```
**Status:** Vazio, não faz nada
**Ação:** Pode ser removido ou implementado corretamente

---

### **8. PassengerUI.js - Styles com transform: []** ⚠️ **PODE NÃO ESTAR FUNCIONANDO**
**Arquivo:** `mobile-app/src/components/map/PassengerUI.js`
**Linhas:** 1972-1982 (carOptionsContainer)
```javascript
carOptionsContainer: { 
    position: 'absolute', 
    bottom: 93, 
    left: 0, 
    right: 0, 
    paddingHorizontal: 16, 
    zIndex: 2500,
    elevation: Platform.OS === 'android' ? 5 : 0,
    transform: [] // Array vazio previne transformações automáticas
},
```
**Status:** Já adicionado, mas pode não estar funcionando
**Ação:** Verificar se está sendo aplicado

**Linhas:** 2048-2054 (bookButtonContainer)
```javascript
bookButtonContainer: { 
    position: 'absolute', 
    bottom: 5, 
    left: 0, 
    right: 0, 
    paddingHorizontal: 20, 
    zIndex: 3000,
    elevation: Platform.OS === 'android' ? 5 : 0,
    transform: [] // Array vazio previne transformações automáticas
},
```
**Status:** Já adicionado, mas pode não estar funcionando
**Ação:** Verificar se está sendo aplicado

---

### **9. NewMapScreen.js - Container Style** ⚠️ **PODE ESTAR CAUSANDO**
**Arquivo:** `mobile-app/src/screens/NewMapScreen.js`
**Linhas:** 1356-1360
```javascript
container: {
    flex: 1,
    // ✅ Prevenir ajuste quando teclado abre
    // O container não deve se mover quando o teclado aparece
},
```
**Status:** Apenas comentário, não faz nada
**Ação:** Pode precisar de propriedades adicionais

---

### **10. PassengerUI.js - Container Style** ⚠️ **PODE ESTAR CAUSANDO**
**Arquivo:** `mobile-app/src/components/map/PassengerUI.js`
**Linhas:** 1853-1856
```javascript
container: { 
    flex: 1,
    // ✅ Container não ajusta quando teclado abre (teclado sobrepõe)
},
```
**Status:** Apenas comentário, não faz nada
**Ação:** Pode precisar de propriedades adicionais

---

## 🎯 POSSÍVEIS CAUSAS DO PROBLEMA

### **Causa 1: AndroidManifest não está sendo aplicado**
- Mudanças no AndroidManifest requerem **rebuild completo**
- Hot reload não aplica essas mudanças
- **Solução:** Fazer rebuild completo do app

### **Causa 2: React Navigation está sobrescrevendo**
- `keyboardHandlingEnabled: false` pode não estar funcionando
- React Navigation pode ter comportamento padrão que sobrescreve
- **Solução:** Verificar se a opção está sendo aplicada corretamente

### **Causa 3: setNativeProps não está funcionando**
- Os listeners podem estar sendo executados, mas `setNativeProps` pode não estar funcionando
- Pode haver um delay entre o teclado abrir e o listener executar
- **Solução:** Usar `Animated` ou outra abordagem

### **Causa 4: Elementos absolutos estão sendo afetados pelo container pai**
- Se o container pai se move, os elementos absolutos se movem junto
- `position: absolute` é relativo ao container pai
- **Solução:** Garantir que o container pai não se mova

### **Causa 5: Android está aplicando ajuste antes dos listeners**
- O Android pode estar ajustando a view antes dos listeners serem executados
- `adjustNothing` pode não estar sendo respeitado
- **Solução:** Usar uma abordagem diferente

---

## 🔧 SOLUÇÕES POSSÍVEIS

### **Solução 1: Rebuild Completo**
```bash
cd mobile-app
cd android
./gradlew clean
cd ..
npx react-native run-android
```

### **Solução 2: Usar Animated API**
Em vez de `setNativeProps`, usar `Animated` para forçar posições fixas

### **Solução 3: Usar View nativo do Android**
Criar um componente nativo que não se ajusta ao teclado

### **Solução 4: Verificar se há outros listeners**
Pode haver outros listeners de teclado em componentes pais que estão interferindo

---

**Data:** 2025-01-06
**Status:** Lista completa de todas as funções encontradas



