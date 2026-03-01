# 🚀 QUICK START - VPS KYC

## ⚡ Setup Rápido (5 minutos)

### 1. Conectar à VPS
```bash
ssh root@147.93.66.253
# Senha: 1Wf@/I0&adntk8hxGakz
```

### 2. Executar Setup
```bash
# No servidor principal, copiar script:
scp scripts/setup-kyc-vps.sh root@147.93.66.253:/tmp/

# Na VPS, executar:
bash /tmp/setup-kyc-vps.sh
```

### 3. Deploy da Aplicação
```bash
# No servidor principal:
cd leaf-websocket-backend
./scripts/deploy-kyc-vps.sh
```

### 4. Configurar .env
```bash
# Na VPS:
nano /opt/leaf-kyc-service/.env
```

**Gerar API Key:**
```bash
openssl rand -hex 32
```

**Configurar:**
```env
NODE_ENV=production
PORT=3002
API_KEY=SUA_CHAVE_GERADA_AQUI
```

### 5. Iniciar Serviço
```bash
# Na VPS:
systemctl start leaf-kyc
systemctl enable leaf-kyc
systemctl status leaf-kyc
```

### 6. Configurar Servidor Principal
```bash
# No servidor principal, adicionar ao .env:
echo "KYC_VPS_URL=http://147.93.66.253:3002" >> .env
echo "KYC_VPS_API_KEY=SUA_CHAVE_GERADA_AQUI" >> .env
```

### 7. Testar
```bash
# No servidor principal:
curl http://147.93.66.253:3002/health

# Ou:
node test-kyc-architecture.js
```

## ✅ Pronto!

A VPS está configurada e pronta para processar KYC.



