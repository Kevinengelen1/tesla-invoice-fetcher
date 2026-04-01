import { useEffect, useRef, useState, useCallback } from 'react';

interface LogEntry {
  type: string;
  level?: string;
  message?: string;
  timestamp?: string;
  data?: unknown;
}

export function useLogStream() {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [connected, setConnected] = useState(false);
  const eventSourceRef = useRef<EventSource | null>(null);

  const connect = useCallback(() => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
    }

    // Clear previous logs so history replay starts fresh
    setLogs([]);
    setConnected(false);

    const es = new EventSource('/api/logs/stream');
    eventSourceRef.current = es;

    es.onmessage = (event) => {
      try {
        const entry = JSON.parse(event.data) as LogEntry;
        if (entry.type === 'connected') {
          setConnected(true);
          return;
        }
        setLogs((prev) => [...prev.slice(-499), entry]);
      } catch { /* ignore parse errors */ }
    };

    es.onerror = () => {
      setConnected(false);
      es.close();
      // Auto-reconnect after 3 seconds
      setTimeout(connect, 3000);
    };
  }, []);

  const clear = useCallback(() => setLogs([]), []);

  useEffect(() => {
    connect();
    return () => {
      eventSourceRef.current?.close();
    };
  }, [connect]);

  return { logs, connected, clear };
}
