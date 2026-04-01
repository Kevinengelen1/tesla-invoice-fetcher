import { useEffect, useState } from 'react';
import { settingsApi, type SettingEntry } from '../lib/api';
import { useAuth } from '../hooks/useAuth';
import { useToast } from '../hooks/useToast';
import { Loader2, Save, Send, Zap, HardDrive, Mail, Clock, Shield, Database } from 'lucide-react';

const TABS = [
  {
    id: 'tesla',
    label: 'Tesla API',
    icon: Zap,
    keys: ['TESLA_REGION'],
  },
  {
    id: 'storage',
    label: 'Storage',
    icon: HardDrive,
    keys: ['INVOICE_STORAGE_DIR', 'INVOICE_FILENAME_TEMPLATE'],
  },
  {
    id: 'email',
    label: 'Email',
    icon: Mail,
    keys: ['EMAIL_ENABLED', 'EMAIL_TO', 'EMAIL_FROM', 'SMTP_HOST', 'SMTP_PORT', 'SMTP_SECURE', 'SMTP_USER', 'SMTP_PASS'],
  },
  {
    id: 'schedule',
    label: 'Schedule',
    icon: Clock,
    keys: ['FETCH_SCHEDULE_CRON', 'AUTO_FETCH_ENABLED'],
  },
  {
    id: 'oidc',
    label: 'SSO / OIDC',
    icon: Shield,
    keys: ['OIDC_ENABLED', 'OIDC_ISSUER', 'OIDC_CLIENT_ID', 'OIDC_CLIENT_SECRET', 'OIDC_REDIRECT_URI'],
  },
];

const LABELS: Record<string, string> = {
  TESLA_REGION: 'Default Region',
  INVOICE_STORAGE_DIR: 'Storage Directory',
  INVOICE_FILENAME_TEMPLATE: 'Filename Template',
  DATABASE_TYPE: 'Database Type (sqlite or mysql)',
  MYSQL_HOST: 'MySQL Host',
  MYSQL_PORT: 'MySQL Port',
  MYSQL_USER: 'MySQL Username',
  MYSQL_PASS: 'MySQL Password',
  MYSQL_DATABASE: 'MySQL Database Name',
  EMAIL_ENABLED: 'Enable Email',
  EMAIL_TO: 'Send To',
  EMAIL_FROM: 'From Address',
  SMTP_HOST: 'SMTP Host',
  SMTP_PORT: 'SMTP Port',
  SMTP_SECURE: 'Use TLS',
  SMTP_USER: 'SMTP Username',
  SMTP_PASS: 'SMTP Password',
  FETCH_SCHEDULE_CRON: 'Cron Expression',
  AUTO_FETCH_ENABLED: 'Enable Auto-fetch',
  OIDC_ENABLED: 'Enable SSO Login',
  OIDC_ISSUER: 'Issuer URL',
  OIDC_CLIENT_ID: 'Client ID',
  OIDC_CLIENT_SECRET: 'Client Secret',
  OIDC_REDIRECT_URI: 'Redirect URI',
};

const SENSITIVE_KEYS = new Set(['SMTP_PASS', 'OIDC_CLIENT_SECRET', 'MYSQL_PASS']);
const BOOLEAN_KEYS = new Set(['EMAIL_ENABLED', 'SMTP_SECURE', 'AUTO_FETCH_ENABLED', 'OIDC_ENABLED']);

const SCHEDULE_PRESETS = [
  {
    label: 'Every hour',
    description: 'Runs at the start of every hour.',
    cron: '0 * * * *',
    autoFetchEnabled: 'true',
  },
  {
    label: 'Daily 06:00',
    description: 'Runs every morning at 06:00.',
    cron: '0 6 * * *',
    autoFetchEnabled: 'true',
  },
  {
    label: 'Weekdays 06:00',
    description: 'Runs Monday to Friday at 06:00.',
    cron: '0 6 * * 1-5',
    autoFetchEnabled: 'true',
  },
  {
    label: 'Monthly 07:00',
    description: 'Runs on the first day of the month at 07:00.',
    cron: '0 7 1 * *',
    autoFetchEnabled: 'true',
  },
  {
    label: 'Manual only',
    description: 'Disables automatic fetching.',
    cron: '',
    autoFetchEnabled: 'false',
  },
];

export function SettingsPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [settings, setSettings] = useState<Record<string, SettingEntry>>({});
  const [edited, setEdited] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testingEmail, setTestingEmail] = useState(false);
  const [activeTab, setActiveTab] = useState('tesla');

  const isAdmin = user?.role === 'admin';

  useEffect(() => {
    loadSettings();
  }, []);

  const loadSettings = async () => {
    try {
      const data = await settingsApi.get();
      setSettings(data);
    } catch {
      toast({ title: 'Failed to load settings', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  const handleChange = (key: string, value: string) => {
    setEdited((prev) => {
      if (SENSITIVE_KEYS.has(key) && value === '') {
        const { [key]: _removed, ...rest } = prev;
        return rest;
      }
      return { ...prev, [key]: value };
    });
  };

  const applySchedulePreset = (cron: string, autoFetchEnabled: string) => {
    setEdited((prev) => ({
      ...prev,
      FETCH_SCHEDULE_CRON: cron,
      AUTO_FETCH_ENABLED: autoFetchEnabled,
    }));
  };

  const getValue = (key: string) => {
    if (key in edited) return edited[key];
    return settings[key]?.value ?? '';
  };

  const hasChanges = Object.keys(edited).length > 0;

  const handleSave = async () => {
    if (!hasChanges) return;
    setSaving(true);
    try {
      const result = await settingsApi.update(edited);
      toast({
        title: 'Settings saved',
        description: `Updated: ${result.updated.join(', ')}`,
        variant: 'success',
      });
      setEdited({});
      loadSettings();
    } catch (err) {
      toast({
        title: 'Failed to save settings',
        description: err instanceof Error ? err.message : 'Unknown error',
        variant: 'destructive',
      });
    } finally {
      setSaving(false);
    }
  };

  const handleTestEmail = async () => {
    setTestingEmail(true);
    try {
      await settingsApi.testEmail();
      toast({ title: 'Test email sent!', variant: 'success' });
    } catch (err) {
      toast({
        title: 'Test email failed',
        description: err instanceof Error ? err.message : 'Check SMTP settings',
        variant: 'destructive',
      });
    } finally {
      setTestingEmail(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-3xl">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Settings</h1>
        {isAdmin && hasChanges && (
          <button
            onClick={handleSave}
            disabled={saving}
            className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors flex items-center gap-2 disabled:opacity-50"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            Save Changes
          </button>
        )}
      </div>

      {!isAdmin && (
        <div className="rounded-lg border border-warning/30 bg-warning/5 px-4 py-3 text-sm text-warning">
          Settings are read-only for non-admin users.
        </div>
      )}

      {/* Tab bar */}
      <div className="flex gap-1 border-b border-border overflow-x-auto">
        {TABS.map((tab) => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium whitespace-nowrap border-b-2 transition-colors ${
                activeTab === tab.id
                  ? 'border-primary text-foreground'
                  : 'border-transparent text-muted-foreground hover:text-foreground'
              }`}
            >
              <Icon className="h-4 w-4" />
              {tab.label}
            </button>
          );
        })}
        <button
          onClick={() => setActiveTab('database')}
          className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium whitespace-nowrap border-b-2 transition-colors ${
            activeTab === 'database'
              ? 'border-primary text-foreground'
              : 'border-transparent text-muted-foreground hover:text-foreground'
          }`}
        >
          <Database className="h-4 w-4" />
          Database
        </button>
      </div>

      {/* Tab content */}
      {TABS.map((tab) =>
        activeTab !== tab.id ? null : (
          <div key={tab.id} className="rounded-xl border border-border bg-card p-5">
            <h2 className="font-semibold mb-4">{tab.label}</h2>
            {tab.id === 'tesla' && (
              <div className="mb-4 rounded-lg border border-border bg-muted/30 px-4 py-3 text-sm text-muted-foreground">
                Tesla developer app configs are managed on the Tesla Authentication page. Only the active Tesla region is configured here.
              </div>
            )}
            <div className="space-y-4">
              {tab.keys.map((key) => {
                const entry = settings[key];
                const value = getValue(key);
                const isEdited = key in edited;

                return (
                  <div key={key} className="grid grid-cols-1 sm:grid-cols-3 gap-2 items-start">
                    <div>
                      <label className="text-sm font-medium">{LABELS[key] ?? key}</label>
                      {entry && (
                        <p className="text-xs text-muted-foreground">
                          Source: {isEdited ? 'modified' : entry.source}
                        </p>
                      )}
                    </div>
                    <div className="sm:col-span-2">
                      {BOOLEAN_KEYS.has(key) ? (
                        <button
                          type="button"
                          disabled={!isAdmin}
                          onClick={() => handleChange(key, value === 'true' ? 'false' : 'true')}
                          className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                            value === 'true' ? 'bg-primary' : 'bg-muted'
                          }`}
                        >
                          <span
                            className={`pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow-lg transform transition-transform ${
                              value === 'true' ? 'translate-x-5' : 'translate-x-0'
                            }`}
                          />
                        </button>
                      ) : (
                        <input
                          type={SENSITIVE_KEYS.has(key) ? 'password' : 'text'}
                          value={value}
                          onChange={(e) => handleChange(key, e.target.value)}
                          disabled={!isAdmin}
                          placeholder={entry?.writeOnly
                            ? entry.hasValue
                              ? 'Stored secret configured. Enter a new value to rotate it.'
                              : 'Enter a secret value'
                            : undefined}
                          className={`w-full rounded-lg border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50 disabled:cursor-not-allowed ${
                            isEdited ? 'border-primary' : 'border-input'
                          }`}
                        />
                      )}
                      {entry?.writeOnly && (
                        <p className="mt-1 text-xs text-muted-foreground">
                          Write-only secret. Leave blank to keep the current stored value.
                        </p>
                      )}
                    </div>
                  </div>
                );
              })}

              {tab.id === 'email' && (
                <div className="pt-2">
                  <button
                    onClick={handleTestEmail}
                    disabled={testingEmail}
                    className="rounded-lg border border-input px-3 py-2 text-sm font-medium hover:bg-muted transition-colors flex items-center gap-2 disabled:opacity-50"
                  >
                    {testingEmail ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Send className="h-4 w-4" />
                    )}
                    Send Test Email
                  </button>
                </div>
              )}

              {tab.id === 'schedule' && (
                <div className="space-y-4 pt-2">
                  <div className="rounded-lg border border-border bg-muted/30 p-4">
                    <p className="text-sm font-medium">Schedule helper</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Pick a common schedule to prefill the cron expression, then fine-tune it if needed.
                    </p>
                    <div className="mt-3 grid gap-3 sm:grid-cols-2">
                      {SCHEDULE_PRESETS.map((preset) => (
                        <button
                          key={preset.label}
                          type="button"
                          disabled={!isAdmin}
                          onClick={() => applySchedulePreset(preset.cron, preset.autoFetchEnabled)}
                          className="rounded-lg border border-input bg-background px-3 py-3 text-left transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          <p className="text-sm font-medium">{preset.label}</p>
                          <p className="mt-1 text-xs text-muted-foreground">{preset.description}</p>
                          <p className="mt-2 font-mono text-xs text-muted-foreground">
                            {preset.cron || 'Auto-fetch disabled'}
                          </p>
                        </button>
                      ))}
                    </div>
                  </div>

                  <p className="text-xs text-muted-foreground">
                    Use a standard 5-field cron expression: minute hour day-of-month month day-of-week.
                    Example: <span className="font-mono">0 6 * * 1-5</span> runs at 06:00 on weekdays.
                  </p>
                </div>
              )}

              {tab.id === 'oidc' && (
                <p className="text-xs text-muted-foreground pt-2">
                  When SSO Login is enabled and configured, users can sign in via your identity provider on the login page.
                  Restart the server after changing these settings.
                </p>
              )}
            </div>
          </div>
        )
      )}

      {/* Database tab (read-only — these are env-only settings) */}
      {activeTab === 'database' && (
        <div className="rounded-xl border border-border bg-card p-5">
          <h2 className="font-semibold mb-2">Database</h2>
          <p className="text-xs text-muted-foreground mb-4">
            Database connection settings can only be changed via environment variables (<code>.env</code> file).
            Restart the server after changing these values.
          </p>
          <div className="space-y-3">
            {[
              { key: 'DATABASE_TYPE', label: 'Database Type', fallback: 'sqlite' },
              { key: 'DATABASE_PATH', label: 'SQLite Path', fallback: './data/tesla-invoices.sqlite' },
              { key: 'MYSQL_HOST', label: 'MySQL Host', fallback: 'localhost' },
              { key: 'MYSQL_PORT', label: 'MySQL Port', fallback: '3306' },
              { key: 'MYSQL_USER', label: 'MySQL Username', fallback: '' },
              { key: 'MYSQL_DATABASE', label: 'MySQL Database', fallback: 'tesla_invoices' },
            ].map(({ key, label, fallback }) => (
              <div key={key} className="grid grid-cols-1 sm:grid-cols-3 gap-2 items-center">
                <label className="text-sm font-medium">{label}</label>
                <div className="sm:col-span-2">
                  <input
                    type="text"
                    value={settings[key]?.value ?? fallback}
                    disabled
                    className="w-full rounded-lg border border-input bg-muted/50 px-3 py-2 text-sm opacity-70 cursor-not-allowed"
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
