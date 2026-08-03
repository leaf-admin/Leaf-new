# 🚨 Sistema de Alertas do Servidor

Sistema completo de monitoramento e alertas para o servidor LEAF.

## 📋 O que é monitorado

O sistema monitora as seguintes métricas:

- **CPU**: Uso de processador
- **Memória**: Uso de RAM
- **Conexões**: Número de conexões WebSocket ativas
- **Latência**: Tempo de resposta P95
- **Taxa de Erro**: Percentual de requisições com erro
- **Custo médio por corrida**: média móvel por `bookingId`, excluindo Woovi
- **Google Directions por corrida**: detecta reroute/loop/cache quebrado

## 🚨 Thresholds (Limites)

### Avisos (Warning)
- CPU > 70%
- Memória > 75%
- Conexões > 7.000 (70% do máximo)
- Latência P95 > 300ms
- Taxa de Erro > 0.5%
- Custo médio por corrida > R$ 0,20
- Directions por corrida > 2,2

### Críticos (Critical)
- CPU > 75%
- Memória > 80%
- Conexões > 8.000 (80% do máximo)
- Latência P95 > 500ms
- Taxa de Erro > 1%
- Custo médio por corrida > R$ 0,30
- Directions por corrida > 3,0

## 📍 Onde os alertas aparecem

### 1. **Console (Terminal)**
Os alertas são exibidos diretamente no console onde o monitoramento está rodando:

```
🟡 [ALERTA WARNING] 29/11/2025, 15:30:00
   Métrica: CPU
   Valor: 72%
   Limite: 70%
   Mensagem: CPU está em 72%, acima do limite de 70%
```

### 2. **Arquivo de Log**
Todos os alertas são salvos em arquivo de log:

**Localização**: `/var/log/leaf-server-alerts.log`

**Formato**:
```
[2025-11-29T15:30:00.000Z] [WARNING] CPU: 72% (limite: 70%) - CPU está em 72%, acima do limite de 70%
```

**Como visualizar**:
```bash
# Ver últimos alertas
tail -f /var/log/leaf-server-alerts.log

# Buscar alertas críticos
grep CRITICAL /var/log/leaf-server-alerts.log

# Ver alertas de hoje
grep "$(date +%Y-%m-%d)" /var/log/leaf-server-alerts.log
```

### 3. **Dashboard (API)**
Os alertas são enviados para a API do dashboard e podem ser visualizados via:

**Endpoint**: `GET http://216.238.107.59:3001/api/alerts`

**Exemplo de resposta**:
```json
{
  "success": true,
  "total": 25,
  "count": 10,
  "alerts": [
    {
      "id": "alert_1234567890_abc123",
      "type": "server_alert",
      "severity": "warning",
      "metric": "CPU",
      "value": 72,
      "threshold": 70,
      "unit": "%",
      "message": "CPU está em 72%, acima do limite de 70%",
      "timestamp": "2025-11-29T15:30:00.000Z",
      "acknowledged": false
    }
  ]
}
```

**Endpoints disponíveis**:
- `GET /api/alerts` - Listar alertas
- `GET /api/alerts/stats` - Estatísticas de alertas
- `POST /api/alerts/:alertId/acknowledge` - Reconhecer alerta
- `DELETE /api/alerts/clean` - Limpar alertas antigos

### 4. **Email (Opcional)**
Alertas podem ser enviados por email quando configurado.

**Configuração**:
```bash
export EMAIL_ALERTS_ENABLED=true
export SMTP_HOST=smtp.gmail.com
export SMTP_PORT=587
export SMTP_USER=seu-email@gmail.com
export SMTP_PASS=sua-senha
export ALERT_EMAIL_TO=admin@leaf.app.br,dev@leaf.app.br
```

### 5. **Webhook (Opcional)**
Alertas podem ser enviados para webhooks (Slack, Discord, etc).

**Configuração**:
```bash
export WEBHOOK_ALERTS_ENABLED=true
export WEBHOOK_URL=https://hooks.slack.com/services/SEU/WEBHOOK/URL
export WEBHOOK_HEADERS='{"Content-Type": "application/json"}'
```

### 6. **Discord**
O `alert-service` envia alertas diretamente para Discord quando os webhooks abaixo estão configurados:

```bash
export DISCORD_ALERT_WEBHOOK_URL=https://discord.com/api/webhooks/...
export DISCORD_CRITICAL_ALERT_WEBHOOK_URL=https://discord.com/api/webhooks/...
export DISCORD_ALERT_MENTION='<@&role_id>'
```

Para o canal diario de resultado financeiro (`leaf-earnings`), use um webhook separado:

```bash
export DISCORD_EARNINGS_WEBHOOK_URL=https://discord.com/api/webhooks/...
export DISCORD_EARNINGS_USERNAME='Leaf Earnings'
```

## 💸 Monitor de custo por corrida

O monitor usa a telemetria `ride_cost_telemetry:{bookingId}` e calcula uma média móvel apenas com corridas concluídas.
Woovi não entra no custo, porque é taxa descontada do pagamento do passageiro.

**Endpoint de resumo**:

```bash
curl https://api.leaf.app.br/api/ops/ride-cost-telemetry/summary
```

**Prometheus**:

- `leaf_ride_cost_recent_average_brl`
- `leaf_ride_cost_recent_google_average_brl`
- `leaf_ride_cost_recent_directions_per_ride`
- `leaf_ride_cost_alert_total`

**Configuração**:

```bash
export RIDE_COST_ALERTS_ENABLED=true
export RIDE_COST_ALERT_WINDOW_SIZE=20
export RIDE_COST_ALERT_MIN_COMPLETED_RIDES=5
export RIDE_COST_WARNING_BRL=0.20
export RIDE_COST_CRITICAL_BRL=0.30
export RIDE_COST_DIRECTIONS_WARNING_PER_RIDE=2.2
export RIDE_COST_DIRECTIONS_CRITICAL_PER_RIDE=3
```

## Relatorio diario leaf-earnings

O relatorio diario soma corridas concluidas usando rollup Redis por `bookingId`.
Se a telemetria de uma corrida muda, o rollup remove o snapshot anterior e aplica o novo valor, evitando duplicidade.
O mesmo payload inclui, em uma linha separada, a quantidade de sessoes AWS KYC
despachadas e seu custo estimado em USD/BRL. Esse valor e monitoramento operacional
e nao altera retroativamente a formula financeira das corridas.

**Formula principal**:

```txt
ganho_liquido_leaf = taxa_operacional_total - custo_variavel_total
```

Woovi nao entra no custo porque e descontada do valor pago pelo passageiro.

**Endpoints**:

```bash
curl https://api.leaf.app.br/api/ops/daily-earnings-report?date=2026-05-13
curl -X POST https://api.leaf.app.br/api/ops/daily-earnings-report/send \
  -H 'Content-Type: application/json' \
  -d '{"date":"2026-05-13","force":true}'
```

**Agendamento padrao**:

```bash
export DAILY_EARNINGS_REPORT_ENABLED=true
export DAILY_EARNINGS_REPORT_CRON='5 6 * * *'
export LEAF_REPORT_TIME_ZONE=America/Sao_Paulo
```

## 🚀 Como usar

### Iniciar monitoramento

```bash
cd leaf-websocket-backend
./scripts/start-alert-monitor.sh start
```

### Ver status

```bash
./scripts/start-alert-monitor.sh status
```

### Parar monitoramento

```bash
./scripts/start-alert-monitor.sh stop
```

### Reiniciar monitoramento

```bash
./scripts/start-alert-monitor.sh restart
```

## ⚙️ Configuração

### Variáveis de ambiente

```bash
# URL do servidor
export SERVER_URL=http://216.238.107.59:3001

# Intervalo de verificação (segundos)
export CHECK_INTERVAL=60

# Thresholds (opcional - usa padrões se não definido)
export CPU_WARNING=70
export CPU_CRITICAL=75
export MEMORY_WARNING=75
export MEMORY_CRITICAL=80
export CONNECTIONS_WARNING=7000
export CONNECTIONS_CRITICAL=8000

# Cooldown entre alertas (minutos)
export ALERT_COOLDOWN=30

# Email (opcional)
export EMAIL_ALERTS_ENABLED=true
export SMTP_HOST=smtp.gmail.com
export SMTP_PORT=587
export SMTP_USER=seu-email@gmail.com
export SMTP_PASS=sua-senha
export ALERT_EMAIL_TO=admin@leaf.app.br

# Webhook (opcional)
export WEBHOOK_ALERTS_ENABLED=true
export WEBHOOK_URL=https://hooks.slack.com/services/...
```

## 🔄 Cooldown (Prevenção de Spam)

O sistema tem um mecanismo de cooldown para evitar spam de alertas:

- **Duração**: 30 minutos (configurável)
- **Como funciona**: Se o mesmo alerta (mesma métrica e severidade) for disparado novamente dentro do cooldown, ele não será enviado novamente
- **Exemplo**: Se CPU atingir 75% às 15:00, o alerta será enviado. Se continuar em 75% às 15:15, não será enviado novamente até 15:30

## 📊 Visualizar alertas no Dashboard

### Via API

```bash
# Listar todos os alertas
curl http://216.238.107.59:3001/api/alerts

# Listar apenas alertas críticos
curl http://216.238.107.59:3001/api/alerts?severity=critical

# Listar alertas não reconhecidos
curl http://216.238.107.59:3001/api/alerts?acknowledged=false

# Estatísticas
curl http://216.238.107.59:3001/api/alerts/stats
```

### Integração com Dashboard Web

O dashboard pode consumir a API e exibir alertas em tempo real:

```javascript
// Exemplo de integração
async function fetchAlerts() {
  const response = await fetch('http://216.238.107.59:3001/api/alerts?limit=10');
  const data = await response.json();
  return data.alerts;
}

// Atualizar a cada 30 segundos
setInterval(async () => {
  const alerts = await fetchAlerts();
  updateAlertDisplay(alerts);
}, 30000);
```

## 🔔 Alertas automáticos

O sistema verifica métricas automaticamente a cada **60 segundos** (configurável).

Quando um limite é atingido:
1. ✅ Alerta é exibido no console
2. ✅ Alerta é salvo no arquivo de log
3. ✅ Alerta é enviado para a API do dashboard
4. ✅ Alerta é enviado por email (se configurado)
5. ✅ Alerta é enviado para webhook (se configurado)

## 📝 Logs

### Localização do log
- **Monitoramento**: `/var/log/leaf-alert-monitor.log`
- **Alertas**: `/var/log/leaf-server-alerts.log`

### Visualizar logs

```bash
# Log do monitoramento
tail -f /var/log/leaf-alert-monitor.log

# Log de alertas
tail -f /var/log/leaf-server-alerts.log

# Buscar alertas críticos
grep CRITICAL /var/log/leaf-server-alerts.log | tail -20
```

## 🛠️ Troubleshooting

### Monitoramento não inicia
```bash
# Verificar se Node.js está instalado
node --version

# Verificar permissões
ls -la monitoring/server-alert-system.js

# Verificar logs
cat /var/log/leaf-alert-monitor.log
```

### Alertas não aparecem
```bash
# Verificar se monitoramento está rodando
./scripts/start-alert-monitor.sh status

# Verificar se API está acessível
curl http://216.238.107.59:3001/api/metrics

# Verificar logs
tail -f /var/log/leaf-server-alerts.log
```

### Email não funciona
```bash
# Verificar configurações
echo $EMAIL_ALERTS_ENABLED
echo $SMTP_HOST

# Testar conexão SMTP manualmente
```

## 📈 Próximos passos

1. **Integrar com Dashboard Web**: Criar interface visual para exibir alertas
2. **Notificações Push**: Enviar notificações push para app mobile
3. **Grafana/Prometheus**: Integrar com ferramentas de monitoramento profissionais
4. **Alertas por SMS**: Adicionar suporte para SMS via Twilio ou similar

## 🎯 Resumo

- ✅ **Console**: Alertas aparecem em tempo real no terminal
- ✅ **Log**: Todos os alertas são salvos em arquivo
- ✅ **API**: Alertas disponíveis via API REST
- ✅ **Email**: Opcional, configurável
- ✅ **Webhook**: Opcional, para integração com Slack/Discord

O sistema está pronto para uso! Basta iniciar o monitoramento e os alertas começarão a aparecer automaticamente quando os limites forem atingidos.
