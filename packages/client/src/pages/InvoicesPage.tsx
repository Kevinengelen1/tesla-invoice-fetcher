import { useEffect, useState, useCallback, type FormEvent } from 'react';
import {
  invoiceApi,
  vehicleApi,
  type Invoice,
  type InvoiceFilter,
  type InvoiceListResponse,
  type Vehicle,
} from '../lib/api';
import { useToast } from '../hooks/useToast';
import { formatCurrency, formatDate } from '../lib/utils';
import {
  Search,
  Download,
  ChevronLeft,
  ChevronRight,
  ArrowUpDown,
  FileEdit,
  Loader2,
  Trash2,
  X,
} from 'lucide-react';

export function InvoicesPage() {
  const { toast } = useToast();
  const [response, setResponse] = useState<InvoiceListResponse | null>(null);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<InvoiceFilter>({
    page: 1,
    limit: 25,
    sort: 'invoice_date',
    order: 'desc',
  });
  const [searchInput, setSearchInput] = useState('');

  // Rename state
  const [renameOpen, setRenameOpen] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [renameTemplate, setRenameTemplate] = useState('{date}_{type}_{vin}_{site}');
  const [renamePreview, setRenamePreview] = useState<
    Array<{ id: number; oldName: string; newName: string }> | null
  >(null);
  const [renaming, setRenaming] = useState(false);
  const [downloading, setDownloading] = useState(false);

  const loadInvoices = useCallback(async () => {
    setLoading(true);
    try {
      const data = await invoiceApi.list(filter);
      setResponse(data);
    } catch {
      toast({ title: 'Failed to load invoices', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  }, [filter, toast]);

  useEffect(() => {
    loadInvoices();
  }, [loadInvoices]);

  useEffect(() => {
    const loadVehicles = async () => {
      try {
        const data = await vehicleApi.list();
        setVehicles(data);
      } catch {
        toast({ title: 'Failed to load vehicles', variant: 'destructive' });
      }
    };

    void loadVehicles();
  }, [toast]);

  const vehicleLabel = (vehicle: Vehicle) => vehicle.name ? `${vehicle.name} (${vehicle.vin})` : vehicle.vin;

  const handleSearch = (e: FormEvent) => {
    e.preventDefault();
    setFilter((f) => ({ ...f, search: searchInput || undefined, page: 1 }));
  };

  const clearFilters = () => {
    setSearchInput('');
    setFilter({ page: 1, limit: 25, sort: 'invoice_date', order: 'desc' });
  };

  const handleSort = (field: NonNullable<InvoiceFilter['sort']>) => {
    setFilter((f) => ({
      ...f,
      sort: field,
      order: f.sort === field && f.order === 'desc' ? 'asc' : 'desc',
      page: 1,
    }));
  };

  const handleExportCsv = async () => {
    try {
      const csv = await invoiceApi.exportCsv();
      const blob = new Blob([csv], { type: 'text/csv' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'tesla-invoices.csv';
      a.click();
      URL.revokeObjectURL(url);
      toast({ title: 'CSV exported', variant: 'success' });
    } catch {
      toast({ title: 'Export failed', variant: 'destructive' });
    }
  };

  const handleDownloadSelected = async () => {
    setDownloading(true);
    try {
      const blob = await invoiceApi.downloadZip(Array.from(selectedIds));
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'invoices.zip';
      a.click();
      URL.revokeObjectURL(url);
      toast({ title: `Downloaded ${selectedIds.size} invoice(s)`, variant: 'success' });
    } catch {
      toast({ title: 'Download failed', variant: 'destructive' });
    } finally {
      setDownloading(false);
    }
  };

  const handleDelete = async (id: number) => {
    if (!confirm('Delete this invoice?')) return;
    try {
      await invoiceApi.delete(id);
      toast({ title: 'Invoice deleted', variant: 'success' });
      loadInvoices();
    } catch {
      toast({ title: 'Delete failed', variant: 'destructive' });
    }
  };

  const handleDownload = (id: number) => {
    window.open(`/api/invoices/${id}/download`, '_blank');
  };

  const toggleSelect = (id: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (!response) return;
    if (selectedIds.size === response.data.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(response.data.map((i) => i.id)));
    }
  };

  const handlePreviewRename = async () => {
    setRenaming(true);
    try {
      const preview = await invoiceApi.rename(Array.from(selectedIds), renameTemplate, true);
      setRenamePreview(preview);
    } catch (err) {
      toast({
        title: 'Preview failed',
        description: err instanceof Error ? err.message : 'Unknown error',
        variant: 'destructive',
      });
    } finally {
      setRenaming(false);
    }
  };

  const handleExecuteRename = async () => {
    setRenaming(true);
    try {
      await invoiceApi.rename(Array.from(selectedIds), renameTemplate);
      toast({ title: 'Invoices renamed', variant: 'success' });
      setRenameOpen(false);
      setRenamePreview(null);
      setSelectedIds(new Set());
      loadInvoices();
    } catch {
      toast({ title: 'Rename failed', variant: 'destructive' });
    } finally {
      setRenaming(false);
    }
  };

  const typeColors: Record<string, string> = {
    supercharger: 'bg-primary/10 text-primary',
    subscription: 'bg-success/10 text-success',
    service: 'bg-warning/10 text-warning',
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">Invoices</h1>
        <div className="flex gap-2">
          {selectedIds.size > 0 && (
            <>
              <button
                onClick={handleDownloadSelected}
                disabled={downloading}
                className="rounded-lg border border-input px-3 py-2 text-sm font-medium hover:bg-muted transition-colors flex items-center gap-2 disabled:opacity-50"
              >
                {downloading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                Download ({selectedIds.size})
              </button>
              <button
                onClick={() => setRenameOpen(true)}
                className="rounded-lg border border-input px-3 py-2 text-sm font-medium hover:bg-muted transition-colors flex items-center gap-2"
              >
                <FileEdit className="h-4 w-4" />
                Rename ({selectedIds.size})
              </button>
            </>
          )}
          <button
            onClick={handleExportCsv}
            className="rounded-lg border border-input px-3 py-2 text-sm font-medium hover:bg-muted transition-colors flex items-center gap-2"
          >
            <Download className="h-4 w-4" />
            Export CSV
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        <form onSubmit={handleSearch} className="flex gap-2 flex-1">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <input
              type="text"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Search invoices..."
              className="w-full rounded-lg border border-input bg-background pl-9 pr-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>
          <button
            type="submit"
            className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
          >
            Search
          </button>
        </form>

        <select
          value={filter.vin ?? ''}
          onChange={(e) =>
            setFilter((f) => ({ ...f, vin: e.target.value || undefined, page: 1 }))
          }
          className="rounded-lg border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
        >
          <option value="">All Vehicles</option>
          {vehicles.map((vehicle) => (
            <option key={vehicle.id} value={vehicle.vin}>
              {vehicleLabel(vehicle)}
            </option>
          ))}
        </select>

        <select
          value={filter.type ?? ''}
          onChange={(e) =>
            setFilter((f) => ({ ...f, type: e.target.value || undefined, page: 1 }))
          }
          className="rounded-lg border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
        >
          <option value="">All Types</option>
          <option value="supercharger">Supercharger</option>
          <option value="subscription">Subscription</option>
          <option value="service">Service (manual only)</option>
        </select>

        <input
          type="date"
          value={filter.dateFrom ?? ''}
          onChange={(e) =>
            setFilter((f) => ({ ...f, dateFrom: e.target.value || undefined, page: 1 }))
          }
          className="rounded-lg border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          placeholder="From"
        />

        <input
          type="date"
          value={filter.dateTo ?? ''}
          onChange={(e) =>
            setFilter((f) => ({ ...f, dateTo: e.target.value || undefined, page: 1 }))
          }
          className="rounded-lg border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
        />

        {(filter.search || filter.vin || filter.type || filter.dateFrom || filter.dateTo) && (
          <button
            onClick={clearFilters}
            className="rounded-lg border border-input px-3 py-2 text-sm hover:bg-muted transition-colors"
          >
            Clear
          </button>
        )}
      </div>

      {/* Table */}
      <div className="rounded-xl border border-border bg-card overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border">
              <th className="px-4 py-3 text-left">
                <input
                  type="checkbox"
                  checked={response ? selectedIds.size === response.data.length && response.data.length > 0 : false}
                  onChange={toggleSelectAll}
                  className="rounded"
                />
              </th>
              <SortHeader
                label="Date"
                field="invoice_date"
                currentSort={filter.sort}
                order={filter.order}
                onSort={handleSort}
              />
              <SortHeader
                label="Type"
                field="invoice_type"
                currentSort={filter.sort}
                order={filter.order}
                onSort={handleSort}
              />
              <SortHeader
                label="VIN"
                field="vin"
                currentSort={filter.sort}
                order={filter.order}
                onSort={handleSort}
              />
              <SortHeader
                label="Amount"
                field="amount_cents"
                currentSort={filter.sort}
                order={filter.order}
                onSort={handleSort}
              />
              <SortHeader
                label="Site"
                field="site_name"
                currentSort={filter.sort}
                order={filter.order}
                onSort={handleSort}
              />
              <SortHeader
                label="kWh"
                field="energy_kwh"
                currentSort={filter.sort}
                order={filter.order}
                onSort={handleSort}
              />
              <th className="px-4 py-3 text-right font-medium text-muted-foreground">Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={8} className="px-4 py-12 text-center">
                  <Loader2 className="h-6 w-6 animate-spin mx-auto text-muted-foreground" />
                </td>
              </tr>
            ) : response?.data.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-4 py-12 text-center text-muted-foreground">
                  No invoices found
                </td>
              </tr>
            ) : (
              response?.data.map((inv) => (
                <InvoiceRow
                  key={inv.id}
                  invoice={inv}
                  selected={selectedIds.has(inv.id)}
                  onToggle={() => toggleSelect(inv.id)}
                  onDownload={() => handleDownload(inv.id)}
                  onDelete={() => handleDelete(inv.id)}
                  typeColors={typeColors}
                />
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {response && response.totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            Showing {(response.page - 1) * response.limit + 1}-
            {Math.min(response.page * response.limit, response.total)} of {response.total}
          </p>
          <div className="flex gap-2">
            <button
              disabled={response.page <= 1}
              onClick={() => setFilter((f) => ({ ...f, page: (f.page ?? 1) - 1 }))}
              className="rounded-lg border border-input p-2 hover:bg-muted disabled:opacity-50 transition-colors"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <span className="flex items-center px-3 text-sm">
              {response.page} / {response.totalPages}
            </span>
            <button
              disabled={response.page >= response.totalPages}
              onClick={() => setFilter((f) => ({ ...f, page: (f.page ?? 1) + 1 }))}
              className="rounded-lg border border-input p-2 hover:bg-muted disabled:opacity-50 transition-colors"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}

      {/* Rename modal */}
      {renameOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-card border border-border rounded-xl p-6 w-full max-w-lg max-h-[80vh] overflow-auto">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold">Bulk Rename</h2>
              <button onClick={() => { setRenameOpen(false); setRenamePreview(null); }}>
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="space-y-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">Filename Template</label>
                <input
                  type="text"
                  value={renameTemplate}
                  onChange={(e) => setRenameTemplate(e.target.value)}
                  className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                />
                <p className="text-xs text-muted-foreground">
                  Variables: {'{date}'}, {'{type}'}, {'{vin}'}, {'{vin:last6}'}, {'{site}'}, {'{amount}'}, {'{currency}'}, {'{seq}'}
                </p>
              </div>

              {!renamePreview ? (
                <button
                  onClick={handlePreviewRename}
                  disabled={renaming}
                  className="w-full rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
                >
                  {renaming ? 'Loading...' : 'Preview'}
                </button>
              ) : (
                <>
                  <div className="space-y-2 max-h-48 overflow-auto">
                    {renamePreview.map((p) => (
                      <div key={p.id} className="text-xs border border-border rounded p-2">
                        <p className="text-muted-foreground line-through">{p.oldName}</p>
                        <p className="text-foreground">{p.newName}</p>
                      </div>
                    ))}
                  </div>
                  <button
                    onClick={handleExecuteRename}
                    disabled={renaming}
                    className="w-full rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
                  >
                    {renaming ? 'Renaming...' : 'Apply Rename'}
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function SortHeader({
  label,
  field,
  currentSort,
  order,
  onSort,
}: {
  label: string;
  field: NonNullable<InvoiceFilter['sort']>;
  currentSort?: InvoiceFilter['sort'];
  order?: string;
  onSort: (field: NonNullable<InvoiceFilter['sort']>) => void;
}) {
  return (
    <th className="px-4 py-3 text-left font-medium text-muted-foreground">
      <button
        type="button"
        className="flex items-center gap-1 hover:text-foreground select-none"
        onClick={() => onSort(field)}
      >
        <span>{label}</span>
        <ArrowUpDown
          className={`h-3 w-3 ${currentSort === field ? 'text-primary' : 'opacity-40'}`}
        />
        {currentSort === field && (
          <span className="text-xs text-primary">{order === 'asc' ? '↑' : '↓'}</span>
        )}
      </button>
    </th>
  );
}

function InvoiceRow({
  invoice,
  selected,
  onToggle,
  onDownload,
  onDelete,
  typeColors,
}: {
  invoice: Invoice;
  selected: boolean;
  onToggle: () => void;
  onDownload: () => void;
  onDelete: () => void;
  typeColors: Record<string, string>;
}) {
  return (
    <tr className="border-b border-border last:border-0 hover:bg-muted/50 transition-colors">
      <td className="px-4 py-3">
        <input type="checkbox" checked={selected} onChange={onToggle} className="rounded" />
      </td>
      <td className="px-4 py-3 whitespace-nowrap">{formatDate(invoice.invoice_date)}</td>
      <td className="px-4 py-3">
        <span
          className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium capitalize ${
            typeColors[invoice.invoice_type] ?? ''
          }`}
        >
          {invoice.invoice_type}
        </span>
      </td>
      <td className="px-4 py-3 font-mono text-xs">
        {invoice.vin ? `...${invoice.vin.slice(-6)}` : '—'}
      </td>
      <td className="px-4 py-3 whitespace-nowrap">
        {invoice.amount_cents != null
          ? formatCurrency(invoice.amount_cents, invoice.currency)
          : '—'}
      </td>
      <td className="px-4 py-3 max-w-[200px] truncate">{invoice.site_name ?? '—'}</td>
      <td className="px-4 py-3">{invoice.energy_kwh?.toFixed(1) ?? '—'}</td>
      <td className="px-4 py-3">
        <div className="flex items-center justify-end gap-1">
          <button
            onClick={onDownload}
            className="p-1.5 rounded hover:bg-muted transition-colors"
            title="Download"
          >
            <Download className="h-4 w-4" />
          </button>
          <button
            onClick={onDelete}
            className="p-1.5 rounded hover:bg-muted text-destructive transition-colors"
            title="Delete"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      </td>
    </tr>
  );
}
