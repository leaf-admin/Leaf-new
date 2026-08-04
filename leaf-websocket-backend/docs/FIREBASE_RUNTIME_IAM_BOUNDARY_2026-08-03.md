# Limite IAM do runtime Firebase

## Objetivo

Impedir lançamento amplo quando a credencial montada nos gateways e workers
também puder administrar a camada de recuperação. O guard não altera regras do
Firebase, dados, aplicativo, piloto controlado ou comportamento de negócio.

## Contrato versionado

`npm run ops:firebase-runtime-iam-preflight` usa apenas operações
`testIamPermissions` e falha quando a credencial do runtime consegue:

- criar ou apagar agendas de backup do Firestore;
- apagar ou restaurar backups do Firestore;
- atualizar ou apagar o banco Firestore;
- apagar o projeto ou alterar sua política IAM;
- apagar o bucket, alterar sua política IAM ou modificar proteções do bucket.

O runtime continua podendo receber permissões de dados estritamente necessárias,
incluindo leitura/escrita Firestore, Auth, RTDB, FCM e operações de objetos no
bucket da aplicação. A lista exata deve ser validada por canário antes da troca.

O deploy canônico executa o preflight no artefato candidato, com a credencial
real montada somente para leitura, antes de substituir qualquer gateway. Fora de
lançamento amplo a chamada é ignorada, preservando piloto e desenvolvimento. Um
operador pode forçar a auditoria com:

```bash
FIREBASE_RUNTIME_IAM_PREFLIGHT_REQUIRED=true \
  npm run ops:firebase-runtime-iam-preflight
```

O relatório não exibe e-mail da conta de serviço, chave privada ou token OAuth.
Falha de rede, credencial inválida ou API sem resposta bloqueia a comprovação.

## Migração operacional recomendada

1. Criar uma conta de serviço exclusiva para o runtime.
2. Conceder somente permissões de dados comprovadamente usadas pelo backend.
3. Criar uma identidade operacional separada para backup, restore e políticas.
4. Executar o preflight forçado com a credencial candidata.
5. Substituir um gateway em canário e validar Auth, Firestore, RTDB, Storage e FCM.
6. Atualizar os demais gateways e workers somente após os smokes.
7. Remover os papéis amplos e revogar a chave antiga após janela de observação.

Criação de contas, concessão de IAM, geração de segredo, rotação e deploy exigem
mudança de produção aprovada. Este contrato não executa nenhuma dessas ações.

## Rollback

Antes da troca, preservar de forma segura a referência da credencial anterior e
o inventário de papéis. Se o canário falhar, restaurar a montagem anterior apenas
no canário e recriá-lo; não remover PITR, agendas, soft delete ou proteção contra
exclusão. A credencial antiga só pode ser revogada depois da validação integral.
