# Script para corrigir TODOS os arquivos duplicados no projeto
Write-Host "🔧 Corrigindo TODOS os arquivos duplicados..." -ForegroundColor Yellow

# Função para corrigir um arquivo específico
function Fix-DuplicatedFile {
    param(
        [string]$FilePath
    )
    
    if (Test-Path $FilePath) {
        Write-Host "Verificando $FilePath..." -ForegroundColor Cyan
        
        $content = Get-Content $FilePath -Raw -Encoding UTF8
        if ($content -eq $null) {
            Write-Host "  ⚠️ Arquivo vazio ou não legível" -ForegroundColor Yellow
            return
        }
        
        $originalContent = $content
        $hasChanges = $false
        
        # Padrões de duplicação para diferentes tipos de arquivo
        $patterns = @()
        
        # Para arquivos JSON
        if ($FilePath -match '\.json$') {
            $patterns += @(
                @{
                    Pattern = '(\{[^}]*"name":\s*"[^"]*"[^}]*\}[\s\S]*?)(\{[^}]*"name":\s*"[^"]*"[^}]*\}[\s\S]*?)(\{[^}]*"name":\s*"[^"]*"[^}]*\}[\s\S]*?)'
                    Replacement = '$1'
                },
                @{
                    Pattern = '(\{[^}]*"version":\s*"[^"]*"[^}]*\}[\s\S]*?)(\{[^}]*"version":\s*"[^"]*"[^}]*\}[\s\S]*?)(\{[^}]*"version":\s*"[^"]*"[^}]*\}[\s\S]*?)'
                    Replacement = '$1'
                }
            )
        }
        
        # Para arquivos JavaScript/TypeScript
        if ($FilePath -match '\.(js|ts|jsx|tsx)$') {
            $patterns += @(
                @{
                    Pattern = '(import.*?;[\s\S]*?export default.*?;[\s\S]*?)(import.*?;[\s\S]*?export default.*?;[\s\S]*?)(import.*?;[\s\S]*?export default.*?;[\s\S]*?)'
                    Replacement = '$1'
                },
                @{
                    Pattern = '(const\s+\w+\s*=.*?;[\s\S]*?)(const\s+\w+\s*=.*?;[\s\S]*?)(const\s+\w+\s*=.*?;[\s\S]*?)'
                    Replacement = '$1'
                },
                @{
                    Pattern = '(function\s+\w+.*?\{[\s\S]*?\}[\s\S]*?)(function\s+\w+.*?\{[\s\S]*?\}[\s\S]*?)(function\s+\w+.*?\{[\s\S]*?\}[\s\S]*?)'
                    Replacement = '$1'
                },
                @{
                    Pattern = '(class\s+\w+.*?\{[\s\S]*?\}[\s\S]*?)(class\s+\w+.*?\{[\s\S]*?\}[\s\S]*?)(class\s+\w+.*?\{[\s\S]*?\}[\s\S]*?)'
                    Replacement = '$1'
                },
                @{
                    Pattern = '(module\.exports\s*=.*?;[\s\S]*?)(module\.exports\s*=.*?;[\s\S]*?)(module\.exports\s*=.*?;[\s\S]*?)'
                    Replacement = '$1'
                }
            )
        }
        
        # Para arquivos CSS
        if ($FilePath -match '\.css$') {
            $patterns += @(
                @{
                    Pattern = '(@tailwind.*?;[\s\S]*?)(@tailwind.*?;[\s\S]*?)(@tailwind.*?;[\s\S]*?)'
                    Replacement = '$1'
                },
                @{
                    Pattern = '(@apply.*?;[\s\S]*?)(@apply.*?;[\s\S]*?)(@apply.*?;[\s\S]*?)'
                    Replacement = '$1'
                }
            )
        }
        
        # Aplicar padrões
        foreach ($pattern in $patterns) {
            $newContent = $content -replace $pattern.Pattern, $pattern.Replacement
            if ($newContent -ne $content) {
                $content = $newContent
                $hasChanges = $true
            }
        }
        
        # Verificar se há duplicações simples (linhas idênticas consecutivas)
        $lines = $content -split "`n"
        $cleanedLines = @()
        $previousLine = ""
        
        foreach ($line in $lines) {
            if ($line.Trim() -ne $previousLine.Trim() -or $line.Trim() -eq "") {
                $cleanedLines += $line
                $previousLine = $line
            }
        }
        
        $cleanedContent = $cleanedLines -join "`n"
        if ($cleanedContent -ne $content) {
            $content = $cleanedContent
            $hasChanges = $true
        }
        
        if ($hasChanges) {
            try {
                Set-Content -Path $FilePath -Value $content -Encoding UTF8 -NoNewline
                Write-Host "  ✅ $FilePath corrigido" -ForegroundColor Green
            }
            catch {
                Write-Host "  ❌ Erro ao salvar $FilePath : $($_.Exception.Message)" -ForegroundColor Red
            }
        } else {
            Write-Host "  ✅ $FilePath OK" -ForegroundColor Green
        }
    }
}

# Lista de arquivos problemáticos identificados
$problemFiles = @(
    "firebase.json",
    "json/database-rules.json",
    "leaf-dashboard/.vscode/settings.json",
    "leaf-dashboard/check-docker-redis.js",
    "leaf-dashboard/postcss.config.js",
    "leaf-websocket-backend/diagnose-monitoring.js",
    "leaf-websocket-backend/monitoring/resource-monitor.js",
    "leaf-websocket-backend/monitoring/sync-alert-system.js",
    "leaf-websocket-backend/test-redis-connection.js",
    "mobile-app/src/config/GoogleAuthConfig.js",
    "mobile-app/src/screens/index.js",
    "mobile-app/src/services/WebSocketServiceWithRetry.js",
    "production-setup/load-balancer-config.js",
    "leaf-dashboard/src/index.css"
)

# Corrigir arquivos específicos
foreach ($file in $problemFiles) {
    Fix-DuplicatedFile -FilePath $file
}

# Procurar por outros arquivos que podem ter problemas
$extensions = @("*.json", "*.js", "*.ts", "*.jsx", "*.tsx", "*.css")
$searchPaths = @("leaf-dashboard", "leaf-websocket-backend", "mobile-app", "production-setup")

foreach ($path in $searchPaths) {
    if (Test-Path $path) {
        foreach ($ext in $extensions) {
            $files = Get-ChildItem -Path $path -Filter $ext -Recurse -File | Select-Object -ExpandProperty FullName
            foreach ($file in $files) {
                $relativePath = $file.Replace((Get-Location).Path + "\", "")
                if ($problemFiles -notcontains $relativePath) {
                    Fix-DuplicatedFile -FilePath $file
                }
            }
        }
    }
}

Write-Host "🎉 Correção de duplicações concluída!" -ForegroundColor Green
Write-Host "💡 Dica: Reinicie o VS Code para limpar o cache de diagnóstico" -ForegroundColor Cyan 