# Dockerfile otimizado para produção
FROM node:18-alpine

# Instalar dependências do sistema
RUN apk add --no-cache \
    curl \
    bash \
    postgresql-client

# Criar diretório da aplicação
WORKDIR /app

# Copiar package.json e package-lock.json
COPY package*.json ./

# Instalar dependências de produção
RUN npm ci && npm cache clean --force

# Copiar código da aplicação
COPY . .

# Criar usuário não-root
RUN addgroup -g 1001 -S nodejs && \
    adduser -S leaf -u 1001

# Mudar propriedade dos arquivos
RUN chown -R leaf:nodejs /app

# Mudar para usuário não-root
USER leaf

# Expor porta
EXPOSE 3001

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:3001/health || exit 1

# Comando de inicialização
CMD ["node", "server.js"]