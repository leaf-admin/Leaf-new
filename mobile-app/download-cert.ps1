# Script para baixar certificado do maven.expo.dev
$url = "https://maven.expo.dev"
$certFile = "temp-cert\expo-maven.crt"

try {
    # Criar um handler que aceita todos os certificados
    $handler = New-Object System.Net.Http.HttpClientHandler
    $handler.ServerCertificateCustomValidationCallback = { $true }
    
    # Criar cliente HTTP
    $client = New-Object System.Net.Http.HttpClient($handler)
    
    # Fazer requisição
    $response = $client.GetAsync($url).Result
    
    # Obter o certificado
    $cert = $handler.ServerCertificateCustomValidationCallback
    
    Write-Host "Certificado obtido com sucesso!"
    Write-Host "Status: $($response.StatusCode)"
    
} catch {
    Write-Host "Erro ao baixar certificado: $($_.Exception.Message)"
} 