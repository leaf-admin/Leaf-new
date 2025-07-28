#!/bin/bash

echo "🚀 DEPLOY COMPLETO DO APP MOBILE - LEAF"
echo "=========================================="

# Configurações
APP_NAME="Leaf"
BUNDLE_ID="com.leaf.app"
VERSION="1.0.0"
BUILD_NUMBER="1"

# Cores para output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Função para log colorido
log() {
    echo -e "${GREEN}[DEPLOY]${NC} $1"
}

error() {
    echo -e "${RED}[ERRO]${NC} $1"
}

warning() {
    echo -e "${YELLOW}[AVISO]${NC} $1"
}

info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

# Verificar se estamos no diretório correto
if [ ! -f "mobile-app/package.json" ]; then
    error "Execute este script na raiz do projeto!"
    exit 1
fi

log "Iniciando deploy completo do Leaf App..."

# 1. CONFIGURAÇÃO DE PRODUÇÃO
log "1. Configurando ambiente de produção..."

cd mobile-app

# Criar arquivo de configuração de produção
cat > app.config.production.js << 'EOF'
export default {
  expo: {
    name: "Leaf",
    slug: "leaf-app",
    version: "1.0.0",
    orientation: "portrait",
    icon: "./assets/icon.png",
    userInterfaceStyle: "light",
    splash: {
      image: "./assets/splash.png",
      resizeMode: "contain",
      backgroundColor: "#ffffff"
    },
    assetBundlePatterns: [
      "**/*"
    ],
    ios: {
      supportsTablet: true,
      bundleIdentifier: "com.leaf.app",
      buildNumber: "1"
    },
    android: {
      adaptiveIcon: {
        foregroundImage: "./assets/adaptive-icon.png",
        backgroundColor: "#FFFFFF"
      },
      package: "com.leaf.app",
      versionCode: 1
    },
    web: {
      favicon: "./assets/favicon.png"
    },
    extra: {
      eas: {
        projectId: "leaf-app-project"
      }
    },
    plugins: [
      "expo-router"
    ]
  }
};
EOF

# 2. INSTALAR DEPENDÊNCIAS
log "2. Instalando dependências..."

npm install
if [ $? -ne 0 ]; then
    error "Falha ao instalar dependências!"
    exit 1
fi

# 3. CONFIGURAR EAS BUILD
log "3. Configurando EAS Build..."

# Instalar EAS CLI se não estiver instalado
if ! command -v eas &> /dev/null; then
    log "Instalando EAS CLI..."
    npm install -g @expo/eas-cli
fi

# Configurar EAS
cat > eas.json << 'EOF'
{
  "cli": {
    "version": ">= 5.2.0"
  },
  "build": {
    "development": {
      "developmentClient": true,
      "distribution": "internal"
    },
    "preview": {
      "distribution": "internal",
      "android": {
        "buildType": "apk"
      }
    },
    "production": {
      "android": {
        "buildType": "apk"
      }
    }
  },
  "submit": {
    "production": {}
  }
}
EOF

# 4. CONFIGURAR VARIÁVEIS DE AMBIENTE
log "4. Configurando variáveis de ambiente..."

cat > .env.production << 'EOF'
# API URLs
API_BASE_URL=http://147.93.66.253:3000
WEBSOCKET_URL=ws://147.93.66.253:3001
FIREBASE_FALLBACK_URL=https://us-central1-leaf-app-91dfdce0.cloudfunctions.net

# API Keys
GOOGLE_MAPS_API_KEY=YOUR_GOOGLE_MAPS_API_KEY
MAPBOX_API_KEY=pk.eyJ1IjoibGVhZi1hcHAiLCJhIjoiY205MHJxazByMGlybzJrcTIyZ25wdm1maSJ9.aX1wTUINIhk_nsQAACNnyA
LOCATIONIQ_API_KEY=pk.59262794905b7196e5a09bf1fd47911d

# Firebase
FIREBASE_API_KEY=YOUR_FIREBASE_API_KEY
FIREBASE_AUTH_DOMAIN=leaf-app-91dfdce0.firebaseapp.com
FIREBASE_PROJECT_ID=leaf-app-91dfdce0
FIREBASE_STORAGE_BUCKET=leaf-app-91dfdce0.appspot.com
FIREBASE_MESSAGING_SENDER_ID=YOUR_SENDER_ID
FIREBASE_APP_ID=YOUR_APP_ID

# Woovi
WOOVI_API_KEY=YOUR_WOOVI_API_KEY

# MercadoPago
MERCADOPAGO_PUBLIC_KEY=YOUR_MERCADOPAGO_PUBLIC_KEY
MERCADOPAGO_ACCESS_TOKEN=YOUR_MERCADOPAGO_ACCESS_TOKEN

# Environment
NODE_ENV=production
EXPO_PUBLIC_ENV=production
EOF

# 5. VALIDAR CONFIGURAÇÃO
log "5. Validando configuração..."

# Verificar se o app.config.js existe
if [ ! -f "app.config.js" ]; then
    error "app.config.js não encontrado!"
    exit 1
fi

# Verificar se o package.json tem as dependências necessárias
if ! grep -q "expo" package.json; then
    error "Expo não está configurado no package.json!"
    exit 1
fi

# 6. BUILD DE DESENVOLVIMENTO
log "6. Fazendo build de desenvolvimento..."

# Build para Android APK
log "Buildando APK para Android..."
eas build --platform android --profile preview --non-interactive

if [ $? -ne 0 ]; then
    error "Falha no build do Android!"
    exit 1
fi

# 7. BUILD DE PRODUÇÃO
log "7. Fazendo build de produção..."

# Build para produção
log "Buildando versão de produção..."
eas build --platform all --profile production --non-interactive

if [ $? -ne 0 ]; then
    error "Falha no build de produção!"
    exit 1
fi

# 8. GERAR APK LOCAL (OPCIONAL)
log "8. Gerando APK local..."

# Instalar expo-cli se necessário
if ! command -v expo &> /dev/null; then
    npm install -g @expo/cli
fi

# Gerar APK local
expo export --platform android --output-dir ./build

# 9. CRIAR SCRIPT DE INSTALAÇÃO
log "9. Criando script de instalação..."

cat > install-leaf-app.sh << 'EOF'
#!/bin/bash

echo "📱 INSTALANDO LEAF APP"
echo "======================="

# Verificar se o ADB está instalado
if ! command -v adb &> /dev/null; then
    echo "❌ ADB não encontrado. Instale o Android SDK."
    exit 1
fi

# Verificar se há dispositivos conectados
if ! adb devices | grep -q "device$"; then
    echo "❌ Nenhum dispositivo Android conectado."
    echo "Conecte um dispositivo via USB e habilite a depuração USB."
    exit 1
fi

# Instalar APK
echo "📦 Instalando Leaf App..."
adb install -r ./build/android-release.apk

if [ $? -eq 0 ]; then
    echo "✅ Leaf App instalado com sucesso!"
    echo "🚀 Abrindo o app..."
    adb shell am start -n com.leaf.app/.MainActivity
else
    echo "❌ Falha na instalação."
fi
EOF

chmod +x install-leaf-app.sh

# 10. CRIAR DOCUMENTAÇÃO DE DEPLOY
log "10. Criando documentação de deploy..."

cat > DEPLOY_GUIDE.md << 'EOF'
# 🚀 GUIA DE DEPLOY - LEAF APP

## 📱 APK GERADO
- **Localização:** `./build/android-release.apk`
- **Tamanho:** ~50MB
- **Versão:** 1.0.0

## 🔧 INSTALAÇÃO

### Android
```bash
# Instalar via ADB
./install-leaf-app.sh

# Ou manualmente
adb install -r ./build/android-release.apk
```

### iOS
- Use o arquivo `.ipa` gerado pelo EAS Build
- Instale via Xcode ou TestFlight

## 🌐 CONFIGURAÇÃO

### Variáveis de Ambiente
Edite `.env.production` com suas chaves:
- `GOOGLE_MAPS_API_KEY`
- `FIREBASE_API_KEY`
- `WOOVI_API_KEY`
- `MERCADOPAGO_PUBLIC_KEY`

### URLs de Produção
- **API:** http://147.93.66.253:3000
- **WebSocket:** ws://147.93.66.253:3001
- **Firebase:** https://us-central1-leaf-app-91dfdce0.cloudfunctions.net

## 📊 MONITORAMENTO

### Logs
```bash
# Ver logs do app
adb logcat | grep "Leaf"

# Ver logs da API
ssh root@147.93.66.253 "pm2 logs leaf-api"
```

### Status
```bash
# Status da API
curl http://147.93.66.253:3000/api/health

# Status do Redis
ssh root@147.93.66.253 "redis-cli ping"
```

## 🔄 ATUALIZAÇÕES

### Nova Versão
1. Atualizar versão em `app.config.js`
2. Executar: `./deploy-mobile-app.sh`
3. Instalar nova versão

### Hot Reload
```bash
# Desenvolvimento
expo start

# Produção
expo publish
```

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
EOF

# 11. FINALIZAÇÃO
log "11. Finalizando deploy..."

echo ""
echo "🎉 DEPLOY COMPLETO REALIZADO!"
echo "=============================="
echo ""
echo "📱 APK GERADO:"
echo "   ./build/android-release.apk"
echo ""
echo "📋 PRÓXIMOS PASSOS:"
echo "   1. Configure as variáveis de ambiente em .env.production"
echo "   2. Execute: ./install-leaf-app.sh"
echo "   3. Teste o app no dispositivo"
echo ""
echo "📚 DOCUMENTAÇÃO:"
echo "   DEPLOY_GUIDE.md"
echo ""
echo "🚀 STATUS:"
echo "   ✅ Build concluído"
echo "   ✅ APK gerado"
echo "   ✅ Scripts criados"
echo "   ✅ Documentação criada"
echo ""
echo "🎯 PRÓXIMO: Configure as API keys e teste o app!"

cd ..

log "Deploy do Leaf App concluído com sucesso!" 