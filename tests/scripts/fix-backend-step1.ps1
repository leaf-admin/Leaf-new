# Script para corrigir o backend - PASSO 1
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "    CORREÇÃO DO BACKEND - PASSO 1" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan

# 1. Verificar se estamos no diretório correto
Write-Host "`n1. Verificando diretório..." -ForegroundColor Yellow
$currentDir = Get-Location
Write-Host "Diretório atual: $currentDir" -ForegroundColor Green

# 2. Verificar se o Docker está rodando
Write-Host "`n2. Verificando Docker..." -ForegroundColor Yellow
try {
    $dockerVersion = docker --version 2>$null
    if ($dockerVersion) {
        Write-Host "✅ Docker está disponível: $dockerVersion" -ForegroundColor Green
    } else {
        Write-Host "❌ Docker não está disponível" -ForegroundColor Red
        Write-Host "   Por favor, instale o Docker Desktop e inicie-o" -ForegroundColor Yellow
        exit 1
    }
} catch {
    Write-Host "❌ Docker não está disponível" -ForegroundColor Red
    Write-Host "   Por favor, instale o Docker Desktop e inicie-o" -ForegroundColor Yellow
    exit 1
}

# 3. Verificar se o Redis está rodando
Write-Host "`n3. Verificando Redis..." -ForegroundColor Yellow
$redisRunning = docker ps --format "table {{.Names}}\t{{.Status}}" | Select-String "redis"
if ($redisRunning) {
    Write-Host "✅ Redis está rodando:" -ForegroundColor Green
    Write-Host $redisRunning -ForegroundColor White
} else {
    Write-Host "⚠️ Redis não está rodando. Iniciando..." -ForegroundColor Yellow
    
    # Tentar iniciar Redis via docker-compose
    try {
        Write-Host "   Executando: docker-compose up -d redis" -ForegroundColor Gray
        docker-compose up -d redis
        
        # Aguardar inicialização
        Start-Sleep -Seconds 5
        
        # Verificar novamente
        $redisRunning = docker ps --format "table {{.Names}}\t{{.Status}}" | Select-String "redis"
        if ($redisRunning) {
            Write-Host "✅ Redis iniciado com sucesso!" -ForegroundColor Green
        } else {
            Write-Host "❌ Falha ao iniciar Redis" -ForegroundColor Red
            Write-Host "   Verificando logs..." -ForegroundColor Yellow
            docker-compose logs redis
            exit 1
        }
    } catch {
        Write-Host "❌ Erro ao iniciar Redis: $_" -ForegroundColor Red
        exit 1
    }
}

# 4. Testar conectividade Redis
Write-Host "`n4. Testando conectividade Redis..." -ForegroundColor Yellow
try {
    $redisPing = docker exec redis-taxi-app redis-cli ping 2>$null
    if ($redisPing -eq "PONG") {
        Write-Host "✅ Redis responde corretamente" -ForegroundColor Green
    } else {
        Write-Host "❌ Redis não responde" -ForegroundColor Red
        exit 1
    }
} catch {
    Write-Host "❌ Erro ao testar Redis: $_" -ForegroundColor Red
    exit 1
}

# 5. Verificar configurações do backend
Write-Host "`n5. Verificando configurações do backend..." -ForegroundColor Yellow
$backendDir = "leaf-websocket-backend"
if (Test-Path $backendDir) {
    Write-Host "✅ Diretório do backend encontrado" -ForegroundColor Green
    
    # Verificar se server.js existe
    if (Test-Path "$backendDir\server.js") {
        Write-Host "✅ server.js encontrado" -ForegroundColor Green
    } else {
        Write-Host "❌ server.js não encontrado" -ForegroundColor Red
        exit 1
    }
    
    # Verificar se package.json existe
    if (Test-Path "$backendDir\package.json") {
        Write-Host "✅ package.json encontrado" -ForegroundColor Green
    } else {
        Write-Host "❌ package.json não encontrado" -ForegroundColor Red
        exit 1
    }
} else {
    Write-Host "❌ Diretório do backend não encontrado" -ForegroundColor Red
    exit 1
}

# 6. Instalar dependências se necessário
Write-Host "`n6. Verificando dependências..." -ForegroundColor Yellow
if (Test-Path "$backendDir\node_modules") {
    Write-Host "✅ node_modules encontrado" -ForegroundColor Green
} else {
    Write-Host "⚠️ node_modules não encontrado. Instalando dependências..." -ForegroundColor Yellow
    try {
        Set-Location $backendDir
        npm install
        Set-Location ..
        Write-Host "✅ Dependências instaladas" -ForegroundColor Green
    } catch {
        Write-Host "❌ Erro ao instalar dependências: $_" -ForegroundColor Red
        exit 1
    }
}

# 7. Testar se o backend consegue conectar ao Redis
Write-Host "`n7. Testando conexão backend -> Redis..." -ForegroundColor Yellow
try {
    # Criar um teste simples
    $testScript = @"
const Redis = require('ioredis');

const redis = new Redis({
    host: 'localhost',
    port: 6379,
    maxRetriesPerRequest: 3,
    retryDelayOnFailover: 100,
    enableReadyCheck: true,
    maxLoadingTimeout: 10000,
    lazyConnect: true,
    connectTimeout: 10000,
    commandTimeout: 5000,
    keepAlive: 30000,
    family: 4
});

redis.on('connect', () => {
    console.log('✅ Backend conectado ao Redis');
    redis.set('test_backend', 'OK');
    redis.get('test_backend', (err, result) => {
        if (result === 'OK') {
            console.log('✅ Teste de escrita/leitura OK');
            process.exit(0);
        } else {
            console.log('❌ Teste de escrita/leitura falhou');
            process.exit(1);
        }
    });
});

redis.on('error', (err) => {
    console.log('❌ Erro na conexão com Redis:', err.message);
    process.exit(1);
});

setTimeout(() => {
    console.log('❌ Timeout na conexão com Redis');
    process.exit(1);
}, 10000);
"@

    $testScript | Out-File -FilePath "$backendDir\test-redis-connection.js" -Encoding UTF8
    Set-Location $backendDir
    $testResult = node test-redis-connection.js 2>&1
    Set-Location ..
    Remove-Item "$backendDir\test-redis-connection.js" -ErrorAction SilentlyContinue
    
    if ($LASTEXITCODE -eq 0) {
        Write-Host "✅ Backend consegue conectar ao Redis" -ForegroundColor Green
    } else {
        Write-Host "❌ Backend não consegue conectar ao Redis" -ForegroundColor Red
        Write-Host "   Erro: $testResult" -ForegroundColor Yellow
        exit 1
    }
} catch {
    Write-Host "❌ Erro ao testar conexão: $_" -ForegroundColor Red
    exit 1
}

Write-Host "`n========================================" -ForegroundColor Cyan
Write-Host "    PASSO 1 CONCLUÍDO COM SUCESSO!" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "`n✅ Redis está funcionando" -ForegroundColor Green
Write-Host "✅ Backend pode conectar ao Redis" -ForegroundColor Green
Write-Host "✅ Dependências estão instaladas" -ForegroundColor Green
Write-Host "`nPróximo passo: Iniciar o backend" -ForegroundColor Yellow
Write-Host "Execute: cd leaf-websocket-backend && node server.js" -ForegroundColor Cyan 