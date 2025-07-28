# 📱 LEAF APP - BUILD INFO

## 📦 BUILD GERADO
- **Data:** 2025-07-28
- **Versão:** 1.0.0
- **Plataforma:** Android
- **Tamanho:** ~6.7MB
- **Módulos:** 2031
- **Assets:** 73

## 🚀 INSTALAÇÃO

### Pré-requisitos
1. Android Studio instalado
2. ANDROID_HOME configurado
3. Dispositivo Android conectado
4. Depuração USB habilitada

### Comandos
```bash
# Verificar dispositivos
adb devices

# Instalar app
./install-leaf-app.sh

# Ver logs
adb logcat | grep "Leaf"
```

## 🔧 CONFIGURAÇÃO

### API Keys (OBRIGATÓRIO)
Edite o arquivo `.env.production` com suas chaves:
- `GOOGLE_MAPS_API_KEY`
- `FIREBASE_API_KEY`
- `WOOVI_API_KEY`
- `MERCADOPAGO_PUBLIC_KEY`

### URLs de Produção
- **API:** http://147.93.66.253:3000
- **WebSocket:** ws://147.93.66.253:3001
- **Firebase:** https://us-central1-leaf-app-91dfdce0.cloudfunctions.net

## 📊 STATUS

### VPS
- ✅ Online: http://147.93.66.253:3000/api/health
- ✅ APIs: Funcionando
- ✅ Redis: Conectado
- ✅ WebSocket: Ativo

### Funcionalidades
- ✅ Real-time tracking
- ✅ Payment integration
- ✅ Hybrid maps
- ✅ Push notifications
- ✅ Location services
- ✅ Trip management

## 🚨 TROUBLESHOOTING

### Problemas Comuns
1. **App não conecta à API**
   - Verificar se a VPS está online
   - Verificar firewall

2. **Erro de build**
   - Limpar cache: `expo r -c`
   - Reinstalar dependências: `npm install`

3. **APK não instala**
   - Verificar se o dispositivo permite instalação de fontes desconhecidas
   - Verificar se há espaço suficiente

## 📞 SUPORTE
- **API Status:** http://147.93.66.253:3000/api/health
- **VPS Status:** ssh root@147.93.66.253
- **Logs:** pm2 logs leaf-api
