import { useEffect, useState, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { fetchRunApi, type FetchRun, type FetchRunFilter } from '../lib/api';
import { useToast } from '../hooks/useToast';
import { formatDateTime, relativeTime, timestampMs } from '../lib/utils';
import {
  Loader2,
  CheckCircle,
  XCircle,
  AlertTriangle,
  Clock,
  ChevronDown,
  ChevronUp,
  RefreshCw,
  FileText,
  ArrowUpDown,
} from 'lucide-react';

const PAGE_SIZE = 20;

function statusIcon(status: string) {
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
}

function statusBadge(status: string) {
  const base = 'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium';
  switch (status) {
    case 'success':
      return `${base} bg-success/10 text-success`;
    case 'failed':
      return `${base} bg-destructive/10 text-destructive`;
    case 'partial':
      return `${base} bg-warning/10 text-warning`;
    case 'running':
      return `${base} bg-primary/10 text-primary`;
    default:
      return `${base} bg-muted text-muted-foreground`;
  }
}

function duration(run: FetchRun): string {
  const endMs = run.finished_at ? timestampMs(run.finished_at) : Date.now();
  const ms = Math.max(0, endMs - timestampMs(run.started_at));
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60000)}m ${Math.floor((ms % 60000) / 1000)}s`;
}

interface RunDetailProps {
  run: FetchRun;
  onClose: () => void;
}

function RunDetail({ run, onClose }: RunDetailProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-card border border-border rounded-xl w-full max-w-3xl max-h-[85vh] flex flex-col shadow-xl">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <div className="flex items-center gap-3">
            {statusIcon(run.status)}
            <div>
              <h2 className="font-semibold">
                Run #{run.id}{run.dry_run ? ' (dry run)' : ''}
              </h2>
              <p className="text-xs text-muted-foreground">{formatDateTime(run.started_at)}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          >
            <ChevronUp className="h-5 w-5" />
          </button>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-3 divide-x divide-border border-b border-border">
          {[
            { label: 'New', value: run.invoices_new },
            { label: 'Found', value: run.invoices_found },
            { label: 'Skipped', value: run.invoices_skipped },
          ].map(({ label, value }) => (
            <div key={label} className="px-5 py-3 text-center">
              <p className="text-xl font-bold">{value}</p>
              <p className="text-xs text-muted-foreground">{label}</p>
            </div>
          ))}
        </div>

        {/* Duration + status row */}
        <div className="flex flex-wrap items-center gap-4 px-5 py-3 border-b border-border text-sm">
          <span className={statusBadge(run.status)}>{run.status}</span>
          <span className="text-muted-foreground">Duration: {duration(run)}</span>
          <span className="text-muted-foreground">Started: {formatDateTime(run.started_at)}</span>
          {run.finished_at && (
            <span className="text-muted-foreground">Finished: {formatDateTime(run.finished_at)} ({relativeTime(run.finished_at)})</span>
          )}
        </div>

        {/* Error message */}
        {run.error_message && (
          <div className="mx-5 mt-3 rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-2 text-sm text-destructive">
            {run.error_message}
          </div>
        )}

        {/* Log output */}
        <div className="flex-1 overflow-auto p-5">
          <div className="flex items-center gap-2 mb-2">
            <FileText className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm font-medium">Run Log</span>
          </div>
          {run.log ? (
            <pre className="text-xs text-muted-foreground bg-muted rounded-lg p-4 overflow-auto whitespace-pre-wrap break-words font-mono leading-relaxed">
              {run.log}
            </pre>
          ) : (
            <p className="text-sm text-muted-foreground italic">No log captured for this run.</p>
          )}
        </div>
      </div>
    </div>
  );
}

export function FetchRunsPage() {
  const { toast } = useToast();
  const [searchParams, setSearchParams] = useSearchParams();
  const [runs, setRuns] = useState<FetchRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [selectedRun, setSelectedRun] = useState<FetchRun | null>(null);
  const [loadingDetail, setLoadingDetail] = useState<number | null>(null);
  const [sort, setSort] = useState<NonNullable<FetchRunFilter['sort']>>('started_at');
  const [order, setOrder] = useState<NonNullable<FetchRunFilter['order']>>('desc');

  const requestedRunId = Number(searchParams.get('run') ?? 0);

  const loadRuns = useCallback(async (newOffset = 0) => {
    setLoading(true);
    try {
      const data = await fetchRunApi.list({ limit: PAGE_SIZE, offset: newOffset, sort, order });
      if (newOffset === 0) {
        setRuns(data);
      } else {
        setRuns((prev) => [...prev, ...data]);
      }
      setHasMore(data.length === PAGE_SIZE);
      setOffset(newOffset);
    } catch {
      toast({ title: 'Failed to load fetch runs', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  }, [order, sort, toast]);

  useEffect(() => {
    loadRuns(0);
  }, [loadRuns]);

  const handleSort = (field: NonNullable<FetchRunFilter['sort']>) => {
    setOrder((currentOrder) => (sort === field && currentOrder === 'desc' ? 'asc' : 'desc'));
    setSort(field);
  };

  const openDetail = useCallback(async (runId: number) => {
    // Always load fresh detail so log is up to date for running jobs
    setLoadingDetail(runId);
    try {
      const detail = await fetchRunApi.get(runId);
      setSelectedRun(detail);
    } catch {
      toast({ title: 'Failed to load run details', variant: 'destructive' });
    } finally {
      setLoadingDetail(null);
    }
  }, [toast]);

  useEffect(() => {
    if (!requestedRunId || loadingDetail === requestedRunId || selectedRun?.id === requestedRunId) {
      return;
    }

    void openDetail(requestedRunId);
  }, [loadingDetail, openDetail, requestedRunId, selectedRun]);

  const closeDetail = () => {
    setSelectedRun(null);
    const nextParams = new URLSearchParams(searchParams);
    nextParams.delete('run');
    setSearchParams(nextParams, { replace: true });
  };

  const viewDetail = (runId: number) => {
    const nextParams = new URLSearchParams(searchParams);
    nextParams.set('run', String(runId));
    setSearchParams(nextParams, { replace: true });
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Fetch Runs</h1>
          <p className="text-sm text-muted-foreground mt-1">History of all invoice fetch operations</p>
        </div>
        <button
          onClick={() => loadRuns(0)}
          disabled={loading}
          className="rounded-lg border border-input px-3 py-2 text-sm font-medium hover:bg-muted transition-colors flex items-center gap-2 disabled:opacity-50"
        >
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          Refresh
        </button>
      </div>

      <div className="rounded-xl border border-border bg-card overflow-x-auto">
        {loading && runs.length === 0 ? (
          <div className="flex items-center justify-center h-48">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : runs.length === 0 ? (
          <div className="flex items-center justify-center h-48 text-sm text-muted-foreground">
            No fetch runs yet. Trigger a fetch from the Dashboard.
          </div>
        ) : (
          <>
            <table className="w-full min-w-[880px] text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/40 text-xs text-muted-foreground">
                  <SortableHeader label="Status" field="status" align="left" currentSort={sort} order={order} onSort={handleSort} />
                  <SortableHeader label="Run" field="id" align="left" currentSort={sort} order={order} onSort={handleSort} />
                  <SortableHeader label="Started" field="started_at" align="left" currentSort={sort} order={order} onSort={handleSort} />
                  <SortableHeader label="Finished" field="finished_at" align="left" currentSort={sort} order={order} onSort={handleSort} />
                  <SortableHeader label="New" field="invoices_new" align="right" currentSort={sort} order={order} onSort={handleSort} />
                  <SortableHeader label="Found" field="invoices_found" align="right" currentSort={sort} order={order} onSort={handleSort} />
                  <SortableHeader label="Skipped" field="invoices_skipped" align="right" currentSort={sort} order={order} onSort={handleSort} />
                  <SortableHeader label="Duration" field="duration_ms" align="left" currentSort={sort} order={order} onSort={handleSort} />
                  <th className="px-5 py-3 text-right font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {runs.map((run) => (
                  <tr key={run.id} className="border-b border-border last:border-0 hover:bg-muted/30 transition-colors align-top">
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-2">
                        {statusIcon(run.status)}
                        <span className={statusBadge(run.status)}>{run.status}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div>
                        <p className="font-medium">Run #{run.id}</p>
                        {!!run.dry_run && <p className="text-xs text-muted-foreground">Dry run</p>}
                        {run.error_message && <p className="mt-1 max-w-xs truncate text-xs text-destructive">{run.error_message}</p>}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">
                      <div>{formatDateTime(run.started_at)}</div>
                      <div>{relativeTime(run.started_at)}</div>
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">
                      {run.finished_at ? (
                        <>
                          <div>{formatDateTime(run.finished_at)}</div>
                          <div>{relativeTime(run.finished_at)}</div>
                        </>
                      ) : (
                        <span className="text-primary">Running</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">{run.invoices_new}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{run.invoices_found}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{run.invoices_skipped}</td>
                    <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">{duration(run)}</td>
                    <td className="px-5 py-3 text-right">
                      <button
                        onClick={() => viewDetail(run.id)}
                        disabled={loadingDetail === run.id}
                        className="inline-flex items-center gap-1 rounded-lg border border-input px-2 py-1 text-xs hover:bg-muted transition-colors disabled:opacity-50"
                      >
                        {loadingDetail === run.id ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : (
                          <ChevronDown className="h-3 w-3" />
                        )}
                        View
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {hasMore && (
              <div className="px-5 py-3 text-center">
                <button
                  onClick={() => loadRuns(offset + PAGE_SIZE)}
                  disabled={loading}
                  className="text-sm text-primary hover:underline disabled:opacity-50"
                >
                  {loading ? 'Loading...' : 'Load more'}
                </button>
              </div>
            )}
          </>
        )}
      </div>

      {selectedRun && (
        <RunDetail run={selectedRun} onClose={closeDetail} />
      )}
    </div>
  );
}

function SortableHeader({
  label,
  field,
  align,
  currentSort,
  order,
  onSort,
}: {
  label: string;
  field: NonNullable<FetchRunFilter['sort']>;
  align: 'left' | 'right';
  currentSort: NonNullable<FetchRunFilter['sort']>;
  order: NonNullable<FetchRunFilter['order']>;
  onSort: (field: NonNullable<FetchRunFilter['sort']>) => void;
}) {
  return (
    <th className={`px-4 py-3 font-medium ${align === 'right' ? 'text-right' : 'text-left'}`}>
      <button
        type="button"
        className={`inline-flex items-center gap-1 ${align === 'right' ? 'justify-end' : ''} hover:text-foreground select-none`}
        onClick={() => onSort(field)}
      >
        <span>{label}</span>
        <ArrowUpDown className={`h-3 w-3 ${currentSort === field ? 'text-primary' : 'opacity-40'}`} />
        {currentSort === field && (
          <span className="text-xs text-primary">{order === 'asc' ? '↑' : '↓'}</span>
        )}
      </button>
    </th>
  );
}
