# 🔧 Guia de Solução para Problemas de WebSocket e FCM

## 📋 Problemas Identificados e Soluções Implementadas

### 1. **Problema de Conectividade WebSocket**

**Problema:** O app mobile estava tentando conectar em `localhost:3001`, mas dispositivos físicos não conseguem acessar localhost do PC.

**Solução Implementada:**
- ✅ Criado arquivo `NetworkConfig.js` para configuração centralizada
- ✅ Atualizado `WebSocketManager.js` para usar IP correto da máquina
- ✅ Adicionado reconexão automática após falhas
- ✅ Melhorado timeout e configurações de conexão

### 2. **Problema de Perda do Token FCM**

**Problema:** Token FCM sendo perdido durante a sessão devido a timeouts e dependências do Redux.

**Solução Implementada:**
- ✅ Aumentado timeout de 10s para 15s
- ✅ Adicionado retry automático quando usuário não está autenticado
- ✅ Implementado renovação periódica do token (a cada 30 minutos)
- ✅ Melhorado tratamento de erros e fallbacks
- ✅ **NOVO:** Criado bypass para usuários de teste em desenvolvimento
- ✅ **NOVO:** Implementado TestUserService para gerenciar usuários de teste

### 3. **Problema de Usuário Não Autenticado**

**Problema:** Sistema verificando autenticação Firebase Auth, mas usuário de teste não está autenticado.

**Solução Implementada:**
- ✅ **NOVO:** Criado `TestUserService.js` para gerenciar usuários de teste
- ✅ **NOVO:** Implementado bypass automático em modo de desenvolvimento
- ✅ **NOVO:** Criado `TestUserManager.js` para interface de gerenciamento
- ✅ **NOVO:** Script `activate-test-user.js` para ativação rápida

### 4. **Ferramentas de Diagnóstico**

**Solução Implementada:**
- ✅ Criado `NetworkDiagnostics.js` para diagnóstico automático
- ✅ Validação de configuração de rede
- ✅ Testes de conectividade para todos os serviços
- ✅ Relatórios detalhados de problemas

## 🚀 Como Usar as Correções

### Passo 1: Configurar o IP da Sua Máquina

1. **Descobrir seu IP:**
   ```bash
   # No Windows (CMD):
   ipconfig
   
   # No Linux/Mac (Terminal):
   ifconfig
   # ou
   ip addr
   ```

2. **Editar o arquivo de configuração:**
   ```javascript
   // mobile-app/src/config/NetworkConfig.js
   const NETWORK_CONFIG = {
       LOCAL_IP: '192.168.0.41', // ← ALTERE AQUI para seu IP
       // ...
   };
   ```

### Passo 2: Verificar se o Backend Está Rodando

```bash
# Verificar se o servidor está rodando na porta 3001
curl http://localhost:3001/health

# Deve retornar algo como:
# {"status":"healthy","port":3001,...}
```

### Passo 3: Ativar Usuário de Teste (Para Desenvolvimento)

```javascript
// Opção 1: Script rápido (recomendado)
import testUserQuick from './test-user-quick';
await testUserQuick();
```

```javascript
// Opção 2: Usar o TestUserService diretamente
import TestUserService from './src/services/TestUserService';

// Ativar usuário de teste
await TestUserService.simulateTestUserAuth();

// Configurar como driver
await TestUserService.setTestUserAsDriver();

// Verificar status
await TestUserService.logDebugInfo();
```

```javascript
// Opção 3: Botão flutuante (adicione em qualquer tela)
import TestUserButton from './src/components/TestUserButton';

// Adicionar em uma tela de desenvolvimento
<TestUserButton />
```

```javascript
// Opção 4: Interface completa
import TestUserManager from './src/components/TestUserManager';

// Adicionar em uma tela de desenvolvimento
<TestUserManager />
```

### Passo 4: Executar Diagnóstico (Opcional)

```javascript
// No app mobile, você pode executar:
import NetworkDiagnostics from './src/utils/NetworkDiagnostics';

// Executar diagnóstico completo
await NetworkDiagnostics.runFullDiagnostics();
```

## 🔍 Verificações Importantes

### 1. **Conectividade de Rede**
- ✅ PC e dispositivo móvel na mesma rede Wi-Fi
- ✅ Firewall não bloqueando porta 3001
- ✅ IP da máquina correto no `NetworkConfig.js`

### 2. **Servidor WebSocket**
- ✅ Servidor rodando na porta 3001
- ✅ Múltiplos workers ativos (cluster mode)
- ✅ Health check respondendo

### 3. **Configuração FCM**
- ✅ Firebase configurado corretamente
- ✅ Permissões de notificação concedidas
- ✅ Token sendo renovado automaticamente

## 📱 Testando as Correções

### 1. **Teste de Conectividade WebSocket**
```javascript
// No console do app:
const wsManager = WebSocketManager.getInstance();
await wsManager.connect();
console.log('Conectado:', wsManager.isConnected());
```

### 2. **Teste de Token FCM**
```javascript
// No console do app:
const fcmService = require('./src/services/FCMNotificationService').default;
console.log('Token atual:', fcmService.getCurrentToken());
```

### 3. **Teste de Diagnóstico**
```javascript
// No console do app:
const diagnostics = require('./src/utils/NetworkDiagnostics').default;
await diagnostics.runFullDiagnostics();
```

## 🛠️ Solução de Problemas Comuns

### Problema: "WebSocket não conecta"
**Soluções:**
1. Verificar se o IP está correto no `NetworkConfig.js`
2. Confirmar que o servidor está rodando na porta 3001
3. Verificar se ambos estão na mesma rede Wi-Fi
4. Executar diagnóstico de rede

### Problema: "Token FCM perdido"
**Soluções:**
1. Verificar se o usuário está autenticado
2. Confirmar permissões de notificação
3. Verificar logs do Firebase
4. Aguardar renovação automática (30 minutos)

### Problema: "Timeout na conexão"
**Soluções:**
1. Verificar estabilidade da rede Wi-Fi
2. Aumentar timeout se necessário
3. Verificar se o servidor não está sobrecarregado

## 📊 Monitoramento

### Logs Importantes a Observar:
- `🔌 Tentando conectar ao WebSocket...`
- `✅ FCM Notification Service inicializado com sucesso`
- `🔄 Renovando token FCM...`
- `⚠️ Usuário não autenticado, tentando novamente em 5 segundos...`

### Métricas de Saúde:
- Conexões WebSocket ativas
- Token FCM válido
- Taxa de sucesso de reconexão
- Tempo de resposta dos serviços

## 🎯 Próximos Passos

1. **Testar as correções** com o usuário de teste
2. **Monitorar logs** durante o uso normal
3. **Ajustar timeouts** se necessário
4. **Implementar métricas** de monitoramento
5. **Documentar** qualquer problema adicional

---

**Nota:** As correções implementadas são robustas e incluem fallbacks automáticos. O sistema agora deve ser mais estável e resiliente a problemas de rede temporários.
