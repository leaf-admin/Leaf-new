@echo off
echo ========================================
echo    Iniciando Redis com Docker
echo ========================================

echo Verificando se o Docker esta rodando...
docker ps >nul 2>&1
if %errorlevel% neq 0 (
    echo ERRO: Docker nao esta rodando!
    echo Por favor, inicie o Docker Desktop primeiro.
    pause
    exit /b 1
)

echo Parando container Redis existente (se houver)...
docker stop redis-leaf >nul 2>&1
docker rm redis-leaf >nul 2>&1

echo Criando novo container Redis otimizado...
docker run -d --name redis-leaf -p 6379:6379 --memory=512m --cpus=1.0 --restart=unless-stopped -v /home/izaak-dias/Downloads/1.\ leaf/main/Sourcecode/redis-config/redis-optimized.conf:/usr/local/etc/redis/redis.conf redis:7-alpine redis-server /usr/local/etc/redis/redis.conf

if %errorlevel% equ 0 (
    echo.
    echo ========================================
    echo    Redis iniciado com sucesso!
    echo ========================================
    echo.
    echo Redis esta rodando na porta 6379
    echo Para testar: node test-redis.js
    echo.
    echo Comandos uteis:
    echo - Parar Redis: docker stop redis-leaf
    echo - Iniciar Redis: docker start redis-leaf
    echo - Remover Redis: docker rm -f redis-leaf
    echo.
) else (
    echo ERRO: Falha ao criar container Redis
    pause
    exit /b 1
)

echo Aguardando Redis inicializar...
timeout /t 3 /nobreak >nul

echo Testando conexao...
docker exec redis-leaf redis-cli ping
if %errorlevel% equ 0 (
    echo Redis esta respondendo corretamente!
) else (
    echo AVISO: Redis pode nao estar totalmente inicializado ainda.
)

echo.
echo Pressione qualquer tecla para sair...
pause >nul 