# Testes e Scripts - Leaf Backend

Este diretório contém todos os testes automatizados, scripts de carga, integração, autenticação, WebSocket, Firebase, mobile, além de utilitários e scripts de setup para o backend Leaf.

## Índice de Pastas

- [redis/](./redis) — Testes e scripts focados em Redis (API, carga, integração, diagnóstico)
- [load/](./load) — Testes de carga e performance
- [integration/](./integration) — Testes de integração, arquitetura, consistência e cenários completos
- [websocket/](./websocket) — Testes de WebSocket e comunicação em tempo real
- [auth/](./auth) — Testes de autenticação e fluxo de login
- [firebase/](./firebase) — Testes de permissões, integração e consistência com Firebase
- [mobile/](./mobile) — Testes e scripts voltados para o app mobile
- [scripts/](./scripts) — Scripts utilitários e de diagnóstico
- [setup/](./setup) — Scripts de configuração e inicialização

---

## Exemplos de Arquivos em Cada Categoria

### redis/
- test-redis-api.bat, test-redis-api.cjs, test-redis-quick.bat, test-redis-load.cjs, test-redis-imports.cjs, diagnose-redis.bat, run-all-redis-tests.bat, redis-manager.bat, test-redis-apis.js, test-redis.cjs, start-redis.bat, test-redis.mjs

### load/
- test-50-drivers-simultaneous.cjs, test-concurrent-connection-optimized.cjs, test-load-performance.cjs, test-quick-load.bat, test-quick-load.cjs, test-load-performance.bat, test-load.js

### integration/
- test-monitoring-system.cjs, test-backend-with-retry.cjs, test-failure-analysis.cjs, test-finish-trip-fix.cjs, test-realtime-sync.bat, test-realtime-sync.cjs, test-correct-architecture.cjs, test-correct-architecture.bat, test-location-sync.bat, test-location-sync-real.cjs, test-leaf-production.cjs, test-leaf-production.bat, test-realistic-integration.bat, test-realistic-integration.cjs, test-config-realistic.cjs, test-driver-integration-realistic.cjs, test-basic.bat, test-basic.js, test-architecture.js, test-nearby-drivers.js, test-config-only.mjs, test-basic.mjs, test-simple.cjs, test-hybrid-strategy.cjs, test-complete-integration.cjs, test-location-actions.cjs, test-dual-write-simple.mjs, test-imports.mjs, test-simple.mjs, test-dual-write.mjs

### websocket/
- test-websocket-only.bat, test-websocket-only.cjs, test-websocket-simple.cjs, test-server.js

### auth/
- test-auth-email.bat, test-auth-email.cjs, test-simple-auth.bat, test-simple-auth.cjs

### firebase/
- test-firebase-permissions.cjs, test-firebase-project.js, test-firebase-only.js, test-firestore.mjs

### mobile/
- test-driver-system-realistic.bat, test-all-mobile.bat, test-metro-config.cjs, test-mobile-build.bat, test-mobile-build.ps1, test-mobile-build.cjs

### scripts/
- check-status.ps1, fix-backend-step1.ps1, commit-redis-implementation.bat

### setup/
- quick-start-redis.bat, setup-redis-docker.ps1, setup-redis.ps1

---

## Como Executar

Cada subpasta contém um README ou instruções nos próprios arquivos de script. Para a maioria dos testes, basta rodar o script correspondente via terminal (Windows ou Node.js).

**Exemplo:**
```bash
cd tests/redis
./test-redis-quick.bat 100
```

---

## Observações

- Os testes de carga podem exigir muitos recursos do sistema.
- Sempre verifique as dependências e pré-requisitos de cada script.
- Para integração contínua, utilize os scripts de integração e carga.
- Scripts utilitários e de setup ajudam a preparar o ambiente para os testes.

---

## Histórico

Este README foi atualizado para refletir a nova organização dos testes e scripts, facilitando a navegação e manutenção do projeto. 
# Linux/Mac
node test-basic.js
```
**O que faz**: Verifica se o servidor está funcionando e testa autenticação + atualização de localização básica.

### 2. Teste Rápido de Carga
```bash
# Windows
test-redis-quick.bat [numero_de_drivers]

# Exemplos:
test-redis-quick.bat 100   # 100 drivers
test-redis-quick.bat 500   # 500 drivers
test-redis-quick.bat 1000  # 1000 drivers
```

### 3. Teste Completo com Menu
```bash
# Windows
test-all-mobile.bat
```
**O que faz**: Menu interativo para escolher diferentes níveis de teste.

### 4. Teste Direto via Node.js
```bash
# Linux/Mac/Windows
node test-redis-load.cjs [numero_de_drivers]
```

## Níveis de Teste Recomendados

| Nível | Drivers | Descrição | Tempo Estimado |
|-------|---------|-----------|----------------|
| Leve | 100 | Teste básico de funcionalidade | 2-3 minutos |
| Médio | 500 | Teste de performance moderada | 5-7 minutos |
| Pesado | 1000 | Teste de carga real | 8-12 minutos |
| Muito Pesado | 2500 | Teste de stress | 15-20 minutos |

## Como Funciona o Teste

### Fase 1: Conexão e Autenticação
- Conecta todos os drivers simulados ao servidor
- Aguarda autenticação de cada driver
- **IMPORTANTE**: As atualizações de localização só começam quando TODOS os drivers estiverem conectados e autenticados

### Fase 2: Atualizações de Localização
- Cada driver envia sua localização a cada 1 segundo
- Coordenadas aleatórias dentro de São Paulo
- Medição de latência e taxa de sucesso

### Fase 3: Estatísticas
- Latência média, mínima, máxima e 95º percentil
- Taxa de sucesso das atualizações
- Número de drivers conectados vs. esperado

## Exemplo de Saída

```
🚗 Iniciando teste de carga com 1000 motoristas
📡 Conectando ao servidor: http://localhost:3001
🔄 Iniciando simulação de 1000 motoristas...
⏳ Aguardando todos os motoristas se conectarem e autenticarem...

🔌 Driver 1 conectado (1/1000)
🔌 Driver 2 conectado (2/1000)
...
🔐 Driver 1 autenticado (1/1000)
🔐 Driver 2 autenticado (2/1000)
...

🎉 TODOS OS 1000 MOTORISTAS CONECTADOS E AUTENTICADOS!
🚀 Iniciando atualizações de localização...

✅ Driver 1: localização atualizada
✅ Driver 2: localização atualizada
...

📊 Estatísticas de Latência:
   Média: 45.23ms
   Mínima: 12ms
   Máxima: 234ms
   95º percentil: 89ms
   Sucessos: 2847
   Falhas: 3
   Taxa de sucesso: 99.89%
   Drivers conectados: 1000/1000
   Drivers autenticados: 1000/1000
```

## Troubleshooting

### Erro: "Servidor não respondeu"
- Verifique se o servidor Redis está rodando em `localhost:3001`
- Execute `test-basic.bat` primeiro para verificar conectividade

### Erro: "Timeout"
- O servidor pode estar sobrecarregado
- Reduza o número de drivers no teste
- Verifique os logs do servidor

### Performance Ruim
- Verifique se o Redis está configurado corretamente
- Monitore o uso de CPU e memória
- Considere ajustar as configurações do servidor

## Configurações Avançadas

### Modificar Intervalo de Atualização
No arquivo `test-redis-load.cjs`, altere:
```javascript
const UPDATE_INTERVAL = 1000; // 1 segundo entre atualizações
```

### Modificar Duração do Teste
No arquivo `test-redis-load.cjs`, altere:
```javascript
}, 60000); // 60 segundos de teste após todos estarem prontos
```

### Modificar Coordenadas
No arquivo `test-redis-load.cjs`, altere:
```javascript
const baseLat = -23.5505; // Latitude de São Paulo
const baseLng = -46.6333; // Longitude de São Paulo
const radius = 0.01;      // Raio em graus (~1km)
```

## Próximos Passos

1. Execute `test-basic.bat` para verificar conectividade
2. Execute `test-redis-quick.bat 100` para teste leve
3. Execute `test-all-mobile.bat` para menu completo
4. Monitore os logs do servidor durante os testes
5. Analise as estatísticas para otimizações 
   Média: 45.23ms
   Mínima: 12ms
   Máxima: 234ms
   95º percentil: 89ms
   Sucessos: 2847
   Falhas: 3
   Taxa de sucesso: 99.89%
   Drivers conectados: 1000/1000
   Drivers autenticados: 1000/1000
```

## Troubleshooting

### Erro: "Servidor não respondeu"
- Verifique se o servidor Redis está rodando em `localhost:3001`
- Execute `test-basic.bat` primeiro para verificar conectividade

### Erro: "Timeout"
- O servidor pode estar sobrecarregado
- Reduza o número de drivers no teste
- Verifique os logs do servidor

### Performance Ruim
- Verifique se o Redis está configurado corretamente
- Monitore o uso de CPU e memória
- Considere ajustar as configurações do servidor

## Configurações Avançadas

### Modificar Intervalo de Atualização
No arquivo `test-redis-load.cjs`, altere:
```javascript
const UPDATE_INTERVAL = 1000; // 1 segundo entre atualizações
```

### Modificar Duração do Teste
No arquivo `test-redis-load.cjs`, altere:
```javascript
}, 60000); // 60 segundos de teste após todos estarem prontos
```

### Modificar Coordenadas
No arquivo `test-redis-load.cjs`, altere:
```javascript
const baseLat = -23.5505; // Latitude de São Paulo
const baseLng = -46.6333; // Longitude de São Paulo
const radius = 0.01;      // Raio em graus (~1km)
```

## Próximos Passos

1. Execute `test-basic.bat` para verificar conectividade
2. Execute `test-redis-quick.bat 100` para teste leve
3. Execute `test-all-mobile.bat` para menu completo
4. Monitore os logs do servidor durante os testes
5. Analise as estatísticas para otimizações 
   Média: 45.23ms
   Mínima: 12ms
   Máxima: 234ms
   95º percentil: 89ms
   Sucessos: 2847
   Falhas: 3
   Taxa de sucesso: 99.89%
   Drivers conectados: 1000/1000
   Drivers autenticados: 1000/1000
```

## Troubleshooting

### Erro: "Servidor não respondeu"
- Verifique se o servidor Redis está rodando em `localhost:3001`
- Execute `test-basic.bat` primeiro para verificar conectividade

### Erro: "Timeout"
- O servidor pode estar sobrecarregado
- Reduza o número de drivers no teste
- Verifique os logs do servidor

### Performance Ruim
- Verifique se o Redis está configurado corretamente
- Monitore o uso de CPU e memória
- Considere ajustar as configurações do servidor

## Configurações Avançadas

### Modificar Intervalo de Atualização
No arquivo `test-redis-load.cjs`, altere:
```javascript
const UPDATE_INTERVAL = 1000; // 1 segundo entre atualizações
```

### Modificar Duração do Teste
No arquivo `test-redis-load.cjs`, altere:
```javascript
}, 60000); // 60 segundos de teste após todos estarem prontos
```

### Modificar Coordenadas
No arquivo `test-redis-load.cjs`, altere:
```javascript
const baseLat = -23.5505; // Latitude de São Paulo
const baseLng = -46.6333; // Longitude de São Paulo
const radius = 0.01;      // Raio em graus (~1km)
```

## Próximos Passos

1. Execute `test-basic.bat` para verificar conectividade
2. Execute `test-redis-quick.bat 100` para teste leve
3. Execute `test-all-mobile.bat` para menu completo
4. Monitore os logs do servidor durante os testes
5. Analise as estatísticas para otimizações 