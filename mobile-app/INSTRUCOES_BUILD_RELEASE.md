# 📱 Instruções: Build de Release para Teste

## 🚀 Opção 1: Build via EAS (Recomendado)

### Passo 1: Instalar EAS CLI (se não tiver)
```bash
npm install -g eas-cli
```

### Passo 2: Login no EAS
```bash
cd mobile-app
eas login
```

### Passo 3: Criar Build
```bash
# Build APK para teste (pode instalar diretamente)
npx eas build --platform android --profile preview

# Ou usar o script
./build-release-test.sh
```

### Passo 4: Baixar APK
Quando o build estiver pronto:
```bash
# Ver builds
npx eas build:list

# Baixar build específico
npx eas build:download [BUILD_ID]
```

---

## 🏗️ Opção 2: Build Local (Mais Rápido)

### Pré-requisitos
- Android Studio instalado
- Java JDK configurado
- Variáveis de ambiente ANDROID_HOME configuradas

### Passo 1: Preparar ambiente
```bash
cd mobile-app
npm install
```

### Passo 2: Build local
```bash
# Gerar APK de release localmente
cd android
./gradlew assembleRelease

# O APK estará em:
# android/app/build/outputs/apk/release/app-release.apk
```

### Passo 3: Assinar APK (se necessário)
```bash
# Se já tiver keystore
jarsigner -verbose -sigalg SHA1withRSA -digestalg SHA1 \
  -keystore leaf-release-key.keystore \
  android/app/build/outputs/apk/release/app-release-unsigned.apk \
  leaf-release-key

# Alinhar APK
zipalign -v 4 \
  android/app/build/outputs/apk/release/app-release-unsigned.apk \
  leaf-app-release-test.apk
```

---

## 📲 Instalar nos Celulares

### Método 1: Via ADB (Recomendado)
```bash
# Conectar celular via USB e habilitar depuração USB
adb devices

# Instalar APK
adb install -r leaf-app-release-test.apk
```

### Método 2: Transferir e Instalar Manualmente
1. Copiar APK para o celular (via USB, email, etc)
2. No celular, permitir instalação de fontes desconhecidas
3. Abrir o arquivo APK e instalar

---

## ✅ Verificar Build

### Verificar versão
```bash
# No celular, abrir o app e verificar:
# Configurações > Sobre o App
```

### Testar Funcionalidades
1. ✅ Login/Autenticação
2. ✅ Mapa carrega
3. ✅ Localização funciona
4. ✅ WebSocket conecta
5. ✅ Criar corrida (passageiro)
6. ✅ Receber notificação (motorista)

---

## 🔧 Troubleshooting

### Erro: "EAS não autenticado"
```bash
eas login
```

### Erro: "Build falhou"
```bash
# Ver logs
npx eas build:view [BUILD_ID]

# Verificar configuração
npx eas build:configure
```

### APK não instala
- Verificar se permite "Fontes desconhecidas"
- Verificar se o APK não está corrompido
- Tentar desinstalar versão anterior primeiro

### App não conecta ao servidor
- Verificar URL do WebSocket no código
- Verificar se servidor está rodando
- Verificar firewall/rede

---

## 📋 Checklist Pré-Build

- [ ] Código testado localmente
- [ ] Variáveis de ambiente configuradas
- [ ] Google Services JSON atualizado
- [ ] Versão atualizada no app.config.js
- [ ] Chaves de API configuradas
- [ ] Servidor WebSocket rodando e acessível

---

## 🎯 Próximos Passos Após Build

1. ✅ Instalar em ambos os celulares
2. ✅ Testar login em ambos
3. ✅ Testar criação de corrida (passageiro)
4. ✅ Verificar notificação (motorista)
5. ✅ Testar aceitar/rejeitar corrida
6. ✅ Testar fluxo completo end-to-end


