# 🚀 Solução Rápida - Leaf App

## ❌ **Problema Atual**
- QR code não funciona
- Emulador não funciona  
- Dispositivo físico não conecta

## ✅ **Solução Mais Simples**

### 1. **Use o Expo Go (Recomendado)**

```bash
# Execute o script
./start-dev.sh
# Escolha opção 1
```

**Passos:**
1. Instale o **Expo Go** no seu Android
2. Execute `./start-dev.sh` e escolha opção 1
3. Escaneie o QR code com o Expo Go
4. O app vai carregar no seu dispositivo

### 2. **Desenvolvimento Web (Alternativa)**

```bash
# Execute o script
./start-dev.sh
# Escolha opção 2
```

**Passos:**
1. Execute `./start-dev.sh` e escolha opção 2
2. Abra o navegador em http://localhost:8081
3. Teste o app no navegador

### 3. **Build Local (Avançado)**

```bash
# Execute o script
./start-dev.sh
# Escolha opção 3
```

**Requisitos:**
- Android Studio configurado
- Licenças aceitas
- Dispositivo conectado via USB

## 🎯 **Recomendação**

**Use a opção 1 (Expo Go)** - é a mais simples e funciona imediatamente!

## 📱 **Como Instalar Expo Go**

1. Abra a **Google Play Store** no seu Android
2. Procure por **"Expo Go"**
3. Instale o app
4. Abra o Expo Go
5. Escaneie o QR code que aparecerá no terminal

## 🔧 **Se ainda não funcionar**

```bash
# Reinicie o servidor
cd mobile-app
npx expo start --clear

# Ou use desenvolvimento web
npx expo start --web
```

## 🚨 **Troubleshooting**

### QR code não aparece:
```bash
npx expo start --clear
```

### Dispositivo não conecta:
```bash
adb devices
# Verifique se o dispositivo aparece
```

### Expo Go não carrega:
- Verifique a conexão de internet
- Tente reiniciar o Expo Go
- Verifique se o IP está correto 