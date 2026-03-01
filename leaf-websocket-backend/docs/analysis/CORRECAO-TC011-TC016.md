# 🔧 Correção TC-011 e TC-016

## 🔍 Problema Identificado

Os testes TC-011 e TC-016 estavam falhando com o erro:
- **TC-011**: "Primeira corrida não foi notificada"
- **TC-016**: "Motorista não recebeu primeira corrida"

### Causa Raiz

O problema estava no **MockSocketIO** dos testes. Quando o `DriverNotificationDispatcher` tenta notificar um motorista, ele verifica se o motorista está conectado usando:

```javascript
const sockets = await this.io.in(`driver_${driverId}`).fetchSockets();
```

O `MockSocketIO.in().fetchSockets()` retorna sockets apenas se o motorista estiver no `connectedDrivers` Set. Porém, nos testes TC-011 e TC-016, os motoristas **não estavam sendo adicionados** ao `mockIO.connectedDrivers` antes de iniciar a busca gradual.

### Fluxo do Problema

1. Teste cria motorista via `setupTestDrivers()`
2. Teste inicia busca gradual com `startGradualSearch()`
3. `GradualRadiusExpander` encontra motorista e tenta notificar
4. `DriverNotificationDispatcher.notifyDriver()` verifica se motorista está conectado
5. `MockSocketIO.in().fetchSockets()` retorna array vazio (motorista não está em `connectedDrivers`)
6. Notificação falha: "Driver não está conectado"
7. Teste falha: "Primeira corrida não foi notificada"

---

## ✅ Solução

Adicionar o motorista ao `mockIO.connectedDrivers` **antes** de iniciar a busca gradual.

### Correção Aplicada

**TC-011 (`testTimingRejectionNewRide`):**
```javascript
// 1. Setup: Criar motorista
const drivers = await setupTestDrivers(redis, 1);
drivers.forEach(d => driverIds.push(d.id));
const driverId = driverIds[0];

// ✅ CORREÇÃO: Adicionar motorista ao mockIO.connectedDrivers ANTES de iniciar busca
mockIO.connectedDrivers.add(driverId);

// 2. Criar 2 corridas
// ...
```

**TC-016 (`testDriverRejectsAndGetsOldestRide`):**
```javascript
// 1. Setup: Criar motorista
const drivers = await setupTestDrivers(redis, 1);
drivers.forEach(d => driverIds.push(d.id));
const driverId = driverIds[0];

// ✅ CORREÇÃO: Adicionar motorista ao mockIO.connectedDrivers ANTES de iniciar busca
mockIO.connectedDrivers.add(driverId);

// 2. Criar 3 corridas com timestamps diferentes
// ...
```

---

## 📊 Resultado Esperado

Após a correção:
- ✅ Motorista é adicionado ao `connectedDrivers` antes da busca
- ✅ `fetchSockets()` retorna socket simulado
- ✅ Notificação é enviada com sucesso
- ✅ Testes TC-011 e TC-016 devem passar

---

## 🔍 Diagnóstico Realizado

Foi criado um script de diagnóstico (`test-diagnostico-tc011-tc016.js`) que:
1. Testa TC-011 isoladamente
2. Testa TC-016 isoladamente
3. Mostra logs detalhados de cada etapa
4. Identifica onde a notificação está falhando

O diagnóstico confirmou que o problema era a falta do motorista no `connectedDrivers`.

---

## 📝 Notas

- O `MockSocketIO.in().fetchSockets()` adiciona automaticamente o motorista ao `connectedDrivers` quando chamado, mas isso acontece **depois** que a verificação já falhou
- A solução é garantir que o motorista esteja no `connectedDrivers` **antes** de iniciar qualquer busca
- Outros testes (como TC-010) já faziam isso corretamente, por isso passavam

---

## ✅ Status

- ✅ Correção aplicada
- ⏳ Aguardando re-execução dos testes para confirmação


