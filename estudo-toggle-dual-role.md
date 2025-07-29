# 🎯 ESTUDO DETALHADO: TOGGLE PASSAGEIRO/MOTORISTA - LEAF APP

## 📅 Data: 29 de Julho de 2025
## 🎯 Status: 📋 **ESTUDO DE VIABILIDADE**

---

## 🎯 **OBJETIVO**

Implementar toggle discreto (estilo Nubank) para alternar entre modo passageiro e motorista no mesmo app, mantendo dados unificados mas com funcionalidades específicas por modo.

---

## 🔄 **ABORDAGENS POSSÍVEIS**

### **1. 🎭 ABORDAGEM A: PERFIL ÚNICO COM MODO DINÂMICO**

#### **📊 Estrutura de Dados:**
```javascript
// Firebase/Redis - Estrutura Única
{
  "users": {
    "user_123": {
      // Dados Básicos (compartilhados)
      "uid": "user_123",
      "phone": "+5511999999999",
      "email": "user@leaf.com",
      "name": "João Silva",
      "createdAt": "2025-07-29T10:00:00Z",
      
      // Modo Atual
      "currentMode": "passenger", // "passenger" | "driver"
      
      // Permissões
      "permissions": {
        "canBeDriver": true,
        "canBePassenger": true,
        "driverVerified": true,
        "driverApproved": true
      },
      
      // Dados de Passageiro
      "passengerData": {
        "preferences": {
          "paymentMethod": "pix",
          "favoriteRoutes": [],
          "rating": 4.8
        },
        "tripHistory": [],
        "savedAddresses": []
      },
      
      // Dados de Motorista
      "driverData": {
        "vehicle": {
          "model": "Toyota Corolla",
          "plate": "ABC-1234",
          "year": 2020,
          "color": "Prata"
        },
        "documents": {
          "cnh": "12345678901",
          "crlv": "987654321",
          "verified": true
        },
        "status": "online", // "online" | "offline" | "busy"
        "currentLocation": {
          "lat": -23.5505,
          "lng": -46.6333,
          "timestamp": "2025-07-29T10:00:00Z"
        },
        "earnings": {
          "total": 1500.00,
          "thisMonth": 450.00,
          "thisWeek": 120.00
        },
        "rating": 4.9,
        "tripsCompleted": 156
      },
      
      // Dados Compartilhados
      "sharedData": {
        "wallet": {
          "balance": 250.00,
          "transactions": []
        },
        "notifications": [],
        "settings": {
          "language": "pt-BR",
          "notifications": true,
          "location": true
        }
      }
    }
  }
}
```

#### **✅ Vantagens:**
```bash
✅ Dados unificados - fácil manutenção
✅ Troca de modo instantânea
✅ Histórico compartilhado
✅ Wallet unificado
✅ Menos complexidade no banco
✅ Performance melhor
✅ Menos queries
```

#### **❌ Desvantagens:**
```bash
❌ Estrutura de dados complexa
❌ Lógica de validação mais complexa
❌ Difícil de escalar
❌ Mistura de responsabilidades
❌ Queries mais complexas
```

#### **🔧 Implementação:**
```javascript
// Redux State
const userState = {
  currentMode: 'passenger',
  profile: {
    // Dados básicos + modo atual
  },
  passengerData: { /* dados específicos */ },
  driverData: { /* dados específicos */ },
  sharedData: { /* dados compartilhados */ }
};

// Componente de Toggle
const ProfileToggle = ({ currentMode, onModeChange }) => {
  return (
    <TouchableOpacity onPress={() => onModeChange(currentMode === 'passenger' ? 'driver' : 'passenger')}>
      <View style={styles.toggleContainer}>
        <Icon name={currentMode === 'passenger' ? 'person' : 'directions-car'} />
        <Text>{currentMode === 'passenger' ? 'Passageiro' : 'Motorista'}</Text>
      </View>
    </TouchableOpacity>
  );
};
```

---

### **2. 🔑 ABORDAGEM B: CHAVES SEPARADAS POR PERFIL**

#### **📊 Estrutura de Dados:**
```javascript
// Firebase/Redis - Estrutura Separada
{
  "users": {
    "user_123": {
      // Dados Básicos (compartilhados)
      "uid": "user_123",
      "phone": "+5511999999999",
      "email": "user@leaf.com",
      "name": "João Silva",
      "createdAt": "2025-07-29T10:00:00Z",
      
      // Referências para perfis
      "profiles": {
        "passenger": "passenger_user_123",
        "driver": "driver_user_123"
      },
      
      // Dados Compartilhados
      "wallet": {
        "balance": 250.00,
        "transactions": []
      },
      "notifications": [],
      "settings": {
        "language": "pt-BR",
        "notifications": true,
        "location": true
      }
    }
  },
  
  "passengers": {
    "passenger_user_123": {
      "userId": "user_123",
      "preferences": {
        "paymentMethod": "pix",
        "favoriteRoutes": [],
        "rating": 4.8
      },
      "tripHistory": [],
      "savedAddresses": []
    }
  },
  
  "drivers": {
    "driver_user_123": {
      "userId": "user_123",
      "vehicle": {
        "model": "Toyota Corolla",
        "plate": "ABC-1234",
        "year": 2020,
        "color": "Prata"
      },
      "documents": {
        "cnh": "12345678901",
        "crlv": "987654321",
        "verified": true
      },
      "status": "online",
      "currentLocation": {
        "lat": -23.5505,
        "lng": -46.6333,
        "timestamp": "2025-07-29T10:00:00Z"
      },
      "earnings": {
        "total": 1500.00,
        "thisMonth": 450.00,
        "thisWeek": 120.00
      },
      "rating": 4.9,
      "tripsCompleted": 156
    }
  }
}
```

#### **✅ Vantagens:**
```bash
✅ Separação clara de responsabilidades
✅ Fácil de escalar
✅ Queries mais simples
✅ Validação mais clara
✅ Performance otimizada por perfil
✅ Facilita manutenção
```

#### **❌ Desvantagens:**
```bash
❌ Mais complexidade no banco
❌ Mais queries necessárias
❌ Sincronização de dados
❌ Duplicação de alguns dados
❌ Lógica de toggle mais complexa
```

#### **🔧 Implementação:**
```javascript
// Redux State
const userState = {
  currentMode: 'passenger',
  baseProfile: { /* dados básicos */ },
  passengerProfile: null,
  driverProfile: null,
  sharedData: { /* wallet, notifications, settings */ }
};

// Serviço de Toggle
class ProfileToggleService {
  async switchMode(userId, newMode) {
    const user = await this.getUser(userId);
    const profileKey = user.profiles[newMode];
    
    if (newMode === 'passenger') {
      const passengerData = await this.getPassengerProfile(profileKey);
      return { ...user, currentMode: newMode, passengerProfile: passengerData };
    } else {
      const driverData = await this.getDriverProfile(profileKey);
      return { ...user, currentMode: newMode, driverProfile: driverData };
    }
  }
}
```

---

### **3. 🎯 ABORDAGEM C: HÍBRIDA (RECOMENDADA)**

#### **📊 Estrutura de Dados:**
```javascript
// Firebase/Redis - Estrutura Híbrida
{
  "users": {
    "user_123": {
      // Dados Básicos (sempre carregados)
      "uid": "user_123",
      "phone": "+5511999999999",
      "email": "user@leaf.com",
      "name": "João Silva",
      "createdAt": "2025-07-29T10:00:00Z",
      
      // Modo Atual
      "currentMode": "passenger",
      
      // Permissões
      "permissions": {
        "canBeDriver": true,
        "canBePassenger": true,
        "driverVerified": true,
        "driverApproved": true
      },
      
      // Dados Compartilhados (sempre carregados)
      "wallet": {
        "balance": 250.00,
        "transactions": []
      },
      "notifications": [],
      "settings": {
        "language": "pt-BR",
        "notifications": true,
        "location": true
      },
      
      // Referências para dados específicos (carregados on-demand)
      "profiles": {
        "passenger": "passenger_user_123",
        "driver": "driver_user_123"
      }
    }
  },
  
  "passenger_profiles": {
    "passenger_user_123": {
      "userId": "user_123",
      "preferences": {
        "paymentMethod": "pix",
        "favoriteRoutes": [],
        "rating": 4.8
      },
      "tripHistory": [],
      "savedAddresses": []
    }
  },
  
  "driver_profiles": {
    "driver_user_123": {
      "userId": "user_123",
      "vehicle": {
        "model": "Toyota Corolla",
        "plate": "ABC-1234",
        "year": 2020,
        "color": "Prata"
      },
      "documents": {
        "cnh": "12345678901",
        "crlv": "987654321",
        "verified": true
      },
      "status": "online",
      "currentLocation": {
        "lat": -23.5505,
        "lng": -46.6333,
        "timestamp": "2025-07-29T10:00:00Z"
      },
      "earnings": {
        "total": 1500.00,
        "thisMonth": 450.00,
        "thisWeek": 120.00
      },
      "rating": 4.9,
      "tripsCompleted": 156
    }
  }
}
```

#### **✅ Vantagens:**
```bash
✅ Melhor performance (carregamento on-demand)
✅ Separação clara de responsabilidades
✅ Dados compartilhados sempre disponíveis
✅ Fácil de escalar
✅ Lógica de toggle simples
✅ Cache otimizado
```

#### **❌ Desvantagens:**
```bash
❌ Implementação mais complexa
❌ Mais arquivos para gerenciar
❌ Lógica de cache mais complexa
```

#### **🔧 Implementação:**
```javascript
// Redux State
const userState = {
  currentMode: 'passenger',
  baseProfile: { /* sempre carregado */ },
  currentProfile: null, // carregado on-demand
  sharedData: { /* sempre carregado */ }
};

// Serviço de Toggle
class ProfileToggleService {
  async switchMode(userId, newMode) {
    // 1. Atualizar modo no usuário base
    await this.updateUserMode(userId, newMode);
    
    // 2. Carregar dados específicos do modo
    const profileData = await this.loadProfileData(userId, newMode);
    
    // 3. Atualizar Redux
    return {
      currentMode: newMode,
      currentProfile: profileData
    };
  }
  
  async loadProfileData(userId, mode) {
    const cacheKey = `${userId}_${mode}`;
    
    // Verificar cache primeiro
    const cached = await this.getFromCache(cacheKey);
    if (cached) return cached;
    
    // Carregar do banco
    const data = await this.fetchProfileData(userId, mode);
    
    // Salvar no cache
    await this.saveToCache(cacheKey, data);
    
    return data;
  }
}
```

---

## 🎯 **RECOMENDAÇÃO: ABORDAGEM C (HÍBRIDA)**

### **📊 Justificativa:**
```bash
✅ Performance otimizada
✅ Separação clara de responsabilidades
✅ Fácil de escalar
✅ Cache inteligente
✅ Dados compartilhados sempre disponíveis
✅ Lógica de toggle simples
```

### **🔧 Implementação Recomendada:**

#### **1. Estrutura de Dados:**
- **Dados Básicos:** Sempre carregados (nome, telefone, email, permissões)
- **Dados Compartilhados:** Sempre carregados (wallet, notificações, configurações)
- **Dados Específicos:** Carregados on-demand (dados de passageiro/motorista)

#### **2. Cache Strategy:**
```javascript
// Cache por perfil
const cacheStrategy = {
  'passenger': { ttl: 5 * 60 * 1000 }, // 5 minutos
  'driver': { ttl: 2 * 60 * 1000 },    // 2 minutos (mais dinâmico)
  'shared': { ttl: 10 * 60 * 1000 }    // 10 minutos
};
```

#### **3. Toggle UI (Estilo Nubank):**
```javascript
// Componente discreto no perfil
const ProfileToggle = ({ currentMode, onModeChange }) => {
  return (
    <TouchableOpacity 
      style={styles.profileToggle}
      onPress={() => onModeChange(currentMode === 'passenger' ? 'driver' : 'passenger')}
    >
      <View style={styles.toggleContainer}>
        <Icon 
          name={currentMode === 'passenger' ? 'person' : 'directions-car'} 
          size={20} 
          color={colors.PRIMARY} 
        />
        <Text style={styles.toggleText}>
          {currentMode === 'passenger' ? 'Passageiro' : 'Motorista'}
        </Text>
      </View>
    </TouchableOpacity>
  );
};
```

---

## 🚀 **PLANO DE IMPLEMENTAÇÃO**

### **FASE 1: Estrutura Base (1-2 dias)**
```bash
[ ] Criar estrutura de dados híbrida
[ ] Implementar serviços de toggle
[ ] Configurar cache strategy
[ ] Criar componentes base
```

### **FASE 2: UI/UX (2-3 dias)**
```bash
[ ] Implementar toggle discreto (estilo Nubank)
[ ] Criar interfaces específicas por modo
[ ] Implementar transições suaves
[ ] Testar em diferentes dispositivos
```

### **FASE 3: Integração (1-2 dias)**
```bash
[ ] Integrar com sistema de corridas
[ ] Integrar com sistema de pagamentos
[ ] Integrar com notificações
[ ] Testes de integração
```

### **FASE 4: Otimização (1 dia)**
```bash
[ ] Otimizar performance
[ ] Implementar cache avançado
[ ] Testes de carga
[ ] Documentação
```

---

## 📊 **MÉTRICAS DE SUCESSO**

### **Performance:**
- ✅ Toggle response time < 200ms
- ✅ Profile load time < 500ms
- ✅ Cache hit rate > 80%

### **UX:**
- ✅ Transição suave entre modos
- ✅ Interface intuitiva
- ✅ Feedback visual claro

### **Técnico:**
- ✅ Dados consistentes
- ✅ Cache eficiente
- ✅ Escalabilidade mantida

---

## 🎯 **CONCLUSÃO**

### **✅ ABORDAGEM RECOMENDADA: HÍBRIDA**
- **Performance otimizada** com carregamento on-demand
- **Separação clara** de responsabilidades
- **Fácil de escalar** e manter
- **UX excelente** com toggle discreto

### **🚀 PRÓXIMO PASSO:**
Implementar Fase 1 - Estrutura Base 