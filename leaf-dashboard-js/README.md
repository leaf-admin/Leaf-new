# Leaf Dashboard

Backoffice operacional da Leaf para producao assistida.

## Superficies principais

- `/dashboard`: cockpit diario com command center, custos e status dos servicos.
- `/support`: inbox de chat/chamados e fluxo N0/N1/N2/N3.
- `/campaign-center`: campanhas in-app, metricas e relatorios comerciais.
- `/drivers/review-queue`: fila de cadastro/KYC/documentos de motoristas.
- `/financial-reconciliation`: reconciliacao financeira, ledger e divergencias.
- `/runtime-flags`: perfil efetivo de runtime, pagamento, KYC, maps, push e flags.

## Ambiente local

Use o proxy interno do Next para consumir a API Leaf. O browser nao deve chamar Google,
Woovi/OpenPix, Firebase ou outro provedor pago diretamente.

`.env.local` recomendado:

```bash
NEXT_PUBLIC_API_URL=/api
LEAF_DASHBOARD_API_PROXY_TARGET=https://api.leaf.app.br/api
NEXT_PUBLIC_WS_URL=https://socket.leaf.app.br
NEXT_PUBLIC_API_DOCS_URL=https://api.leaf.app.br/api/docs
DASHBOARD_BASIC_AUTH_ENABLED=true
DASHBOARD_BASIC_AUTH_USER=leaflocal
DASHBOARD_BASIC_AUTH_PASSWORD=<local-password>
```

Subir local:

```bash
npm --prefix leaf-dashboard-js run dev -- --hostname 127.0.0.1 --port 3014
```

## Validacao obrigatoria

```bash
npm --prefix leaf-dashboard-js run qa:backoffice
```

Esse comando executa:

- lint;
- build Next;
- smoke das paginas operacionais;
- verificacao de basic auth;
- verificacao de navegacao entre areas;
- bloqueio de chamadas diretas do browser para Google, Woovi/OpenPix e Firebase.

## Regras de custo

- Dashboard consome apenas APIs Leaf.
- Dados caros devem vir agregados do backend, especialmente `/api/ops/command-center`.
- Refresh visual deve ser controlado e cacheado no backend.
- Qualquer nova tela que precise de dados operacionais deve preferir endpoint agregado.

## Regras de seguranca

- Basic auth protege ambiente local/exposto antes do login admin.
- A sessao admin usa `/api/admin/auth/login` e token Bearer.
- Acoes sensiveis precisam de RBAC no backend; validacao apenas no frontend nao basta.
