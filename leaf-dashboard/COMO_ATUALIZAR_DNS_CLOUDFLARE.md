# 🌐 Como Atualizar DNS no Cloudflare

## 📍 Onde fazer

**Cloudflare Dashboard:** https://dash.cloudflare.com/

## 🚀 Passo a Passo

### 1️⃣ Acessar Cloudflare

1. Abra: https://dash.cloudflare.com/
2. Faça login na sua conta
3. Selecione o domínio **`leaf.app.br`**

### 2️⃣ Ir para DNS

1. No menu lateral, clique em **"DNS"** ou **"DNS → Records"**
2. Você verá uma lista de registros DNS

### 3️⃣ Adicionar/Atualizar Registro para Dashboard

**Opção A - Se já existe `dashboard.leaf.app.br`:**

1. Procure na lista por um registro com:
   - **Type:** `A`
   - **Name:** `dashboard`
   - **Content/Value:** `216.238.107.59` (IP antigo)

2. Clique no registro para editar

3. Altere o **Content/Value** de:
   ```
   216.238.107.59
   ```
   Para:
   ```
   147.93.66.253
   ```

4. Clique em **"Save"** ou **"Salvar"**

**Opção B - Se NÃO existe `dashboard.leaf.app.br`:**

1. Clique no botão **"Add record"** ou **"Adicionar registro"**

2. Preencha:
   - **Type:** `A`
   - **Name:** `dashboard`
   - **IPv4 address:** `147.93.66.253`
   - **Proxy status:** 
     - ⚠️ **IMPORTANTE:** Deixe **DESLIGADO** (nuvem cinza) para SSL funcionar
     - Se estiver laranja (proxy ativo), clique para desligar
   - **TTL:** `Auto` ou `300`

3. Clique em **"Save"** ou **"Salvar"**

### 4️⃣ Verificar

Após salvar, aguarde 2-5 minutos e verifique:

```bash
nslookup dashboard.leaf.app.br
```

Ou acesse: https://www.whatsmydns.net/#A/dashboard.leaf.app.br

Deve retornar: `147.93.66.253`

## ⚠️ IMPORTANTE: Proxy Status

Para SSL funcionar, o registro precisa estar em modo **DNS only** (nuvem cinza):

- ✅ **Nuvem cinza** = DNS only (correto para SSL)
- ❌ **Nuvem laranja** = Proxy ativo (pode causar problemas com SSL)

**Como verificar:**
- Se a nuvem estiver **laranja**, clique nela para desligar
- Deve ficar **cinza**

## 🔒 Após DNS Propagado

Quando o DNS estiver correto (apontando para `147.93.66.253`), execute na VPS:

```bash
ssh root@147.93.66.253

certbot --nginx -d dashboard.leaf.app.br \
  --non-interactive \
  --agree-tos \
  --email suporte@leaf.app.br \
  --redirect
```

## 📸 Visual (aproximado)

```
Cloudflare Dashboard
├── Domínio: leaf.app.br
├── DNS → Records
│   ├── Type: A
│   ├── Name: dashboard
│   ├── Content: 147.93.66.253  ← ATUALIZAR AQUI
│   ├── Proxy: 🟢 OFF (cinza)   ← IMPORTANTE!
│   └── TTL: Auto
└── [Save]
```

## 🆘 Se não encontrar

1. Verifique se está no domínio correto (`leaf.app.br`)
2. Procure por "dashboard" na busca de registros
3. Se não existir, crie um novo registro tipo `A`

## ✅ Checklist

- [ ] Acessei https://dash.cloudflare.com/
- [ ] Selecionei o domínio `leaf.app.br`
- [ ] Fui em "DNS → Records"
- [ ] Adicionei/Atualizei registro `dashboard` → `147.93.66.253`
- [ ] Proxy está DESLIGADO (nuvem cinza)
- [ ] Salvei as alterações
- [ ] Aguardei 5 minutos
- [ ] Verifiquei DNS: `nslookup dashboard.leaf.app.br`


