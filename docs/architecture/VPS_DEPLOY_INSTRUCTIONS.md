# 🚀 INSTRUÇÕES DE DEPLOY PARA VPS

## 📋 CORREÇÕES IMPLEMENTADAS

### 🔧 Status Online/Offline Persistente
- **Arquivo**: `mobile-app/src/components/map/DriverUI.js`
- **Mudança**: Status online/offline agora é independente de corridas
- **Persistência**: Salvo no AsyncStorage (`@driver_online_status`)
- **Comportamento**: Motorista online continua recebendo notificações push mesmo com app fechado

### 🧪 Bypass Completo para Usuário Teste
- **Arquivos**: 
  - `mobile-app/src/services/TestUserService.js` (NOVO)
  - `mobile-app/src/services/DatabaseBypass.js` (NOVO)
  - `mobile-app/src/components/AuthProvider.js`
  - `mobile-app/src/common-local/actions/authactions.js`
- **Funcionalidade**: Usuário teste (11999999999) funciona sem erros de permissão

### 🌐 Correções de Rede
- **Arquivo**: `mobile-app/src/config/NetworkConfig.js` (NOVO)
- **Funcionalidade**: URLs centralizadas para desenvolvimento

### 🌍 Correções de Internacionalização
- **Arquivos**: 
  - `mobile-app/src/locales/index.js`
  - `mobile-app/src/components/i18n/LanguageProvider.js`
- **Mudança**: Substituição de localStorage por AsyncStorage

### 🔧 Servidor WebSocket
- **Arquivo**: `leaf-websocket-backend/server.js`
- **Mudança**: Cluster mode desabilitado em desenvolvimento
- **Status**: Todos os eventos funcionando (12/12 testes passaram)

## 🚀 COMANDOS PARA DEPLOY NA VPS

```bash
# 1. Acessar VPS
ssh root@your-vps-ip

# 2. Ir para diretório do projeto
cd /path/to/leaf-app

# 3. Fazer backup atual
cp -r mobile-app mobile-app-backup-$(date +%Y%m%d-%H%M%S)
cp -r leaf-websocket-backend leaf-websocket-backend-backup-$(date +%Y%m%d-%H%M%S)

# 4. Atualizar código (se usando git)
git pull origin feature/vultr-optimized-integration

# 5. Instalar dependências
cd mobile-app && npm install
cd ../leaf-websocket-backend && npm install

# 6. Reiniciar servidor WebSocket
pm2 restart leaf-websocket-server

# 7. Verificar logs
pm2 logs leaf-websocket-server

# 8. Testar conectividade
curl http://localhost:3001/health
```

## 🧪 TESTES REALIZADOS

- ✅ **12/12 eventos WebSocket** testados com sucesso
- ✅ **Status online persistente** funcionando
- ✅ **Bypass de usuário teste** funcionando
- ✅ **Notificações FCM** funcionando
- ✅ **Sistema de avaliação** funcionando

## 📱 COMPORTAMENTO ESPERADO

1. **Motorista fica online** → Status persistido no AsyncStorage
2. **Recebe corrida** → Botão desabilitado durante corrida
3. **Finaliza corrida** → Botão reabilitado, status online mantido
4. **Fecha app** → Status online persistido
5. **Reabre app** → Status online carregado do AsyncStorage
6. **Recebe notificação push** → Motorista continua online

## 🔍 VERIFICAÇÕES PÓS-DEPLOY

1. **WebSocket conectando**: Verificar logs do servidor
2. **Status persistente**: Testar ficar online e fechar app
3. **Usuário teste**: Testar com número 11999999999
4. **Notificações**: Verificar se FCM está funcionando
5. **Eventos**: Executar script de teste WebSocket


