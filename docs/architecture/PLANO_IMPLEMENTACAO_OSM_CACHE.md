# 📋 Plano Detalhado de Implementação: População OSM do Cache Places

## 🎯 **OBJETIVO**
Criar script para popular cache de Places com dados do OpenStreetMap (OSM) para o Rio de Janeiro, usando como seed inicial antes dos dados do Google Places.

---

## 📊 **ESTRUTURA DO PLANO**

### **FASE 1: Preparação e Análise** (Testes Iniciais)
### **FASE 2: Criação do Script Base** (Desenvolvimento)
### **FASE 3: Testes Unitários** (Validação Individual)
### **FASE 4: Teste de Integração** (Validação com Sistema)
### **FASE 5: Otimizações** (Melhorias)
### **FASE 6: Teste Final** (Validação Completa)
### **FASE 7: Documentação** (Finalização)

---

## 🔍 **FASE 1: PREPARAÇÃO E ANÁLISE**

### ✅ **Tarefa 1.1: Verificar Dependências**
**Objetivo:** Confirmar que todas as dependências necessárias estão disponíveis

**Ações:**
- [ ] Verificar se `redis-pool` está disponível e funcionando
- [ ] Verificar se `logger` está disponível e funcionando
- [ ] Verificar se `places-normalizer` está disponível e tem `normalizeQuery()`
- [ ] Verificar se `node-fetch` ou `fetch` nativo está disponível

**Teste:**
```javascript
// Testar imports
const redisPool = require('./utils/redis-pool');
const { logger } = require('./utils/logger');
const { normalizeQuery } = require('./utils/places-normalizer');
```

**Critério de Sucesso:** Todos os imports funcionam sem erros

---

### ✅ **Tarefa 1.2: Testar Conexão Redis**
**Objetivo:** Validar que Redis está acessível e suporta operações necessárias

**Ações:**
- [ ] Testar conexão com Redis usando `redisPool.getConnection()`
- [ ] Testar `redis.setex()` com dados de exemplo
- [ ] Testar `redis.get()` para recuperar dados
- [ ] Verificar se Redis suporta operações básicas (não precisa JSON.SET)

**Teste:**
```javascript
const redis = redisPool.getConnection();
await redis.setex('test:key', 60, JSON.stringify({test: 'data'}));
const result = await redis.get('test:key');
console.log(JSON.parse(result));
```

**Critério de Sucesso:** Redis responde e salva/recupera dados corretamente

---

### ✅ **Tarefa 1.3: Testar normalizeQuery()**
**Objetivo:** Validar que normalização funciona com nomes reais do Rio

**Ações:**
- [ ] Testar com "BarraShopping" → deve retornar "barra_shopping"
- [ ] Testar com "Copacabana Beach" → deve retornar "copacabana_beach"
- [ ] Testar com "Aeroporto Galeão" → deve retornar "aeroporto_galeao"
- [ ] Testar com "Shopping Leblon" → deve retornar "shopping_leblon"
- [ ] Verificar se remove acentos corretamente

**Teste:**
```javascript
const { normalizeQuery } = require('./utils/places-normalizer');
const tests = [
  { input: "BarraShopping", expected: "barra_shopping" },
  { input: "Copacabana Beach", expected: "copacabana_beach" },
  { input: "Aeroporto Galeão", expected: "aeroporto_galeao" }
];
tests.forEach(({input, expected}) => {
  const result = normalizeQuery(input);
  console.log(`${input} → ${result} (esperado: ${expected})`);
});
```

**Critério de Sucesso:** Todos os testes retornam resultados esperados

---

### ✅ **Tarefa 1.4: Testar Overpass API**
**Objetivo:** Validar que Overpass API responde e retorna dados no formato esperado

**Ações:**
- [ ] Criar query Overpass com bbox pequeno (ex: Copacabana apenas)
- [ ] Fazer requisição para `https://overpass-api.de/api/interpreter`
- [ ] Verificar estrutura de resposta (deve ter `elements` array)
- [ ] Verificar se elementos têm `id`, `lat`, `lon`, `tags`
- [ ] Verificar timeout e tratamento de erros

**Teste:**
```javascript
// Bbox pequeno: Copacabana
const bbox = [-22.98, -43.20, -22.96, -43.18];
const query = `
[out:json][timeout:25];
(
  node["amenity"]["name"](${bbox.join(',')});
);
out center;
`;

const response = await fetch('https://overpass-api.de/api/interpreter', {
  method: 'POST',
  body: query
});
const data = await response.json();
console.log('Elementos encontrados:', data.elements.length);
console.log('Primeiro elemento:', data.elements[0]);
```

**Critério de Sucesso:** Overpass API retorna dados válidos no formato esperado

---

## 🛠️ **FASE 2: CRIAÇÃO DO SCRIPT BASE**

### ✅ **Tarefa 2.1: Criar Estrutura do Arquivo**
**Objetivo:** Criar arquivo base com imports e estrutura principal

**Localização:** `leaf-websocket-backend/scripts/populate-places-osm.js`

**Estrutura:**
```javascript
const fetch = require('node-fetch');
const redisPool = require('../utils/redis-pool');
const { logger } = require('../utils/logger');
const { normalizeQuery } = require('../utils/places-normalizer');

const redis = redisPool.getConnection();
const CACHE_TTL = 30 * 24 * 60 * 60; // 30 dias

// Bbox do Rio dividido em quadrantes
const RIO_QUADRANTS = [
  [-23.0823, -43.7958, -22.9123, -43.4474], // Sudoeste
  [-23.0823, -43.4474, -22.9123, -43.0990], // Sudeste
  [-22.9123, -43.7958, -22.7423, -43.4474], // Noroeste
  [-22.9123, -43.4474, -22.7423, -43.0990]  // Nordeste
];

// Funções serão implementadas nas próximas tarefas
```

**Critério de Sucesso:** Arquivo criado e imports funcionam

---

### ✅ **Tarefa 2.2: Implementar formatAddress()**
**Objetivo:** Criar função que formata endereço a partir de tags OSM

**Implementação:**
```javascript
function formatAddress(tags = {}) {
  const parts = [
    tags["addr:street"],
    tags["addr:housenumber"],
    tags["addr:neighborhood"] || tags["addr:suburb"],
    tags["addr:city"] || "Rio de Janeiro",
    tags["addr:state"] || "RJ",
    tags["addr:postcode"]
  ].filter(Boolean);
  
  return parts.join(", ") || tags.name || "Endereço não disponível";
}
```

**Teste:**
- [ ] Testar com tags completas
- [ ] Testar com tags parciais
- [ ] Testar com tags vazias (deve retornar fallback)

**Critério de Sucesso:** Função formata endereços corretamente em todos os cenários

---

### ✅ **Tarefa 2.3: Implementar generateOverpassQuery()**
**Objetivo:** Criar função que gera query Overpass para um bbox

**Implementação:**
```javascript
function generateOverpassQuery(bbox) {
  const [south, west, north, east] = bbox;
  return `
[out:json][timeout:60];
(
  node["amenity"]["name"](${south},${west},${north},${east});
  node["shop"]["name"](${south},${west},${north},${east});
  node["leisure"]["name"](${south},${west},${north},${east});
  node["building"~"church|hospital|mall"]["name"](${south},${west},${north},${east});
  way["amenity"]["name"](${south},${west},${north},${east});
  way["shop"]["name"](${south},${west},${north},${east});
);
out center;
`;
}
```

**Teste:**
- [ ] Testar com bbox válido
- [ ] Verificar formato da query gerada
- [ ] Validar sintaxe Overpass

**Critério de Sucesso:** Query gerada é válida e retorna resultados

---

### ✅ **Tarefa 2.4: Implementar fetchOSMData()**
**Objetivo:** Criar função que busca dados do Overpass API

**Implementação:**
```javascript
async function fetchOSMData(bbox) {
  const url = "https://overpass-api.de/api/interpreter";
  const query = generateOverpassQuery(bbox);
  
  try {
    logger.info(`🔍 Buscando dados OSM para bbox: ${bbox.join(',')}`);
    const res = await fetch(url, {
      method: "POST",
      headers: { 'Content-Type': 'text/plain' },
      body: query,
    });

    if (!res.ok) {
      throw new Error(`HTTP ${res.status}: ${res.statusText}`);
    }

    const json = await res.json();
    return json.elements || [];
  } catch (error) {
    logger.error(`❌ Erro ao buscar OSM: ${error.message}`);
    return [];
  }
}
```

**Teste:**
- [ ] Testar com bbox válido
- [ ] Testar tratamento de erro (bbox inválido)
- [ ] Testar timeout

**Critério de Sucesso:** Função busca dados e trata erros corretamente

---

### ✅ **Tarefa 2.5: Implementar saveToRedis()**
**Objetivo:** Criar função que salva lugar no Redis usando formato do projeto

**Implementação:**
```javascript
async function saveToRedis(place) {
  try {
    if (!place.tags?.name) {
      return false;
    }

    const name = place.tags.name.trim();
    if (name.length < 3) {
      return false;
    }

    const alias = normalizeQuery(name);
    if (!alias || alias.length < 3) {
      logger.warn(`⚠️ Alias inválido para: ${name}`);
      return false;
    }

    // Verificar se já existe (não sobrescrever dados do Google)
    const existing = await redis.get(`place:${alias}`);
    if (existing) {
      const existingData = JSON.parse(existing);
      if (existingData.source === 'google' || existingData.place_id?.startsWith('ChIJ')) {
        logger.debug(`⏭️ Place já existe (Google): ${alias}`);
        return false;
      }
    }

    const lat = place.lat || place.center?.lat;
    const lng = place.lon || place.center?.lon;

    if (!lat || !lng) {
      logger.warn(`⚠️ Place sem coordenadas: ${name}`);
      return false;
    }

    const payload = {
      alias,
      query: name,
      place_id: `osm_${place.id}`,
      name: name,
      address: formatAddress(place.tags),
      lat: parseFloat(lat),
      lng: parseFloat(lng),
      cached_at: new Date().toISOString(),
      source: 'osm',
      category: Object.keys(place.tags).find(k => k !== 'name') || null
    };

    await redis.setex(`place:${alias}`, CACHE_TTL, JSON.stringify(payload));
    logger.info(`✅ Place salvo: ${alias} (${name})`);
    
    return true;
  } catch (error) {
    logger.error(`❌ Erro ao salvar place ${place.id}: ${error.message}`);
    return false;
  }
}
```

**Teste:**
- [ ] Testar com place válido
- [ ] Testar com place sem nome
- [ ] Testar com place sem coordenadas
- [ ] Testar validação de não sobrescrever Google

**Critério de Sucesso:** Função salva dados corretamente e respeita prioridade do Google

---

### ✅ **Tarefa 2.6: Implementar processQuadrant()**
**Objetivo:** Criar função que processa um quadrante completo

**Implementação:**
```javascript
async function processQuadrant(bbox, quadrantNum) {
  logger.info(`\n📍 Processando quadrante ${quadrantNum}/4: ${bbox.join(',')}`);
  
  const places = await fetchOSMData(bbox);
  logger.info(`📊 Encontrados ${places.length} lugares no quadrante ${quadrantNum}`);

  let saved = 0;
  let skipped = 0;
  let errors = 0;

  for (const place of places) {
    const result = await saveToRedis(place);
    if (result) {
      saved++;
    } else if (place.tags?.name) {
      skipped++;
    } else {
      errors++;
    }

    // Log progresso a cada 100 lugares
    if ((saved + skipped + errors) % 100 === 0) {
      logger.info(`⏳ Progresso: ${saved} salvos, ${skipped} ignorados, ${errors} erros`);
    }
  }

  logger.info(`✅ Quadrante ${quadrantNum} concluído: ${saved} salvos, ${skipped} ignorados, ${errors} erros`);
  
  return { saved, skipped, errors };
}
```

**Teste:**
- [ ] Testar com bbox pequeno
- [ ] Verificar contadores
- [ ] Verificar logging

**Critério de Sucesso:** Função processa quadrante e retorna estatísticas corretas

---

### ✅ **Tarefa 2.7: Implementar main()**
**Objetivo:** Criar função principal que executa script completo

**Implementação:**
```javascript
async function main() {
  logger.info('🚀 Iniciando população do cache Places com dados OSM');
  logger.info(`📦 TTL do cache: ${CACHE_TTL / 86400} dias`);

  let totalSaved = 0;
  let totalSkipped = 0;
  let totalErrors = 0;

  for (let i = 0; i < RIO_QUADRANTS.length; i++) {
    const result = await processQuadrant(RIO_QUADRANTS[i], i + 1);
    totalSaved += result.saved;
    totalSkipped += result.skipped;
    totalErrors += result.errors;

    // Aguardar entre quadrantes
    if (i < RIO_QUADRANTS.length - 1) {
      logger.info('⏳ Aguardando 5 segundos antes do próximo quadrante...');
      await new Promise(resolve => setTimeout(resolve, 5000));
    }
  }

  logger.info('\n🎉 População concluída!');
  logger.info(`📊 Estatísticas finais:`);
  logger.info(`   ✅ Salvos: ${totalSaved}`);
  logger.info(`   ⏭️ Ignorados: ${totalSkipped}`);
  logger.info(`   ❌ Erros: ${totalErrors}`);
  logger.info(`   📦 Total processado: ${totalSaved + totalSkipped + totalErrors}`);
}

// Executar
if (require.main === module) {
  main().catch(error => {
    logger.error(`❌ Erro fatal: ${error.message}`);
    process.exit(1);
  });
}

module.exports = { main, saveToRedis, fetchOSMData, formatAddress };
```

**Teste:**
- [ ] Testar execução completa
- [ ] Verificar estatísticas finais
- [ ] Verificar tratamento de erros

**Critério de Sucesso:** Script executa completamente e gera estatísticas corretas

---

## 🧪 **FASE 3: TESTES UNITÁRIOS**

### ✅ **Tarefa 3.1: Testar formatAddress()**
**Ações:**
- [ ] Testar com tags completas
- [ ] Testar com tags parciais (sem número, sem CEP)
- [ ] Testar com tags vazias
- [ ] Verificar formatação correta

**Critério de Sucesso:** Todos os cenários retornam endereços formatados corretamente

---

### ✅ **Tarefa 3.2: Testar normalizeQuery()**
**Ações:**
- [ ] Testar com nomes reais do Rio
- [ ] Testar com acentos
- [ ] Testar com caracteres especiais
- [ ] Verificar consistência

**Critério de Sucesso:** Normalização funciona para todos os casos de teste

---

### ✅ **Tarefa 3.3: Testar fetchOSMData()**
**Ações:**
- [ ] Testar com bbox válido
- [ ] Testar com bbox inválido
- [ ] Testar timeout
- [ ] Verificar estrutura de resposta

**Critério de Sucesso:** Função busca dados e trata erros corretamente

---

### ✅ **Tarefa 3.4: Testar saveToRedis()**
**Ações:**
- [ ] Testar com place válido
- [ ] Testar com place sem nome
- [ ] Testar com place sem coordenadas
- [ ] Testar validação de Google (não sobrescrever)

**Critério de Sucesso:** Função salva dados e valida corretamente

---

### ✅ **Tarefa 3.5: Testar Validação Google**
**Ações:**
- [ ] Criar place no Redis com `source: 'google'`
- [ ] Tentar salvar mesmo lugar do OSM
- [ ] Verificar que não sobrescreve
- [ ] Testar com `place_id` começando com `ChIJ`

**Critério de Sucesso:** Dados do Google nunca são sobrescritos

---

## 🔗 **FASE 4: TESTE DE INTEGRAÇÃO**

### ✅ **Tarefa 4.1: Executar Script com Bbox Pequeno**
**Ações:**
- [ ] Criar bbox pequeno (ex: Copacabana)
- [ ] Executar script
- [ ] Verificar dados salvos no Redis
- [ ] Validar estrutura dos dados

**Critério de Sucesso:** Dados são salvos corretamente no Redis

---

### ✅ **Tarefa 4.2: Testar Compatibilidade com places-cache-service**
**Ações:**
- [ ] Buscar lugar salvo pelo OSM usando `placesCacheService.searchPlace()`
- [ ] Verificar se retorna dados corretos
- [ ] Verificar formato de resposta

**Critério de Sucesso:** Dados OSM são compatíveis com serviço existente

---

### ✅ **Tarefa 4.3: Testar Endpoint /api/places/search**
**Ações:**
- [ ] Buscar lugar do OSM via endpoint
- [ ] Verificar resposta JSON
- [ ] Verificar se `source: 'osm'` está presente

**Critério de Sucesso:** Endpoint retorna dados OSM corretamente

---

### ✅ **Tarefa 4.4: Testar Prioridade Google**
**Ações:**
- [ ] Salvar lugar do Google no cache
- [ ] Tentar salvar mesmo lugar do OSM
- [ ] Verificar que Google tem prioridade
- [ ] Buscar via endpoint e verificar que retorna dados do Google

**Critério de Sucesso:** Dados do Google sempre têm prioridade

---

## ⚡ **FASE 5: OTIMIZAÇÕES**

### ✅ **Tarefa 5.1: Adicionar Logging Detalhado**
**Ações:**
- [ ] Adicionar logs de início/fim de cada quadrante
- [ ] Adicionar contador de progresso
- [ ] Adicionar logs de erros específicos
- [ ] Adicionar tempo de execução

**Critério de Sucesso:** Logs fornecem informações úteis para debug

---

### ✅ **Tarefa 5.2: Adicionar Progress Bar**
**Ações:**
- [ ] Instalar biblioteca de progress (ou criar simples)
- [ ] Mostrar progresso por quadrante
- [ ] Mostrar progresso geral

**Critério de Sucesso:** Progresso é visível durante execução

---

### ✅ **Tarefa 5.3: Adicionar Delay Entre Quadrantes**
**Ações:**
- [ ] Adicionar delay de 5 segundos entre quadrantes
- [ ] Adicionar delay configurável
- [ ] Documentar motivo do delay

**Critério de Sucesso:** Delay previne sobrecarga da API

---

### ✅ **Tarefa 5.4: Adicionar Retry Logic**
**Ações:**
- [ ] Implementar retry para requisições que falharem
- [ ] Máximo de 3 tentativas
- [ ] Backoff exponencial

**Critério de Sucesso:** Requisições falhas são retentadas automaticamente

---

## 🎯 **FASE 6: TESTE FINAL**

### ✅ **Tarefa 6.1: Executar Script Completo**
**Ações:**
- [ ] Executar script com todos os 4 quadrantes
- [ ] Monitorar execução
- [ ] Verificar se completa sem erros fatais

**Critério de Sucesso:** Script executa completamente

---

### ✅ **Tarefa 6.2: Verificar Estatísticas Finais**
**Ações:**
- [ ] Verificar total de lugares salvos
- [ ] Verificar total ignorados
- [ ] Verificar total de erros
- [ ] Validar números fazem sentido

**Critério de Sucesso:** Estatísticas são coerentes

---

### ✅ **Tarefa 6.3: Testar Hit Rate**
**Ações:**
- [ ] Buscar lugares conhecidos do Rio (BarraShopping, Copacabana, etc)
- [ ] Verificar se encontram no cache
- [ ] Calcular hit rate aproximado

**Critério de Sucesso:** Hit rate é razoável (>50%)

---

### ✅ **Tarefa 6.4: Verificar Funcionalidade Existente**
**Ações:**
- [ ] Testar busca de lugares do Google (não devem ser afetados)
- [ ] Testar salvamento de novos lugares do Google
- [ ] Verificar que sistema continua funcionando normalmente

**Critério de Sucesso:** Funcionalidade existente não foi quebrada

---

## 📚 **FASE 7: DOCUMENTAÇÃO**

### ✅ **Tarefa 7.1: Criar README.md**
**Ações:**
- [ ] Documentar como executar script
- [ ] Documentar pré-requisitos
- [ ] Documentar parâmetros configuráveis
- [ ] Documentar saída esperada

**Critério de Sucesso:** README é claro e completo

---

### ✅ **Tarefa 7.2: Documentar Estrutura de Dados**
**Ações:**
- [ ] Documentar diferença entre dados OSM e Google
- [ ] Documentar campo `source`
- [ ] Documentar campo `place_id` (osm_ vs ChIJ)
- [ ] Documentar prioridade de dados

**Critério de Sucesso:** Estrutura de dados está clara

---

### ✅ **Tarefa 7.3: Criar Guia de Manutenção**
**Ações:**
- [ ] Documentar quando re-executar script
- [ ] Documentar como atualizar bbox
- [ ] Documentar como adicionar novos tipos de lugares
- [ ] Documentar troubleshooting

**Critério de Sucesso:** Guia de manutenção é útil

---

## ⚠️ **AVISOS IMPORTANTES**

### 🛑 **ANTES DE COMEÇAR:**
1. ✅ Backup do Redis (se houver dados importantes)
2. ✅ Testar em ambiente de desenvolvimento primeiro
3. ✅ Verificar espaço em disco (pode gerar muitos dados)
4. ✅ Verificar conexão com Overpass API estável

### 🛑 **DURANTE IMPLEMENTAÇÃO:**
1. ✅ Testar cada função isoladamente antes de integrar
2. ✅ Não sobrescrever dados do Google
3. ✅ Validar dados antes de salvar
4. ✅ Tratar todos os erros possíveis

### 🛑 **APÓS IMPLEMENTAÇÃO:**
1. ✅ Monitorar hit rate do cache
2. ✅ Verificar se não quebrou funcionalidade existente
3. ✅ Documentar resultados e estatísticas
4. ✅ Planejar re-execução periódica

---

## 📊 **CRITÉRIOS DE SUCESSO FINAL**

### ✅ **Script Funciona:**
- [ ] Executa sem erros fatais
- [ ] Popula cache com dados válidos
- [ ] Respeita prioridade do Google
- [ ] Gera estatísticas corretas

### ✅ **Integração Funciona:**
- [ ] Dados OSM são compatíveis com sistema existente
- [ ] Endpoint `/api/places/search` funciona com dados OSM
- [ ] Não quebra funcionalidade existente

### ✅ **Qualidade:**
- [ ] Hit rate inicial > 50%
- [ ] Dados são válidos e úteis
- [ ] Logging é informativo
- [ ] Documentação está completa

---

## 🚀 **PRÓXIMOS PASSOS**

**AGUARDANDO AUTORIZAÇÃO PARA COMEÇAR**

Após sua autorização, começarei pela **FASE 1: Preparação e Análise**, testando cada etapa antes de prosseguir.

**Posso começar?** 🎯






