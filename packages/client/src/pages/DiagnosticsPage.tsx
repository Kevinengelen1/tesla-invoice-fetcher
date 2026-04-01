import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, Activity, Loader2, RefreshCw, ServerCrash, ShieldAlert } from 'lucide-react';
import { diagnosticsApi, type DiagnosticsAccount, type DiagnosticsProblemRun, type DiagnosticsResponse } from '../lib/api';
import { useToast } from '../hooks/useToast';
import { formatDate, formatDateTime, relativeTime } from '../lib/utils';
import { SortableHeader, type SortDirection } from '../components/SortableHeader';
import { sortBy } from '../lib/sort';

type AccountSortField = 'name' | 'region' | 'vehicleCount' | 'latestInvoiceDate' | 'lastSuccessfulRunAt';
type ProblemRunSortField = 'id' | 'status' | 'started_at' | 'finished_at';

function statusTone(hasToken: boolean, isExpired: boolean) {
  if (!hasToken) return 'bg-muted text-muted-foreground';
  if (isExpired) return 'bg-warning/10 text-warning';
  return 'bg-success/10 text-success';
}

export function DiagnosticsPage() {
  const { toast } = useToast();
  const [data, setData] = useState<DiagnosticsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [accountSort, setAccountSort] = useState<AccountSortField>('name');
  const [accountOrder, setAccountOrder] = useState<SortDirection>('asc');
  const [problemSort, setProblemSort] = useState<ProblemRunSortField>('started_at');
  const [problemOrder, setProblemOrder] = useState<SortDirection>('desc');

  const loadDiagnostics = async () => {
    setLoading(true);
    try {
      setData(await diagnosticsApi.get());
    } catch (error) {
      toast({
        title: 'Failed to load diagnostics',
        description: error instanceof Error ? error.message : 'Unknown error',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadDiagnostics();
  }, []);

  const sortedAccounts = useMemo(() => {
    const accounts = data?.accounts ?? [];
    return sortBy(accounts, accountOrder, (account) => accountValue(account, accountSort));
  }, [accountOrder, accountSort, data?.accounts]);

  const sortedProblemRuns = useMemo(() => {
    const runs = data?.recentProblemRuns ?? [];
    return sortBy(runs, problemOrder, (run) => runValue(run, problemSort));
  }, [data?.recentProblemRuns, problemOrder, problemSort]);

  const updateAccountSort = (field: AccountSortField) => {
    setAccountOrder((current) => (accountSort === field && current === 'desc' ? 'asc' : 'desc'));
    setAccountSort(field);
  };

  const updateProblemSort = (field: ProblemRunSortField) => {
    setProblemOrder((current) => (problemSort === field && current === 'desc' ? 'asc' : 'desc'));
    setProblemSort(field);
  };

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!data) {
    return null;
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Diagnostics</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Tesla auth health, recent fetch failures, and vehicle assignment issues without opening raw logs.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void loadDiagnostics()}
          className="rounded-lg border border-input px-3 py-2 text-sm font-medium transition-colors hover:bg-muted"
        >
          <span className="inline-flex items-center gap-2">
            <RefreshCw className="h-4 w-4" />
            Refresh
          </span>
        </button>
      </div>

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <SummaryCard label="Current Region" value={data.summary.activeRegion} hint={`${data.summary.accountCount} Tesla account(s)`} />
        <SummaryCard label="Scheduler" value={data.summary.schedulerRunning ? 'Running' : 'Disabled'} hint={`${data.summary.problemRunCount} recent problem run(s)`} />
        <SummaryCard label="Vehicles" value={String(data.summary.vehicleCount)} hint={`${data.summary.unassignedVehicleCount} unassigned, ${data.summary.mismatchedVehicleCount} mismatched`} />
        <SummaryCard label="App Configs" value={String(data.summary.appConfigCount)} hint={`${data.summary.currentJob ? `Run #${data.summary.currentJob.runId} active` : 'No active fetch job'}`} />
      </section>

      <section className="rounded-xl border border-border bg-card p-5">
        <h2 className="flex items-center gap-2 text-lg font-semibold">
          <Activity className="h-4 w-4 text-primary" />
          Current Fetch Activity
        </h2>
        {data.summary.currentJob ? (
          <div className="mt-4 grid gap-3 md:grid-cols-4 text-sm">
            <InfoItem label="Run" value={`#${data.summary.currentJob.runId}`} />
            <InfoItem label="Source" value={capitalize(data.summary.currentJob.source)} />
            <InfoItem label="Mode" value={data.summary.currentJob.dryRun ? 'Dry run' : 'Live'} />
            <InfoItem label="Started" value={`${formatDateTime(data.summary.currentJob.startedAt)} (${relativeTime(data.summary.currentJob.startedAt)})`} />
            <div className="md:col-span-4 rounded-lg border border-border bg-muted/30 px-3 py-2 text-sm text-muted-foreground">
              Vehicles: {data.summary.currentJob.vins?.length ? data.summary.currentJob.vins.join(', ') : 'All eligible vehicles'}
            </div>
          </div>
        ) : (
          <p className="mt-3 text-sm text-muted-foreground">No fetch job is currently running.</p>
        )}
      </section>

      <section className="rounded-xl border border-border bg-card overflow-x-auto">
        <div className="border-b border-border px-5 py-4">
          <h2 className="flex items-center gap-2 text-lg font-semibold">
            <ShieldAlert className="h-4 w-4 text-primary" />
            Tesla Account Diagnostics
          </h2>
        </div>
        <table className="w-full min-w-[980px] text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/40 text-xs text-muted-foreground">
              <SortableHeader label="Account" field="name" currentSort={accountSort} order={accountOrder} onSort={updateAccountSort} />
              <SortableHeader label="Region" field="region" currentSort={accountSort} order={accountOrder} onSort={updateAccountSort} />
              <th className="px-4 py-3 text-left font-medium">Fleet</th>
              <th className="px-4 py-3 text-left font-medium">Ownership</th>
              <SortableHeader label="Vehicles" field="vehicleCount" currentSort={accountSort} order={accountOrder} onSort={updateAccountSort} align="right" />
              <SortableHeader label="Latest Invoice" field="latestInvoiceDate" currentSort={accountSort} order={accountOrder} onSort={updateAccountSort} />
              <SortableHeader label="Last Successful Run" field="lastSuccessfulRunAt" currentSort={accountSort} order={accountOrder} onSort={updateAccountSort} />
              <th className="px-4 py-3 text-left font-medium">Issues</th>
            </tr>
          </thead>
          <tbody>
            {sortedAccounts.map((account) => (
              <tr key={account.id} className="border-b border-border last:border-0 align-top">
                <td className="px-4 py-3">
                  <div>
                    <p className="font-medium">{account.name}</p>
                    <p className="text-xs text-muted-foreground">{account.app_config_name ?? 'No app config linked'}</p>
                  </div>
                </td>
                <td className="px-4 py-3">{account.region}</td>
                <td className="px-4 py-3">
                  <TokenPill hasToken={account.fleet.hasToken} isExpired={account.fleet.isExpired} expiresAt={account.fleet.expiresAt} />
                </td>
                <td className="px-4 py-3">
                  <TokenPill hasToken={account.ownership.hasToken} isExpired={account.ownership.isExpired} expiresAt={account.ownership.expiresAt} />
                </td>
                <td className="px-4 py-3 text-right tabular-nums">{account.vehicleCount}</td>
                <td className="px-4 py-3 text-xs text-muted-foreground">{account.latestInvoiceDate ? formatDate(account.latestInvoiceDate) : '—'}</td>
                <td className="px-4 py-3 text-xs text-muted-foreground">{account.lastSuccessfulRunAt ? `${formatDateTime(account.lastSuccessfulRunAt)} (${relativeTime(account.lastSuccessfulRunAt)})` : '—'}</td>
                <td className="px-4 py-3">
                  {account.issues.length === 0 ? (
                    <span className="rounded-full bg-success/10 px-2 py-1 text-xs font-medium text-success">Healthy</span>
                  ) : (
                    <div className="space-y-1">
                      {account.issues.map((issue) => (
                        <p key={issue} className="text-xs text-warning">{issue}</p>
                      ))}
                      {account.recentErrors.map((error) => (
                        <Link key={`${account.id}-${error.runId}-${error.line}`} to={`/fetch-runs?run=${error.runId}`} className="block text-xs text-destructive hover:underline">
                          Run #{error.runId}: {error.line}
                        </Link>
                      ))}
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="grid gap-6 xl:grid-cols-[1.3fr_0.7fr]">
        <div className="rounded-xl border border-border bg-card overflow-x-auto">
          <div className="border-b border-border px-5 py-4">
            <h2 className="flex items-center gap-2 text-lg font-semibold">
              <ServerCrash className="h-4 w-4 text-primary" />
              Recent Problem Runs
            </h2>
          </div>
          <table className="w-full min-w-[760px] text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/40 text-xs text-muted-foreground">
                <SortableHeader label="Run" field="id" currentSort={problemSort} order={problemOrder} onSort={updateProblemSort} />
                <SortableHeader label="Status" field="status" currentSort={problemSort} order={problemOrder} onSort={updateProblemSort} />
                <SortableHeader label="Started" field="started_at" currentSort={problemSort} order={problemOrder} onSort={updateProblemSort} />
                <SortableHeader label="Finished" field="finished_at" currentSort={problemSort} order={problemOrder} onSort={updateProblemSort} />
                <th className="px-4 py-3 text-left font-medium">Highlights</th>
              </tr>
            </thead>
            <tbody>
              {sortedProblemRuns.map((run) => (
                <tr key={run.id} className="border-b border-border last:border-0 align-top">
                  <td className="px-4 py-3">
                    <Link to={`/fetch-runs?run=${run.id}`} className="font-medium text-primary hover:underline">
                      Run #{run.id}
                    </Link>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`rounded-full px-2 py-1 text-xs font-medium ${run.status === 'failed' ? 'bg-destructive/10 text-destructive' : 'bg-warning/10 text-warning'}`}>
                      {run.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">{formatDateTime(run.started_at)}</td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">{run.finished_at ? formatDateTime(run.finished_at) : 'Running'}</td>
                  <td className="px-4 py-3">
                    {run.highlights.length > 0 ? (
                      <div className="space-y-1">
                        {run.highlights.map((highlight) => (
                          <p key={`${run.id}-${highlight}`} className="text-xs text-destructive">{highlight}</p>
                        ))}
                      </div>
                    ) : (
                      <p className="text-xs text-muted-foreground">No extracted highlights</p>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="space-y-6">
          <section className="rounded-xl border border-border bg-card p-5">
            <h2 className="text-lg font-semibold">App Config Usage</h2>
            <div className="mt-4 space-y-3">
              {data.appConfigs.map((appConfig) => (
                <div key={appConfig.id} className="rounded-lg border border-border bg-muted/30 px-3 py-3 text-sm">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="font-medium">{appConfig.name}</p>
                      <p className="text-xs text-muted-foreground">{appConfig.region} · {appConfig.accountCount} account(s)</p>
                    </div>
                    <span className={`rounded-full px-2 py-1 text-xs font-medium ${appConfig.has_client_secret ? 'bg-success/10 text-success' : 'bg-destructive/10 text-destructive'}`}>
                      {appConfig.has_client_secret ? 'Secret stored' : 'Secret missing'}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section className="rounded-xl border border-border bg-card p-5">
            <h2 className="flex items-center gap-2 text-lg font-semibold">
              <AlertTriangle className="h-4 w-4 text-warning" />
              Vehicle Issues
            </h2>
            <div className="mt-4 space-y-4 text-sm">
              <div>
                <p className="font-medium">Unassigned vehicles</p>
                {data.vehicleIssues.unassigned.length > 0 ? (
                  <div className="mt-2 space-y-1">
                    {data.vehicleIssues.unassigned.map((vehicle) => (
                      <p key={vehicle.id} className="text-muted-foreground">{vehicle.name ?? 'Unnamed'} · {vehicle.vin}</p>
                    ))}
                  </div>
                ) : (
                  <p className="mt-1 text-muted-foreground">None</p>
                )}
              </div>
              <div>
                <p className="font-medium">Region mismatch</p>
                {data.vehicleIssues.mismatchedRegion.length > 0 ? (
                  <div className="mt-2 space-y-1">
                    {data.vehicleIssues.mismatchedRegion.map((vehicle) => (
                      <p key={vehicle.id} className="text-muted-foreground">{vehicle.name ?? 'Unnamed'} · {vehicle.vin} · {vehicle.region}</p>
                    ))}
                  </div>
                ) : (
                  <p className="mt-1 text-muted-foreground">None</p>
                )}
              </div>
            </div>
          </section>
        </div>
      </section>
    </div>
  );
}

function accountValue(account: DiagnosticsAccount, field: AccountSortField) {
  switch (field) {
    case 'name':
      return account.name;
    case 'region':
      return account.region;
    case 'vehicleCount':
      return account.vehicleCount;
    case 'latestInvoiceDate':
      return account.latestInvoiceDate ?? '';
    case 'lastSuccessfulRunAt':
      return account.lastSuccessfulRunAt ?? '';
  }
}

function runValue(run: DiagnosticsProblemRun, field: ProblemRunSortField) {
  switch (field) {
    case 'id':
      return run.id;
    case 'status':
      return run.status;
    case 'started_at':
      return run.started_at;
    case 'finished_at':
      return run.finished_at ?? '';
  }
}

function SummaryCard({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="mt-2 text-2xl font-bold">{value}</p>
      <p className="mt-1 text-xs text-muted-foreground">{hint}</p>
    </div>
  );
}

function InfoItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border bg-muted/30 px-3 py-2">
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-1 font-medium">{value}</p>
    </div>
  );
}

function TokenPill({ hasToken, isExpired, expiresAt }: { hasToken: boolean; isExpired: boolean; expiresAt?: string }) {
  return (
    <div>
      <span className={`rounded-full px-2 py-1 text-xs font-medium ${statusTone(hasToken, isExpired)}`}>
        {!hasToken ? 'Missing' : isExpired ? 'Expired' : 'Healthy'}
      </span>
      {expiresAt && (
        <p className="mt-1 text-xs text-muted-foreground">Expires {formatDateTime(expiresAt)}</p>
      )}
    </div>
  );
}

function capitalize(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}