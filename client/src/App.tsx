import { Switch, Route, useLocation } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useEffect, Component, ReactNode } from "react";
import { useAuth } from "@/hooks/use-auth";
import NotFound from "@/pages/not-found";
import ClientReportPage from "@/pages/report";

class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  constructor(props: any) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  render() {
    if (this.state.error) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-background p-8">
          <div className="max-w-md w-full space-y-4 text-center">
            <h1 className="text-xl font-semibold text-destructive">Something went wrong</h1>
            <p className="text-sm text-muted-foreground font-mono bg-muted px-3 py-2 rounded text-left break-all">
              {this.state.error.message}
            </p>
            <button
              className="text-sm text-primary underline"
              onClick={() => { this.setState({ error: null }); window.location.reload(); }}
            >
              Reload page
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

// Pages
import Login from "@/pages/login";
import Dashboard from "@/pages/dashboard";
import AccountsPage from "@/pages/accounts";
import AccountDetailPage from "@/pages/accounts/detail";
import WebsitesPage from "@/pages/websites";
import BrandProfilesPage from "@/pages/brand-profiles";
import LocationsPage from "@/pages/locations";
import ServicesPage from "@/pages/services";
import IndustriesPage from "@/pages/industries";
import QueryClustersPage from "@/pages/query-clusters";
import BlueprintsPage from "@/pages/blueprints";
import DraftsPage from "@/pages/drafts";
import PublishQueuePage from "@/pages/publish-queue";
import PublishedPagesPage from "@/pages/published";
import JobsPage from "@/pages/jobs";
import SitemapsPage from "@/pages/sitemaps";
import UsersPage from "@/pages/users";
import GuidePage from "@/pages/guide";
import BulkGeneratorPage from "@/pages/bulk-generator";
import LeadsPage from "@/pages/leads";
import SearchControlPage from "@/pages/search-control";
import BankHealthPage from "@/pages/bank-health";
import HubPagesPage from "@/pages/hub-pages";
import InternalLinksPage from "@/pages/internal-links";
import AutomationPage from "@/pages/automation";
import AgenciesPage from "@/pages/agencies";
import OnboardWizard from "@/pages/agencies/onboard";
import NexusLandingPage from "@/pages/NexusLandingPage";
import WelcomePage from "@/pages/WelcomePage";
import OnboardForm from "@/pages/OnboardForm";
import CustomerDashboard from "@/pages/CustomerDashboard";
import OnboardingTestPage from "@/pages/onboarding-test";
import AgencyDashboardPage from "@/pages/agency-dashboard";

// ── Restored pages (files exist on disk; were only unlinked from router) ─────────────────────
import IntentBuildPage from "@/pages/intent-build-v2";
import ActionReviewPage from "@/pages/action-review";
import SearchConsolePage from "@/pages/search-console";
import OperationsPage from "@/pages/operations";
import ReportLinksPage from "@/pages/report-links";
import ClientDomainsPage from "@/pages/client-domains";
import ProductionValidationPage from "@/pages/production-validation";
import PageIntelligencePage from "@/pages/page-intelligence";

// ── Agency role helpers ────────────────────────────────────────────────────────────────────────
function isAgencyRole(user: any): boolean {
  return user?.role === "agency" || user?.role === "agency_admin";
}

function AuthGuard({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isLoading, user } = useAuth();
  const [, navigate] = useLocation();

  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      navigate("/login");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoading, isAuthenticated]);

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="size-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="size-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return <>{children}</>;
}

function LoginGuard() {
  const { isAuthenticated, isLoading, user } = useAuth();
  const [, navigate] = useLocation();

  useEffect(() => {
    if (!isLoading && isAuthenticated) {
      // Agency users land on their dedicated dashboard
      if (isAgencyRole(user)) {
        navigate("/agency-dashboard");
      } else {
        navigate("/");
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoading, isAuthenticated, user]);

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="size-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return <Login />;
}

function Router() {
  const landingDomain = (import.meta as any).env?.VITE_LANDING_DOMAIN || "spotonnexus.com";
  const hostname = typeof window !== "undefined" ? window.location.hostname : "";
  if (hostname === landingDomain || hostname === `www.${landingDomain}`) {
    return (
      <Switch>
        <Route path="/welcome"><WelcomePage /></Route>
        <Route path="/onboard/:token"><OnboardForm /></Route>
        <Route path="/dashboard/:token"><CustomerDashboard /></Route>
        <Route><NexusLandingPage /></Route>
      </Switch>
    );
  }

  return (
    <Switch>
      <Route path="/login">
        <LoginGuard />
      </Route>
      <Route path="/">
        <AuthGuard><Dashboard /></AuthGuard>
      </Route>
      <Route path="/agencies">
        <AuthGuard><AgenciesPage /></AuthGuard>
      </Route>
      <Route path="/agencies/:agencyId/onboard">
        <AuthGuard><OnboardWizard /></AuthGuard>
      </Route>
      <Route path="/accounts">
        <AuthGuard><AccountsPage /></AuthGuard>
      </Route>
      {/* Account detail — must be before /accounts so wouter doesn't swallow it */}
      <Route path="/accounts/:id">
        <AuthGuard><AccountDetailPage /></AuthGuard>
      </Route>
      <Route path="/websites">
        <AuthGuard><WebsitesPage /></AuthGuard>
      </Route>
      <Route path="/brand-profiles">
        <AuthGuard><BrandProfilesPage /></AuthGuard>
      </Route>
      <Route path="/locations">
        <AuthGuard><LocationsPage /></AuthGuard>
      </Route>
      <Route path="/services">
        <AuthGuard><ServicesPage /></AuthGuard>
      </Route>
      <Route path="/industries">
        <AuthGuard><IndustriesPage /></AuthGuard>
      </Route>
      <Route path="/query-clusters">
        <AuthGuard><QueryClustersPage /></AuthGuard>
      </Route>
      <Route path="/blueprints">
        <AuthGuard><BlueprintsPage /></AuthGuard>
      </Route>
      <Route path="/drafts">
        <AuthGuard><DraftsPage /></AuthGuard>
      </Route>
      <Route path="/publish-queue">
        <AuthGuard><PublishQueuePage /></AuthGuard>
      </Route>
      <Route path="/published">
        <AuthGuard><PublishedPagesPage /></AuthGuard>
      </Route>
      <Route path="/jobs">
        <AuthGuard><JobsPage /></AuthGuard>
      </Route>
      <Route path="/sitemaps">
        <AuthGuard><SitemapsPage /></AuthGuard>
      </Route>
      <Route path="/users">
        <AuthGuard><UsersPage /></AuthGuard>
      </Route>
      <Route path="/guide">
        <AuthGuard><GuidePage /></AuthGuard>
      </Route>
      <Route path="/bulk-generator">
        <AuthGuard><BulkGeneratorPage /></AuthGuard>
      </Route>
      <Route path="/leads">
        <AuthGuard><LeadsPage /></AuthGuard>
      </Route>
      <Route path="/agency-dashboard">
        <AuthGuard><AgencyDashboardPage /></AuthGuard>
      </Route>
      <Route path="/search-control">
        <AuthGuard><SearchControlPage /></AuthGuard>
      </Route>
      <Route path="/hub-pages">
        <AuthGuard><HubPagesPage /></AuthGuard>
      </Route>
      <Route path="/internal-links">
        <AuthGuard><InternalLinksPage /></AuthGuard>
      </Route>
      <Route path="/automation">
        <AuthGuard><AutomationPage /></AuthGuard>
      </Route>
      <Route path="/bank-health">
        <AuthGuard><BankHealthPage /></AuthGuard>
      </Route>
      <Route path="/onboarding-test">
        <AuthGuard><OnboardingTestPage /></AuthGuard>
      </Route>

      {/* ── Restored routes ──────────────────────────────────────────────────────────── */}
      <Route path="/intent-build">
        <AuthGuard><IntentBuildPage /></AuthGuard>
      </Route>
      <Route path="/action-review">
        <AuthGuard><ActionReviewPage /></AuthGuard>
      </Route>
      <Route path="/search-console">
        <AuthGuard><SearchConsolePage /></AuthGuard>
      </Route>
      <Route path="/operations">
        <AuthGuard><OperationsPage /></AuthGuard>
      </Route>
      <Route path="/report-links">
        <AuthGuard><ReportLinksPage /></AuthGuard>
      </Route>
      <Route path="/client-domains">
        <AuthGuard><ClientDomainsPage /></AuthGuard>
      </Route>
      <Route path="/production-validation">
        <AuthGuard><ProductionValidationPage /></AuthGuard>
      </Route>
      <Route path="/page-intelligence">
        <AuthGuard><PageIntelligencePage /></AuthGuard>
      </Route>

      <Route path="/report/:token">
        <ClientReportPage />
      </Route>
      <Route>
        <NotFound />
      </Route>
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Toaster />
        <ErrorBoundary>
          <Router />
        </ErrorBoundary>
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
