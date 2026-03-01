# 🧪 Testes E2E com Maestro

Este diretório contém os testes End-to-End (E2E) do projeto Leaf usando Maestro.

## 📁 Estrutura

```
.maestro/
├── flows/           # Fluxos de teste organizados por funcionalidade
│   ├── auth/        # Testes de autenticação
│   ├── rides/       # Testes de corridas
│   └── payments/    # Testes de pagamentos
├── helpers/         # Helpers reutilizáveis
└── README.md        # Este arquivo
```

## 🚀 Como Executar

### Pré-requisitos

1. **Instalar Maestro**:
```bash
curl -Ls "https://get.maestro.mobile.dev" | bash
```

2. **Build do App**:
```bash
cd mobile-app
npx expo run:android  # ou run:ios
```

3. **Emulador/Dispositivo**:
   - Android: Emulador rodando ou dispositivo conectado via USB
   - iOS: Simulador rodando ou dispositivo conectado

### Executar Testes

```bash
# Todos os testes
maestro test .maestro/flows

# Teste específico
maestro test .maestro/flows/auth/01-login-customer.yaml

# Com relatório
maestro test .maestro/flows --format junit --output results.xml

# Em dispositivo específico
maestro test .maestro/flows --device "emulator-5554"
```

### Via NPM Scripts

```bash
npm run test:e2e              # Todos os testes
npm run test:e2e:auth         # Testes de autenticação
npm run test:e2e:rides        # Testes de corridas
npm run test:e2e:payments     # Testes de pagamentos
```

## 📝 Criar Novos Testes

1. **Criar arquivo YAML** na pasta apropriada
2. **Usar helpers** quando possível para reutilização
3. **Seguir convenção de nomes**: `NN-descricao.yaml`
4. **Documentar** o que o teste faz no topo do arquivo

### Exemplo:

```yaml
# Teste: Descrição do que o teste faz
appId: br.com.leaf.ride
---
- launchApp
- assertVisible: "Elemento"
- tapOn: "Botão"
```

## 🔧 Helpers Disponíveis

- `login.yaml`: Login genérico com usuário de teste

## 📊 Relatórios

Os relatórios são gerados em `results.xml` (formato JUnit) e podem ser integrados com CI/CD.

## 🐛 Debugging

Se um teste falhar:

1. **Verificar se o app está rodando**
2. **Verificar se os IDs/textos estão corretos**
3. **Executar com verbose**: `maestro test --debug`
4. **Tirar screenshots**: Adicionar `- takeScreenshot` nos testes

## 📚 Documentação

- [Documentação Maestro](https://maestro.mobile.dev)
- [Guia Completo de Testes E2E](../GUIA_TESTES_E2E.md)













