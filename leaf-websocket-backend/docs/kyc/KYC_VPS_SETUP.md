# 🚀 CONFIGURAÇÃO VPS DEDICADA PARA KYC

## 📋 Informações da VPS

- **IP:** `147.93.66.253`
- **Hostname:** `srv710490.hstgr.cloud`
- **IPv6:** `2a02:4780:14:d077::1`
- **Usuário:** `root`
- **Senha:** `1Wf@/I0&adntk8hxGakz`
- **Chave SSH:** `ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIIJO0l1nmmzATqpn9uY2lGASvn/frPE9nhuXEkxa8rWi admin@leaf.app.br`

## 🎯 Passo a Passo

### 1. Conectar à VPS

```bash
# Opção 1: Com senha
ssh root@147.93.66.253

# Opção 2: Com chave SSH (recomendado)
ssh -i ~/.ssh/leaf_kyc_key root@147.93.66.253
```

### 2. Executar Setup Inicial

**Na VPS:**
```bash
# Baixar e executar script de setup
curl -fsSL https://raw.githubusercontent.com/.../setup-kyc-vps.sh | bash

# OU copiar script localmente e executar
scp scripts/setup-kyc-vps.sh root@147.93.66.253:/tmp/
ssh root@147.93.66.253 "bash /tmp/setup-kyc-vps.sh"
```

O script irá:
- ✅ Atualizar sistema
- ✅ Instalar Node.js 18.x
- ✅ Instalar dependências do sistema (OpenCV, etc.)
- ✅ Criar usuário `leaf-kyc`
- ✅ Criar diretório `/opt/leaf-kyc-service`
- ✅ Configurar firewall
- ✅ Configurar serviço systemd
- ✅ Configurar Nginx

### 3. Deploy da Aplicação

**No servidor principal (local):**
```bash
cd leaf-websocket-backend
./scripts/deploy-kyc-vps.sh
```

O script irá:
- ✅ Testar conexão SSH
- ✅ Criar estrutura de diretórios
- ✅ Copiar arquivos necessários
- ✅ Instalar dependências npm
- ✅ Configurar permissões

### 4. Configurar Variáveis de Ambiente

**Na VPS:**
```bash
ssh root@147.93.66.253
nano /opt/leaf-kyc-service/.env
```

Configurar:
```env
NODE_ENV=production
PORT=3002
HOST=0.0.0.0

# API Security (GERAR UMA CHAVE SEGURA!)
API_KEY=SUA_CHAVE_SECRETA_AQUI

# Firebase (copiar do servidor principal)
FIREBASE_PROJECT_ID=leaf-app-12345
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
FIREBASE_CLIENT_EMAIL=firebase-adminsdk@leaf-app-12345.iam.gserviceaccount.com

# Performance
MAX_CONCURRENT_REQUESTS=5
REQUEST_TIMEOUT=30000
WORKER_THREADS=2

# Face Recognition
FACE_MATCH_THRESHOLD=0.6
LIVENESS_DETECTION_ENABLED=true
```

**Gerar API Key segura:**
```bash
openssl rand -hex 32
```

### 5. Atualizar Cliente no Servidor Principal

**No servidor principal:**
```bash
# Adicionar ao .env
echo "KYC_VPS_URL=http://147.93.66.253:3002" >> .env
echo "KYC_VPS_API_KEY=SUA_CHAVE_SECRETA_AQUI" >> .env
```

### 6. Iniciar Serviço

**Na VPS:**
```bash
# Iniciar serviço
systemctl start leaf-kyc

# Habilitar no boot
systemctl enable leaf-kyc

# Verificar status
systemctl status leaf-kyc

# Ver logs
journalctl -u leaf-kyc -f
```

### 7. Testar Conexão

**No servidor principal:**
```bash
# Testar health check
curl http://147.93.66.253:3002/health

# Testar com API Key
curl -H "X-API-Key: SUA_CHAVE_SECRETA_AQUI" http://147.93.66.253:3002/health
```

**Ou usar o script de teste:**
```bash
node test-kyc-architecture.js
```

## 🔧 Comandos Úteis

### Na VPS

```bash
# Ver logs em tempo real
journalctl -u leaf-kyc -f

# Reiniciar serviço
systemctl restart leaf-kyc

# Parar serviço
systemctl stop leaf-kyc

# Ver status
systemctl status leaf-kyc

# Ver uso de recursos
htop
df -h
free -h
```

### No Servidor Principal

```bash
# Testar conexão
curl http://147.93.66.253:3002/health

# Testar processamento KYC (via script)
node test-kyc-architecture.js <userId>
```

## 🔒 Segurança

1. **API Key:** Use uma chave forte e única
2. **Firewall:** Apenas portas 22, 80, 443 e 3002 abertas
3. **HTTPS:** Configurar Let's Encrypt para produção
4. **Rate Limiting:** Implementar no serviço KYC
5. **Logs:** Monitorar tentativas de acesso

## 📊 Monitoramento

### Health Check
```bash
curl http://147.93.66.253:3002/health
```

Resposta esperada:
```json
{
  "status": "healthy",
  "service": "leaf-kyc-service",
  "timestamp": "2024-01-01T00:00:00.000Z",
  "uptime": 3600,
  "memory": { ... }
}
```

### Métricas
- Uptime do serviço
- Uso de memória
- Uso de CPU
- Número de requisições processadas
- Tempo médio de processamento

## 🐛 Troubleshooting

### Serviço não inicia
```bash
# Ver logs detalhados
journalctl -u leaf-kyc -n 100

# Verificar permissões
ls -la /opt/leaf-kyc-service

# Verificar .env
cat /opt/leaf-kyc-service/.env
```

### Erro de conexão
```bash
# Verificar firewall
ufw status

# Verificar se porta está aberta
netstat -tulpn | grep 3002

# Testar localmente na VPS
curl http://localhost:3002/health
```

### Dependências faltando
```bash
# Reinstalar dependências
cd /opt/leaf-kyc-service
npm install --production
```

## 📝 Próximos Passos

1. ✅ Configurar HTTPS com Let's Encrypt
2. ✅ Implementar processamento real de face recognition
3. ✅ Adicionar liveness detection
4. ✅ Configurar monitoramento (Prometheus/Grafana)
5. ✅ Implementar rate limiting
6. ✅ Adicionar cache Redis (opcional)



