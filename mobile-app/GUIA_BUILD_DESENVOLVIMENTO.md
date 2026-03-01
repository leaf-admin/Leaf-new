# 🚀 Guia: Build de Desenvolvimento

## 📋 Pré-requisitos

1. **Node.js** instalado (v18 ou superior)
2. **Android Studio** instalado
3. **Java JDK** (versão 11 ou superior)
4. **Dispositivo Android** conectado via USB com depuração USB habilitada

---

## 🎯 Opção 1: Build Local (Recomendado - Mais Rápido)

### Passo 1: Conectar dispositivo
```bash
# Verificar se dispositivo está conectado
adb devices
```

### Passo 2: Instalar dependências (se necessário)
```bash
cd mobile-app
npm install --legacy-peer-deps
```

### Passo 3: Gerar build e instalar
```bash
# Expo faz prebuild + build + instalação automaticamente
npx expo run:android --variant debug
```

**Vantagens:**
- ✅ Mais rápido
- ✅ Instala automaticamente no dispositivo
- ✅ Hot reload funciona
- ✅ Não precisa de EAS

**Tempo estimado:** 5-10 minutos (primeira vez), 2-3 minutos (próximas vezes)

---

## 🎯 Opção 2: Via Script Automatizado

```bash
cd mobile-app
chmod +x build-dev-simple.sh
./build-dev-simple.sh
```

O script irá:
1. Verificar dependências
2. Compilar APK de debug
3. Copiar APK para raiz com timestamp
4. Mostrar instruções de instalação

---

## 🎯 Opção 3: Build via EAS (Cloud)

### Passo 1: Instalar EAS CLI
```bash
npm install -g eas-cli
```

### Passo 2: Login no EAS
```bash
cd mobile-app
eas login
```

### Passo 3: Criar build
```bash
npx eas build --platform android --profile development
```

**Vantagens:**
- ✅ Não precisa configurar ambiente local
- ✅ Build na nuvem
- ✅ Recebe email quando pronto

**Desvantagens:**
- ⏳ Mais lento (10-20 minutos)
- ⏳ Precisa estar logado no EAS

---

## 📱 Instalação Manual (se build local não instalar)

### Via ADB
```bash
# Listar dispositivos
adb devices

# Instalar APK
adb install -r android/app/build/outputs/apk/debug/app-debug.apk

# Ou se copiou APK para raiz
adb install -r leaf-app-dev-*.apk
```

### Via Transferência Manual
1. Copiar APK para o celular (via USB, email, etc)
2. No celular, permitir "Fontes desconhecidas" nas configurações
3. Abrir o arquivo APK e instalar

---

## ✅ Verificar se Funcionou

Após instalar, verificar:
- ✅ App abre sem erros
- ✅ Login funciona
- ✅ Mapa carrega
- ✅ Localização funciona
- ✅ WebSocket conecta

---

## 🔧 Troubleshooting

### Erro: "expo: command not found"
```bash
# Usar npx
npx expo run:android --variant debug
```

### Erro: "ANDROID_HOME não configurado"
```bash
export ANDROID_HOME=$HOME/Android/Sdk
export PATH=$PATH:$ANDROID_HOME/tools
export PATH=$PATH:$ANDROID_HOME/platform-tools
```

### Erro: "Gradle não encontrado"
```bash
cd android
./gradlew --version
```

### Erro: "No matching variant"
```bash
# Fazer prebuild primeiro
cd mobile-app
npx expo prebuild --platform android --clean
cd android
./gradlew assembleDebug
```

### APK não instala
- Verificar se permite "Fontes desconhecidas"
- Desinstalar versão anterior primeiro: `adb uninstall com.leaf.app`
- Verificar se APK não está corrompido

### Dispositivo não aparece em `adb devices`
- Habilitar "Depuração USB" nas configurações do Android
- Autorizar computador quando aparecer popup no celular
- Tentar desconectar e reconectar USB

---

## 📊 Localização do APK

Após build bem-sucedido, o APK estará em:
```
android/app/build/outputs/apk/debug/app-debug.apk
```

Ou se usou o script:
```
mobile-app/leaf-app-dev-YYYYMMDD-HHMMSS.apk
```

---

## 🎯 Próximos Passos

Após instalar a build de desenvolvimento:
1. Testar fluxo completo de corrida
2. Verificar orquestração de eventos
3. Testar em dois dispositivos (passageiro + motorista)
4. Validar todas as funcionalidades

---

## 📝 Notas

- **Build de desenvolvimento** inclui `expo-dev-client` para hot reload
- **APK de debug** é maior que release, mas permite debugging
- **Primeira build** demora mais (baixa dependências, compila tudo)
- **Próximas builds** são mais rápidas (cache do Gradle)

