# 🔑 Como Baixar Keystore do EAS

## 📋 Situação Atual

O AAB local está sendo assinado com uma chave diferente da esperada pela Play Store.

**SHA1 esperado pela Play Store:**
```
CA:87:E4:2C:77:FF:E0:EA:83:C7:F0:18:63:85:3B:56:2C:D0:8B:D3
```

**SHA1 do keystore local (`leaf-release-key.keystore`):**
```
54:37:D6:5E:FA:8C:25:A9:4D:4A:8E:32:57:21:A9:FC:BA:32:B4:A8
```

## 🚀 Solução: Baixar Keystore do EAS

### Opção 1: Usar EAS Build (Recomendado - Mais Fácil)

O EAS gerencia o keystore automaticamente. Basta fazer o build:

```bash
cd mobile-app
npx eas build --platform android --profile production
```

O AAB gerado já estará assinado com a chave correta.

### Opção 2: Baixar Keystore do EAS para Build Local

Se você realmente precisa gerar localmente:

#### Passo 1: Verificar Credenciais no EAS

Acesse o dashboard do EAS:
```
https://expo.dev/accounts/leaf-app/projects/leafapp-reactnative/credentials
```

Ou via CLI (requer interação):
```bash
cd mobile-app
npx eas credentials --platform android --profile production
```

#### Passo 2: Baixar o Keystore

No dashboard do EAS:
1. Vá em **Credentials** → **Android** → **Production**
2. Clique em **Download** no keystore
3. Salve como `leaf-production-release.keystore` na raiz do projeto

#### Passo 3: Obter a Senha

A senha do keystore do EAS geralmente é:
- Gerada automaticamente pelo EAS
- Ou você pode resetar/gerar uma nova

**⚠️ IMPORTANTE:** Se você não tem acesso à senha do keystore do EAS, você pode:
1. Resetar as credenciais (criará um novo keystore)
2. Ou usar o EAS Build que gerencia tudo automaticamente

### Opção 3: Verificar SHA1 do Keystore do EAS

Para verificar se o keystore do EAS tem o SHA1 correto:

1. Faça um build via EAS:
```bash
npx eas build --platform android --profile production
```

2. Baixe o AAB gerado

3. Verifique o SHA1 do AAB:
```bash
keytool -printcert -jarfile app-release.aab
```

Ou extraia o certificado do AAB:
```bash
# Extrair certificado do AAB
unzip -p app-release.aab META-INF/*.RSA | keytool -printcert
```

## 🔍 Verificar Qual Keystore Está Sendo Usado

Para verificar o SHA1 de um AAB já gerado:

```bash
# Método 1: Via jarsigner
jarsigner -verify -verbose -certs app-release.aab | grep SHA1

# Método 2: Extrair certificado
unzip -p app-release.aab META-INF/*.RSA | keytool -printcert | grep SHA1
```

## ✅ Recomendação Final

**Use o EAS Build** - É a forma mais segura e fácil:

```bash
cd mobile-app
npx eas build --platform android --profile production
```

O EAS:
- ✅ Gerencia o keystore automaticamente
- ✅ Usa a chave correta (SHA1 esperado)
- ✅ Não precisa baixar/configurar nada localmente
- ✅ Build otimizado para Play Store

Após o build, baixe o AAB do dashboard do EAS e faça o upload na Play Store.

