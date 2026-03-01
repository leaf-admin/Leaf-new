# 🚀 Executar Build de Release

## ⚡ Opção Rápida: Build Local

```bash
cd mobile-app
./build-local-release.sh
```

**Vantagens:**
- ✅ Mais rápido (não precisa esperar EAS)
- ✅ Não precisa estar logado no EAS
- ✅ APK gerado localmente

**Requisitos:**
- Android Studio instalado
- Java JDK configurado
- Variáveis ANDROID_HOME configuradas

---

## ☁️ Opção Cloud: Build via EAS

```bash
cd mobile-app
./build-release-test.sh
```

**Ou manualmente:**
```bash
cd mobile-app
npx eas build --platform android --profile preview
```

**Vantagens:**
- ✅ Não precisa configurar ambiente local
- ✅ Build na nuvem
- ✅ Recebe email quando pronto

**Requisitos:**
- EAS CLI instalado (`npm install -g eas-cli`)
- Login no EAS (`eas login`)

---

## 📱 Instalar nos Celulares

### Via ADB (Recomendado)
```bash
# Conectar celular via USB
adb devices

# Instalar APK
adb install -r leaf-app-release-*.apk
```

### Manualmente
1. Copiar APK para o celular
2. Permitir "Fontes desconhecidas" nas configurações
3. Abrir e instalar o APK

---

## ✅ Testar nos Dois Celulares

### Celular 1: Passageiro
1. Instalar APK
2. Fazer login
3. Criar conta de passageiro
4. Solicitar corrida

### Celular 2: Motorista
1. Instalar APK
2. Fazer login
3. Criar conta de motorista
4. Ficar online
5. Aguardar notificação de corrida

---

## 🔍 Verificar se Funcionou

- ✅ App abre sem erros
- ✅ Login funciona
- ✅ Mapa carrega
- ✅ Localização funciona
- ✅ WebSocket conecta
- ✅ Passageiro consegue criar corrida
- ✅ Motorista recebe notificação

---

## ⚠️ Troubleshooting

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

### APK não instala
- Verificar se permite "Fontes desconhecidas"
- Desinstalar versão anterior primeiro
- Verificar se APK não está corrompido


