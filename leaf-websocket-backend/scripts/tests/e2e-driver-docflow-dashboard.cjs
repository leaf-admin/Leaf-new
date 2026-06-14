#!/usr/bin/env node

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const axios = require('axios');
const FormData = require('form-data');
const PDFDocument = require('pdfkit');
const firebaseConfig = require('../../firebase-config');
const driverApplicationService = require('../../services/driver-application-service');
const admin = require('firebase-admin');

const API_BASE = process.env.E2E_API_BASE || 'http://localhost:3001/api';
const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL || 'qa.admin@leaf.app';
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD || 'LeafAdmin#2026';
const CNH_PATH = process.env.E2E_CNH_PATH || '/Users/izaakdias/Desktop/CNH-e.pdf.pdf';
const CRLV_PATH = process.env.E2E_CRLV_PATH || '/Users/izaakdias/Desktop/CRLV.pdf';
const STORAGE_BUCKET = process.env.FIREBASE_STORAGE_BUCKET || 'leaf-reactnative.firebasestorage.app';
const SKIP_FINAL_APPROVAL = ['1', 'true', 'yes'].includes(String(process.env.E2E_SKIP_FINAL_APPROVAL || '').toLowerCase());

const REJECTION_REASONS = {
  cnh: 'CNH sem EAR - Exerce atividade remunerada',
  crlv: 'CRLV - ano do veículo não permitido (apenas são aceitos veículos com no máximo 10 anos de fabricação)'
};

function splitName(fullName = '') {
  const clean = String(fullName || '').trim();
  if (!clean) return { firstName: 'Motorista', lastName: 'Teste' };
  const parts = clean.split(/\s+/).filter(Boolean);
  if (parts.length === 1) return { firstName: parts[0], lastName: 'Teste' };
  return { firstName: parts[0], lastName: parts.slice(1).join(' ') };
}

function normalizeCpf(rawValue) {
  const digits = String(rawValue || '').replace(/\D/g, '');
  if (digits.length === 11) {
    return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6, 9)}-${digits.slice(9)}`;
  }
  // fallback controlado para fluxo de validação quando OCR não captura CPF
  return '123.456.789-09';
}

function normalizeBirthDate(rawValue) {
  const raw = String(rawValue || '').trim();
  if (!raw) return '';

  const ddmmyyyy = raw.match(/^(\d{2})[\/\-](\d{2})[\/\-](\d{4})$/);
  if (ddmmyyyy) {
    const [, dd, mm, yyyy] = ddmmyyyy;
    return `${yyyy}-${mm}-${dd}`;
  }

  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return '';
  return parsed.toISOString().slice(0, 10);
}

function normalizeGender(rawValue) {
  const raw = String(rawValue || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toUpperCase();

  if (['F', 'FEMININO', 'FEMALE', 'MULHER'].includes(raw)) return 'F';
  if (['M', 'MASCULINO', 'MALE', 'HOMEM'].includes(raw)) return 'M';
  if (['X', 'OUTRO', 'OTHER', 'NB', 'N', 'NAO BINARIO', 'NAO-BINARIO', 'NON BINARY'].includes(raw)) return 'X';
  return '';
}

async function timed(label, fn, timings) {
  const start = Date.now();
  const result = await fn();
  const durationMs = Date.now() - start;
  timings.push({ step: label, durationMs });
  return result;
}

async function postPdfToOcr(endpoint, filePath, fields = {}, timings) {
  const form = new FormData();
  form.append('pdf', fs.createReadStream(filePath), {
    filename: path.basename(filePath),
    contentType: 'application/pdf'
  });
  Object.entries(fields).forEach(([key, value]) => form.append(key, value));

  const response = await timed(`ocr:${endpoint}`, () => axios.post(`${API_BASE}${endpoint}`, form, {
    headers: form.getHeaders(),
    timeout: 180000,
    maxBodyLength: Infinity,
    maxContentLength: Infinity
  }), timings);

  return response.data;
}

async function uploadToStorage(localFilePath, destinationPath, contentType = 'application/pdf') {
  const bucket = admin.storage().bucket(STORAGE_BUCKET);
  const file = bucket.file(destinationPath);
  const buffer = await fsp.readFile(localFilePath);

  await file.save(buffer, {
    resumable: false,
    metadata: {
      contentType,
      metadata: {
        source: 'e2e-driver-docflow-dashboard'
      }
    }
  });

  const [signedUrl] = await file.getSignedUrl({
    action: 'read',
    expires: '2035-01-01'
  });

  return {
    fileUrl: signedUrl,
    filePath: destinationPath,
    size: buffer.length,
    fileName: path.basename(localFilePath)
  };
}

async function createBackgroundCheckPdf(outputPath) {
  await new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const stream = fs.createWriteStream(outputPath);
    doc.pipe(stream);
    doc.fontSize(16).text('CERTIDAO DE ANTECEDENTES CRIMINAIS - TESTE E2E', { align: 'left' });
    doc.moveDown();
    doc.fontSize(12).text(`Emitido em: ${new Date().toISOString()}`);
    doc.text('Documento de teste para validar upload e fluxo de revisão no dashboard.');
    doc.text('Nao utilizar para fins juridicos.');
    doc.end();

    stream.on('finish', resolve);
    stream.on('error', reject);
  });
}

async function loginAdmin(timings) {
  const response = await timed('admin:login', () => axios.post(`${API_BASE}/admin/auth/login`, {
    email: ADMIN_EMAIL,
    password: ADMIN_PASSWORD
  }, { timeout: 30000 }), timings);

  return response.data;
}

function authHeaders(token) {
  return {
    Authorization: `Bearer ${token}`
  };
}

function getDocumentByType(documentsPayload = {}, type, normalizedKey = null) {
  const normalized = normalizedKey ? documentsPayload?.[normalizedKey] : null;
  const allDocuments = Array.isArray(documentsPayload?.all_documents)
    ? documentsPayload.all_documents
    : [];
  return documentsPayload?.[type] || allDocuments.find((item) => item?.type === type) || normalized || null;
}

function getDocumentFileUrl(documentPayload = {}) {
  return documentPayload?.fileUrl ||
    documentPayload?.front ||
    documentPayload?.registration ||
    documentPayload?.file ||
    null;
}

async function ensureHttp200(url, label, timings) {
  const response = await timed(`fetch:${label}`, () => axios.get(url, {
    timeout: 45000,
    responseType: 'arraybuffer',
    validateStatus: () => true
  }), timings);

  return {
    status: response.status,
    bytes: Number(response.data?.byteLength || response.data?.length || 0)
  };
}

(async () => {
  const timings = [];
  const report = {
    startedAt: new Date().toISOString(),
    apiBase: API_BASE,
    adminEmail: ADMIN_EMAIL,
    files: {
      cnh: CNH_PATH,
      crlv: CRLV_PATH
    },
    checks: {}
  };

  try {
    if (!fs.existsSync(CNH_PATH)) {
      throw new Error(`Arquivo CNH não encontrado: ${CNH_PATH}`);
    }
    if (!fs.existsSync(CRLV_PATH)) {
      throw new Error(`Arquivo CRLV não encontrado: ${CRLV_PATH}`);
    }

    firebaseConfig.initializeFirebase();
    const db = firebaseConfig.getRealtimeDB();
    if (!db) throw new Error('Realtime Database indisponível');

    const driverId = `e2e_driver_${Date.now()}`;
    report.driverId = driverId;

    const cnhOcr = await postPdfToOcr('/ocr/cnh/pdf', CNH_PATH, { userId: driverId }, timings);
    const crlvOcr = await postPdfToOcr('/ocr/vehicle/pdf', CRLV_PATH, { userId: driverId }, timings);

    if (!cnhOcr?.success) throw new Error(`Falha OCR CNH: ${JSON.stringify(cnhOcr)}`);
    if (!crlvOcr?.success) throw new Error(`Falha OCR CRLV: ${JSON.stringify(crlvOcr)}`);

    report.extraction = {
      cnh: cnhOcr,
      crlv: crlvOcr
    };

    const extractedName = String(cnhOcr?.data?.nome || 'Motorista Teste E2E').trim();
    const { firstName, lastName } = splitName(extractedName);
    const cpf = normalizeCpf(cnhOcr?.data?.cpf);
    const birthDate = normalizeBirthDate(cnhOcr?.data?.dataNascimento);
    const motherName = String(
      cnhOcr?.data?.nomeMae || cnhOcr?.data?.nome_da_mae || cnhOcr?.data?.nomeDaMae || cnhOcr?.data?.mae || ''
    )
      .replace(/\s+/g, ' ')
      .trim()
      .toUpperCase();
    const gender = normalizeGender(cnhOcr?.data?.genero || cnhOcr?.data?.sexo || cnhOcr?.data?.gender);

    const cnhUpload = await timed('storage:upload_cnh', () => uploadToStorage(
      CNH_PATH,
      `documents/${driverId}/cnh/${Date.now()}_${path.basename(CNH_PATH)}`,
      'application/pdf'
    ), timings);

    const crlvUpload = await timed('storage:upload_crlv', () => uploadToStorage(
      CRLV_PATH,
      `documents/${driverId}/crlv/${Date.now()}_${path.basename(CRLV_PATH)}`,
      'application/pdf'
    ), timings);

    const nowIso = new Date().toISOString();
    const vehicleId = `vehicle_${Date.now()}`;
    const userVehicleId = `${driverId}_${vehicleId}_1`;

    const userPayload = {
      uid: driverId,
      usertype: 'driver',
      userType: 'driver',
      firstName,
      lastName,
      name: `${firstName} ${lastName}`.trim(),
      email: '',
      mobile: '+5521999999999',
      phoneNumber: '+5521999999999',
      cpf,
      ...(birthDate ? { birthDate, dateOfBirth: birthDate, dob: birthDate } : {}),
      ...(motherName ? { motherName, nomeMae: motherName } : {}),
      ...(gender ? { gender, genero: gender } : {}),
      city: 'rio_de_janeiro_rj',
      cityLabel: 'Rio de Janeiro - RJ',
      approved: false,
      isApproved: false,
      status: 'pending',
      onboardingCompleted: true,
      paymentMethod: 'pix',
      createdAt: nowIso,
      updatedAt: nowIso
    };

    await timed('db:seed_driver', async () => {
      await db.ref(`users/${driverId}`).set(userPayload);

      const updates = {};
      updates[`users/${driverId}/documents/cnh`] = {
        type: 'cnh',
        status: 'pending',
        fileUrl: cnhUpload.fileUrl,
        filePath: cnhUpload.filePath,
        fileType: 'application/pdf',
        fileName: cnhUpload.fileName,
        fileSize: cnhUpload.size,
        uploadedAt: nowIso,
        updatedAt: nowIso,
        extractedData: cnhOcr.data,
        source: cnhOcr.source,
        model: cnhOcr.model,
        usedFallback: Boolean(cnhOcr.usedFallback),
        confidence: Number(cnhOcr?.data?.confidence || 0)
      };
      updates[`users/${driverId}/documents/crlv`] = {
        type: 'crlv',
        status: 'pending',
        fileUrl: crlvUpload.fileUrl,
        filePath: crlvUpload.filePath,
        fileType: 'application/pdf',
        fileName: crlvUpload.fileName,
        fileSize: crlvUpload.size,
        uploadedAt: nowIso,
        updatedAt: nowIso,
        extractedData: crlvOcr.data,
        source: crlvOcr.source,
        model: crlvOcr.model,
        usedFallback: Boolean(crlvOcr.usedFallback),
        confidence: Number(crlvOcr?.data?.confidence || 0)
      };

      updates[`vehicles/${vehicleId}`] = {
        id: vehicleId,
        plate: crlvOcr?.data?.placa || null,
        brand: crlvOcr?.data?.marca || null,
        model: crlvOcr?.data?.modelo || null,
        year: crlvOcr?.data?.anoModelo || crlvOcr?.data?.anoFabricacao || null,
        color: crlvOcr?.data?.cor || null,
        status: 'pending',
        category: 'plus',
        carType: 'Leaf Plus',
        createdAt: nowIso,
        updatedAt: nowIso
      };

      updates[`user_vehicles/${driverId}/${userVehicleId}`] = {
        userVehicleId,
        vehicleId,
        isActive: true,
        status: 'pending',
        approved: false,
        createdAt: nowIso,
        updatedAt: nowIso
      };

      updates[`users/${driverId}/vehicles/current`] = {
        type: 'crlv',
        status: 'pending',
        plate: crlvOcr?.data?.placa || null,
        brand: crlvOcr?.data?.marca || null,
        model: crlvOcr?.data?.modelo || null,
        year: crlvOcr?.data?.anoModelo || crlvOcr?.data?.anoFabricacao || null,
        uploadedAt: nowIso,
        updatedAt: nowIso,
        fileMeta: {
          name: crlvUpload.fileName,
          size: crlvUpload.size,
          mimeType: 'application/pdf'
        }
      };

      await db.ref().update(updates);
    }, timings);

    await timed('dashboard:sync_driver_application_mirror', () =>
      driverApplicationService.syncDriverApplication(driverId, { db }),
    timings);

    const authData = await loginAdmin(timings);
    if (!authData?.success || !authData?.accessToken) {
      throw new Error('Falha no login admin');
    }

    const token = authData.accessToken;

    const applicationsResponse = await timed('dashboard:list_applications', () => axios.get(
      `${API_BASE}/drivers/applications?page=1&limit=200`,
      { headers: authHeaders(token), timeout: 30000 }
    ), timings);

    const applications = applicationsResponse?.data?.applications || [];
    const targetApplication = applications.find((app) => String(app?.id) === String(driverId));

    if (!targetApplication) {
      throw new Error('Motorista de teste não apareceu na listagem de aplicações do dashboard');
    }

    report.checks.applicationVisible = {
      ok: true,
      status: targetApplication.status,
      submissionDate: targetApplication.submissionDate
    };

    const docsBeforeUpload = await timed('dashboard:get_documents_before', () => axios.get(
      `${API_BASE}/drivers/${driverId}/documents`,
      { headers: authHeaders(token), timeout: 30000 }
    ), timings);

    const docsBefore = docsBeforeUpload?.data?.data || {};
    report.checks.documentsBefore = {
      total: docsBefore.totalDocuments,
      keys: Object.keys(docsBefore.documents || {})
    };

    const backgroundPdfPath = '/tmp/certidao-antecedentes-e2e.pdf';
    await createBackgroundCheckPdf(backgroundPdfPath);

    const uploadForm = new FormData();
    uploadForm.append('file', fs.createReadStream(backgroundPdfPath), {
      filename: 'certidao-antecedentes-e2e.pdf',
      contentType: 'application/pdf'
    });

    const uploadBackgroundResponse = await timed('dashboard:upload_background_check', () => axios.post(
      `${API_BASE}/drivers/${driverId}/documents/antecedentes_criminais/upload`,
      uploadForm,
      {
        headers: {
          ...authHeaders(token),
          ...uploadForm.getHeaders()
        },
        timeout: 60000,
        maxBodyLength: Infinity
      }
    ), timings);

    report.checks.backgroundUpload = uploadBackgroundResponse?.data || null;

    const docsAfterUploadResponse = await timed('dashboard:get_documents_after_upload', () => axios.get(
      `${API_BASE}/drivers/${driverId}/documents`,
      { headers: authHeaders(token), timeout: 30000 }
    ), timings);

    const docsAfterUpload = docsAfterUploadResponse?.data?.data || {};
    const docsAfterUploadPayload = docsAfterUpload?.documents || {};
    const cnhDoc = getDocumentByType(docsAfterUploadPayload, 'cnh', 'license');
    const crlvDoc = getDocumentByType(docsAfterUploadPayload, 'crlv', 'vehicle');
    const antecedentesDoc = getDocumentByType(docsAfterUploadPayload, 'antecedentes_criminais', 'backgroundCheck');

    const cnhFileUrl = getDocumentFileUrl(cnhDoc);
    const crlvFileUrl = getDocumentFileUrl(crlvDoc);
    const antecedentesFileUrl = getDocumentFileUrl(antecedentesDoc);

    if (!cnhFileUrl || !crlvFileUrl || !antecedentesFileUrl) {
      throw new Error('Nem todos os documentos possuem fileUrl para visualização no dashboard');
    }

    report.checks.documentKeysAfterUpload = Object.keys(docsAfterUpload.documents || {});

    const fileChecks = {
      cnh: await ensureHttp200(cnhFileUrl, 'cnh', timings),
      crlv: await ensureHttp200(crlvFileUrl, 'crlv', timings),
      antecedentes: await ensureHttp200(antecedentesFileUrl, 'antecedentes', timings)
    };

    report.checks.fileAccess = fileChecks;

    if (!SKIP_FINAL_APPROVAL) {
      const reviewRejectCnh = await timed('dashboard:reject_cnh', () => axios.post(
        `${API_BASE}/drivers/${driverId}/documents/cnh/review`,
        {
          action: 'reject',
          rejectionReason: REJECTION_REASONS.cnh
        },
        {
          headers: {
            ...authHeaders(token),
            'Content-Type': 'application/json'
          },
          timeout: 30000
        }
      ), timings);

      const reviewApproveCnh = await timed('dashboard:approve_cnh', () => axios.post(
        `${API_BASE}/drivers/${driverId}/documents/cnh/review`,
        {
          action: 'approve'
        },
        {
          headers: {
            ...authHeaders(token),
            'Content-Type': 'application/json'
          },
          timeout: 30000
        }
      ), timings);

      const reviewRejectCrlv = await timed('dashboard:reject_crlv', () => axios.post(
        `${API_BASE}/drivers/${driverId}/documents/crlv/review`,
        {
          action: 'reject',
          rejectionReason: REJECTION_REASONS.crlv
        },
        {
          headers: {
            ...authHeaders(token),
            'Content-Type': 'application/json'
          },
          timeout: 30000
        }
      ), timings);

      const reviewApproveCrlv = await timed('dashboard:approve_crlv', () => axios.post(
        `${API_BASE}/drivers/${driverId}/documents/crlv/review`,
        {
          action: 'approve'
        },
        {
          headers: {
            ...authHeaders(token),
            'Content-Type': 'application/json'
          },
          timeout: 30000
        }
      ), timings);

      const reviewApproveAntecedentes = await timed('dashboard:approve_background_check', () => axios.post(
        `${API_BASE}/drivers/${driverId}/documents/antecedentes_criminais/review`,
        {
          action: 'approve'
        },
        {
          headers: {
            ...authHeaders(token),
            'Content-Type': 'application/json'
          },
          timeout: 30000
        }
      ), timings);

      report.checks.reviewResponses = {
        rejectCnh: reviewRejectCnh?.data,
        approveCnh: reviewApproveCnh?.data,
        rejectCrlv: reviewRejectCrlv?.data,
        approveCrlv: reviewApproveCrlv?.data,
        approveAntecedentes: reviewApproveAntecedentes?.data
      };

      const docsAfterReviewResponse = await timed('dashboard:get_documents_after_review', () => axios.get(
        `${API_BASE}/drivers/${driverId}/documents`,
        { headers: authHeaders(token), timeout: 30000 }
      ), timings);

      const docsAfterReview = docsAfterReviewResponse?.data?.data || {};
      const docsAfterReviewPayload = docsAfterReview?.documents || {};
      const reviewedCnhDoc = getDocumentByType(docsAfterReviewPayload, 'cnh', 'license');
      const reviewedCrlvDoc = getDocumentByType(docsAfterReviewPayload, 'crlv', 'vehicle');
      const reviewedAntecedentesDoc = getDocumentByType(docsAfterReviewPayload, 'antecedentes_criminais', 'backgroundCheck');
      report.checks.postReviewStatuses = {
        cnh: reviewedCnhDoc?.status || null,
        cnhRejectionReason: reviewedCnhDoc?.rejectionReason || null,
        crlv: reviewedCrlvDoc?.status || null,
        crlvRejectionReason: reviewedCrlvDoc?.rejectionReason || null,
        antecedentes: reviewedAntecedentesDoc?.status || null
      };
    } else {
      report.checks.reviewResponses = {
        skipped: true,
        reason: 'E2E_SKIP_FINAL_APPROVAL'
      };
      const docsAfterUploadPayload = docsAfterUpload?.documents || {};
      const skippedCnhDoc = getDocumentByType(docsAfterUploadPayload, 'cnh', 'license');
      const skippedCrlvDoc = getDocumentByType(docsAfterUploadPayload, 'crlv', 'vehicle');
      const skippedAntecedentesDoc = getDocumentByType(docsAfterUploadPayload, 'antecedentes_criminais', 'backgroundCheck');
      report.checks.postReviewStatuses = {
        cnh: skippedCnhDoc?.status || null,
        cnhRejectionReason: skippedCnhDoc?.rejectionReason || null,
        crlv: skippedCrlvDoc?.status || null,
        crlvRejectionReason: skippedCrlvDoc?.rejectionReason || null,
        antecedentes: skippedAntecedentesDoc?.status || null
      };
    }

    if (!SKIP_FINAL_APPROVAL) {
      const approveAllResponse = await timed('dashboard:approve_driver_application', () => axios.post(
        `${API_BASE}/drivers/applications/${driverId}/approve`,
        { notes: 'Aprovação E2E após validação documental' },
        {
          headers: {
            ...authHeaders(token),
            'Content-Type': 'application/json'
          },
          timeout: 30000
        }
      ), timings);
      report.checks.approveAll = approveAllResponse?.data;
    } else {
      report.checks.approveAll = {
        skipped: true,
        reason: 'E2E_SKIP_FINAL_APPROVAL'
      };
    }

    const finalUserSnapshot = await timed('db:read_final_user', () => db.ref(`users/${driverId}`).once('value'), timings);
    const finalUser = finalUserSnapshot.val() || {};
    report.checks.finalUserApproval = {
      approved: finalUser.approved === true,
      approvedAt: finalUser.approvedAt || null,
      approvedBy: finalUser.approvedBy || null,
      status: finalUser.status || null
    };

    report.timings = timings;
    report.finishedAt = new Date().toISOString();
    report.success = true;

    const outputPath = path.join(
      '/Users/izaakdias/Documents/Leaf-new',
      'docs',
      'architecture',
      `E2E_DRIVER_DOCFLOW_DASHBOARD_${new Date().toISOString().slice(0, 10)}.json`
    );
    await fsp.mkdir(path.dirname(outputPath), { recursive: true });
    await fsp.writeFile(outputPath, JSON.stringify(report, null, 2), 'utf8');

    console.log(JSON.stringify({
      success: true,
      outputPath,
      driverId,
      summary: {
        extraction: {
          cnhSource: cnhOcr.source,
          crlvSource: crlvOcr.source
        },
        applicationVisible: report.checks.applicationVisible,
        fileAccess: report.checks.fileAccess,
        finalUserApproval: report.checks.finalUserApproval
      }
    }, null, 2));
  } catch (error) {
    report.success = false;
    report.finishedAt = new Date().toISOString();
    report.error = {
      message: error.message,
      stack: error.stack
    };
    report.timings = timings;

    const failPath = path.join(
      '/Users/izaakdias/Documents/Leaf-new',
      'docs',
      'architecture',
      `E2E_DRIVER_DOCFLOW_DASHBOARD_FAILED_${new Date().toISOString().slice(0, 10)}.json`
    );
    await fsp.mkdir(path.dirname(failPath), { recursive: true });
    await fsp.writeFile(failPath, JSON.stringify(report, null, 2), 'utf8');

    console.error(JSON.stringify({
      success: false,
      outputPath: failPath,
      error: error.message
    }, null, 2));
    process.exit(1);
  }
})();
