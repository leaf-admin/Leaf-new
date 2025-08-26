# Dockerfile para Leaf WebSocket Backend
# Suporte para megacidades (1M+ usuários simultâneos)

FROM node:18-alpine

# Configurações de performance
ENV NODE_ENV=production
ENV NODE_OPTIONS="--max-old-space-size=4096"
ENV UV_THREADPOOL_SIZE=64

# Instalar dependências do sistema
RUN apk add --no-cache \
    curl \
    htop \
    && rm -rf /var/cache/apk/*

# Criar usuário não-root para segurança
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001

# Definir diretório de trabalho
WORKDIR /app

# Copiar package files
COPY package*.json ./

# Instalar dependências com cache otimizado
RUN npm ci --only=production --cache=/tmp/.npm && \
    npm cache clean --force && \
    rm -rf /tmp/.npm

# Copiar código da aplicação
COPY . .

# Configurar permissões
RUN chown -R nodejs:nodejs /app
USER nodejs

# Expor porta
EXPOSE 3001

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:3001/health || exit 1

# Comando de inicialização
CMD ["node", "server.js"]
