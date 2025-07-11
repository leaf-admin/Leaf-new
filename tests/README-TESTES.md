# Testes de Carga - Leaf Redis Backend

Este diretório contém scripts para testar a performance e funcionalidade do backend Redis da aplicação Leaf.

## Pré-requisitos

1. **Servidor Redis rodando**: Certifique-se de que o servidor Redis está rodando em `localhost:3001`
2. **Node.js**: Versão 14 ou superior
3. **Dependências**: Execute `npm install` no diretório raiz

## Scripts Disponíveis

### 1. Teste Básico de Conectividade
```bash
# Windows
test-basic.bat

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