# 🔔 LEMBRETE: Configurar Sistema de Alertas

**Data/Hora**: Hoje às 22:00

## 📋 O que fazer:

### 1. Iniciar o sistema de monitoramento
```bash
cd leaf-websocket-backend
./scripts/start-alert-monitor.sh start
```

### 2. Verificar se está funcionando
```bash
./scripts/start-alert-monitor.sh status
```

### 3. Ver logs em tempo real
```bash
tail -f /var/log/leaf-server-alerts.log
```

### 4. (Opcional) Configurar email
```bash
export EMAIL_ALERTS_ENABLED=true
export SMTP_HOST=smtp.gmail.com
export SMTP_PORT=587
export SMTP_USER=seu-email@gmail.com
export SMTP_PASS=sua-senha
export ALERT_EMAIL_TO=admin@leaf.app.br
```

### 5. (Opcional) Configurar webhook (Slack/Discord)
```bash
export WEBHOOK_ALERTS_ENABLED=true
export WEBHOOK_URL=https://hooks.slack.com/services/SEU/WEBHOOK/URL
```

### 6. Testar alertas
```bash
# Verificar alertas via API
curl http://216.238.107.59:3001/api/alerts

# Ver estatísticas
curl http://216.238.107.59:3001/api/alerts/stats
```

## 📍 Onde os alertas aparecem:

1. ✅ **Console** - Terminal onde o monitoramento está rodando
2. ✅ **Arquivo de log** - `/var/log/leaf-server-alerts.log`
3. ✅ **Dashboard API** - `http://216.238.107.59:3001/api/alerts`
4. ⚙️ **Email** - Se configurado
5. ⚙️ **Webhook** - Se configurado (Slack, Discord, etc)

## 📚 Documentação completa:

Ver: `monitoring/README-ALERTS.md`

## 🚨 Thresholds configurados:

- CPU: > 70% (aviso) / > 75% (crítico)
- Memória: > 75% (aviso) / > 80% (crítico)
- Conexões: > 7.000 (aviso) / > 8.000 (crítico)
- Latência: > 300ms (aviso) / > 500ms (crítico)
- Taxa de Erro: > 0.5% (aviso) / > 1% (crítico)

---

**Criado em**: 29/11/2025
**Lembrete para**: Hoje às 22:00


