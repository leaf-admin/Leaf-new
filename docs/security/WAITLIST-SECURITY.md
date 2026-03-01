# 🛡️ Segurança do Endpoint de Waitlist

## 📋 Proteções Implementadas

### 1. **Rate Limiting (Nginx + Backend)**
- **Nginx**: 3 requisições por IP por hora
- **Backend**: 3 requisições por IP por hora (express-rate-limit)
- **Proteção**: DDoS, spam, abuso

### 2. **Validação de Origem**
- Apenas requisições de `https://leaf.app.br` são aceitas
- Bloqueia requisições de outros domínios
- **Proteção**: CSRF, requisições maliciosas

### 3. **Sanitização de Dados**
- Remove caracteres especiais perigosos
- Limita tamanho dos campos (nome: 100 chars, celular: 15 dígitos)
- Valida formato de celular (apenas números)
- **Proteção**: XSS, SQL Injection, buffer overflow

### 4. **Proteção contra Duplicatas**
- Mesmo celular não pode cadastrar novamente em 24 horas
- Verificação no Firestore antes de salvar
- **Proteção**: Spam, cadastros duplicados

### 5. **Limitação de Payload**
- Nginx limita body a 1KB
- Timeout curto (5 segundos)
- **Proteção**: Slowloris, payload grande

### 6. **Bloqueio de Métodos**
- Apenas POST e OPTIONS permitidos
- Outros métodos retornam 405
- **Proteção**: Métodos não autorizados

## 🔧 Configuração Cloudflare Recomendada

### Opção 1: Rate Limiting na Cloudflare (Recomendado)
1. Acesse **Security > WAF > Rate Limiting Rules**
2. Crie regra:
   - **Rule name**: Waitlist Protection
   - **When incoming requests match**: `(http.request.uri.path eq "/api/waitlist/landing") and (http.request.method eq "POST")`
   - **Then**: Rate limit
   - **Rate**: 3 requests per 1 hour
   - **Action**: Block

### Opção 2: Firewall Rule na Cloudflare
1. Acesse **Security > WAF > Custom Rules**
2. Crie regra:
   - **Rule name**: Allow Waitlist POST from Origin
   - **Expression**: 
     ```
     (http.request.uri.path eq "/api/waitlist/landing") 
     and (http.request.method eq "POST") 
     and (http.request.headers["origin"][*] eq "https://leaf.app.br")
     ```
   - **Action**: Allow
   - **Priority**: 1 (alta)

3. Crie regra de bloqueio:
   - **Rule name**: Block Waitlist POST from Other Origins
   - **Expression**:
     ```
     (http.request.uri.path eq "/api/waitlist/landing") 
     and (http.request.method eq "POST") 
     and not (http.request.headers["origin"][*] eq "https://leaf.app.br")
     ```
   - **Action**: Block
   - **Priority**: 2 (média)

### Opção 3: Challenge para Requisições Suspeitas
1. Acesse **Security > WAF > Custom Rules**
2. Crie regra:
   - **Rule name**: Challenge Suspicious Waitlist Requests
   - **Expression**:
     ```
     (http.request.uri.path eq "/api/waitlist/landing") 
     and (cf.threat_score gt 10)
     ```
   - **Action**: Challenge (Captcha)
   - **Priority**: 3 (baixa)

## 📊 Monitoramento

### Logs para Monitorar
- `/var/log/nginx/leaf-waitlist-access.log` - Acessos
- `/var/log/nginx/leaf-waitlist-error.log` - Erros
- Firestore collection `waitlist_landing` - Cadastros

### Métricas Importantes
- Taxa de bloqueio por rate limit
- Tentativas de origem não permitida
- Tentativas de cadastro duplicado
- Requisições bloqueadas por dados suspeitos

## 🚨 Alertas Recomendados

1. **Muitas requisições bloqueadas por rate limit** (> 10/min)
2. **Tentativas de origem não permitida** (> 5/min)
3. **Dados suspeitos detectados** (> 3/min)
4. **Erros 500 no endpoint** (> 5/min)

## ✅ Checklist de Segurança

- [x] Rate limiting no Nginx (3 req/hora)
- [x] Rate limiting no Backend (3 req/hora)
- [x] Validação de origem
- [x] Sanitização de dados
- [x] Proteção contra duplicatas
- [x] Limitação de payload
- [x] Bloqueio de métodos não permitidos
- [ ] Rate limiting na Cloudflare (configurar manualmente)
- [ ] Firewall rules na Cloudflare (configurar manualmente)
- [ ] Monitoramento de alertas (configurar manualmente)

## 🔄 Atualizações Futuras

- [ ] Implementar honeypot (campo oculto)
- [ ] Adicionar reCAPTCHA v3 (opcional, pode impactar UX)
- [ ] Rate limiting por celular (além de IP)
- [ ] Análise de padrões suspeitos (machine learning)






















