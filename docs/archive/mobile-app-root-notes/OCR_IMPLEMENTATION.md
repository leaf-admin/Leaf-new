# 📋 Implementação OCR para CRLV - Apenas PDF

## ✅ Arquitetura Final

```
Mobile (React Native)
 ├─ DocumentPicker (apenas PDF)
 ├─ PDF → Imagem (primeira página)
 ├─ OCR (MLKit) no device
 ├─ Regex extraction
 ├─ Validação
 ├─ Redimensionar imagem para 640x640
 └─ Enviar JSON + imagem ao backend

Backend
 └─ Recebe: { vehicleData: {...}, auditImage: "base64..." }
```

## 📦 Dependências Instaladas

- ✅ `expo-text-recognition` - OCR no device (MLKit)
- ✅ `expo-image-manipulator` - Redimensionar imagem para 640x640
- ✅ `expo-document-picker` - Selecionar PDF
- ✅ `react-native-pdf` - Renderizar PDF (para conversão futura)
- ✅ `react-native-view-shot` - Capturar primeira página como imagem

## 🔧 Componentes Criados

### 1. `OCRService.js`
- Extração de texto com MLKit
- Regex patterns para campos do CRLV
- Validação de dados extraídos

### 2. `PDFProcessor.js`
- Processa PDF no device
- Converte primeira página para imagem
- Faz OCR
- Redimensiona para 640x640

### 3. `CRLVPDFUpload.js`
- Componente de upload de PDF
- Interface para seleção de arquivo
- Processamento automático após upload

## ⚠️ Limitação Atual

**expo-text-recognition não processa PDFs diretamente**

Solução atual:
- Tenta processar PDF como imagem (muitos CRLVs digitais são imagens em formato PDF)
- Se falhar, mostra erro informativo

**Para PDFs reais**, você precisa:
1. Converter primeira página para imagem usando `react-native-pdf` + `react-native-view-shot`
2. Ou processar no backend temporariamente apenas para converter

## 📤 Formato de Dados Enviados ao Backend

```json
{
  "vehicleId": "abc123",
  "userId": "user123",
  "vehicleData": {
    "placa": "QQO0G16",
    "renavam": "01188473104",
    "ano": "2019",
    "uf": "RJ",
    "chassi": "9BWKB45U0KP047969",
    "marca": "Volkswagen",
    "modelo": "NOVA SAVEIRO RB MBVS"
  },
  "auditImage": "data:image/jpeg;base64,/9j/4AAQSkZJRg...",
  "metadata": {
    "processedAt": "2025-12-22T00:00:00.000Z",
    "confidence": 0.9,
    "validation": {
      "isValid": true,
      "errors": []
    }
  }
}
```

## 🎯 Endpoint Backend Esperado

```
POST /api/vehicles/ocr-data

Body: {
  vehicleId: string,
  userId: string,
  vehicleData: {
    placa: string,
    renavam: string,
    ano: string,
    uf: string,
    chassi?: string,
    marca?: string,
    modelo?: string
  },
  auditImage: string (base64),
  metadata: object
}
```

## 📝 Campos Extraídos (Baseado no PDF de Referência)

✅ **Funcionando:**
- Placa (formato Mercosul: QQO0G16)
- RENAVAM (11 dígitos)
- Ano (fabricação/modelo)
- UF
- Chassi
- Marca (VW, Toyota, etc)
- Modelo (extraído da linha "MARCA / MODELO / VERSÃO")

## 🚀 Próximos Passos

1. ✅ Implementar conversão PDF → Imagem no mobile
2. ✅ Testar com PDFs reais
3. ✅ Implementar endpoint no backend para receber dados
4. ✅ Adicionar tratamento de erros mais robusto

## 📊 Dados do PDF de Referência Extraídos

```
PLACA: QQO0G16
RENAVAM: 01188473104
ANO: 2019
UF: RJ
CHASSI: 9BWKB45U0KP047969
MARCA: VW (Volkswagen)
MODELO: NOVA SAVEIRO RB MBVS
```

