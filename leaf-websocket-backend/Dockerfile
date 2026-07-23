# Dockerfile otimizado para produção
FROM node:20-alpine

# Instalar dependências do sistema
RUN apk add --no-cache \
    curl \
    bash \
    poppler-utils \
    postgresql-client

# Criar usuário não-root antes de copiar o código.
RUN addgroup -g 1001 -S nodejs && \
    adduser -S leaf -u 1001

# Criar diretório da aplicação
WORKDIR /app

# Copiar package.json e package-lock.json
COPY package*.json ./

# Instalar dependências de produção
RUN npm install --omit=dev && npm cache clean --force

# Copiar código da aplicação já com owner correto, sem chown recursivo em node_modules.
COPY --chown=leaf:nodejs . .

# Garantir escrita no diretório de logs sem percorrer a árvore inteira do app.
RUN mkdir -p /app/logs && chown leaf:nodejs /app/logs

# Mudar para usuário não-root
USER leaf

# Expor porta
EXPOSE 3001

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:3001/health/liveness || exit 1

# Comando de inicialização (runtime selecionável por variável de ambiente)
CMD ["bash", "./scripts/runtime/start-server.sh"]
