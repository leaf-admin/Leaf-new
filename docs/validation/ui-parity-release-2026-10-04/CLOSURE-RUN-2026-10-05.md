# Fechamento de implantação e validação física — 2026-10-05

## Objetivo

Implantar a API de endereços salvos e aceitar os candidatos Leaf 1.0.6 nos aparelhos físicos. **A implantação e a aceitação física continuam pendentes.**

## Escopo concluído

- O patch existente foi isolado sobre `origin/main` atualizado, em `codex/saved-places-pilot-rc106`, sem incluir a migração mobile inteira.
- A [PR #222](https://github.com/leaf-admin/Leaf-new/pull/222) foi validada e integrada em `main`. Commit revisado: `f87ee33504091a90bbc5fdc96dd7f51ab61115ad`; merge: `db94e58bdec60871a92d2b20d8ea77d866899d3c`.
- Os quatro arquivos dessa correção são idênticos aos do candidato mobile já preparado.
- API e socket reais responderam 200 em liveness/quick health, com Redis, Firebase e adapter saudáveis.
- Preferências responderam 200 para passageiro e motorista QA. Ambos mantêm o perfil `qa-test-users-sandbox-durable`, com sandbox por usuário e sem expiração.
- IPA de loja, IPA de dispositivo, AAB e APK continuam com os hashes registrados. Os 222 arquivos do candidato conferem nos dois checkouts.
- O GitHub estava selecionando a conta pessoal sem permissão de escrita. A credencial `leaf-admin` já existente foi usada apenas nos processos deste trabalho; a conta global permaneceu inalterada.

## Arquivos de implementação

1. `leaf-websocket-backend/routes/account-routes.js`
2. `leaf-websocket-backend/services/account-saved-places.js`
3. `leaf-websocket-backend/tests/unit/routes/account-routes.unit.test.js`
4. `leaf-websocket-backend/tests/unit/services/account-saved-places.unit.test.js`

Nesta rodada, a implementação foi transferida do candidato existente para uma PR isolada. O checkout principal preserva seu trabalho staged. Os registros desta rodada ficam em `evidence/closure-*`, neste documento e em `artifacts.json`.

## Testes executados

- Suites focadas de rotas e serviço: **2 suites, 67 testes passaram** sobre a branch isolada.
- Guardas de rotas, governança, scan de segredos, guarda de segredos hardcoded e diff check: passaram.
- CI da PR: backend/configuração, mobile/produção/unit, dashboard/lint/build/smoke, regras Firebase/emulador, governança/segredos e secret guard: **seis gates passaram**. O build EAS manual ficou explicitamente sem execução.
- Patch aplicável à base da PR e rollback reverso aplicável ao candidato: passaram.
- Probes autenticados reais somente de leitura; nenhuma mutação de conta, viagem ou pagamento nesta rodada.

Os testes da CI usam seu ambiente de CI. Eles não comprovam a configuração efetiva da VPS nem substituem a matriz física da nova UI.

## Evidência e pendências reais

### Endereços salvos

`/api/account/places` ainda respondeu **404** para os dois usuários QA. A PR integrada disponibiliza o código para o fluxo de release; não houve implantação remota. CRUD, persistência em nova sessão e isolamento entre usuários exigem o endpoint implantado.

### Identidade SSH

O arquivo de acesso está em `/Users/izaakdias/Desktop/dump/contabo.txt`; a chave de login está em `/Users/izaakdias/.ssh/leaf_contabo_20260412_ed25519`. Esses caminhos já foram encontrados e o acesso foi autorizado anteriormente.

O host `169.58.32.212` responde na porta SSH, mas apresenta ED25519 **`SHA256:Go/Zwa/PnjWiu7qChfmXfdKn44GmiYfyIeMCwtKOu54`**, diferente da identidade registrada. `StrictHostKeyChecking=yes` interrompeu a conexão antes da autenticação. O registro confiável não foi apagado nem substituído.

A confirmação solicitada é da identidade do servidor, não da localização da senha ou da chave de login. Pelo console Contabo, a conferência é `ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub`. Após confirmação, preservar o registro anterior e fixar somente a chave confirmada, mantendo a verificação estrita.

A saúde interna do Face Compare e os campos efetivos de configuração da VPS ainda exigem acesso autenticado; flags públicas não são prova de funcionamento desse serviço.

### Aparelhos

Na checagem final, iPhone 15 Pro Max e iPad permaneciam pareados, com túnel `unavailable`. O ADB não listou Android. A inspeção USB desta rodada não encontrou telefones. Não houve instalação, áudio nativo ou viagem bilateral física nesta rodada.

Os instaláveis completos continuam preparados, com app/widget iOS assinados pela equipe Leaf `DTA8W5KA5D` e Android com a assinatura registrada. A próxima instalação deve preservar os dados existentes.

## Próxima execução

1. Confirmar a impressão digital SSH e disponibilidade dos celulares; as duas informações foram solicitadas nesta conversa.
2. Inspecionar a configuração efetiva, o serviço Face Compare e os hashes dos arquivos remotos, sem imprimir segredos.
3. Usar `deploy-contabo-docker.sh` com commit exato aprovado em `main`, lista restrita `routes/account-routes.js services/account-saved-places.js`, `GATEWAY_ONLY_DEPLOY=true`, `UPDATE_COMPOSE_FILES=false` e `UPDATE_WORKERS=false`. Preservar backup, rollback automático e checagens de readiness do script existente. Não executar de uma branch divergente nem de um checkout sujo.
4. Validar CRUD real no usuário QA, leitura com token de nova sessão, isolamento do motorista e remoção somente do registro criado para o teste.
5. Instalar os candidatos nos aparelhos disponíveis e executar a jornada bilateral com o sandbox QA existente, sem alterar o ambiente global de pagamentos.

## Riscos

O endpoint cloud permanece indisponível até o rollout. O fallback local do app não prova sincronização. A identidade SSH divergente impede autenticação segura; a ausência dos dispositivos impede evidência física honesta, conforme o protocolo de validação de `AGENTS.md`. Não declarar a release pronta para publicação com essas etapas pendentes.

## Rollback

Reverter a PR #222 pelo fluxo GitHub para desfazer a mudança de fonte. O patch reverso foi conferido. Não há alteração de VPS, dispositivo ou dados QA para desfazer nesta rodada. Em um rollout posterior, usar o backup de fonte/imagens e a ordem de substituição dos gateways do script canônico, preservando Redis, volumes e ambiente.

## Fora do escopo

Nenhuma mudança em UI mobile, regras financeiras, preços, Pix, ledger, saques, KYC, providers pagos, dependências ou serviços externos. Nenhum novo build nativo, OTA, deploy de VPS ou envio às lojas foi executado nesta rodada.
