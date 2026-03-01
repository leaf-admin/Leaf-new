# 📦 Instalação Manual - @socket.io/redis-adapter

## Problema de Permissões

Se você está tendo problemas de permissão ao instalar (erro EPERM), tente uma das soluções abaixo:

## Solução 1: --no-bin-links (Recomendado)

```bash
cd leaf-websocket-backend
npm install @socket.io/redis-adapter --save --no-bin-links
```

## Solução 2: Instalar em diretório temporário e copiar

```bash
# Criar diretório temporário
mkdir -p /tmp/leaf-install
cd /tmp/leaf-install

# Instalar apenas o pacote necessário
npm install @socket.io/redis-adapter

# Copiar para o projeto
cp -r node_modules/@socket.io/redis-adapter "/media/izaak-dias/T7 Shield/1. leaf/main/Sourcecode/leaf-websocket-backend/node_modules/"
```

## Solução 3: Usar sudo (não recomendado, mas funciona)

```bash
sudo npm install @socket.io/redis-adapter --save
```

## Solução 4: Instalar globalmente e linkar

```bash
npm install -g @socket.io/redis-adapter
npm link @socket.io/redis-adapter
```

## Verificar Instalação

```bash
# Verificar se está instalado
ls -la node_modules/@socket.io/redis-adapter/

# Testar carregamento
node -e "require('@socket.io/redis-adapter'); console.log('✅ OK');"
```

## Após Instalação

1. Execute o servidor:
```bash
NODE_ENV=production node server.js
```

2. Procure nos logs:
```
✅ Socket.IO Redis Adapter configurado - Sistema pronto para escalar horizontalmente
```

3. Teste o health check:
```bash
curl http://localhost:3001/health
```

