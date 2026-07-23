# KYC — revisão de divergência facial

Data: 17/07/2026
Estado: implementação e testes concluídos; ativação/deploy pendentes.

## Objetivo

Disponibilizar um fluxo operacional para chamados de motoristas cuja sessão AWS Liveness foi aprovada, mas cuja selfie de referência foi rejeitada pelo CompareFaces canônico contra a CNH aprovada.

## Fluxo fechado

1. O backend retém somente a `ReferenceImage` de uma comparação canônica concluída e reprovada. Selfies aprovadas e falhas técnicas não são retidas.
2. A imagem fica em caminho privado e opaco no Storage, vinculada por hash à sessão de liveness e à versão exata da CNH aprovada.
3. O motorista recebe uma mensagem não técnica e uma única ação: `Solicitar análise`.
4. O chamado operacional é vinculado ao motorista, à evidência e ao caso. Se o vínculo falhar transitoriamente, o ticket permanece durável como `pending` e pode ser reconciliado no backoffice.
5. Um revisor KYC ativo abre a CNH e a selfie lado a lado pela API Leaf. Não há URL pública nem chamada direta do dashboard à AWS.
6. `Falso positivo` autoriza exatamente uma nova tentativa limpa. Isso não aprova identidade nem documento.
7. `Fraude confirmada` exige decisão explícita, frase reforçada e aplica bloqueio permanente canônico.
8. Decisões, novas verificações e bloqueios são executados somente fora de corrida ativa.

## Controles

- Acesso administrativo limitado a `admin`, `super-admin` e `manager`, com registro ativo e UID/e-mail/role coincidentes.
- Leitura de evidência exige chamado, justificativa e hash do par selfie/CNH.
- Respostas ao motorista não expõem score, threshold, hash, caminho de Storage ou termos técnicos do provedor.
- Troca, aprovação ou rejeição de CNH é bloqueada durante hold, retry limpo ou bloqueio permanente.
- O crédito de retry é autoritativo no Firestore e também limitado no Redis. O claim relê o enforcement na mesma transação, impedindo corrida com bloqueio permanente.
- Uma falha anterior ao dispatch AWS devolve o crédito; dispatch real ou ambíguo mantém o crédito fechado para evitar cobrança duplicada.
- Retenção lógica máxima: 30 dias contados da captura. O caso nunca estende a validade da imagem original.

## Persistência

- `kyc_failed_biometric_evidence`: metadados da selfie reprovada e expiração.
- `kyc_identity_review_cases`: vínculo imutável de selfie, CNH e chamado.
- `kyc_identity_review_audit`: trilha de abertura, acesso e decisão.
- `kyc_identity_retry_authorizations`: autorização única de retry limpo.
- `driver_identity_enforcement`: hold, retry autorizado ou bloqueio permanente.
- Storage: `restricted/kyc-failed-biometric-evidence/v1/`.

## Validação executada

- Backend focado: 10 suítes, 195 testes, sem falhas.
- Retenção/caso/workflow após ajuste de expiração: 3 suítes, 35 testes, sem falhas.
- Chamados, isolamento operacional e reconciliação pendente: 3 suítes, 40 testes, sem falhas.
- Mobile: 7 suítes, 140 testes, sem falhas; `qa:production-guards` aprovado.
- Dashboard: contract, ESLint, build Next, `qa:backoffice` e smoke aprovados.
- `git diff --check`, governance, scan de segredos e hardcoded-secret guard aprovados.

## Requisitos antes de ativar

1. Fazer deploy versionado de backend e dashboard; publicar a alteração JS móvel pelo canal aprovado do ciclo.
2. Configurar lifecycle físico no bucket para apagar objetos do prefixo privado após 30 dias. O bloqueio lógico de leitura já está no código, mas não substitui a exclusão física.
3. Confirmar no `adminUsers` os revisores KYC com `active=true` e role permitida.
4. Validar visualmente, em sessão administrativa real, um caso com selfie reprovada e CNH aprovada, incluindo um ticket inicialmente `pending`.
5. Executar o GO formal com perfil controlado e então habilitar `KYC_PRODUCTION_BIOMETRICS_ENABLED=true`. A validação atual informa perfil `full` sem GO e biometria estrita desabilitada.
6. Revisar aviso de privacidade/retenção biométrica antes de operação com usuários reais.

## Riscos restantes

- Se a AWS criar a sessão e o Firestore falhar ao consumir o claim logo depois, o crédito permanece fechado por segurança e exige recuperação operacional; não ocorre nova cobrança automática.
- A exclusão física depende da política de lifecycle do bucket até existir execução autorizada dessa configuração.
- Ainda não foi coletada evidência visual autenticada do painel com dados reais nesta versão.

## Rollback

Desabilitar as novas superfícies no deploy e reverter apenas os serviços/rotas/componentes KYC deste fluxo. Não apagar coleções ou objetos existentes durante rollback; manter a retenção e a auditoria até o prazo aplicável.
