# 👀 Ver Telas em Tempo Real - Guia Rápido

## 🎯 Como Funciona o Maestro?

**O Maestro NÃO cria um simulador.** Ele **controla** um dispositivo/emulador que você já tem, como se fosse um usuário real tocando na tela.

**Você VÊ tudo acontecendo em tempo real!** 🎬

---

## 🚀 Passo a Passo Completo

### 1️⃣ Configurar Emulador (Primeira Vez)

```bash
cd mobile-app

# Opção A: Via script automático
npm run emulator:setup

# Opção B: Via Android Studio
# Tools > Device Manager > Create Device > Escolher Pixel 5 > Start
```

### 2️⃣ Iniciar Emulador

```bash
# Ver emuladores disponíveis
emulator -list-avds

# Iniciar emulador (substitua pelo nome do seu)
emulator -avd Pixel_5_API_33 &
```

**Você verá uma janela do emulador abrindo!** 📱

### 3️⃣ Executar Teste e VER em Tempo Real

```bash
# Executar teste e ver tudo acontecendo
npm run test:e2e:live .maestro/flows/auth/01-login-customer-real.yaml

# Ou manualmente
bash scripts/run-test-live.sh .maestro/flows/auth/01-login-customer-real.yaml
```

**O que você verá:**
- ✅ Emulador já está aberto mostrando a tela
- ✅ App abre automaticamente
- ✅ Você vê cada ação:
  - Botões sendo tocados
  - Textos sendo digitados
  - Telas mudando
  - Animações rodando

**É como assistir alguém usando o app!** 🎥

---

## 📱 Opções para Ver Telas

### Opção 1: Emulador Android (Mais Fácil)

**Vantagens:**
- ✅ Não precisa de dispositivo físico
- ✅ Janela do emulador mostra tudo
- ✅ Fácil de configurar

**Como usar:**
```bash
# Iniciar emulador
emulator -avd Pixel_5_API_33 &

# Executar teste
npm run test:e2e:live .maestro/flows/auth/01-login-customer-real.yaml
```

### Opção 2: Dispositivo Físico + scrcpy

**Vantagens:**
- ✅ Testa em dispositivo real
- ✅ Melhor performance
- ✅ Ver tela no computador

**Como usar:**
```bash
# Instalar scrcpy
sudo apt install scrcpy  # Linux
brew install scrcpy      # macOS

# Ver tela do dispositivo no computador
scrcpy

# Em outro terminal, executar teste
npm run test:e2e:live .maestro/flows/auth/01-login-customer-real.yaml
```

### Opção 3: Android Studio Device Manager

**Vantagens:**
- ✅ Interface gráfica
- ✅ Fácil de usar

**Como usar:**
1. Abra Android Studio
2. `Tools > Device Manager`
3. Clique no dispositivo
4. Veja a tela em tempo real
5. Execute o teste em outro terminal

---

## 🎬 Exemplo Completo

```bash
# Terminal 1: Iniciar emulador
cd mobile-app
emulator -avd Pixel_5_API_33 &
# Aguardar 30-60 segundos até emulador iniciar

# Terminal 2: Executar teste
cd mobile-app
npm run test:e2e:live .maestro/flows/auth/01-login-customer-real.yaml
```

**O que acontece:**
1. Emulador abre (você vê a janela)
2. Teste inicia
3. App abre no emulador
4. Você vê cada ação:
   - Tela de login aparece
   - Campo de telefone é tocado
   - Números são digitados
   - Botão é pressionado
   - Próxima tela aparece
5. Screenshots são salvos automaticamente

---

## 📸 Screenshots Automáticos

Durante o teste, screenshots são capturados:

```
.maestro/screenshots/test_20260101_120000/
├── 01-app-launched.png      # App aberto
├── 02-login-screen.png      # Tela de login
├── 03-phone-entered.png     # Telefone preenchido
└── ...
```

**Ver screenshots:**
```bash
bash scripts/view-test-results.sh
```

---

## 🎥 Gravar Vídeo do Teste

```bash
# Iniciar gravação
adb shell screenrecord /sdcard/test.mp4 &

# Executar teste
npm run test:e2e:live .maestro/flows/auth/01-login-customer-real.yaml

# Parar gravação (Ctrl+C)
# Baixar vídeo
adb pull /sdcard/test.mp4 ./test-video.mp4
```

---

## ✅ Checklist

Antes de executar:

- [ ] Emulador/dispositivo rodando e visível
- [ ] App instalado no dispositivo
- [ ] Maestro instalado
- [ ] Teste ajustado para sua UI

Durante o teste:

- [ ] Observar emulador/dispositivo
- [ ] Ver cada ação acontecendo
- [ ] Screenshots sendo gerados

Após o teste:

- [ ] Ver screenshots
- [ ] Analisar logs
- [ ] Ajustar testes se necessário

---

## 🆘 Problemas Comuns

### "Nenhum dispositivo encontrado"
```bash
# Verificar dispositivos
adb devices

# Se não aparecer nada, iniciar emulador
emulator -avd Pixel_5_API_33 &
```

### "App não encontrado"
```bash
# Instalar app
npm run android
```

### "Emulador muito lento"
- Use um dispositivo físico
- Ou reduza a resolução do emulador

---

## 📚 Documentação Completa

- **`COMO_FUNCIONA_MAESTRO.md`** - Explicação detalhada
- **`COMO_TESTAR_E_ANALISAR.md`** - Guia completo

---

**Agora você pode ver tudo acontecendo em tempo real! 🎉**













