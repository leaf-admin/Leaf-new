# 📱 Usar Dispositivo Físico com Maestro

## ✅ Seu Dispositivo Está Conectado!

**Dispositivo detectado:**
- **Modelo:** Redmi 2409BRN2CL
- **Android:** 15
- **Serial:** 8DZLY9XSJLVDAX8
- **App:** ✅ Instalado

---

## 🚀 Como Executar Teste no Seu Celular

### Opção 1: Script Automático (Recomendado)

```bash
cd mobile-app

# Executar teste e ver tudo no celular
npm run test:e2e:device .maestro/flows/auth/01-login-customer-real.yaml

# Ou manualmente
bash scripts/run-test-device.sh .maestro/flows/auth/01-login-customer-real.yaml
```

**O que acontece:**
1. ✅ Script detecta seu dispositivo automaticamente
2. ✅ Verifica se app está instalado
3. ✅ Oferece abrir scrcpy (para ver tela no PC)
4. ✅ Executa teste no seu celular
5. ✅ Você vê cada ação acontecendo na tela do celular

### Opção 2: Ver Tela no PC (scrcpy)

**Instalar scrcpy:**
```bash
sudo apt install scrcpy  # Linux
```

**Usar:**
```bash
# Abrir scrcpy (mostra tela do celular no PC)
scrcpy

# Em outro terminal, executar teste
npm run test:e2e:device .maestro/flows/auth/01-login-customer-real.yaml
```

**Vantagens:**
- ✅ Vê a tela do celular no computador
- ✅ Pode gravar vídeo
- ✅ Melhor para apresentações

---

## 👀 Como Ver as Telas em Tempo Real

### Opção 1: Diretamente no Celular (Mais Simples)

1. **Desbloqueie a tela** do celular
2. **Mantenha a tela ligada** durante o teste
3. **Observe o celular** - você verá cada ação:
   - App abrindo
   - Botões sendo tocados
   - Textos sendo digitados
   - Telas mudando

**É como assistir alguém usando o app!** 🎬

### Opção 2: Via scrcpy (Tela no PC)

```bash
# Terminal 1: Abrir scrcpy
scrcpy

# Terminal 2: Executar teste
npm run test:e2e:device .maestro/flows/auth/01-login-customer-real.yaml
```

Você verá a tela do celular em uma janela no PC!

---

## 🎬 Exemplo Completo

```bash
cd mobile-app

# 1. Verificar conexão
adb devices
# Deve mostrar: 8DZLY9XSJLVDAX8    device

# 2. Executar teste
npm run test:e2e:device .maestro/flows/auth/01-login-customer-real.yaml

# 3. Observar o celular
# Você verá:
#   - App abrindo
#   - Tela de login aparecendo
#   - Campo sendo tocado
#   - Números sendo digitados
#   - Botão sendo pressionado
#   - Próxima tela aparecendo
```

---

## 📸 Screenshots Automáticos

Durante o teste, screenshots são capturados automaticamente:

```
.maestro/screenshots/test_20260101_120000/
├── 01-app-launched.png
├── 02-login-screen.png
├── 03-phone-entered.png
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
npm run test:e2e:device .maestro/flows/auth/01-login-customer-real.yaml

# Parar gravação (Ctrl+C)
# Baixar vídeo
adb pull /sdcard/test.mp4 ./test-video.mp4
```

---

## ✅ Checklist

Antes de executar:

- [x] Dispositivo conectado via USB
- [x] Depuração USB habilitada
- [x] App instalado no dispositivo
- [ ] Tela do celular desbloqueada
- [ ] Tela ligada durante o teste

Durante o teste:

- [ ] Observar celular (ou janela scrcpy)
- [ ] Ver cada ação acontecendo
- [ ] Screenshots sendo gerados

---

## 🆘 Problemas Comuns

### "Dispositivo não encontrado"
```bash
# Verificar conexão
adb devices

# Se não aparecer:
# 1. Reconecte o cabo USB
# 2. Habilite "Depuração USB" nas opções do desenvolvedor
# 3. Autorize o computador (popup no celular)
```

### "App não encontrado"
```bash
# Instalar app
npm run android
```

### "Tela não aparece"
- Desbloqueie a tela do celular
- Mantenha a tela ligada
- Ou use scrcpy para ver no PC

---

## 🎯 Resumo

**Seu dispositivo está pronto!** ✅

**Para executar teste:**
```bash
npm run test:e2e:device .maestro/flows/auth/01-login-customer-real.yaml
```

**Para ver tela no PC:**
```bash
scrcpy  # Em um terminal
# Depois execute o teste em outro terminal
```

**Agora você pode ver tudo acontecendo em tempo real no seu celular!** 🎉













