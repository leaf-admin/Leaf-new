# Script simples para verificar status
Write-Host "=== VERIFICAÇÃO DE STATUS ===" -ForegroundColor Cyan

# 1. Verificar Docker
Write-Host "`n1. Docker:" -ForegroundColor Yellow
try {
    $docker = docker --version 2>$null
    if ($docker) {
        Write-Host "✅ $docker" -ForegroundColor Green
    } else {
        Write-Host "❌ Não disponível" -ForegroundColor Red
    }
} catch {
    Write-Host "❌ Não disponível" -ForegroundColor Red
}

# 2. Verificar Redis
Write-Host "`n2. Redis:" -ForegroundColor Yellow
try {
    $redis = docker ps | Select-String "redis"
    if ($redis) {
        Write-Host "✅ Rodando: $redis" -ForegroundColor Green
    } else {
        Write-Host "❌ Não está rodando" -ForegroundColor Red
    }
} catch {
    Write-Host "❌ Erro ao verificar" -ForegroundColor Red
}

# 3. Verificar Backend
Write-Host "`n3. Backend:" -ForegroundColor Yellow
try {
    $response = Invoke-WebRequest -Uri "http://localhost:3001/health" -TimeoutSec 5 2>$null
    if ($response.StatusCode -eq 200) {
        Write-Host "✅ Rodando na porta 3001" -ForegroundColor Green
    } else {
        Write-Host "❌ Não responde corretamente" -ForegroundColor Red
    }
} catch {
    Write-Host "❌ Não está rodando" -ForegroundColor Red
}

# 4. Verificar arquivos
Write-Host "`n4. Arquivos:" -ForegroundColor Yellow
$files = @(
    "leaf-websocket-backend\server.js",
    "leaf-websocket-backend\package.json",
    "docker-compose.yml"
)

foreach ($file in $files) {
    if (Test-Path $file) {
        Write-Host "✅ $file" -ForegroundColor Green
    } else {
        Write-Host "❌ $file" -ForegroundColor Red
    }
}

Write-Host "`n=== FIM DA VERIFICAÇÃO ===" -ForegroundColor Cyan 