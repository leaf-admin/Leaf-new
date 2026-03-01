# 📄 GERENCIAMENTO DE DOCUMENTOS DOS MOTORISTAS

## 📅 Data: 2025-12-19
## 🎯 Objetivo: Documentar onde e como os documentos dos motoristas são armazenados e gerenciados

---

## 📍 **ONDE OS DOCUMENTOS FICAM ARMAZENADOS**

### **1. ARMAZENAMENTO DE ARQUIVOS (Firebase Storage)**

**Localização:**
```
Firebase Storage
└── documents/
    └── {userId}/
        ├── cnh/
        │   └── cnh_1234567890.jpg
        ├── cnh_verso/
        │   └── cnh_verso_1234567890.jpg
        ├── comprovante_residencia/
        │   └── comprovante_1234567890.jpg
        ├── crlv/
        │   └── crlv_1234567890.jpg
        ├── seguro/
        │   └── seguro_1234567890.jpg
        └── certidao_antecedentes/
            └── certidao_1234567890.jpg
```

**Estrutura de Path:**
- `documents/{userId}/{documentType}/{fileName}.{ext}`

**Características:**
- ✅ Armazenamento seguro e escalável
- ✅ URLs públicas temporárias (com expiração)
- ✅ Suporte a imagens (JPG, PNG) e PDFs
- ✅ Organização por usuário e tipo de documento

---

### **2. METADADOS E STATUS (Firebase Realtime Database)**

**Localização:**
```
Firebase Realtime Database
└── users/
    └── {userId}/
        ├── documents/
        │   ├── cnh/
        │   │   ├── type: "cnh"
        │   │   ├── fileType: "image"
        │   │   ├── fileUrl: "https://storage.googleapis.com/..."
        │   │   ├── status: "pending" | "approved" | "rejected"
        │   │   ├── uploadedAt: "2024-01-01T00:00:00Z"
        │   │   ├── updatedAt: "2024-01-01T00:00:00Z"
        │   │   ├── reviewedAt: "2024-01-01T00:00:00Z" (se revisado)
        │   │   ├── reviewedBy: "admin_id" (se revisado)
        │   │   └── rejectionReason: "Motivo da rejeição" (se rejeitado)
        │   ├── cnh_verso/
        │   ├── comprovante_residencia/
        │   ├── crlv/
        │   ├── seguro/
        │   └── certidao_antecedentes/
        └── (dados do usuário)
```

**Estrutura JSON:**
```json
{
  "users": {
    "{userId}": {
      "documents": {
        "cnh": {
          "type": "cnh",
          "fileType": "image",
          "fileUrl": "https://storage.googleapis.com/...",
          "status": "pending",
          "uploadedAt": "2024-01-01T00:00:00Z",
          "updatedAt": "2024-01-01T00:00:00Z"
        },
        "comprovante_residencia": {
          "type": "comprovante_residencia",
          "fileType": "image",
          "fileUrl": "https://storage.googleapis.com/...",
          "status": "approved",
          "uploadedAt": "2024-01-01T00:00:00Z",
          "reviewedAt": "2024-01-02T00:00:00Z",
          "reviewedBy": "admin1"
        }
      }
    }
  }
}
```

**Status Possíveis:**
- `analyzing` - Documento enviado, aguardando análise
- `pending` - Aguardando revisão manual
- `approved` - Documento aprovado
- `rejected` - Documento rejeitado
- `missing` - Documento não enviado

---

## 📋 **DOCUMENTOS NECESSÁRIOS**

### **Documentos Obrigatórios:**

1. **CNH (Carteira Nacional de Habilitação)**
   - Frente e verso
   - Tipo: `cnh` e `cnh_verso`
   - Status: Obrigatório

2. **Comprovante de Residência**
   - Tipo: `comprovante_residencia`
   - Status: Obrigatório

3. **CRLV (Certificado de Registro e Licenciamento do Veículo)**
   - Tipo: `crlv`
   - Status: Obrigatório

4. **Seguro do Veículo**
   - Tipo: `seguro`
   - Status: Obrigatório

5. **Certidão de Antecedentes Criminais**
   - Tipo: `certidao_antecedentes`
   - Status: Obrigatório (pode variar por região)

---

## 🔄 **FLUXO COMPLETO**

### **1. Upload pelo Mobile App**

```
Motorista → Seleciona documento → Tira foto/Seleciona arquivo
  → Upload para Firebase Storage
  → Salva metadados no Realtime Database
  → Status: "analyzing" ou "pending"
```

**Código (Mobile App):**
- `mobile-app/src/screens/DriverDocumentsScreen.js`
- `mobile-app/src/services/VehicleService.js` (método `uploadDocument`)

### **2. Visualização no Dashboard**

```
Admin → Acessa painel de documentos
  → Lista de motoristas com documentos pendentes
  → Visualiza cada documento
  → Aprova ou Rejeita
```

**APIs Disponíveis:**
- `GET /api/drivers/applications` - Lista aplicações com documentos
- `GET /api/drivers/:driverId/documents` - Documentos específicos
- `POST /api/drivers/:driverId/documents/:docType/review` - Aprovar/Rejeitar

### **3. Aprovação/Rejeição**

```
Admin → Visualiza documento
  → Clica em "Aprovar" ou "Rejeitar"
  → Sistema atualiza status no Database
  → Motorista recebe notificação (se implementado)
```

---

## 🖥️ **PAINEL ADMIN - ONDE ACESSAR**

### **Status Atual:**

✅ **Backend APIs Implementadas:**
- `GET /api/drivers/applications` - Lista motoristas com documentos
- `GET /api/drivers/:driverId/documents` - Documentos de um motorista
- `POST /api/drivers/:driverId/documents/:docType/review` - Aprovar/Rejeitar

⚠️ **Frontend Dashboard:**
- Existe página `/drivers` (listagem de motoristas)
- **FALTA:** Página específica para gerenciar documentos pendentes
- **FALTA:** Visualização inline de documentos
- **FALTA:** Interface de aprovação/rejeição

---

## 📊 **ESTRUTURA DE DADOS COMPLETA**

### **Dados do Motorista (users/{userId}):**

```json
{
  "firstName": "João",
  "lastName": "Silva",
  "email": "joao@email.com",
  "mobile": "+5511999999999",
  "city": "São Paulo",
  "state": "SP",
  "usertype": "driver",
  "approved": false,
  "approvedAt": null,
  "approvedBy": null,
  "rejectionReason": null,
  "createdAt": "2024-01-01T00:00:00Z",
  "documents": {
    "cnh": {
      "type": "cnh",
      "fileType": "image",
      "fileUrl": "https://storage.googleapis.com/...",
      "status": "pending",
      "uploadedAt": "2024-01-01T00:00:00Z",
      "updatedAt": "2024-01-01T00:00:00Z"
    }
  }
}
```

### **Dados do Veículo (cars/{carId}):**

```json
{
  "driver": "{userId}",
  "carMake": "Honda",
  "carModel": "Civic",
  "carYear": "2020",
  "carNumber": "ABC-1234",
  "carColor": "Branco",
  "carImage": "https://storage.googleapis.com/...",
  "vehicleRegistration": "https://storage.googleapis.com/...",
  "vehicleInsurance": "https://storage.googleapis.com/..."
}
```

---

## 🔧 **APIS DISPONÍVEIS**

### **1. Listar Aplicações de Motoristas**

**Endpoint:** `GET /api/drivers/applications`

**Query Parameters:**
- `status` - Filtrar por status (pending, approved, rejected, all)
- `dateRange` - Filtrar por período
- `sortBy` - Ordenar por (submissionDate, name, etc)
- `sortOrder` - Ordem (asc, desc)
- `page` - Página (padrão: 1)
- `limit` - Itens por página (padrão: 20)

**Resposta:**
```json
{
  "applications": [
    {
      "id": "userId",
      "driver": {
        "id": "userId",
        "name": "João Silva",
        "email": "joao@email.com",
        "phone": "+5511999999999",
        "city": "São Paulo",
        "state": "SP"
      },
      "vehicle": {
        "make": "Honda",
        "model": "Civic",
        "year": "2020",
        "plate": "ABC-1234",
        "color": "Branco"
      },
      "documents": {
        "license": {
          "front": "https://storage...",
          "back": "https://storage...",
          "status": "pending",
          "uploadedAt": "2024-01-01T00:00:00Z"
        },
        "identity": {
          "front": "https://storage...",
          "status": "approved",
          "uploadedAt": "2024-01-01T00:00:00Z"
        },
        "vehicle": {
          "registration": "https://storage...",
          "insurance": "https://storage...",
          "status": "pending"
        },
        "all_documents": [
          {
            "type": "cnh",
            "fileUrl": "https://storage...",
            "status": "pending",
            "uploadedAt": "2024-01-01T00:00:00Z"
          }
        ]
      },
      "status": "pending",
      "submissionDate": "2024-01-01T00:00:00Z",
      "reviewDate": null,
      "reviewedBy": null,
      "rejectionReason": null
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 50,
    "pages": 3
  }
}
```

### **2. Buscar Documentos de um Motorista**

**Endpoint:** `GET /api/drivers/:driverId/documents`

**Resposta:**
```json
{
  "success": true,
  "data": {
    "driverId": "userId",
    "driver": {
      "name": "João Silva",
      "email": "joao@email.com",
      "phone": "+5511999999999"
    },
    "documents": {
      "cnh": {
        "type": "cnh",
        "fileUrl": "https://storage...",
        "status": "pending",
        "uploadedAt": "2024-01-01T00:00:00Z"
      },
      "comprovante_residencia": {
        "type": "comprovante_residencia",
        "fileUrl": "https://storage...",
        "status": "approved",
        "uploadedAt": "2024-01-01T00:00:00Z"
      }
    },
    "totalDocuments": 2
  }
}
```

### **3. Aprovar/Rejeitar Documento**

**Endpoint:** `POST /api/drivers/:driverId/documents/:documentType/review`

**Body:**
```json
{
  "action": "approve", // ou "reject"
  "rejectionReason": "Documento ilegível", // obrigatório se action = "reject"
  "reviewedBy": "admin_id"
}
```

**Resposta:**
```json
{
  "success": true,
  "message": "Documento aprovado com sucesso!",
  "data": {
    "driverId": "userId",
    "documentType": "cnh",
    "action": "approve",
    "reviewedAt": "2024-01-02T00:00:00Z"
  }
}
```

---

## 🎯 **O QUE FALTA IMPLEMENTAR**

### **1. Painel Admin Completo (Frontend)**

**Necessário:**
- ✅ Página `/documents` ou `/drivers/applications`
- ✅ Lista de motoristas com documentos pendentes
- ✅ Visualização inline de documentos (imagens/PDFs)
- ✅ Botões de aprovação/rejeição
- ✅ Modal de confirmação
- ✅ Campo para motivo de rejeição
- ✅ Filtros (status, data, tipo de documento)
- ✅ Busca por nome/email/telefone

**Status:** ⚠️ **PARCIALMENTE IMPLEMENTADO**
- Backend APIs: ✅ Implementadas
- Frontend: ⚠️ Precisa criar página específica

### **2. Notificações**

**Necessário:**
- Notificação push quando documento é aprovado
- Notificação push quando documento é rejeitado
- Email de confirmação (opcional)

**Status:** ❌ **NÃO IMPLEMENTADO**

### **3. Histórico de Revisões**

**Necessário:**
- Log de todas as aprovações/rejeições
- Quem aprovou/rejeitou
- Quando foi revisado
- Motivo da rejeição

**Status:** ✅ **PARCIALMENTE IMPLEMENTADO**
- Campos no Database: ✅ Existem
- Visualização no Dashboard: ❌ Falta

---

## 📝 **RESUMO EXECUTIVO**

### **✅ O QUE JÁ ESTÁ FUNCIONANDO:**

1. **Armazenamento:**
   - ✅ Firebase Storage para arquivos
   - ✅ Firebase Realtime Database para metadados
   - ✅ Estrutura organizada por usuário e tipo

2. **Backend APIs:**
   - ✅ Listar aplicações
   - ✅ Buscar documentos específicos
   - ✅ Aprovar/Rejeitar documentos

3. **Mobile App:**
   - ✅ Upload de documentos funcionando
   - ✅ Estrutura de documentos implementada

### **⚠️ O QUE PRECISA SER FEITO:**

1. **Painel Admin (Frontend):**
   - Criar página `/documents` ou melhorar `/drivers`
   - Adicionar visualização de documentos
   - Adicionar interface de aprovação/rejeição
   - Adicionar filtros e busca

2. **Notificações:**
   - Implementar notificações push
   - Implementar emails (opcional)

3. **Melhorias:**
   - Histórico de revisões
   - Bulk approval (aprovar vários de uma vez)
   - OCR automático para validação

---

## 🚀 **PRÓXIMOS PASSOS RECOMENDADOS**

1. **Criar página de documentos no Dashboard:**
   - `/documents` ou `/drivers/applications`
   - Lista de motoristas pendentes
   - Visualização de documentos
   - Interface de aprovação/rejeição

2. **Implementar notificações:**
   - Push notifications quando documento é revisado
   - Email de confirmação (opcional)

3. **Melhorar UX:**
   - Filtros avançados
   - Busca rápida
   - Visualização em modal
   - Preview de documentos antes de aprovar

---

**Última atualização:** 2025-12-19
**Status:** ✅ Backend completo, ⚠️ Frontend precisa de página específica

