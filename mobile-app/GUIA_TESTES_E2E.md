# 🧪 GUIA COMPLETO: Testes End-to-End (E2E) para React Native

## 📋 ÍNDICE
1. [Visão Geral das Ferramentas](#visão-geral)
2. [Maestro.dev](#maestro)
3. [Detox](#detox)
4. [Outras Ferramentas](#outras-ferramentas)
5. [Comparação](#comparação)
6. [Recomendação para o Projeto Leaf](#recomendação)
7. [Guia de Implementação](#implementação)

---

## 🎯 VISÃO GERAL DAS FERRAMENTAS

### O que são Testes E2E?
Testes End-to-End simulam o comportamento real de um usuário, testando o fluxo completo da aplicação do início ao fim, incluindo:
- ✅ Navegação entre telas
- ✅ Interações com UI (toques, gestos, inputs)
- ✅ Integração com APIs e serviços externos
- ✅ Funcionalidades nativas (câmera, GPS, notificações)

---

## 🎭 MAESTRO.DEV

### O que é?
**Maestro** é uma ferramenta de testes E2E **declarativa e baseada em YAML** que funciona como um "usuário virtual" interagindo com o app.

### Como Funciona?
1. **Arquivos YAML**: Você escreve testes em formato YAML simples e legível
2. **Fluxo Declarativo**: Descreve o que fazer, não como fazer
3. **Sem Código**: Não precisa escrever código JavaScript/TypeScript
4. **Cross-Platform**: Funciona em iOS e Android
5. **Sem Build Especial**: Testa o app real (não precisa de build especial)

### Exemplo Maestro:
```yaml
appId: br.com.leaf.ride
---
- launchApp
- tapOn: "Entrar"
- inputText: "11999999999"
- tapOn: "Continuar"
- assertVisible: "Dashboard"
- tapOn: "Solicitar Corrida"
- assertVisible: "Mapa"
```

### Vantagens ✅
- ✅ **Muito fácil de aprender** - YAML é simples
- ✅ **Rápido para escrever** - Menos código
- ✅ **Não precisa modificar o app** - Testa build de produção
- ✅ **Boa documentação** - Comunidade ativa
- ✅ **Gratuito e Open Source**
- ✅ **Funciona com Expo** - Sem configuração especial
- ✅ **Suporta gestos complexos** - Swipe, scroll, etc.

### Desvantagens ❌
- ❌ **Menos flexível** - Limitado ao que o YAML oferece
- ❌ **Menos controle programático** - Difícil fazer lógica complexa
- ❌ **Debugging limitado** - Menos ferramentas de debug
- ❌ **Menos integração com CI/CD** - Comparado ao Detox

### Quando Usar?
- ✅ Equipe não técnica ou QA manual
- ✅ Testes de regressão visual
- ✅ Testes de smoke (fluxos críticos)
- ✅ Validação rápida de funcionalidades
- ✅ Documentação viva dos fluxos

---

## 🔬 DETOX

### O que é?
**Detox** é um framework de testes E2E **programático** desenvolvido pelo Wix, focado em testes estáveis e rápidos.

### Como Funciona?
1. **Código JavaScript/TypeScript**: Escreve testes como código
2. **Build Especial**: Precisa de um build de teste (test build)
3. **Sincronização Automática**: Aguarda ações completarem automaticamente
4. **Mocking Nativo**: Pode mockar APIs nativas
5. **Integração com Jest**: Usa Jest como test runner

### Exemplo Detox:
```javascript
describe('Login Flow', () => {
  beforeAll(async () => {
    await device.launchApp();
  });

  it('should login successfully', async () => {
    await element(by.id('login-button')).tap();
    await element(by.id('phone-input')).typeText('11999999999');
    await element(by.id('continue-button')).tap();
    await expect(element(by.id('dashboard'))).toBeVisible();
  });
});
```

### Vantagens ✅
- ✅ **Muito poderoso** - Controle total programático
- ✅ **Testes estáveis** - Sincronização automática
- ✅ **Boa integração CI/CD** - GitHub Actions, etc.
- ✅ **Mocking avançado** - Pode mockar APIs nativas
- ✅ **Suporte a testes complexos** - Lógica condicional, loops
- ✅ **Bom para testes unitários E2E** - Integração com Jest
- ✅ **Debugging avançado** - Logs detalhados

### Desvantagens ❌
- ❌ **Curva de aprendizado** - Precisa saber JavaScript/TypeScript
- ❌ **Configuração complexa** - Precisa configurar build de teste
- ❌ **Mais lento para escrever** - Mais código necessário
- ❌ **Pode ser instável** - Depende de sincronização
- ❌ **Build especial necessário** - Não testa build de produção diretamente

### Quando Usar?
- ✅ Testes automatizados em CI/CD
- ✅ Testes complexos com lógica
- ✅ Equipe técnica (devs)
- ✅ Testes de performance
- ✅ Testes que precisam de mocking

---

## 🔧 OUTRAS FERRAMENTAS

### 1. **Appium** 🚗
- **O que é**: Framework de automação mobile mais antigo
- **Vantagens**: Muito maduro, suporta muitos dispositivos
- **Desvantagens**: Complexo, lento, difícil de configurar
- **Quando usar**: Projetos enterprise grandes, múltiplas plataformas

### 2. **Appium Inspector** 🔍
- **O que é**: Ferramenta visual para criar testes Appium
- **Vantagens**: Interface gráfica, fácil de usar
- **Desvantagens**: Limitado, menos flexível

### 3. **Cypress (Web)** 🌐
- **O que é**: Framework para testes web
- **Vantagens**: Muito fácil de usar, ótima DX
- **Desvantagens**: Não funciona nativamente com React Native (só web)

### 4. **Playwright** 🎭
- **O que é**: Framework moderno para testes web
- **Vantagens**: Rápido, confiável, boa documentação
- **Desvantagens**: Não suporta React Native nativamente

### 5. **React Native Testing Library** 🧪
- **O que é**: Biblioteca para testes de componentes
- **Vantagens**: Ótima para testes unitários e de integração
- **Desvantagens**: Não é E2E, testa componentes isolados

### 6. **Jest + React Native** ⚡
- **O que é**: Framework de testes unitários
- **Vantagens**: Padrão do React Native, rápido
- **Desvantagens**: Não é E2E, não testa UI real

---

## 📊 COMPARAÇÃO DETALHADA

| Característica | Maestro | Detox | Appium |
|----------------|---------|-------|--------|
| **Facilidade de Uso** | ⭐⭐⭐⭐⭐ | ⭐⭐⭐ | ⭐⭐ |
| **Velocidade de Escrita** | ⭐⭐⭐⭐⭐ | ⭐⭐⭐ | ⭐⭐ |
| **Poder/Flexibilidade** | ⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐ |
| **Estabilidade** | ⭐⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐ |
| **CI/CD Integration** | ⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐ |
| **Documentação** | ⭐⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐ |
| **Comunidade** | ⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ |
| **Suporte Expo** | ⭐⭐⭐⭐⭐ | ⭐⭐⭐ | ⭐⭐ |
| **Custo** | Gratuito | Gratuito | Gratuito |

---

## 🎯 RECOMENDAÇÃO PARA O PROJETO LEAF

### **Recomendação: MAESTRO** 🏆

### Por quê?

1. **Projeto Expo**: Maestro funciona perfeitamente com Expo sem configuração especial
2. **Facilidade**: Equipe pode começar a escrever testes rapidamente
3. **Testa Build Real**: Testa o APK/IPA de produção, não precisa de build especial
4. **Fluxos Complexos**: O Leaf tem fluxos complexos (corrida, pagamento, chat) que são fáceis de testar no Maestro
5. **Documentação Viva**: Os testes YAML servem como documentação dos fluxos

### Estratégia Híbrida Recomendada:

```
┌─────────────────────────────────────┐
│  MAESTRO (E2E Principal)            │
│  - Fluxos críticos                   │
│  - Testes de regressão               │
│  - Validação de UI                   │
└─────────────────────────────────────┘
           +
┌─────────────────────────────────────┐
│  JEST (Testes Unitários)             │
│  - Lógica de negócio                 │
│  - Serviços                          │
│  - Utilitários                       │
└─────────────────────────────────────┘
           +
┌─────────────────────────────────────┐
│  TESTING LIBRARY (Componentes)      │
│  - Componentes isolados              │
│  - Hooks                             │
└─────────────────────────────────────┘
```

---

## 🚀 IMPLEMENTAÇÃO: MAESTRO NO PROJETO LEAF

### Passo 1: Instalação

```bash
cd mobile-app

# Instalar Maestro CLI
curl -Ls "https://get.maestro.mobile.dev" | bash

# Ou via Homebrew (macOS)
brew tap mobile-dev-inc/tap
brew install maestro

# Verificar instalação
maestro --version
```

### Passo 2: Estrutura de Diretórios

```bash
mkdir -p .maestro/flows
mkdir -p .maestro/screenshots
```

### Passo 3: Criar Primeiro Teste

Criar arquivo: `.maestro/flows/01-login-flow.yaml`

```yaml
appId: br.com.leaf.ride
---
- launchApp
- assertVisible: "Entrar"
- tapOn: "Entrar"
- assertVisible: "Telefone"
- inputText: "11999999999"
- tapOn: "Continuar"
- assertVisible: "Código"
- inputText: "123456"
- tapOn: "Verificar"
- assertVisible: "Dashboard"
```

### Passo 4: Teste de Fluxo de Corrida

Criar arquivo: `.maestro/flows/02-ride-flow.yaml`

```yaml
appId: br.com.leaf.ride
---
- launchApp
# Login (assumindo que já está logado ou usar helper)
- tapOn: "Solicitar Corrida"
- assertVisible: "Mapa"
- tapOn: "Origem"
- inputText: "Rua das Flores, 123"
- tapOn: "Destino"
- inputText: "Avenida Paulista, 1000"
- tapOn: "Confirmar"
- assertVisible: "Motoristas Disponíveis"
- tapOn: "Confirmar Corrida"
- assertVisible: "Aguardando Motorista"
```

### Passo 5: Executar Testes

```bash
# Executar todos os testes
maestro test .maestro/flows

# Executar teste específico
maestro test .maestro/flows/01-login-flow.yaml

# Executar com relatório
maestro test .maestro/flows --format junit --output results.xml

# Executar em dispositivo específico
maestro test .maestro/flows --device "emulator-5554"
```

### Passo 6: Adicionar ao package.json

```json
{
  "scripts": {
    "test:e2e": "maestro test .maestro/flows",
    "test:e2e:login": "maestro test .maestro/flows/01-login-flow.yaml",
    "test:e2e:ride": "maestro test .maestro/flows/02-ride-flow.yaml"
  }
}
```

---

## 🔬 IMPLEMENTAÇÃO: DETOX (Alternativa)

Se preferir Detox, aqui está como configurar:

### Passo 1: Instalação

```bash
cd mobile-app

# Instalar Detox
npm install --save-dev detox

# Instalar dependências do Detox
npm install --save-dev jest-circus

# Instalar appium (dependência do Detox)
npm install --save-dev appium
```

### Passo 2: Configuração

Criar arquivo: `.detoxrc.js`

```javascript
module.exports = {
  testRunner: {
    args: {
      '$0': 'jest',
      config: 'e2e/jest.config.js'
    },
    jest: {
      setupTimeout: 120000
    }
  },
  apps: {
    'android.debug': {
      type: 'android.apk',
      binaryPath: 'android/app/build/outputs/apk/debug/app-debug.apk',
      build: 'cd android && ./gradlew assembleDebug assembleAndroidTest -DtestBuildType=debug'
    },
    'ios.debug': {
      type: 'ios.app',
      binaryPath: 'ios/build/Build/Products/Debug-iphonesimulator/LeafApp.app',
      build: 'xcodebuild -workspace ios/LeafApp.xcworkspace -scheme LeafApp -configuration Debug -sdk iphonesimulator -derivedDataPath ios/build'
    }
  },
  devices: {
    emulator: {
      type: 'android.emulator',
      device: {
        avdName: 'Pixel_5_API_33'
      }
    },
    simulator: {
      type: 'ios.simulator',
      device: {
        type: 'iPhone 14 Pro'
      }
    }
  },
  configurations: {
    'android.emu.debug': {
      device: 'emulator',
      app: 'android.debug'
    },
    'ios.sim.debug': {
      device: 'simulator',
      app: 'ios.debug'
    }
  }
};
```

### Passo 3: Criar Teste Detox

Criar arquivo: `e2e/login.e2e.js`

```javascript
describe('Login Flow', () => {
  beforeAll(async () => {
    await device.launchApp();
  });

  beforeEach(async () => {
    await device.reloadReactNative();
  });

  it('should login successfully', async () => {
    await expect(element(by.id('login-button'))).toBeVisible();
    await element(by.id('login-button')).tap();
    
    await expect(element(by.id('phone-input'))).toBeVisible();
    await element(by.id('phone-input')).typeText('11999999999');
    
    await element(by.id('continue-button')).tap();
    
    await expect(element(by.id('otp-input'))).toBeVisible();
    await element(by.id('otp-input')).typeText('123456');
    
    await element(by.id('verify-button')).tap();
    
    await expect(element(by.id('dashboard'))).toBeVisible();
  });
});
```

### Passo 4: Executar Testes Detox

```bash
# Build e test
detox build --configuration android.emu.debug
detox test --configuration android.emu.debug

# Ou adicionar ao package.json
{
  "scripts": {
    "test:detox": "detox test --configuration android.emu.debug",
    "test:detox:build": "detox build --configuration android.emu.debug"
  }
}
```

---

## 📝 EXEMPLOS DE TESTES PARA O LEAF

### Teste 1: Login Completo (Maestro)

```yaml
appId: br.com.leaf.ride
---
- launchApp
- assertVisible: 
    id: "login-screen"
- tapOn: 
    id: "phone-input"
- inputText: "11999999999"
- tapOn: 
    id: "continue-button"
- assertVisible: 
    id: "otp-screen"
- inputText: "123456"
- tapOn: 
    id: "verify-button"
- assertVisible: 
    id: "dashboard"
```

### Teste 2: Solicitar Corrida (Maestro)

```yaml
appId: br.com.leaf.ride
---
- launchApp
# Assumindo que já está logado
- tapOn: 
    id: "request-ride-button"
- assertVisible: 
    id: "map-view"
- tapOn: 
    id: "origin-input"
- inputText: "Rua das Flores, 123, São Paulo"
- tapOn: 
    id: "destination-input"
- inputText: "Avenida Paulista, 1000, São Paulo"
- tapOn: 
    id: "confirm-ride-button"
- assertVisible: 
    text: "Motoristas Disponíveis"
```

### Teste 3: Chat Durante Corrida (Maestro)

```yaml
appId: br.com.leaf.ride
---
- launchApp
# Assumindo que há uma corrida ativa
- tapOn: 
    id: "chat-button"
- assertVisible: 
    id: "chat-screen"
- tapOn: 
    id: "message-input"
- inputText: "Olá, estou chegando!"
- tapOn: 
    id: "send-button"
- assertVisible: 
    text: "Olá, estou chegando!"
```

---

## 🔄 INTEGRAÇÃO COM CI/CD

### GitHub Actions com Maestro

Criar arquivo: `.github/workflows/e2e-tests.yml`

```yaml
name: E2E Tests

on:
  push:
    branches: [ main, develop ]
  pull_request:
    branches: [ main ]

jobs:
  e2e-tests:
    runs-on: ubuntu-latest
    
    steps:
      - uses: actions/checkout@v3
      
      - name: Setup Java
        uses: actions/setup-java@v3
        with:
          java-version: '17'
          
      - name: Setup Android SDK
        uses: android-actions/setup-android@v2
        with:
          api-level: 33
          
      - name: Install Maestro
        run: |
          curl -Ls "https://get.maestro.mobile.dev" | bash
          
      - name: Build APK
        run: |
          cd mobile-app
          npm install
          npx expo run:android --no-build-cache
          
      - name: Start Emulator
        uses: reactivecircus/android-emulator-runner@v2
        with:
          api-level: 33
          arch: x86_64
          profile: Nexus 6
          
      - name: Run E2E Tests
        run: |
          cd mobile-app
          maestro test .maestro/flows
```

---

## 🎨 BOAS PRÁTICAS

### 1. **Organização de Testes**
```
.maestro/
├── flows/
│   ├── 01-auth/
│   │   ├── login.yaml
│   │   └── logout.yaml
│   ├── 02-rides/
│   │   ├── request-ride.yaml
│   │   └── complete-ride.yaml
│   └── 03-payments/
│       └── payment-flow.yaml
└── helpers/
    └── login.yaml
```

### 2. **Reutilização com Helpers**

Criar: `.maestro/helpers/login.yaml`
```yaml
- launchApp
- tapOn: "Entrar"
- inputText: "11999999999"
- tapOn: "Continuar"
- inputText: "123456"
- tapOn: "Verificar"
```

Usar em outros testes:
```yaml
appId: br.com.leaf.ride
---
- runFlow: ".maestro/helpers/login.yaml"
- tapOn: "Solicitar Corrida"
```

### 3. **Testes de Regressão**
- ✅ Testar fluxos críticos antes de cada release
- ✅ Testar em diferentes dispositivos
- ✅ Testar em diferentes versões do Android/iOS

### 4. **Manutenção**
- ✅ Atualizar testes quando UI muda
- ✅ Usar IDs estáveis (não textos que mudam)
- ✅ Documentar testes complexos

---

## 📚 RECURSOS ADICIONAIS

### Documentação Oficial
- **Maestro**: https://maestro.mobile.dev
- **Detox**: https://wix.github.io/Detox
- **Appium**: https://appium.io

### Comunidade
- **Maestro Discord**: https://discord.gg/maestro
- **Detox GitHub**: https://github.com/wix/Detox

---

## ✅ CONCLUSÃO

Para o projeto **Leaf**, recomendo:

1. **Começar com Maestro** - Mais fácil, rápido de implementar
2. **Manter Jest** - Para testes unitários existentes
3. **Adicionar Testing Library** - Para testes de componentes
4. **Considerar Detox depois** - Se precisar de mais controle programático

**Próximos Passos:**
1. Instalar Maestro
2. Criar testes para fluxos críticos (login, corrida, pagamento)
3. Integrar com CI/CD
4. Expandir cobertura gradualmente













