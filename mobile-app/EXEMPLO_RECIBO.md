# 🧾 EXEMPLO DE RECIBO DE CORRIDA

## 📋 Estrutura do Recibo

### **Dados da Corrida**
- **ID da Corrida:** `booking_1234567890_customer_123`
- **Data/Hora:** `18/12/2025, 15:30`
- **Status:** `Concluída`

### **Localizações**
- **Origem:** `Praça Mauá, Rio de Janeiro - RJ`
- **Destino:** `Copacabana, Rio de Janeiro - RJ`

### **Detalhes da Viagem**
- **Distância:** `12.5 km`
- **Duração:** `30 minutos`
- **Tipo de Veículo:** `Standard`

### **Informações Financeiras**

#### **Valor Total da Corrida**
- **Tarifa Final:** `R$ 45,50`

#### **Breakdown Financeiro (Motorista)**
- **Valor da Corrida:** `R$ 45,50`
- **Custo Operacional:** `R$ 0,79` (Standard)
- **Taxa PIX (Woovi):** `R$ 0,36` (0.8% do valor)
- **Valor Líquido Recebido:** `R$ 44,35`

#### **Breakdown Financeiro (Passageiro)**
- **Valor Pago:** `R$ 45,50`
- **Método de Pagamento:** `PIX`
- **Status do Pagamento:** `Confirmado`

### **Informações do Motorista**
- **Nome:** `João Silva`
- **Telefone:** `(21) 98765-4321`
- **Placa do Veículo:** `ABC-1234`
- **Modelo:** `Honda Civic 2020`

### **Informações do Passageiro**
- **Nome:** `Maria Santos`
- **Telefone:** `(21) 91234-5678`

### **Timestamps**
- **Criada em:** `18/12/2025, 15:00`
- **Aceita em:** `18/12/2025, 15:02`
- **Iniciada em:** `18/12/2025, 15:05`
- **Finalizada em:** `18/12/2025, 15:35`
- **Pagamento Confirmado em:** `18/12/2025, 15:36`

---

## 🎨 Visual do Recibo

```
╔══════════════════════════════════════════════════════════╗
║                    🍃 LEAF                                ║
║              RECIBO DE CORRIDA                            ║
╠══════════════════════════════════════════════════════════╣
║                                                           ║
║  📅 Data: 18/12/2025, 15:30                              ║
║  🆔 ID: booking_1234567890_customer_123                   ║
║  ✅ Status: Concluída                                     ║
║                                                           ║
╠══════════════════════════════════════════════════════════╣
║  📍 ORIGEM                                                ║
║  Praça Mauá, Rio de Janeiro - RJ                         ║
║                                                           ║
║  🎯 DESTINO                                               ║
║  Copacabana, Rio de Janeiro - RJ                         ║
╠══════════════════════════════════════════════════════════╣
║  📏 Distância: 12.5 km                                   ║
║  ⏱️ Duração: 30 minutos                                  ║
║  🚗 Tipo: Standard                                       ║
╠══════════════════════════════════════════════════════════╣
║  💰 VALOR TOTAL                                           ║
║  R$ 45,50                                                 ║
╠══════════════════════════════════════════════════════════╣
║  💸 DETALHAMENTO FINANCEIRO (MOTORISTA)                  ║
║                                                           ║
║  Valor da Corrida:        R$ 45,50                       ║
║  Custo Operacional:       R$  0,79                       ║
║  Taxa PIX (Woovi):        R$  0,36                       ║
║  ─────────────────────────────────────                   ║
║  🚗 VOCÊ RECEBERÁ:        R$ 44,35                       ║
╠══════════════════════════════════════════════════════════╣
║  👤 MOTORISTA                                             ║
║  João Silva                                              ║
║  (21) 98765-4321                                         ║
║  🚗 Honda Civic 2020 - ABC-1234                          ║
╠══════════════════════════════════════════════════════════╣
║  👤 PASSAGEIRO                                            ║
║  Maria Santos                                            ║
║  (21) 91234-5678                                         ║
╠══════════════════════════════════════════════════════════╣
║  💳 PAGAMENTO                                             ║
║  Método: PIX                                             ║
║  Status: ✅ Confirmado                                    ║
║  Confirmado em: 18/12/2025, 15:36                        ║
╠══════════════════════════════════════════════════════════╣
║  ⏰ TIMELINE                                              ║
║  • Criada: 18/12/2025, 15:00                             ║
║  • Aceita: 18/12/2025, 15:02                             ║
║  • Iniciada: 18/12/2025, 15:05                           ║
║  • Finalizada: 18/12/2025, 15:35                         ║
╠══════════════════════════════════════════════════════════╣
║  🔐 Hash de Verificação                                  ║
║  a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6                         ║
╠══════════════════════════════════════════════════════════╣
║              Obrigado por usar a Leaf! 🍃                 ║
╚══════════════════════════════════════════════════════════╝
```

---

## 📱 Como Acessar no App

### **Para Motoristas:**
1. Abra o **Menu** (ícone ☰ no canto superior esquerdo)
2. Clique em **"Histórico de Corridas"**
3. Encontre a corrida desejada
4. Clique no botão **"Recibo"** (verde, no canto direito)

### **Após Finalizar Corrida:**
1. Quando a viagem é finalizada, aparece um alerta
2. Clique em **"Ver Recibo"**
3. O recibo completo será exibido

---

## 🎯 Funcionalidades do Recibo

- ✅ **Visualização completa** de todos os dados da corrida
- ✅ **Breakdown financeiro detalhado** (para motorista e passageiro)
- ✅ **Informações de localização** (origem e destino)
- ✅ **Timeline completa** da corrida
- ✅ **Hash de verificação** para segurança
- ✅ **Opção de compartilhamento** (via Share API)
- ✅ **Design responsivo** e moderno

---

## 📊 Dados Técnicos

### **Fonte dos Dados:**
- **Firestore:** Coleção `rides` (prioridade)
- **Realtime Database:** `trip_data/{bookingId}` (fallback)
- **Backend API:** `/api/receipts/:rideId` (fallback)

### **Estrutura de Dados:**
```javascript
{
  rideId: "booking_1234567890_customer_123",
  bookingId: "booking_1234567890_customer_123",
  status: "completed",
  pickupLocation: {
    lat: -22.9068,
    lng: -43.1234,
    address: "Praça Mauá, Rio de Janeiro - RJ"
  },
  destinationLocation: {
    lat: -22.9,
    lng: -43.13,
    address: "Copacabana, Rio de Janeiro - RJ"
  },
  finalPrice: 45.50,
  netFare: 44.35,
  distance: 12.5,
  duration: 30,
  driverEarnings: 44.35,
  financialBreakdown: {
    totalAmount: 4550, // centavos
    operationalCost: 79, // centavos
    wooviTax: 36, // centavos
    netAmount: 4435 // centavos
  },
  driver: {
    id: "driver_123",
    name: "João Silva",
    phone: "(21) 98765-4321",
    vehicle: {
      plate: "ABC-1234",
      model: "Honda Civic 2020"
    }
  },
  passenger: {
    id: "customer_123",
    name: "Maria Santos",
    phone: "(21) 91234-5678"
  },
  payment: {
    method: "pix",
    status: "completed",
    confirmedAt: "2025-12-18T15:36:00.000Z"
  },
  timestamps: {
    createdAt: "2025-12-18T15:00:00.000Z",
    acceptedAt: "2025-12-18T15:02:00.000Z",
    startedAt: "2025-12-18T15:05:00.000Z",
    completedAt: "2025-12-18T15:35:00.000Z"
  }
}
```

---

**Última atualização:** 2025-12-18

