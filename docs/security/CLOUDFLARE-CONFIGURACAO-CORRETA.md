# ✅ Cloudflare - Configuração Correta (Sem Allow)

## 🎯 Como Funciona

No Cloudflare, **Custom Rules** não tem opção "Allow" porque:
- **Por padrão, tudo é permitido** (Allow implícito)
- Você só precisa criar regras para **Bloquear** o que não quer

## ✅ Configuração Necessária

### Regra 1: Rate Limiting (Já feita)

✅ **Rate limiting rules**
- URI Path = `/api/waitlist/landing`
- Rate: `3 requests per 1 hour`

### Regra 2: Custom Rule - Bloquear Outras Origens (Já feita)

✅ **Custom rules**
- **Rule name**: `Block Waitlist POST from Others`
- **If**:
  - `URI Path` `equals` `/api/waitlist/landing`
  - AND `Request Method` `equals` `POST`
  - AND `Header` `origin` `does not equal` `https://leaf.app.br`
- **Then**: `Block`
- **Priority**: `1` (ou qualquer número)

## 🎯 Como Funciona na Prática

1. **Requisição POST de `https://leaf.app.br`**:
   - ✅ Passa pela Custom Rule (não é bloqueada)
   - ✅ Passa pelo Rate Limiting (se não exceder 3/hora)
   - ✅ Chega no servidor

2. **Requisição POST de outra origem**:
   - ❌ Bloqueada pela Custom Rule
   - ❌ Não chega no servidor

3. **Requisição POST de `https://leaf.app.br` (mais de 3/hora)**:
   - ✅ Passa pela Custom Rule
   - ❌ Bloqueada pelo Rate Limiting
   - ❌ Não chega no servidor

## ✅ Está Pronto!

Você só precisa dessas 2 regras:
1. ✅ Rate Limiting (3 por hora)
2. ✅ Custom Rule (bloquear outras origens)

**Não precisa criar regra de "Allow"** - o Cloudflare já permite por padrão!

## 🧪 Teste Agora

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

## 📝 Resumo

✅ **Rate Limiting**: Limita a 3 requisições por hora  
✅ **Custom Rule**: Bloqueia requisições de outras origens  
✅ **Por padrão**: Requisições de `https://leaf.app.br` são permitidas

**Está configurado corretamente!** 🎉






















