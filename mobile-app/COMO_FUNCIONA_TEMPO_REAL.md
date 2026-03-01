# 👀 Como Funciona o Tempo Real no Maestro

## 🎯 Sim, é TEMPO REAL!

Quando o Maestro funciona, você **VÊ cada ação acontecendo** no seu celular em tempo real:

1. ✅ **App abre** automaticamente
2. ✅ **Você vê** botões sendo tocados
3. ✅ **Você vê** textos sendo digitados
4. ✅ **Você vê** telas mudando
5. ✅ **Screenshots são capturados** automaticamente

**É como assistir alguém usando o app, mas automatizado!**

---

## ❌ Por Que Não Está Funcionando?

O teste **falhou ANTES de começar** por causa do erro de permissão:

```
INSTALL_FAILED_USER_RESTRICTED
```

O Maestro precisa instalar um app auxiliar primeiro, mas o celular está bloqueando.

**Por isso nada apareceu no celular ainda!**

---

## ✅ Como Fazer Funcionar

### Passo 1: Resolver Permissão

**No seu celular Redmi:**

1. **Configurações > Opções do desenvolvedor**
   - Ativar **"Instalar via USB"**
   - Ativar **"Depuração USB"** (se não estiver)

2. **Configurações > Apps > Gerenciar apps > Especial > Acesso à instalação**
   - Permitir para **"ADB"** ou **"Depuração USB"**

3. **Desbloqueie a tela** e mantenha ligada

### Passo 2: Testar Manualmente Primeiro

Vamos testar se o app abre manualmente:

```bash
# Abrir app manualmente
adb shell am start -n br.com.leaf.ride/.MainActivity
```

**Você deve ver o app abrindo no celular!**

### Passo 3: Executar Teste Maestro

```bash
cd mobile-app
npm run test:e2e:device .maestro/flows/test-simple-launch.yaml
```

**Agora você VAI VER:**
- ✅ App abrindo no celular
- ✅ Screenshots sendo capturados
- ✅ Cada ação acontecendo em tempo real

---

## 📸 Screenshots Automáticos

O Maestro captura screenshots automaticamente em cada etapa:

```
.maestro/screenshots/test_20260101_120000/
├── app-opened.png      # App aberto
├── app-loaded.png      # App carregado
└── ...
```

**Você pode ver depois em:**
```bash
bash scripts/view-test-results.sh
```

---

## 🎬 O Que Você Vai Ver Quando Funcionar

### No Celular (Tempo Real):
1. App abre automaticamente
2. Tela de login aparece
3. Campo de telefone é tocado (foco aparece)
4. Números são digitados (você vê aparecendo)
5. Botão é pressionado
6. Próxima tela aparece
7. E assim por diante...

### No Terminal:
```
Launch app "br.com.leaf.ride"... COMPLETED
Take screenshot 01-app-launched... COMPLETED
Assert that "Telefone" is visible... COMPLETED
Tap on "Telefone"... COMPLETED
Input text 11999999999... COMPLETED
...
```

### Screenshots:
- Capturados automaticamente
- Um para cada ação importante
- Salvos em `.maestro/screenshots/`

---

## 🔧 Resolver o Problema Agora

### Opção 1: Configurar Permissões (Recomendado)

1. **No celular:**
   - Configurações > Opções do desenvolvedor
   - Ativar "Instalar via USB"

2. **Aceitar popup** (se aparecer)

3. **Testar novamente:**
   ```bash
   npm run test:e2e:device .maestro/flows/test-simple-launch.yaml
   ```

### Opção 2: Testar App Manualmente Primeiro

```bash
# Ver se app abre
adb shell am start -n br.com.leaf.ride/.MainActivity

# Se abrir = app funciona
# Se não abrir = precisa buildar versão standalone
```

---

## 💡 Resumo

**SIM, é tempo real!** Mas precisa:

1. ✅ Resolver erro de permissão primeiro
2. ✅ App standalone instalado
3. ✅ Tela do celular desbloqueada

**Depois disso, você VAI VER tudo acontecendo no celular em tempo real!** 🎬













