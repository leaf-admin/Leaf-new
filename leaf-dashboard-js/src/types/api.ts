export interface ApiError {
  error?: string;
  message?: string;
  status?: number;
  payload?: unknown;
}

export interface PaginatedResponse<T> {
  data?: T[];
  page?: number;
  limit?: number;
  total?: number;
}

export interface DriverApplication {
  id: string;
  status: "pending" | "approved" | "rejected" | "analyzing";
  score: number | null;
  driver: {
    id: string;
    name: string;
    email: string;
    phone: string;
  };
}

export interface DriverApplicationsResponse {
  applications: DriverApplication[];
  summary: {
    totalApplications: number;
    pending: number;
    approved: number;
    rejected: number;
    inReview: number;
  };
}

export type UserType = "driver" | "customer";
export type UserStatus =
  | "active"
  | "approved"
  | "pending"
  | "inactive"
  | "blocked"
  | "rejected"
  | "analyzing"
  | "suspended";

export interface User {
  id: string;
  uid?: string;
  name?: string;
  displayName?: string;
  email?: string;
  phone?: string;
  phoneNumber?: string;
  mobile?: string;
  type?: UserType;
  usertype?: string;
  status?: UserStatus;
  city?: string;
  cityCode?: string;
  suspended?: boolean;
  blocked?: boolean;
  isApproved?: boolean;
  approved?: boolean;
  operationalStatus?: string;
  firstName?: string;
  fullName?: string;
  profileSelection?: { userType?: string };
}

export interface UsersResponse {
  users: User[];
}

export interface UserStats {
  period?: {
    newDrivers?: number;
    newCustomers?: number;
  };
  newDriversInPeriod?: number;
  newCustomersInPeriod?: number;
}

export interface RidesStats {
  total?: number;
  completed?: number;
  cancelled?: number;
  active?: number;
}

export interface SubscriptionRevenue {
  totalWeeklyRevenue?: number;
}

export interface RevenueEvolutionRow {
  date: string;
  ridesRevenue: number;
  operationalFee: number;
  subscriptionRevenue: number;
}

export interface OperationalFeeStats {
  totalFeeCents?: number;
  averageFeeCents?: number;
  feeRate?: number;
}

export interface MarketplaceMetrics {
  totalRides?: number;
  totalGMV?: number;
  totalDriverPayout?: number;
  totalFees?: number;
}

export interface DomainHealthEntry {
  id: string;
  label: string;
  status: string;
  action: string;
  source: string;
}

export interface SourceEntry {
  id: string;
  label: string;
  status: string;
  durationMs?: number;
  error?: string;
}

export interface DailyMetrics {
  activeDrivers: number;
  totalDrivers: number;
  activeRides: number;
  completedRidesToday: number;
  gmvCents: number;
  grossRevenueCents: number;
  averageRideTicketCents: number;
  arpuBaseCents: number;
  paymentPendingCount: number;
}

export interface FirestoreReadGuard {
  budgetStatus: "ok" | "warning" | "danger" | "limit";
  dailyEstimatedFirestoreReads: number;
  dailyBudgetReads: number;
  budgetUsagePercent: number;
  dailyEstimatedUsd: number;
  routeKey: string;
  estimatedFirestoreReads: number;
  readPriceUsdPer100k: number;
}

export interface SkuMonitorRow {
  id: string;
  sku: string;
  provider: string;
  detail: string;
  usage: number;
  unitLabel: string;
  unitCostBrl: number;
  totalCostBrl: number;
  projectedTodayCents: number;
}

export interface SkuMonitorFinance {
  operationalFeeAverageCents: number;
  operationalFeeTotalCents: number;
  variableCostWithoutWooviPerRideCents: number;
  costRatioPercent: number;
  netAfterInfraCents: number;
  marginAfterInfraPercent: number;
  projectedCostWithoutWooviTodayCents: number;
  projectedWooviTodayCents: number;
  netAfterAllCents: number;
}

export interface SkuMonitor {
  status: "healthy" | "warning" | "danger";
  sampledRides: number;
  completedRidesToday: number;
  finance: SkuMonitorFinance;
  rows: SkuMonitorRow[];
  notes: string[];
}

export interface RideCostAnomaly {
  status: "danger" | "warning" | "healthy" | "no_data";
  averageBrl: number;
  completedRides: number;
  aboveWarningCount: number;
  aboveCriticalCount: number;
  warningThreshold: number;
  criticalThreshold: number;
  averageGoogleBrl: number;
  directionsPerRide: number;
  directionsWarningPerRide: number;
  directionsCriticalPerRide: number;
  maxBrl: number;
}

export interface CostControls {
  firestoreReadGuard: FirestoreReadGuard;
  externalPaidApisCalled: boolean;
  dashboardFanOutReduced: boolean;
  skuMonitor: SkuMonitor | null;
  rideCostAnomaly: RideCostAnomaly | null;
}

export interface CacheInfo {
  status: string;
  ageSeconds: number;
}

export interface CanaryPackReadiness {
  id: string;
  status: string;
  label: string;
  detail: string;
}

export interface CanaryPackLink {
  href: string;
  label: string;
}

export interface CanaryPack {
  paymentRuntime: {
    defaultEnvironment: string;
    sandboxProfileCount: number;
    canarySandboxEnabled: boolean;
    href: string;
  };
  readiness: CanaryPackReadiness[];
  links: CanaryPackLink[];
  flowSteps: string[];
  successCriteria: string[];
  failureCriteria: string[];
}

export interface ActionItem {
  id: string;
  title: string;
  description: string;
  priority: string;
  href: string;
}

export interface CommandCenterSnapshot {
  status: "healthy" | "warning" | "danger";
  generatedAt: string;
  dailyMetrics: DailyMetrics;
  services: {
    domainHealth: DomainHealthEntry[];
    sources: SourceEntry[];
  };
  costControls: CostControls;
  paymentRuntime: {
    defaultEnvironment: string;
    sandboxProfileCount: number;
    globalSandboxEnabled: boolean;
    canarySandboxEnabled: boolean;
  };
  cache: CacheInfo | null;
  scope: {
    ttlSeconds: number;
  };
  actionItems: ActionItem[];
  canaryPack: CanaryPack | null;
  support: SupportSnapshotSummary;
  campaigns: CampaignsSnapshotSummary;
  driverOnboarding: DriverOnboardingSnapshot;
}

export interface SupportSnapshotSummary {
  totalOpenTickets: number;
  overdueAckCount: number;
  overdueFirstResponseCount: number;
  ticketsWithoutOwner: number;
  backlogByPriority: Record<string, number>;
  medianFirstResponseMinutes: number | null;
}

export interface CampaignsSnapshotSummary {
  active: number;
  impressions: number;
  clicks: number;
  ctr: number;
  campaignValueCents: number;
  effectiveCpmCents: number;
  effectiveCpcCents: number;
}

export interface DriverOnboardingSnapshot {
  pendingDocuments: number;
  approvedDocuments: number;
  rejectedDocuments: number;
  totalDocuments: number;
  reviewQueueSource: string;
}

export interface OpsOverview {
  supportQueue?: {
    criticalBacklogCount?: number;
  };
  disputes?: {
    openCount?: number;
  };
}

export interface OpsAlert {
  severity: string;
  metric: string;
  message: string;
  value: number;
  threshold: number;
}

export interface OpsAlertsResponse {
  alerts: OpsAlert[];
}

export type TicketStatus =
  | "open"
  | "assigned"
  | "in_progress"
  | "escalated"
  | "resolved"
  | "closed"
  | "blocked"
  | "overdue";

export type TicketPriority = "N1" | "N2" | "N3";

export interface TicketUser {
  id?: string;
  name: string;
  email: string;
}

export interface TicketQueue {
  overdueAck: boolean;
  overdueFirstResponse: boolean;
  ageMs: number;
  ageHours: number;
  ackTargetAt: string;
  firstResponseTargetAt: string;
}

export interface TicketMetadata {
  description?: string;
  bookingId?: string;
  incidentId?: string;
}

export interface SupportTicket {
  id: string;
  subject?: string;
  title?: string;
  description?: string;
  status: TicketStatus;
  priority: TicketPriority;
  category: string;
  createdAt: string;
  updatedAt?: string;
  userId?: string;
  user?: TicketUser;
  userType?: string;
  assignedAgent?: string;
  assignedAgentName?: string;
  resolution?: string;
  metadata?: TicketMetadata;
  queue?: TicketQueue;
}

export interface SupportTicketsResponse {
  tickets: SupportTicket[];
  summary?: SupportQueueSummary;
  success?: boolean;
}

export interface SupportQueueSummary {
  totalOpenTickets: number;
  backlogByPriority: Record<string, number>;
  overdueAckCount: number;
  overdueFirstResponseCount: number;
  ticketsWithoutOwner: number;
  criticalBacklogCount: number;
  medianFirstResponseMinutes: number | null;
}

export interface SupportQueueBacklogResponse {
  tickets: SupportTicket[];
}

export interface SupportMessage {
  id: string;
  senderType: "agent" | "user";
  senderId: string;
  message: string;
  read: boolean;
}

export interface SupportMessagesResponse {
  messages: SupportMessage[];
}

export interface ChatMessage {
  message?: string;
}

export interface SupportChat {
  userId: string;
  ticketId: string | null;
  status: string;
  unreadFromUser: number;
  messageCount: number;
  userInfo: {
    name: string;
  };
  userName?: string;
  lastMessage?: ChatMessage;
  lastMessageAt?: string;
  updatedAt?: string;
}

export interface SupportChatInboxResponse {
  chats: SupportChat[];
}

export interface CampaignContent {
  title: string;
  body: string;
  eyebrow?: string;
  cta: {
    label: string;
    action: string;
    url?: string;
    route?: string;
  };
  imageUrl?: string;
  imageAlt?: string;
  displayMode?: string;
  hideTextOverlay?: boolean;
  backgroundColor?: string;
  textColor?: string;
}

export interface CampaignCommercial {
  advertiser: string;
  campaignValueCents: number;
  costModel: string;
  contractedImpressions: number;
  contractedClicks: number;
  soldCpmCents: number;
  soldCpcCents: number;
  invoiceId?: string;
  notes?: string;
}

export interface CampaignMetrics {
  impressions: number;
  clicks: number;
}

export interface Campaign {
  id: string;
  name: string;
  status: string;
  template: string;
  priority: number;
  surfaces: string[];
  placements: string[];
  audience: {
    roles: string[];
  };
  content: CampaignContent;
  rules: {
    autoRotateSeconds: number;
    rotationWeight: number;
    maxImpressionsPerUser: number;
    maxImpressionsPerDay: number;
    dismissCooldownHours: number;
    metadata: {
      slot: string;
      creativeSpec: string;
    };
  };
  commercial: CampaignCommercial;
  startAt: string;
  endAt: string;
  metrics: CampaignMetrics;
  createdAt?: string;
  updatedAt?: string;
}

export interface CampaignListResponse {
  campaigns: Campaign[];
  stats: {
    total: number;
    active: number;
    impressions: number;
    clicks: number;
  };
}

export interface CommercialReportRow {
  id: string;
  name: string;
  advertiser: string;
  costModel: string;
  startAt: string;
  endAt: string;
  remainingDays: number;
  campaignValueCents: number;
  impressions: number;
  contractedImpressions: number;
  clicks: number;
  contractedClicks: number;
  ctr: number;
  effectiveCpmCents: number;
  soldCpmCents: number;
  effectiveCpcCents: number;
  soldCpcCents: number;
  deliveryProgress: number;
  pacing: number;
}

export interface CommercialReportTotals {
  campaignValueCents: number;
  ctr: number;
  effectiveCpmCents: number;
  effectiveCpcCents: number;
}

export interface CommercialReport {
  totals: CommercialReportTotals;
  rows: CommercialReportRow[];
}

export interface CommercialReportResponse {
  report: CommercialReport;
}

export interface SlotDimensions {
  heightDp: number;
  referenceFramePx: { width: number; height: number };
  exportPx: { "@3x": { width: number; height: number } };
}

export interface Slot {
  id: string;
  label: string;
  surface: string;
  placement: string;
  role: string;
  template: string;
  maxItems: number;
  autoRotateSeconds: number;
  dimensions: SlotDimensions;
}

export interface SlotListResponse {
  slots: Slot[];
}

export type ReconciliationStatus = "divergent" | "ok";
export type IssueSeverity = "critical" | "high" | "medium" | "low" | "info";

export interface ReconciliationIssue {
  code: string;
  severity: IssueSeverity;
  message?: string;
}

export interface ReconciliationReportSummary {
  totalIssueCount: number;
  divergentInPage: number;
  okInPage: number;
  totalInPage: number;
}

export interface ReconciliationReport {
  id: string;
  rideId: string;
  status: ReconciliationStatus;
  severity: IssueSeverity;
  testData: boolean;
  issues: ReconciliationIssue[];
  checkedAtIso: string;
  checkedAt?: string;
  totals: {
    paymentAmountCents: number;
    distributionTotalCents: number;
    ledgerEventCount: number;
  };
}

export interface ReconciliationReportsResponse {
  reports: ReconciliationReport[];
  summary: ReconciliationReportSummary;
}

export interface ReconciliationRideDetail {
  report: ReconciliationReport;
  ledgerEvents: unknown[];
  sourceDocuments: Record<string, unknown>;
}

export interface ReconciliationRunResult {
  success: boolean;
  scannedRideCount: number;
  reconciledRideCount: number;
  divergentRideCount: number;
  failedRideCount: number;
  skippedTestRideCount: number;
  summary?: {
    scannedRideCount: number;
    reconciledRideCount: number;
    divergentRideCount: number;
    failedRideCount: number;
    skippedTestRideCount: number;
  };
}

export interface SimulationReport {
  totalRequests: number;
  completed: number;
  canceledByPassenger: number;
  rejectedByDriver: number;
  grossVolume: number;
  totalDriverPayout: number;
  totalWooviFees: number;
  leafNetRevenue: number;
}

export interface SystemStatusEntry {
  service: string;
  status: string;
}

export type MonitoringHealthStatus = "healthy" | "degraded" | "unhealthy";

export interface MonitoringHealth {
  status: MonitoringHealthStatus;
  checks: {
    redis: { status: string };
    firebase: { status: string };
    websocket: { status: string };
    system: { status: string };
  };
}

export interface WorkerHealth {
  status: "healthy" | "unhealthy";
  reason?: string;
  consumers: { count: number };
  pendingEvents?: number;
}

export interface WorkerLag {
  queue?: string;
  lag?: number;
}

export interface WorkerDLQ {
  queue?: string;
  size?: number;
}

export interface WorkerDLQEvent {
  id: string;
  originalEventId: string;
  eventType: string;
  error: string;
  failedAt: string;
  ageSeconds: number;
  retries: number;
  context: Record<string, unknown>;
}

export interface WorkerDLQEventsResponse {
  events: WorkerDLQEvent[];
  dlqSize?: number;
  limit?: number;
}

export interface RuntimeFlags {
  success: boolean;
  launch: {
    launchProfile: string;
    pilotControlled: boolean;
    adminMutationsEnabled: boolean;
    referralProgramsEnabled: boolean;
    campaignCenterEnabled: boolean;
    leafDelasEnabled: boolean;
    driverDestinationModeEnabled: boolean;
    dynamicPricingEnabled: boolean;
    smartPushEnabled: boolean;
  };
  realSandbox: {
    ready: boolean;
    blockers: string[];
  };
}

export interface ObservabilityMetrics {
  timestamp: string;
  commands: {
    byCommand: Record<string, { total: number; failures: number }>;
    total: number;
    failures: number;
  };
  critical?: {
    createBooking?: { errors: number; errorRatePct: number; topErrors: Array<{ error: string; count: number }> };
    requestRideCommand?: { failures: number; failureRatePct: number };
    socketAdmission?: { busyTimeout: number };
  };
  redis?: {
    operations: { total: number; errors: number; errorRate: number };
    latency: { p95: number };
  };
  eventLoopLag?: { p95Ms: number };
  rides?: {
    requested: number;
    accepted: number;
    completed: number;
    timeToAcceptAvgSec: number;
  };
  hotpath?: {
    total: number;
    avgLatencyMs: number;
  };
  otel?: {
    ingest: { totalRequests: number; errors: number };
  };
}

export interface ReferralProgramSummary {
  totalReferrals?: number;
  activeReferrers?: number;
  totalRewards?: number;
}

export interface ReferralCampaign {
  id: string;
  name: string;
  status: string;
  startedAt?: string;
  endsAt?: string;
}

export interface PaymentRuntimeProfile {
  id: string;
  name: string;
  environment: string;
  active: boolean;
}

export interface AuditLogEntry {
  id: string;
  action: string;
  actor: string;
  target: string;
  timestamp: string;
  details?: Record<string, unknown>;
}

export interface Notification {
  id: string;
  title?: string;
  body?: string;
  type?: string;
  read?: boolean;
  createdAt?: string;
}

export interface DriverDocument {
  type: string;
  status: string;
  url?: string;
  reviewedAt?: string;
  rejectionReason?: string;
}

export interface DriverComplete {
  driver: DriverApplication["driver"];
  documents?: DriverDocument[];
  vehicle?: Record<string, unknown>;
  subscription?: Record<string, unknown>;
}

export interface Promotion {
  id: string;
  name: string;
  status: string;
  discountType?: string;
  discountValue?: number;
  startsAt?: string;
  endsAt?: string;
}

export interface WaitlistEntry {
  id: string;
  driverId?: string;
  name?: string;
  email?: string;
  phone?: string;
  status: string;
  city?: string;
  position?: number;
  createdAt?: string;
}

export interface LandingWaitlistEntry {
  id: string;
  name?: string;
  email?: string;
  phone?: string;
  status: string;
  createdAt?: string;
}

export interface GeofenceConfig {
  enabled?: boolean;
  cities?: Record<string, Record<string, { active: boolean }>>;
  states?: Record<string, { enabled: boolean }>;
}

export interface RecentActivity {
  id: string;
  type: string;
  description: string;
  timestamp: string;
}

export interface MetricsOverview {
  totalDrivers?: number;
  totalUsers?: number;
  totalRides?: number;
  totalRevenue?: number;
}
