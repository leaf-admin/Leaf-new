# 🔔 Configurar Alertas no Slack - LEAF MVP

Este guia explica como configurar alertas do servidor LEAF para serem enviados ao Slack.

---

## 📋 Pré-requisitos

1. Acesso ao workspace do Slack
2. Permissão para criar Incoming Webhooks
3. Acesso ao servidor de produção

---

## 🚀 Passo a Passo

### **1. Criar Incoming Webhook no Slack**

1. Acesse: https://api.slack.com/apps
2. Clique em **"Create New App"**
3. Escolha **"From scratch"**
4. Preencha:
   - **App Name:** `LEAF Server Alerts`
   - **Workspace:** Seu workspace
5. Clique em **"Create App"**
6. No menu lateral, vá em **"Incoming Webhooks"**
7. Ative **"Activate Incoming Webhooks"**
8. Clique em **"Add New Webhook to Workspace"**
9. Escolha o canal onde os alertas aparecerão (ex: `#leaf-alerts`)
10. Clique em **"Allow"**
11. **Copie a URL do Webhook** (formato: `https://hooks.slack.com/services/T00000000/B00000000/XXXXXXXXXXXXXXXXXXXXXXXX`)

### **2. Configurar Variáveis de Ambiente**

No servidor de produção, adicione as seguintes variáveis de ambiente:

```bash
# Ativar webhooks
export WEBHOOK_ALERTS_ENABLED=true

# URL do webhook do Slack
export WEBHOOK_URL=https://hooks.slack.com/services/SEU/WEBHOOK/URL

# Headers opcionais (geralmente não necessário)
export WEBHOOK_HEADERS='{"Content-Type": "application/json"}'

# Nome do servidor (opcional, para identificar qual servidor está alertando)
export SERVER_NAME=LEAF-Production-01
```

### **3. Adicionar ao arquivo de configuração**

Se você usa um arquivo `.env` ou `config.production.env`:

```bash
# Alertas Slack
WEBHOOK_ALERTS_ENABLED=true
WEBHOOK_URL=https://hooks.slack.com/services/SEU/WEBHOOK/URL
SERVER_NAME=LEAF-Production-01
```

### **4. Reiniciar o sistema de alertas**

```bash
# Se o sistema de alertas estiver rodando como processo separado
cd /path/to/leaf-websocket-backend
pm2 restart alert-monitor

# Ou se estiver rodando diretamente
node monitoring/server-alert-system.js
```

---

## 🧪 Testar Configuração

### **Teste Manual**

Crie um script de teste:

```bash
# test-slack-alert.js
const axios = require('axios');

const webhookUrl = process.env.WEBHOOK_URL || 'https://hooks.slack.com/services/SEU/WEBHOOK/URL';

const testAlert = {
    text: `🚨 *Teste de Alerta - LEAF Server*`,
    attachments: [{
        color: 'warning',
        title: '🟡 TESTE: CPU',
        fields: [
            { title: 'Métrica', value: 'CPU', short: true },
            { title: 'Valor Atual', value: '72%', short: true },
            { title: 'Limite', value: '70%', short: true },
            { title: 'Severidade', value: 'WARNING', short: true }
        ],
        text: 'Este é um teste de configuração do sistema de alertas',
        footer: 'LEAF Server Monitor',
        ts: Math.floor(Date.now() / 1000)
    }]
};

axios.post(webhookUrl, testAlert)
    .then(() => console.log('✅ Teste enviado com sucesso!'))
    .catch(error => console.error('❌ Erro:', error.message));
```

Execute:
```bash
node test-slack-alert.js
```

Você deve ver uma mensagem no canal do Slack.

---

## 📊 Tipos de Alertas

### **Alertas de Sistema**

O sistema monitora e alerta sobre:

1. **CPU**
   - ⚠️ Warning: > 70%
   - 🔴 Critical: > 75%

2. **Memória**
   - ⚠️ Warning: > 75%
   - 🔴 Critical: > 80%

3. **Conexões WebSocket**
   - ⚠️ Warning: > 7.000
   - 🔴 Critical: > 8.000

4. **Latência P95**
   - ⚠️ Warning: > 300ms
   - 🔴 Critical: > 500ms

5. **Taxa de Erro**
   - ⚠️ Warning: > 0.5%
   - 🔴 Critical: > 1%

### **Exemplo de Alerta no Slack**

```
🚨 Alerta do Servidor LEAF

🔴 CRÍTICO: CPU
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Métrica:        CPU
Valor Atual:    76%
Limite:         75%
Severidade:     CRITICAL
Servidor:       LEAF-Production-01
Timestamp:      29/11/2025, 15:30:00
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
CPU está em 76%, acima do limite de 75%
```

---

## ⚙️ Configurações Avançadas

### **Cooldown entre Alertas**

Para evitar spam, o sistema tem um cooldown de 30 minutos entre alertas do mesmo tipo:

```bash
export ALERT_COOLDOWN=30  # minutos
```

### **Intervalo de Verificação**

Ajuste a frequência de verificação:

```bash
export CHECK_INTERVAL=60  # segundos (padrão: 60)
```

### **Thresholds Personalizados**

Você pode ajustar os limites de alerta:

```bash
export CPU_WARNING=70
export CPU_CRITICAL=75
export MEMORY_WARNING=75
export MEMORY_CRITICAL=80
export CONNECTIONS_WARNING=7000
export CONNECTIONS_CRITICAL=8000
export LATENCY_WARNING=300
export LATENCY_CRITICAL=500
export ERROR_RATE_WARNING=0.5
export ERROR_RATE_CRITICAL=1.0
```

---

## 🔍 Verificar Status

### **Verificar se alertas estão ativos**

```bash
# Ver logs do sistema de alertas
tail -f /var/log/leaf-server-alerts.log

# Verificar se webhook está configurado
echo $WEBHOOK_ALERTS_ENABLED
echo $WEBHOOK_URL
```

### **Testar envio de alerta**

```bash
# Forçar um alerta de teste
node -e "
const { sendAlert } = require('./monitoring/server-alert-system');
sendAlert('CPU', 76, 75, 'critical', '%');
"
```

---

## 🛠️ Troubleshooting

### **Alertas não aparecem no Slack**

1. **Verificar se webhook está ativo:**
   ```bash
   echo $WEBHOOK_ALERTS_ENABLED  # deve retornar "true"
   ```

2. **Verificar URL do webhook:**
   ```bash
   echo $WEBHOOK_URL  # deve começar com "https://hooks.slack.com/services/"
   ```

3. **Verificar logs:**
   ```bash
   tail -f /var/log/leaf-server-alerts.log | grep -i slack
   ```

4. **Testar webhook manualmente:**
   ```bash
   curl -X POST $WEBHOOK_URL \
     -H 'Content-Type: application/json' \
     -d '{"text":"Teste de webhook"}'
   ```

### **Erro: "Invalid webhook URL"**

- Verifique se a URL está correta
- Verifique se o webhook ainda está ativo no Slack
- Crie um novo webhook se necessário

### **Alertas duplicados**

- Verifique o cooldown: `echo $ALERT_COOLDOWN`
- Aumente o cooldown se necessário: `export ALERT_COOLDOWN=60`

---

## 📱 Configurar Múltiplos Canais

Para enviar alertas para diferentes canais (ex: críticos em um canal, avisos em outro):

1. Crie webhooks separados para cada canal
2. Modifique `monitoring/server-alert-system.js` para usar URLs diferentes baseado na severidade

---

## 🔐 Segurança

⚠️ **IMPORTANTE:** A URL do webhook é sensível. Não compartilhe publicamente.

- Mantenha a URL em variáveis de ambiente
- Não commite a URL no código
- Use secrets management em produção

---

## ✅ Checklist

- [ ] Webhook criado no Slack
- [ ] URL do webhook configurada
- [ ] `WEBHOOK_ALERTS_ENABLED=true`
- [ ] Sistema de alertas reiniciado
- [ ] Teste manual executado
- [ ] Alertas aparecendo no Slack
- [ ] Cooldown configurado
- [ ] Thresholds ajustados (se necessário)

---

## 🎯 Próximos Passos

1. **Configurar alertas adicionais:**
   - Alertas de Redis down
   - Alertas de Firebase down
   - Alertas de taxa de erro alta

2. **Melhorar formatação:**
   - Adicionar gráficos
   - Adicionar links para dashboards
   - Adicionar ações rápidas (botões)

3. **Integrar com outros serviços:**
   - PagerDuty para alertas críticos
   - Opsgenie para escalação
   - Email para backup

---

**Última atualização:** 2025-01-XX

