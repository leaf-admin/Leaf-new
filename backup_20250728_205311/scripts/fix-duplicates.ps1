# Script para corrigir arquivos duplicados no dashboard
Write-Host "🔧 Corrigindo arquivos duplicados..." -ForegroundColor Yellow

# Lista de arquivos que podem estar duplicados
$files = @(
    "package.json",
    "tsconfig.json",
    "src/index.tsx",
    "src/App.tsx",
    "src/components/LoginPage.tsx",
    "src/components/Dashboard.tsx",
    "src/components/NotificationBell.tsx",
    "src/components/StatusCard.tsx",
    "src/components/MetricsCard.tsx",
    "src/components/AlertCard.tsx",
    "src/contexts/AuthContext.tsx",
    "src/services/metricsApi.ts",
    "src/types/metrics.ts"
)

foreach ($file in $files) {
    $filePath = "leaf-dashboard/$file"
    if (Test-Path $filePath) {
        Write-Host "Verificando $file..." -ForegroundColor Cyan
        
        $content = Get-Content $filePath -Raw
        $lines = $content -split "`n"
        
        # Verificar se há duplicação
        $hasDuplication = $false
        $firstOccurrence = $null
        
        for ($i = 0; $i -lt $lines.Count; $i++) {
            $line = $lines[$i].Trim()
            
            # Procurar por padrões que indicam duplicação
            if ($line -match '^import ' -or $line -match '^export ' -or $line -match '^const ' -or $line -match '^function ' -or $line -match '^class ') {
                if ($firstOccurrence -eq $null) {
                    $firstOccurrence = $i
                } else {
                    # Verificar se é uma duplicação
                    $currentLine = $line
                    $firstLine = $lines[$firstOccurrence].Trim()
                    
                    if ($currentLine -eq $firstLine) {
                        Write-Host "  ❌ Duplicação encontrada em $file na linha $($i+1)" -ForegroundColor Red
                        $hasDuplication = $true
                        break
                    }
                }
            }
        }
        
        if ($hasDuplication) {
            Write-Host "  🔧 Corrigindo $file..." -ForegroundColor Yellow
            
            # Tentar corrigir removendo duplicações
            $correctedContent = $content
            
            # Remover duplicações comuns
            $patterns = @(
                @{
                    Pattern = '(import.*?;[\s\S]*?export default.*?;[\s\S]*?)(import.*?;[\s\S]*?export default.*?;[\s\S]*?)(import.*?;[\s\S]*?export default.*?;[\s\S]*?)'
                    Replacement = '$1'
                },
                @{
                    Pattern = '(\{[^}]*"name":\s*"[^"]*"[^}]*\}[\s\S]*?)(\{[^}]*"name":\s*"[^"]*"[^}]*\}[\s\S]*?)(\{[^}]*"name":\s*"[^"]*"[^}]*\}[\s\S]*?)'
                    Replacement = '$1'
                }
            )
            
            foreach ($pattern in $patterns) {
                $correctedContent = $correctedContent -replace $pattern.Pattern, $pattern.Replacement
            }
            
            # Salvar arquivo corrigido
            Set-Content -Path $filePath -Value $correctedContent -Encoding UTF8
            Write-Host "  ✅ $file corrigido" -ForegroundColor Green
        } else {
            Write-Host "  ✅ $file OK" -ForegroundColor Green
        }
    }
}

Write-Host "🎉 Correção concluída!" -ForegroundColor Green 