# KYC Service - Sistema de Verificação Facial Completo

## 🎯 Visão Geral

O **KYC Service** é um sistema completo de verificação facial e detecção de vida (anti-spoofing) para motoristas do Leaf. O sistema garante que apenas a pessoa correta possa ficar online no aplicativo.

## 🏗️ Arquitetura

```
📱 Mobile App → 🔌 Redis Streams → 🐍 Python Service → 📷 OpenCV/MediaPipe
```

### Componentes Principais:

1. **Face Detection Service** - Detecção facial usando OpenCV e MediaPipe
2. **Anti-Spoofing Service** - Verificação de vida (blink, motion, emotion)
3. **Redis Streams Manager** - Comunicação assíncrona via Redis Streams
4. **FastAPI REST API** - Interface HTTP para integração
5. **Mobile Integration** - Componentes React Native para o app

## 🚀 Funcionalidades

### Fase 1: Verificação Facial
- ✅ Detecção de rosto em tempo real
- ✅ Comparação com foto de perfil
- ✅ Validação de qualidade da imagem
- ✅ Feedback visual para o usuário

### Fase 2: Verificação de Vida (Anti-Spoofing)
- ✅ Detecção de piscada (blink detection)
- ✅ Análise de movimento facial
- ✅ Detecção de mudança de humor (sorriso)
- ✅ Análise de textura e profundidade

### Fase 3: Integração Completa
- ✅ Comunicação via Redis Streams
- ✅ API REST para testes e integração
- ✅ Componentes React Native
- ✅ Sistema de tradução (i18n)
- ✅ Monitoramento e logs

## 📁 Estrutura do Projeto

```
services/kyc-service/
├── src/
│   ├── api/
│   │   └── main.py                 # FastAPI REST API
│   ├── services/
│   │   ├── face_detection.py      # Detecção facial
│   │   ├── anti_spoofing.py       # Anti-spoofing
│   │   └── redis_streams.py       # Redis Streams
│   └── main.py                    # Serviço principal
├── config/
│   ├── kyc_config.py              # Configurações
│   └── redis/
│       └── redis_config.yaml      # Config Redis
├── scripts/
│   ├── deploy.sh                  # Script de deploy
│   └── test.sh                    # Script de teste
├── requirements.txt               # Dependências Python
└── README.md                      # Documentação
```

## 🔧 Instalação e Configuração

### 1. Dependências do Sistema

```bash
# Ubuntu/Debian
sudo apt-get update
sudo apt-get install -y \
    python3.9 \
    python3.9-dev \
    python3.9-venv \
    python3-pip \
    cmake \
    build-essential \
    libopencv-dev \
    libdlib-dev \
    libblas-dev \
    liblapack-dev \
    libatlas-base-dev \
    gfortran \
    redis-server \
    nginx \
    supervisor

# macOS
brew install cmake
brew install dlib
brew install opencv
```

### 2. Instalação do Serviço

```bash
# Clone o repositório
cd services/kyc-service

# Criar ambiente virtual
python3.9 -m venv venv
source venv/bin/activate

# Instalar dependências
pip install -r requirements.txt
```

### 3. Configuração

```bash
# Configurar Redis
sudo systemctl start redis-server
sudo systemctl enable redis-server

# Configurar serviço
sudo ./scripts/deploy.sh
```

## 🧪 Testes

### Teste Automatizado

```bash
# Executar todos os testes
./scripts/test.sh

# Testes específicos
./scripts/test.sh health          # Teste de saúde
./scripts/test.sh verification    # Teste de verificação
./scripts/test.sh liveness        # Teste de vida
./scripts/test.sh performance     # Teste de performance
```

### Teste Manual

```bash
# Testar endpoint de saúde
curl http://localhost:8000/health

# Testar verificação facial
curl -X POST http://localhost:8000/verify \
  -H "Content-Type: application/json" \
  -d '{
    "driver_id": "test_driver",
    "session_id": "test_session",
    "image_data": "data:image/jpeg;base64,...",
    "profile_image": "data:image/jpeg;base64,..."
  }'
```

## 📊 Métricas e Performance

### Métricas de Qualidade
- **Taxa de sucesso**: >95%
- **Tempo médio**: <30s
- **Falsos positivos**: <2%
- **Falsos negativos**: <5%

### Métricas de Performance
- **Latência**: <500ms por verificação
- **Throughput**: 100+ verificações/minuto
- **Uso de CPU**: <50% (4 vCPUs)
- **Uso de RAM**: <2GB

## 🔒 Segurança

### Medidas de Segurança
- ✅ Processamento local (sem envio de dados)
- ✅ Criptografia de transmissão
- ✅ Retenção limitada de dados
- ✅ Compliance com LGPD/GDPR
- ✅ Logs de auditoria
- ✅ Rate limiting

### Anti-Spoofing
- ✅ Detecção de fotos impressas
- ✅ Detecção de vídeos
- ✅ Detecção de máscaras
- ✅ Verificação de movimento natural
- ✅ Análise de textura facial

## 📱 Integração Mobile

### Componentes React Native

```javascript
// Hook de verificação KYC
const {
  isVerifying,
  verificationStatus,
  verificationMessage,
  confidence,
  startVerification,
  retryVerification
} = useKYCVerification();

// Hook de verificação de vida
const {
  isChecking,
  livenessStatus,
  livenessMessage,
  startLivenessCheck
} = useKYCLivenessCheck();

// Componente de status do serviço
<KYCServiceStatus />
```

### Tela de Verificação

```javascript
// Navegação para verificação KYC
navigation.navigate('KYCVerification', {
  driverId: 'driver_123',
  profileImage: 'base64_image_data'
});
```

## 🚀 Deploy em Produção

### 1. Deploy Automatizado

```bash
# Executar script de deploy
sudo ./scripts/deploy.sh
```

### 2. Deploy Manual

```bash
# Instalar dependências
sudo apt-get install -y python3.9 redis-server nginx supervisor

# Configurar serviço
sudo systemctl enable kyc-service
sudo systemctl start kyc-service

# Configurar nginx
sudo systemctl reload nginx
```

### 3. Monitoramento

```bash
# Verificar status
systemctl status kyc-service

# Ver logs
journalctl -u kyc-service -f

# Monitorar Redis
redis-cli monitor
```

## 🔧 Configuração Avançada

### Configuração Redis

```yaml
# config/redis/redis_config.yaml
streams:
  kyc_verification: "kyc:verification"
  kyc_results: "kyc:results"
  kyc_analytics: "kyc:analytics"

redis:
  host: "localhost"
  port: 6379
  db: 0
  max_connections: 20
```

### Configuração OpenCV

```python
# config/kyc_config.py
FACE_DETECTION_CONFIDENCE = 0.7
FACE_MATCHING_THRESHOLD = 0.6
FACE_QUALITY_THRESHOLD = 0.5
MEDIAPIPE_MODEL_COMPLEXITY = 1
```

## 📈 Monitoramento e Logs

### Logs do Serviço

```bash
# Logs do sistema
journalctl -u kyc-service -f

# Logs do aplicativo
tail -f logs/kyc_service.log

# Logs do Redis
tail -f /var/log/redis/redis-server.log
```

### Métricas Redis

```bash
# Estatísticas Redis
redis-cli info

# Monitorar streams
redis-cli xinfo stream kyc:verification
redis-cli xinfo stream kyc:results
```

## 🐛 Troubleshooting

### Problemas Comuns

1. **Serviço não inicia**
   ```bash
   # Verificar logs
   journalctl -u kyc-service -f
   
   # Verificar dependências
   python3 -c "import cv2, mediapipe, redis"
   ```

2. **Redis não conecta**
   ```bash
   # Verificar Redis
   systemctl status redis-server
   
   # Testar conexão
   redis-cli ping
   ```

3. **OpenCV não funciona**
   ```bash
   # Reinstalar OpenCV
   pip uninstall opencv-python
   pip install opencv-python
   ```

### Logs de Debug

```python
# Habilitar logs detalhados
import logging
logging.basicConfig(level=logging.DEBUG)
```

## 🔄 Atualizações e Manutenção

### Atualização do Serviço

```bash
# Parar serviço
sudo systemctl stop kyc-service

# Atualizar código
git pull origin main

# Reinstalar dependências
pip install -r requirements.txt

# Reiniciar serviço
sudo systemctl start kyc-service
```

### Backup e Restore

```bash
# Backup Redis
redis-cli bgsave

# Backup configurações
tar -czf kyc-backup.tar.gz config/ logs/
```

## 📞 Suporte

### Contatos
- **Desenvolvedor**: Izaak Dias
- **Email**: suporte@leaf.com
- **Documentação**: [docs.leaf.com/kyc](https://docs.leaf.com/kyc)

### Recursos
- **GitHub**: [github.com/leaf/kyc-service](https://github.com/leaf/kyc-service)
- **Documentação**: [docs.leaf.com](https://docs.leaf.com)
- **Issues**: [github.com/leaf/kyc-service/issues](https://github.com/leaf/kyc-service/issues)

---

## ✅ Status do Projeto

- ✅ **Estrutura do serviço** - Concluído
- ✅ **Detecção facial** - Concluído
- ✅ **Anti-spoofing** - Concluído
- ✅ **Redis Streams** - Concluído
- ✅ **API REST** - Concluído
- ✅ **Integração mobile** - Concluído
- ✅ **Testes** - Concluído
- ✅ **Documentação** - Concluído

**🎉 SISTEMA KYC COMPLETO E FUNCIONAL!**

