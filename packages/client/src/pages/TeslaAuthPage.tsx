import { useEffect, useState } from 'react';
import { settingsApi, teslaAuthApi, type TeslaAccountStatus, type TeslaAppConfig, type TokenCategoryStatus } from '../lib/api';
import { useToast } from '../hooks/useToast';
import { formatDateTime } from '../lib/utils';
import {
  Key,
  RefreshCw,
  ExternalLink,
  Trash2,
  Loader2,
  CheckCircle,
  XCircle,
  AlertTriangle,
  ClipboardPaste,
  Zap,
  MapPinned,
  Plus,
  Link2,
} from 'lucide-react';

const REGIONS = [
  { id: 'NA', name: 'North America / Asia-Pacific', endpoint: 'fleet-api.prd.na.vn.cloud.tesla.com' },
  { id: 'EU', name: 'Europe / Middle East / Africa', endpoint: 'fleet-api.prd.eu.vn.cloud.tesla.com' },
  { id: 'CN', name: 'China', endpoint: 'fleet-api.prd.cn.vn.cloud.tesla.cn' },
];

type AwaitingInfo = { accountId: number; kind: 'fleet' | 'ownership' } | null;

function TokenBadge({ cat }: { cat: TokenCategoryStatus | undefined }) {
  if (!cat?.hasToken) return <XCircle className="h-4 w-4 text-muted-foreground" />;
  if (cat.isExpired) return <AlertTriangle className="h-4 w-4 text-warning" />;
  return <CheckCircle className="h-4 w-4 text-success" />;
}

export function TeslaAuthPage() {
  const { toast } = useToast();
  const [accounts, setAccounts] = useState<TeslaAccountStatus[]>([]);
  const [appConfigs, setAppConfigs] = useState<TeslaAppConfig[]>([]);
  const [activeRegion, setActiveRegion] = useState<'NA' | 'EU' | 'CN'>('EU');
  const [loading, setLoading] = useState(true);
  const [actionKey, setActionKey] = useState<string | null>(null); // `${accountId}:${kind}`
  const [awaiting, setAwaiting] = useState<AwaitingInfo>(null);
  const [callbackUrl, setCallbackUrl] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [accountForm, setAccountForm] = useState({ name: '', appConfigId: '' });
  const [appConfigForm, setAppConfigForm] = useState({ name: '', clientId: '', clientSecret: '', redirectUri: 'http://localhost:8080/callback' });
  const [creatingAccount, setCreatingAccount] = useState(false);
  const [creatingAppConfig, setCreatingAppConfig] = useState(false);

  const loadStatus = async () => {
    try {
      const [accountData, appConfigData, settings] = await Promise.all([
        teslaAuthApi.status(),
        teslaAuthApi.appConfigs(),
        settingsApi.get(),
      ]);
      setAccounts(accountData);
      setAppConfigs(appConfigData);
      const configuredRegion = settings.TESLA_REGION?.value;
      if (configuredRegion === 'NA' || configuredRegion === 'EU' || configuredRegion === 'CN') {
        setActiveRegion(configuredRegion);
      }
    } catch {
      toast({ title: 'Failed to load token status', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadStatus(); }, []);

  const activeRegionAppConfigs = appConfigs.filter((appConfig) => appConfig.region === activeRegion);
  const activeAccounts = accounts.filter((account) => account.region === activeRegion);

  const handleCreateAccount = async () => {
    if (!accountForm.name.trim() || !accountForm.appConfigId) return;
    setCreatingAccount(true);
    try {
      await teslaAuthApi.createAccount({
        name: accountForm.name.trim(),
        region: activeRegion,
        appConfigId: Number(accountForm.appConfigId),
      });
      toast({ title: 'Tesla account added', variant: 'success' });
      setAccountForm({ name: '', appConfigId: '' });
      await loadStatus();
    } catch (err) {
      toast({
        title: 'Failed to add Tesla account',
        description: err instanceof Error ? err.message : 'Unknown error',
        variant: 'destructive',
      });
    } finally {
      setCreatingAccount(false);
    }
  };

  const handleCreateAppConfig = async () => {
    if (!appConfigForm.name.trim() || !appConfigForm.clientId.trim() || !appConfigForm.clientSecret.trim() || !appConfigForm.redirectUri.trim()) {
      return;
    }

    setCreatingAppConfig(true);
    try {
      await teslaAuthApi.createAppConfig({
        name: appConfigForm.name.trim(),
        region: activeRegion,
        clientId: appConfigForm.clientId.trim(),
        clientSecret: appConfigForm.clientSecret,
        redirectUri: appConfigForm.redirectUri.trim(),
      });
      toast({ title: 'Tesla app config added', variant: 'success' });
      setAppConfigForm({ name: '', clientId: '', clientSecret: '', redirectUri: appConfigForm.redirectUri.trim() });
      await loadStatus();
    } catch (err) {
      toast({
        title: 'Failed to add Tesla app config',
        description: err instanceof Error ? err.message : 'Unknown error',
        variant: 'destructive',
      });
    } finally {
      setCreatingAppConfig(false);
    }
  };

  const handleAuth = async (accountId: number, region: string, kind: 'fleet' | 'ownership') => {
    const key = `${accountId}:${kind}`;
    setActionKey(key);
    try {
      const { authUrl } = kind === 'fleet'
        ? await teslaAuthApi.initiate({ region, accountId })
        : await teslaAuthApi.initiateOwnership({ region, accountId });
      window.open(authUrl, '_blank', 'noopener,noreferrer');
      setAwaiting({ accountId, kind });
      setCallbackUrl('');
    } catch (err) {
      toast({
        title: 'Failed to start authentication',
        description: err instanceof Error ? err.message : 'Unknown error',
        variant: 'destructive',
      });
    } finally {
      setActionKey(null);
    }
  };

  const handleDeleteAccount = async (account: TeslaAccountStatus) => {
    if (!confirm(`Remove Tesla account "${account.name}"?`)) return;
    try {
      await teslaAuthApi.deleteAccount(account.id);
      toast({ title: 'Tesla account removed', variant: 'success' });
      await loadStatus();
    } catch (err) {
      toast({
        title: 'Failed to remove Tesla account',
        description: err instanceof Error ? err.message : 'Unknown error',
        variant: 'destructive',
      });
    }
  };

  const handleDeleteAppConfig = async (appConfig: TeslaAppConfig) => {
    if (!confirm(`Remove Tesla app config "${appConfig.name}"?`)) return;
    try {
      await teslaAuthApi.deleteAppConfig(appConfig.id);
      toast({ title: 'Tesla app config removed', variant: 'success' });
      await loadStatus();
    } catch (err) {
      toast({
        title: 'Failed to remove Tesla app config',
        description: err instanceof Error ? err.message : 'Unknown error',
        variant: 'destructive',
      });
    }
  };

  const handleManualCallback = async () => {
    if (!callbackUrl.trim() || !awaiting) return;
    setSubmitting(true);
    try {
      if (awaiting.kind === 'fleet') {
        await teslaAuthApi.manualCallback(callbackUrl.trim());
      } else {
        await teslaAuthApi.ownershipCallback(callbackUrl.trim());
      }
      toast({ title: 'Tesla authentication successful!', variant: 'success' });
      setAwaiting(null);
      setCallbackUrl('');
      loadStatus();
    } catch (err) {
      toast({
        title: 'Authentication failed',
        description: err instanceof Error ? err.message : 'Unknown error',
        variant: 'destructive',
      });
    } finally {
      setSubmitting(false);
    }
  };

  const handleRefresh = async (accountId: number, kind: 'fleet' | 'ownership') => {
    const key = `${accountId}:${kind}`;
    setActionKey(key);
    try {
      if (kind === 'fleet') {
        await teslaAuthApi.refresh(accountId);
      } else {
        await teslaAuthApi.refreshOwnership(accountId);
      }
      toast({ title: 'Token refreshed', variant: 'success' });
      loadStatus();
    } catch (err) {
      toast({
        title: 'Refresh failed',
        description: err instanceof Error ? err.message : 'Please re-authenticate',
        variant: 'destructive',
      });
    } finally {
      setActionKey(null);
    }
  };

  const handleRevoke = async (accountId: number, kind: 'fleet' | 'ownership') => {
    if (!confirm(`Remove ${kind} token for this Tesla account?`)) return;
    try {
      if (kind === 'fleet') {
        await teslaAuthApi.revoke(accountId);
      } else {
        await teslaAuthApi.revokeOwnership(accountId);
      }
      toast({ title: 'Token removed', variant: 'success' });
      if (awaiting?.accountId === accountId && awaiting.kind === kind) setAwaiting(null);
      loadStatus();
    } catch {
      toast({ title: 'Failed to remove token', variant: 'destructive' });
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }
  const activeRegionConfig = REGIONS.find((region) => region.id === activeRegion)!;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Tesla Authentication</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Authorise the Tesla region you selected in Settings. The app uses that region as the main connection target.
        </p>
      </div>

      <div className="rounded-xl border border-border bg-card p-5 space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="font-semibold flex items-center gap-2">
              <MapPinned className="h-4 w-4 text-primary" />
              Active Region: {activeRegionConfig.id}
              <span className="text-xs font-normal text-muted-foreground">&ndash; {activeRegionConfig.name}</span>
            </h2>
            <p className="text-xs text-muted-foreground mt-0.5 font-mono">{activeRegionConfig.endpoint}</p>
          </div>
          <div className="rounded-lg border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
            Change region in Settings → Tesla API → Default Region
          </div>
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <div className="rounded-lg border border-dashed border-border p-4 space-y-3">
            <div>
              <h3 className="font-medium flex items-center gap-2"><Key className="h-4 w-4 text-primary" />Tesla developer app configs</h3>
              <p className="mt-1 text-xs text-muted-foreground">Reuse one config across multiple Tesla accounts, or create separate configs when the client credentials differ.</p>
            </div>

            <div className="space-y-3">
              <input
                type="text"
                value={appConfigForm.name}
                onChange={(event) => setAppConfigForm((current) => ({ ...current, name: event.target.value }))}
                placeholder="Tesla App Config A"
                className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              />
              <input
                type="text"
                value={appConfigForm.clientId}
                onChange={(event) => setAppConfigForm((current) => ({ ...current, clientId: event.target.value }))}
                placeholder="Client ID"
                className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              />
              <input
                type="password"
                value={appConfigForm.clientSecret}
                onChange={(event) => setAppConfigForm((current) => ({ ...current, clientSecret: event.target.value }))}
                placeholder="Client Secret"
                className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              />
              <input
                type="text"
                value={appConfigForm.redirectUri}
                onChange={(event) => setAppConfigForm((current) => ({ ...current, redirectUri: event.target.value }))}
                placeholder="Redirect URI"
                className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              />
              <button
                onClick={handleCreateAppConfig}
                disabled={creatingAppConfig || !appConfigForm.name.trim() || !appConfigForm.clientId.trim() || !appConfigForm.clientSecret.trim() || !appConfigForm.redirectUri.trim()}
                className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors flex items-center gap-2 disabled:opacity-50"
              >
                {creatingAppConfig ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                Add App Config
              </button>
            </div>

            <div className="space-y-2">
              {activeRegionAppConfigs.map((appConfig) => (
                <div key={appConfig.id} className="rounded-lg border border-border bg-background px-3 py-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-medium">{appConfig.name}</p>
                      <p className="mt-1 text-xs text-muted-foreground truncate">{appConfig.client_id}</p>
                      <p className="mt-1 text-xs text-muted-foreground truncate">{appConfig.redirect_uri}</p>
                    </div>
                    <button onClick={() => handleDeleteAppConfig(appConfig)} className="rounded-md border border-destructive/30 px-2 py-1 text-xs text-destructive hover:bg-destructive/10 transition-colors">
                      Remove
                    </button>
                  </div>
                </div>
              ))}
              {activeRegionAppConfigs.length === 0 && (
                <p className="text-xs text-muted-foreground">No Tesla developer app configs exist for this region yet. Create one here before adding Tesla accounts.</p>
              )}
            </div>
          </div>

          <div className="rounded-lg border border-dashed border-border p-4 space-y-3">
            <div>
              <h3 className="font-medium flex items-center gap-2"><Link2 className="h-4 w-4 text-primary" />Tesla accounts</h3>
              <p className="mt-1 text-xs text-muted-foreground">Create one Tesla account per external Tesla login and link it to a reusable app config when needed.</p>
            </div>

            <div className="space-y-3">
              <input
                type="text"
                value={accountForm.name}
                onChange={(event) => setAccountForm((current) => ({ ...current, name: event.target.value }))}
                placeholder="Personal Tesla account"
                className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              />
              <select
                value={accountForm.appConfigId}
                onChange={(event) => setAccountForm((current) => ({ ...current, appConfigId: event.target.value }))}
                className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              >
                <option value="">Select Tesla app config</option>
                {activeRegionAppConfigs.map((appConfig) => (
                  <option key={appConfig.id} value={String(appConfig.id)}>{appConfig.name}</option>
                ))}
              </select>
              <button
                onClick={handleCreateAccount}
                disabled={creatingAccount || !accountForm.name.trim() || !accountForm.appConfigId}
                className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors flex items-center gap-2 disabled:opacity-50"
              >
                {creatingAccount ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                Add Account
              </button>
            </div>
          </div>
        </div>

        {activeAccounts.length === 0 ? (
          <div className="rounded-lg border border-border bg-muted/20 px-4 py-6 text-center text-sm text-muted-foreground">
            No Tesla accounts configured yet for {activeRegion}. Add an account above, then authenticate the token types you need.
          </div>
        ) : (
          <div className="space-y-4">
            {activeAccounts.map((account) => (
              <div key={account.id} className="rounded-lg border border-border p-4 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h3 className="font-medium">{account.name}</h3>
                    <p className="text-xs text-muted-foreground">
                      {account.app_config_name
                        ? `Uses developer app config: ${account.app_config_name}`
                        : 'No Tesla developer app config is linked.'}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="rounded-lg border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
                      Account #{account.id}
                    </div>
                    <button onClick={() => handleDeleteAccount(account)} className="rounded-md border border-destructive/30 px-2 py-1 text-xs text-destructive hover:bg-destructive/10 transition-colors">
                      Remove
                    </button>
                  </div>
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <TokenSection
                    label="Fleet API"
                    description="Supercharger invoices"
                    cat={account.fleet}
                    isLoading={actionKey === `${account.id}:fleet`}
                    isAwaiting={awaiting?.accountId === account.id && awaiting.kind === 'fleet'}
                    onAuth={() => handleAuth(account.id, account.region, 'fleet')}
                    onRefresh={() => handleRefresh(account.id, 'fleet')}
                    onRevoke={() => handleRevoke(account.id, 'fleet')}
                  />

                  <TokenSection
                    label="Ownership API"
                    description="Premium Connectivity invoices"
                    cat={account.ownership}
                    isLoading={actionKey === `${account.id}:ownership`}
                    isAwaiting={awaiting?.accountId === account.id && awaiting.kind === 'ownership'}
                    onAuth={() => handleAuth(account.id, account.region, 'ownership')}
                    onRefresh={() => handleRefresh(account.id, 'ownership')}
                    onRevoke={() => handleRevoke(account.id, 'ownership')}
                  />
                </div>

                {awaiting?.accountId === account.id && (
                  <PasteFlow
                    kind={awaiting.kind}
                    callbackUrl={callbackUrl}
                    onChange={setCallbackUrl}
                    onSubmit={handleManualCallback}
                    onCancel={() => { setAwaiting(null); setCallbackUrl(''); }}
                    submitting={submitting}
                  />
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Setup instructions */}
      <div className="rounded-xl border border-border bg-card p-5">
        <h2 className="font-semibold flex items-center gap-2 mb-3">
          <Key className="h-4 w-4" />
          Setup Instructions
        </h2>
        <ol className="text-sm text-muted-foreground space-y-2 list-decimal list-inside">
          <li>Register an application at{' '}
            <a href="https://developer.tesla.com" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
              developer.tesla.com
            </a>
          </li>
          <li>
            Set the redirect URI to exactly{' '}
            <code className="text-xs bg-muted px-1 py-0.5 rounded">http://localhost:8080/callback</code>
          </li>
          <li>Create a Tesla developer app config on this page with the Client ID, Client Secret, and redirect URI for that Tesla app registration</li>
          <li>
            Select your operating region in Settings and keep it consistent with the Tesla accounts and vehicles you add.
          </li>
          <li>
            Add reusable Tesla app configs when different Tesla accounts require different `Client ID` and `Client Secret` values.
          </li>
          <li>
            Add one Tesla account for each Tesla login you want to use, and link each account to the correct Tesla app config. Vehicles on the same Tesla login can reuse the same account entry.
          </li>
          <li>
            <strong>Fleet API:</strong> Click <em>Authenticate</em> under Fleet API for the Tesla account you want to connect — Tesla login opens in a new tab.
            After authorising, copy the full URL from your browser&apos;s address bar and paste it back here.
          </li>
          <li>
            <strong>Ownership API:</strong> Click <em>Authenticate</em> under Ownership API for the Tesla account you want to connect — Tesla login opens in a new tab.
            After authorising, Tesla redirects to a blank page at{' '}
            <code className="text-xs bg-muted px-1 py-0.5 rounded">auth.tesla.com/void/callback</code>.
            Copy that URL and paste it here.
          </li>
          <li>Every Tesla account must be linked to a Tesla developer app config for Fleet authentication and token refresh</li>
          <li>Tokens auto-refresh; manual refresh is available if Tesla rejects a refresh attempt</li>
        </ol>
      </div>
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

interface TokenSectionProps {
  label: string;
  description: string;
  cat: TokenCategoryStatus | undefined;
  isLoading: boolean;
  isAwaiting: boolean;
  onAuth: () => void;
  onRefresh: () => void;
  onRevoke: () => void;
}

function TokenSection({ label, description, cat, isLoading, isAwaiting, onAuth, onRefresh, onRevoke }: TokenSectionProps) {
  const hasToken = cat?.hasToken ?? false;
  const isExpired = cat?.isExpired ?? false;

  return (
    <div className="rounded-lg border border-border p-3 space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <TokenBadge cat={cat} />
          <div>
            <p className="text-sm font-medium">{label}</p>
            <p className="text-xs text-muted-foreground">{description}</p>
          </div>
        </div>
      </div>

      {hasToken && cat?.expiresAt && (
        <p className={`text-xs ${isExpired ? 'text-warning' : 'text-muted-foreground'}`}>
          {isExpired ? 'Expired' : 'Expires'}: {formatDateTime(cat.expiresAt)}
        </p>
      )}

      <div className="flex gap-2">
        {hasToken ? (
          <>
            <button
              onClick={onRefresh}
              disabled={isLoading}
              className="rounded-md border border-input px-2 py-1.5 text-xs font-medium hover:bg-muted transition-colors flex items-center gap-1.5 disabled:opacity-50"
            >
              {isLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
              Refresh
            </button>
            <button
              onClick={onRevoke}
              className="rounded-md border border-destructive/30 px-2 py-1.5 text-xs font-medium text-destructive hover:bg-destructive/10 transition-colors flex items-center gap-1.5"
            >
              <Trash2 className="h-3 w-3" />
              Revoke
            </button>
          </>
        ) : (
          <button
            onClick={onAuth}
            disabled={isLoading || isAwaiting}
            className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 transition-colors flex items-center gap-1.5 disabled:opacity-50"
          >
            {isLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : <ExternalLink className="h-3 w-3" />}
            {isAwaiting ? 'Waiting…' : 'Authenticate'}
          </button>
        )}
      </div>
    </div>
  );
}

interface PasteFlowProps {
  kind: 'fleet' | 'ownership';
  callbackUrl: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  onCancel: () => void;
  submitting: boolean;
}

function PasteFlow({ kind, callbackUrl, onChange, onSubmit, onCancel, submitting }: PasteFlowProps) {
  const isFleet = kind === 'fleet';
  const expectedPrefix = isFleet ? 'http://localhost:8080/callback' : 'https://auth.tesla.com/void/callback';

  return (
    <div className="border-t border-border pt-4 space-y-3">
      <div className="flex items-start gap-2">
        {isFleet
          ? <ClipboardPaste className="h-4 w-4 mt-0.5 text-primary shrink-0" />
          : <Zap className="h-4 w-4 mt-0.5 text-primary shrink-0" />
        }
        <div className="text-sm text-muted-foreground">
          <p>
            Tesla has opened in a new tab. After you log in, your browser will be redirected to a URL
            that starts with{' '}
            <code className="text-xs bg-muted px-1 py-0.5 rounded">{expectedPrefix}</code>.
          </p>
          <p className="mt-1">
            {isFleet
              ? "That page won't load — that's expected. "
              : "That page shows a blank Tesla page — that's expected. "
            }
            Copy the full URL from your browser&apos;s address bar and paste it below.
          </p>
        </div>
      </div>

      <div className="flex gap-2">
        <input
          type="text"
          value={callbackUrl}
          onChange={(e) => onChange(e.target.value)}
          placeholder={`${expectedPrefix}?code=…&state=…`}
          className="flex-1 rounded-lg border border-input bg-background px-3 py-2 text-sm font-mono placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
          onKeyDown={(e) => { if (e.key === 'Enter') onSubmit(); }}
        />
        <button
          onClick={onSubmit}
          disabled={submitting || !callbackUrl.trim()}
          className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors flex items-center gap-2 disabled:opacity-50 shrink-0"
        >
          {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle className="h-4 w-4" />}
          Complete
        </button>
        <button
          onClick={onCancel}
          className="rounded-lg border border-input px-3 py-2 text-sm font-medium hover:bg-muted transition-colors"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
