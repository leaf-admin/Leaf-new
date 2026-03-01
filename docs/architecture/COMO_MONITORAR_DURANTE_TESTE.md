# 📋 Como Monitorar Logs Durante o Teste

## 🎯 **OBJETIVO**

Monitorar os logs do servidor em tempo real enquanto você faz o teste completo:
1. Logar como motorista em um dispositivo
2. Logar como passageiro no outro dispositivo  
3. Solicitar uma corrida

---

## 🚀 **PASSO A PASSO**

### **1. Abrir Terminal e Iniciar Monitor**

```bash
cd /home/izaak-dias/Downloads/1.\ leaf/main/Sourcecode
./monitorar-logs-completo.sh
```

**O que acontece:**
- ✅ Script conecta ao servidor na VPS
- ✅ Monitora logs em tempo real
- ✅ Filtra apenas eventos relevantes
- ✅ Mostra com cores para facilitar leitura

---

### **2. Deixar Monitor Rodando**

**Não feche o terminal!** Deixe o monitor rodando enquanto faz o teste.

---

### **3. Fazer o Teste**

**No dispositivo do motorista:**
1. Abrir app
2. Logar como motorista (11999999999)
3. Ficar online
4. Aguardar

**No dispositivo do passageiro:**
1. Abrir app
2. Logar como passageiro
3. Solicitar uma corrida

---

### **4. Observar Logs em Tempo Real**

**O monitor mostrará:**

#### **Quando Motorista Loga:**
```
🔐 [HH:MM:SS] AUTENTICAÇÃO: 🔐 Usuário autenticado: test_driver_xxx (tipo: driver)
🔐 [HH:MM:SS] AUTENTICAÇÃO: 🚗 Driver test_driver_xxx adicionado ao room de drivers e driver_test_driver_xxx
📍 [HH:MM:SS] LOCALIZAÇÃO: 📍 [updateLocation] Localização recebida de socket_xxx
📍 [HH:MM:SS] LOCALIZAÇÃO: ✅ Motorista test_driver_xxx ONLINE salvo no Redis (GEO ativo): lat, lng, TTL: 90s
```

#### **Quando Passageiro Loga:**
```
🔐 [HH:MM:SS] AUTENTICAÇÃO: 🔐 Usuário autenticado: test_customer_xxx (tipo: customer)
```

#### **Quando Passageiro Solicita Corrida:**
```
🚗 [HH:MM:SS] CORRIDA CRIADA: 🚗 [Fase 7] Solicitação de corrida recebida de socket_xxx
🚗 [HH:MM:SS] CORRIDA CRIADA: ✅ [Fase 7] Corrida booking_xxx criada e processada
⚙️  [HH:MM:SS] QUEUE WORKER: 📊 [QueueWorker] Processando X região(ões) com corridas pendentes
⚙️  [HH:MM:SS] QUEUE WORKER: ✅ [QueueWorker] X corrida(s) processada(s) da região REGION
🔍 [HH:MM:SS] BUSCA GRADUAL: 🚀 [GradualRadiusExpander] Iniciando busca gradual para booking_xxx
📢 [HH:MM:SS] DISPATCHER: 🔍 [Dispatcher] Buscando motoristas em Xkm para booking_xxx
📢 [HH:MM:SS] DISPATCHER: ✅ [Dispatcher] X motoristas encontrados e pontuados para booking_xxx
📱 [HH:MM:SS] NOTIFICAÇÃO: ✅ [Dispatcher] Motorista test_driver_xxx notificado para booking_xxx
```

---

## 🔴 **O QUE PROCURAR (PROBLEMAS)**

### **Se Motorista Não Recebe Notificação:**

#### **1. Motorista Não Aparece em "motoristas encontrados":**
```
📢 [HH:MM:SS] DISPATCHER: ⚠️ [Dispatcher] Nenhum motorista encontrado em Xkm
```
**Problema:** Motorista não está no GEO ou está muito longe

#### **2. Motorista Aparece mas é Filtrado:**
```
📢 [HH:MM:SS] DISPATCHER: ⚠️ Motorista test_driver_xxx não está online ou não disponível
```
**Problema:** Status incorreto (`isOnline` ou `status`)

#### **3. Notificação Não é Enviada:**
```
📢 [HH:MM:SS] DISPATCHER: ⚠️ [Dispatcher] Lock não adquirido para driver test_driver_xxx
```
**Problema:** Motorista tem lock ativo

#### **4. QueueWorker Não Processa:**
```
⚠️  [HH:MM:SS] AVISO: Nenhuma região com corridas pendentes
```
**Problema:** Corrida não está na fila ou QueueWorker não está rodando

---

## 📊 **INTERPRETAÇÃO DOS LOGS**

### **Sequência Esperada (Sucesso):**

1. ✅ **Autenticação Motorista:**
   - `🔐 AUTENTICAÇÃO: Usuário autenticado`
   - `🚗 Driver adicionado ao room`

2. ✅ **Localização Motorista:**
   - `📍 LOCALIZAÇÃO: Localização recebida`
   - `✅ Motorista ONLINE salvo no Redis`

3. ✅ **Autenticação Passageiro:**
   - `🔐 AUTENTICAÇÃO: Usuário autenticado (tipo: customer)`

4. ✅ **Criação de Corrida:**
   - `🚗 CORRIDA CRIADA: Solicitação de corrida recebida`
   - `✅ Corrida booking_xxx criada`

5. ✅ **Processamento:**
   - `⚙️  QUEUE WORKER: Processando região`
   - `✅ QueueWorker: X corrida(s) processada(s)`

6. ✅ **Busca de Motoristas:**
   - `🔍 BUSCA GRADUAL: Iniciando busca gradual`
   - `📢 DISPATCHER: Buscando motoristas`
   - `✅ Dispatcher: X motoristas encontrados`

7. ✅ **Notificação:**
   - `📱 NOTIFICAÇÃO: Motorista notificado`

---

## 💡 **DICAS**

1. **Deixe o monitor rodando** antes de começar o teste
2. **Observe a sequência** - deve seguir a ordem acima
3. **Procure por erros** em vermelho
4. **Anote timestamps** se algo der errado
5. **Compare com checklist** para identificar onde está falhando

---

## 🔧 **SE O MONITOR NÃO FUNCIONAR**

### **Alternativa 1: Monitor Manual via SSH**

```bash
ssh root@216.238.107.59
tail -f /home/leaf/leaf-websocket-backend/server.log | grep -E "(authenticate|createBooking|Dispatcher|newRideRequest)"
```

### **Alternativa 2: Ver Logs Recentes**

```bash
ssh root@216.238.107.59 "tail -100 /home/leaf/leaf-websocket-backend/server.log | grep -E '(authenticate|createBooking|Dispatcher|newRideRequest)'"
```

---

## ✅ **PRONTO PARA USAR**

1. **Execute:** `./monitorar-logs-completo.sh`
2. **Deixe rodando** em um terminal
3. **Faça o teste** nos dispositivos
4. **Observe os logs** em tempo real
5. **Identifique problemas** pela sequência ou erros

**O monitor mostrará tudo em tempo real com cores para facilitar a identificação!**


