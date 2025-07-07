# 🔧 Solução de Problemas Redis - LEAF

## 🚨 **Problema: Container Redis não encontrado**

### **Sintoma:**
```
Error response from daemon: No such container: redis-taxi-app
```

### **Causas Possíveis:**
1. Container nunca foi criado
2. Container foi removido
3. Docker Desktop não está rodando
4. Problema de permissões

---

## 🛠️ **Soluções Passo a Passo**

### **Solução 1: Diagnóstico Automático**
```bash
# Execute o script de diagnóstico
diagnose-redis.bat
```

### **Solução 2: Verificação Manual**

#### **Passo 1: Verificar Docker**
```bash
# Verificar se Docker está rodando
docker version

# Se não estiver rodando, abra o Docker Desktop
```

#### **Passo 2: Verificar Containers**
```bash
# Ver todos os containers (ativos e parados)
docker ps -a

# Ver apenas containers ativos
docker ps

# Ver containers com nome específico
docker ps -a | findstr redis-taxi-app
```

#### **Passo 3: Criar/Iniciar Redis**
```bash
# Opção 1: Usar docker-compose
docker-compose up -d redis

# Opção 2: Forçar recriação
docker-compose up -d --force-recreate redis

# Opção 3: Remover e recriar
docker-compose down
docker-compose up -d redis
```

#### **Passo 4: Verificar Logs**
```bash
# Ver logs do Redis
docker-compose logs redis

# Ver logs em tempo real
docker-compose logs -f redis

# Ver logs específicos
docker logs redis-taxi-app
```

---

## 🔍 **Diagnóstico Detalhado**

### **1. Verificar Ambiente Docker**
```bash
# Verificar versão do Docker
docker --version

# Verificar se Docker está rodando
docker info

# Verificar imagens disponíveis
docker images | findstr redis
```

### **2. Verificar Arquivos de Configuração**
```bash
# Verificar se docker-compose.yml existe
dir docker-compose.yml

# Verificar configuração Redis
dir redis-config\redis.conf

# Verificar se está no diretório correto
pwd
```

### **3. Verificar Rede Docker**
```bash
# Verificar redes
docker network ls

# Verificar rede específica
docker network inspect leaf-network
```

---

## 🚀 **Comandos de Recuperação**

### **Recuperação Rápida:**
```bash
# 1. Parar tudo
docker-compose down

# 2. Limpar containers órfãos
docker container prune -f

# 3. Reconstruir
docker-compose up -d redis

# 4. Verificar
docker ps | findstr redis-taxi-app
```

### **Recuperação Completa:**
```bash
# 1. Parar e remover tudo
docker-compose down -v

# 2. Limpar imagens
docker image prune -f

# 3. Reconstruir do zero
docker-compose up -d --build redis

# 4. Verificar logs
docker-compose logs redis
```

---

## 📋 **Checklist de Verificação**

### **Pré-requisitos:**
- [ ] Docker Desktop instalado e rodando
- [ ] Executando como administrador
- [ ] No diretório correto do projeto
- [ ] Arquivos de configuração presentes

### **Verificações:**
- [ ] `docker version` retorna versão
- [ ] `docker ps` lista containers
- [ ] `docker-compose.yml` existe
- [ ] `redis-config/redis.conf` existe
- [ ] Container `leaf-redis` criado
- [ ] Container `leaf-redis` rodando
- [ ] `docker exec leaf-redis redis-cli ping` retorna PONG

---

## 🎯 **Comandos de Teste**

### **Teste Básico:**
```bash
# Testar conectividade
docker exec leaf-redis redis-cli ping

# Testar comandos básicos
docker exec leaf-redis redis-cli SET test "Hello"
docker exec leaf-redis redis-cli GET test
docker exec leaf-redis redis-cli DEL test
```

### **Teste GEO:**
```bash
# Testar comandos GEO
docker exec leaf-redis redis-cli GEOADD test_geo 13.361389 38.115556 "Palermo"
docker exec leaf-redis redis-cli GEORADIUS test_geo 13.361389 38.115556 100 km
docker exec leaf-redis redis-cli DEL test_geo
```

### **Teste Performance:**
```bash
# Testar performance básica
docker exec leaf-redis redis-cli --eval - <<EOF
for i=1,1000 do
    redis.call('SET', 'key'..i, 'value'..i)
end
return 'OK'
EOF
```

---

## 🚨 **Problemas Comuns e Soluções**

### **Problema 1: Porta 6379 já em uso**
```bash
# Verificar o que está usando a porta
netstat -ano | findstr :6379

# Parar processo se necessário
taskkill /PID <PID> /F

# Ou usar porta diferente no docker-compose.yml
```

### **Problema 2: Permissões de arquivo**
```bash
# Executar como administrador
# Ou ajustar permissões dos arquivos
```

### **Problema 3: Memória insuficiente**
```bash
# Aumentar memória do Docker Desktop
# Ou ajustar configuração Redis
```

### **Problema 4: Rede não encontrada**
```bash
# Criar rede manualmente
docker network create leaf-network

# Ou usar rede padrão
```

---

## 📞 **Logs e Debugging**

### **Logs Importantes:**
```bash
# Logs do container
docker logs leaf-redis

# Logs do docker-compose
docker-compose logs redis

# Logs em tempo real
docker-compose logs -f redis

# Logs com timestamps
docker-compose logs -t redis
```

### **Informações do Sistema:**
```bash
# Informações do container
docker inspect leaf-redis

# Estatísticas do container
docker stats leaf-redis

# Informações da rede
docker network inspect leaf-network
```

---

## ✅ **Verificação Final**

### **Após resolver o problema:**
```bash
# 1. Verificar se está rodando
docker ps | findstr redis

# 2. Testar conectividade
docker exec leaf-redis redis-cli ping

# 3. Testar comandos básicos
docker exec leaf-redis redis-cli SET test "OK"
docker exec leaf-redis redis-cli GET test

# 4. Executar testes completos
run-all-redis-tests.bat
```

---

## 🎯 **Próximos Passos**

### **Se o problema foi resolvido:**
1. ✅ Execute `run-all-redis-tests.bat`
2. ✅ Teste as APIs: `node test-redis-apis.js`
3. ✅ Teste performance: `node test-load.js`
4. ✅ Teste mobile: Siga `MOBILE_TESTING_GUIDE.md`

### **Se o problema persiste:**
1. 🔧 Execute `diagnose-redis.bat`
2. 🔧 Verifique logs detalhados
3. 🔧 Consulte este guia novamente
4. 🔧 Considere reinstalar Docker Desktop

---

## 📞 **Suporte**

### **Informações para suporte:**
- Versão do Docker: `docker --version`
- Versão do docker-compose: `docker-compose --version`
- Sistema operacional: `systeminfo | findstr "OS"`
- Logs completos: `docker-compose logs redis`

### **Comandos úteis:**
```bash
# Informações do sistema
systeminfo | findstr "OS"

# Versões instaladas
docker --version
docker-compose --version
node --version

# Status dos serviços
docker info
docker system df
```

**🎯 Lembre-se: O Redis é essencial para o funcionamento do sistema. Resolva este problema antes de prosseguir com os testes!** 