# 🔧 Cloudflare - Correção das Expressões

## ❌ Expressão Atual (Incorreta)

```
(http.request.uri.path eq "/api/waitlist/landing" and http.request.method eq "POST" and all(http.request.headers[""][*] ne "https://leaf.app.br"))
```

**Problema**: `http.request.headers[""][*]` está vazio e verifica todos os headers, não apenas o `origin`.

## ✅ Expressão Correta

### Regra 1: Rate Limiting (Está correta)
```
(http.request.uri.path eq "/api/waitlist/landing")
```

### Regra 2: Custom Rule - Bloquear Outras Origens (Corrigir)

**Expressão correta:**
```
(http.request.uri.path eq "/api/waitlist/landing" and http.request.method eq "POST" and not http.request.headers["origin"][*] eq "https://leaf.app.br")
```

**OU se não aceitar `not`, use:**
```
(http.request.uri.path eq "/api/waitlist/landing" and http.request.method eq "POST" and http.request.headers["origin"][*] ne "https://leaf.app.br")
```

## 📝 Explicação

- `http.request.headers["origin"][*]` - Verifica o header `origin`
- `ne` = "not equal" (diferente de)
- `eq` = "equals" (igual a)

## 🔧 Como Corrigir

1. Vá em **Security → Security rules → Custom rules**
2. Encontre a regra que você criou
3. Clique em **Edit** (ou o ícone de editar)
4. Na expressão, substitua:
   - **De**: `all(http.request.headers[""][*] ne "https://leaf.app.br")`
   - **Para**: `http.request.headers["origin"][*] ne "https://leaf.app.br"`
5. **Save**

## ✅ Expressão Final Correta

**Regra de Bloqueio:**
```
(http.request.uri.path eq "/api/waitlist/landing" and http.request.method eq "POST" and http.request.headers["origin"][*] ne "https://leaf.app.br")
```

**Regra de Rate Limiting:**
```
(http.request.uri.path eq "/api/waitlist/landing")
```

## 🎯 O que cada parte faz

1. `http.request.uri.path eq "/api/waitlist/landing"` - Verifica se é o endpoint correto
2. `http.request.method eq "POST"` - Verifica se é método POST
3. `http.request.headers["origin"][*] ne "https://leaf.app.br"` - Verifica se o header origin é DIFERENTE de https://leaf.app.br

Se todas as condições forem verdadeiras (é o endpoint, é POST, e origem é diferente), então **Bloqueia**.






















