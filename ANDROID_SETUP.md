# 🚀 Configuração do Ambiente Android - Leaf App

## ✅ **Status Atual**
- ✅ ADB instalado
- ✅ Android SDK instalado
- ✅ Android Studio instalado
- ✅ Expo rodando na porta 8082

## 📱 **Opções de Desenvolvimento**

### 1. **Desenvolvimento Web (Mais Fácil)**
```bash
cd mobile-app
npx expo start --web
```
- Acesse: http://localhost:8082
- Funciona no navegador
- Bom para desenvolvimento rápido

### 2. **Dispositivo Físico Android**
```bash
# 1. Ative o modo desenvolvedor no Android
# 2. Ative a depuração USB
# 3. Conecte via USB
# 4. Execute:
adb devices
cd mobile-app
npx expo start --dev-client
```

### 3. **Emulador Android**
```bash
# 1. Abra o Android Studio
android-studio

# 2. Vá em Tools > AVD Manager
# 3. Crie um novo dispositivo virtual
# 4. Execute:
emulator -list-avds
emulator -avd [nome_do_avd]

# 5. Em outro terminal:
cd mobile-app
npx expo start --dev-client
```

## 🔧 **Scripts Disponíveis**

### Setup Automático
```bash
./setup-android.sh
```

### Desenvolvimento Interativo
```bash
./dev-android.sh
```

## 📋 **Checklist de Configuração**

### Para Dispositivo Físico:
- [ ] Ativar modo desenvolvedor no Android
- [ ] Ativar depuração USB
- [ ] Conectar via USB
- [ ] Executar `adb devices`
- [ ] Instalar Expo Go no dispositivo

### Para Emulador:
- [ ] Abrir Android Studio
- [ ] Criar AVD (Android Virtual Device)
- [ ] Iniciar emulador
- [ ] Instalar Expo Go no emulador

## 🚨 **Solução de Problemas**

### ADB não reconhece dispositivo:
```bash
sudo adb kill-server
sudo adb start-server
adb devices
```

### Expo não conecta:
```bash
cd mobile-app
npx expo start --clear
```

### Porta ocupada:
```bash
# O Expo automaticamente sugere outra porta
# Ou mate o processo:
pkill -f "expo"
```

## 🎯 **Próximos Passos**

1. **Escolha uma opção de desenvolvimento**
2. **Execute o script correspondente**
3. **Teste o app no dispositivo/emulador**
4. **Faça as alterações necessárias**

## 📞 **Suporte**

Se encontrar problemas:
1. Verifique se o ADB está funcionando: `adb devices`
2. Verifique se o Expo está rodando: http://localhost:8082
3. Reinicie o servidor: `npx expo start --clear` 