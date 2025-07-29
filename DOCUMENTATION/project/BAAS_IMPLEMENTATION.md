# 🏦 LEAF APP - Sistema BaaS (Bank as a Service)

## 📋 Visão Geral

O **Sistema BaaS da Leaf App** implementa o conceito de **Bank as a Service** usando a plataforma Woovi, onde cada motorista cadastrado recebe uma **conta Leaf** própria, permitindo que 100% do valor das corridas seja transferido automaticamente para sua conta.

## 🎯 Modelo de Negócio

### **💰 Estrutura Financeira:**
```
VALOR CORRIDA: R$ 20,00
├── 🚗 Motorista: R$ 20,00 (100% - via conta Leaf)
├── 🏢 Leaf: R$ 0,00 (0% por corrida)
└── 💳 Plano Semanal: R$ 49,90 (Plus) ou R$ 99,90 (Elite)
```

### **📊 Planos Leaf:**
- **Leaf Plus:** R$ 49,90/semana
  - Corridas ilimitadas
  - Suporte básico
  - 100% do valor das corridas

- **Leaf Elite:** R$ 99,90/semana
  - Corridas ilimitadas
  - Suporte premium
  - Prioridade nas corridas
  - 100% do valor das corridas

## 🏗️ Arquitetura BaaS

### **🏢 Estrutura de Contas:**
```
LEAF BaaS STRUCTURE
├── 🏢 Conta Principal (Leaf)
│   ├── Recebe todos os pagamentos
│   ├── Gerencia splits automáticos
│   └── Controla cobranças semanais
├── 👤 Contas Leaf (por motorista)
│   ├── Recebem 100% das corridas
│   ├── Saldo disponível imediatamente
│   └── Transferência automática
└── 💰 Fluxo Financeiro
    ├── Pagamento → Conta Leaf
    ├── Split automático → Conta do motorista
    └── Cobrança semanal → Plano escolhido
```

## 🔧 Implementação Técnica

### **1. Configuração BaaS**
```javascript
// Configuração da conta principal Leaf
const LEAF_BAAS_CONFIG = {
  main_account: {
    id: 'leaf_principal_account',
    name: 'Leaf App - Conta Principal',
    type: 'business',
    auto_split: true
  },
  
  driver_accounts: {
    auto_create: true,
    split_percentage: 100, // 100% para motorista
    transfer_delay: 'instant', // Transferência imediata
    fee_structure: {
      platform_fee: 0, // 0% por corrida
      processing_fee: 0, // 0% por corrida
      driver_net: 100, // 100% para motorista
      weekly_plan: {
        plus: 49.90,
        elite: 99.90
      }
    }
  }
};
```

### **2. API de Criação de Contas Leaf**
```javascript
// Criar conta Leaf para motorista
export const createDriverLeafAccount = async (driverData) => {
  try {
    const response = await api.post('/api/v1/subaccount', {
      name: `Leaf Driver - ${driverData.name}`,
      document: driverData.cpf,
      email: driverData.email,
      phone: driverData.phone,
      split_percentage: 100,
      auto_transfer: true,
      transfer_delay: 0 // Transferência imediata
    }, {
      headers: {
        'Authorization': WOOVI_CONFIG.apiKey,
        'Content-Type': 'application/json'
      }
    });
    
    return response.data;
  } catch (error) {
    console.error('Erro ao criar conta Leaf:', error);
    throw new Error('Falha ao criar conta do motorista');
  }
};
```

### **3. Processamento de Split Automático**
```javascript
// Processar split automático - 100% para motorista
export const processAutomaticSplit = async (paymentData) => {
  try {
    const splitData = {
      main_charge_id: paymentData.charge_id,
      splits: [
        {
          account_id: paymentData.driver.leaf_account_id,
          percentage: 100, // 100% para motorista
          amount: paymentData.value // Valor total
        }
        // Sem split para Leaf - taxa é semanal
      ]
    };
    
    const response = await api.post('/api/v1/split', splitData, {
      headers: {
        'Authorization': WOOVI_CONFIG.apiKey,
        'Content-Type': 'application/json'
      }
    });
    
    return response.data;
  } catch (error) {
    console.error('Erro no split automático:', error);
    throw new Error('Falha no processamento do split');
  }
};
```

## 📱 Integração no Mobile App

### **1. Tela de Seleção de Plano**
```javascript
// mobile-app/src/screens/PlanSelectionScreen.js
const PlanSelectionScreen = () => {
  const [selectedPlan, setSelectedPlan] = useState(null);
  
  const plans = [
    {
      id: 'plus',
      name: 'Leaf Plus',
      price: 49.90,
      period: 'semana',
      features: [
        'Corridas ilimitadas',
        'Suporte básico',
        '100% das corridas para você'
      ]
    },
    {
      id: 'elite',
      name: 'Leaf Elite', 
      price: 99.90,
      period: 'semana',
      features: [
        'Corridas ilimitadas',
        'Suporte premium',
        'Prioridade nas corridas',
        '100% das corridas para você'
      ]
    }
  ];

  const handlePlanSelection = async (plan) => {
    try {
      setSelectedPlan(plan);
      
      // Criar cobrança semanal
      const weeklyCharge = await createWeeklyPlanCharge({
        plan_type: plan.id,
        amount: plan.price,
        driver_id: userData.id
      });
      
      // Navegar para pagamento
      navigation.navigate('WeeklyPaymentScreen', {
        plan: plan,
        charge: weeklyCharge
      });
    } catch (error) {
      Alert.alert('Erro', 'Falha ao selecionar plano');
    }
  };
};
```

### **2. Dashboard do Motorista com BaaS**
```javascript
// mobile-app/src/screens/DriverDashboardScreen.js
const DriverDashboardScreen = () => {
  const [driverData, setDriverData] = useState({
    earnings: {
      today: 0,
      week: 0,
      month: 0,
      total_balance: 0
    },
    plan: {
      type: 'plus', // ou 'elite'
      price: 49.90,
      next_payment: '2025-08-04',
      status: 'active'
    },
    leaf_account: {
      balance: 0,
      account_id: '',
      status: 'active'
    },
    recentTrips: []
  });

  const renderPlanInfo = () => (
    <View style={styles.planCard}>
      <Text style={styles.planTitle}>
        Plano {driverData.plan.type === 'plus' ? 'Plus' : 'Elite'}
      </Text>
      <Text style={styles.planPrice}>
        R$ {driverData.plan.price}/semana
      </Text>
      <Text style={styles.planNextPayment}>
        Próximo pagamento: {driverData.plan.next_payment}
      </Text>
      <Text style={styles.planBenefit}>
        ✅ 100% das corridas para você
      </Text>
    </View>
  );

  const renderLeafAccount = () => (
    <View style={styles.accountCard}>
      <Text style={styles.accountTitle}>Conta Leaf</Text>
      <Text style={styles.accountBalance}>
        R$ {driverData.leaf_account.balance.toFixed(2)}
      </Text>
      <Text style={styles.accountStatus}>
        Status: {driverData.leaf_account.status}
      </Text>
    </View>
  );
};
```

## 🔧 Configuração no Backend

### **1. Firebase Function para BaaS**
```javascript
// functions/woovi-baas.js
exports.createLeafAccount = functions.https.onCall(async (data, context) => {
  try {
    const { driverData } = data;
    
    // Validar dados do motorista
    if (!driverData.cpf || !driverData.email) {
      throw new Error('Dados obrigatórios não fornecidos');
    }
    
    // Criar conta Leaf via Woovi BaaS
    const leafAccount = await createDriverLeafAccount(driverData);
    
    // Salvar no Firestore
    await admin.firestore().collection('drivers').doc(driverData.id).set({
      ...driverData,
      leaf_account_id: leafAccount.id,
      leaf_account_status: 'active',
      created_at: admin.firestore.FieldValue.serverTimestamp()
    });
    
    return { success: true, account_id: leafAccount.id };
  } catch (error) {
    console.error('Erro ao criar conta Leaf:', error);
    throw new Error('Falha na criação da conta');
  }
});

exports.processPaymentSplit = functions.https.onRequest(async (req, res) => {
  try {
    const { paymentData } = req.body;
    
    // Processar split automático
    const splitResult = await processAutomaticSplit(paymentData);
    
    // Notificar motorista
    await sendDriverNotification(paymentData.driver_id, {
      type: 'payment_received',
      amount: splitResult.driver_amount,
      trip_id: paymentData.trip_id
    });
    
    res.status(200).json({ success: true, split: splitResult });
  } catch (error) {
    console.error('Erro no split:', error);
    res.status(500).json({ error: 'Falha no processamento' });
  }
});
```

### **2. Sistema de Cobrança Semanal**
```javascript
// functions/weekly-plan-renewal.js
exports.createWeeklyPlanCharge = async (planData) => {
  try {
    const response = await api.post('/api/v1/charge', {
      value: planData.amount,
      correlationID: `weekly_plan_${planData.driver_id}_${Date.now()}`,
      comment: `Plano ${planData.plan_type} - Semanal`,
      expiresIn: 604800 // 7 dias
    }, {
      headers: {
        'Authorization': WOOVI_CONFIG.apiKey,
        'Content-Type': 'application/json'
      }
    });
    
    return response.data;
  } catch (error) {
    console.error('Erro ao criar cobrança semanal:', error);
    throw new Error('Falha ao criar cobrança do plano');
  }
};

// Renovação automática semanal
exports.weeklyPlanRenewal = functions.pubsub.schedule('every monday 00:00').onRun(async (context) => {
  try {
    // Buscar todos os motoristas ativos
    const drivers = await admin.firestore().collection('drivers')
      .where('status', '==', 'active')
      .get();
    
    for (const driver of drivers.docs) {
      const driverData = driver.data();
      
      // Criar cobrança semanal
      await createWeeklyPlanCharge({
        driver_id: driver.id,
        plan_type: driverData.plan_type,
        amount: driverData.plan_type === 'elite' ? 99.90 : 49.90
      });
      
      // Notificar motorista
      await sendDriverNotification(driver.id, {
        type: 'weekly_charge_created',
        amount: driverData.plan_type === 'elite' ? 99.90 : 49.90,
        plan_type: driverData.plan_type
      });
    }
    
    console.log(`Cobranças semanais criadas para ${drivers.size} motoristas`);
  } catch (error) {
    console.error('Erro na renovação semanal:', error);
  }
});
```

## 📊 Vantagens Competitivas

### **✅ Diferencial Leaf vs Competidores:**
- **Uber:** 25-30% de taxa por corrida
- **99:** 20-25% de taxa por corrida  
- **Leaf:** 0% de taxa por corrida + plano semanal fixo

### **🎯 Benefícios para Motoristas:**
1. **100% das corridas** ficam com o motorista
2. **Taxa fixa semanal** - previsibilidade total
3. **Sem surpresas** - valor conhecido antecipadamente
4. **Melhor rentabilidade** para quem roda muito
5. **Transparência total** - cliente vê exatamente quanto vai para motorista

### **📈 Benefícios para Leaf:**
1. **Receita previsível** - cobrança semanal fixa
2. **Menos complexidade** - não precisa calcular % por corrida
3. **Motoristas mais satisfeitos** - ficam com 100%
4. **Diferencial de mercado** - único com esse modelo
5. **Escalabilidade** - suporta milhares de motoristas

## 🚀 Roadmap de Implementação

### **📋 Fase 1 - Configuração BaaS (ALTA PRIORIDADE)**
- [ ] Configurar conta principal Leaf no Woovi BaaS
- [ ] Implementar API de criação de subcontas
- [ ] Criar sistema de split automático 100%
- [ ] Testar transferências automáticas

### **📋 Fase 2 - Planos Semanais (ALTA PRIORIDADE)**
- [ ] Implementar sistema de planos Plus/Elite
- [ ] Criar cobrança semanal automática
- [ ] Desenvolver tela de seleção de planos
- [ ] Implementar renovação automática

### **📋 Fase 3 - Integração Mobile (MÉDIA PRIORIDADE)**
- [ ] Integrar no cadastro de motoristas
- [ ] Criar dashboard com dados BaaS
- [ ] Implementar notificações de pagamento
- [ ] Desenvolver tela de pagamento semanal

### **📋 Fase 4 - Analytics e Monitoramento (BAIXA PRIORIDADE)**
- [ ] Dashboard de controle BaaS
- [ ] Relatórios de splits
- [ ] Monitoramento de contas
- [ ] Analytics de performance

## 🧪 Testes BaaS

### **📋 Testes de Criação de Contas:**
```bash
# Testar criação de conta Leaf
node scripts/testing/test-baas-account-creation.cjs

# Testar split automático
node scripts/testing/test-baas-split-automatic.cjs

# Testar cobrança semanal
node scripts/testing/test-weekly-plan-charge.cjs
```

### **📋 Testes de Integração:**
```bash
# Testar fluxo completo BaaS
node scripts/testing/test-baas-complete-flow.cjs

# Testar renovação automática
node scripts/testing/test-weekly-renewal.cjs
```

## 🔧 Configuração de Ambiente

### **📋 Variáveis de Ambiente BaaS:**
```bash
# Woovi BaaS
WOOVI_BAAS_MAIN_ACCOUNT_ID=leaf_principal_account
WOOVI_BAAS_API_KEY=your_baas_api_key
WOOVI_BAAS_WEBHOOK_URL=https://us-central1-leaf-reactnative.cloudfunctions.net/baas_webhook

# Planos semanais
LEAF_PLUS_PRICE=49.90
LEAF_ELITE_PRICE=99.90
LEAF_WEEKLY_RENEWAL_DAY=monday
```

## 📞 Suporte BaaS

### **🔧 Troubleshooting:**
1. **Conta não criada:** Execute `test-baas-account-creation.cjs`
2. **Split não funciona:** Execute `test-baas-split-automatic.cjs`
3. **Cobrança semanal:** Execute `test-weekly-plan-charge.cjs`
4. **Renovação automática:** Execute `test-weekly-renewal.cjs`

### **📊 Monitoramento:**
- **Woovi Dashboard:** https://app.openpix.com.br
- **Firebase Console:** https://console.firebase.google.com/project/leaf-reactnative
- **BaaS Analytics:** `leaf-dashboard/src/components/BaaSAnalytics.tsx`

---

**🏦 LEAF APP BaaS - Revolucionando a mobilidade urbana com 100% para motoristas!** 🚀

**Status:** 🔄 **EM DESENVOLVIMENTO**

**Última atualização:** 28 de Julho de 2025 