# 📋 Instruções: Monitoramento de Logs em Tempo Real

## 🎯 **OBJETIVO**

Monitorar os logs do servidor em tempo real enquanto você faz o teste:
1. Logar como motorista em um dispositivo
2. Logar como passageiro no outro dispositivo
3. Solicitar uma corrida

---

## 🚀 **COMO USAR**

### **Opção 1: Monitor Simples (Recomendado)**

```bash
./monitorar-logs-servidor.sh
```

**O que monitora:**
- ✅ Autenticação (motorista e passageiro)
- ✅ Criação de corrida
- ✅ Processamento de filas
- ✅ Busca de motoristas
- ✅ Notificações enviadas
- ✅ Erros e avisos

**Cores:**
- 🟢 Verde: Autenticação, Notificações, Sucesso
- 🔵 Azul: Criação de corrida
- 🟡 Amarelo: Avisos, IDs de teste
- 🔴 Vermelho: Erros
- 🟣 Magenta: Dispatcher, Busca gradual
- 🔵 Ciano: QueueWorker, Localização

---

### **Opção 2: Monitor Completo (Mais Detalhado)**

```bash
./monitorar-logs-completo.sh
```

**O que monitora:**
- ✅ Todos os eventos do monitor simples
- ✅ Estatísticas em tempo real
- ✅ Timestamps em cada linha
- ✅ Mais detalhes sobre cada evento

**Estatísticas mostradas:**
- Número de autenticações
- Número de corridas criadas
- Número de notificações enviadas
- Número de erros

---

## 📊 **O QUE PROCURAR NOS LOGS**

### **1. Autenticação do Motorista:**
```
🔐 [timestamp] AUTENTICAÇÃO: 🔐 Usuário autenticado: test_driver_xxx (tipo: driver)
🔐 [timestamp] AUTENTICAÇÃO: 🚗 Driver test_driver_xxx adicionado ao room de drivers e driver_test_driver_xxx
```

**✅ Esperado:** Motorista autenticado e room criado

---

### **2. Autenticação do Passageiro:**
```
🔐 [timestamp] AUTENTICAÇÃO: 🔐 Usuário autenticado: test_customer_xxx (tipo: customer)
```

**✅ Esperado:** Passageiro autenticado

---

### **3. Localização do Motorista:**
```
📍 [timestamp] LOCALIZAÇÃO: 📍 [updateLocation] Localização recebida de socket_xxx
📍 [timestamp] LOCALIZAÇÃO: ✅ Motorista test_driver_xxx ONLINE salvo no Redis (GEO ativo): lat, lng, TTL: 90s
```

**✅ Esperado:** Localização sendo recebida e salva

---

### **4. Criação de Corrida:**
```
🚗 [timestamp] CORRIDA CRIADA: 🚗 [Fase 7] Solicitação de corrida recebida de socket_xxx
🚗 [timestamp] CORRIDA CRIADA: ✅ [Fase 7] Corrida booking_xxx criada e processada para cliente test_customer_xxx
```

**✅ Esperado:** Corrida criada com sucesso

---

### **5. Processamento da Fila:**
```
⚙️  [timestamp] QUEUE WORKER: 📊 [QueueWorker] Processando X região(ões) com corridas pendentes
⚙️  [timestamp] QUEUE WORKER: ✅ [QueueWorker] X corrida(s) processada(s) da região REGION
```

**✅ Esperado:** QueueWorker processando corridas

---

### **6. Busca de Motoristas:**
```
📢 [timestamp] DISPATCHER: 🔍 [Dispatcher] Buscando motoristas em Xkm para booking_xxx
📢 [timestamp] DISPATCHER: ✅ [Dispatcher] X motoristas encontrados e pontuados para booking_xxx
📢 [timestamp] DISPATCHER: 📊 [Dispatcher] Score calculado para driver test_driver_xxx: XX.XX
```

**✅ Esperado:** Motoristas sendo encontrados e pontuados

---

### **7. Notificação Enviada:**
```
📱 [timestamp] NOTIFICAÇÃO: ✅ [Dispatcher] Motorista test_driver_xxx notificado para booking_xxx
📱 [timestamp] NOTIFICAÇÃO: 📱 Notificação enviada para driver test_driver_xxx
```

**✅ Esperado:** Notificação sendo enviada para o motorista

---

### **8. Busca Gradual:**
```
🔍 [timestamp] BUSCA GRADUAL: 🚀 [GradualRadiusExpander] Iniciando busca gradual para booking_xxx
🔍 [timestamp] BUSCA GRADUAL: 🔍 [GradualRadiusExpander] Buscando motoristas no raio Xkm
```

**✅ Esperado:** Busca gradual iniciada

---

## 🔴 **PROBLEMAS QUE PODEM APARECER**

### **1. Motorista Não Autenticado:**
```
❌ [timestamp] ERRO: Erro ao autenticar motorista
```

**Solução:** Verificar se motorista está logando corretamente

---

### **2. Localização Não Recebida:**
```
⚠️  [timestamp] AVISO: Motorista test_driver_xxx não tem localização salva no Redis
```

**Solução:** Verificar se motorista está enviando localização

---

### **3. Corrida Não Criada:**
```
❌ [timestamp] ERRO: [Fase 7] Erro ao criar corrida
```

**Solução:** Verificar dados enviados pelo passageiro

---

### **4. QueueWorker Não Processa:**
```
⚠️  [timestamp] AVISO: Nenhuma região com corridas pendentes
```

**Solução:** Verificar se corrida está na fila

---

### **5. Motoristas Não Encontrados:**
```
⚠️  [timestamp] AVISO: [Dispatcher] Nenhum motorista encontrado em Xkm
```

**Solução:** Verificar se motorista está no GEO e dentro do raio

---

### **6. Motorista Filtrado:**
```
⚠️  [timestamp] AVISO: Motorista test_driver_xxx não está online ou não disponível
```

**Solução:** Verificar status do motorista no Redis

---

### **7. Notificação Não Enviada:**
```
⚠️  [timestamp] AVISO: Lock não adquirido para driver test_driver_xxx
```

**Solução:** Verificar se motorista tem lock ativo

---

## 📋 **CHECKLIST DURANTE O TESTE**

### **Quando Motorista Loga:**
- [ ] Aparece: `🔐 AUTENTICAÇÃO: Usuário autenticado`
- [ ] Aparece: `🚗 Driver adicionado ao room`
- [ ] Aparece: `📍 LOCALIZAÇÃO: Localização recebida`
- [ ] Aparece: `✅ Motorista ONLINE salvo no Redis`

### **Quando Passageiro Loga:**
- [ ] Aparece: `🔐 AUTENTICAÇÃO: Usuário autenticado (tipo: customer)`

### **Quando Passageiro Solicita Corrida:**
- [ ] Aparece: `🚗 CORRIDA CRIADA: Solicitação de corrida recebida`
- [ ] Aparece: `✅ Corrida booking_xxx criada`
- [ ] Aparece: `⚙️  QUEUE WORKER: Processando região`
- [ ] Aparece: `✅ QueueWorker: X corrida(s) processada(s)`
- [ ] Aparece: `🔍 BUSCA GRADUAL: Iniciando busca gradual`
- [ ] Aparece: `📢 DISPATCHER: Buscando motoristas`
- [ ] Aparece: `✅ Dispatcher: X motoristas encontrados`
- [ ] Aparece: `📱 NOTIFICAÇÃO: Motorista notificado`

### **Se Motorista Não Recebe:**
- [ ] Verificar se motorista aparece em "motoristas encontrados"
- [ ] Verificar se motorista passou nos filtros
- [ ] Verificar se notificação foi enviada
- [ ] Verificar se há erros nos logs

---

## 💡 **DICAS**

1. **Deixe o monitor rodando** antes de começar o teste
2. **Observe as cores** - cada tipo de evento tem uma cor
3. **Procure por erros** em vermelho
4. **Verifique a sequência** - deve seguir: Autenticação → Corrida → Processamento → Busca → Notificação
5. **Anote timestamps** se algo der errado

---

## 🎯 **PRÓXIMOS PASSOS**

1. **Iniciar monitor:**
   ```bash
   ./monitorar-logs-completo.sh
   ```

2. **Fazer o teste:**
   - Logar como motorista
   - Logar como passageiro
   - Solicitar corrida

3. **Observar logs** e identificar onde está falhando

4. **Compartilhar logs** se precisar de ajuda adicional

---

## ✅ **PRONTO PARA USAR**

Execute o monitor e comece o teste! Os logs aparecerão em tempo real com cores e formatação para facilitar a identificação de problemas.


