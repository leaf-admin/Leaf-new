# 🚀 Quick Start: Maestro E2E Tests

## ⚡ Início Rápido (5 minutos)

### 1. Instalar Maestro

```bash
cd mobile-app
bash scripts/setup-maestro.sh
```

Ou manualmente:
```bash
curl -Ls "https://get.maestro.mobile.dev" | bash
export PATH="$PATH:$HOME/.maestro/bin"
```

### 2. Build do App

```bash
# Android
npm run android

# Ou iOS
npm run ios
```

### 3. Executar Primeiro Teste

```bash
# Teste de login
npm run test:e2e:auth

# Ou todos os testes
npm run test:e2e
```

## 📱 Pré-requisitos

- ✅ App buildado e instalado no dispositivo/emulador
- ✅ Dispositivo/emulador conectado e rodando
- ✅ Maestro instalado

## 🎯 Comandos Úteis

```bash
# Todos os testes
npm run test:e2e

# Testes específicos
npm run test:e2e:auth      # Autenticação
npm run test:e2e:rides      # Corridas
npm run test:e2e:payments  # Pagamentos

# Modo debug
npm run test:e2e:debug

# Teste específico
maestro test .maestro/flows/auth/01-login-customer.yaml
```

## 🐛 Troubleshooting

### Maestro não encontrado
```bash
export PATH="$PATH:$HOME/.maestro/bin"
# Adicione ao ~/.bashrc ou ~/.zshrc
```

### Dispositivo não encontrado
```bash
# Verificar dispositivos Android
adb devices

# Verificar dispositivos iOS
xcrun simctl list devices
```

### App não encontrado
```bash
# Verificar appId no teste
# Deve ser: br.com.leaf.ride

# Verificar se app está instalado
adb shell pm list packages | grep leaf
```

## 📚 Documentação Completa

Veja `GUIA_TESTES_E2E.md` para documentação completa.













