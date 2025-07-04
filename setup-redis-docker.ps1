# Script para configurar Redis com Docker
Write-Host "=== Configuração do Redis com Docker ===" -ForegroundColor Green

# Verificar se o Docker está rodando
Write-Host "Verificando se o Docker está rodando..." -ForegroundColor Yellow
try {
    docker ps > $null 2>&1
    Write-Host "✓ Docker está rodando" -ForegroundColor Green
} catch {
    Write-Host "✗ Docker não está rodando. Por favor, inicie o Docker Desktop primeiro." -ForegroundColor Red
    Write-Host "Pressione qualquer tecla para sair..."
    $null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
    exit 1
}

# Parar e remover container existente se houver
Write-Host "Removendo container Redis existente (se houver)..." -ForegroundColor Yellow
docker stop redis-taxi-app 2>$null
docker rm redis-taxi-app 2>$null

# Criar e iniciar novo container Redis
Write-Host "Criando container Redis..." -ForegroundColor Yellow
docker run -d `
    --name redis-taxi-app `
    -p 6379:6379 `
    -v redis-data:/data `
    --restart unless-stopped `
    redis:7-alpine

if ($LASTEXITCODE -eq 0) {
    Write-Host "✓ Container Redis criado com sucesso!" -ForegroundColor Green
    Write-Host "Redis está rodando na porta 6379" -ForegroundColor Cyan
    Write-Host "Para conectar: redis-cli -h localhost -p 6379" -ForegroundColor Cyan
} else {
    Write-Host "✗ Erro ao criar container Redis" -ForegroundColor Red
    exit 1
}

# Aguardar um pouco para o Redis inicializar
Write-Host "Aguardando Redis inicializar..." -ForegroundColor Yellow
Start-Sleep -Seconds 3

# Testar conexão
Write-Host "Testando conexão com Redis..." -ForegroundColor Yellow
try {
    $result = docker exec redis-taxi-app redis-cli ping
    if ($result -eq "PONG") {
        Write-Host "✓ Redis está respondendo corretamente!" -ForegroundColor Green
    } else {
        Write-Host "✗ Redis não está respondendo corretamente" -ForegroundColor Red
    }
} catch {
    Write-Host "✗ Erro ao testar conexão com Redis" -ForegroundColor Red
}

# Testar comandos GEO
Write-Host "Testando comandos GEO..." -ForegroundColor Yellow
try {
    $geoTest = docker exec redis-taxi-app redis-cli GEOADD test-locations 13.361389 38.115556 "Palermo" 15.087269 37.502669 "Catania"
    if ($geoTest -eq "2") {
        Write-Host "✓ Comandos GEO funcionando corretamente!" -ForegroundColor Green
    } else {
        Write-Host "✗ Comandos GEO não funcionando" -ForegroundColor Red
    }
    
    # Limpar teste
    docker exec redis-taxi-app redis-cli DEL test-locations > $null
} catch {
    Write-Host "✗ Erro ao testar comandos GEO" -ForegroundColor Red
}

Write-Host "`n=== Configuração concluída ===" -ForegroundColor Green
Write-Host "Redis está pronto para uso!" -ForegroundColor Cyan
Write-Host "Para parar: docker stop redis-taxi-app" -ForegroundColor Yellow
Write-Host "Para iniciar: docker start redis-taxi-app" -ForegroundColor Yellow
Write-Host "Para remover: docker rm -f redis-taxi-app" -ForegroundColor Yellow 