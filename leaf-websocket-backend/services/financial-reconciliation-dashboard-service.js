const firebaseConfig = require('../firebase-config');
const { logError } = require('../utils/logger');

class FinancialReconciliationDashboardService {
  normalizeLimit(value, fallback = 50, max = 100) {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
    return Math.min(parsed, max);
  }

  normalizeBoolean(value) {
    return ['true', '1', 'yes', 'sim'].includes(String(value || '').toLowerCase());
  }

  isTestRideId(rideId) {
    return /(^|_)ride_e2e_|^ride_normal_|dispatch_smoke|_smoke$|(^|_)test(_|$)|(^|_)mock(_|$)/i.test(String(rideId || ''));
  }

  getSnapshotDocs(snapshot) {
    if (!snapshot) return [];
    if (Array.isArray(snapshot.docs)) {
      return snapshot.docs.map((doc) => ({
        id: doc.id,
        data: typeof doc.data === 'function' ? doc.data() : {}
      }));
    }

    const docs = [];
    if (typeof snapshot.forEach === 'function') {
      snapshot.forEach((doc) => {
        docs.push({
          id: doc.id,
          data: typeof doc.data === 'function' ? doc.data() : {}
        });
      });
    }
    return docs;
  }

  resolveLedgerRideIds({ rideId, payment = null, holding = null } = {}) {
    const rideIds = new Set();
    const addRideId = (value) => {
      const normalized = String(value || '').trim();
      if (normalized) rideIds.add(normalized);
    };
    const addDocumentReferences = (document) => {
      if (!document || typeof document !== 'object') return;
      addRideId(document.rideId);
      addRideId(document.canonicalRideId);
      addRideId(document.paymentReferenceRideId);
      addRideId(document.temporaryRideId);
      addRideId(document.materializedFrom);

      const additionalInfo = Array.isArray(document.metadata?.additionalInfo)
        ? document.metadata.additionalInfo
        : [];
      additionalInfo.forEach((item) => {
        if (String(item?.key || '').trim().toLowerCase() === 'ride_id') {
          addRideId(item?.value);
        }
      });
    };

    addRideId(rideId);
    addDocumentReferences(payment);
    addDocumentReferences(holding);
    return Array.from(rideIds);
  }

  async listLedgerEventsByRideIds(firestore, rideIds = []) {
    const snapshots = await Promise.all(
      rideIds.map((currentRideId) => firestore
        .collection('financial_ledger_events')
        .where('rideId', '==', currentRideId)
        .limit(100)
        .get())
    );
    const eventsById = new Map();
    snapshots.forEach((snapshot) => {
      this.getSnapshotDocs(snapshot).forEach((doc) => {
        if (!eventsById.has(doc.id)) {
          eventsById.set(doc.id, { id: doc.id, ...doc.data });
        }
      });
    });
    return Array.from(eventsById.values())
      .sort((a, b) => String(a.createdAtIso || '').localeCompare(String(b.createdAtIso || '')));
  }

  normalizeReport(id, data = {}) {
    const issues = Array.isArray(data.issues) ? data.issues : [];
    const rideId = data.rideId || id;
    return {
      id,
      rideId,
      ok: Boolean(data.ok),
      status: data.ok ? 'ok' : 'divergent',
      testData: Boolean(data.testData) || this.isTestRideId(rideId),
      severity: this.resolveHighestSeverity(issues),
      issueCodes: issues.map((issue) => issue.code).filter(Boolean),
      issues,
      totals: data.totals || {},
      checkedAt: data.checkedAt || null,
      checkedAtIso: data.checkedAtIso || null
    };
  }

  resolveHighestSeverity(issues = []) {
    const order = ['critical', 'high', 'medium', 'low', 'info'];
    const severities = issues.map((issue) => String(issue.severity || 'info').toLowerCase());
    return order.find((severity) => severities.includes(severity)) || 'info';
  }

  reportMatchesFilters(report, filters = {}) {
    const status = String(filters.status || 'divergent').toLowerCase();
    const severity = filters.severity ? String(filters.severity).toLowerCase() : null;
    const code = filters.code ? String(filters.code).toUpperCase() : null;
    const rideId = filters.rideId ? String(filters.rideId) : null;
    const includeTestData = this.normalizeBoolean(filters.includeTestData);

    if (rideId && report.rideId !== rideId) return false;
    if (!includeTestData && report.testData) return false;
    if (status === 'ok' && !report.ok) return false;
    if (status === 'divergent' && report.ok) return false;
    if (severity && report.severity !== severity) return false;
    if (code && !report.issueCodes.includes(code)) return false;

    return true;
  }

  summarizeReports(reports = []) {
    return reports.reduce((summary, report) => {
      summary.totalInPage += 1;
      if (report.ok) {
        summary.okInPage += 1;
      } else {
        summary.divergentInPage += 1;
      }

      report.issues.forEach((issue) => {
        const code = issue.code || 'UNKNOWN';
        const severity = issue.severity || 'info';
        summary.totalIssueCount += 1;
        summary.byCode[code] = (summary.byCode[code] || 0) + 1;
        summary.bySeverity[severity] = (summary.bySeverity[severity] || 0) + 1;
      });

      return summary;
    }, {
      totalInPage: 0,
      okInPage: 0,
      divergentInPage: 0,
      totalIssueCount: 0,
      byCode: {},
      bySeverity: {}
    });
  }

  async listReports(filters = {}) {
    const firestore = firebaseConfig.getFirestore();
    if (!firestore) {
      return {
        success: false,
        error: 'Firestore nao disponivel para relatorios financeiros'
      };
    }

    const limit = this.normalizeLimit(filters.limit, 50, 100);

    try {
      let reports = [];

      if (filters.rideId) {
        const doc = await firestore
          .collection('financial_reconciliation_reports')
          .doc(String(filters.rideId))
          .get();
        if (doc.exists) {
          reports = [this.normalizeReport(doc.id, doc.data())];
        }
      } else {
        let query = firestore.collection('financial_reconciliation_reports');
        if (typeof query.orderBy === 'function') {
          query = query.orderBy('checkedAtIso', 'desc');
          if (filters.cursor && typeof query.startAfter === 'function') {
            query = query.startAfter(String(filters.cursor));
          }
        }
        if (typeof query.limit === 'function') {
          query = query.limit(Math.min(limit * 5, 500));
        }

        const snapshot = await query.get();
        reports = this.getSnapshotDocs(snapshot)
          .map((doc) => this.normalizeReport(doc.id, doc.data))
          .sort((a, b) => String(b.checkedAtIso || '').localeCompare(String(a.checkedAtIso || '')));
      }

      const filtered = reports
        .filter((report) => this.reportMatchesFilters(report, filters))
        .slice(0, limit);
      const lastReport = filtered[filtered.length - 1] || null;

      return {
        success: true,
        reports: filtered,
        page: {
          limit,
          nextCursor: lastReport?.checkedAtIso || null
        },
        summary: this.summarizeReports(filtered)
      };
    } catch (error) {
      logError(error, 'Erro ao listar relatorios de reconciliacao financeira', {
        service: 'financial-reconciliation-dashboard-service',
        filters
      });
      return {
        success: false,
        error: error.message
      };
    }
  }

  async getRideDetail(rideId) {
    const firestore = firebaseConfig.getFirestore();
    if (!firestore || !rideId) {
      return {
        success: false,
        error: !rideId ? 'rideId e obrigatorio' : 'Firestore nao disponivel'
      };
    }

    try {
      const [reportDoc, paymentDoc, holdingDoc, distributionDoc] = await Promise.all([
        firestore.collection('financial_reconciliation_reports').doc(rideId).get(),
        firestore.collection('ride_payments').doc(rideId).get(),
        firestore.collection('payment_holdings').doc(rideId).get(),
        firestore.collection('payment_distributions').doc(rideId).get()
      ]);
      const payment = paymentDoc.exists ? paymentDoc.data() : null;
      const holding = holdingDoc.exists ? holdingDoc.data() : null;
      const ledgerRideIds = this.resolveLedgerRideIds({ rideId, payment, holding });
      const ledgerEvents = await this.listLedgerEventsByRideIds(firestore, ledgerRideIds);

      return {
        success: true,
        report: reportDoc.exists ? this.normalizeReport(reportDoc.id, reportDoc.data()) : null,
        ledgerEvents,
        ledgerRideIds,
        sourceDocuments: {
          ridePayment: payment,
          paymentHolding: holding,
          paymentDistribution: distributionDoc.exists ? distributionDoc.data() : null
        }
      };
    } catch (error) {
      logError(error, 'Erro ao buscar detalhe financeiro da corrida', {
        service: 'financial-reconciliation-dashboard-service',
        rideId
      });
      return {
        success: false,
        error: error.message,
        rideId
      };
    }
  }
}

module.exports = new FinancialReconciliationDashboardService();
module.exports.FinancialReconciliationDashboardService = FinancialReconciliationDashboardService;
