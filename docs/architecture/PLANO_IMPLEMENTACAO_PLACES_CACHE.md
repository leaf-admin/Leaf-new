# 📋 Plano de Implementação: Places Cache (Incremental e Seguro)

## 🎯 Objetivo
Implementar cache de Places **sem quebrar nada** que já existe, seguindo o padrão exato do projeto.

---

## ✅ Fase 0: Preparação e Análise (ANTES DE COMEÇAR)

### Checklist de Segurança
- [x] Analisar padrão de serviços existentes
- [x] Analisar padrão de rotas existentes
- [x] Verificar uso de Redis
- [x] Verificar uso de Firebase/PostgreSQL
- [ ] **Criar branch separada** (recomendado)
- [ ] **Backup do código atual**

---

## 📦 Fase 1: Estrutura Base (SEM INTEGRAÇÃO)

### 1.1 Criar Utilitário de Normalização
**Arquivo:** `leaf-websocket-backend/utils/places-normalizer.js`
- Função simples para normalizar queries
- **Testável isoladamente**
- **Não afeta nada existente**

### 1.2 Criar Serviço de Places Cache
**Arquivo:** `leaf-websocket-backend/services/places-cache-service.js`
- Seguir padrão de `metrics-service.js`
- Usar `redisPool.getConnection()`
- Usar `logger` do utils
- **Não inicializar automaticamente**
- **Métodos privados para testes**

### 1.3 Criar Rota de Places
**Arquivo:** `leaf-websocket-backend/routes/places-routes.js`
- Seguir padrão de `routes/metrics.js`
- Endpoint `/api/places/search`
- **Tratamento de erros robusto**
- **Fallback para não quebrar**

### 1.4 Testes Unitários
- Testar normalização
- Testar cache Redis
- Testar fallback Google Places
- **Tudo isolado, sem afetar sistema**

---

## 🔌 Fase 2: Integração Gradual (COM FALLBACK)

### 2.1 Adicionar Rota no server.js
- Adicionar **DEPOIS** das rotas existentes
- **Com try/catch** para não quebrar se falhar
- **Logs claros** para debug

### 2.2 Testar Endpoint Isoladamente
- Testar com Postman/curl
- Verificar logs
- Verificar Redis
- **Não modificar mobile ainda**

### 2.3 Adicionar Feature Flag
- Variável de ambiente `ENABLE_PLACES_CACHE=true/false`
- **Permite desabilitar sem remover código**
- **Segurança extra**

---

## 📱 Fase 3: Integração Mobile (COM FALLBACK DUPLO)

### 3.1 Modificar GoogleAPIFunctions.js
- **Tentar backend primeiro**
- **Se falhar, usar Google direto** (como está hoje)
- **Zero breaking changes**

### 3.2 Testar no App
- Testar busca normal
- Testar com backend offline
- Testar com cache vazio
- **Garantir que sempre funciona**

---

## 🗄️ Fase 4: Persistência (OPCIONAL - DEPOIS)

### 4.1 Criar Tabela PostgreSQL
- **Script separado** para migration
- **Não obrigatório** para funcionar
- **Pode adicionar depois**

### 4.2 Integrar PostgreSQL
- **Apenas se cache funcionar bem**
- **Fallback se PostgreSQL falhar**

---

## 🛡️ Princípios de Segurança

### 1. **Nunca Quebrar o Fluxo Atual**
```javascript
// ✅ SEMPRE ter fallback
try {
  const cached = await placesCache.search(query);
  if (cached) return cached;
} catch (error) {
  console.warn('Cache falhou, usando Google direto');
}
// Fallback para Google direto (código atual)
```

### 2. **Feature Flag**
```javascript
// ✅ Permitir desabilitar facilmente
if (process.env.ENABLE_PLACES_CACHE !== 'true') {
  // Usar Google direto
}
```

### 3. **Logs Claros**
```javascript
// ✅ Sempre logar o que está acontecendo
console.log('🔍 [PlacesCache] Buscando:', query);
console.log('✅ [PlacesCache] Cache HIT');
console.log('❌ [PlacesCache] Cache MISS, usando Google');
```

### 4. **Tratamento de Erros Robusto**
```javascript
// ✅ Nunca deixar erro propagar
try {
  // código
} catch (error) {
  logger.error('Erro no Places Cache:', error);
  // Retornar erro controlado ou fallback
}
```

### 5. **Testes Antes de Integrar**
- Testar cada arquivo isoladamente
- Testar endpoint antes de integrar no mobile
- Testar mobile antes de fazer deploy

---

## 📝 Checklist de Implementação

### Fase 1: Estrutura Base
- [ ] Criar `utils/places-normalizer.js`
- [ ] Criar `services/places-cache-service.js`
- [ ] Criar `routes/places-routes.js`
- [ ] Testar cada arquivo isoladamente

### Fase 2: Integração Backend
- [ ] Adicionar rota no `server.js` (com try/catch)
- [ ] Adicionar feature flag `ENABLE_PLACES_CACHE`
- [ ] Testar endpoint `/api/places/search`
- [ ] Verificar logs e Redis

### Fase 3: Integração Mobile
- [ ] Modificar `GoogleAPIFunctions.js` (com fallback)
- [ ] Testar no app (busca normal)
- [ ] Testar com backend offline
- [ ] Testar com cache vazio

### Fase 4: Persistência (Opcional)
- [ ] Criar script de migration PostgreSQL
- [ ] Integrar PostgreSQL no serviço
- [ ] Testar persistência

---

## 🚨 Pontos de Atenção

### ⚠️ **NUNCA Fazer:**
- ❌ Remover código existente
- ❌ Modificar serviços existentes sem necessidade
- ❌ Fazer deploy sem testar
- ❌ Remover fallback para Google direto

### ✅ **SEMPRE Fazer:**
- ✅ Manter fallback para Google direto
- ✅ Testar cada etapa isoladamente
- ✅ Usar feature flag
- ✅ Logs claros
- ✅ Tratamento de erros robusto

---

## 🎯 Ordem de Execução

1. **Fase 1** → Criar arquivos (sem integrar)
2. **Testar Fase 1** → Verificar que funciona isoladamente
3. **Fase 2** → Integrar no backend (com feature flag)
4. **Testar Fase 2** → Verificar endpoint
5. **Fase 3** → Integrar no mobile (com fallback)
6. **Testar Fase 3** → Verificar app funciona
7. **Fase 4** → Adicionar PostgreSQL (opcional)

**Cada fase é independente e pode ser revertida facilmente.**

---

## ✅ Pronto para Começar?

Vamos começar pela **Fase 1** - criar os arquivos base seguindo o padrão exato do projeto, **sem integrar nada ainda**.

Isso permite:
- ✅ Testar isoladamente
- ✅ Revisar código
- ✅ Ajustar antes de integrar
- ✅ Zero risco de quebrar algo

**Posso começar pela Fase 1 agora?** 🚀




