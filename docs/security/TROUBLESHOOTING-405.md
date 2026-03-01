# 🔧 Troubleshooting - Erro 405 Persistente

## ❌ Problema
Ainda está retornando **405 Method Not Allowed** mesmo após configurar Cloudflare.

## 🔍 Diagnóstico

### Possíveis Causas

1. **Cloudflare ainda bloqueando** (mais provável)
   - Regras podem levar 1-5 minutos para propagar
   - Verificar se as regras estão **ativas/enabled**

2. **Nginx bloqueando POST**
   - Verificar configuração do nginx
   - Verificar se location `/api/waitlist/landing` está correto

3. **Backend não aceitando POST**
   - Verificar se a rota está registrada
   - Verificar logs do backend

## ✅ Verificações Necessárias

### 1. Verificar Regras Cloudflare

1. Vá em **Security → Security rules → Custom rules**
2. Verifique se a regra está:
   - ✅ **Status**: Enabled/Ativa
   - ✅ **Priority**: Configurada
   - ✅ **Expression**: Correta

3. Vá em **Security → Security rules → Rate limiting rules**
4. Verifique se a regra está:
   - ✅ **Status**: Enabled/Ativa
   - ✅ **Rate**: 3 per hour

### 2. Aguardar Propagação

- Regras do Cloudflare podem levar **1-5 minutos** para propagar
- Aguarde e teste novamente

### 3. Verificar se Cloudflare está Bloqueando

Teste diretamente no IP (sem passar pela Cloudflare):

```bash
curl -X POST http://216.238.107.59/api/waitlist/landing \
  -H "Content-Type: application/json" \
  -H "Origin: https://leaf.app.br" \
  -H "Host: leaf.app.br" \
  -d '{"nome":"Teste","celular":"11999999999","cidade":"São Paulo"}'
```

**Se funcionar no IP direto:**
- ✅ Problema está na Cloudflare
- ⏳ Aguarde propagação das regras
- 🔄 Verifique se as regras estão ativas

**Se NÃO funcionar no IP direto:**
- ❌ Problema está no nginx ou backend
- 🔍 Verifique logs do nginx
- 🔍 Verifique logs do backend

## 🎯 Solução Temporária (Para Testar)

Se precisar testar AGORA, você pode:

1. **Desabilitar temporariamente o proxy da Cloudflare:**
   - Vá em **DNS**
   - Clique no ícone de proxy (nuvem laranja) ao lado de `leaf.app.br`
   - Mude para **DNS only** (nuvem cinza)
   - Aguarde 1-2 minutos
   - Teste novamente

2. **Ou usar subdomínio direto:**
   - Crie `api.leaf.app.br` em modo **DNS only** (sem proxy)
   - Aponte para o mesmo IP
   - Use `https://api.leaf.app.br/api/waitlist/landing` na landing page

## 📝 Checklist

- [ ] Regras Cloudflare estão **Enabled/Ativas**?
- [ ] Aguardou **1-5 minutos** após criar as regras?
- [ ] Testou no IP direto (sem Cloudflare)?
- [ ] Verificou logs do nginx?
- [ ] Verificou logs do backend?

## 🔄 Próximos Passos

1. **Aguarde 2-3 minutos** e teste novamente
2. **Verifique se as regras estão ativas** no painel Cloudflare
3. **Teste no IP direto** para isolar o problema
4. Se ainda não funcionar, me diga o resultado do teste no IP direto






















