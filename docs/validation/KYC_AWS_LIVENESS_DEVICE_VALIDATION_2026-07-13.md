# KYC AWS Liveness — validação em dispositivo físico (2026-07-13)

## Objetivo

Validar o AWS Rekognition Face Liveness em um iPhone físico, dentro de um laboratório isolado, corrigir a tela preta do módulo nativo e separar o resultado de liveness da readiness completa de KYC/Face Compare.

## Resultado executivo

- **AWS Face Liveness: aprovado no dispositivo físico.**
- **Correção da tela preta: validada.** O usuário concluiu todo o desafio facial e retornou à tela inicial do app.
- **Face Compare: falhou depois do liveness, como previsto.** Essa etapa continua fora de readiness e impede declarar o KYC completo como pronto para produção.
- **Ambiente de produto: não contaminado.** O laboratório aceitou apenas as rotas de liveness, usou Firebase somente para autenticação, Redis DB 14 e permaneceu sem escritas de produto.
- **Produção: não habilitada.** Nenhuma flag estrita de KYC, deploy, submissão de loja ou mutação de ambiente produtivo foi executada.

## Ambiente validado

- Dispositivo: iPhone 15 Pro Max físico, iOS 26.5, conectado por USB-C.
- App: `br.com.leaf.ride`, versão 1.0.4, build 34.
- Build: Debug, arm64, assinada com perfil de desenvolvimento.
- Laboratório: `http://192.168.1.8:3101`.
- AWS: Rekognition Face Liveness, região `us-east-1`.
- Threshold do laboratório: 80.
- TTL da sessão: 180 segundos.
- Imagens de auditoria: 0.
- Limite: 2 tentativas por janela de 1 hora.
- Custo unitário estimado pelo laboratório: US$ 0,015 por tentativa.
- Budget AWS: US$ 10/mês, com alertas de custo configurados.

## Falha encontrada

O SDK iniciava a sessão e mantinha a câmera frontal ativa, mas o `UIHostingController` podia apresentar sua view com frame inicial zero. O detector era criado antes de existir geometria válida; por isso havia captura de câmera e conexão com a AWS, porém toda a superfície visível ficava preta.

## Correção implementada

Arquivo canônico alterado:

- `mobile-app/native/aws-liveness/ios/LeafAwsLivenessModule.swift`

Ajustes:

- pré-dimensionamento explícito do `UIHostingController` antes da apresentação;
- `GeometryReader` e gate de layout para criar o detector apenas com largura e altura positivas;
- frame explícito do detector na área disponível;
- retenção forte do controller enquanto a promessa nativa estiver ativa;
- instrumentação somente em Debug para registrar host, janela e preview sem expor sessão ou credenciais;
- cópia gerada do módulo mantida idêntica ao template canônico.

## Evidência de execução

Resultado persistido no laboratório:

```json
{
  "provider": "aws_rekognition_face_liveness",
  "requirement": "LIVENESS_REQUIRED",
  "attemptScope": "local_lab",
  "livenessPassed": true,
  "confidence": 99.88607788085938,
  "lastStatus": "SUCCEEDED",
  "createdAt": "2026-07-13T19:28:02.363Z",
  "completedAt": "2026-07-13T19:28:57.966Z"
}
```

Evidência de layout nativo:

```text
[LeafAwsLiveness][Layout] presented host=(0.0, 0.0, 430.0, 932.0) window=(0.0, 0.0, 430.0, 932.0)
[LeafAwsLiveness][Layout] after-2s host=(0.0, 0.0, 430.0, 932.0) window=(0.0, 0.0, 430.0, 932.0)
[LeafAwsLiveness][Layout] after-10s host=(0.0, 0.0, 430.0, 932.0) window=(0.0, 0.0, 430.0, 932.0)
```

Os overlays de Debug foram limpos no runtime antes da execução. A tela inicial sem overlays foi registrada. Não houve screenshot dentro do modal: o desafio foi concluído pelo usuário antes da captura, mas a conclusão está comprovada pelo resultado AWS, pelo retorno ao app e pelos logs de layout acima.

## Validações executadas

- `xcodebuild ... -configuration Debug ... build` — **PASS**.
- `codesign --verify --deep --strict Leaf.app` — **PASS**.
- Bundle/versão/build — `br.com.leaf.ride`, 1.0.4 (34).
- Endpoints embutidos — quatro URLs apontando para `192.168.1.8:3101`.
- `npm --prefix mobile-app run qa:production-guards` — **PASS**.
- `npm --prefix mobile-app run test:unit -- __tests__/kyc-service.liveness.test.js` — **11/11 PASS**.
- `npm run governance:check` — **PASS**.
- `node scripts/maintenance/security/scan-secrets.cjs --tracked-only` — **PASS**.
- `bash leaf-websocket-backend/scripts/tests/assert-no-hardcoded-secrets.sh` — **PASS**.
- `git diff --check -- mobile-app/native/aws-liveness/ios/LeafAwsLivenessModule.swift` — **PASS**.
- Template e cópia iOS gerada — **byte a byte idênticos**.

## Riscos e pendências para KYC readiness

O sucesso do liveness não torna o KYC completo pronto. Antes de produção ainda é necessário:

1. tornar o serviço Leaf Face Compare operacional e expor readiness real, não apenas health/configuração;
2. validar o encadeamento `liveness aprovado -> embedding/selfie -> face compare -> decisão backend`;
3. fechar os findings P0 já levantados sobre bypass de gate diário, aceitação de evidência legado, cache positivo fraco e fallback local da UI;
4. executar a matriz negativa do Face Compare (sem face, múltiplas faces, baixa similaridade, timeout e indisponibilidade);
5. manter a decisão final e a política de ativação governadas pelo backend;
6. repetir a prova integrada em sandbox antes de qualquer ativação de strict mode em produção.

## Rollback

1. Reverter somente `mobile-app/native/aws-liveness/ios/LeafAwsLivenessModule.swift` para a versão anterior.
2. Regenerar a cópia nativa pelo plugin existente.
3. Recompilar Debug e instalar sobre o mesmo bundle.

Nenhuma migração, mudança de schema ou alteração de regra de negócio foi feita; o rollback é restrito ao módulo nativo de apresentação do liveness.

## Itens fora do escopo e preservados

- código legado não removido nem renomeado;
- nenhuma regra financeira ou de corrida alterada;
- nenhuma credencial incluída no repositório;
- nenhuma rotação de chave;
- nenhum deploy de produção;
- nenhuma submissão Apple/Google;
- nenhuma limpeza de builds, app data ou arquivos do usuário;
- nenhuma alteração não relacionada do worktree revertida.
