# 🚗 SISTEMA DE WAIT LIST PARA MOTORISTAS

## 📋 **ESTRUTURA DE DADOS**

### **1. Campo `waitListStatus` no Firebase:**
```javascript
// users/{driverId}
{
  // Campos existentes
  isApproved: boolean,        // Aprovação técnica (documentos, etc)
  approved: boolean,          // Compatibilidade com sistema atual
  
  // NOVOS CAMPOS PARA WAIT LIST
  waitListStatus: 'none' | 'pending' | 'approved' | 'rejected',
  waitListPosition: number,   // Posição na fila (1, 2, 3...)
  waitListJoinedAt: timestamp,
  waitListApprovedAt: timestamp,
  waitListRejectedAt: timestamp,
  waitListReason: string,     // Motivo da rejeição ou aprovação
  
  // Configurações de controle
  maxActiveDrivers: number,   // Limite de motoristas ativos (configurável)
  isActiveDriver: boolean,    // Se está ativo para corridas
}
```

### **2. Coleção `waitList` no Firestore:**
```javascript
// waitList/{driverId}
{
  driverId: string,
  position: number,
  status: 'pending' | 'approved' | 'rejected',
  joinedAt: timestamp,
  approvedAt: timestamp,
  rejectedAt: timestamp,
  reason: string,
  priority: 'normal' | 'high' | 'urgent',
  notes: string,
  adminId: string,            // Admin que processou
}
```

### **3. Configurações do Sistema:**
```javascript
// systemConfig/waitList
{
  maxActiveDrivers: 100,      // Limite configurável
  currentActiveDrivers: 85,   // Contador atual
  waitListEnabled: true,      // Se está ativo
  autoApproval: false,        // Aprovação automática
  notificationSettings: {
    positionUpdate: true,     // Notificar mudança de posição
    approvalNotification: true, // Notificar aprovação
    rejectionNotification: true // Notificar rejeição
  }
}
```

## 🎯 **FLUXO DO SISTEMA**

### **1. Cadastro de Motorista:**
```javascript
1. Motorista se cadastra
2. Documentos são verificados (isApproved = true/false)
3. Se aprovado tecnicamente:
   - Verifica se há vaga (currentActiveDrivers < maxActiveDrivers)
   - Se SIM: waitListStatus = 'approved', isActiveDriver = true
   - Se NÃO: waitListStatus = 'pending', adiciona à waitList
```

### **2. Gerenciamento da Wait List:**
```javascript
1. Admin pode aprovar motoristas da wait list
2. Admin pode rejeitar motoristas da wait list
3. Admin pode ajustar posições na fila
4. Sistema notifica mudanças de posição
5. Sistema notifica aprovações/rejeições
```

### **3. Tela de Wait List (Mobile):**
```javascript
1. Mostra posição atual na fila
2. Mostra estimativa de tempo
3. Permite cancelar inscrição
4. Mostra status dos documentos
5. Notificações push
```

## 📱 **TELAS NECESSÁRIAS**

### **Mobile App:**
1. **WaitListScreen.js** - Tela principal da wait list
2. **WaitListStatusScreen.js** - Status detalhado
3. **WaitListNotificationScreen.js** - Notificações

### **Dashboard:**
1. **WaitListManagement.tsx** - Gerenciar wait list
2. **DriverWaitList.tsx** - Lista de motoristas em espera
3. **WaitListSettings.tsx** - Configurações do sistema

## 🔧 **APIS NECESSÁRIAS**

### **Backend:**
1. `GET /api/waitlist/status` - Status da wait list
2. `POST /api/waitlist/join` - Entrar na wait list
3. `DELETE /api/waitlist/leave` - Sair da wait list
4. `GET /api/waitlist/drivers` - Listar motoristas (admin)
5. `POST /api/waitlist/approve` - Aprovar motorista (admin)
6. `POST /api/waitlist/reject` - Rejeitar motorista (admin)
7. `PUT /api/waitlist/position` - Ajustar posição (admin)

## 🎨 **COMPONENTES UI**

### **Mobile:**
1. **WaitListCard** - Card de status da wait list
2. **PositionIndicator** - Indicador de posição
3. **WaitTimeEstimate** - Estimativa de tempo
4. **WaitListActions** - Ações (cancelar, etc)

### **Dashboard:**
1. **WaitListTable** - Tabela de motoristas
2. **WaitListStats** - Estatísticas da wait list
3. **WaitListControls** - Controles de aprovação
4. **WaitListSettings** - Configurações

## 📊 **MÉTRICAS E RELATÓRIOS**

### **Dashboard:**
1. Total de motoristas na wait list
2. Tempo médio de espera
3. Taxa de aprovação/rejeição
4. Motoristas ativos vs limite
5. Histórico de movimentações

### **Mobile:**
1. Posição atual na fila
2. Tempo estimado de espera
3. Status dos documentos
4. Notificações de mudanças

## 🔔 **SISTEMA DE NOTIFICAÇÕES**

### **Push Notifications:**
1. "Você está na posição X da fila"
2. "Sua posição mudou para X"
3. "Parabéns! Você foi aprovado"
4. "Sua solicitação foi rejeitada"

### **In-App Notifications:**
1. Atualizações de posição
2. Lembretes de documentos
3. Avisos de sistema
4. Promoções especiais

## 🚀 **IMPLEMENTAÇÃO**

### **Fase 1: Backend (1 dia)**
- APIs de wait list
- Estrutura de dados
- Sistema de notificações

### **Fase 2: Mobile (1 dia)**
- Tela de wait list
- Integração com APIs
- Notificações push

### **Fase 3: Dashboard (1 dia)**
- Painel de controle
- Gerenciamento de motoristas
- Configurações

### **Fase 4: Testes (1 dia)**
- Testes de integração
- Testes de notificações
- Ajustes finais

**Total: 4 dias para sistema completo!** 🎉










