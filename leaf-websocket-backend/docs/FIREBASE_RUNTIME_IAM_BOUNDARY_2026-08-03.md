# Limite IAM do runtime Firebase

## Objetivo

Impedir lançamento amplo quando a credencial montada nos gateways e workers
também puder administrar a camada de recuperação. O guard não altera regras do
Firebase, dados, aplicativo, piloto controlado ou comportamento de negócio.

## Contrato versionado

`npm run ops:firebase-runtime-iam-preflight` usa apenas operações
`testIamPermissions` e falha tanto por privilégio destrutivo quanto pela ausência
de uma permissão mínima necessária ao runtime.

Permissões proibidas:

- criar ou apagar agendas de backup do Firestore;
- apagar ou restaurar backups do Firestore;
- atualizar ou apagar o banco Firestore;
- desabilitar, apagar ou reconfigurar a instância do Realtime Database;
- apagar o projeto ou alterar sua política IAM;
- apagar o bucket, alterar sua política IAM ou modificar proteções do bucket;
- restaurar objetos apagados ou alterar ACL/retenção de objetos.

Permissões obrigatórias do data plane:

- Firestore: obter o banco, alocar IDs e criar, ler, listar, atualizar e apagar entidades;
- Auth: criar, obter, atualizar e apagar usuários;
- RTDB: obter e listar a instância;
- FCM: enviar mensagens;
- Storage: criar, obter, listar, atualizar e apagar objetos;
- metadados mínimos de projeto e cliente Firebase usados pelos SDKs.

As listas canônicas ficam em `REQUIRED_PROJECT_PERMISSIONS` e
`REQUIRED_BUCKET_PERMISSIONS` no próprio preflight. Exclusão normal de objetos
continua permitida para os fluxos de documentos e conta; soft delete permanece
como recuperação independente.

Os papéis predefinidos `roles/firebaseauth.admin`,
`roles/firebasedatabase.admin`, `roles/storage.objectUser` e
`roles/storage.objectAdmin` não são o alvo final: eles misturam o data plane com
configuração, destruição de instância, restauração ou retenção. A identidade de
runtime deve usar um papel customizado com o conjunto obrigatório versionado.

O RTDB não expõe permissões IAM granulares para leitura/escrita dos caminhos da
aplicação. Por isso, `instances.get/list` comprovam somente descoberta da
instância; o canário funcional deve validar leitura, escrita e limpeza em um
caminho isolado antes da troca.

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
5. Substituir um gateway em canário e validar:
   - verificação de ID token e criação/consulta de usuário de teste;
   - criação, leitura, atualização e limpeza de documento Firestore isolado;
   - criação, leitura, atualização e limpeza de nó RTDB isolado;
   - upload, leitura, atualização de metadados e limpeza de objeto isolado;
   - envio FCM para token de teste controlado;
   - emissão de custom token nos fluxos OTP e senha.
6. Atualizar os demais gateways e workers somente após os smokes.
7. Remover os papéis amplos e revogar a chave antiga após janela de observação.

A credencial JSON atual contém chave privada e o Admin SDK assina custom tokens
localmente. Uma migração futura para identidade sem chave exige conceder
`iam.serviceAccounts.signBlob` somente sobre a própria conta de runtime e ampliar
o preflight para esse recurso antes da mudança.

Criação de contas, concessão de IAM, geração de segredo, rotação e deploy exigem
mudança de produção aprovada. Este contrato não executa nenhuma dessas ações.

## Rollback

Antes da troca, preservar de forma segura a referência da credencial anterior e
o inventário de papéis. Se o canário falhar, restaurar a montagem anterior apenas
no canário e recriá-lo; não remover PITR, agendas, soft delete ou proteção contra
exclusão. A credencial antiga só pode ser revogada depois da validação integral.
