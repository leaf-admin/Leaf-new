# 🧪 STRESS TESTING - LEAF

Scripts para testar capacidade e resiliência do sistema.

## 📁 Scripts Disponíveis

### 1. Command Flood (`command-flood.js`)

Simula flood de comandos `createBooking` para testar capacidade.

```bash
# 1.000 requisições com concorrência 10
node scripts/stress-test/command-flood.js --count 1000 --concurrency 10

# 5.000 requisições com concorrência 50
node scripts/stress-test/command-flood.js --count 5000 --concurrency 50

# 10.000 requisições com concorrência 100
node scripts/stress-test/command-flood.js --count 10000 --concurrency 100

# Customizar servidor
node scripts/stress-test/command-flood.js --count 1000 --url http://localhost:3001
```

**Métricas coletadas:**
- Throughput (req/s)
- Latência (média, P50, P95, P99)
- Taxa de sucesso
- Timeouts

**Relatório:** `stress-test-results-{timestamp}.json`

---

### 2. Listener Backpressure (`listener-backpressure.js`)

Testa backpressure: publica eventos mais rápido que os workers conseguem consumir.

```bash
# 10.000 eventos a 100 events/s
node scripts/stress-test/listener-backpressure.js --events 10000 --rate 100

# 50.000 eventos a 500 events/s (teste agressivo)
node scripts/stress-test/listener-backpressure.js --events 50000 --rate 500
```

**Métricas coletadas:**
- Taxa de publicação
- Lag do stream
- Tamanho do stream
- Backpressure (LOW/MEDIUM/HIGH)

**Relatório:** `stress-test-backpressure-{timestamp}.json`

---

### 3. External Failure (`external-failure.js`)

Simula falhas de serviços externos para testar resiliência.

```bash
# Simular falha do Firebase por 60s
node scripts/stress-test/external-failure.js --service firebase --duration 60

# Simular falha do Woovi por 120s
node scripts/stress-test/external-failure.js --service woovi --duration 120

# Simular falha do FCM por 60s
node scripts/stress-test/external-failure.js --service fcm --duration 60

# Com taxa de requisições
node scripts/stress-test/external-failure.js --service firebase --duration 60 --rate 20
```

**Métricas coletadas:**
- Taxa de sucesso durante falha
- Circuit Breakers abertos
- Fallbacks usados
- Taxa de erro

**Relatório:** `stress-test-failure-{service}-{timestamp}.json`

---

### 4. Peak Scenario (`peak-scenario.js`)

Simula cenário de pico: muitos drivers online e muitas corridas simultâneas.

```bash
# Cenário padrão: 10k drivers, 5k rides em 30s
node scripts/stress-test/peak-scenario.js

# Customizar
node scripts/stress-test/peak-scenario.js --drivers 20000 --rides 10000 --duration 60
```

**Métricas coletadas:**
- Drivers online
- Rides criadas
- Taxa de sucesso
- Bookings ativos
- Eventos no stream

**Relatório:** `stress-test-peak-{timestamp}.json`

---

### 5. Capacity Report (`capacity-report.js`)

Gera relatório de capacidade baseado em métricas Prometheus.

```bash
# Relatório padrão (últimos 5 minutos)
node scripts/stress-test/capacity-report.js

# Customizar Prometheus e duração
node scripts/stress-test/capacity-report.js --prometheus http://localhost:9090 --duration 10m
```

**Métricas analisadas:**
- Throughput (commands, events, listeners)
- Latência (P95)
- Taxa de erros
- Workers ativos e backlog
- Circuit Breakers
- CPU e memória

**Relatório:** `capacity-report-{timestamp}.json`

---

## 🚀 Executar Todos os Testes

```bash
# Criar script de execução completa
cat > scripts/stress-test/run-all.sh << 'EOF'
#!/bin/bash
echo "🧪 Executando todos os stress tests..."

echo "1. Command Flood (1k)..."
node scripts/stress-test/command-flood.js --count 1000 --concurrency 10

echo "2. Listener Backpressure..."
node scripts/stress-test/listener-backpressure.js --events 10000 --rate 100

echo "3. External Failure (Firebase)..."
node scripts/stress-test/external-failure.js --service firebase --duration 60

echo "4. Peak Scenario..."
node scripts/stress-test/peak-scenario.js --drivers 5000 --rides 2000 --duration 30

echo "5. Capacity Report..."
node scripts/stress-test/capacity-report.js

echo "✅ Todos os testes concluídos!"
EOF

chmod +x scripts/stress-test/run-all.sh
```

---

## 📊 Interpretando Resultados

### Command Flood

- **Throughput > 100 req/s**: Excelente
- **Throughput 50-100 req/s**: Bom
- **Throughput < 50 req/s**: Precisa otimização
- **P95 < 500ms**: Excelente
- **P95 500-1000ms**: Aceitável
- **P95 > 1000ms**: Precisa otimização

### Listener Backpressure

- **Lag < 100**: Sem backpressure
- **Lag 100-1000**: Backpressure médio
- **Lag > 1000**: Backpressure alto (adicionar workers)

### External Failure

- **Success Rate > 80%**: Resiliência boa
- **Success Rate 50-80%**: Resiliência aceitável
- **Success Rate < 50%**: Precisa melhorar fallbacks

### Peak Scenario

- **Success Rate > 90%**: Sistema robusto
- **Success Rate 70-90%**: Aceitável
- **Success Rate < 70%**: Precisa escalar

---

## ⚠️ Avisos

1. **Não executar em produção** sem autorização
2. **Monitorar recursos** durante testes
3. **Limpar dados de teste** após execução
4. **Usar ambiente isolado** quando possível

---

## 🔧 Troubleshooting

### Erro de conexão WebSocket

```bash
# Verificar se servidor está rodando
curl http://localhost:3001/health

# Verificar logs
tail -f logs/combined.log
```

### Redis sobrecarregado

```bash
# Verificar uso de memória
redis-cli INFO memory

# Limpar dados de teste
redis-cli FLUSHDB
```

### Prometheus não acessível

```bash
# Verificar se Prometheus está rodando
curl http://localhost:9090/api/v1/query?query=up

# Verificar endpoint /metrics
curl http://localhost:3001/metrics
```

---

## 📚 Referências

- [k6 Documentation](https://k6.io/docs/)
- [Artillery Documentation](https://www.artillery.io/docs)
- [Prometheus Querying](https://prometheus.io/docs/prometheus/latest/querying/basics/)

