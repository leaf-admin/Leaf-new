# 🚨 SOLUÇÃO FINAL: Remover Loop de Redirecionamento

## ❌ Problema
A página ainda está causando loop de redirecionamento mesmo após correções no `_redirects`.

## ✅ SOLUÇÃO DEFINITIVA

### Opção 1: Usar Subpasta (RECOMENDADO - Mais Simples)

Criei a página em: `excluir-conta/index.html`

**URL será:** `https://leaf.app.br/excluir-conta/`

**Vantagens:**
- ✅ Não precisa de arquivo `_redirects`
- ✅ Não causa loops
- ✅ Funciona diretamente no Cloudflare Pages
- ✅ Compatível com Play Store

### Opção 2: Usar Arquivo .html Diretamente

Configure a Play Store para usar:
```
https://leaf.app.br/excluir-conta.html
```

---

## 🚀 Deploy Imediato

### Se escolher Opção 1 (Subpasta):

1. **Verificar se pasta existe:**
```bash
cd landing-page
ls -la excluir-conta/
```

2. **Fazer deploy:**
```bash
git add excluir-conta/
git commit -m "Fix: Mover página de exclusão para subpasta (evitar loop)"
git push origin main
```

3. **Testar URL:**
```
https://leaf.app.br/excluir-conta/
```

### Se escolher Opção 2 (URL com .html):

1. **Configurar Play Store para usar:**
```
https://leaf.app.br/excluir-conta.html
```

2. **Atualizar link no footer da landing page:**
```html
<a href="excluir-conta.html">Excluir Conta</a>
```

---

## ✅ Recomendação

**Use a Opção 1 (subpasta)** porque:
- Não precisa de arquivo `_redirects`
- Não causa loops
- Funciona em qualquer servidor
- Play Store aceita URLs com `/` no final

---

## 🔍 Verificar no Cloudflare

Após deploy, verificar:

1. **Cache:**
   - Dashboard → Caching → Purge Everything

2. **Page Rules:**
   - Rules → Page Rules
   - Verificar se há regras para `/excluir-conta*`

3. **WAF:**
   - Security → WAF
   - Adicionar exceção se necessário

---

**✅ Com a subpasta, a URL `https://leaf.app.br/excluir-conta/` deve funcionar perfeitamente!**















