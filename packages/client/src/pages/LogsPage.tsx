import { useLogStream } from '../hooks/useLogStream';
import { Trash2, Wifi, WifiOff } from 'lucide-react';

const levelColors: Record<string, string> = {
  info: 'text-primary',
  warn: 'text-warning',
  error: 'text-destructive',
  debug: 'text-muted-foreground',
};

export function LogsPage() {
  const { logs, connected, clear } = useLogStream();

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold">Logs</h1>
          <span
            className={`flex items-center gap-1.5 text-xs px-2 py-1 rounded-full ${
              connected
                ? 'bg-success/10 text-success'
                : 'bg-destructive/10 text-destructive'
            }`}
          >
            {connected ? <Wifi className="h-3 w-3" /> : <WifiOff className="h-3 w-3" />}
            {connected ? 'Connected' : 'Disconnected'}
          </span>
        </div>
        <button
          onClick={clear}
          className="rounded-lg border border-input px-3 py-2 text-sm font-medium hover:bg-muted transition-colors flex items-center gap-2"
        >
          <Trash2 className="h-4 w-4" />
          Clear
        </button>
      </div>

      <div className="rounded-xl border border-border bg-card font-mono text-xs overflow-auto max-h-[calc(100vh-200px)]">
        {logs.length === 0 ? (
          <div className="p-8 text-center text-muted-foreground text-sm font-sans">
            Waiting for log entries...
          </div>
        ) : (
          <div className="divide-y divide-border">
            {logs.map((entry, i) => (
              <div key={i} className="px-4 py-2 hover:bg-muted/50 flex gap-3 items-start">
                {entry.timestamp && (
                  <span className="text-muted-foreground whitespace-nowrap shrink-0">
                    {new Date(entry.timestamp).toLocaleTimeString()}
                  </span>
                )}
                {entry.level && (
                  <span
                    className={`uppercase w-12 shrink-0 font-bold ${
                      levelColors[entry.level] ?? 'text-foreground'
                    }`}
                  >
                    {entry.level}
                  </span>
                )}
                <span className="break-all">
                  {entry.message}
                  {entry.data ? (
                    <span className="text-muted-foreground ml-2">
                      {typeof entry.data === 'string'
                        ? entry.data
                        : JSON.stringify(entry.data)}
                    </span>
                  ) : null}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
