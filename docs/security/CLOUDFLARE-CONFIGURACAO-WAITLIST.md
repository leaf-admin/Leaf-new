# 🔐 Configuração Cloudflare para Waitlist - Guia Completo

## 📍 Localização no Painel Cloudflare

A localização exata depende do seu plano Cloudflare. Siga os caminhos abaixo:

### Opção 1: Security > WAF (Plano Pro/Business/Enterprise)

1. Acesse: https://dash.cloudflare.com
2. Selecione o domínio `leaf.app.br`
3. No menu lateral esquerdo, clique em **Security**
4. Clique em **WAF**
5. Procure por **Rate Limiting Rules** ou **Custom Rules**

### Opção 2: Security > Rate Limiting (Plano Free/Pro)

1. Acesse: https://dash.cloudflare.com
2. Selecione o domínio `leaf.app.br`
3. No menu lateral, clique em **Security**
4. Clique em **Rate Limiting** (pode estar em "Bots" ou "WAF")
5. Clique em **Create rule**

### Opção 3: Security > Firewall Rules (Todos os Planos)

1. Acesse: https://dash.cloudflare.com
2. Selecione o domínio `leaf.app.br`
3. No menu lateral, clique em **Security**
4. Clique em **Firewall Rules** ou **WAF**
5. Clique em **Create rule**

### Opção 4: Security > Tools (Interface Antiga)

1. Acesse: https://dash.cloudflare.com
2. Selecione o domínio `leaf.app.br`
3. Clique em **Security**
4. Clique em **Tools** ou **WAF**
5. Procure por **Rate Limiting** ou **Custom Rules**

## 🎯 Configuração Recomendada: Rate Limiting Rule

### Passo a Passo Detalhado

#### 1. Criar Rate Limiting Rule

**Se encontrar "Rate Limiting Rules":**
1. Clique em **Create rule** ou **Add rule**
2. Configure:
   - **Rule name**: `Waitlist Protection`
   - **When incoming requests match**: 
     ```
     (http.request.uri.path eq "/api/waitlist/landing") and (http.request.method eq "POST")
     ```
   - **Then**: Rate limit
   - **Rate**: `3 requests per 1 hour`
   - **Action**: `Block` ou `Challenge`
   - **Duration**: `1 hour`
3. Clique em **Save** ou **Deploy**

**Se NÃO encontrar "Rate Limiting Rules" (Plano Free):**
Use **Firewall Rules** (veja Opção B abaixo)

## 🔥 Opção B: Firewall Rules (Funciona em Todos os Planos)

### Regra 1: Permitir POST da Origem Correta

1. Vá em **Security > Firewall Rules** (ou **WAF > Custom Rules**)
2. Clique em **Create rule**
3. Configure:
   - **Rule name**: `Allow Waitlist POST from Leaf Origin`
   - **Field**: `URI Path`
   - **Operator**: `equals`
   - **Value**: `/api/waitlist/landing`
   - Clique em **Add condition** (AND)
   - **Field**: `Request Method`
   - **Operator**: `equals`
   - **Value**: `POST`
   - Clique em **Add condition** (AND)
   - **Field**: `HTTP Request Header`
   - **Header name**: `origin`
   - **Operator**: `equals`
   - **Value**: `https://leaf.app.br`
   - **Action**: `Allow`
   - **Priority**: `1` (alta)
4. Clique em **Deploy**

### Regra 2: Bloquear POST de Outras Origens

1. Clique em **Create rule** novamente
2. Configure:
   - **Rule name**: `Block Waitlist POST from Other Origins`
   - **Field**: `URI Path`
   - **Operator**: `equals`
   - **Value**: `/api/waitlist/landing`
   - Clique em **Add condition** (AND)
   - **Field**: `Request Method`
   - **Operator**: `equals`
   - **Value**: `POST`
   - Clique em **Add condition** (AND)
   - **Field**: `HTTP Request Header`
   - **Header name**: `origin`
   - **Operator**: `does not equal`
   - **Value**: `https://leaf.app.br`
   - **Action**: `Block`
   - **Priority**: `2` (média)
4. Clique em **Deploy**

## 🛡️ Opção C: Page Rules (Alternativa Simples)

Se não encontrar as opções acima:

1. Vá em **Rules > Page Rules** (ou **Rules > Transform Rules**)
2. Clique em **Create Page Rule**
3. Configure:
   - **URL**: `*leaf.app.br/api/waitlist/landing`
   - **Settings**:
     - **Security Level**: `High`
     - **Rate Limiting**: `3 requests per hour` (se disponível)
4. Salve

## 📸 Como Identificar Seu Plano

1. No painel Cloudflare, vá em **Overview**
2. Veja o plano no canto superior direito ou no menu lateral
3. **Free**: Funcionalidades limitadas, use Firewall Rules
4. **Pro**: Tem Rate Limiting básico
5. **Business/Enterprise**: Tem WAF completo

## ✅ Verificação

Após configurar, teste:

```bash
# Deve funcionar (origem correta)
curl -X POST https://leaf.app.br/api/waitlist/landing \
  -H "Content-Type: application/json" \
  -H "Origin: https://leaf.app.br" \
  -d '{"nome":"Teste","celular":"11999999999","cidade":"São Paulo"}'

# Deve ser bloqueado (origem errada)
curl -X POST https://leaf.app.br/api/waitlist/landing \
  -H "Content-Type: application/json" \
  -H "Origin: https://evil.com" \
  -d '{"nome":"Teste","celular":"11999999999","cidade":"São Paulo"}'
```

## 🔍 Se Não Encontrar Nenhuma Opção

1. **Verifique seu plano**: Algumas funcionalidades só estão em planos pagos
2. **Use Transform Rules**: Vá em **Rules > Transform Rules**
3. **Contate suporte**: Se for plano pago e não encontrar, abra ticket
4. **Use API da Cloudflare**: Configure via API (mais complexo)

## 📝 Nota Importante

Se você está no plano **Free**, a melhor opção é usar **Firewall Rules** (Opção B acima), que está disponível em todos os planos.

## 🆘 Precisa de Ajuda?

Se ainda não encontrar, me diga:
1. Qual plano você tem? (Free, Pro, Business, Enterprise)
2. O que aparece quando você clica em **Security**?
3. Quais opções você vê no menu lateral?

Com essas informações, posso dar instruções mais específicas!






















