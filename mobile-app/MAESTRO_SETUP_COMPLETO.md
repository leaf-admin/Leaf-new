# ✅ Maestro E2E - Setup Completo

## 🎉 Status: Tudo Pronto!

O Maestro foi instalado e configurado com sucesso no projeto Leaf.

## 📦 O que foi instalado

- ✅ **Maestro CLI** (versão 2.0.10)
- ✅ **Estrutura de diretórios** para testes
- ✅ **Exemplos de testes** para os fluxos principais
- ✅ **Scripts NPM** para executar testes
- ✅ **Scripts de setup e verificação**

## 📁 Estrutura Criada

```
mobile-app/
├── .maestro/
│   ├── flows/
│   │   ├── auth/
│   │   │   ├── 01-login-customer.yaml
│   │   │   └── 02-login-driver.yaml
│   │   ├── rides/
│   │   │   ├── 01-request-ride.yaml
│   │   │   └── 02-chat-during-ride.yaml
│   │   └── payments/
│   │       └── 01-payment-flow.yaml
│   ├── helpers/
│   │   └── login.yaml
│   ├── config.yaml
│   └── README.md
├── scripts/
│   ├── setup-maestro.sh
│   └── verify-maestro.sh
├── GUIA_TESTES_E2E.md
└── QUICK_START_MAESTRO.md
```

## 🚀 Como Usar

### 1. Verificar Configuração

```bash
cd mobile-app
bash scripts/verify-maestro.sh
```

### 2. Executar Testes

```bash
# Todos os testes
npm run test:e2e

# Testes específicos
npm run test:e2e:auth      # Autenticação
npm run test:e2e:rides      # Corridas
npm run test:e2e:payments  # Pagamentos

# Modo debug
npm run test:e2e:debug
```

### 3. Criar Novos Testes

Crie arquivos YAML em `.maestro/flows/` seguindo os exemplos existentes.

## 📝 Scripts Disponíveis

| Script | Descrição |
|--------|-----------|
| `npm run test:e2e` | Executa todos os testes E2E |
| `npm run test:e2e:auth` | Testes de autenticação |
| `npm run test:e2e:rides` | Testes de corridas |
| `npm run test:e2e:payments` | Testes de pagamentos |
| `npm run test:e2e:debug` | Executa testes em modo debug |
| `bash scripts/setup-maestro.sh` | Reinstala/configura Maestro |
| `bash scripts/verify-maestro.sh` | Verifica configuração |

## 🔧 Ajustes Necessários

Os testes foram criados com seletores genéricos. **Ajuste conforme sua UI real:**

1. **IDs de elementos**: Adicione `testID` nos componentes React Native
2. **Textos**: Ajuste os textos nos arquivos YAML conforme sua UI
3. **Timeouts**: Ajuste os timeouts se necessário

### Exemplo: Adicionar testID

```javascript
// No componente React Native
<TouchableOpacity 
  testID="login-button"
  onPress={handleLogin}
>
  <Text>Entrar</Text>
</TouchableOpacity>
```

```yaml
# No teste Maestro
- tapOn:
    id: "login-button"
```

## 📚 Documentação

- **Guia Completo**: `GUIA_TESTES_E2E.md`
- **Quick Start**: `QUICK_START_MAESTRO.md`
- **Maestro Docs**: https://maestro.mobile.dev

## ✅ Checklist de Uso

Antes de executar testes:

- [ ] App buildado e instalado (`npm run android`)
- [ ] Dispositivo/emulador conectado
- [ ] Maestro instalado (verificar com `maestro --version`)
- [ ] Testes ajustados para sua UI (IDs/textos)

## 🎯 Próximos Passos

1. **Ajustar testes** para sua UI real
2. **Adicionar mais fluxos** conforme necessário
3. **Integrar com CI/CD** (exemplo em `GUIA_TESTES_E2E.md`)
4. **Executar regularmente** antes de releases

## 🐛 Troubleshooting

### Maestro não encontrado
```bash
export PATH="$PATH:$HOME/.maestro/bin"
# Adicione ao ~/.bashrc ou ~/.zshrc
```

### Dispositivo não encontrado
```bash
adb devices  # Verificar dispositivos Android
```

### App não encontrado
```bash
# Verificar se app está instalado
adb shell pm list packages | grep leaf

# Se não estiver, buildar e instalar
npm run android
```

## 📞 Suporte

- **Documentação Maestro**: https://maestro.mobile.dev
- **Discord Maestro**: https://discord.gg/maestro
- **GitHub Issues**: https://github.com/mobile-dev-inc/maestro/issues

---

**Status**: ✅ Tudo configurado e pronto para usar!













