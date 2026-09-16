# Política de CPF após exclusão — 2026-09-07

## Decisão aprovada pelo titular do projeto

Liberação como regra após exclusão normal concluída; retenção excepcional,
fundamentada e revisável. Conta ativa mantém exclusividade. Exclusão pendente
não libera o índice. Retorno exige novo cadastro e as verificações aplicáveis,
sem restauração automática de KYC, aprovações ou saldo. Registros financeiros
seguem sua política própria e não são eliminados para liberar CPF.

Exceções por fraude comprovada ou segurança fundamentada devem usar registro
separado, acesso restrito, motivo, fundamento, prazo e revisão humana. Não foi
aprovado prazo genérico de retenção. Os critérios e prazos específicos precisam
de validação jurídica antes de operacionalizar esse fluxo.

## Implementação local concluída

- Busca vínculos em `cpf_identity_index` pelo UID, inclusive após purge parcial.
- Releitura transacional de cada vínculo; apaga somente se o UID ainda coincidir.
- Libera depois do purge do perfil, remoção RTDB e remoção Auth quando habilitada.
- Falha de RTDB ou índice não retorna exclusão concluída. Mantém estado pendente.
- Reexecução de exclusão incompleta aceita Auth já ausente e não exige CPF no perfil.
- Marcador de conclusão é derivado pelo backend e proibido no payload do cliente.
- Fluxo de exclusão enfileirada mantém reserva até a conclusão efetiva.

## Arquivos alterados

- `leaf-websocket-backend/services/cpf-identity-registry-service.js`
- `leaf-websocket-backend/routes/account-routes.js`
- `leaf-websocket-backend/tests/unit/services/cpf-identity-registry-service.unit.test.js`
- `leaf-websocket-backend/tests/unit/routes/account-routes.unit.test.js`
- Este documento, README e patch de evidência desta rodada.

## Validação e limites

Testes com mocks: 48 testes focados inicialmente; teste adicional de recadastro
passou (14 testes de serviço). Suíte backend completa: 271 suítes / 2.280 testes.
Governança, scanner de segredos rastreados, guard de segredos e diff-check passaram.
A primeira tentativa de Supertest foi bloqueada pelo sandbox ao abrir socket;
a execução local autorizada passou. Nenhum acesso real ao Firebase.

Limites para produção: não existe nesta alteração um cadastro operacional de
exceções por CPF. Sua integração de bloqueio/revisão manual permanece pendente;
este patch implementa a exclusão normal, não a política completa de exceções.
Não houve migração de índices de contas antigas, deploy, mudança financeira,
nova dependência, segredo ou serviço. Limpeza de falhas após remoção de Auth pode
exigir recuperação operacional, pois o usuário pode não conseguir autenticar
novamente; não foi criado job de recuperação. A concorrência entre gravação de
perfil e exclusão em serviços distintos permanece item da revisão de identidade.

## Reversão

`cpf-deletion-policy.patch` contém apenas esta rodada sobre o estado local
anterior, preservando as outras mudanças. Verificação reversa passou com
`git apply --reverse --check docs/validation/rc-20260907/cpf-deletion-policy.patch`.
Para reverter, revisar e aplicar o patch reverso; não usar reset da árvore.
Reverter código não restaura índices já excluídos após um futuro deploy.

## Evidências locais

- `/tmp/leaf-cpf-policy-tests.log` — SHA256 `08dc1499cb751c6f745c0be35ad8b2e88a669b5afbcdb274d5e7cf5fe4ab88c9`
- `/tmp/leaf-cpf-policy-reentry.log` — SHA256 `31509c0915204fe579e28749eefa3d32bb33932c7e017f3357e3bce6e9dd7a7c`
- `/tmp/leaf-cpf-policy-backend.log` — SHA256 `7669cad4d5c3c4254015848fec2b9a639edefffaf44fbef74326424464d30198`
