# ✅ SOLUÇÃO FINAL: Loop de Redirecionamento

## 🔧 Correção Aplicada

### Problema:
O arquivo `_redirects` tinha regras que causavam loop infinito:
- Redirecionava `/excluir-conta.html` para ele mesmo
- Fallback `/*` capturava todas as rotas

### Solução:
✅ Removidas todas as regras que causavam loop
✅ Mantido apenas rewrites simples com status **200**
✅ Status 200 = rewrite interno (sem redirect HTTP)

---

## 📄 Arquivo `_redirects` Final

```
/excluir-conta /excluir-conta.html 200
/privacy-policy /privacy-policy.html 200
/em-breve /em-breve.html 200
/ /index.html 200
/index /index.html 200
```

**Explicação:**
- Status `200` = Cloudflare serve o arquivo diretamente (rewrite interno)
- **NÃO faz redirect HTTP** (301/302)
- **NÃO causa loops**

---

## 🚀 Fazer Deploy

```bash
cd landing-page
git add _redirects cloudflare-config.json
git commit -m "Fix: Remover loop de redirecionamento - usar apenas rewrites"
git push origin main
```

---

## ✅ Teste Após Deploy

```bash
# Deve retornar HTTP 200 (não 301/302)
curl -I https://leaf.app.br/excluir-conta

# Deve funcionar no navegador
# Firefox não deve mostrar erro de redirect loop
```

---

## 🔍 Se Ainda Houver Problema

1. **Limpar cache do Cloudflare:**
   - Dashboard → Caching → Purge Everything

2. **Verificar Page Rules:**
   - Rules → Page Rules
   - Remover regras que possam estar causando loop

3. **Verificar WAF:**
   - Security → WAF
   - Adicionar exceção para `/excluir-conta*`

---

**✅ Com essas correções, a página deve carregar sem loops!**















