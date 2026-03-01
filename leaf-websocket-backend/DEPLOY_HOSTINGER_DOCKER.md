# 🚀 Deploy Leaf App - Hostinger VPS com Docker

Guia completo para deploy do Leaf App na Hostinger VPS usando Docker Compose.

## 📋 Pré-requisitos

- Acesso SSH à VPS Hostinger (IP: 147.93.66.253)
- Arquivo `firebase-credentials.json` configurado
- Variáveis de ambiente configuradas (Woovi, API Keys, etc.)

## 🔧 Configuração Inicial

### 1. Preparar Variáveis de Ambiente

Crie o arquivo `.env.production` no diretório `leaf-websocket-backend`:

```bash
# Copiar exemplo
cp .env.production.example .env.production

# Editar com suas credenciais
nano .env.production
```

**Variáveis obrigatórias:**
- `WOOVI_WEBHOOK_URL=http://147.93.66.253/api/woovi/webhook`
- `SERVER_URL=http://147.93.66.253`
- `WOOVI_API_TOKEN` (da Woovi)
- `WOOVI_CLIENT_ID` (da Woovi)
- `WOOVI_CLIENT_SECRET` (da Woovi)
- `GOOGLE_MAPS_API_KEY`
- `JWT_SECRET` (alterar em produção!)
- `LEAF_PIX_KEY` (chave PIX da conta Leaf)

### 2. Verificar Firebase Credentials

Certifique-se de que o arquivo `firebase-credentials.json` está presente e válido:

```bash
ls -la firebase-credentials.json
```

## 🚀 Deploy Automatizado

### Opção 1: Script Automatizado (Recomendado)

```bash
cd leaf-websocket-backend
./scripts/deploy-hostinger-docker.sh
```

O script irá:
1. ✅ Verificar pré-requisitos
2. 🐳 Instalar Docker na VPS (se necessário)
3. 📁 Criar estrutura de diretórios
4. 📦 Copiar arquivos necessários
5. 🔨 Construir imagens Docker
6. 🚀 Iniciar containers
7. 🏥 Verificar saúde dos serviços

### Opção 2: Deploy Manual

#### Passo 1: Conectar na VPS

```bash
ssh root@147.93.66.253
```

#### Passo 2: Instalar Docker (se necessário)

```bash
curl -fsSL https://get.docker.com -o get-docker.sh
sh get-docker.sh
systemctl start docker
systemctl enable docker

# Instalar Docker Compose
curl -L "https://github.com/docker/compose/releases/download/v2.24.0/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
chmod +x /usr/local/bin/docker-compose
```

#### Passo 3: Criar Diretório

```bash
mkdir -p /opt/leaf-app
cd /opt/leaf-app
```

#### Passo 4: Copiar Arquivos

Do seu computador local:

```bash
# Do diretório leaf-websocket-backend
scp docker-compose.hostinger.yml root@147.93.66.253:/opt/leaf-app/docker-compose.yml
scp Dockerfile root@147.93.66.253:/opt/leaf-app/
scp package.json root@147.93.66.253:/opt/leaf-app/
scp nginx.conf root@147.93.66.253:/opt/leaf-app/
scp .env.production root@147.93.66.253:/opt/leaf-app/.env
scp firebase-credentials.json root@147.93.66.253:/opt/leaf-app/
```

#### Passo 5: Copiar Código da Aplicação

```bash
# Criar tarball (excluindo node_modules)
tar --exclude='node_modules' \
    --exclude='.git' \
    --exclude='logs' \
    --exclude='coverage' \
    -czf /tmp/leaf-app-code.tar.gz .

# Copiar para VPS
scp /tmp/leaf-app-code.tar.gz root@147.93.66.253:/opt/leaf-app/

# Na VPS, extrair
ssh root@147.93.66.253 "cd /opt/leaf-app && tar -xzf leaf-app-code.tar.gz && rm leaf-app-code.tar.gz"
```

#### Passo 6: Build e Iniciar

Na VPS:

```bash
cd /opt/leaf-app
docker-compose build
docker-compose up -d
```

## 🔍 Verificação

### Verificar Status dos Containers

```bash
ssh root@147.93.66.253 "cd /opt/leaf-app && docker-compose ps"
```

### Verificar Logs

```bash
ssh root@147.93.66.253 "cd /opt/leaf-app && docker-compose logs -f"
```

### Testar Endpoints

```bash
# Health Check
curl http://147.93.66.253/health

# WebSocket Server direto
curl http://147.93.66.253:3001/health
```

## 🔧 Configuração Woovi

### 1. Configurar Webhook na Woovi Dashboard

1. Acesse: https://app.woovi.com/
2. Vá em: **Configurações > Webhooks**
3. Crie/Atualize webhook:
   - **URL**: `http://147.93.66.253/api/woovi/webhook`
   - **Eventos**:
     - `OPENPIX:CHARGE_COMPLETED`
     - `OPENPIX:CHARGE_CREATED`
     - `OPENPIX:CHARGE_EXPIRED`
     - `PIX_TRANSACTION_REFUND_RECEIVED_CONFIRMED`

### 2. Verificar Variáveis de Ambiente

Certifique-se de que as variáveis Woovi estão configuradas no `.env`:

```bash
ssh root@147.93.66.253 "cd /opt/leaf-app && cat .env | grep WOOVI"
```

## 🔄 Atualizações

### Atualizar Código

```bash
# 1. Fazer alterações localmente
# 2. Criar novo tarball
tar --exclude='node_modules' \
    --exclude='.git' \
    --exclude='logs' \
    -czf /tmp/leaf-app-code.tar.gz .

# 3. Copiar para VPS
scp /tmp/leaf-app-code.tar.gz root@147.93.66.253:/opt/leaf-app/

# 4. Na VPS, atualizar
ssh root@147.93.66.253 << 'EOF'
cd /opt/leaf-app
docker-compose down
tar -xzf leaf-app-code.tar.gz
rm leaf-app-code.tar.gz
docker-compose build
docker-compose up -d
EOF
```

### Reiniciar Serviços

```bash
ssh root@147.93.66.253 "cd /opt/leaf-app && docker-compose restart"
```

### Parar Serviços

```bash
ssh root@147.93.66.253 "cd /opt/leaf-app && docker-compose down"
```

## 🐛 Troubleshooting

### Container não inicia

```bash
# Ver logs detalhados
ssh root@147.93.66.253 "cd /opt/leaf-app && docker-compose logs websocket"

# Verificar variáveis de ambiente
ssh root@147.93.66.253 "cd /opt/leaf-app && docker-compose config"
```

### Redis não conecta

```bash
# Verificar Redis
ssh root@147.93.66.253 "cd /opt/leaf-app && docker-compose exec redis redis-cli -a leaf_redis_2024 ping"
```

### Firebase credentials não encontrado

```bash
# Verificar se arquivo existe
ssh root@147.93.66.253 "ls -la /opt/leaf-app/firebase-credentials.json"

# Verificar permissões
ssh root@147.93.66.253 "chmod 644 /opt/leaf-app/firebase-credentials.json"
```

### Webhook Woovi não funciona

1. Verificar se URL está correta no `.env`
2. Verificar se webhook está configurado na Woovi Dashboard
3. Testar webhook manualmente:

```bash
curl -X POST http://147.93.66.253/api/woovi/webhook \
  -H "Content-Type: application/json" \
  -d '{"event": "OPENPIX:CHARGE_COMPLETED", "charge": {"identifier": "test"}}'
```

## 📊 Monitoramento

### Ver Uso de Recursos

```bash
ssh root@147.93.66.253 "docker stats"
```

### Ver Logs em Tempo Real

```bash
ssh root@147.93.66.253 "cd /opt/leaf-app && docker-compose logs -f --tail=100"
```

## 🔒 Segurança

### Firewall (UFW)

```bash
# Permitir portas necessárias
ufw allow 22/tcp    # SSH
ufw allow 80/tcp    # HTTP
ufw allow 443/tcp   # HTTPS
ufw allow 3001/tcp  # WebSocket (se necessário expor diretamente)

# Ativar firewall
ufw enable
```

### Alterar Senha Redis

Edite `docker-compose.yml` e altere `REDIS_PASSWORD` e `--requirepass` no comando do Redis.

### Alterar JWT_SECRET

Edite `.env` e altere `JWT_SECRET` para um valor seguro e único.

## 📝 URLs Finais

Após o deploy:

- 🌐 **API**: `http://147.93.66.253`
- 🔌 **WebSocket**: `ws://147.93.66.253`
- 🏥 **Health Check**: `http://147.93.66.253/health`
- 💳 **Webhook Woovi**: `http://147.93.66.253/api/woovi/webhook`

## ✅ Checklist Final

- [ ] Docker instalado na VPS
- [ ] Arquivos copiados para `/opt/leaf-app`
- [ ] `.env` configurado com todas as variáveis
- [ ] `firebase-credentials.json` presente
- [ ] Containers rodando (`docker-compose ps`)
- [ ] Health check respondendo (`curl http://147.93.66.253/health`)
- [ ] Webhook configurado na Woovi Dashboard
- [ ] Firewall configurado (se necessário)
- [ ] Logs sem erros críticos

---

**Pronto!** 🎉 O Leaf App está rodando na Hostinger VPS com Docker!

