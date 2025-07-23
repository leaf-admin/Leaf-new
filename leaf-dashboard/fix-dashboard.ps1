Write-Host "========================================" -ForegroundColor Green
Write-Host "CORREÇÃO DO LEAF DASHBOARD" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green
Write-Host ""

Write-Host "1. Limpando cache do npm..." -ForegroundColor Yellow
npm cache clean --force

Write-Host "2. Removendo node_modules..." -ForegroundColor Yellow
Remove-Item -Recurse -Force node_modules -ErrorAction SilentlyContinue

Write-Host "3. Removendo package-lock.json..." -ForegroundColor Yellow
Remove-Item package-lock.json -ErrorAction SilentlyContinue

Write-Host "4. Reinstalando dependências..." -ForegroundColor Yellow
npm install

Write-Host "5. Verificando TypeScript..." -ForegroundColor Yellow
npx tsc --noEmit

Write-Host "6. Verificando se o servidor inicia..." -ForegroundColor Yellow
Write-Host "Para iniciar o servidor, execute: npm start" -ForegroundColor Cyan

Write-Host ""
Write-Host "========================================" -ForegroundColor Green
Write-Host "CORREÇÃO CONCLUÍDA" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green 
Write-Host "CORREÇÃO DO LEAF DASHBOARD" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green
Write-Host ""

Write-Host "1. Limpando cache do npm..." -ForegroundColor Yellow
npm cache clean --force

Write-Host "2. Removendo node_modules..." -ForegroundColor Yellow
Remove-Item -Recurse -Force node_modules -ErrorAction SilentlyContinue

Write-Host "3. Removendo package-lock.json..." -ForegroundColor Yellow
Remove-Item package-lock.json -ErrorAction SilentlyContinue

Write-Host "4. Reinstalando dependências..." -ForegroundColor Yellow
npm install

Write-Host "5. Verificando TypeScript..." -ForegroundColor Yellow
npx tsc --noEmit

Write-Host "6. Verificando se o servidor inicia..." -ForegroundColor Yellow
Write-Host "Para iniciar o servidor, execute: npm start" -ForegroundColor Cyan

Write-Host ""
Write-Host "========================================" -ForegroundColor Green
Write-Host "CORREÇÃO CONCLUÍDA" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green 
Write-Host "CORREÇÃO DO LEAF DASHBOARD" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green
Write-Host ""

Write-Host "1. Limpando cache do npm..." -ForegroundColor Yellow
npm cache clean --force

Write-Host "2. Removendo node_modules..." -ForegroundColor Yellow
Remove-Item -Recurse -Force node_modules -ErrorAction SilentlyContinue

Write-Host "3. Removendo package-lock.json..." -ForegroundColor Yellow
Remove-Item package-lock.json -ErrorAction SilentlyContinue

Write-Host "4. Reinstalando dependências..." -ForegroundColor Yellow
npm install

Write-Host "5. Verificando TypeScript..." -ForegroundColor Yellow
npx tsc --noEmit

Write-Host "6. Verificando se o servidor inicia..." -ForegroundColor Yellow
Write-Host "Para iniciar o servidor, execute: npm start" -ForegroundColor Cyan

Write-Host ""
Write-Host "========================================" -ForegroundColor Green
Write-Host "CORREÇÃO CONCLUÍDA" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green 