# 🚀 Próximos Passos - Observabilidade Leaf

## ✅ O Que Foi Feito

1. ✅ **Dashboards Grafana criados**
   - `leaf-redis.json` - Dashboard completo de Redis
   - `leaf-system.json` - Dashboard completo de Sistema
   - Localização: `observability/grafana/dashboards/`

2. ✅ **Configurações corrigidas**
   - `docker-compose.observability.yml` - Removidas duplicações
   - `prometheus.yml` - Removidas duplicações, corrigido path para `/api/metrics/prometheus`
   - `dashboards.yml` - Removidas duplicações
   - `tempo-config.yaml` - Removidas duplicações
   - `prometheus.yml` (datasource) - Removidas duplicações

---

## 📋 Próximos Passos

### 1. Reiniciar Docker Compose

```bash
cd /home/izaak-dias/Downloads/leaf-project

# Parar containers atuais
docker-compose -f docker-compose.observability.yml down

# Limpar volumes (opcional, se quiser começar do zero)
# docker-compose -f docker-compose.observability.yml down -v

# Subir novamente
docker-compose -f docker-compose.observability.yml up -d

# Verificar status
docker-compose -f docker-compose.observability.yml ps

# Ver logs
docker-compose -f docker-compose.observability.yml logs -f
```

### 2. Verificar se os Containers Estão Rodando

```bash
# Verificar status
docker-compose -f docker-compose.observability.yml ps

# Deve mostrar:
# - leaf-grafana: Up
# - leaf-prometheus: Up
# - leaf-tempo: Up
```

### 3. Acessar os Serviços

- **Grafana**: http://localhost:3000
  - Login: `admin` / `admin`
  - Os dashboards devem aparecer automaticamente em **Dashboards**

- **Prometheus**: http://localhost:9090
  - Verificar se está coletando métricas: ir em **Status** → **Targets**
  - Deve mostrar `leaf-backend` como **UP**

- **Tempo**: http://localhost:3200
  - Verificar se está recebendo traces

### 4. Verificar Dashboards no Grafana

1. Acessar http://localhost:3000
2. Ir em **Dashboards** (ícone de 4 quadrados)
3. Procurar por:
   - **Leaf - Redis Metrics**
   - **Leaf - System Metrics**

### 5. Verificar se o Backend Está Exportando Métricas

```bash
# Verificar se o endpoint de métricas está funcionando
curl http://localhost:3001/api/metrics/prometheus | head -20

# Deve retornar métricas no formato Prometheus
```

### 6. Verificar se o Prometheus Está Coletando

1. Acessar http://localhost:9090
2. Ir em **Status** → **Targets**
3. Verificar se `leaf-backend` está **UP**
4. Se estiver **DOWN**, verificar:
   - Se o backend está rodando na porta 3001
   - Se o path está correto: `/api/metrics/prometheus`
   - Se `host.docker.internal` está funcionando (pode precisar usar `172.17.0.1` no Linux)

### 7. Testar Dashboards

1. No Grafana, abrir o dashboard **Leaf - Redis Metrics**
2. Verificar se os painéis estão mostrando dados
3. Se não houver dados:
   - Verificar se o Prometheus está coletando métricas
   - Verificar se as queries estão corretas
   - Verificar se o datasource Prometheus está configurado

---

## 🔧 Troubleshooting

### Problema: Containers não sobem

```bash
# Ver logs detalhados
docker-compose -f docker-compose.observability.yml logs grafana
docker-compose -f docker-compose.observability.yml logs prometheus
docker-compose -f docker-compose.observability.yml logs tempo
```

### Problema: Prometheus não coleta métricas

1. Verificar se o backend está rodando:
   ```bash
   curl http://localhost:3001/api/metrics/prometheus
   ```

2. Se estiver no Linux e `host.docker.internal` não funcionar, editar `prometheus.yml`:
   ```yaml
   - targets: ['172.17.0.1:3001']  # IP do gateway Docker
   ```

3. Reiniciar Prometheus:
   ```bash
   docker-compose -f docker-compose.observability.yml restart prometheus
   ```

### Problema: Dashboards não aparecem no Grafana

1. Verificar se os arquivos estão no lugar certo:
   ```bash
   ls -la observability/grafana/dashboards/
   ```

2. Verificar logs do Grafana:
   ```bash
   docker-compose -f docker-compose.observability.yml logs grafana | grep -i dashboard
   ```

3. Reiniciar Grafana:
   ```bash
   docker-compose -f docker-compose.observability.yml restart grafana
   ```

### Problema: Métricas não aparecem nos dashboards

1. Verificar se o Prometheus está coletando:
   - Acessar http://localhost:9090
   - Ir em **Status** → **Targets**
   - Verificar se `leaf-backend` está **UP**

2. Verificar queries no Grafana:
   - Abrir o dashboard
   - Clicar em um painel
   - Ir em **Edit**
   - Verificar se a query está correta
   - Testar a query no Prometheus: http://localhost:9090/graph

---

## 📊 Checklist Final

- [ ] Docker Compose rodando sem erros
- [ ] Grafana acessível em http://localhost:3000
- [ ] Prometheus acessível em http://localhost:9090
- [ ] Tempo acessível em http://localhost:3200
- [ ] Dashboards aparecem no Grafana
- [ ] Prometheus coletando métricas do backend
- [ ] Dashboards mostrando dados (ou pelo menos sem erros)

---

## 🎯 Após Tudo Funcionar

1. **Testar com dados reais**: Fazer algumas requisições no backend para gerar métricas
2. **Verificar traces**: Verificar se os traces estão sendo enviados para o Tempo
3. **Personalizar dashboards**: Ajustar os dashboards conforme necessário
4. **Configurar alertas**: Criar alertas baseados nas métricas

---

**Última atualização:** 2026-01-08

