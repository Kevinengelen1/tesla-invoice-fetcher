import { useEffect, useState, type FormEvent } from 'react';
import { settingsApi, teslaAuthApi, vehicleApi, type TeslaAccountStatus, type Vehicle } from '../lib/api';
import { useToast } from '../hooks/useToast';
import { formatDateTime } from '../lib/utils';
import { Plus, Trash2, Loader2, X, Car, MapPinned } from 'lucide-react';
import { SortableHeader, type SortDirection } from '../components/SortableHeader';
import { sortBy } from '../lib/sort';

type Region = 'NA' | 'EU' | 'CN';
type VehicleSortField = 'name' | 'vin' | 'region' | 'account_name' | 'enabled' | 'created_at';

export function VehiclesPage() {
  const { toast } = useToast();
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [loading, setLoading] = useState(true);
  const [addOpen, setAddOpen] = useState(false);
  const [configuredRegion, setConfiguredRegion] = useState<Region>('EU');
  const [accounts, setAccounts] = useState<TeslaAccountStatus[]>([]);
  const [formData, setFormData] = useState<{ vin: string; name: string; region: Region; account_id: number | null }>({ vin: '', name: '', region: 'EU', account_id: null });
  const [submitting, setSubmitting] = useState(false);
  const [sortField, setSortField] = useState<VehicleSortField>('created_at');
  const [sortOrder, setSortOrder] = useState<SortDirection>('desc');

  const loadVehicles = async () => {
    try {
      const [data, settings, accountData] = await Promise.all([
        vehicleApi.list(),
        settingsApi.get(),
        teslaAuthApi.status(),
      ]);
      setVehicles(data);
      setAccounts(accountData);

      const region = settings.TESLA_REGION?.value;
      let resolvedAccountId: number | null = null;
      if (region === 'NA' || region === 'EU' || region === 'CN') {
        setConfiguredRegion(region);
        resolvedAccountId = accountData.find((account) => account.region === region)?.id ?? null;
        setFormData((currentFormData) => ({ ...currentFormData, region, account_id: resolvedAccountId }));
      }
    } catch {
      toast({ title: 'Failed to load vehicles', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadVehicles();
  }, []);

  const handleAdd = async (e: FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      await vehicleApi.create(formData);
      toast({ title: 'Vehicle added', variant: 'success' });
      setAddOpen(false);
      setFormData({ vin: '', name: '', region: configuredRegion, account_id: accounts.find((account) => account.region === configuredRegion)?.id ?? null });
      loadVehicles();
    } catch (err) {
      toast({
        title: 'Failed to add vehicle',
        description: err instanceof Error ? err.message : 'Unknown error',
        variant: 'destructive',
      });
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (id: number) => {
    if (!confirm('Remove this vehicle?')) return;
    try {
      await vehicleApi.delete(id);
      toast({ title: 'Vehicle removed', variant: 'success' });
      loadVehicles();
    } catch {
      toast({ title: 'Failed to remove vehicle', variant: 'destructive' });
    }
  };

  const handleToggle = async (vehicle: Vehicle) => {
    try {
      await vehicleApi.update(vehicle.id, { enabled: vehicle.enabled ? 0 : 1 });
      loadVehicles();
    } catch {
      toast({ title: 'Failed to update vehicle', variant: 'destructive' });
    }
  };

  const handleAccountChange = async (vehicle: Vehicle, accountId: number | null) => {
    try {
      await vehicleApi.update(vehicle.id, { account_id: accountId });
      toast({ title: 'Vehicle account updated', variant: 'success' });
      loadVehicles();
    } catch (err) {
      toast({
        title: 'Failed to update vehicle account',
        description: err instanceof Error ? err.message : 'Unknown error',
        variant: 'destructive',
      });
    }
  };

  const handleSort = (field: VehicleSortField) => {
    setSortOrder((current) => (sortField === field && current === 'desc' ? 'asc' : 'desc'));
    setSortField(field);
  };

  const sortedVehicles = sortBy(vehicles, sortOrder, (vehicle) => {
    switch (sortField) {
      case 'name':
        return vehicle.name ?? '';
      case 'vin':
        return vehicle.vin;
      case 'region':
        return vehicle.region;
      case 'account_name':
        return vehicle.account_name ?? '';
      case 'enabled':
        return vehicle.enabled;
      case 'created_at':
        return vehicle.created_at;
    }
  });

  const regionAccounts = accounts.filter((account) => account.region === configuredRegion);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Vehicles</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            New vehicles default to the configured Tesla region: <span className="font-medium text-foreground">{configuredRegion}</span>
          </p>
        </div>
        <button
          onClick={() => setAddOpen(true)}
          className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors flex items-center gap-2"
        >
          <Plus className="h-4 w-4" />
          Add Vehicle
        </button>
      </div>

      {vehicles.length === 0 ? (
        <div className="rounded-xl border border-border bg-card p-12 text-center">
          <Car className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
          <h2 className="text-lg font-semibold">No vehicles</h2>
          <p className="text-sm text-muted-foreground mt-1">
            Add a vehicle to start fetching invoices.
          </p>
        </div>
      ) : (
        <div className="rounded-xl border border-border bg-card overflow-x-auto">
          <table className="w-full min-w-[1020px] text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/40 text-xs text-muted-foreground">
                <SortableHeader label="Name" field="name" currentSort={sortField} order={sortOrder} onSort={handleSort} />
                <SortableHeader label="VIN" field="vin" currentSort={sortField} order={sortOrder} onSort={handleSort} />
                <SortableHeader label="Region" field="region" currentSort={sortField} order={sortOrder} onSort={handleSort} />
                <SortableHeader label="Tesla Account" field="account_name" currentSort={sortField} order={sortOrder} onSort={handleSort} />
                <SortableHeader label="Enabled" field="enabled" currentSort={sortField} order={sortOrder} onSort={handleSort} align="right" />
                <SortableHeader label="Created" field="created_at" currentSort={sortField} order={sortOrder} onSort={handleSort} />
                <th className="px-4 py-3 text-right font-medium text-muted-foreground">Actions</th>
              </tr>
            </thead>
            <tbody>
              {sortedVehicles.map((vehicle) => (
                <tr key={vehicle.id} className="border-b border-border last:border-0 align-top">
                  <td className="px-4 py-3">
                    <div>
                      <p className="font-medium">{vehicle.name || 'Unnamed Vehicle'}</p>
                      <p className="text-xs text-muted-foreground">{vehicle.enabled ? 'Active' : 'Disabled'}</p>
                    </div>
                  </td>
                  <td className="px-4 py-3 font-mono text-xs">{vehicle.vin}</td>
                  <td className="px-4 py-3">
                    <span
                      className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${
                        vehicle.region === 'EU'
                          ? 'bg-primary/10 text-primary'
                          : vehicle.region === 'NA'
                            ? 'bg-success/10 text-success'
                            : 'bg-warning/10 text-warning'
                      }`}
                    >
                      {vehicle.region}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <select
                      value={vehicle.account_id ?? ''}
                      onChange={(event) => handleAccountChange(vehicle, event.target.value ? Number(event.target.value) : null)}
                      className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                    >
                      <option value="">No account assigned</option>
                      {accounts.filter((account) => account.region === vehicle.region).map((account) => (
                        <option key={account.id} value={account.id}>{account.name}</option>
                      ))}
                    </select>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      onClick={() => handleToggle(vehicle)}
                      className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${
                        vehicle.enabled ? 'bg-primary' : 'bg-muted'
                      }`}
                    >
                      <span
                        className={`pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow-lg transform transition-transform ${
                          vehicle.enabled ? 'translate-x-5' : 'translate-x-0'
                        }`}
                      />
                    </button>
                  </td>
                  <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">{formatDateTime(vehicle.created_at)}</td>
                  <td className="px-4 py-3">
                    <div className="flex justify-end">
                      <button
                        onClick={() => handleDelete(vehicle.id)}
                        className="inline-flex items-center gap-2 rounded-lg border border-destructive/30 px-3 py-2 text-sm font-medium text-destructive transition-colors hover:bg-destructive/10"
                        title="Remove"
                      >
                        <Trash2 className="h-4 w-4" />
                        Remove
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Add vehicle modal */}
      {addOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-card border border-border rounded-xl p-6 w-full max-w-md">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold">Add Vehicle</h2>
              <button onClick={() => setAddOpen(false)}>
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={handleAdd} className="space-y-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">VIN</label>
                <input
                  type="text"
                  value={formData.vin}
                  onChange={(e) =>
                    setFormData((f) => ({ ...f, vin: e.target.value.toUpperCase() }))
                  }
                  className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-ring"
                  placeholder="5YJ3E1EA1NF..."
                  required
                  maxLength={17}
                  pattern="[A-HJ-NPR-Z0-9]{11,17}"
                  title="Valid VIN (11-17 alphanumeric characters, no I, O, Q)"
                />
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium">Name (optional)</label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={(e) => setFormData((f) => ({ ...f, name: e.target.value }))}
                  className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                  placeholder="My Model 3"
                />
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium">Region</label>
                <div className="flex items-center gap-2 rounded-lg border border-input bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
                  <MapPinned className="h-4 w-4 text-primary" />
                  <span>{configuredRegion}</span>
                  <span className="text-xs">Configured in Settings</span>
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium">Tesla account</label>
                <select
                  value={formData.account_id ?? ''}
                  onChange={(e) => setFormData((f) => ({ ...f, account_id: e.target.value ? Number(e.target.value) : null }))}
                  className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                >
                  <option value="">No account assigned</option>
                  {regionAccounts.map((account) => (
                    <option key={account.id} value={account.id}>{account.name}</option>
                  ))}
                </select>
                <p className="text-xs text-muted-foreground">
                  Vehicles on the same Tesla login can reuse the same account.
                </p>
              </div>

              <button
                type="submit"
                disabled={submitting}
                className="w-full rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
              >
                {submitting ? 'Adding...' : 'Add Vehicle'}
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
