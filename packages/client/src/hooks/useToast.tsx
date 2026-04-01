import { createContext, useContext, useState, useCallback, type ReactNode } from 'react';

interface Toast {
  id: number;
  title: string;
  description?: string;
  variant?: 'default' | 'destructive' | 'success' | 'warning';
}

interface ToastContextType {
  toasts: Toast[];
  toast: (t: Omit<Toast, 'id'>) => void;
  dismiss: (id: number) => void;
}

const ToastContext = createContext<ToastContextType | null>(null);

let nextId = 0;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const toast = useCallback((t: Omit<Toast, 'id'>) => {
    const id = ++nextId;
    setToasts((prev) => [...prev, { ...t, id }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((x) => x.id !== id));
    }, 5000);
  }, []);

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((x) => x.id !== id));
  }, []);

  return (
    <ToastContext.Provider value={{ toasts, toast, dismiss }}>
      {children}
      {/* Toast container */}
      <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 max-w-sm">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`rounded-lg border px-4 py-3 shadow-lg transition-all animate-in slide-in-from-bottom-2 ${
              t.variant === 'destructive'
                ? 'border-destructive/50 bg-destructive text-destructive-foreground'
                : t.variant === 'success'
                  ? 'border-success/50 bg-success/10 text-success'
                  : t.variant === 'warning'
                    ? 'border-warning/40 bg-warning/10 text-warning'
                  : 'border-border bg-card text-card-foreground'
            }`}
            onClick={() => dismiss(t.id)}
          >
            <p className="font-medium text-sm">{t.title}</p>
            {t.description && <p className="text-xs opacity-80 mt-1">{t.description}</p>}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within ToastProvider');
  return ctx;
}
