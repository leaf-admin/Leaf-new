# 🎭 Como Funciona o Maestro - Explicação Completa

## 🎯 O que é o Maestro?

O **Maestro** é uma ferramenta que **controla seu app automaticamente**, como se fosse um usuário real tocando na tela, mas de forma programada.

---

## 🔧 Como Funciona na Prática?

### 1. **Conexão com Dispositivo/Emulador**

O Maestro se conecta ao seu dispositivo ou emulador via **ADB** (Android Debug Bridge):

```
┌─────────────┐         ADB          ┌──────────────┐
│   Maestro   │ ◄──────────────────► │  Dispositivo │
│  (Terminal)  │                      │  / Emulador  │
└─────────────┘                      └──────────────┘
```

**O que isso significa?**
- ✅ Você **PRECISA** ter um dispositivo/emulador rodando
- ✅ O Maestro **não cria** um simulador, ele **usa** o que você já tem
- ✅ Você pode ver tudo acontecendo em tempo real no dispositivo

### 2. **Execução de Comandos**

Quando você executa um teste, o Maestro:

1. **Abre o app** no dispositivo
2. **Procura elementos** na tela (botões, textos, etc.)
3. **Interage** com eles (toca, digita, etc.)
4. **Aguarda** elementos aparecerem
5. **Captura screenshots** (se configurado)

**Tudo isso acontece VISUALMENTE no seu dispositivo/emulador!**

---

## 👀 Como Ver as Telas em Tempo Real?

### **Opção 1: Emulador Android (Recomendado para Início)**

#### Passo 1: Criar/Iniciar Emulador

```bash
# Ver emuladores disponíveis
emulator -list-avds

# Iniciar um emulador (substitua pelo nome do seu)
emulator -avd Pixel_5_API_33 &

# Ou via Android Studio:
# Tools > Device Manager > Create Device > Escolher dispositivo > Start
```

#### Passo 2: Ver Tela do Emulador

O emulador abre uma **janela** mostrando a tela do dispositivo. Você vê tudo em tempo real!

#### Passo 3: Executar Teste

```bash
# Em outro terminal, executar o teste
cd mobile-app
bash scripts/run-test-with-viewer.sh .maestro/flows/auth/01-login-customer-real.yaml
```

**O que você verá:**
- ✅ Emulador abre automaticamente
- ✅ App abre no emulador
- ✅ Você vê cada ação acontecendo:
  - Botões sendo tocados
  - Textos sendo digitados
  - Telas mudando
  - Animações rodando

### **Opção 2: Dispositivo Físico**

#### Passo 1: Conectar Dispositivo

```bash
# Conectar dispositivo via USB
# Habilitar "Depuração USB" nas opções de desenvolvedor

# Verificar se está conectado
adb devices
```

#### Passo 2: Ver Tela no Computador

**Opção A: scrcpy (Melhor Qualidade)**
```bash
# Instalar scrcpy
sudo apt install scrcpy  # Linux
# ou
brew install scrcpy      # macOS

# Ver tela em tempo real
scrcpy
```

**Opção B: Android Studio**
- Abra Android Studio
- `Tools > Device Manager`
- Clique no dispositivo
- Veja a tela em tempo real

#### Passo 3: Executar Teste

```bash
cd mobile-app
bash scripts/run-test-with-viewer.sh .maestro/flows/auth/01-login-customer-real.yaml
```

### **Opção 3: Gravar Vídeo Durante Teste**

```bash
# Iniciar gravação ANTES do teste
adb shell screenrecord /sdcard/test.mp4 &

# Executar teste
bash scripts/run-test-with-viewer.sh .maestro/flows/auth/01-login-customer-real.yaml

# Parar gravação (Ctrl+C)
# Baixar vídeo
adb pull /sdcard/test.mp4 ./test-video.mp4
```

---

## 🎬 Fluxo Completo de um Teste

### O que acontece passo a passo:

```
1. Você executa: maestro test login.yaml
   ↓
2. Maestro verifica dispositivo conectado
   ↓
3. Maestro abre o app no dispositivo
   ↓
4. Você VÊ o app abrindo no emulador/dispositivo
   ↓
5. Maestro procura elemento "Telefone"
   ↓
6. Maestro toca no campo "Telefone"
   ↓
7. Você VÊ o campo sendo tocado (foco aparece)
   ↓
8. Maestro digita "11999999999"
   ↓
9. Você VÊ os números aparecendo no campo
   ↓
10. Maestro toca em "Continuar"
    ↓
11. Você VÊ a tela mudando
    ↓
12. E assim por diante...
```

**TUDO é VISUAL! Você vê cada ação acontecendo!**

---

## 📸 Screenshots Automáticos

O Maestro pode capturar screenshots em cada etapa:

```yaml
- launchApp
- takeScreenshot: "01-app-opened"    # Screenshot 1
- tapOn: "Botão"
- takeScreenshot: "02-button-tapped"  # Screenshot 2
```

**Onde ficam os screenshots?**
```
.maestro/screenshots/test_20260101_120000/
├── 01-app-opened.png
├── 02-button-tapped.png
└── ...
```

**Você pode ver todos os screenshots depois!**

---

## 🎥 Exemplo Prático: Ver Teste em Tempo Real

### Setup Completo:

```bash
# 1. Iniciar emulador (em um terminal)
emulator -avd Pixel_5_API_33 &

# 2. Aguardar emulador iniciar (30-60 segundos)
# Você verá a tela do Android aparecer

# 3. Instalar app no emulador (se necessário)
cd mobile-app
npm run android

# 4. Executar teste (em outro terminal)
bash scripts/run-test-with-viewer.sh .maestro/flows/auth/01-login-customer-real.yaml
```

### O que você verá:

1. **Emulador já está aberto** mostrando a tela do Android
2. **Teste inicia** → App abre automaticamente no emulador
3. **Você vê cada ação:**
   - App abrindo
   - Tela de login aparecendo
   - Campo de telefone sendo tocado
   - Números sendo digitados
   - Botão sendo pressionado
   - Próxima tela aparecendo
   - E assim por diante...

**É como assistir alguém usando o app, mas automatizado!**

---

## 🔍 Diferença: Simulador vs Emulador vs Dispositivo Real

| Tipo | O que é | Como Ver |
|------|---------|-----------|
| **Emulador Android** | Software que simula dispositivo Android | Janela do emulador mostra tudo |
| **Simulador iOS** | Software que simula iPhone/iPad | Janela do simulador mostra tudo |
| **Dispositivo Real** | Celular físico conectado | Ver via scrcpy ou Android Studio |

**Para começar:** Use um **emulador Android** (mais fácil de configurar)

---

## 🛠️ Configurar Emulador Android (Passo a Passo)

### Via Android Studio:

1. **Abrir Android Studio**
2. **Tools > Device Manager**
3. **Create Device**
4. **Escolher dispositivo** (ex: Pixel 5)
5. **Escolher versão Android** (ex: API 33)
6. **Finish**
7. **Start** (botão play ▶️)

### Via Linha de Comando:

```bash
# Listar emuladores disponíveis
emulator -list-avds

# Iniciar emulador
emulator -avd NOME_DO_EMULADOR &

# Ver dispositivos conectados
adb devices
```

---

## 📱 Verificar se Está Funcionando

```bash
# 1. Verificar se emulador/dispositivo está conectado
adb devices
# Deve mostrar algo como:
# emulator-5554    device

# 2. Verificar se app está instalado
adb shell pm list packages | grep leaf
# Deve mostrar:
# package:br.com.leaf.ride

# 3. Executar teste simples
maestro test .maestro/flows/auth/01-login-customer-real.yaml
```

---

## 🎯 Resumo: Como Funciona

1. **Maestro NÃO cria simulador** - Ele usa o que você já tem
2. **Você PRECISA ter emulador/dispositivo rodando**
3. **Você VÊ tudo acontecendo** em tempo real
4. **Screenshots são salvos** para análise depois
5. **É como assistir alguém usando o app** de forma automatizada

---

## 🚀 Próximos Passos

1. ✅ **Configurar emulador** (Android Studio ou linha de comando)
2. ✅ **Iniciar emulador** e ver a tela
3. ✅ **Executar teste** e observar em tempo real
4. ✅ **Ver screenshots** após o teste
5. ✅ **Ajustar testes** conforme necessário

**Agora você entende como funciona! 🎉**













