// Rotas de KYC (liveness AWS, verificação facial, âncoras e encodings). O registro das
// rotas fica em routes/kyc-routes/: shared.js com dependências e helpers, e um arquivo
// por grupo. initializeRoutes() chama os grupos na ordem original de registro.
const {
  express,
  multer,
  crypto,
  IntegratedKYCService,
  AwsFaceLivenessService,
  CanonicalAwsFaceCompareService,
  canonicalDriverDocumentApprovalService,
} = require('./kyc-routes/shared');

class KYCRoutes {
  constructor() {
    this.router = express.Router();
    this.kycService = new IntegratedKYCService();
    this.awsLivenessService = new AwsFaceLivenessService();
    this.awsFaceCompareService = new CanonicalAwsFaceCompareService();
    this.cnhFaceBiometricService = null;
    this.firebaseStorageService = null;
    this.canonicalDriverDocumentApprovalService = canonicalDriverDocumentApprovalService;
    this.initializeUpload();
    this.initializeRoutes();
  }

  usesAwsCanonicalFaceCompare() {
    return String(process.env.KYC_FACE_COMPARE_PROVIDER || '')
      .trim()
      .toLowerCase() === 'aws_rekognition_compare_faces';
  }

  async loadCanonicalApprovedCnhPortrait(userId) {
    if (!this.cnhFaceBiometricService) {
      const CnhFaceBiometricService = require('../services/cnh-face-biometric-service');
      this.cnhFaceBiometricService = new CnhFaceBiometricService();
    }
    if (!this.firebaseStorageService) {
      const FirebaseStorageService = require('../services/firebase-storage-service');
      this.firebaseStorageService = new FirebaseStorageService();
    }
    const document = await this.canonicalDriverDocumentApprovalService.requireApprovedCnh(userId);
    const status = String(document.status || '').trim().toLowerCase();
    const analysisStatus = String(document.analysisStatus || '').trim().toLowerCase();
    const submissionId = String(document.submissionId || '').trim();
    const documentPath = String(document.filePath || '').trim();
    const documentSha256 = String(document.documentSha256 || '').trim().toLowerCase();
    const storageGeneration = String(document.storageGeneration || '').trim();
    const createdAt = document.reviewedAt;
    const downloaded = await this.firebaseStorageService.downloadStoragePath(documentPath, {
      generation: storageGeneration,
      includeMetadata: true
    });
    const documentBuffer = downloaded.buffer;
    const actualDocumentSha256 = crypto
      .createHash('sha256')
      .update(documentBuffer)
      .digest('hex');
    if (
      downloaded.metadata?.generation !== storageGeneration
      || actualDocumentSha256 !== documentSha256
    ) {
      const error = new Error('PDF da CNH diverge da aprovacao canonica');
      error.code = 'KYC_CANONICAL_CNH_DOCUMENT_INTEGRITY_MISMATCH';
      throw error;
    }
    const portrait = await this.cnhFaceBiometricService.extractCnhPortraitImage(
      documentBuffer,
      { allowFullPageFallback: false }
    );
    if (portrait.source !== 'approved_cnh_pdf_crop_v1') {
      const error = new Error('A referência canônica deve vir do recorte do PDF da CNH aprovada');
      error.code = 'KYC_CANONICAL_CNH_PDF_CROP_REQUIRED';
      throw error;
    }

    return {
      sourceImageBuffer: portrait.imageBuffer,
      reference: {
        bindingVersion: 3,
        source: portrait.source,
        documentType: 'cnh',
        status,
        analysisStatus,
        approvalSource: document.approvalSource,
        reviewedBy: document.reviewedBy,
        reviewedAt: document.reviewedAt,
        submissionId,
        documentPath,
        documentPathSha256: crypto.createHash('sha256').update(documentPath).digest('hex'),
        documentSha256,
        storageGeneration,
        imageSha256: portrait.imageSha256,
        cropVersion: portrait.cropVersion,
        createdAt
      }
    };
  }

  async verifyCanonicalFaceMatch(userId, awsResult, options = {}) {
    if (!this.usesAwsCanonicalFaceCompare()) {
      return this.kycService.verifyDriverServerSideSelfie(
        userId,
        awsResult.referenceImageBuffer,
        options
      );
    }

    const approvedCnh = await this.loadCanonicalApprovedCnhPortrait(userId);
    return this.awsFaceCompareService.verifyApprovedCnhAgainstLiveness({
      driverId: userId,
      sourceImageBuffer: approvedCnh.sourceImageBuffer,
      livenessReferenceImageBuffer: awsResult.referenceImageBuffer,
      reference: approvedCnh.reference,
      liveness: {
        provider: awsResult.provider,
        sessionId: awsResult.sessionId,
        status: awsResult.status,
        livenessPassed: awsResult.livenessPassed === true,
        confidence: awsResult.confidence,
        threshold: awsResult.confidenceThreshold,
        costGuardOperationId: awsResult.sessionMetadata?.costGuardOperationId || null,
        referenceImageSha256: crypto
          .createHash('sha256')
          .update(awsResult.referenceImageBuffer)
          .digest('hex'),
        referenceImageBoundingBox: awsResult.referenceImageBoundingBox || null
      }
    });
  }

  initializeUpload() {
    // Configurar multer para upload de imagens
    // ✅ CORREÇÃO: Aumentar limite de tamanho para uploads de CNH
    this.upload = multer({
      storage: multer.memoryStorage(),
      limits: {
        fileSize: 20 * 1024 * 1024, // 20MB (aumentado de 5MB)
        files: 1
      },
      fileFilter: (req, file, cb) => {
        if (file.mimetype.startsWith('image/')) {
          cb(null, true);
        } else {
          cb(new Error('Arquivo deve ser uma imagem'), false);
        }
      }
    });
  }

  initializeRoutes() {
    // A ordem de registro no Express é a ordem abaixo e precisa ser mantida.
    this.registerLivenessRoutes();
    this.registerProfileAndDeviceRoutes();
    this.registerServerSideSelfieRoutes();
    this.registerVerifyDriverRoutes();
    this.registerAnchorsEncodingsAndStatusRoutes();
  }

  getRouter() {
    return this.router;
  }
}

const PARTS = [
  require('./kyc-routes/01-liveness'),
  require('./kyc-routes/02-profile-and-device'),
  require('./kyc-routes/03-server-side-selfie'),
  require('./kyc-routes/04-verify-driver'),
  require('./kyc-routes/05-anchors-encodings-status'),
];

for (const part of PARTS) {
  for (const name of Object.getOwnPropertyNames(part.prototype)) {
    if (name === 'constructor') continue;
    if (Object.prototype.hasOwnProperty.call(KYCRoutes.prototype, name)) {
      throw new Error(`KYCRoutes: método duplicado entre partes: ${name}`);
    }
    Object.defineProperty(KYCRoutes.prototype, name, Object.getOwnPropertyDescriptor(part.prototype, name));
  }
}

module.exports = new KYCRoutes();
