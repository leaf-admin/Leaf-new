# Configuração do Google Auth - Leaf App

## 📋 Pré-requisitos

1. Conta no Google Cloud Console
2. Projeto criado no Google Cloud Console
3. Google+ API ativada

## 🔧 Configuração no Google Cloud Console

### 1. Criar/Selecionar Projeto
1. Acesse [Google Cloud Console](https://console.cloud.google.com/)
2. Crie um novo projeto ou selecione um existente
3. Anote o **Project ID**

### 2. Ativar APIs
1. Vá em "APIs e Serviços" > "Biblioteca"
2. Procure e ative:
   - **Google+ API**
   - **Google Identity and Access Management (IAM) API**

### 3. Configurar Credenciais OAuth 2.0
1. Vá em "APIs e Serviços" > "Credenciais"
2. Clique em "Criar Credenciais" > "ID do Cliente OAuth 2.0"
3. Configure o tipo de aplicativo: **Aplicativo móvel**

### 4. Configurar URIs de Redirecionamento

#### Para Expo (Desenvolvimento):
```
https://auth.expo.io/@your-username/your-app-slug
```

#### Para iOS:
```
com.yourcompany.leafapp://
```

#### Para Android:
```
com.yourcompany.leafapp://
```

### 5. Obter Client IDs
Após criar as credenciais, você receberá:
- **Client ID para Expo**
- **Client ID para iOS** 
- **Client ID para Android**

## 📱 Configuração no App

### 1. Atualizar GoogleAuthConfig.js
Edite o arquivo `src/config/GoogleAuthConfig.js`:

```javascript
export const GOOGLE_AUTH_CONFIG = {
  expoClientId: 'SEU_EXPO_CLIENT_ID.apps.googleusercontent.com',
  iosClientId: 'SEU_IOS_CLIENT_ID.apps.googleusercontent.com',
  androidClientId: 'SEU_ANDROID_CLIENT_ID.apps.googleusercontent.com',
  webClientId: 'SEU_WEB_CLIENT_ID.apps.googleusercontent.com',
};
```

### 2. Instalar Dependências
As dependências já estão incluídas no `package.json`:
- `expo-auth-session`
- `expo-web-browser`

### 3. Configurar app.json (se necessário)
Adicione no `app.json`:

```json
{
  "expo": {
    "scheme": "leafapp",
    "android": {
      "package": "com.yourcompany.leafapp"
    },
    "ios": {
      "bundleIdentifier": "com.yourcompany.leafapp"
    }
  }
}
```

## 🚀 Como Funciona

### Fluxo de Autenticação:
1. **Splash Screen** → App inicia
2. **AuthScreen** → Usuário escolhe login/cadastro
3. **Email/Senha** → Login tradicional
4. **Google Auth** → Login com Google (captura nome/email)
5. **ProfileSelection** → Escolha tipo de usuário
6. **Fluxo Normal** → Continua com telefone, OTP, etc.

### Dados Capturados do Google:
- ✅ Nome completo
- ✅ Email
- ✅ Foto (URL)
- ✅ ID único

### Preenchimento Automático:
- Nome e email são preenchidos automaticamente nas telas subsequentes
- Mensagem de boas-vindas personalizada no ProfileSelection

## 🔒 Segurança

- Dados sensíveis não são salvos no AsyncStorage
- Apenas dados básicos (uid, email, nome) são armazenados localmente
- Email de verificação é enviado automaticamente no cadastro
- Verificação de email não bloqueia o fluxo de cadastro

## 🧪 Testando

1. Execute `npm start`
2. Teste login com email/senha
3. Teste login com Google
4. Verifique preenchimento automático dos dados
5. Confirme envio do email de verificação

## ⚠️ Troubleshooting

### Erro "Invalid Client ID":
- Verifique se os Client IDs estão corretos
- Confirme se os URIs de redirecionamento estão configurados

### Erro "Redirect URI Mismatch":
- Verifique se o URI no Google Console corresponde ao do app
- Para Expo: use o formato correto com username e app-slug

### Google Auth não funciona:
- Confirme se a Google+ API está ativada
- Verifique se as credenciais estão corretas
- Teste em dispositivo físico (não emulador)

## 📞 Suporte

Se encontrar problemas:
1. Verifique os logs no console
2. Confirme configuração no Google Cloud Console
3. Teste com credenciais de exemplo primeiro 