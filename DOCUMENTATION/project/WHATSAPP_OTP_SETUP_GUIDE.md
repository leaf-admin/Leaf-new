# 📱 WhatsApp OTP Setup Guide - Leaf App

## 🎯 Visão Geral

Este guia explica como configurar o WhatsApp OTP como fallback para o SMS no Leaf App, usando a Meta Business API.

### 📊 Benefícios
- **Custo**: $0.0139 por mensagem (vs $0.01 SMS)
- **Entrega**: 95%+ de taxa de entrega
- **Confiabilidade**: Mais estável que SMS
- **Fallback**: Automático quando SMS falha

---

## 🔧 Configuração da Meta Business API

### 1. Criar Meta Business Account

1. Acesse [Meta Business](https://business.facebook.com/)
2. Clique em "Criar conta"
3. Preencha os dados da empresa
4. Verifique o email/telefone

### 2. Configurar WhatsApp Business API

1. No Meta Business Manager:
   - Vá em "Todos os ativos" → "WhatsApp"
   - Clique em "Adicionar número"
   - Escolha "WhatsApp Business API"

2. **Configurar número de telefone:**
   - Adicione um número brasileiro (+55)
   - Verifique via SMS/Chamada
   - Aguarde aprovação (24-48h)

### 3. Criar App no Meta for Developers

1. Acesse [Meta for Developers](https://developers.facebook.com/)
2. Clique em "Meus Apps" → "Criar App"
3. Escolha "Business" como tipo
4. Preencha informações do app

### 4. Configurar WhatsApp Business API no App

1. No seu app, vá em "Adicionar produto"
2. Selecione "WhatsApp"
3. Configure:
   - **Phone Number ID**: Copie do Business Manager
   - **Access Token**: Gere um token permanente
   - **Webhook URL**: (opcional para produção)

---

## 📝 Configuração do Template de Mensagem

### 1. Criar Template OTP

No WhatsApp Business Manager:

1. Vá em "Mensagens" → "Templates"
2. Clique em "Criar template"
3. Configure:

```
Nome: leaf_otp_verification
Categoria: Autenticação
Idioma: Português (Brasil)

Mensagem:
Olá! Seu código de verificação do Leaf é: {{1}}

Este código expira em 10 minutos.
Não compartilhe com ninguém.

Leaf - Sua viagem, nossa responsabilidade.
```

### 2. Variáveis do Template

- `{{1}}`: Código OTP (6 dígitos)
- Formato: Texto
- Obrigatório: Sim

### 3. Aprovação do Template

- **Tempo**: 24-48 horas
- **Status**: Aguardando → Aprovado
- **Notificação**: Email quando aprovado

---

## 🔑 Configuração das Credenciais

### 1. Obter Access Token

1. No Meta for Developers:
   - Vá em "Ferramentas" → "Graph API Explorer"
   - Selecione seu app
   - Escolha "WhatsApp Business Management API"
   - Clique em "Gerar token de acesso"

2. **Permissões necessárias:**
   - `whatsapp_business_messaging`
   - `whatsapp_business_management`

### 2. Obter Phone Number ID

1. No Business Manager:
   - Vá em "WhatsApp" → "Números"
   - Clique no seu número
   - Copie o "Phone Number ID"

### 3. Configurar no App

```javascript
// Em WhatsAppOTPService.js
this.config = {
  accessToken: 'SEU_ACCESS_TOKEN_AQUI',
  phoneNumberId: 'SEU_PHONE_NUMBER_ID_AQUI',
  businessAccountId: 'SEU_BUSINESS_ACCOUNT_ID_AQUI',
  templateName: 'leaf_otp_verification',
  templateLanguage: 'pt_BR',
};
```

---

## 💰 Custos e Limites

### 1. Preços WhatsApp Business API

| **Região** | **Custo por Mensagem** |
|------------|------------------------|
| Brasil     | $0.0139                |
| EUA        | $0.0142                |
| Europa     | $0.0150                |

### 2. Limites de Envio

- **Rate Limit**: 1000 mensagens/segundo
- **Quota Diária**: 250.000 mensagens
- **Quota Mensal**: 1.000.000 mensagens

### 3. Comparação de Custos

| **Método** | **Custo** | **Entrega** | **Velocidade** |
|------------|-----------|-------------|----------------|
| SMS (Spark) | Gratuito | 90% | Rápido |
| SMS (Blaze) | $0.01 | 90% | Rápido |
| WhatsApp | $0.0139 | 95% | Muito rápido |

---

## 🚀 Implementação no Código

### 1. Configurar Serviço

```javascript
// Inicializar serviço híbrido
await hybridOTPService.initialize();

// Enviar OTP
const result = await hybridOTPService.sendOTP(phoneNumber);
```

### 2. Estratégias de Envio

```javascript
// SMS primeiro, WhatsApp fallback
strategy: 'sms_first'

// WhatsApp primeiro, SMS fallback  
strategy: 'whatsapp_first'

// Otimizado por custo
strategy: 'cost_optimized'
```

### 3. Monitoramento

```javascript
// Obter estatísticas
const stats = hybridOTPService.getStats();
console.log('Taxa de sucesso:', stats.successRate);
console.log('Custo estimado:', stats.estimatedCost);
```

---

## 🔍 Troubleshooting

### 1. Erros Comuns

#### ❌ "Access Token não configurado"
**Solução:**
- Verificar se o token foi copiado corretamente
- Gerar novo token se necessário
- Verificar permissões do app

#### ❌ "Phone Number ID não configurado"
**Solução:**
- Verificar se o número foi aprovado
- Copiar ID correto do Business Manager
- Aguardar aprovação se pendente

#### ❌ "Template não encontrado"
**Solução:**
- Verificar nome do template
- Aguardar aprovação do template
- Verificar idioma (pt_BR)

#### ❌ "Rate limit exceeded"
**Solução:**
- Implementar retry com delay
- Verificar quota diária/mensal
- Otimizar frequência de envio

### 2. Logs de Debug

```javascript
// Ativar logs detalhados
console.log('WhatsAppOTPService - Payload:', payload);
console.log('WhatsAppOTPService - Response:', response);
console.log('HybridOTPService - Strategy:', strategy);
```

### 3. Testes

```javascript
// Testar conexão
await whatsAppOTPService.testConnection();

// Testar envio
const result = await whatsAppOTPService.sendOTP('+5521999999999');
console.log('Teste:', result);
```

---

## 📊 Monitoramento e Analytics

### 1. Métricas Importantes

- **Taxa de entrega**: >95%
- **Tempo de entrega**: <5 segundos
- **Taxa de erro**: <5%
- **Custo por verificação**: $0.0139

### 2. Alertas

```javascript
// Configurar alertas
if (stats.successRate < 90) {
  console.warn('⚠️ Taxa de sucesso baixa:', stats.successRate);
}

if (stats.totalFailures > 10) {
  console.error('❌ Muitas falhas:', stats.totalFailures);
}
```

### 3. Dashboard

```javascript
// Informações do serviço
const info = {
  isInitialized: true,
  strategy: 'sms_first',
  firebasePlan: 'blaze',
  smsRemaining: 5000,
  estimatedCost: '0.1250',
  successRate: '94.5%'
};
```

---

## 🔒 Segurança

### 1. Boas Práticas

- **Access Token**: Nunca commitar no código
- **Rate Limiting**: Implementar delays
- **Validação**: Verificar números antes do envio
- **Logs**: Não logar tokens sensíveis

### 2. Configuração Segura

```javascript
// Usar variáveis de ambiente
accessToken: process.env.META_ACCESS_TOKEN,
phoneNumberId: process.env.META_PHONE_NUMBER_ID,

// Ou AsyncStorage criptografado
await SecureStore.setItemAsync('meta_token', encryptedToken);
```

---

## 📋 Checklist de Produção

### ✅ Configuração
- [ ] Meta Business Account criada
- [ ] WhatsApp Business API configurado
- [ ] Número de telefone aprovado
- [ ] Template de mensagem aprovado
- [ ] Access Token gerado
- [ ] Phone Number ID obtido

### ✅ Implementação
- [ ] WhatsAppOTPService configurado
- [ ] HybridOTPService integrado
- [ ] PhoneInputScreen atualizado
- [ ] Fallback automático funcionando
- [ ] Logs de debug ativos

### ✅ Testes
- [ ] Conexão com API testada
- [ ] Envio de mensagem testado
- [ ] Fallback SMS funcionando
- [ ] Rate limiting configurado
- [ ] Tratamento de erros implementado

### ✅ Monitoramento
- [ ] Métricas configuradas
- [ ] Alertas implementados
- [ ] Dashboard criado
- [ ] Logs estruturados
- [ ] Backup de configurações

---

## 🎯 Próximos Passos

1. **Configurar credenciais reais**
2. **Testar em ambiente de desenvolvimento**
3. **Aprovar template de mensagem**
4. **Implementar monitoramento**
5. **Deploy em produção**

---

## 📞 Suporte

- **Meta Business**: [business.facebook.com](https://business.facebook.com)
- **Meta Developers**: [developers.facebook.com](https://developers.facebook.com)
- **WhatsApp Business API**: [developers.facebook.com/docs/whatsapp](https://developers.facebook.com/docs/whatsapp)

---

**🚀 WhatsApp OTP está pronto para ser configurado!** 