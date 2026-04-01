import { lazy, Suspense, useEffect, useState, useCallback, useRef, type DragEvent, type MouseEvent as ReactMouseEvent } from 'react';
import { Link } from 'react-router-dom';
import { dashboardApi, fetchRunApi, type DashboardAnalyticsFilter, type DashboardStats } from '../lib/api';
import { useToast } from '../hooks/useToast';
import { formatBytes, formatCurrency, formatDateTime, relativeTime } from '../lib/utils';
import {
  FileText,
  Car,
  HardDrive,
  DollarSign,
  Play,
  Clock,
  CheckCircle,
  XCircle,
  AlertTriangle,
  Loader2,
  ArrowRight,
  MapPinned,
  ChevronDown,
  ChevronUp,
  RotateCcw,
} from 'lucide-react';

const DashboardAnalyticsCharts = lazy(() => import('../components/dashboard/DashboardAnalyticsCharts').then((module) => ({ default: module.DashboardAnalyticsCharts })));

type DashboardWidgetId = 'stats' | 'readiness' | 'health' | 'analytics' | 'breakdown' | 'recent-runs';
type DashboardWidgetSize = 'compact' | 'standard' | 'wide';

const DASHBOARD_LAYOUT_KEY = 'tesla-invoice-fetcher.dashboard-layout.v2';
const DASHBOARD_SIZE_KEY = 'tesla-invoice-fetcher.dashboard-size.v2';
const DEFAULT_WIDGET_ORDER: DashboardWidgetId[] = ['stats', 'recent-runs', 'analytics', 'breakdown', 'readiness', 'health'];
const DEFAULT_WIDGET_SIZES: Record<DashboardWidgetId, DashboardWidgetSize> = {
  stats: 'standard',
  readiness: 'compact',
  health: 'compact',
  analytics: 'wide',
  breakdown: 'compact',
  'recent-runs': 'compact',
};

const WIDGET_SIZE_OPTIONS: Record<DashboardWidgetId, DashboardWidgetSize[]> = {
  stats: ['standard', 'wide'],
  readiness: ['compact', 'standard', 'wide'],
  health: ['compact', 'standard'],
  analytics: ['standard', 'wide'],
  breakdown: ['compact', 'standard'],
  'recent-runs': ['compact', 'standard', 'wide'],
};

function readDashboardLayout(): DashboardWidgetId[] {
  if (typeof window === 'undefined') {
    return DEFAULT_WIDGET_ORDER;
  }

  try {
    const raw = window.localStorage.getItem(DASHBOARD_LAYOUT_KEY);
    if (!raw) {
      return DEFAULT_WIDGET_ORDER;
    }

    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return DEFAULT_WIDGET_ORDER;
    }

    const valid = parsed.filter((value): value is DashboardWidgetId => DEFAULT_WIDGET_ORDER.includes(value));
    const missing = DEFAULT_WIDGET_ORDER.filter((value) => !valid.includes(value));
    return [...valid, ...missing];
  } catch {
    return DEFAULT_WIDGET_ORDER;
  }
}

function readDashboardWidgetSizes(): Record<DashboardWidgetId, DashboardWidgetSize> {
  if (typeof window === 'undefined') {
    return DEFAULT_WIDGET_SIZES;
  }

  try {
    const raw = window.localStorage.getItem(DASHBOARD_SIZE_KEY);
    if (!raw) {
      return DEFAULT_WIDGET_SIZES;
    }

    const parsed = JSON.parse(raw);
    const nextSizes = { ...DEFAULT_WIDGET_SIZES };

    for (const widgetId of DEFAULT_WIDGET_ORDER) {
      const candidate = parsed?.[widgetId];
      if (WIDGET_SIZE_OPTIONS[widgetId].includes(candidate)) {
        nextSizes[widgetId] = candidate;
      }
    }

    return nextSizes;
  } catch {
    return DEFAULT_WIDGET_SIZES;
  }
}

export function DashboardPage() {
  const resizeStateRef = useRef<{
    widgetId: DashboardWidgetId;
    startX: number;
    startIndex: number;
  } | null>(null);
  const { toast } = useToast();
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [setupExpanded, setSetupExpanded] = useState<boolean | null>(null);
  const [healthExpanded, setHealthExpanded] = useState<boolean | null>(null);
  const [widgetOrder, setWidgetOrder] = useState<DashboardWidgetId[]>(() => readDashboardLayout());
  const [widgetSizes, setWidgetSizes] = useState<Record<DashboardWidgetId, DashboardWidgetSize>>(() => readDashboardWidgetSizes());
  const [draggedWidget, setDraggedWidget] = useState<DashboardWidgetId | null>(null);
  const [analyticsFilter, setAnalyticsFilter] = useState<DashboardAnalyticsFilter>({ groupBy: 'month' });
  const [analyticsData, setAnalyticsData] = useState<{
    points: Array<{
      period: string;
      totalAmountCents: number;
      totalEnergyKwh: number;
      invoiceCount: number;
      superchargerAmountCents: number;
      subscriptionAmountCents: number;
      serviceAmountCents: number;
    }>;
    availableVins: string[];
    availableVehicles: Array<{
      vin: string;
      name: string | null;
    }>;
  }>({ points: [], availableVins: [], availableVehicles: [] });
  const [loading, setLoading] = useState(true);
  const [fetching, setFetching] = useState(false);
  const [analyticsLoading, setAnalyticsLoading] = useState(true);

  const loadStats = useCallback(async () => {
    try {
      const data = await dashboardApi.stats();
      setStats(data);
    } catch {
      toast({ title: 'Failed to load dashboard', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  const loadAnalytics = useCallback(async () => {
    setAnalyticsLoading(true);
    try {
      const data = await dashboardApi.analytics(analyticsFilter);
      const grouped = new Map<string, {
        period: string;
        totalAmountCents: number;
        totalEnergyKwh: number;
        invoiceCount: number;
        superchargerAmountCents: number;
        subscriptionAmountCents: number;
        serviceAmountCents: number;
      }>();

      for (const point of data.points) {
        const current = grouped.get(point.period) ?? {
          period: point.period,
          totalAmountCents: 0,
          totalEnergyKwh: 0,
          invoiceCount: 0,
          superchargerAmountCents: 0,
          subscriptionAmountCents: 0,
          serviceAmountCents: 0,
        };

        current.totalAmountCents += point.amount_cents;
        current.totalEnergyKwh += point.energy_kwh;
        current.invoiceCount += point.invoice_count;

        if (point.invoice_type === 'supercharger') current.superchargerAmountCents += point.amount_cents;
        if (point.invoice_type === 'subscription') current.subscriptionAmountCents += point.amount_cents;
        if (point.invoice_type === 'service') current.serviceAmountCents += point.amount_cents;

        grouped.set(point.period, current);
      }

      setAnalyticsData({
        points: Array.from(grouped.values()),
        availableVins: data.availableVins,
        availableVehicles: data.availableVehicles,
      });
    } catch {
      toast({ title: 'Failed to load analytics', variant: 'destructive' });
    } finally {
      setAnalyticsLoading(false);
    }
  }, [analyticsFilter, toast]);

  useEffect(() => {
    loadStats();
  }, [loadStats]);

  useEffect(() => {
    loadAnalytics();
  }, [loadAnalytics]);

  useEffect(() => {
    window.localStorage.setItem(DASHBOARD_LAYOUT_KEY, JSON.stringify(widgetOrder));
  }, [widgetOrder]);

  useEffect(() => {
    window.localStorage.setItem(DASHBOARD_SIZE_KEY, JSON.stringify(widgetSizes));
  }, [widgetSizes]);

  const handleResizeMove = useCallback((event: MouseEvent) => {
    const resizeState = resizeStateRef.current;
    if (!resizeState) {
      return;
    }

    const options = WIDGET_SIZE_OPTIONS[resizeState.widgetId];
    const delta = event.clientX - resizeState.startX;
    const stepOffset = Math.round(delta / 160);
    const nextIndex = Math.max(0, Math.min(options.length - 1, resizeState.startIndex + stepOffset));
    const nextSize = options[nextIndex];

    setWidgetSizes((currentSizes) => {
      if (currentSizes[resizeState.widgetId] === nextSize) {
        return currentSizes;
      }

      return {
        ...currentSizes,
        [resizeState.widgetId]: nextSize,
      };
    });
  }, []);

  const stopResizeTracking = useCallback(() => {
    resizeStateRef.current = null;
    window.removeEventListener('mousemove', handleResizeMove);
    window.removeEventListener('mouseup', stopResizeTracking);
  }, [handleResizeMove]);

  useEffect(() => stopResizeTracking, [stopResizeTracking]);

  const handleFetch = async (dryRun: boolean) => {
    setFetching(true);
    try {
      const result = await fetchRunApi.trigger(dryRun);
      toast({
        title: dryRun ? 'Dry run started' : 'Fetch started',
        description: `Run #${result.id}`,
        variant: 'success',
      });
      // Refresh stats after a delay
      setTimeout(loadStats, 3000);
    } catch (err) {
      toast({
        title: 'Failed to start fetch',
        description: err instanceof Error ? err.message : 'Unknown error',
        variant: 'destructive',
      });
    } finally {
      setFetching(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!stats) return null;

  const statCards = [
    {
      label: 'Total Invoices',
      value: stats.totalInvoices,
      icon: FileText,
      color: 'text-primary',
    },
    {
      label: 'Vehicles',
      value: stats.vehicleCount,
      icon: Car,
      color: 'text-success',
    },
    {
      label: 'Total Amount',
      value: formatCurrency(stats.totalAmountCents),
      icon: DollarSign,
      color: 'text-warning',
    },
    {
      label: 'Storage Used',
      value: formatBytes(stats.storageUsedBytes),
      icon: HardDrive,
      color: 'text-muted-foreground',
    },
  ];

  const statusIcon = (status: string) => {
    switch (status) {
      case 'success':
        return <CheckCircle className="h-4 w-4 text-success" />;
      case 'failed':
        return <XCircle className="h-4 w-4 text-destructive" />;
      case 'partial':
        return <AlertTriangle className="h-4 w-4 text-warning" />;
      case 'running':
        return <Loader2 className="h-4 w-4 text-primary animate-spin" />;
      default:
        return <Clock className="h-4 w-4 text-muted-foreground" />;
    }
  };

  const activeRegionHealth = [
    {
      label: 'Fleet API',
      state: stats.tokenHealth.fleet,
      description: 'Supercharger invoice access',
    },
    {
      label: 'Ownership API',
      state: stats.tokenHealth.ownership,
      description: 'Premium Connectivity invoices',
    },
  ];

  const setupComplete = stats.setup.requiredComplete === stats.setup.requiredTotal;
  const allTokensHealthy = activeRegionHealth.every((token) => token.state.hasToken && !token.state.isExpired);

  const resolvedSetupExpanded = setupExpanded ?? !setupComplete;
  const resolvedHealthExpanded = healthExpanded ?? !allTokensHealthy;

  const vehicleLabel = (vehicle: { vin: string; name: string | null }) => vehicle.name?.trim() || vehicle.vin;

  const selectedVehicleName = analyticsData.availableVehicles.find((vehicle) => vehicle.vin === analyticsFilter.vin)?.name?.trim();

  const updateAnalyticsFilter = <K extends keyof DashboardAnalyticsFilter>(key: K, value: DashboardAnalyticsFilter[K]) => {
    setAnalyticsFilter((currentFilter) => ({ ...currentFilter, [key]: value }));
  };

  const handleDragStart = (event: DragEvent<HTMLButtonElement>, widgetId: DashboardWidgetId) => {
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', widgetId);
    setDraggedWidget(widgetId);
  };

  const moveWidget = (fromId: DashboardWidgetId, toId: DashboardWidgetId) => {
    if (fromId === toId) {
      return;
    }

    setWidgetOrder((currentOrder) => {
      const nextOrder = [...currentOrder];
      const fromIndex = nextOrder.indexOf(fromId);
      const toIndex = nextOrder.indexOf(toId);

      if (fromIndex === -1 || toIndex === -1) {
        return currentOrder;
      }

      nextOrder.splice(fromIndex, 1);
      nextOrder.splice(toIndex, 0, fromId);
      return nextOrder;
    });
  };

  const handleDrop = (targetId: DashboardWidgetId) => {
    if (!draggedWidget) {
      return;
    }

    moveWidget(draggedWidget, targetId);
    setDraggedWidget(null);
  };

  const resetWidgetOrder = () => {
    setWidgetOrder(DEFAULT_WIDGET_ORDER);
    setWidgetSizes(DEFAULT_WIDGET_SIZES);
    setDraggedWidget(null);
  };

  const widgetClasses: Record<DashboardWidgetId, Record<DashboardWidgetSize, string>> = {
    stats: {
      compact: 'xl:col-span-2',
      standard: 'xl:col-span-2',
      wide: 'xl:col-span-3',
    },
    readiness: {
      compact: 'xl:col-span-1',
      standard: 'xl:col-span-2',
      wide: 'xl:col-span-3',
    },
    health: {
      compact: 'xl:col-span-1',
      standard: 'xl:col-span-2',
      wide: 'xl:col-span-2',
    },
    analytics: {
      compact: 'xl:col-span-2',
      standard: 'xl:col-span-2',
      wide: 'xl:col-span-3',
    },
    breakdown: {
      compact: 'xl:col-span-1',
      standard: 'xl:col-span-2',
      wide: 'xl:col-span-2',
    },
    'recent-runs': {
      compact: 'xl:col-span-1',
      standard: 'xl:col-span-2',
      wide: 'xl:col-span-3',
    },
  };

  const startResize = (event: ReactMouseEvent<HTMLElement>, widgetId: DashboardWidgetId) => {
    event.preventDefault();
    event.stopPropagation();

    const options = WIDGET_SIZE_OPTIONS[widgetId];
    resizeStateRef.current = {
      widgetId,
      startX: event.clientX,
      startIndex: options.indexOf(widgetSizes[widgetId]),
    };

    window.addEventListener('mousemove', handleResizeMove);
    window.addEventListener('mouseup', stopResizeTracking);
  };

  const renderWidgetFrame = (
    widgetId: DashboardWidgetId,
    title: string,
    description: string,
    content: React.ReactNode,
  ) => {
    const widgetSize = widgetSizes[widgetId];
    const sizeOptions = WIDGET_SIZE_OPTIONS[widgetId];

    return (
    <div
      key={widgetId}
      onDragOver={(event) => event.preventDefault()}
      onDrop={() => handleDrop(widgetId)}
      className={widgetClasses[widgetId][widgetSize]}
    >
      <section
        draggable
        onDragStart={(event) => handleDragStart(event as DragEvent<HTMLButtonElement>, widgetId)}
        onDragEnd={() => setDraggedWidget(null)}
        className={`group relative h-full rounded-xl border border-border bg-card p-5 transition-opacity ${draggedWidget === widgetId ? 'opacity-60' : 'opacity-100'} cursor-grab active:cursor-grabbing`}
      >
        <div className="mb-4">
          <h2 className="font-semibold">{title}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{description}</p>
        </div>
        {content}
        {sizeOptions.length > 1 && (
          <div
            onMouseDown={(event) => startResize(event, widgetId)}
            className="absolute bottom-2 right-2 h-5 w-5 cursor-ew-resize opacity-0 transition-opacity group-hover:opacity-100"
            title="Drag to resize"
          >
            <div className="absolute bottom-0 right-0 h-3 w-3 border-b-2 border-r-2 border-muted-foreground/60" />
          </div>
        )}
      </section>
    </div>
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Dashboard</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {stats.schedulerRunning
              ? `Auto-fetch: ${stats.scheduleCron}`
              : 'Auto-fetch disabled'}
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => handleFetch(true)}
            disabled={fetching}
            className="rounded-lg border border-input px-4 py-2 text-sm font-medium hover:bg-muted transition-colors disabled:opacity-50"
          >
            Dry Run
          </button>
          <button
            onClick={() => handleFetch(false)}
            disabled={fetching}
            className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50 flex items-center gap-2"
          >
            {fetching ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Play className="h-4 w-4" />
            )}
            Run Now
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card/60 px-4 py-3">
        <p className="text-sm text-muted-foreground">
          Drag a widget from anywhere on the card, and drag the bottom-right corner to change its size.
        </p>
        <button
          type="button"
          onClick={resetWidgetOrder}
          className="inline-flex items-center gap-2 rounded-lg border border-input px-3 py-2 text-sm font-medium transition-colors hover:bg-muted"
        >
          <RotateCcw className="h-4 w-4" />
          Reset layout and sizes
        </button>
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        {widgetOrder.map((widgetId) => {
          if (widgetId === 'stats') {
            return renderWidgetFrame(
              widgetId,
              'Overview',
              'Key totals for invoices, vehicles, costs, and storage.',
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
                {statCards.map((card) => (
                  <div key={card.label} className="rounded-xl border border-border bg-background p-5">
                    <div className="flex items-center justify-between">
                      <p className="text-sm text-muted-foreground">{card.label}</p>
                      <card.icon className={`h-5 w-5 ${card.color}`} />
                    </div>
                    <p className="mt-2 text-2xl font-bold">{card.value}</p>
                  </div>
                ))}
              </div>,
            );
          }

          if (widgetId === 'readiness') {
            return renderWidgetFrame(
              widgetId,
              'Startup Readiness',
              setupComplete ? 'All required setup is complete.' : `${stats.setup.requiredComplete} of ${stats.setup.requiredTotal} required steps completed.`,
              <div className={`rounded-xl border p-4 ${setupComplete ? 'border-success/30 bg-success/5' : 'border-border bg-card'}`}>
                <div className="flex items-start justify-between gap-4">
                  <div className={`rounded-lg px-3 py-2 text-sm font-medium ${setupComplete ? 'bg-success/10 text-success' : 'bg-muted text-muted-foreground'}`}>
                    {setupComplete ? 'Ready' : `${stats.setup.requiredComplete}/${stats.setup.requiredTotal}`}
                  </div>
                  <button
                    type="button"
                    onClick={() => setSetupExpanded((current) => !(current ?? !setupComplete))}
                    className="inline-flex items-center gap-2 rounded-lg border border-input px-3 py-2 text-sm font-medium transition-colors hover:bg-muted"
                  >
                    {resolvedSetupExpanded ? 'Hide details' : 'Show details'}
                    {resolvedSetupExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                  </button>
                </div>

                {setupComplete && !resolvedSetupExpanded ? (
                  <div className="mt-4 flex items-center gap-2 rounded-lg border border-success/20 bg-background/80 px-4 py-3 text-sm text-muted-foreground">
                    <CheckCircle className="h-4 w-4 text-success" />
                    Open details only if you want to review the setup checklist.
                  </div>
                ) : (
                  <>
                    <div className="mt-4 space-y-3">
                      {stats.setup.steps.map((step) => (
                        <div key={step.id} className="flex items-start justify-between gap-3 rounded-lg border border-border bg-background p-3">
                          <div className="flex items-start gap-3">
                            {step.status === 'complete' ? (
                              <CheckCircle className="mt-0.5 h-4 w-4 text-success" />
                            ) : step.status === 'optional' ? (
                              <Clock className="mt-0.5 h-4 w-4 text-muted-foreground" />
                            ) : (
                              <AlertTriangle className="mt-0.5 h-4 w-4 text-warning" />
                            )}
                            <div>
                              <p className="text-sm font-medium">{step.title}</p>
                              <p className="mt-1 text-xs text-muted-foreground">{step.description}</p>
                            </div>
                          </div>
                          <Link
                            to={step.href}
                            className="inline-flex items-center gap-1 rounded-md border border-input px-2 py-1 text-xs font-medium transition-colors hover:bg-muted"
                          >
                            Open
                            <ArrowRight className="h-3 w-3" />
                          </Link>
                        </div>
                      ))}
                    </div>

                    {stats.setup.mismatchedVehicles > 0 && (
                      <div className="mt-4 rounded-lg border border-warning/30 bg-warning/5 px-4 py-3 text-sm text-warning">
                        {stats.setup.mismatchedVehicles} vehicle(s) still use a region different from {stats.activeRegion}. They will be skipped.
                      </div>
                    )}
                  </>
                )}
              </div>,
            );
          }

          if (widgetId === 'health') {
            return renderWidgetFrame(
              widgetId,
              'Token Health',
              allTokensHealthy ? 'Active-region Tesla tokens are healthy.' : 'One or more Tesla connections need attention.',
              <div className={`rounded-xl border p-4 ${allTokensHealthy ? 'border-success/30 bg-success/5' : 'border-border bg-card'}`}>
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <MapPinned className="h-4 w-4" />
                      Active region: {stats.activeRegion}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className={`rounded-lg px-3 py-2 text-sm font-medium ${allTokensHealthy ? 'bg-success/10 text-success' : 'bg-muted text-muted-foreground'}`}>
                      {allTokensHealthy ? 'Healthy' : 'Needs attention'}
                    </div>
                    <button
                      type="button"
                      onClick={() => setHealthExpanded((current) => !(current ?? !allTokensHealthy))}
                      className="inline-flex items-center gap-2 rounded-lg border border-input px-3 py-2 text-sm font-medium transition-colors hover:bg-muted"
                    >
                      {resolvedHealthExpanded ? 'Hide details' : 'Show details'}
                      {resolvedHealthExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                    </button>
                  </div>
                </div>

                {allTokensHealthy && !resolvedHealthExpanded ? (
                  <div className="mt-4 flex items-center gap-2 rounded-lg border border-success/20 bg-background/80 px-4 py-3 text-sm text-muted-foreground">
                    <CheckCircle className="h-4 w-4 text-success" />
                    Expand this section only if you want token expiry details.
                  </div>
                ) : (
                  <div className="mt-4 space-y-3">
                    {activeRegionHealth.map((token) => {
                      const healthy = token.state.hasToken && !token.state.isExpired;
                      return (
                        <div key={token.label} className="rounded-lg border border-border bg-background p-4">
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <p className="text-sm font-medium">{token.label}</p>
                              <p className="mt-1 text-xs text-muted-foreground">{token.description}</p>
                            </div>
                            {healthy ? (
                              <CheckCircle className="h-4 w-4 text-success" />
                            ) : token.state.hasToken ? (
                              <AlertTriangle className="h-4 w-4 text-warning" />
                            ) : (
                              <XCircle className="h-4 w-4 text-destructive" />
                            )}
                          </div>
                          <p className="mt-3 text-sm">
                            {!token.state.hasToken
                              ? 'Not connected'
                              : token.state.isExpired
                                ? 'Expired'
                                : 'Healthy'}
                          </p>
                          {token.state.expiresAt && (
                            <p className="mt-1 text-xs text-muted-foreground">
                              Expires: {formatDateTime(token.state.expiresAt)}
                            </p>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>,
            );
          }

          if (widgetId === 'analytics') {
            return renderWidgetFrame(
              widgetId,
              'Cost And Charging Trends',
              'Slice costs and charging load by period, vehicle, invoice type, and date range.',
              <>
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
                  <select
                    value={analyticsFilter.groupBy ?? 'month'}
                    onChange={(event) => updateAnalyticsFilter('groupBy', event.target.value as DashboardAnalyticsFilter['groupBy'])}
                    className="rounded-lg border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                  >
                    <option value="day">Per day</option>
                    <option value="week">Per week</option>
                    <option value="month">Per month</option>
                  </select>

                  <select
                    value={analyticsFilter.vin ?? ''}
                    onChange={(event) => updateAnalyticsFilter('vin', event.target.value || undefined)}
                    className="rounded-lg border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                  >
                    <option value="">All vehicles</option>
                    {analyticsData.availableVehicles.map((vehicle) => (
                      <option key={vehicle.vin} value={vehicle.vin}>{vehicleLabel(vehicle)}</option>
                    ))}
                  </select>

                  <select
                    value={analyticsFilter.type ?? ''}
                    onChange={(event) => updateAnalyticsFilter('type', (event.target.value || undefined) as DashboardAnalyticsFilter['type'])}
                    className="rounded-lg border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                  >
                    <option value="">All invoice types</option>
                    <option value="supercharger">Supercharger</option>
                    <option value="subscription">Subscription</option>
                    <option value="service">Service (manual only)</option>
                  </select>

                  <input
                    type="date"
                    value={analyticsFilter.dateFrom ?? ''}
                    onChange={(event) => updateAnalyticsFilter('dateFrom', event.target.value || undefined)}
                    className="rounded-lg border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                  />

                  <input
                    type="date"
                    value={analyticsFilter.dateTo ?? ''}
                    onChange={(event) => updateAnalyticsFilter('dateTo', event.target.value || undefined)}
                    className="rounded-lg border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                  />
                </div>

                {analyticsLoading ? (
                  <div className="flex h-64 items-center justify-center">
                    <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                  </div>
                ) : analyticsData.points.length === 0 ? (
                  <div className="mt-4 rounded-lg border border-border bg-muted/30 px-4 py-10 text-center text-sm text-muted-foreground">
                    No analytics data available for the selected filters.
                  </div>
                ) : (
                  <div className="mt-5">
                    {analyticsFilter.vin && selectedVehicleName && (
                      <p className="mb-4 text-sm text-muted-foreground">
                        Filtering charts for {selectedVehicleName}.
                      </p>
                    )}
                    <Suspense fallback={<AnalyticsChartsFallback />}>
                      <DashboardAnalyticsCharts points={analyticsData.points} />
                    </Suspense>
                  </div>
                )}
              </>,
            );
          }

          if (widgetId === 'breakdown') {
            return renderWidgetFrame(
              widgetId,
              'Invoice Breakdown',
              'Invoice counts grouped by invoice type.',
              <div className="space-y-3">
                {Object.entries(stats.byType).map(([type, count]) => (
                  <div key={type} className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div
                        className={`h-2.5 w-2.5 rounded-full ${
                          type === 'supercharger'
                            ? 'bg-primary'
                            : type === 'subscription'
                              ? 'bg-success'
                              : 'bg-warning'
                        }`}
                      />
                      <span className="text-sm capitalize">{type}</span>
                    </div>
                    <span className="text-sm font-medium">{count}</span>
                  </div>
                ))}
                {Object.keys(stats.byType).length === 0 && (
                  <p className="text-sm text-muted-foreground">No invoices yet</p>
                )}
              </div>,
            );
          }

          return renderWidgetFrame(
            widgetId,
            'Recent Fetch Runs',
            'Open any recent run to inspect logs and results.',
            <div className="space-y-3">
              {stats.recentRuns.map((run) => (
                <Link
                  key={run.id}
                  to={`/fetch-runs?run=${run.id}`}
                  className="flex items-center justify-between rounded-lg border border-transparent py-2 transition-colors hover:border-border hover:bg-muted/30"
                >
                  <div className="flex items-center gap-3 px-1">
                    {statusIcon(run.status)}
                    <div>
                      <p className="text-sm font-medium">
                        Run #{run.id}
                        {run.dry_run ? ' (dry run)' : ''}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {run.invoices_new} new / {run.invoices_found} found
                      </p>
                    </div>
                  </div>
                  <span className="px-1 text-xs text-muted-foreground">
                    {relativeTime(run.started_at)}
                  </span>
                </Link>
              ))}
              {stats.recentRuns.length === 0 && (
                <p className="text-sm text-muted-foreground">No runs yet</p>
              )}
            </div>,
          );
        })}
      </div>
    </div>
  );
}

function AnalyticsChartsFallback() {
  return (
    <div className="grid gap-4 xl:grid-cols-2">
      {[0, 1].map((index) => (
        <div key={index} className="rounded-lg border border-border p-4">
          <div className="h-4 w-40 animate-pulse rounded bg-muted" />
          <div className="mt-4 h-72 animate-pulse rounded-lg bg-muted/60" />
        </div>
      ))}
    </div>
  );
}
