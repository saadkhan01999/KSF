/* Routing and route-level authorisation.

   Three trees: the public website for anyone signed out, the platform
   console for the Super Admin, and the pharmacy workspace for everybody else
   — and for the Super Admin while working inside a pharmacy. The server
   checks every request again; these guards only keep the screen honest.
   `useViewMode` switches scroll ownership: the website scrolls as a page,
   the workspace is a fixed shell that scrolls internally. */

import { Suspense, lazy, useEffect } from 'react';
import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { ShieldAlert } from 'lucide-react';
import { useApp } from './context/AppContext';
import { Layout, ChangePasswordModal } from './components/Layout';
import { Toaster, PageLoader, EmptyState, Button } from './components/ui';
import { StepUpDialog } from './components/account-ui';
import { useViewMode } from './hooks/useParallax';
import { useHomeRoute } from './hooks/useHomeRoute';
import { useSiteVisits } from './services/visits';

/* Public pages. Each is its own chunk, so a signed-in cashier at a till
   never downloads the marketing site. */
const Landing = lazy(() => import('./pages/site/Landing'));
const Product = lazy(() => import('./pages/site/Product'));
const Features = lazy(() => import('./pages/site/Features'));
const Pricing = lazy(() => import('./pages/site/Pricing'));
const About = lazy(() => import('./pages/site/About'));
const Subscription = lazy(() => import('./pages/site/Subscription'));
const Legal = lazy(() => import('./pages/site/Legal'));
const Register = lazy(() => import('./pages/onboarding/Register'));
const ForgotPassword = lazy(() => import('./pages/onboarding/ForgotPassword'));
const Setup = lazy(() => import('./pages/onboarding/Setup'));
const Login = lazy(() => import('./pages/Login'));
const Dashboard = lazy(() => import('./pages/Dashboard'));
const Medicines = lazy(() => import('./pages/Medicines'));
const Categories = lazy(() => import('./pages/Categories'));
const Inventory = lazy(() => import('./pages/Inventory'));
const Expiry = lazy(() => import('./pages/Expiry'));
const Suppliers = lazy(() => import('./pages/Suppliers'));
const Purchases = lazy(() => import('./pages/Purchases'));
const Pos = lazy(() => import('./pages/Pos'));
const Sales = lazy(() => import('./pages/Sales'));
const Customers = lazy(() => import('./pages/Customers'));
const Prescriptions = lazy(() => import('./pages/Prescriptions'));
const Expenses = lazy(() => import('./pages/Expenses'));
const Accounts = lazy(() => import('./pages/Accounts'));
const MedicineDirectory = lazy(() => import('./pages/MedicineDirectory'));
const DayClose = lazy(() => import('./pages/DayClose'));
const Reports = lazy(() => import('./pages/Reports'));
const Staff = lazy(() => import('./pages/Staff'));
const Roles = lazy(() => import('./pages/Roles'));
const Messages = lazy(() => import('./pages/Messages'));
const Notifications = lazy(() => import('./pages/Notifications'));
const Activity = lazy(() => import('./pages/Activity'));
const SettingsPage = lazy(() => import('./pages/Settings'));
const Support = lazy(() => import('./pages/Support'));
const Account = lazy(() => import('./pages/Account'));
const Wallet = lazy(() => import('./pages/subscription/Wallet'));
const PlanReview = lazy(() => import('./pages/subscription/PlanReview'));

/* The platform console. Its own chunks: a pharmacy never downloads them. */
const PlatformOverview = lazy(() => import('./pages/platform/Overview'));
const PlatformAnalytics = lazy(() => import('./pages/platform/Analytics'));
const Pharmacies = lazy(() => import('./pages/platform/Pharmacies'));
const PharmacyDetail = lazy(() => import('./pages/platform/PharmacyDetail'));
const SupportDesk = lazy(() => import('./pages/platform/SupportDesk'));
const Income = lazy(() => import('./pages/platform/Income'));
const PlatformAccounts = lazy(() => import('./pages/platform/Accounts'));
const Plans = lazy(() => import('./pages/platform/Plans'));
const HelpQueue = lazy(() => import('./pages/platform/HelpQueue'));
const PlatformActivity = lazy(() => import('./pages/platform/PlatformActivity'));
const Team = lazy(() => import('./pages/platform/Team'));

function Guard({ permission, children }: { permission?: string; children: React.ReactNode }) {
  const { can, isPlatform } = useApp();
  const navigate = useNavigate();
  const home = useHomeRoute();

  if (permission && !can(permission)) {
    return (
      <EmptyState
        icon={<ShieldAlert size={28} />}
        title="You do not have access to this screen"
        message={isPlatform
          ? 'Your team role does not include this part of the platform. If you need it, ask the Super Admin to update your role.'
          : 'Your role does not include this part of KSF. If you need it, ask your pharmacy Admin to update your role.'}
        action={<Button variant="primary" onClick={() => navigate(home)}>Back to my first screen</Button>}
      />
    );
  }
  return <>{children}</>;
}

function Protected() {
  const { user, isPlatform } = useApp();
  const home = useHomeRoute();
  const location = useLocation();
  useViewMode('app');

  return (
    <Layout>
      {/* A temporary password must be replaced before anything else. */}
      <ChangePasswordModal
        open={!!user?.mustChangePassword}
        forced
        onClose={() => undefined}
        onDone={() => window.location.reload()}
        onFail={() => undefined}
      />
      <Suspense fallback={<PageLoader />}>
        {isPlatform ? (
          <Routes location={location}>
            <Route path="/platform" element={<Guard permission="platform.overview"><PlatformOverview /></Guard>} />
            <Route path="/platform/analytics" element={<Guard permission="platform.overview"><PlatformAnalytics /></Guard>} />
            <Route path="/platform/pharmacies" element={<Guard permission="platform.pharmacies.view"><Pharmacies /></Guard>} />
            <Route path="/platform/pharmacies/:id" element={<Guard permission="platform.pharmacies.view"><PharmacyDetail /></Guard>} />
            <Route path="/platform/support" element={<Guard permission="platform.support"><SupportDesk /></Guard>} />
            <Route path="/platform/support/:id" element={<Guard permission="platform.support"><SupportDesk /></Guard>} />
            <Route path="/platform/help" element={<Guard permission="platform.help"><HelpQueue /></Guard>} />
            <Route path="/platform/income" element={<Guard permission="platform.finance.view"><Income /></Guard>} />
            <Route path="/platform/accounts" element={<Guard permission="platform.finance.view"><PlatformAccounts /></Guard>} />
            <Route path="/platform/plans" element={<Guard permission="platform.plans.manage"><Plans /></Guard>} />
            <Route path="/platform/team" element={<Guard permission="platform.team.manage"><Team /></Guard>} />
            <Route path="/platform/activity" element={<Guard permission="platform.activity"><PlatformActivity /></Guard>} />
            <Route path="/platform/directory" element={<MedicineDirectory />} />
            <Route path="/platform/directory/:id" element={<MedicineDirectory />} />
            <Route path="/platform/notifications" element={<Notifications />} />
            <Route path="/account" element={<Account />} />
            <Route path="*" element={<Navigate to={home} replace />} />
          </Routes>
        ) : (
        <Routes location={location}>
          <Route path="/" element={<Navigate to={home} replace />} />
          <Route path="/login" element={<Navigate to={home} replace />} />
          {/* Somebody who is already signed in has no use for these. */}
          <Route path="/register" element={<Navigate to={home} replace />} />
          <Route path="/forgot-password" element={<Navigate to="/settings?tab=centre" replace />} />
          <Route path="/subscription" element={<Navigate to="/subscription-plans" replace />} />
          <Route path="/subscription-plans" element={<Guard permission="settings.read"><Wallet /></Guard>} />
          <Route path="/subscription-plans/pro" element={<Guard permission="settings.read"><PlanReview kind="pro" /></Guard>} />
          <Route path="/subscription-plans/annual" element={<Guard permission="settings.read"><PlanReview kind="annual" /></Guard>} />
          <Route path="/setup" element={<Setup />} />
          <Route path="/dashboard" element={<Guard permission="dashboard.view"><Dashboard /></Guard>} />
          <Route path="/pos" element={<Guard permission="pos.operate"><Pos /></Guard>} />
          <Route path="/sales" element={<Guard permission="sales.read"><Sales /></Guard>} />
          <Route path="/sales/:id" element={<Guard permission="sales.read"><Sales /></Guard>} />
          <Route path="/messages" element={<Guard permission="messages.read"><Messages /></Guard>} />
          <Route path="/medicines" element={<Guard permission="medicines.read"><Medicines /></Guard>} />
          <Route path="/categories" element={<Guard permission="medicines.read"><Categories /></Guard>} />
          <Route path="/directory" element={<MedicineDirectory />} />
          <Route path="/directory/:id" element={<MedicineDirectory />} />
          <Route path="/inventory" element={<Guard permission="inventory.read"><Inventory /></Guard>} />
          <Route path="/expiry" element={<Guard permission="inventory.read"><Expiry /></Guard>} />
          <Route path="/suppliers" element={<Guard permission="suppliers.read"><Suppliers /></Guard>} />
          <Route path="/purchases" element={<Guard permission="purchases.read"><Purchases /></Guard>} />
          <Route path="/customers" element={<Guard permission="customers.read"><Customers /></Guard>} />
          <Route path="/prescriptions" element={<Guard permission="prescriptions.read"><Prescriptions /></Guard>} />
          <Route path="/expenses" element={<Guard permission="expenses.read"><Expenses /></Guard>} />
          <Route path="/accounts" element={<Guard permission="accounting.view"><Accounts /></Guard>} />
          <Route path="/day-close" element={<Guard permission="day-close.manage"><DayClose /></Guard>} />
          <Route path="/reports" element={<Guard permission="reports.view"><Reports /></Guard>} />
          <Route path="/staff" element={<Guard permission="staff.read"><Staff /></Guard>} />
          <Route path="/roles" element={<Guard permission="roles.read"><Roles /></Guard>} />
          <Route path="/notifications" element={<Notifications />} />
          <Route path="/activity" element={<Guard permission="audit.read"><Activity /></Guard>} />
          <Route path="/settings" element={<Guard permission="settings.read"><SettingsPage /></Guard>} />
          <Route path="/support" element={<Guard permission="support.raise"><Support /></Guard>} />
          <Route path="/support/:id" element={<Guard permission="support.raise"><Support /></Guard>} />
          <Route path="/account" element={<Account />} />
          <Route path="/platform/*" element={<Navigate to={home} replace />} />
          <Route path="*" element={<NotFound home={home} />} />
        </Routes>
        )}
      </Suspense>
    </Layout>
  );
}

function NotFound({ home }: { home: string }) {
  const navigate = useNavigate();
  return (
    <EmptyState
      title="That page does not exist"
      message="The address may have been mistyped, or the screen may have been renamed in this version."
      action={<Button variant="primary" onClick={() => navigate(home)}>Take me back</Button>}
    />
  );
}

/** Everything a signed-out visitor can reach. */
function Public() {
  useViewMode('site');
  /* Website traffic: each page of the public website, counted without cookies. */
  useSiteVisits();
  return (
    <Suspense fallback={<PageLoader />}>
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/product" element={<Product />} />
        <Route path="/features" element={<Features />} />
        <Route path="/pricing" element={<Pricing />} />
        <Route path="/about" element={<About />} />
        <Route path="/privacy" element={<Legal doc="privacy" />} />
        <Route path="/terms" element={<Legal doc="terms" />} />
        <Route path="/refunds" element={<Legal doc="refunds" />} />
        <Route path="/support" element={<Legal doc="support" />} />
        <Route path="/subscription" element={<Subscription />} />
        <Route path="/register" element={<Register />} />
        <Route path="/forgot-password" element={<ForgotPassword />} />
        <Route path="/reset-password" element={<ForgotPassword />} />
        <Route path="/login" element={<Login />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  );
}

/** Any request the server wants a fresh password for waits on this dialog. */
function StepUpHost() {
  const { stepUpOpen, resolveStepUp, user } = useApp();
  return (
    <StepUpDialog
      open={stepUpOpen}
      needsCode={!!user?.twoFactorEnabled}
      onVerified={() => resolveStepUp(true)}
      onClose={() => resolveStepUp(false)}
    />
  );
}

export default function App() {
  const { user, loading } = useApp();
  const location = useLocation();

  useEffect(() => {
    const titles: Record<string, string> = {
      '/': 'Pharmacy Management System',
      '/product': 'The product', '/features': 'Features', '/pricing': 'Pricing',
      '/about': 'About', '/subscription': 'Subscription',
      '/privacy': 'Privacy', '/terms': 'Terms of service',
      '/refunds': 'Refunds and cancellation', '/support': 'Support',
      '/day-close': 'Close the Day',
      '/register': 'Create your pharmacy account', '/forgot-password': 'Forgotten password',
      '/dashboard': 'Dashboard', '/pos': 'New Sale', '/sales': 'Sales History',
      '/messages': 'Messages',
      '/medicines': 'Medicines', '/categories': 'Categories', '/inventory': 'Inventory',
      '/expiry': 'Expiry Control', '/suppliers': 'Suppliers', '/purchases': 'Purchases',
      '/customers': 'Customers', '/prescriptions': 'Prescriptions', '/expenses': 'Expenses', '/accounts': 'Accounts',
      '/directory': 'Medicine directory', '/platform/directory': 'Medicine directory',
      '/reports': 'Reports', '/staff': 'Staff', '/roles': 'Roles & Access',
      '/notifications': 'Notifications', '/activity': 'Activity Log', '/settings': 'Settings',
      '/login': 'Sign in', '/setup': 'Finish setting up', '/account': 'My account',
      '/platform': 'Platform overview', '/platform/pharmacies': 'Pharmacies', '/platform/support': 'Support desk',
      '/platform/help': 'People who need help', '/platform/income': 'Income', '/platform/accounts': 'Accounts', '/platform/plans': 'Plans',
      '/platform/activity': 'Activity', '/platform/notifications': 'Notifications'
    };
    const name = titles[location.pathname]
      ?? (location.pathname.startsWith('/support') ? 'Help & Support'
        : location.pathname.startsWith('/platform/pharmacies/') ? 'Pharmacy'
          : location.pathname.startsWith('/platform/support/') ? 'Support desk'
            : /^\/(platform\/)?directory\//.test(location.pathname) ? 'Medicine directory' : undefined);
    document.title = name ? `${name} · KSF` : 'KSF';
  }, [location.pathname]);

  /* The marketing page scrolls; the workspace does not. Reset the scroll
     position on every navigation so a new screen never opens half way down. */
  useEffect(() => {
    window.scrollTo(0, 0);
    document.querySelector('.main')?.scrollTo({ top: 0 });
  }, [location.pathname]);

  if (loading) {
    return (
      <>
        <PageLoader message="Opening your KSF workspace…" />
        <Toaster />
      </>
    );
  }

  return (
    <>
      {user ? <Protected /> : <Public />}
      <StepUpHost />
      <Toaster />
    </>
  );
}
