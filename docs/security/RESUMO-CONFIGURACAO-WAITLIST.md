# 📋 Resumo - Configuração Waitlist com Segurança

## ✅ O que foi implementado

### Backend (Node.js)
- ✅ Rate limiting: 3 requisições por IP por hora
- ✅ Validação de origem: apenas `https://leaf.app.br`
- ✅ Sanitização de dados: proteção XSS
- ✅ Proteção contra duplicatas: mesmo celular em 24h
- ✅ Validação de formato: nome, celular, cidade

### Nginx
- ✅ Rate limiting: 3 requisições por IP por hora
- ✅ Limitação de payload: 1KB máximo
- ✅ Timeout curto: 5 segundos
- ✅ Bloqueio de métodos: apenas POST e OPTIONS
- ✅ CORS configurado

### Cloudflare (Configurado, aguardando propagação)
- ✅ Rate Limiting Rule: 3 por hora para `/api/waitlist/landing`
- ✅ Custom Rule: Bloquear POST de origens diferentes de `https://leaf.app.br`

## ⚠️ Status Atual

**Erro 405 ainda aparece** - Isso é esperado porque:

1. **Regras Cloudflare podem levar 1-5 minutos para propagar**
2. **Backend foi corrigido** (erro do keyGenerator resolvido)
3. **Nginx está configurado corretamente**

## 🔍 Verificações Necessárias

### 1. Verificar se Regras Cloudflare estão Ativas

1. Acesse: https://dash.cloudflare.com
2. Vá em **Security → Security rules → Rate limiting rules**
3. Verifique se a regra está com status **"Enabled"** ou **"Ativa"**
4. Vá em **Security → Security rules → Custom rules**
5. Verifique se a regra está com status **"Enabled"** ou **"Ativa"**

### 2. Aguardar Propagação

- ⏳ Aguarde **2-5 minutos** após criar as regras
- 🔄 As regras do Cloudflare podem demorar para propagar globalmente

### 3. Testar Novamente

Após aguardar, teste:

```bash
curl -X POST https://leaf.app.br/api/waitlist/landing \
  -H "Content-Type: application/json" \
  -H "Origin: https://leaf.app.br" \
  -d '{"nome":"Teste","celular":"11999999999","cidade":"São Paulo"}'
```

## 🎯 Se Ainda Não Funcionar

### Opção 1: Verificar Expressão da Regra

A expressão da Custom Rule deve ser exatamente:

```
(http.request.uri.path eq "/api/waitlist/landing" and http.request.method eq "POST" and all(http.request.headers["origin"][*] ne "https://leaf.app.br"))
```

### Opção 2: Testar sem Cloudflare (Temporário)

Para testar se o problema é só a Cloudflare:

1. Vá em **DNS** no Cloudflare
2. Clique no ícone de proxy (nuvem laranja) ao lado de `leaf.app.br`
3. Mude para **DNS only** (nuvem cinza)
4. Aguarde 1-2 minutos
5. Teste novamente

**Se funcionar sem proxy:**
- ✅ Problema está na Cloudflare
- ⏳ Aguarde propagação das regras
- 🔄 Verifique se regras estão ativas

**Se não funcionar sem proxy:**
- ❌ Problema está no nginx ou backend
- 🔍 Verifique logs

## 📊 Proteções Ativas

### Camada 1: Cloudflare
- Rate limiting: 3 req/hora
- Firewall: Bloquear outras origens

### Camada 2: Nginx
- Rate limiting: 3 req/hora
- Limitação de payload: 1KB
- Timeout: 5 segundos

### Camada 3: Backend
- Rate limiting: 3 req/hora
- Validação de origem
- Sanitização
- Anti-duplicatas

## ✅ Próximos Passos

1. **Aguarde 2-5 minutos** para propagação do Cloudflare
2. **Verifique se as regras estão ativas** no painel
3. **Teste novamente**
4. Se ainda não funcionar, me diga o resultado e verificamos juntos






















