# 🚗 PROPOSTA: TOGGLE PASSAGEIRO/MOTORISTA - LEAF APP

## 📅 Data: 29 de Julho de 2025
## 🎯 Status: 📋 **PROPOSTA PARA IMPLEMENTAÇÃO**

---

## 🎯 **CONCEITO DO TOGGLE DUAL ROLE**

### **📱 ESTRUTURA PROPOSTA:**
```bash
📱 Leaf App (React Native)
├── 🔐 Login/Registro (único)
├── 🏠 Home (Mapa) - Modo dinâmico
├── 👤 Perfil
│   ├── Dados pessoais
│   ├── Configurações
│   └── 🎯 TOGGLE DUAL ROLE (NOVO)
│       ├── Modo Passageiro
│       └── Modo Motorista
├── 🚗 Modo Passageiro (ativo)
│   ├── Solicitar corrida
│   ├── Escolher destino
│   ├── Ver preço
│   ├── Pagar
│   └── Avaliar
├── 🚗 Modo Motorista (ativo)
│   ├── Aceitar corridas
│   ├── Navegar
│   ├── Iniciar/finalizar
│   ├── Receber pagamento
│   └── Ver histórico
├── 📋 Histórico (unificado)
├── 💰 Carteira/Pagamentos (unificado)
└── ⚙️ Configurações (unificado)
```

---

## 🔧 **IMPLEMENTAÇÃO TÉCNICA**

### **1. COMPONENTE TOGGLE (NOVO)**
```javascript
// mobile-app/src/components/DualRoleToggle.js
import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Animated } from 'react-native';

const DualRoleToggle = ({ currentMode, onModeChange }) => {
  const [isAnimating, setIsAnimating] = useState(false);
  const slideAnim = useRef(new Animated.Value(currentMode === 'driver' ? 1 : 0)).current;

  const handleModeChange = (newMode) => {
    if (newMode === currentMode) return;
    
    setIsAnimating(true);
    
    // Animação do toggle
    Animated.spring(slideAnim, {
      toValue: newMode === 'driver' ? 1 : 0,
      tension: 100,
      friction: 8,
      useNativeDriver: true,
    }).start(() => {
      setIsAnimating(false);
      onModeChange(newMode);
    });
  };

  return (
    <View style={styles.container}>
      <View style={styles.toggleContainer}>
        <Animated.View 
          style={[
            styles.slider,
            {
              transform: [{
                translateX: slideAnim.interpolate({
                  inputRange: [0, 1],
                  outputRange: [0, 50]
                })
              }]
            }
          ]} 
        />
        
        <TouchableOpacity
          style={[styles.option, currentMode === 'passenger' && styles.activeOption]}
          onPress={() => handleModeChange('passenger')}
          disabled={isAnimating}
        >
          <Text style={[styles.optionText, currentMode === 'passenger' && styles.activeText]}>
            👤 Passageiro
          </Text>
        </TouchableOpacity>
        
        <TouchableOpacity
          style={[styles.option, currentMode === 'driver' && styles.activeOption]}
          onPress={() => handleModeChange('driver')}
          disabled={isAnimating}
        >
          <Text style={[styles.optionText, currentMode === 'driver' && styles.activeText]}>
            🚗 Motorista
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    padding: 20,
    backgroundColor: '#fff',
    borderRadius: 12,
    margin: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  toggleContainer: {
    flexDirection: 'row',
    backgroundColor: '#f5f5f5',
    borderRadius: 25,
    padding: 4,
    position: 'relative',
  },
  slider: {
    position: 'absolute',
    width: '50%',
    height: '100%',
    backgroundColor: '#1A330E',
    borderRadius: 25,
    zIndex: 1,
  },
  option: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 16,
    zIndex: 2,
  },
  activeOption: {
    // Estilo para opção ativa
  },
  optionText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#666',
  },
  activeText: {
    color: '#fff',
  },
});

export default DualRoleToggle;
```

### **2. CONTEXT PARA GERENCIAR MODO**
```javascript
// mobile-app/src/contexts/DualRoleContext.js
import React, { createContext, useContext, useState, useEffect } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

const DualRoleContext = createContext();

export const DualRoleProvider = ({ children }) => {
  const [currentMode, setCurrentMode] = useState('passenger');
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    loadSavedMode();
  }, []);

  const loadSavedMode = async () => {
    try {
      const savedMode = await AsyncStorage.getItem('@leaf_current_mode');
      if (savedMode) {
        setCurrentMode(savedMode);
      }
    } catch (error) {
      console.error('Erro ao carregar modo:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const changeMode = async (newMode) => {
    try {
      setCurrentMode(newMode);
      await AsyncStorage.setItem('@leaf_current_mode', newMode);
      
      // Notificar backend sobre mudança de modo
      await notifyBackendModeChange(newMode);
      
    } catch (error) {
      console.error('Erro ao mudar modo:', error);
    }
  };

  const notifyBackendModeChange = async (mode) => {
    try {
      // Notificar backend sobre mudança de modo
      // Isso pode afetar notificações, status online, etc.
      await api.post('/api/user/mode-change', { mode });
    } catch (error) {
      console.error('Erro ao notificar backend:', error);
    }
  };

  return (
    <DualRoleContext.Provider value={{
      currentMode,
      changeMode,
      isLoading,
      isPassenger: currentMode === 'passenger',
      isDriver: currentMode === 'driver',
    }}>
      {children}
    </DualRoleContext.Provider>
  );
};

export const useDualRole = () => {
  const context = useContext(DualRoleContext);
  if (!context) {
    throw new Error('useDualRole deve ser usado dentro de DualRoleProvider');
  }
  return context;
};
```

### **3. INTEGRAÇÃO NO MAPSCREEN**
```javascript
// mobile-app/src/screens/MapScreen.js (MODIFICAÇÃO)
import { useDualRole } from '../contexts/DualRoleContext';
import DualRoleToggle from '../components/DualRoleToggle';

export default function MapScreen(props) {
  const { currentMode, isPassenger, isDriver } = useDualRole();
  
  // ... código existente ...

  // Renderizar interface baseada no modo
  const renderPassengerInterface = () => (
    <View style={styles.passengerInterface}>
      {/* Interface do passageiro */}
      <TouchableOpacity onPress={handleRequestRide}>
        <Text>Solicitar Corrida</Text>
      </TouchableOpacity>
    </View>
  );

  const renderDriverInterface = () => (
    <View style={styles.driverInterface}>
      {/* Interface do motorista */}
      <TouchableOpacity onPress={handleGoOnline}>
        <Text>Ficar Online</Text>
      </TouchableOpacity>
    </View>
  );

  return (
    <View style={styles.container}>
      {/* Mapa */}
      <MapView style={styles.map} />
      
      {/* Toggle Dual Role */}
      <DualRoleToggle 
        currentMode={currentMode}
        onModeChange={changeMode}
      />
      
      {/* Interface dinâmica */}
      {isPassenger && renderPassengerInterface()}
      {isDriver && renderDriverInterface()}
    </View>
  );
}
```

### **4. MODIFICAÇÕES NO PERFIL**
```javascript
// mobile-app/src/screens/ProfileScreen.js (MODIFICAÇÃO)
import { useDualRole } from '../contexts/DualRoleContext';
import DualRoleToggle from '../components/DualRoleToggle';

export default function ProfileScreen({ navigation }) {
  const { currentMode, changeMode } = useDualRole();
  
  // ... código existente ...

  const menuItems = [
    // ... itens existentes ...
    {
      id: 'dual-role',
      title: 'Alternar Modo',
      icon: 'swap-horiz',
      customComponent: (
        <View style={styles.dualRoleSection}>
          <Text style={styles.sectionTitle}>Modo Atual</Text>
          <DualRoleToggle 
            currentMode={currentMode}
            onModeChange={changeMode}
          />
        </View>
      )
    },
    // ... outros itens ...
  ];

  // Filtrar menu conforme modo atual
  const filteredMenuItems = menuItems.filter(item => {
    if (item.navigationName === 'MyEarning' && currentMode === 'passenger') {
      return false; // Ocultar "Ganhos" para passageiros
    }
    if (item.navigationName === 'Cars' && currentMode === 'passenger') {
      return false; // Ocultar "Veículos" para passageiros
    }
    return true;
  });

  return (
    <View style={styles.container}>
      {/* ... resto do código ... */}
    </View>
  );
}
```

---

## 🔄 **FLUXO DE USUÁRIO**

### **📱 EXPERIÊNCIA DO USUÁRIO:**
```bash
1. Usuário faz login (único)
2. App carrega no último modo usado
3. Toggle visível no topo da tela
4. Usuário pode alternar a qualquer momento
5. Interface muda dinamicamente
6. Dados unificados (perfil, histórico, etc.)
```

### **🎯 VANTAGENS:**
```bash
✅ Interface familiar para ambos os modos
✅ Alternância instantânea
✅ Dados unificados
✅ Menos complexidade
✅ Experiência única
✅ Economia de desenvolvimento
```

---

## 🚀 **PRÓXIMOS PASSOS**

### **📋 IMPLEMENTAÇÃO:**
```bash
[ ] Criar DualRoleToggle component
[ ] Implementar DualRoleContext
[ ] Integrar no MapScreen
[ ] Modificar ProfileScreen
[ ] Testar alternância de modos
[ ] Validar dados unificados
```

### **🧪 TESTES:**
```bash
[ ] Teste de alternância rápida
[ ] Teste de persistência do modo
[ ] Teste de interface dinâmica
[ ] Teste de dados unificados
[ ] Teste de performance
```

---

## 💰 **IMPACTO NO NEGÓCIO**

### **✅ BENEFÍCIOS:**
```bash
✅ Usuário pode ser passageiro E motorista
✅ Maior engajamento (duas funcionalidades)
✅ Menor custo de desenvolvimento
✅ Interface familiar
✅ Dados unificados
✅ Experiência única no mercado
```

**Esta proposta mantém a simplicidade do app único, mas adiciona a flexibilidade do toggle dual role!** 🚀 