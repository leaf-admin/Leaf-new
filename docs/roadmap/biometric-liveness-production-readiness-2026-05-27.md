# Biometric Liveness Production Readiness - 2026-05-27

## Decisão de arquitetura

- AWS Rekognition Face Liveness prova vida.
- O microsserviço `services/face-compare-service` compara identidade por embedding facial.
- Para ficar online, o caminho alvo é: AWS liveness aprovado -> selfie capturada no app -> backend gera embedding no microsserviço -> backend compara contra embedding da CNH -> cache KYC por janela de 24h.
- Para saque e outras operações sensíveis, a verificação facial pode ser assíncrona e server-side, mantendo o usuário em análise sem travar a operação principal do app.

## Superfície já existente

- Backend AWS liveness:
  - `GET /api/kyc/liveness/provider`
  - `POST /api/kyc/liveness/aws/session`
  - `GET /api/kyc/liveness/aws/credentials`
  - `GET /api/kyc/liveness/aws/session/:sessionId`
- Backend biometria:
  - `POST /api/kyc/verify-driver/device`
  - `POST /api/kyc/verify-driver/server-side-selfie`
  - CNH embedding em `users/{driverId}/biometrics/cnhFace`
  - comparação via `BIOMETRIC_FACE_SERVICE_URL`
- Microsserviço:
  - `POST /generate-embedding`
  - `POST /compare`
  - `GET /health`
  - `GET /ready`
- Mobile:
  - tela nativa AWS liveness
  - service JS para criar sessão, pedir credenciais temporárias e consultar resultado
  - service JS para tentar embedding nativo do dispositivo

## Guardrails adicionados

- `KYC_PRODUCTION_BIOMETRICS_ENABLED=true` ativa o modo estrito de produção biométrica.
- Em modo estrito:
  - `device_signature_v1` não aprova identidade.
  - AWS liveness sozinho não aprova identidade.
  - `MOBILE_FACE_EMBEDDING_LOCAL_COMPARE_FALLBACK` precisa estar `false`.
  - `BIOMETRIC_FACE_SERVICE_URL` e `BIOMETRIC_FACE_SERVICE_API_KEY` são obrigatórios.
  - `ENABLE_CNH_FACE_BIOMETRICS=true` é obrigatório.
- Novo endpoint autenticado:
  - `GET /api/kyc/biometrics/readiness`
- O validador de deploy agora bloqueia runtime de produção biométrica sem AWS, microsserviço, CNH embedding e flags estritas.
- Quando o motorista tenta ficar online e precisa KYC, o backend cria `challengeId` auditável e envia no socket.
- Em modo de produção biométrica, falha ao consultar o gate diário de KYC passa a ser fail-closed.
- Estatísticas e health detalhado de KYC em `/api/kyc/stats` e `/api/kyc/health` agora exigem Firebase auth.
- Native modules deixam de depender só de `ios/` e `android/` gerados: há templates versionáveis em `mobile-app/native/*` e config plugins.
- O pós-AWS Liveness agora usa `server_biometric_selfie_v1`: o app envia a selfie bruta em multipart e o backend faz a comparação real no microsserviço, sem aprovar identidade por `device_signature_v1`.
- O gerador de embedding de CNH agora aceita PDF e imagem. Antes, imagem JPG/PNG de CNH podia cair indevidamente no conversor de PDF.
- Script operacional adicionado:
  - `leaf-websocket-backend/scripts/kyc/generate-cnh-face-embedding.cjs --driver-id <uid>`
  - `leaf-websocket-backend/scripts/kyc/generate-cnh-face-embedding.cjs --storage-path <path> --dry-run`

## Lacunas reais antes de produção biométrica plena

- O runtime ArcFace no dispositivo ainda é propositalmente indisponível: `LeafFaceEmbedding.getStatus()` retorna `available: false` enquanto modelo e runtime ONNX/CoreML/TFLite não forem instalados. Isso não bloqueia o canary do online, porque o caminho pós-AWS usa comparação server-side.
- O modelo `arcface_w600k_r50.onnx` não está empacotado no app.
- Ainda precisa calibrar thresholds com amostras reais Leaf de CNH-e versus selfie viva.
- Ainda precisa backfill de embedding CNH para motoristas antigos, ou bloquear/revisar quem não tiver referência.
- O microsserviço ainda precisa métricas Prometheus/tracing/rate limit antes de carga real.
- Saque com verificação facial deve usar o mesmo contrato de challenge, mas pode permanecer assíncrono e server-side.

## Flags de produção recomendadas

```env
KYC_PRODUCTION_BIOMETRICS_ENABLED=true
KYC_REQUIRE_TRUSTED_BIOMETRIC_MATCH=true
KYC_ALLOW_LEGACY_DEVICE_SIGNATURE=false
KYC_ALLOW_AWS_LIVENESS_ONLY_MATCH=false
KYC_AWS_LIVENESS_ENABLED=true
KYC_AWS_LIVENESS_ASSUME_ROLE_ARN=arn:aws:iam::<account-id>:role/<role-name>
ENABLE_CNH_FACE_BIOMETRICS=true
MOBILE_FACE_EMBEDDING_ENABLED=true
MOBILE_FACE_EMBEDDING_LOCAL_COMPARE_FALLBACK=false
BIOMETRIC_FACE_SERVICE_URL=https://<internal-face-service>
BIOMETRIC_FACE_SERVICE_API_KEY=<secret>
BIOMETRIC_FACE_APPROVE_THRESHOLD=0.61
BIOMETRIC_FACE_REVIEW_THRESHOLD=0.40
BIOMETRIC_SERVER_SIDE_MAX_CONCURRENCY=4
BIOMETRIC_SERVER_SIDE_MAX_QUEUE=250
```

## Validações executadas

```bash
cd leaf-websocket-backend
npx jest --config config/jest.unit.config.js --runInBand \
  tests/unit/services/kyc-biometric-production-policy.unit.test.js \
  tests/unit/services/device-face-embedding-verification-service.unit.test.js \
  tests/unit/routes/kyc-routes-auth.unit.test.js \
  tests/unit/scripts/validate-runtime-config.unit.test.js
```

Resultado anterior: 4 suítes, 28 testes passando.

Após conectar a rota `server-side-selfie`:

```bash
cd leaf-websocket-backend
npx jest --config config/jest.unit.config.js --runInBand \
  tests/unit/routes/kyc-routes-auth.unit.test.js \
  tests/unit/services/kyc-biometric-production-policy.unit.test.js \
  tests/unit/services/device-face-embedding-verification-service.unit.test.js \
  tests/unit/scripts/validate-runtime-config.unit.test.js
```

Resultado: 4 suítes, 30 testes passando.

```bash
cd mobile-app
npx jest --runInBand \
  __tests__/kyc-service.liveness.test.js \
  __tests__/driver-online-toggle.test.js \
  __tests__/driver-balance-service-pilot.test.js
```

Resultado: 3 suítes, 36 testes passando.

```bash
cd services/face-compare-service
PYTHONDONTWRITEBYTECODE=1 .venv/bin/python -m unittest discover -s tests
```

Resultado: 10 testes passando com dependências completas no `.venv` local.

Smoke local do microserviço:

- `BIOMETRIC_FACE_SERVICE_URL=http://127.0.0.1:8008`
- `GET /ready`: `status=ready`, `model_loaded=true`
- CNH E2E em Storage: embedding 512d gerado com `buffalo_l`, `faceCount=1`, `detectionScore=0.9142`.
- CNH não-E2E encontrada em Storage não tinha cadastro correspondente em `users`/`driver_activation` e retornou `no face detected`; não foi persistida para evitar vetor órfão.

```bash
cd services/face-compare-service
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s tests
```

Resultado: 10 testes, 6 passando e 4 pulados por falta das dependências FastAPI/TestClient no ambiente global.
