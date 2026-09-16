# Exclusão, recuperação e revisão de CPF — procedimento operacional

## Objetivo e autorização

Implementação local dos três pontos aprovados pelo titular do projeto: impedir
concorrência entre cadastro/exclusão, recuperar exclusões sem login do titular
e tratar exceções fundamentadas por revisão humana. Branch:
`codex/uiux-integration-validation`. Não houve commit, push, deploy nem operação
com dados reais. A autorização anterior para correções locais pelo Codex foi preservada.

## Comportamento implementado

### Cadastro e exclusão concorrentes

A reserva do CPF e a gravação do perfil no endpoint canônico usam a mesma
transação Firestore. A transação lê o estado atual da conta e recusa contas
`deletion_pending`, `deleted` ou `accountDisabled`. Gravações sem CPF e a
migração de perfil legado também verificam esse estado em transação.

A exclusão marca o usuário como pendente antes de limpar dados. O RTDB recebe
somente `{status: "deleted", accountDisabled: true}`. Projeções de perfil usam
transação RTDB e abortam diante desse marcador. Assim uma projeção atrasada não
recria CPF ou dados do perfil depois da limpeza. Esse marcador mínimo é
necessário para o controle de concorrência e não contém CPF.

O índice só é liberado após limpeza dos perfis e remoção Auth quando configurada.
A remoção confirma transacionalmente o UID atual. KYC, aprovações e saldo não
são restaurados no retorno. O fluxo normal de verificação continua aplicável.

### Exclusão retomável

`account_deletions/{uid}` é o registro canônico. Usuário pendente e criação do
registro são atômicos. Cada tentativa fica em `attempts/{id}`, com ator, origem,
etapa e resultado. Etapas: desativar Auth, limpar RTDB, purgar perfil Firestore,
remover Auth quando habilitado, liberar CPF e marcar conclusão.

A recuperação repete as operações idempotentes em ordem; não presume que um
checkpoint sozinho prove o estado atual de outro serviço. Auth já ausente é
aceito. Falhas preservam o bloqueio do UID e registram `retry_required`; não
reativam a conta. Conclusão do perfil e do registro canônico é atômica.

Com `ACCOUNT_DELETE_IMMEDIATE_PURGE=false`, a solicitação fica enfileirada e o
CPF continua reservado. A recuperação administrativa conclui essa solicitação.
Solicitações antigas com ID aleatório podem ser adotadas somente se o registro
pertencer ao mesmo UID, tiver estado processing/error/queued e a conta estiver
pending/deleted. O histórico original não é apagado. Conta ativa sem exclusão
válida não pode ser excluída por esse endpoint de recuperação.

### Exceções e contestação

`cpf_review_restrictions` usa identificador HMAC-SHA256 de CPF normalizado,
com chave dedicada. HMAC é pseudonimização, não anonimização. Nenhum CPF bruto
é armazenado nessa coleção. O índice normal de unicidade mantém o formato
existente; não houve migração desse índice.

Somente `fraud_confirmed` ou `safety_restriction` são aceitos. Motivo da decisão,
referência de evidência, fundamento, revisão e vencimento são obrigatórios.
Não há prazo jurídico padrão nem classificação automática de fraude. O operador
precisa usar a política aprovada para preencher os campos; a API não comprova
por si só a suficiência jurídica ou factual do fundamento.

Restrição vigente retorna 423/`PROFILE_CPF_REVIEW_REQUIRED`, mensagem de suporte
e `reviewReference`. O usuário pode iniciar autenticação/cadastro, mas não
concluir o perfil com esse CPF. Deve abrir contestação pelo suporte já existente,
informando essa referência. Após verificação da identidade e da evidência, um
super-admin registra a decisão; o suporte comum não pode levantar a restrição.
A aprovação do recurso libera a restrição, sem aprovar KYC automaticamente.

Todas as decisões geram `cpf_review_audit`, sem CPF bruto nem HMAC, com caseId,
ator, revisão e motivo. Atualizações exigem caseId e expectedRevision atuais;
uma decisão atrasada não sobrescreve a vigente. Evidências completas devem ficar
no sistema restrito indicado por evidenceRef, não em campos de texto da API.

Vencimento encerra o bloqueio, sem renovação automática. A limpeza física do
registro HMAC é manual e auditada pela ação expire. É obrigatório atribuir um
responsável operacional para revisar casos até reviewAt e executar a limpeza
no vencimento. Não há job de expiração nesta entrega. Auditoria e evidências
possuem retenção própria, a validar juridicamente; expire não as apaga.

## Ferramentas administrativas

Todas as rotas abaixo exigem o JWT administrativo existente e consulta atual ao
Firestore `adminUsers`: active=true e role=super-admin. Falha na consulta nega
acesso. Claims de cliente, suporte comum e cache permissivo não bastam.

- GET `/api/admin/account-deletions/:userId`: estado e etapa do registro canônico.
- POST `/api/admin/account-deletions/:userId/retry`: retoma exclusão já solicitada.
- GET `/api/admin/cpf-reviews/pending`: até 100 casos em ordem de reviewAt;
  usar `?afterCaseId=<nextCursor>` para continuar. Inclui vencidos para limpeza.
  Se o cursor tiver sido removido, reiniciar a listagem.
- POST `/api/admin/cpf-reviews/decision`: cria, revisa, libera ou expira um caso.

Exemplo de criação (preencher dados e datas reais aprovados; não executado):

```json
{
  "action": "restrict",
  "cpf": "<CPF validado do titular>",
  "expectedRevision": 0,
  "reason": "fraud_confirmed",
  "decisionReason": "<decisão fundamentada, sem dados pessoais extras>",
  "evidenceRef": "<referência restrita>",
  "legalBasis": "<fundamento validado>",
  "reviewAt": "<data ISO futura>",
  "expiresAt": "<data ISO igual ou posterior à revisão>"
}
```

Para revisar, enviar action=restrict, caseId e expectedRevision retornados pela
listagem, mais os campos obrigatórios. Para liberar ou limpar vencido, enviar
respectivamente action=release ou expire, caseId, expectedRevision e
 decisionReason. Não é necessário recuperar CPF bruto para essas operações.
Ação expire antes do vencimento é rejeitada. Conflito 409 exige reler o caso;
não repetir a decisão cegamente.

## Configuração e implantação

Em produção a checagem de revisão é obrigatória, inclusive se a variável estiver
omitida. O validador rejeita CPF_REVIEW_ENABLED=false em produção e exige
CPF_REVIEW_HMAC_KEY com pelo menos 32 bytes. Fora de produção, habilitar com
CPF_REVIEW_ENABLED=true. A chave deve ser dedicada, secreta e provisionada por
operação autorizada; não foi criada nem consultada nesta tarefa.

CI recebeu somente um valor fictício explícito para testar configuração. Nunca
usar esse valor em runtime real. Não trocar a chave de um ambiente com casos
existentes sem migração controlada: novos HMACs deixariam de encontrar os antigos.

Antes de implantar: validar fundamentos/prazos, designar responsável pela fila,
provisionar a chave e testar concorrência/retomada em ambiente Firebase autorizado.
A checagem estática confirmou deny-by-default para coleções não públicas. Esta
entrega não executou emuladores, alterou regras remotas nem validou sessão real.
Mudanças de estado de conta feitas por outros serviços administrativos continuam
sujeitas à revisão de integração; estes testes cobrem os fluxos canônicos alterados.

## Validação e evidência

- Backend completo: 273 suítes / 2.306 testes PASS antes da última extensão legado.
- Após extensão legado: 2 suítes / 51 testes de rotas e lifecycle PASS.
- Arquitetura: 9 suítes / 171 testes PASS, incluindo guardas de rotas.
- Configuração/aprovação: 2 suítes / 70 testes PASS.
- Governança, scanner de segredos, guard de segredos e diff-check PASS.
- Firebase rules: contrato estático PASS; não representa execução em Firebase.

Testes novos cobrem interleavings de cadastro/exclusão, gravação RTDB atrasada,
falhas Auth/RTDB/índice, retomada sem Auth, fila, recuperação legado, autenticação
administrativa, proibição de suspeita sem fundamento, revisão vencida,
contestação acolhida/liberação e conflito de versão. Todos com mocks/modelo
local de transação. As duas primeiras asserções novas de config usaram um caminho
incorreto do JSON do validador; foram corrigidas e passaram na regressão.
Hashes dos arquivos e logs estão em account-lifecycle-evidence.json.

## Escopo dos arquivos e reversão

Alterados: account-routes, cpf-identity-registry-service, driver-approval-service,
validate-runtime-config e seus testes, além da fixture de CI em eas-build.yml.
Criados: account-lifecycle-service, cpf-review-service, testes dos dois serviços
e helper lifecycle-memory.cjs. Documentação e evidência nesta pasta.

account-lifecycle-hardening.patch isola esta rodada sobre a árvore local anterior,
sem descartar alterações preexistentes. Revisar e verificar a aplicação reversa
antes de reverter. Não usar reset amplo. Após implantação, reverter código não
restaura dados apagados e código antigo pode ignorar restrições ou marcadores;
nessa situação manter exclusão/cadastro suspensos até uma reversão coordenada.
Registros financeiros, regras de tarifa, KYC, deploys e serviços pagos ficaram
fora do escopo. Não foi criado job, cron ou dependência.
