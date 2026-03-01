# 🔧 Cloudflare - Expressão Final Corrigida

## ❌ Erro Recebido

```
expected value of type Bool, but got Array<Bool>
```

**Problema**: `http.request.headers["origin"][*]` retorna um array, não um valor booleano.

## ✅ Expressão Correta

### Opção 1: Usar `any()` (Recomendado)

```
(http.request.uri.path eq "/api/waitlist/landing" and http.request.method eq "POST" and not any(http.request.headers["origin"][*] eq "https://leaf.app.br"))
```

### Opção 2: Verificar se não existe ou é diferente

```
(http.request.uri.path eq "/api/waitlist/landing" and http.request.method eq "POST" and (not http.request.headers["origin"] or http.request.headers["origin"][0] ne "https://leaf.app.br"))
```

### Opção 3: Usar `all()` com negação (Mais Simples)

```
(http.request.uri.path eq "/api/waitlist/landing" and http.request.method eq "POST" and all(http.request.headers["origin"][*] ne "https://leaf.app.br"))
```

## 🎯 Recomendação: Use Opção 3

A **Opção 3** é a mais simples e deve funcionar:

```
(http.request.uri.path eq "/api/waitlist/landing" and http.request.method eq "POST" and all(http.request.headers["origin"][*] ne "https://leaf.app.br"))
```

**O que faz:**
- Verifica se TODOS os valores do header `origin` são diferentes de `https://leaf.app.br`
- Se não houver header `origin`, também bloqueia (seguro)
- Se o header `origin` for diferente, bloqueia

## 📝 Expressões Finais

### Regra 1: Rate Limiting (Está correta)
```
(http.request.uri.path eq "/api/waitlist/landing")
```

### Regra 2: Custom Rule - Bloquear Outras Origens

**Use esta expressão:**
```
(http.request.uri.path eq "/api/waitlist/landing" and http.request.method eq "POST" and all(http.request.headers["origin"][*] ne "https://leaf.app.br"))
```

## 🔧 Como Aplicar

1. Vá em **Security → Security rules → Custom rules**
2. Edite a regra de bloqueio
3. Cole a expressão da **Opção 3** acima
4. **Save**

## ✅ Teste

Após salvar, aguarde 1-2 minutos e teste:

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






















