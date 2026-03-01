# KYC Service - Verificação Facial para Motoristas

## 🎯 Objetivo
Sistema de verificação facial em tempo real para motoristas do Leaf, garantindo que seja a pessoa correta ao ficar online.

## 🏗️ Arquitetura
```
📱 Mobile App → 🔌 Redis Streams → 🐍 Python Service → 📷 OpenCV
```

## 🔧 Tecnologias
- **Python 3.9+**
- **FastAPI** - API REST moderna
- **OpenCV** - Processamento de imagem
- **MediaPipe** - Detecção facial avançada
- **Redis** - Comunicação via streams
- **Celery** - Processamento assíncrono

## 📋 Funcionalidades

### Fase 1: Verificação Facial
- Detecção de rosto em tempo real
- Comparação com foto de perfil
- Validação de qualidade da imagem
- Feedback visual para o usuário

### Fase 2: Verificação de Vida (Anti-Spoofing)
- Detecção de mudança de humor (sorriso)
- Validação de movimento facial natural
- Análise de profundidade (3D vs 2D)
- Confirmação de vida

### Fase 3: Autorização
- Processamento final no backend
- Atualização de status do motorista
- Liberação do app para uso
- Log de auditoria

## 🚀 Instalação

```bash
# Instalar dependências
pip install -r requirements.txt

# Configurar Redis
cp config/redis/redis.conf.example config/redis/redis.conf

# Executar serviço
python src/main.py
```

## 📊 Métricas
- Taxa de sucesso: >95%
- Tempo médio: <30s
- Falsos positivos: <2%
- Falsos negativos: <5%

## 🔒 Segurança
- Processamento local (sem envio de dados)
- Criptografia de transmissão
- Retenção limitada de dados
- Compliance com LGPD/GDPR

