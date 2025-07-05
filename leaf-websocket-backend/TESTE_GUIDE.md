# 🧪 Guia de Testes - LEAF WebSocket Backend

## 🚀 Passo a Passo para Testar

### **1. Parar processos na porta 3001**
```bash
# No CMD como administrador:
netstat -ano | findstr :3001
taskkill /PID [PID_NUMBER] /F

# OU usar o script:
start-server.bat
```

### **2. Testar dependências básicas**
```bash
node test-basic-connection.js
```
**Resultado esperado:**
- ✅ Express carregado
- ✅ Socket.io carregado
- ✅ Redis carregado
- ✅ CORS carregado
- ✅ Firebase Admin carregado
- ✅ Arquivo de credenciais Firebase encontrado
- ✅ Redis conectado com sucesso!

### **3. Iniciar servidor Redis-only (sem Firebase)**
```bash
node test-redis-only.js
```
**Resultado esperado:**
- 🧪 Teste Redis + WebSocket (sem Firebase)...
- 🔴 Conectando ao Redis...
- ✅ Redis conectado
- 🚀 Servidor WebSocket iniciado na porta 3001
- 📡 Socket.io pronto para conexões
- 💡 Modo: Redis apenas (sem Firebase)

### **4. Testar integração Redis**
```bash
# Em outro terminal:
npm install socket.io-client
node test-redis-simple.js
```
**Resultado esperado:**
- ✅ Conectado ao servidor
- ✅ Ping respondido
- ✅ Autenticado
- ✅ Localização atualizada
- ✅ Motoristas encontrados
- ✅ Estatísticas
- 🎉 Teste Redis concluído com sucesso!

### **5. Testar servidor completo (com Firebase)**
```bash
# Parar servidor anterior (Ctrl+C)
node server.js
```
**Resultado esperado:**
- 🔴 Conectando ao Redis...
- ✅ Redis conectado
- ✅ Firebase Admin SDK inicializado
- 📊 Firestore conectado
- ⚡ Realtime Database conectado
- 🚀 Servidor WebSocket iniciado na porta 3001

### **6. Testar integração completa**
```bash
# Em outro terminal:
node test-integration.js
```
**Resultado esperado:**
- ✅ Conectado ao servidor
- ✅ Autenticado
- ✅ Localização atualizada (com sync Firebase)
- ✅ Motoristas encontrados
- ✅ Status do motorista atualizado
- ✅ Viagem criada
- ✅ Status da viagem atualizado
- ✅ Estatísticas
- ✅ Dados do Firestore
- ✅ Dados do Realtime Database
- 🎉 Todos os testes concluídos com sucesso!

## 🔧 Troubleshooting

### **Erro: EADDRINUSE**
```bash
# Parar todos os processos Node.js:
taskkill /F /IM node.exe

# OU parar processo específico:
netstat -ano | findstr :3001
taskkill /PID [PID] /F
```

### **Erro: Redis não conecta**
```bash
# Verificar se Redis Docker está rodando:
docker ps | grep redis

# Se não estiver, iniciar:
docker run -d -p 6379:6379 --name redis-leaf redis:alpine
```

### **Erro: Firebase não conecta**
- Verificar se o arquivo de credenciais existe
- Verificar permissões do projeto Firebase
- Usar modo Redis-only inicialmente

### **Erro: Socket.io não conecta**
- Verificar se o servidor está rodando
- Verificar CORS
- Verificar firewall

## 📊 Validação de Funcionalidades

### **✅ Funcionalidades Básicas (Redis)**
- [ ] Conexão WebSocket
- [ ] Autenticação
- [ ] Atualização de localização
- [ ] Busca de motoristas próximos
- [ ] Estatísticas

### **✅ Funcionalidades Avançadas (Firebase)**
- [ ] Sincronização Firestore
- [ ] Sincronização Realtime Database
- [ ] Gerenciamento de viagens
- [ ] Consultas diretas Firebase

## 🎯 Próximos Passos

1. **Se todos os testes passarem:** Backend está 100% funcional
2. **Se houver erros:** Resolver conforme troubleshooting
3. **Integrar com app mobile:** Usar eventos WebSocket documentados
4. **Deploy:** Configurar para produção

## 📞 Suporte

Se encontrar problemas:
1. Verificar logs do servidor
2. Verificar conexão Redis
3. Verificar credenciais Firebase
4. Executar testes básicos primeiro 