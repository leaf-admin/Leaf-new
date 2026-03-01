# 🛡️ Como Aplicar Segurança no Waitlist

## ✅ O que já foi implementado

### Backend (`leaf-websocket-backend/routes/waitlist.js`)
- ✅ Rate limiting: 3 requisições por IP por hora
- ✅ Validação de origem (apenas `https://leaf.app.br`)
- ✅ Sanitização de dados (XSS protection)
- ✅ Proteção contra duplicatas (mesmo celular em 24h)
- ✅ Validação de formato de dados

### Nginx (`/etc/nginx/sites-available/leaf-production`)
- ✅ Rate limiting: 3 requisições por IP por hora
- ✅ Limitação de payload: 1KB máximo
- ✅ Timeout curto: 5 segundos
- ✅ Bloqueio de métodos não permitidos
- ✅ CORS configurado

## 🔄 Próximos Passos

### 1. Reiniciar o Backend

O backend precisa ser reiniciado para aplicar as mudanças. Execute:

```bash
# Se usar PM2
pm2 restart all

# Se usar systemd
sudo systemctl restart leaf-backend

# Se usar node diretamente
# Encontre o processo e reinicie
ps aux | grep "node.*server"
kill <PID>
cd /home/leaf/leaf-websocket-backend
node server.js &
```

### 2. Configurar Cloudflare (IMPORTANTE)

A Cloudflare ainda está bloqueando POST. Configure:

#### Opção A: Rate Limiting na Cloudflare (Recomendado)
1. Acesse: https://dash.cloudflare.com
2. Selecione o domínio `leaf.app.br`
3. Vá em **Security > WAF > Rate Limiting Rules**
4. Clique em **Create rule**
5. Configure:
   - **Rule name**: Waitlist Protection
   - **When incoming requests match**: 
     ```
     (http.request.uri.path eq "/api/waitlist/landing") and (http.request.method eq "POST")
     ```
   - **Then**: Rate limit
   - **Rate**: 3 requests per 1 hour
   - **Action**: Block
6. Salve

#### Opção B: Firewall Rule (Mais Restritivo)
1. Vá em **Security > WAF > Custom Rules**
2. Crie regra de PERMITIR:
   - **Rule name**: Allow Waitlist from Origin
   - **Expression**:
     ```
     (http.request.uri.path eq "/api/waitlist/landing") 
     and (http.request.method eq "POST") 
     and (http.request.headers["origin"][*] eq "https://leaf.app.br")
     ```
   - **Action**: Allow
   - **Priority**: 1

3. Crie regra de BLOQUEAR:
   - **Rule name**: Block Waitlist from Other Origins
   - **Expression**:
     ```
     (http.request.uri.path eq "/api/waitlist/landing") 
     and (http.request.method eq "POST") 
     and not (http.request.headers["origin"][*] eq "https://leaf.app.br")
     ```
   - **Action**: Block
   - **Priority**: 2

### 3. Verificar Funcionamento

```bash
# Teste local (deve funcionar)
curl -X POST http://localhost:3001/api/waitlist/landing \
  -H "Content-Type: application/json" \
  -H "Origin: https://leaf.app.br" \
  -d '{"nome":"Teste","celular":"11999999999","cidade":"São Paulo"}'

# Teste via nginx local (deve funcionar)
curl -X POST https://localhost/api/waitlist/landing \
  -H "Content-Type: application/json" \
  -H "Origin: https://leaf.app.br" \
  -H "Host: leaf.app.br" \
  -k \
  -d '{"nome":"Teste","celular":"11999999999","cidade":"São Paulo"}'

# Teste externo (pode retornar 405 até configurar Cloudflare)
curl -X POST https://leaf.app.br/api/waitlist/landing \
  -H "Content-Type: application/json" \
  -H "Origin: https://leaf.app.br" \
  -d '{"nome":"Teste","celular":"11999999999","cidade":"São Paulo"}'
```

## 📊 Proteções Ativas

### Camada 1: Cloudflare (Configurar)
- Rate limiting: 3 req/hora
- Firewall rules: Bloquear origens não permitidas

### Camada 2: Nginx
- Rate limiting: 3 req/hora por IP
- Limitação de payload: 1KB
- Timeout: 5 segundos
- Bloqueio de métodos não permitidos

### Camada 3: Backend
- Rate limiting: 3 req/hora por IP
- Validação de origem
- Sanitização de dados
- Proteção contra duplicatas

## 🚨 Monitoramento

Monitore os logs:

```bash
# Logs do Nginx
tail -f /var/log/nginx/leaf-waitlist-access.log
tail -f /var/log/nginx/leaf-waitlist-error.log

# Logs do Backend
tail -f /home/leaf/leaf-websocket-backend/logs/combined.log | grep waitlist
```

## ✅ Checklist Final

- [x] Backend atualizado com segurança
- [x] Nginx configurado com rate limiting
- [ ] Backend reiniciado (fazer manualmente)
- [ ] Cloudflare configurado (fazer manualmente)
- [ ] Testes realizados
- [ ] Monitoramento ativo

## 🔧 Troubleshooting

### Erro 405 ainda aparece
- Verifique se Cloudflare está configurado
- Verifique se backend foi reiniciado
- Verifique logs do nginx: `tail -f /var/log/nginx/error.log`

### Rate limit muito restritivo
- Ajuste em `/etc/nginx/sites-available/leaf-production`: `rate=3r/h` para `rate=5r/h`
- Ajuste no backend: `max: 3` para `max: 5` em `waitlist.js`

### Duplicatas não estão sendo bloqueadas
- Verifique conexão com Firestore
- Verifique logs do backend para erros






















