// Rotas do painel administrativo. O código fica em routes/dashboard/: shared.js com
// dependências e helpers, e um arquivo por grupo de rotas. A ordem dos require abaixo
// é a ordem de registro no Express e precisa ser mantida (há caminhos que se sobrepõem).
const { router, hardenDashboardApiRoutes } = require('./dashboard/shared');

require('./dashboard/01-users-and-driver-applications');
require('./dashboard/02-financial-audit-metrics');
require('./dashboard/03-overview-stats');
require('./dashboard/04-support-map-reports');
require('./dashboard/05-subscriptions-and-legacy-promotions');
require('./dashboard/06-costs-monitoring-growth');
require('./dashboard/07-promotions');
require('./dashboard/08-driver-plans-and-status');

hardenDashboardApiRoutes();

module.exports = router;
