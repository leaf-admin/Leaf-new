# 🚀 DEPLOY VPS - VERSÃO COMPLETA

## 📦 Arquivos incluídos:
- `server.js` - Servidor atualizado com todos os eventos
- `package.json` - Dependências
- `node_modules/` - Dependências instaladas
- `install-on-vps.sh` - Script de instalação automática

## 🚀 Como fazer o deploy:

### Opção 1: Upload manual
```bash
# 1. Fazer upload dos arquivos para VPS
scp -r deploy-package/* root@216.238.107.59:/root/leaf-backend/

# 2. Conectar na VPS
ssh root@216.238.107.59

# 3. Executar instalação
cd /root/leaf-backend
chmod +x install-on-vps.sh
./install-on-vps.sh
```

### Opção 2: Deploy automático (se SSH configurado)
```bash
# Executar script de deploy automático
./deploy-to-vps-auto.sh
```

## 🧪 Testar após deploy:
```bash
# Health check
curl http://216.238.107.59:3001/health

# Teste de eventos
node test-vps-connection.js
```

## 📊 Eventos implementados:
- ✅ authenticate
- ✅ setDriverStatus
- ✅ updateDriverLocation
- ✅ createBooking
- ✅ confirmPayment
- ✅ driverResponse
- ✅ startTrip
- ✅ completeTrip
- ✅ submitRating
- ✅ searchDrivers
- ✅ cancelRide
- ✅ submitFeedback

## 🔧 Configurações VPS:
- Max conexões: 10,000 (otimizado para VPS)
- Workers: máximo 2
- Timeout: 30 segundos
- Compressão: habilitada
- Batch Redis: habilitado
