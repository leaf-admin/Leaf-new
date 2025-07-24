# Teste de Build Mobile - PowerShell
Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "🚀 TESTE DE BUILD MOBILE" -ForegroundColor Yellow
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Verificando se o app vai carregar corretamente..." -ForegroundColor White
Write-Host ""

try {
    node test-mobile-build.js
    
    if ($LASTEXITCODE -eq 0) {
        Write-Host ""
        Write-Host "✅ TESTE PASSOU! App deve carregar corretamente no dispositivo móvel." -ForegroundColor Green
        Write-Host ""
        Write-Host "Próximos passos:" -ForegroundColor Yellow
        Write-Host "1. Execute: cd mobile-app" -ForegroundColor White
        Write-Host "2. Execute: npx expo start" -ForegroundColor White
        Write-Host "3. Teste no dispositivo/emulador" -ForegroundColor White
        Write-Host ""
    } else {
        Write-Host ""
        Write-Host "❌ TESTE FALHOU! Corrija os problemas antes de fazer build." -ForegroundColor Red
        Write-Host ""
        Write-Host "Dicas:" -ForegroundColor Yellow
        Write-Host "- Verifique se há imports de módulos Node.js incompatíveis" -ForegroundColor White
        Write-Host "- Confirme se o metro.config.js está correto" -ForegroundColor White
        Write-Host "- Verifique se não há dependências Redis no package.json" -ForegroundColor White
        Write-Host ""
    }
} catch {
    Write-Host ""
    Write-Host "❌ ERRO AO EXECUTAR TESTE: $($_.Exception.Message)" -ForegroundColor Red
    Write-Host ""
}

Read-Host "Pressione Enter para continuar..." 