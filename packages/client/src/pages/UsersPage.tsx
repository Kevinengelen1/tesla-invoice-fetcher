import { useEffect, useState, type FormEvent } from 'react';
import { Loader2, RefreshCw, Save, Shield, Trash2, UserPlus } from 'lucide-react';
import { usersApi, type AdminUser } from '../lib/api';
import { useToast } from '../hooks/useToast';
import { useAuth } from '../hooks/useAuth';
import { formatDateTime } from '../lib/utils';
import { SortableHeader, type SortDirection } from '../components/SortableHeader';
import { sortBy } from '../lib/sort';

interface UserDraft {
  display_name: string;
  role: 'admin' | 'user';
}

interface CreateUserForm {
  username: string;
  display_name: string;
  password: string;
  role: 'admin' | 'user';
}

const EMPTY_CREATE_FORM: CreateUserForm = {
  username: '',
  display_name: '',
  password: '',
  role: 'user',
};

type UserSortField = 'username' | 'display_name' | 'role' | 'authType' | 'created_at';

export function UsersPage() {
  const { user: currentUser } = useAuth();
  const { toast } = useToast();
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [drafts, setDrafts] = useState<Record<number, UserDraft>>({});
  const [passwordDrafts, setPasswordDrafts] = useState<Record<number, string>>({});
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [actionUserId, setActionUserId] = useState<number | null>(null);
  const [createForm, setCreateForm] = useState(EMPTY_CREATE_FORM);
  const [sortField, setSortField] = useState<UserSortField>('created_at');
  const [sortOrder, setSortOrder] = useState<SortDirection>('desc');

  useEffect(() => {
    void loadUsers();
  }, []);

  const loadUsers = async () => {
    try {
      const response = await usersApi.list();
      setUsers(response.users);
      setDrafts(Object.fromEntries(
        response.users.map((entry) => [entry.id, {
          display_name: entry.display_name ?? '',
          role: entry.role,
        }]),
      ));
    } catch (err) {
      toast({
        title: 'Failed to load users',
        description: err instanceof Error ? err.message : 'Unknown error',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  const setDraft = (userId: number, patch: Partial<UserDraft>) => {
    setDrafts((prev) => ({
      ...prev,
      [userId]: {
        ...(prev[userId] ?? { display_name: '', role: 'user' }),
        ...patch,
      },
    }));
  };

  const handleCreateUser = async (event: FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    try {
      await usersApi.create(createForm);
      toast({ title: 'User created', variant: 'success' });
      setCreateForm(EMPTY_CREATE_FORM);
      await loadUsers();
    } catch (err) {
      toast({
        title: 'Failed to create user',
        description: err instanceof Error ? err.message : 'Unknown error',
        variant: 'destructive',
      });
    } finally {
      setSubmitting(false);
    }
  };

  const handleSaveUser = async (entry: AdminUser) => {
    const draft = drafts[entry.id];
    if (!draft) {
      return;
    }

    setActionUserId(entry.id);
    try {
      await usersApi.update(entry.id, draft);
      toast({ title: 'User updated', variant: 'success' });
      await loadUsers();
    } catch (err) {
      toast({
        title: 'Failed to update user',
        description: err instanceof Error ? err.message : 'Unknown error',
        variant: 'destructive',
      });
    } finally {
      setActionUserId(null);
    }
  };

  const handleResetPassword = async (entry: AdminUser) => {
    const password = passwordDrafts[entry.id]?.trim();
    if (!password) {
      toast({
        title: 'Password required',
        description: 'Enter a new password before resetting it.',
        variant: 'destructive',
      });
      return;
    }

    setActionUserId(entry.id);
    try {
      await usersApi.resetPassword(entry.id, password);
      setPasswordDrafts((prev) => ({ ...prev, [entry.id]: '' }));
      toast({ title: 'Password updated', variant: 'success' });
      await loadUsers();
    } catch (err) {
      toast({
        title: 'Failed to reset password',
        description: err instanceof Error ? err.message : 'Unknown error',
        variant: 'destructive',
      });
    } finally {
      setActionUserId(null);
    }
  };

  const handleDeleteUser = async (entry: AdminUser) => {
    const confirmed = window.confirm(`Delete user ${entry.username}?`);
    if (!confirmed) {
      return;
    }

    setActionUserId(entry.id);
    try {
      await usersApi.delete(entry.id);
      toast({ title: 'User deleted', variant: 'success' });
      await loadUsers();
    } catch (err) {
      toast({
        title: 'Failed to delete user',
        description: err instanceof Error ? err.message : 'Unknown error',
        variant: 'destructive',
      });
    } finally {
      setActionUserId(null);
    }
  };

  const handleSort = (field: UserSortField) => {
    setSortOrder((current) => (sortField === field && current === 'desc' ? 'asc' : 'desc'));
    setSortField(field);
  };

  const sortedUsers = sortBy(users, sortOrder, (entry) => {
    switch (sortField) {
      case 'username':
        return entry.username;
      case 'display_name':
        return entry.display_name ?? '';
      case 'role':
        return entry.role;
      case 'authType':
        return entry.authType;
      case 'created_at':
        return entry.created_at;
    }
  });

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-5xl">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Users</h1>
          <p className="text-sm text-muted-foreground">
            Manage local users, assign roles, and maintain admin access.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void loadUsers()}
          className="rounded-lg border border-input px-3 py-2 text-sm font-medium transition-colors hover:bg-muted"
        >
          <span className="inline-flex items-center gap-2">
            <RefreshCw className="h-4 w-4" />
            Refresh
          </span>
        </button>
      </div>

      <section className="rounded-xl border border-border bg-card p-5">
        <h2 className="mb-4 flex items-center gap-2 font-semibold">
          <UserPlus className="h-4 w-4" />
          Create Local User
        </h2>
        <form onSubmit={handleCreateUser} className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <label className="text-sm font-medium">Username</label>
            <input
              type="text"
              value={createForm.username}
              onChange={(event) => setCreateForm((prev) => ({ ...prev, username: event.target.value }))}
              className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              minLength={3}
              required
            />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">Display Name</label>
            <input
              type="text"
              value={createForm.display_name}
              onChange={(event) => setCreateForm((prev) => ({ ...prev, display_name: event.target.value }))}
              className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">Password</label>
            <input
              type="password"
              value={createForm.password}
              onChange={(event) => setCreateForm((prev) => ({ ...prev, password: event.target.value }))}
              className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              minLength={8}
              required
            />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">Role</label>
            <select
              value={createForm.role}
              onChange={(event) => setCreateForm((prev) => ({ ...prev, role: event.target.value as 'admin' | 'user' }))}
              className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            >
              <option value="user">User</option>
              <option value="admin">Admin</option>
            </select>
          </div>
          <div className="md:col-span-2">
            <button
              type="submit"
              disabled={submitting}
              className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
            >
              {submitting ? 'Creating...' : 'Create User'}
            </button>
          </div>
        </form>
      </section>

      <section className="rounded-xl border border-border bg-card overflow-x-auto">
        <table className="w-full min-w-[1120px] text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/40 text-xs text-muted-foreground">
              <SortableHeader label="Username" field="username" currentSort={sortField} order={sortOrder} onSort={handleSort} />
              <SortableHeader label="Display Name" field="display_name" currentSort={sortField} order={sortOrder} onSort={handleSort} />
              <SortableHeader label="Role" field="role" currentSort={sortField} order={sortOrder} onSort={handleSort} />
              <SortableHeader label="Auth" field="authType" currentSort={sortField} order={sortOrder} onSort={handleSort} />
              <th className="px-4 py-3 text-left font-medium">Password</th>
              <SortableHeader label="Created" field="created_at" currentSort={sortField} order={sortOrder} onSort={handleSort} />
              <th className="px-4 py-3 text-right font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {sortedUsers.map((entry) => {
              const draft = drafts[entry.id] ?? { display_name: entry.display_name ?? '', role: entry.role };
              const isCurrentUser = currentUser?.id === entry.id;
              const isBusy = actionUserId === entry.id;

              return (
                <tr key={entry.id} className="border-b border-border last:border-0 align-top">
                  <td className="px-4 py-3">
                    <div>
                      <p className="font-medium">{entry.username}</p>
                      {isCurrentUser && <p className="text-xs text-primary">Current session</p>}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <input
                      type="text"
                      value={draft.display_name}
                      onChange={(event) => setDraft(entry.id, { display_name: event.target.value })}
                      className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                    />
                  </td>
                  <td className="px-4 py-3">
                    <select
                      value={draft.role}
                      onChange={(event) => setDraft(entry.id, { role: event.target.value as 'admin' | 'user' })}
                      className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                    >
                      <option value="user">User</option>
                      <option value="admin">Admin</option>
                    </select>
                  </td>
                  <td className="px-4 py-3">
                    <div className="space-y-1">
                      <span className="rounded-full bg-muted px-2 py-1 text-xs font-medium text-muted-foreground">{entry.authType}</span>
                      <p className="text-xs text-muted-foreground">{entry.hasPassword ? 'Local password configured' : 'OIDC-only user'}</p>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex gap-2">
                      <input
                        type="password"
                        value={passwordDrafts[entry.id] ?? ''}
                        onChange={(event) => setPasswordDrafts((prev) => ({ ...prev, [entry.id]: event.target.value }))}
                        disabled={!entry.hasPassword}
                        className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                        placeholder={entry.hasPassword ? 'New password' : 'Not available'}
                        minLength={8}
                      />
                      <button
                        type="button"
                        disabled={!entry.hasPassword || isBusy}
                        onClick={() => void handleResetPassword(entry)}
                        className="inline-flex shrink-0 items-center justify-center gap-2 rounded-lg border border-input px-3 py-2 text-sm font-medium transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        <Shield className="h-4 w-4" />
                        Set
                      </button>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">{formatDateTime(entry.created_at)}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-2">
                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={() => void handleSaveUser(entry)}
                        className="inline-flex items-center justify-center gap-2 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
                      >
                        {isBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                        Save
                      </button>
                      <button
                        type="button"
                        disabled={isCurrentUser || isBusy}
                        onClick={() => void handleDeleteUser(entry)}
                        className="inline-flex items-center justify-center gap-2 rounded-lg border border-destructive/30 px-3 py-2 text-sm font-medium text-destructive transition-colors hover:bg-destructive/10 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        <Trash2 className="h-4 w-4" />
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>
    </div>
  );
}