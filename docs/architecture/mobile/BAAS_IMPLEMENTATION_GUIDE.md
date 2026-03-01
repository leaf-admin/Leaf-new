# 🏦 GUIA PASSO A PASSO - IMPLEMENTAÇÃO BaaS

## 📅 Data: 29 de Julho de 2025
## 🎯 Status: ✅ **DOCUMENTAÇÃO COMPLETA**

---

## 🎯 **VISÃO GERAL DO BaaS**

### **💰 Modelo de Negócio Leaf**
```
VALOR CORRIDA: R$ 20,00
├── 🚗 Motorista: R$ 20,00 (100% - via conta Leaf)
├── 🏢 Leaf: R$ 0,00 (0% por corrida)
└── 💳 Plano Semanal: R$ 49,90 (Plus) ou R$ 99,90 (Elite)
```

### **🏦 Sistema BaaS (Bank as a Service)**
- **Conta Principal Leaf** - Recebe todos os pagamentos
- **Contas Leaf por Motorista** - Recebem 100% das corridas
- **Split Automático** - Transferência imediata para motorista
- **Cobrança Semanal** - Plano fixo (Plus/Elite)

---

## 🚀 **PASSO A PASSO DA IMPLEMENTAÇÃO**

### **📋 Fase 1: Configuração BaaS (ALTA PRIORIDADE)**

#### **1.1 Configurar Conta Principal Leaf**
```bash
# 1. Criar conta principal no Woovi BaaS
# 2. Configurar API Key
# 3. Definir webhook URL

# Variáveis de ambiente necessárias:
WOOVI_BAAS_MAIN_ACCOUNT_ID=leaf_principal_account
WOOVI_BAAS_API_KEY=your_baas_api_key
WOOVI_BAAS_WEBHOOK_URL=https://us-central1-leaf-reactnative.cloudfunctions.net/baas_webhook
```

#### **1.2 Implementar Firebase Functions**
```bash
# 1. Deploy das functions BaaS
cd functions
firebase deploy --only functions:woovi-baas

# 2. Verificar URLs das functions:
# - Criação de conta: https://us-central1-leaf-reactnative.cloudfunctions.net/baas_createLeafAccount
# - Processamento de split: https://us-central1-leaf-reactnative.cloudfunctions.net/baas_processPaymentSplit
# - Cobrança semanal: https://us-central1-leaf-reactnative.cloudfunctions.net/baas_createWeeklyPlanCharge
# - Webhook BaaS: https://us-central1-leaf-reactnative.cloudfunctions.net/baas_baasWebhook
```

#### **1.3 Configurar Webhook no Woovi**
```bash
# 1. Acessar dashboard Woovi
# 2. Configurar webhook URL
# 3. Selecionar eventos:
#    - charge.completed
#    - split.completed  
#    - account.created
```

### **📋 Fase 2: Planos Semanais (ALTA PRIORIDADE)**

#### **2.1 Implementar Sistema de Planos**
```javascript
// mobile-app/src/screens/PlanSelectionScreen.js
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
```

#### **2.2 Implementar Cobrança Semanal**
```javascript
// functions/woovi-baas.js
exports.createWeeklyPlanCharge = async (planData) => {
  // Criar cobrança semanal via Woovi
  // Processar pagamento
  // Notificar motorista
  // Log da transação
};

// Renovação automática semanal
exports.weeklyPlanRenewal = functions.pubsub.schedule('every monday 00:00').onRun(async (context) => {
  // Processar todos os motoristas ativos
  // Criar cobranças semanais
  // Notificar motoristas
});
```

### **📋 Fase 3: Integração Mobile (MÉDIA PRIORIDADE)**

#### **3.1 Tela de Seleção de Plano**
```javascript
// mobile-app/src/screens/PlanSelectionScreen.js
const PlanSelectionScreen = () => {
  const handlePlanSelection = async (plan) => {
    try {
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

#### **3.2 Dashboard do Motorista**
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
    }
  });
};
```

#### **3.3 Sistema de Notificações**
```javascript
// mobile-app/src/services/NotificationService.js
const handleBaaSNotification = (notification) => {
  switch (notification.type) {
    case 'payment_received':
      // Notificar pagamento recebido
      break;
    case 'weekly_charge_created':
      // Notificar cobrança semanal
      break;
    case 'account_created':
      // Notificar conta Leaf criada
      break;
  }
};
```

### **📋 Fase 4: Sistema de Convites (BAIXA PRIORIDADE)**

#### **4.1 Implementar Sistema de Convites**
```javascript
// Sistema de convites
const LEAF_REFERRAL_CONFIG = {
  invites_per_driver: 3,
  required_rides_per_invitee: 10,
  free_months_per_invite: 1,
  max_free_months: 12
};

// Criar convite
async function createDriverInvite(inviteData) {
  // Verificar limite de convites
  // Gerar código único
  // Salvar no Firestore
  // Notificar motorista
}

// Processar convite
async function processDriverInvite(inviteData) {
  // Verificar validade
  // Verificar corridas mínimas
  // Adicionar meses grátis
  // Notificar ambos
}
```

---

## 🧪 **TESTES E VALIDAÇÃO**

### **📋 Scripts de Teste Disponíveis**
```bash
# Testes básicos
node scripts/testing/test-baas-account-creation.cjs
node scripts/testing/test-baas-split-automatic.cjs
node scripts/testing/test-weekly-plan-charge.cjs

# Testes avançados
node scripts/testing/test-baas-split-automatic.cjs --errors
node scripts/testing/test-baas-split-automatic.cjs --performance
node scripts/testing/test-weekly-plan-charge.cjs --both-plans
node scripts/testing/test-weekly-plan-charge.cjs --renewal
```

### **📋 Comandos de Deploy**
```bash
# Deploy completo
./scripts/deploy/deploy-baas-system.sh

# Deploy específico
firebase deploy --only functions:woovi-baas
```

---

## 🔧 **CONFIGURAÇÃO DE AMBIENTE**

### **📋 Variáveis de Ambiente Necessárias**
```bash
# BaaS (Bank as a Service)
WOOVI_BAAS_MAIN_ACCOUNT_ID=leaf_principal_account
WOOVI_BAAS_API_KEY=your_baas_api_key
WOOVI_BAAS_WEBHOOK_URL=https://us-central1-leaf-reactnative.cloudfunctions.net/baas_webhook

# Planos semanais
LEAF_PLUS_PRICE=49.90
LEAF_ELITE_PRICE=99.90
LEAF_WEEKLY_RENEWAL_DAY=monday

# Período grátis
LEAF_FREE_TRIAL_DAYS=90
LEAF_MAX_FREE_TRIAL_DRIVERS=500

# Sistema de convites
LEAF_INVITES_PER_DRIVER=3
LEAF_REQUIRED_RIDES_PER_INVITE=10
LEAF_FREE_MONTHS_PER_INVITE=1
LEAF_MAX_FREE_MONTHS=12
```

---

## 📱 **INTEGRAÇÃO NO MOBILE APP**

### **🎯 Telas a Implementar**
1. **PlanSelectionScreen.js** - Seleção de planos semanais
2. **WeeklyPaymentScreen.js** - Tela de pagamento semanal
3. **DriverDashboardScreen.js** - Dashboard com saldo e cobranças
4. **ReferralScreen.js** - Sistema de convites
5. **FreeTrialScreen.js** - Status do período grátis

### **🔧 Funcionalidades Mobile**
- ✅ Notificações push para cobranças
- ✅ Notificações para convites aceitos
- ✅ Exibição de saldo em tempo real
- ✅ Histórico de cobranças semanais
- ✅ Status do período grátis
- ✅ Sistema de convites integrado

---

## 📊 **VANTAGENS COMPETITIVAS**

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

---

## 🚨 **TROUBLESHOOTING**

### **❌ Problemas Comuns**
1. **Conta não criada:** Execute `test-baas-account-creation.cjs`
2. **Split não funciona:** Execute `test-baas-split-automatic.cjs`
3. **Cobrança semanal:** Execute `test-weekly-plan-charge.cjs`
4. **Renovação automática:** Execute `test-weekly-renewal.cjs`

### **🔧 Soluções**
```bash
# Verificar logs
firebase functions:log

# Verificar status
firebase functions:list

# Re-deploy
firebase deploy --only functions:woovi-baas
```

---

## 📋 **PRÓXIMOS PASSOS**

### **🎯 Imediato (Esta Semana)**
1. **Configurar conta principal Leaf no Woovi BaaS**
2. **Deploy das Firebase Functions**
3. **Testar com dados reais**
4. **Configurar webhook no dashboard da Woovi**

### **🎯 Próxima Semana**
5. **Integrar no mobile app**
6. **Implementar telas de plano**
7. **Testar fluxo completo**
8. **Configurar notificações**

### **🎯 Futuro**
9. **Sistema de convites**
10. **Dashboard de controle**
11. **Analytics avançados**
12. **Otimizações de performance**

---

## 🎉 **CONCLUSÃO**

O **Sistema BaaS da Leaf App** está completamente documentado e pronto para implementação. Com **100% do valor das corridas indo para os motoristas**, a Leaf App se posiciona como uma alternativa única e atrativa no mercado.

### **🏆 Principais Benefícios:**
- ✅ **Diferencial único** no mercado
- ✅ **Motoristas mais satisfeitos** - ficam com 100%
- ✅ **Receita previsível** para Leaf
- ✅ **Escalabilidade** - suporta milhares de motoristas
- ✅ **Transparência total** - cliente vê exatamente quanto vai para motorista

### **🚀 Próximo Milestone:**
- Implementar Fase 1 (Configuração BaaS)
- Testar com dados reais
- Integrar no mobile app

---

**🏦 LEAF APP BaaS - Revolucionando a mobilidade urbana com 100% para motoristas!** 🚀

**Status:** ✅ **DOCUMENTAÇÃO COMPLETA - PRONTO PARA IMPLEMENTAÇÃO**

**Última atualização:** 29 de Julho de 2025 