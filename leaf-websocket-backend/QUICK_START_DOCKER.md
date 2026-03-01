# 🚀 Quick Start - Docker e Redis

## ⚡ Comandos Rápidos

### Deploy na VPS
```bash
cd leaf-websocket-backend
./scripts/deploy/docker-deploy-vps.sh
```

### Testar Redis
```bash
cd leaf-websocket-backend
node scripts/tests/test-docker-redis.js
```

### Testar Eventos WebSocket
```bash
cd leaf-websocket-backend
node scripts/tests/test-eventos-listeners-completo.js
```

### Ver Logs na VPS
```bash
ssh root@147.93.66.253 "cd /opt/leaf-app && docker-compose logs -f"
```

### Status dos Containers
```bash
ssh root@147.93.66.253 "cd /opt/leaf-app && docker-compose ps"
```

### Reiniciar Serviços
```bash
ssh root@147.93.66.253 "cd /opt/leaf-app && docker-compose restart"
```

## 📋 O Que Foi Feito

✅ **DockerDetector** - Detecta automaticamente Docker vs VPS
✅ **Redis Pool** - Configuração automática baseada no ambiente
✅ **Socket.IO Adapter** - Configuração automática do Redis
✅ **Support Chat** - Configuração automática do Redis
✅ **Scripts de Deploy** - Deploy automatizado
✅ **Scripts de Teste** - Testes automatizados

## 🔧 Configuração Automática

O sistema agora detecta automaticamente:
- **Docker**: Usa `redis` como host
- **VPS Direto**: Usa `localhost` como host

**Não precisa configurar nada manualmente!**

## 📚 Documentação Completa

- `docs/AJUSTES_DOCKER_REDIS.md` - Documentação completa
- `docs/RESUMO_AJUSTES_DOCKER.md` - Resumo executivo

---

**Tudo pronto para rodar os testes!** 🎉

