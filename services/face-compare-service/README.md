# Leaf Face Compare Service

Servico Python isolado para gerar embeddings faciais e comparar similaridade. Ele nao faz liveness, OCR, storage, decisao documental nem substitui o backend Node.js principal.

Endpoints biometricos exigem API key no header `X-Leaf-Biometric-Key`. `GET /health` fica publico para Docker, Caddy e balanceadores.

## Pipeline

1. Detecta faces e landmarks com InsightFace/SCRFD.
2. Alinha a face com `norm_crop`, usando os landmarks.
3. Gera embedding ArcFace normalizado em 512 dimensoes.
4. Compara embeddings com cosine similarity e euclidean distance.
5. Classifica o resultado com thresholds operacionais.

Por performance, o servico carrega apenas os modulos `detection` e `recognition` do InsightFace. Modulos como `genderage`, `landmark_3d_68` e `landmark_2d_106` ficam fora porque nao sao necessarios para comparar CNH/selfie por embedding.

Liveness continua fora deste servico. A expectativa e manter AWS Rekognition liveness no fluxo atual e chamar este microservico apenas para biometria facial por embedding.

## Endpoints

### `GET /health`

Healthcheck leve. Nao carrega o modelo por padrao.

### `POST /generate-embedding`

Recebe uma imagem via multipart form-data:

- campo: `image`
- header obrigatorio: `X-Leaf-Biometric-Key`

Retorna o embedding facial normalizado, metadados da face selecionada e informacoes do modelo.

### `POST /compare`

Recebe dois embeddings e retorna score, distancia e decisao:

```json
{
  "embeddingA": [0.01, 0.02, 0.03],
  "embeddingB": [0.01, 0.02, 0.03],
  "approveThreshold": 0.61,
  "reviewThreshold": 0.40
}
```

Resposta:

```json
{
  "cosine_similarity": 0.97,
  "euclidean_distance": 0.24,
  "decision": "approve",
  "thresholds": {
    "approve": 0.92,
    "review": 0.82
  },
  "metadata": {
    "dimension": 512,
    "metric": "cosine_similarity"
  }
}
```

Decisoes padrao:

- `approve`: score >= `0.92`
- `review`: `0.82` <= score < `0.92`
- `reject`: score < `0.82`

## Rodando localmente

Use Python 3.10 ou 3.11. O Dockerfile usa Python 3.11 porque InsightFace/ONNX Runtime costumam ter melhor suporte nessa faixa.

```bash
cd services/face-compare-service
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
uvicorn app.main:app --host 0.0.0.0 --port 8008 --reload
```

Primeira chamada real de face pode baixar o model pack do InsightFace para `~/.insightface`. Em producao, cacheie esse diretorio ou bake os modelos na imagem.

## Docker

```bash
cd services/face-compare-service
cp .env.example .env
docker compose up --build
```

## Exemplos

Gerar embedding:

```bash
curl -X POST "http://localhost:8008/generate-embedding" \
  -H "X-Leaf-Biometric-Key: $FACE_API_KEYS" \
  -F "image=@/path/to/selfie.jpg"
```

Comparar embeddings:

```bash
curl -X POST "http://localhost:8008/compare" \
  -H "Content-Type: application/json" \
  -H "X-Leaf-Biometric-Key: $FACE_API_KEYS" \
  -d '{"embeddingA":[1,0,0],"embeddingB":[1,0,0]}'
```

## VPS com HTTPS

O perfil em `deploy/docker-compose.vps.yml` sobe:

- `face-compare-service` somente na rede interna Docker.
- `caddy` nas portas 80/443 com TLS automatico.

```bash
cd services/face-compare-service
cp .env.example .env
# edite FACE_PUBLIC_DOMAIN e FACE_API_KEYS
docker compose -f deploy/docker-compose.vps.yml up -d --build
```

Smoke:

```bash
BASE_URL=https://$FACE_PUBLIC_DOMAIN FACE_API_KEY=$FACE_API_KEYS ./scripts/smoke.sh
```

Quando a VPS ja possui proxy nas portas 80/443, use o perfil interno primeiro:

```bash
cd services/face-compare-service
cp .env.example .env
# edite FACE_API_KEYS
docker compose -f deploy/docker-compose.internal.yml up -d --build
curl http://127.0.0.1:8008/health
```

Esse perfil publica apenas em `127.0.0.1:${FACE_HOST_PORT:-8008}` e limita o piloto por padrao a `1.25` CPU, `3g` de memoria e uma thread de BLAS/ONNX. No host compartilhado, use `INSIGHTFACE_DET_SIZE=320,320`; em VPS dedicada, teste `640,640` se precisar de mais margem de deteccao.

Para migrar depois para uma VPS dedicada, mantenha o backend Leaf igual e troque apenas `BIOMETRIC_FACE_SERVICE_URL` para a URL HTTPS dedicada. O passo a passo esta em `deploy/MOVE_TO_DEDICATED_VPS.md`.

## Integracao recomendada com Node.js

1. CNH Digital PDF aprovada: Node renderiza o PDF e recorta a foto da CNH por layout.
2. Node chama `/generate-embedding` com o crop da foto da CNH.
3. Node salva apenas `cnhFaceEmbedding` e metadados do modelo.
4. AWS Rekognition Face Liveness segue como prova de vida.
5. Apos liveness aprovado, Node chama `/generate-embedding` com a selfie viva.
6. Node chama `/compare` com `cnhFaceEmbedding` e `selfieEmbedding`.
7. Node persiste score, decisao automatica, revisao humana e fraude confirmada para calibracao futura.

Nao salve imagens neste servico. Se uma imagem precisar existir por auditoria, trate isso em fluxo separado, com retencao curta, criptografia, permissao explicita e trilha LGPD.

## Validacao

Testes sem dependencias pesadas:

```bash
cd services/face-compare-service
PYTHONPATH=. python -m unittest discover -s tests
```

Testes completos de API:

```bash
cd services/face-compare-service
pip install -r requirements-dev.txt
PYTHONPATH=. pytest
```

Benchmark rapido:

```bash
cd services/face-compare-service
python scripts/benchmark.py --api-key "$FACE_API_KEYS" --iterations 50
python scripts/benchmark.py --api-key "$FACE_API_KEYS" --image /path/to/selfie.jpg --iterations 20
```
