# Migracao Legado -> Atual (Leaf Dashboard JS)

## Escopo
- Origem legada: `leaf-dashboard/src/pages/*`
- Destino atual: `leaf-dashboard-js/app/*` + `leaf-dashboard-js/src/*`

## Status de Base (concluido)
- [x] Auth JWT (`src/services/auth-service.js`)
- [x] API client (`src/services/api.js`)
- [x] WebSocket client (`src/services/websocket-service.js`)
- [x] Auth context (`src/contexts/AuthContext.js`)
- [x] Guard de rota (`src/components/ProtectedRoute.js`)
- [x] Rotas iniciais: `/`, `/login`, `/dashboard`

## Matriz de Migracao de Paginas
- [x] `index.js` -> `app/page.js`
- [x] `login.js` -> `app/login/page.js`
- [x] `dashboard.js` -> `app/dashboard/page.js` (KPIs operacionais, periodo, evolucao e atividade recente)
- [x] `metrics.js` (KPIs e painéis migrados com visual de distribuicao)
- [x] `metrics-history.js` (filtros, KPIs e serie temporal operacional)
- [x] `observability.js` (KPIs, barras por tipo, payload tecnico e links operacionais)
- [x] `drivers.js` (listagem/filtros + ações aprovar/rejeitar + navegação de documentos)
- [~] `driver-documents.js` (visualização + revisão por documento migradas; UX ainda simplificada)
- [x] `users.js` (listagem/filtros + resumo + navegação para detalhes/documentos)
- [~] `user-details.js` (detalhes base migrados; abas avançadas ainda reduzidas)
- [~] `waitlist.js` (lista/filtro/paginação base migrados)
- [x] `maps.js` (KPIs/tabela + Google Maps com cluster e heatmap)
- [x] `notifications.js` (KPIs, taxa de sucesso, endpoints e payload)
- [~] `support.js` (tickets + mensagens + websocket + modo chat migrados; CRM avançado pendente)
- [x] `reports.js` (listagem e geração PDF/Excel migradas)
- [x] `financial-simulator.js` (simulação funcional com KPIs e resumo financeiro)

## Regras
- Nao adicionar nova funcionalidade no `leaf-dashboard` (apenas referencia).
- Toda feature nova deve nascer no `leaf-dashboard-js`.
- Ao concluir 100% da matriz, iniciar plano de descomissionamento do legado.
