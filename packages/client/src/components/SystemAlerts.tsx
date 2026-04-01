import { useEffect, useRef } from 'react';
import { dashboardApi, type DashboardStats } from '../lib/api';
import { useToast } from '../hooks/useToast';
import { useAuth } from '../hooks/useAuth';

function tokenAlertState(stats: DashboardStats) {
  const fleet = stats.tokenHealth.fleet;
  const ownership = stats.tokenHealth.ownership;
  return [
    fleet.hasToken ? (fleet.isExpired ? 'fleet-expired' : 'fleet-ok') : 'fleet-missing',
    ownership.hasToken ? (ownership.isExpired ? 'ownership-expired' : 'ownership-ok') : 'ownership-missing',
  ].join('|');
}

export function SystemAlerts() {
  const { user } = useAuth();
  const { toast } = useToast();
  const previousStatsRef = useRef<DashboardStats | null>(null);
  const seenRunRef = useRef<number | null>(null);
  const seenTokenStateRef = useRef<string | null>(null);

  useEffect(() => {
    if (!user) {
      previousStatsRef.current = null;
      seenRunRef.current = null;
      seenTokenStateRef.current = null;
      return;
    }

    let cancelled = false;

    const poll = async () => {
      try {
        const stats = await dashboardApi.stats();
        if (cancelled) {
          return;
        }

        const previousStats = previousStatsRef.current;
        const latestRun = stats.recentRuns[0];
        const currentTokenState = tokenAlertState(stats);

        if (previousStats) {
          if (stats.totalInvoices > previousStats.totalInvoices) {
            const delta = stats.totalInvoices - previousStats.totalInvoices;
            toast({
              title: 'New invoices detected',
              description: `${delta} new invoice${delta === 1 ? '' : 's'} added since the last check.`,
              variant: 'success',
            });
          }

          if (latestRun && latestRun.id !== seenRunRef.current) {
            if (latestRun.status === 'failed' || latestRun.status === 'partial') {
              toast({
                title: latestRun.status === 'failed' ? 'Fetch run failed' : 'Fetch run completed with warnings',
                description: `Run #${latestRun.id} finished with status ${latestRun.status}.`,
                variant: latestRun.status === 'failed' ? 'destructive' : 'warning',
              });
            }
            seenRunRef.current = latestRun.id;
          }

          if (currentTokenState !== seenTokenStateRef.current) {
            const problems: string[] = [];
            if (!stats.tokenHealth.fleet.hasToken) problems.push('Fleet API token missing');
            else if (stats.tokenHealth.fleet.isExpired) problems.push('Fleet API token expired');
            if (!stats.tokenHealth.ownership.hasToken) problems.push('Ownership API token missing');
            else if (stats.tokenHealth.ownership.isExpired) problems.push('Ownership API token expired');

            if (problems.length > 0) {
              toast({
                title: 'Tesla token attention needed',
                description: problems.join(' • '),
                variant: 'warning',
              });
            }

            seenTokenStateRef.current = currentTokenState;
          }
        } else {
          seenRunRef.current = latestRun?.id ?? null;
          seenTokenStateRef.current = currentTokenState;
        }

        previousStatsRef.current = stats;
      } catch {
        // Ignore transient polling errors.
      }
    };

    void poll();
    const interval = window.setInterval(() => {
      if (document.visibilityState === 'visible') {
        void poll();
      }
    }, 60000);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [toast, user]);

  return null;
}