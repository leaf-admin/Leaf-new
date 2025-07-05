Write-Host "🚀 Iniciando servidor LEAF WebSocket Backend..." -ForegroundColor Green

Write-Host "🔍 Verificando processos na porta 3001..." -ForegroundColor Yellow
$processes = Get-NetTCPConnection -LocalPort 3001 -ErrorAction SilentlyContinue

if ($processes) {
    foreach ($process in $processes) {
        $pid = $process.OwningProcess
        $processName = (Get-Process -Id $pid -ErrorAction SilentlyContinue).ProcessName
        Write-Host "🛑 Parando processo: $processName (PID: $pid)" -ForegroundColor Red
        Stop-Process -Id $pid -Force -ErrorAction SilentlyContinue
    }
}

Write-Host "⏳ Aguardando 2 segundos..." -ForegroundColor Yellow
Start-Sleep -Seconds 2

Write-Host "📦 Instalando dependências se necessário..." -ForegroundColor Yellow
npm install

Write-Host "🔧 Iniciando servidor..." -ForegroundColor Green
node server.js 