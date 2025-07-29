# 📊 SISTEMA DE MÉTRICAS E MONITORAMENTO - LEAF APP

## 🎯 **VISÃO GERAL**

Este documento descreve como monitorar e medir o desempenho do Leaf App durante os testes e em produção.

---

## 📈 **MÉTRICAS ESSENCIAIS**

### **🚀 PERFORMANCE**
- **Latência das APIs:** Tempo de resposta de cada endpoint
- **WebSocket:** Conectividade em tempo real
- **Tempo de carregamento:** Speed do app mobile
- **Throughput:** Requisições por segundo

### **💾 RECURSOS**
- **CPU:** Uso de processamento da VPS
- **RAM:** Uso de memória
- **Disco:** Espaço em uso
- **Rede:** Bandwidth consumido

### **🗄️ BANCO DE DADOS**
- **Redis:** Conexões ativas, memória usada
- **Firebase:** Latência de fallback
- **Queries:** Tempo de execução

### **📱 APP MOBILE**
- **Sessões de usuário:** Usuários ativos
- **Atualizações de localização:** Frequência
- **Corridas:** Inícios e fins
- **Pagamentos:** Transações realizadas
- **Erros:** Falhas e crashes

---

## 🛠️ **FERRAMENTAS DE MONITORAMENTO**

### **1. Script de Métricas Básicas**
```bash
# Executar métricas básicas
./scripts/monitoring/mobile-metrics.sh

# Resultado: mobile-metrics-report.json
```

### **2. Dashboard em Tempo Real**
```bash
# Iniciar dashboard
./scripts/monitoring/realtime-dashboard.sh

# Mostra métricas atualizadas a cada 5s
```

### **3. Sistema de Métricas Avançado**
```bash
# Instalar dependências
npm install axios ws

# Executar métricas avançadas
node scripts/monitoring/app-metrics.js

# Monitoramento contínuo
node scripts/monitoring/app-metrics.js --monitor --interval 30000
```

---

## 📊 **MÉTRICAS ESPECÍFICAS PARA TESTE**

### **🔧 APIs**
```bash
# Testar latência de todas as APIs
curl -w "@curl-format.txt" -o /dev/null -s "http://147.93.66.253:3000/api/health"

# Criar arquivo de formato
cat > curl-format.txt << 'EOF'
     time_namelookup:  %{time_namelookup}\n
        time_connect:  %{time_connect}\n
     time_appconnect:  %{time_appconnect}\n
    time_pretransfer:  %{time_pretransfer}\n
       time_redirect:  %{time_redirect}\n
  time_starttransfer:  %{time_starttransfer}\n
                     ----------\n
          time_total:  %{time_total}\n
EOF
```

### **📱 App Mobile**
```bash
# Logs do app
adb logcat | grep "Leaf"

# Performance do app
adb shell dumpsys cpuinfo | grep "Leaf"

# Memória do app
adb shell dumpsys meminfo com.leaf.app
```

### **🏠 VPS**
```bash
# Status da VPS
ssh root@147.93.66.253 "pm2 status"

# Logs da API
ssh root@147.93.66.253 "pm2 logs leaf-api"

# Recursos do sistema
ssh root@147.93.66.253 "top -bn1"
```

---

## 📈 **BASELINE DE PERFORMANCE**

### **✅ MÉTRICAS ACEITÁVEIS**
- **Latência API:** < 200ms
- **WebSocket:** < 100ms
- **CPU:** < 80%
- **RAM:** < 80%
- **Erros:** < 1% das requisições
- **Uptime:** > 99.9%

### **⚠️ ALERTAS**
- **Latência API:** > 500ms
- **WebSocket:** > 1000ms
- **CPU:** > 90%
- **RAM:** > 90%
- **Erros:** > 5% das requisições
- **Uptime:** < 99%

---

## 🔍 **COMO MEDIR DURANTE TESTE**

### **1. ANTES DO TESTE**
```bash
# Verificar baseline
./scripts/monitoring/mobile-metrics.sh

# Iniciar dashboard
./scripts/monitoring/realtime-dashboard.sh
```

### **2. DURANTE O TESTE**
```bash
# Em outro terminal, monitorar logs
ssh root@147.93.66.253 "pm2 logs leaf-api --lines 0 -f"

# Logs do app
adb logcat | grep "Leaf"
```

### **3. APÓS O TESTE**
```bash
# Gerar relatório final
node scripts/monitoring/app-metrics.js

# Comparar com baseline
diff mobile-metrics-report.json baseline-metrics.json
```

---

## 📊 **RELATÓRIOS DE MÉTRICAS**

### **📄 Estrutura do Relatório**
```json
{
  "timestamp": "2025-07-28T15:50:00Z",
  "performance": {
    "apiLatency": {
      "/api/health": 45,
      "/api/update_user_location": 67,
      "/api/nearby_drivers": 89
    },
    "websocket": {
      "status": "connected",
      "latency": 23
    },
    "averageLatency": 67
  },
  "usage": {
    "userSessions": 1,
    "locationUpdates": 2,
    "tripStarts": 1,
    "tripEnds": 1,
    "payments": 0,
    "errors": 0
  },
  "system": {
    "cpuUsage": "15.2%",
    "ramUsage": "45.8%",
    "redisConnections": 3,
    "redisMemory": "2.1M"
  },
  "summary": {
    "totalApis": 8,
    "workingApis": 8,
    "websocketStatus": "connected",
    "appSimulationSuccess": true
  }
}
```

---

## 🚨 **ALERTAS E NOTIFICAÇÕES**

### **📧 Alertas Automáticos**
```bash
# Script de alertas
cat > scripts/monitoring/alerts.sh << 'EOF'
#!/bin/bash

# Verificar latência
LATENCY=$(curl -s -w "%{time_total}" -o /dev/null http://147.93.66.253:3000/api/health)
if (( $(echo "$LATENCY > 1.0" | bc -l) )); then
    echo "🚨 ALERTA: Latência alta - ${LATENCY}s"
fi

# Verificar CPU
CPU=$(ssh root@147.93.66.253 "top -bn1 | grep 'Cpu(s)' | awk '{print \$2}' | cut -d'%' -f1")
if (( $(echo "$CPU > 80" | bc -l) )); then
    echo "🚨 ALERTA: CPU alto - ${CPU}%"
fi
EOF

chmod +x scripts/monitoring/alerts.sh
```

---

## 📱 **MÉTRICAS ESPECÍFICAS DO APP**

### **🎯 Funcionalidades Principais**
1. **Login/Registro**
   - Tempo de autenticação
   - Taxa de sucesso
   - Erros de validação

2. **Localização**
   - Frequência de atualização
   - Precisão do GPS
   - Tempo de resposta

3. **Busca de Motoristas**
   - Tempo de busca
   - Quantidade encontrada
   - Distância média

4. **Corridas**
   - Tempo de início
   - Duração média
   - Taxa de conclusão

5. **Pagamentos**
   - Tempo de processamento
   - Taxa de sucesso
   - Erros de pagamento

---

## 🔧 **CONFIGURAÇÃO DE MONITORAMENTO**

### **📊 Grafana (Opcional)**
```bash
# Instalar Grafana na VPS
ssh root@147.93.66.253
wget -q -O - https://packages.grafana.com/gpg.key | apt-key add -
echo "deb https://packages.grafana.com/oss/deb stable main" | tee -a /etc/apt/sources.list.d/grafana.list
apt update && apt install grafana
systemctl start grafana-server
```

### **📈 Prometheus (Opcional)**
```bash
# Instalar Prometheus
wget https://github.com/prometheus/prometheus/releases/download/v2.45.0/prometheus-2.45.0.linux-amd64.tar.gz
tar xvf prometheus-*.tar.gz
cd prometheus-*
./prometheus --config.file=prometheus.yml
```

---

## 📋 **CHECKLIST DE TESTE**

### **✅ ANTES DO TESTE**
- [ ] Baseline de métricas coletado
- [ ] Dashboard iniciado
- [ ] Logs configurados
- [ ] Alertas ativos

### **✅ DURANTE O TESTE**
- [ ] Monitorar latência das APIs
- [ ] Verificar uso de recursos
- [ ] Observar logs de erro
- [ ] Testar todas as funcionalidades

### **✅ APÓS O TESTE**
- [ ] Relatório final gerado
- [ ] Comparação com baseline
- [ ] Análise de performance
- [ ] Identificação de gargalos

---

## 🎯 **PRÓXIMOS PASSOS**

### **1. Teste Inicial**
```bash
# Executar métricas básicas
./scripts/monitoring/mobile-metrics.sh

# Iniciar dashboard
./scripts/monitoring/realtime-dashboard.sh

# Testar app no dispositivo
cd mobile-app/apk
./install-leaf-app.sh
```

### **2. Monitoramento Contínuo**
```bash
# Monitoramento avançado
node scripts/monitoring/app-metrics.js --monitor --interval 30000
```

### **3. Alertas Automáticos**
```bash
# Configurar alertas
crontab -e
# Adicionar: */5 * * * * /path/to/scripts/monitoring/alerts.sh
```

---

## 📞 **SUPORTE**

### **🔗 URLs de Monitoramento**
- **API Health:** http://147.93.66.253:3000/api/health
- **API Stats:** http://147.93.66.253:3000/api/stats
- **VPS Status:** ssh root@147.93.66.253

### **📊 Relatórios**
- **Métricas Básicas:** `mobile-metrics-report.json`
- **Métricas Avançadas:** `app-metrics-report.json`
- **Dashboard:** `realtime-dashboard.sh`

---

*Documento criado em 28/07/2025* 