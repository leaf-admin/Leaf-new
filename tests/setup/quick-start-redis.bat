@echo off
echo ========================================
echo    Inicializacao Rapida Redis
echo ========================================

echo Verificando Docker...
docker --version >nul 2>&1
if %errorlevel% neq 0 (
    echo ❌ Docker nao encontrado!
    echo Por favor, instale o Docker Desktop primeiro.
    pause
    exit /b 1
)

echo Verificando se Docker esta rodando...
docker ps >nul 2>&1
if %errorlevel% neq 0 (
    echo ❌ Docker nao esta rodando!
    echo Por favor, inicie o Docker Desktop.
    pause
    exit /b 1
)

echo.
echo Iniciando Redis...
docker-compose up -d redis

if %errorlevel% equ 0 (
    echo.
    echo ========================================
    echo    ✅ Redis Iniciado com Sucesso!
    echo ========================================
    echo.
    echo 📍 Porta: 6379
    echo 🔧 Configuracao: redis-config/redis.conf
    echo 📊 Interface Web: http://localhost:8081 (opcional)
    echo.
    echo Comandos uteis:
    echo - Gerenciar: redis-manager.bat
    echo - Testar: node test-redis.js
    echo - Parar: docker-compose down
    echo.
    echo Aguardando Redis inicializar...
    timeout /t 5 /nobreak >nul
    
    echo Testando conexao...
    docker exec redis-taxi-app redis-cli ping
    if %errorlevel% equ 0 (
        echo ✅ Redis esta respondendo!
        echo.
        echo 🚀 Pronto para usar!
    ) else (
        echo ⚠️ Redis pode precisar de mais tempo para inicializar
    )
) else (
    echo ❌ Erro ao iniciar Redis
    echo Verifique se a porta 6379 esta livre
)

echo.
echo Pressione qualquer tecla para sair...
pause >nul 