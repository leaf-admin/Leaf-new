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
docker stop redis-taxi-app >nul 2>&1
docker rm redis-taxi-app >nul 2>&1

echo Criando novo container Redis...
docker run -d --name redis-taxi-app -p 6379:6379 --restart unless-stopped redis:7-alpine

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
    echo - Parar Redis: docker stop redis-taxi-app
    echo - Iniciar Redis: docker start redis-taxi-app
    echo - Remover Redis: docker rm -f redis-taxi-app
    echo.
) else (
    echo ERRO: Falha ao criar container Redis
    pause
    exit /b 1
)

echo Aguardando Redis inicializar...
timeout /t 3 /nobreak >nul

echo Testando conexao...
docker exec redis-taxi-app redis-cli ping
if %errorlevel% equ 0 (
    echo Redis esta respondendo corretamente!
) else (
    echo AVISO: Redis pode nao estar totalmente inicializado ainda.
)

echo.
echo Pressione qualquer tecla para sair...
pause >nul 