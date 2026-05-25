# 🧪 Como Testar e Analisar com Maestro

## 📋 Guia Completo Passo a Passo

### 🎯 Objetivo
Este guia te ensina a executar testes E2E, ver as telas em tempo real e analisar os resultados.

---

## 🚀 PASSO 1: Preparar o Ambiente

### 1.1 Verificar se está tudo OK
```bash
cd mobile-app
bash scripts/verify-maestro.sh
```

**O que verificar:**
- ✅ Maestro instalado
- ✅ App instalado no dispositivo
- ✅ Dispositivo conectado

### 1.2 Build do App (se necessário)
```bash
npm run android
```

---

## 🎬 PASSO 2: Executar um Teste Simples

### 2.1 Teste de Login (Mais Simples)

```bash
# Executar teste básico
npm run test:e2e:auth

# Ou teste específico com visualização
bash scripts/run-test-with-viewer.sh .maestro/flows/auth/01-login-customer-real.yaml
```

### 2.2 O que acontece durante o teste:

1. **App abre automaticamente**
2. **Maestro interage com a tela:**
   - Toca em botões
   - Digita texto
   - Aguarda elementos aparecerem
3. **Screenshots são capturados** em cada etapa
4. **Logs são gerados** com todas as ações

---

## 👀 PASSO 3: Ver as Telas Durante o Teste

### 3.1 Modo Visual (Recomendado)

**Opção A: Executar com visualizador**
```bash
bash scripts/run-test-with-viewer.sh .maestro/flows/auth/01-login-customer-real.yaml
```

Este script:
- ✅ Executa o teste
- ✅ Captura screenshots automaticamente
- ✅ Abre a pasta de screenshots ao final
- ✅ Mostra logs em tempo real

**Opção B: Ver dispositivo em tempo real**

1. **Android Studio Device Manager:**
   - Abra Android Studio
   - Vá em `Tools > Device Manager`
   - Clique no dispositivo
   - Veja a tela em tempo real

2. **ADB Screen Mirror:**
   ```bash
   # Ver tela do dispositivo no computador
   adb shell screenrecord /sdcard/screen.mp4
   
   # Ou usar scrcpy (se instalado)
   scrcpy
   ```

### 3.2 Ver Screenshots Após o Teste

```bash
# Ver resultados do último teste
bash scripts/view-test-results.sh

# Ou navegar manualmente
cd .maestro/screenshots
ls -la
# Abra a pasta mais recente
```

---

## 📊 PASSO 4: Analisar Resultados

### 4.1 Estrutura de Resultados

Após executar um teste, você terá:

```
.maestro/screenshots/test_20250101_120000/
├── 01-app-launched.png      # Screenshot inicial
├── 02-login-screen.png       # Tela de login
├── 03-phone-entered.png      # Telefone preenchido
├── test.log                  # Log completo
└── results.xml               # Resultados em XML
```

### 4.2 Como Analisar

#### **A. Ver Screenshots em Sequência**

```bash
# Abrir pasta de screenshots
cd .maestro/screenshots/test_YYYYMMDD_HHMMSS
xdg-open .  # Linux
# ou
open .      # macOS
```

**O que procurar:**
- ✅ Telas aparecem corretamente?
- ✅ Elementos estão visíveis?
- ✅ Textos estão corretos?
- ✅ Botões estão clicáveis?

#### **B. Analisar Logs**

```bash
# Ver log completo
cat .maestro/screenshots/test_*/test.log

# Ver últimas 50 linhas
tail -50 .maestro/screenshots/test_*/test.log

# Procurar erros
grep -i "error\|fail" .maestro/screenshots/test_*/test.log
```

**O que procurar:**
- ❌ `Element not found` - Elemento não encontrado
- ❌ `Timeout` - Tempo esgotado
- ❌ `Assertion failed` - Assertiva falhou
- ✅ `Test passed` - Teste passou

#### **C. Ver Resultados XML**

```bash
# Ver resultados estruturados
cat .maestro/screenshots/test_*/results.xml
```

**Informações importantes:**
- `tests` - Número de testes
- `failures` - Número de falhas
- `time` - Tempo de execução

---

## 🔍 PASSO 5: Debugging (Quando Teste Falha)

### 5.1 Teste Falhou? Veja o que fazer:

#### **Problema: Elemento não encontrado**

**Sintoma:**
```
Element "Entrar" not found
```

**Solução:**
1. **Ver screenshot** da tela no momento do erro
2. **Verificar se o texto está correto** (pode ter mudado)
3. **Verificar se elemento está visível** (pode estar oculto)
4. **Ajustar o teste** com texto correto ou usar `id` ao invés de `text`

**Exemplo de ajuste:**
```yaml
# Antes (pode falhar se texto mudou)
- tapOn: "Entrar"

# Depois (mais robusto)
- tapOn: 
    text: 
      - "Entrar"
      - "Login"
      - "Fazer Login"
```

#### **Problema: Timeout**

**Sintoma:**
```
Timeout waiting for element
```

**Solução:**
1. **Aumentar timeout:**
   ```yaml
   - assertVisible: 
       text: "Dashboard"
       timeout: 30000  # 30 segundos
   ```

2. **Verificar se app está lento:**
   - Ver logs do app
   - Verificar conexão de rede
   - Verificar se há processos pesados

#### **Problema: App não abre**

**Sintoma:**
```
App not found or not installed
```

**Solução:**
```bash
# Verificar se app está instalado
adb shell pm list packages | grep leaf

# Se não estiver, instalar
npm run android

# Verificar appId no teste
# Deve ser: br.com.leaf.ride
```

---

## 📝 PASSO 6: Criar Seus Próprios Testes

### 6.1 Estrutura de um Teste

```yaml
# Nome do teste
appId: br.com.leaf.ride
---
# 1. Abrir app
- launchApp
- takeScreenshot: "01-app-opened"

# 2. Aguardar elemento aparecer
- assertVisible: 
    text: "Botão"
    timeout: 10000

# 3. Interagir
- tapOn: "Botão"
- takeScreenshot: "02-button-tapped"

# 4. Verificar resultado
- assertVisible: 
    text: "Sucesso"
    timeout: 5000
```

### 6.2 Dicas para Criar Testes Robustos

1. **Use screenshots** em cada etapa importante
2. **Use timeouts adequados** (10-15 segundos)
3. **Use `optional: true`** para elementos que podem não aparecer
4. **Use `waitForAnimationToEnd`** após ações que animam
5. **Use múltiplos seletores** quando possível:
   ```yaml
   - tapOn: 
       text: 
         - "Entrar"
         - "Login"
         - "Fazer Login"
   ```

---

## 🎥 PASSO 7: Gravar Vídeo do Teste (Opcional)

### 7.1 Gravar Tela Durante Teste

```bash
# Iniciar gravação antes do teste
adb shell screenrecord /sdcard/test_$(date +%s).mp4 &

# Executar teste
npm run test:e2e:auth

# Parar gravação (Ctrl+C ou)
adb shell pkill -INT screenrecord

# Baixar vídeo
adb pull /sdcard/test_*.mp4 .
```

### 7.2 Usar scrcpy (Melhor Qualidade)

```bash
# Instalar scrcpy (se não tiver)
# Linux: sudo apt install scrcpy
# macOS: brew install scrcpy

# Gravar com scrcpy
scrcpy --record test.mp4
```

---

## 📊 PASSO 8: Relatórios e Estatísticas

### 8.1 Gerar Relatório Completo

```bash
# Executar todos os testes
npm run test:e2e

# Ver resumo
bash scripts/view-test-results.sh
```

### 8.2 Integrar com CI/CD

Os resultados XML podem ser integrados com:
- GitHub Actions
- Jenkins
- GitLab CI
- CircleCI

Exemplo GitHub Actions:
```yaml
- name: Run E2E Tests
  run: npm run test:e2e
  
- name: Upload Results
  uses: actions/upload-artifact@v3
  with:
    name: test-results
    path: .maestro/screenshots/**/*.xml
```

---

## 🎯 Checklist de Teste

Antes de executar um teste:

- [ ] App buildado e instalado
- [ ] Dispositivo conectado
- [ ] Maestro instalado
- [ ] Teste ajustado para UI atual
- [ ] Screenshots habilitados
- [ ] Logs configurados

Durante o teste:

- [ ] Observar dispositivo/emulador
- [ ] Verificar screenshots sendo gerados
- [ ] Monitorar logs em tempo real
- [ ] Anotar problemas encontrados

Após o teste:

- [ ] Revisar screenshots
- [ ] Analisar logs
- [ ] Verificar resultados XML
- [ ] Documentar problemas
- [ ] Ajustar testes se necessário

---

## 🆘 Troubleshooting Rápido

| Problema | Solução |
|----------|---------|
| App não abre | `npm run android` |
| Elemento não encontrado | Ajustar texto/ID no teste |
| Timeout | Aumentar timeout ou verificar app |
| Screenshots não aparecem | Verificar permissões |
| Teste muito lento | Reduzir timeouts ou otimizar app |

---

## 📚 Próximos Passos

1. ✅ Execute um teste simples primeiro
2. ✅ Veja os screenshots gerados
3. ✅ Analise os logs
4. ✅ Ajuste os testes conforme necessário
5. ✅ Crie mais testes para outros fluxos

**Dúvidas?** Consulte:
- `GUIA_TESTES_E2E.md` - Documentação completa
- `QUICK_START_MAESTRO.md` - Início rápido
- https://maestro.mobile.dev - Documentação oficial













