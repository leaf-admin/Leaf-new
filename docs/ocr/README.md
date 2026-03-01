# 📄 Sistema de OCR - Documentação

## 📋 Visão Geral

Sistema de OCR (Optical Character Recognition) para extração automática de dados de documentos brasileiros:
- **CNH** (Carteira Nacional de Habilitação)
- **CRLV** (Certificado de Registro e Licenciamento de Veículo)

## 🎯 Objetivo

Reduzir a fricção no cadastro de motoristas, automatizando o preenchimento de formulários através da leitura automática de documentos.

## 🏗️ Arquitetura

### Componentes

1. **OCR Service** (`services/ocr-service.js`)
   - Serviço principal de processamento OCR
   - Suporta Google Vision API (recomendado) ou Tesseract.js (fallback)
   - Parsers específicos para CNH e CRLV

2. **OCR Routes** (`routes/ocr-routes.js`)
   - Endpoints REST para processamento de documentos
   - Rate limiting para proteção
   - Validação de uploads

### Endpoints

#### `POST /api/ocr/cnh`
Extrai dados da CNH

**Request:**
```bash
curl -X POST http://localhost:3001/api/ocr/cnh \
  -F "image=@/path/to/cnh.jpg" \
  -F "userId=user123"
```

**Response:**
```json
{
  "success": true,
  "data": {
    "nome": "JOÃO DA SILVA",
    "cpf": "123.456.789-00",
    "rg": "12.345.678-9",
    "dataNascimento": "01/01/1990",
    "numeroRegistro": "123456",
    "categoria": "B",
    "validade": "01/01/2030",
    "cnh": "12345678901",
    "textoCompleto": "...",
    "confidence": 0.8
  },
  "message": "Dados da CNH extraídos com sucesso"
}
```

#### `POST /api/ocr/vehicle`
Extrai dados do CRLV

**Request:**
```bash
curl -X POST http://localhost:3001/api/ocr/vehicle \
  -F "image=@/path/to/crlv.jpg" \
  -F "userId=user123" \
  -F "vehicleId=vehicle456"
```

**Response:**
```json
{
  "success": true,
  "data": {
    "placa": "ABC1234",
    "renavam": "12345678901",
    "chassi": "9BW12345678901234",
    "marca": "FIAT",
    "modelo": "UNO",
    "anoFabricacao": "2020",
    "anoModelo": "2021",
    "cor": "BRANCO",
    "combustivel": "FLEX",
    "textoCompleto": "...",
    "confidence": 0.8
  },
  "message": "Dados do veículo extraídos com sucesso"
}
```

#### `GET /api/ocr/health`
Health check do serviço

**Response:**
```json
{
  "success": true,
  "initialized": true,
  "service": "OCR Service",
  "timestamp": "2024-01-01T12:00:00.000Z"
}
```

## ⚙️ Configuração

### Opção 1: Google Vision API (Recomendado)

1. **Criar projeto no Google Cloud**
   - Acesse [Google Cloud Console](https://console.cloud.google.com/)
   - Crie um novo projeto ou use existente

2. **Habilitar Vision API**
   - Vá em "APIs & Services" > "Library"
   - Busque por "Cloud Vision API"
   - Clique em "Enable"

3. **Criar Service Account**
   - Vá em "IAM & Admin" > "Service Accounts"
   - Crie uma nova conta de serviço
   - Baixe o arquivo JSON de credenciais

4. **Configurar variável de ambiente**
   ```bash
   export GOOGLE_APPLICATION_CREDENTIALS="/path/to/service-account-key.json"
   ```

   Ou adicione no `.env`:
   ```
   GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account-key.json
   ```

5. **Instalar dependência (opcional)**
   ```bash
   npm install @google-cloud/vision
   ```

### Opção 2: Tesseract.js (Fallback)

Tesseract.js já está incluído como dependência e será usado automaticamente se o Google Vision não estiver configurado.

**Vantagens:**
- ✅ Gratuito
- ✅ Open source
- ✅ Funciona offline

**Desvantagens:**
- ⚠️ Menor precisão
- ⚠️ Mais lento
- ⚠️ Requer mais processamento

## 📦 Instalação

```bash
cd leaf-websocket-backend
npm install
```

As dependências necessárias já estão no `package.json`:
- `tesseract.js` - OCR open source
- `multer` - Upload de arquivos (já existente)
- `@google-cloud/vision` - Google Vision API (opcional, instalar manualmente se usar)

## 🚀 Uso no App Mobile

### Exemplo de integração

```javascript
// Upload e processamento de CNH
const processCNH = async (imageUri) => {
  try {
    const formData = new FormData();
    formData.append('image', {
      uri: imageUri,
      type: 'image/jpeg',
      name: 'cnh.jpg',
    });
    formData.append('userId', currentUser.uid);

    const response = await fetch('http://seu-servidor:3001/api/ocr/cnh', {
      method: 'POST',
      body: formData,
      headers: {
        'Content-Type': 'multipart/form-data',
      },
    });

    const result = await response.json();
    
    if (result.success) {
      // Preencher formulário com dados extraídos
      setFormData({
        nome: result.data.nome,
        cpf: result.data.cpf,
        // ... outros campos
      });
    }
  } catch (error) {
    console.error('Erro ao processar CNH:', error);
  }
};
```

## 🔒 Segurança

### Rate Limiting
- **Limite:** 10 requisições por IP a cada 15 minutos
- **Proteção:** Evita abuso e reduz custos de API

### Validação
- Apenas arquivos de imagem são aceitos
- Tamanho máximo: 10MB
- Validação de tipo MIME

### Logs
- Todas as requisições são logadas
- Logs incluem userId, fileSize, timestamps
- Logs de erro para debugging

## 📊 Dados Extraídos

### CNH
- ✅ Nome completo
- ✅ CPF
- ✅ RG
- ✅ Data de nascimento
- ✅ Número de registro
- ✅ Categoria (A, B, C, D, E)
- ✅ Validade
- ✅ Número da CNH

### CRLV
- ✅ Placa (formato antigo e Mercosul)
- ✅ RENAVAM
- ✅ Chassi
- ✅ Marca
- ✅ Modelo
- ✅ Ano de fabricação
- ✅ Ano modelo
- ✅ Cor
- ✅ Tipo de combustível

## ⚠️ Limitações

1. **Precisão:** Depende da qualidade da imagem
   - Imagens borradas ou com baixa resolução podem ter menor precisão
   - Recomenda-se imagens com boa iluminação e foco

2. **Formato de documentos:** 
   - Otimizado para documentos brasileiros padrão
   - Variações regionais podem precisar de ajustes

3. **Campos opcionais:**
   - Alguns campos podem não ser extraídos se não estiverem claramente visíveis
   - Sempre validar dados extraídos antes de salvar

## 🔄 Melhorias Futuras

- [ ] Treinamento de modelo customizado para documentos brasileiros
- [ ] Validação de CPF e RENAVAM extraídos
- [ ] Suporte para PDFs
- [ ] Cache de resultados para evitar reprocessamento
- [ ] Dashboard de métricas de precisão
- [ ] Suporte para outros documentos (RG, Comprovante de Residência)

## 🐛 Troubleshooting

### Erro: "Serviço de OCR ainda não inicializado"
- Aguarde alguns segundos após iniciar o servidor
- Verifique os logs para erros de inicialização

### Baixa precisão na extração
- Verifique a qualidade da imagem enviada
- Considere usar Google Vision API para melhor precisão
- Ajuste os padrões de regex em `ocr-service.js` se necessário

### Erro de rate limit
- Aguarde 15 minutos antes de tentar novamente
- Considere aumentar o limite em desenvolvimento

## 📝 Notas

- O sistema foi projetado para funcionar em paralelo com o fluxo existente
- Não quebra funcionalidades atuais
- Pode ser habilitado/desabilitado via feature flag se necessário
- Dados extraídos devem sempre ser validados antes de uso em produção






















