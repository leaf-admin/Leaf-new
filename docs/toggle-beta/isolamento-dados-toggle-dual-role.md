# 🎯 ISOLAMENTO DE DADOS - TOGGLE DUAL-ROLE

## 📅 Data: 29 de Julho de 2025
## 🎯 Status: 📋 **ESTRATÉGIA DE ISOLAMENTO**

---

## 🎯 **PRINCÍPIO FUNDAMENTAL**

### **📊 Estrutura de Dados Isolada:**
```javascript
// Cada modo tem seus próprios dados isolados
{
  "users": {
    "user_123": {
      // DADOS COMPARTILHADOS (sempre visíveis)
      "uid": "user_123",
      "phone": "+5511999999999",
      "email": "user@leaf.com",
      "name": "João Silva",
      "currentMode": "passenger",
      
      // DADOS ISOLADOS POR MODO
      "passenger_data": { /* dados específicos de passageiro */ },
      "driver_data": { /* dados específicos de motorista */ },
      
      // DADOS COMPARTILHADOS
      "shared_data": { /* wallet, configurações, etc */ }
    }
  }
}
```

---

## 📊 **ESTRATÉGIA DE ISOLAMENTO POR CATEGORIA**

### **1. 🚗 HISTÓRICO DE CORRIDAS**

#### **📋 Estrutura Isolada:**
```javascript
// Passageiro - Histórico de corridas como cliente
"passenger_data": {
  "tripHistory": [
    {
      "tripId": "trip_001",
      "date": "2025-07-29T10:00:00Z",
      "driverName": "Maria Silva",
      "driverRating": 4.8,
      "startLocation": "Rua das Flores, 123",
      "endLocation": "Av. Paulista, 1000",
      "price": 25.50,
      "status": "completed",
      "paymentMethod": "pix",
      "driverPhoto": "url_photo",
      "vehicleInfo": {
        "model": "Toyota Corolla",
        "plate": "ABC-1234",
        "color": "Prata"
      }
    }
  ]
}

// Motorista - Histórico de corridas como prestador
"driver_data": {
  "tripHistory": [
    {
      "tripId": "trip_002",
      "date": "2025-07-29T11:00:00Z",
      "passengerName": "Carlos Santos",
      "passengerRating": 4.9,
      "startLocation": "Rua Augusta, 500",
      "endLocation": "Shopping Cidade",
      "earnings": 28.00,
      "status": "completed",
      "paymentReceived": true,
      "passengerPhoto": "url_photo",
      "commission": 2.50,
      "netEarnings": 25.50
    }
  ]
}
```

#### **🎯 Isolamento:**
- **Passageiro:** Vê apenas corridas onde foi cliente
- **Motorista:** Vê apenas corridas onde foi prestador
- **Dados diferentes:** Informações específicas de cada papel
- **Sem mistura:** Históricos completamente separados

---

### **2. 💬 MENSAGENS E CHAT**

#### **📋 Estrutura Isolada:**
```javascript
// Passageiro - Conversas como cliente
"passenger_data": {
  "conversations": [
    {
      "conversationId": "conv_001",
      "driverId": "driver_456",
      "driverName": "Maria Silva",
      "lastMessage": "Chegando em 2 minutos",
      "timestamp": "2025-07-29T10:30:00Z",
      "unreadCount": 0,
      "tripId": "trip_001",
      "messages": [
        {
          "messageId": "msg_001",
          "sender": "driver",
          "content": "Olá! Estou a caminho",
          "timestamp": "2025-07-29T10:25:00Z",
          "read": true
        }
      ]
    }
  ]
}

// Motorista - Conversas como prestador
"driver_data": {
  "conversations": [
    {
      "conversationId": "conv_002",
      "passengerId": "passenger_789",
      "passengerName": "Carlos Santos",
      "lastMessage": "Obrigado pela corrida!",
      "timestamp": "2025-07-29T11:30:00Z",
      "unreadCount": 1,
      "tripId": "trip_002",
      "messages": [
        {
          "messageId": "msg_002",
          "sender": "passenger",
          "content": "Obrigado pela corrida!",
          "timestamp": "2025-07-29T11:30:00Z",
          "read": false
        }
      ]
    }
  ]
}
```

#### **🎯 Isolamento:**
- **Passageiro:** Vê apenas conversas com motoristas
- **Motorista:** Vê apenas conversas com passageiros
- **Contexto específico:** Mensagens relacionadas ao papel atual
- **Sem confusão:** Conversas completamente separadas

---

### **3. ⭐ AVALIAÇÕES E RATINGS**

#### **📋 Estrutura Isolada:**
```javascript
// Passageiro - Avaliações que deu para motoristas
"passenger_data": {
  "ratingsGiven": [
    {
      "ratingId": "rating_001",
      "driverId": "driver_456",
      "driverName": "Maria Silva",
      "rating": 5,
      "comment": "Excelente motorista, muito pontual",
      "tripId": "trip_001",
      "date": "2025-07-29T10:35:00Z"
    }
  ],
  "averageRatingGiven": 4.8
}

// Motorista - Avaliações que deu para passageiros
"driver_data": {
  "ratingsGiven": [
    {
      "ratingId": "rating_002",
      "passengerId": "passenger_789",
      "passengerName": "Carlos Santos",
      "rating": 5,
      "comment": "Passageiro muito educado",
      "tripId": "trip_002",
      "date": "2025-07-29T11:35:00Z"
    }
  ],
  "averageRatingGiven": 4.9
}
```

#### **🎯 Isolamento:**
- **Passageiro:** Vê apenas avaliações que deu para motoristas
- **Motorista:** Vê apenas avaliações que deu para passageiros
- **Histórico separado:** Avaliações por papel específico
- **Sem mistura:** Ratings completamente isolados

---

### **4. 📍 ENDEREÇOS SALVOS**

#### **📋 Estrutura Isolada:**
```javascript
// Passageiro - Endereços como cliente
"passenger_data": {
  "savedAddresses": [
    {
      "addressId": "addr_001",
      "name": "Casa",
      "address": "Rua das Flores, 123",
      "lat": -23.5505,
      "lng": -46.6333,
      "type": "home",
      "favorite": true
    },
    {
      "addressId": "addr_002",
      "name": "Trabalho",
      "address": "Av. Paulista, 1000",
      "lat": -23.5630,
      "lng": -46.6544,
      "type": "work",
      "favorite": false
    }
  ]
}

// Motorista - Endereços como prestador
"driver_data": {
  "savedAddresses": [
    {
      "addressId": "addr_003",
      "name": "Posto de Gasolina",
      "address": "Av. Brigadeiro Faria Lima, 500",
      "lat": -23.5670,
      "lng": -46.6580,
      "type": "gas_station",
      "favorite": true
    },
    {
      "addressId": "addr_004",
      "name": "Lavagem",
      "address": "Rua Oscar Freire, 200",
      "lat": -23.5600,
      "lng": -46.6500,
      "type": "car_wash",
      "favorite": false
    }
  ]
}
```

#### **🎯 Isolamento:**
- **Passageiro:** Endereços pessoais (casa, trabalho, etc.)
- **Motorista:** Endereços profissionais (posto, lavagem, etc.)
- **Contexto específico:** Endereços relevantes para cada papel
- **Sem confusão:** Listas completamente separadas

---

### **5. 💰 GANHOS E PAGAMENTOS**

#### **📋 Estrutura Isolada:**
```javascript
// Passageiro - Gastos como cliente
"passenger_data": {
  "paymentHistory": [
    {
      "paymentId": "pay_001",
      "tripId": "trip_001",
      "amount": 25.50,
      "method": "pix",
      "status": "completed",
      "date": "2025-07-29T10:00:00Z",
      "driverName": "Maria Silva"
    }
  ],
  "totalSpent": 150.75,
  "monthlySpent": 45.20
}

// Motorista - Ganhos como prestador
"driver_data": {
  "earningsHistory": [
    {
      "earningId": "earn_001",
      "tripId": "trip_002",
      "grossAmount": 28.00,
      "commission": 2.50,
      "netAmount": 25.50,
      "status": "received",
      "date": "2025-07-29T11:00:00Z",
      "passengerName": "Carlos Santos"
    }
  ],
  "totalEarnings": 1250.50,
  "monthlyEarnings": 450.75,
  "weeklyEarnings": 120.25
}
```

#### **🎯 Isolamento:**
- **Passageiro:** Vê apenas gastos como cliente
- **Motorista:** Vê apenas ganhos como prestador
- **Métricas específicas:** Dados financeiros por papel
- **Sem mistura:** Históricos financeiros separados

---

### **6. 🔔 NOTIFICAÇÕES**

#### **📋 Estrutura Isolada:**
```javascript
// Passageiro - Notificações como cliente
"passenger_data": {
  "notifications": [
    {
      "notificationId": "notif_001",
      "type": "trip_accepted",
      "title": "Corrida Aceita",
      "message": "Maria Silva aceitou sua corrida",
      "tripId": "trip_001",
      "timestamp": "2025-07-29T10:00:00Z",
      "read": true
    }
  ]
}

// Motorista - Notificações como prestador
"driver_data": {
  "notifications": [
    {
      "notificationId": "notif_002",
      "type": "new_ride_request",
      "title": "Nova Solicitação",
      "message": "Carlos Santos solicitou uma corrida",
      "tripId": "trip_002",
      "timestamp": "2025-07-29T11:00:00Z",
      "read": false
    }
  ]
}
```

#### **🎯 Isolamento:**
- **Passageiro:** Notificações relacionadas a corridas como cliente
- **Motorista:** Notificações relacionadas a corridas como prestador
- **Contexto específico:** Alertas relevantes para cada papel
- **Sem confusão:** Notificações completamente separadas

---

## 🎯 **IMPLEMENTAÇÃO TÉCNICA**

### **1. 🔄 Toggle Service:**
```javascript
class ProfileToggleService {
  async switchMode(userId) {
    // 1. Salvar estado atual
    await this.saveCurrentState(userId);
    
    // 2. Carregar dados do novo modo
    const newModeData = await this.loadModeData(userId, newMode);
    
    // 3. Limpar cache do modo anterior
    await this.clearModeCache(currentMode);
    
    // 4. Atualizar interface
    this.updateUI(newModeData);
  }
}
```

### **2. 📊 Redux State:**
```javascript
const profileToggleState = {
  currentMode: 'passenger',
  passengerData: {
    tripHistory: [],
    conversations: [],
    ratingsGiven: [],
    savedAddresses: [],
    paymentHistory: [],
    notifications: []
  },
  driverData: {
    tripHistory: [],
    conversations: [],
    ratingsGiven: [],
    savedAddresses: [],
    earningsHistory: [],
    notifications: []
  },
  sharedData: {
    wallet: {},
    settings: {},
    profile: {}
  }
};
```

### **3. 🌐 Backend API:**
```javascript
// Rotas específicas por modo
GET /user/passenger/history     // Histórico de passageiro
GET /user/driver/history        // Histórico de motorista
GET /user/passenger/messages    // Mensagens de passageiro
GET /user/driver/messages       // Mensagens de motorista
GET /user/passenger/ratings     // Avaliações de passageiro
GET /user/driver/ratings        // Avaliações de motorista
```

---

## 🎯 **BENEFÍCIOS DO ISOLAMENTO**

### **✅ Experiência Limpa:**
- Interface específica para cada papel
- Dados relevantes apenas
- Sem confusão entre modos

### **✅ Performance Otimizada:**
- Carregamento apenas dos dados necessários
- Cache específico por modo
- Menos dados em memória

### **✅ Segurança:**
- Dados sensíveis isolados
- Controle de acesso por papel
- Privacidade mantida

### **✅ Manutenibilidade:**
- Código organizado por contexto
- Fácil de debugar
- Escalabilidade garantida

---

## 🎯 **CONCLUSÃO**

### **✅ ISOLAMENTO COMPLETO:**
- **Histórico:** Separado por papel (cliente vs prestador)
- **Mensagens:** Conversas específicas por contexto
- **Avaliações:** Ratings dados e recebidos isolados
- **Endereços:** Listas específicas por uso
- **Pagamentos:** Gastos vs ganhos separados
- **Notificações:** Alertas relevantes por modo

### **🚀 IMPLEMENTAÇÃO:**
O isolamento garante que cada modo tenha sua própria experiência limpa e organizada, sem confusão entre os dados de passageiro e motorista. 