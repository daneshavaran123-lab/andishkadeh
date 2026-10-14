import { StrictMode, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider, useAuth } from './auth';
import { Layout } from './components/Layout';
import { Loading, ToastProvider } from './components/ui';
import { Audit } from './pages/Audit';
import { Categories, ServiceForm, Services } from './pages/Catalog';
import { Content } from './pages/Content';
import { Dashboard } from './pages/Dashboard';
import { Devices } from './pages/Devices';
import { Discounts } from './pages/Discounts';
import { Login } from './pages/Login';
import { MediaLibrary } from './pages/Media';
import { OrderDetailPage, Orders } from './pages/Orders';
import { Payments } from './pages/Payments';
import { Plans } from './pages/Plans';
import { Reports } from './pages/Reports';
import { Settings } from './pages/Settings';
import { SubscriptionDetailPage, Subscriptions } from './pages/Subscriptions';
import { Sync } from './pages/Sync';
import { Users } from './pages/Users';
import './styles.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, refetchOnWindowFocus: false, staleTime: 10_000, placeholderData: (prev: unknown) => prev },
  },
});

function Protected({ children, adminOnly }: { children: ReactNode; adminOnly?: boolean }) {
  const { user, loading, isAdmin } = useAuth();
  const loc = useLocation();
  if (loading) return <Loading />;
  if (!user) return <Navigate to="/login" replace state={{ from: loc.pathname }} />;
  if (adminOnly && !isAdmin) return <Navigate to="/dashboard" replace />;
  return <>{children}</>;
}

function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route
        element={
          <Protected>
            <Layout />
          </Protected>
        }
      >
        <Route index element={<Navigate to="/dashboard" replace />} />
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/reports" element={<Reports />} />
        <Route path="/orders" element={<Orders />} />
        <Route path="/orders/:id" element={<OrderDetailPage />} />
        <Route path="/payments" element={<Payments />} />
        <Route path="/subscriptions" element={<Subscriptions />} />
        <Route path="/subscriptions/:id" element={<SubscriptionDetailPage />} />
        <Route path="/catalog/services" element={<Services />} />
        <Route path="/catalog/services/:id" element={<ServiceForm />} />
        <Route path="/catalog/categories" element={<Categories />} />
        <Route path="/plans" element={<Plans />} />
        <Route path="/discounts" element={<Discounts />} />
        <Route path="/media" element={<MediaLibrary />} />
        <Route path="/content" element={<Content />} />
        <Route path="/devices" element={<Devices />} />
        <Route path="/sync" element={<Sync />} />
        <Route path="/settings" element={<Settings />} />
        <Route
          path="/users"
          element={
            <Protected adminOnly>
              <Users />
            </Protected>
          }
        />
        <Route
          path="/audit"
          element={
            <Protected adminOnly>
              <Audit />
            </Protected>
          }
        />
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Route>
    </Routes>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter basename="/admin">
        <AuthProvider>
          <ToastProvider>
            <App />
          </ToastProvider>
        </AuthProvider>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
