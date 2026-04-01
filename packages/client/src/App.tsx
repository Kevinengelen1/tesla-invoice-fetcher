import { Suspense, lazy } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './hooks/useAuth';
import { ToastProvider } from './hooks/useToast';
import { Layout } from './components/Layout';
import { SystemAlerts } from './components/SystemAlerts';

const LoginPage = lazy(() => import('./pages/LoginPage').then((module) => ({ default: module.LoginPage })));
const DashboardPage = lazy(() => import('./pages/DashboardPage').then((module) => ({ default: module.DashboardPage })));
const InvoicesPage = lazy(() => import('./pages/InvoicesPage').then((module) => ({ default: module.InvoicesPage })));
const VehiclesPage = lazy(() => import('./pages/VehiclesPage').then((module) => ({ default: module.VehiclesPage })));
const TeslaAuthPage = lazy(() => import('./pages/TeslaAuthPage').then((module) => ({ default: module.TeslaAuthPage })));
const SettingsPage = lazy(() => import('./pages/SettingsPage').then((module) => ({ default: module.SettingsPage })));
const LogsPage = lazy(() => import('./pages/LogsPage').then((module) => ({ default: module.LogsPage })));
const FetchRunsPage = lazy(() => import('./pages/FetchRunsPage').then((module) => ({ default: module.FetchRunsPage })));
const UsersPage = lazy(() => import('./pages/UsersPage').then((module) => ({ default: module.UsersPage })));
const DiagnosticsPage = lazy(() => import('./pages/DiagnosticsPage').then((module) => ({ default: module.DiagnosticsPage })));

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    );
  }
  if (!user) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

function AdminRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    );
  }
  if (!user) return <Navigate to="/login" replace />;
  if (user.role !== 'admin') return <Navigate to="/" replace />;
  return <>{children}</>;
}

export function App() {
  return (
    <ToastProvider>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<PageBoundary><LoginPage /></PageBoundary>} />
          <Route
            path="/*"
            element={
              <ProtectedRoute>
                <Layout>
                  <SystemAlerts />
                  <PageBoundary>
                    <Routes>
                      <Route path="/" element={<DashboardPage />} />
                      <Route path="/invoices" element={<InvoicesPage />} />
                      <Route path="/vehicles" element={<VehiclesPage />} />
                      <Route path="/tesla-auth" element={<TeslaAuthPage />} />
                      <Route
                        path="/users"
                        element={
                          <AdminRoute>
                            <UsersPage />
                          </AdminRoute>
                        }
                      />
                      <Route
                        path="/diagnostics"
                        element={
                          <AdminRoute>
                            <DiagnosticsPage />
                          </AdminRoute>
                        }
                      />
                      <Route path="/settings" element={<SettingsPage />} />
                      <Route path="/logs" element={<LogsPage />} />
                      <Route path="/fetch-runs" element={<FetchRunsPage />} />
                    </Routes>
                  </PageBoundary>
                </Layout>
              </ProtectedRoute>
            }
          />
        </Routes>
      </AuthProvider>
    </ToastProvider>
  );
}

function PageBoundary({ children }: { children: React.ReactNode }) {
  return (
    <Suspense fallback={<PageFallback />}>
      {children}
    </Suspense>
  );
}

function PageFallback() {
  return (
    <div className="flex min-h-[40vh] items-center justify-center">
      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
    </div>
  );
}
