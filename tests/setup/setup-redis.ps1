# Redis Setup Script for LEAF ReactNative Project
Write-Host "Setting up Redis for LEAF ReactNative Project..." -ForegroundColor Green

# Create redis directory if it doesn't exist
$redisDir = ".\redis"
if (!(Test-Path $redisDir)) {
    New-Item -ItemType Directory -Path $redisDir
    Write-Host "Created redis directory" -ForegroundColor Green
}

# Download Redis for Windows
$redisUrl = "https://github.com/microsoftarchive/redis/releases/download/win-3.0.504/Redis-x64-3.0.504.msi"
$redisInstaller = "$redisDir\Redis-x64-3.0.504.msi"

Write-Host "Downloading Redis..." -ForegroundColor Yellow
try {
    Invoke-WebRequest -Uri $redisUrl -OutFile $redisInstaller
    Write-Host "Redis downloaded successfully" -ForegroundColor Green
} catch {
    Write-Host "Failed to download Redis: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}

Write-Host "Redis setup completed!" -ForegroundColor Green
Write-Host "Please install Redis manually by running: $redisInstaller" -ForegroundColor Yellow 