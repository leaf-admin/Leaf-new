# 📱 Guia de Testes Mobile - Redis LEAF

## 🎯 **Visão Geral**

Este guia específico para testes em dispositivos móveis cobre todas as funcionalidades Redis implementadas no app React Native.

---

## 📋 **Checklist de Testes Mobile**

### **Pré-requisitos**
- [ ] Redis rodando localmente
- [ ] Firebase Functions ativo
- [ ] App React Native compilado
- [ ] Dispositivo físico ou emulador
- [ ] Console de desenvolvimento aberto

---

## 🚀 **Fase 1: Configuração e Inicialização**

### **1.1 Iniciar Infraestrutura**

```bash
# 1. Iniciar Redis
quick-start-redis.bat

# 2. Verificar se está rodando
docker ps | grep redis

# 3. Iniciar Firebase Functions (se necessário)
firebase emulators:start --only functions
```

### **1.2 Iniciar App Mobile**

```bash
# 1. Navegar para diretório mobile
cd mobile-app

# 2. Instalar dependências (se necessário)
npm install

# 3. Iniciar Metro bundler
npm start

# 4. Escanear QR code ou pressionar 'a' para Android
```

---

## 📍 **Fase 2: Testes de Localização**

### **2.1 Teste de Permissões**

**O que testar:**
- [ ] Permissão de localização solicitada
- [ ] Permissão concedida pelo usuário
- [ ] GPS ativado no dispositivo

**Como testar:**
1. Abrir app pela primeira vez
2. Verificar se solicita permissão de localização
3. Conceder permissão
4. Verificar se GPS está ativo

**Resultado esperado:**
```
✅ Permissão solicitada
✅ Permissão concedida
✅ GPS ativo
✅ Localização sendo capturada
```

### **2.2 Teste de Captura de Localização**

**O que testar:**
- [ ] Captura de coordenadas em tempo real
- [ ] Precisão da localização
- [ ] Frequência de atualização

**Como testar:**
1. Abrir tela de mapa
2. Mover dispositivo
3. Verificar coordenadas no console
4. Testar em diferentes ambientes (interior/exterior)

**Logs esperados:**
```javascript
// Console do React Native
[Redis] Location captured: { lat: -22.9068, lng: -43.1729 }
[Redis] Location saved successfully
[Redis] Nearby users found: 3
```

### **2.3 Teste de Busca de Usuários Próximos**

**O que testar:**
- [ ] Busca de motoristas próximos
- [ ] Filtros de distância
- [ ] Atualização em tempo real

**Como testar:**
1. Abrir tela de busca de motoristas
2. Verificar lista de motoristas próximos
3. Alterar filtros de distância
4. Mover dispositivo e verificar atualizações

**Resultado esperado:**
```
✅ Lista de motoristas carregada
✅ Distâncias calculadas corretamente
✅ Atualizações em tempo real
✅ Filtros funcionando
```

---

## 🚗 **Fase 3: Testes de Tracking**

### **3.1 Teste de Início de Viagem**

**O que testar:**
- [ ] Início de tracking
- [ ] Captura de localização inicial
- [ ] Criação de sessão de viagem

**Como testar:**
1. Simular aceitação de corrida
2. Verificar se tracking inicia
3. Verificar logs de criação de viagem

**Logs esperados:**
```javascript
[Redis] Trip started: trip-123
[Redis] Initial location saved
[Redis] Tracking session created
```

### **3.2 Teste de Atualização de Localização**

**O que testar:**
- [ ] Atualizações em tempo real
- [ ] Precisão do tracking
- [ ] Performance das atualizações

**Como testar:**
1. Iniciar viagem
2. Mover dispositivo
3. Verificar atualizações no mapa
4. Verificar logs de performance

**Métricas esperadas:**
```
✅ Atualizações a cada 5-10 segundos
✅ Latência < 100ms
✅ Precisão GPS mantida
✅ Bateria não drenada excessivamente
```

### **3.3 Teste de Finalização de Viagem**

**O que testar:**
- [ ] Finalização de tracking
- [ ] Salvamento de dados completos
- [ ] Migração para Firestore

**Como testar:**
1. Finalizar viagem
2. Verificar dados salvos
3. Verificar migração para Firestore

**Logs esperados:**
```javascript
[Redis] Trip ended: trip-123
[Redis] Final location saved
[Redis] Trip data migrated to Firestore
[Redis] Tracking session closed
```

---

## 🔄 **Fase 4: Testes de Integração**

### **4.1 Teste de Feature Flags**

**O que testar:**
- [ ] Controle de funcionalidades Redis
- [ ] Fallback para Firebase
- [ ] Toggle de features

**Como testar:**
1. Verificar configuração de feature flags
2. Testar com Redis ativo
3. Testar com Redis inativo (fallback)
4. Alternar entre modos

**Configuração esperada:**
```javascript
// Configuração de feature flags
const REDIS_FEATURES = {
  location: true,
  tracking: true,
  fallback: true
};
```

### **4.2 Teste de Fallback**

**O que testar:**
- [ ] Fallback automático para Firebase
- [ ] Recuperação quando Redis volta
- [ ] Consistência de dados

**Como testar:**
1. Parar Redis: `docker-compose stop redis`
2. Testar funcionalidades (devem usar Firebase)
3. Reiniciar Redis: `docker-compose start redis`
4. Verificar se volta a usar Redis

**Resultado esperado:**
```
✅ Fallback automático funcionando
✅ Dados consistentes
✅ Recuperação automática
✅ Sem perda de funcionalidade
```

---

## 📊 **Fase 5: Testes de Performance**

### **5.1 Teste de Bateria**

**O que testar:**
- [ ] Consumo de bateria
- [ ] Otimização de GPS
- [ ] Gerenciamento de recursos

**Como testar:**
1. Monitorar consumo de bateria
2. Usar app por 30 minutos
3. Verificar otimizações ativas

**Métricas esperadas:**
```
✅ Consumo < 5% por hora
✅ GPS otimizado
✅ Recursos gerenciados
✅ Sem vazamentos de memória
```

### **5.2 Teste de Memória**

**O que testar:**
- [ ] Uso de memória
- [ ] Vazamentos de memória
- [ ] Limpeza de recursos

**Como testar:**
1. Monitorar uso de memória
2. Navegar entre telas
3. Iniciar/finalizar viagens
4. Verificar limpeza automática

**Resultado esperado:**
```
✅ Uso de memória estável
✅ Sem vazamentos
✅ Limpeza automática
✅ Performance consistente
```

### **5.3 Teste de Rede**

**O que testar:**
- [ ] Funcionamento offline
- [ ] Sincronização quando online
- [ ] Tratamento de erros de rede

**Como testar:**
1. Desativar WiFi/celular
2. Testar funcionalidades
3. Reativar conexão
4. Verificar sincronização

**Resultado esperado:**
```
✅ Funcionamento offline
✅ Sincronização automática
✅ Tratamento de erros
✅ Experiência contínua
```

---

## 🧪 **Fase 6: Testes de Cenários**

### **6.1 Cenário: Viagem Completa**

**Fluxo de teste:**
1. ✅ Login no app
2. ✅ Buscar motoristas próximos
3. ✅ Aceitar corrida
4. ✅ Iniciar tracking
5. ✅ Acompanhar viagem
6. ✅ Finalizar viagem
7. ✅ Verificar histórico

**Pontos de verificação:**
- [ ] Dados salvos no Redis
- [ ] Tracking em tempo real
- [ ] Migração para Firestore
- [ ] Histórico disponível

### **6.2 Cenário: Múltiplos Usuários**

**Como testar:**
1. Abrir app em 2-3 dispositivos
2. Simular viagens simultâneas
3. Verificar performance
4. Verificar isolamento de dados

**Resultado esperado:**
```
✅ Múltiplas viagens simultâneas
✅ Performance mantida
✅ Dados isolados
✅ Sem conflitos
```

### **6.3 Cenário: Recuperação de Falhas**

**Como testar:**
1. Simular falha de rede
2. Simular falha do Redis
3. Verificar recuperação
4. Verificar consistência

**Resultado esperado:**
```
✅ Recuperação automática
✅ Dados preservados
✅ Experiência contínua
✅ Logs de erro adequados
```

---

## 📱 **Fase 7: Testes Específicos por Plataforma**

### **7.1 Android**

**Testes específicos:**
- [ ] Permissões Android
- [ ] Background location
- [ ] Notificações
- [ ] Integração com Google Services

### **7.2 iOS**

**Testes específicos:**
- [ ] Permissões iOS
- [ ] Background app refresh
- [ ] Push notifications
- [ ] Integração com Apple Services

---

## 🔍 **Fase 8: Debugging e Logs**

### **8.1 Logs Importantes**

**Logs para monitorar:**
```javascript
// Logs de localização
[Redis] Location update
[Redis] Location saved
[Redis] Nearby search

// Logs de tracking
[Redis] Trip started
[Redis] Location updated
[Redis] Trip ended

// Logs de erro
[Redis] Connection error
[Redis] Fallback to Firebase
[Redis] Recovery successful
```

### **8.2 Ferramentas de Debug**

**Ferramentas úteis:**
- [ ] React Native Debugger
- [ ] Flipper
- [ ] Chrome DevTools
- [ ] Logs do Metro bundler

---

## 📋 **Checklist Final Mobile**

### **Funcionalidade**
- [ ] Login funciona
- [ ] Localização capturada
- [ ] Busca de motoristas funciona
- [ ] Tracking funciona
- [ ] Histórico funciona

### **Performance**
- [ ] App responsivo
- [ ] Bateria otimizada
- [ ] Memória estável
- [ ] Rede eficiente

### **Confiabilidade**
- [ ] Fallback funciona
- [ ] Recuperação automática
- [ ] Dados consistentes
- [ ] Logs adequados

### **Experiência**
- [ ] UI/UX fluida
- [ ] Feedback visual
- [ ] Tratamento de erros
- [ ] Acessibilidade

---

## 🎯 **Comandos de Teste Rápido**

```bash
# 1. Iniciar tudo
quick-start-redis.bat
cd mobile-app && npm start

# 2. Verificar logs
docker-compose logs -f redis

# 3. Testar APIs
curl -X GET "http://localhost:5001/your-project/us-central1/get_redis_stats"

# 4. Monitorar performance
node test-load.js
```

---

## ✅ **Critérios de Sucesso Mobile**

### **Funcionalidade**
- ✅ Todas as features funcionam
- ✅ Localização precisa
- ✅ Tracking em tempo real
- ✅ Histórico completo

### **Performance**
- ✅ App responsivo
- ✅ Bateria otimizada
- ✅ Memória estável
- ✅ Rede eficiente

### **Confiabilidade**
- ✅ Fallback funciona
- ✅ Recuperação automática
- ✅ Dados consistentes
- ✅ Logs adequados

### **Experiência**
- ✅ UI/UX fluida
- ✅ Feedback visual
- ✅ Tratamento de erros
- ✅ Acessibilidade

**Se todos os testes passarem, o app está pronto para produção!** 🚀

---

## 📞 **Suporte e Troubleshooting**

### **Problemas Comuns**

**1. Localização não funciona:**
- Verificar permissões
- Verificar GPS ativo
- Verificar configurações do app

**2. Tracking não atualiza:**
- Verificar conexão Redis
- Verificar logs de erro
- Verificar configuração de intervalo

**3. App lento:**
- Verificar uso de memória
- Verificar otimizações
- Verificar logs de performance

### **Contatos**
- Logs: Console do React Native
- Redis: `docker-compose logs redis`
- Firebase: `firebase functions:log`
- Performance: `node test-load.js` 