import { Switch, Route, useLocation, Redirect } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useAuth } from "@/hooks/use-auth";
import NotFound from "@/pages/not-found";

// Pages
import Login from "@/pages/login";
import Dashboard from "@/pages/dashboard";
import AccountsPage from "@/pages/accounts";
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

function ProtectedRoute({ component: Component }: { component: React.ComponentType }) {
  const { isAuthenticated, isLoading } = useAuth();
  const [location] = useLocation();

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="size-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Redirect to="/login" />;
  }

  return <Component />;
}

function Router() {
  return (
    <Switch>
      <Route path="/login" component={Login} />
      <Route path="/" component={() => <ProtectedRoute component={Dashboard} />} />
      <Route path="/accounts" component={() => <ProtectedRoute component={AccountsPage} />} />
      <Route path="/websites" component={() => <ProtectedRoute component={WebsitesPage} />} />
      <Route path="/brand-profiles" component={() => <ProtectedRoute component={BrandProfilesPage} />} />
      <Route path="/locations" component={() => <ProtectedRoute component={LocationsPage} />} />
      <Route path="/services" component={() => <ProtectedRoute component={ServicesPage} />} />
      <Route path="/industries" component={() => <ProtectedRoute component={IndustriesPage} />} />
      <Route path="/query-clusters" component={() => <ProtectedRoute component={QueryClustersPage} />} />
      <Route path="/blueprints" component={() => <ProtectedRoute component={BlueprintsPage} />} />
      <Route path="/drafts" component={() => <ProtectedRoute component={DraftsPage} />} />
      <Route path="/publish-queue" component={() => <ProtectedRoute component={PublishQueuePage} />} />
      <Route path="/published" component={() => <ProtectedRoute component={PublishedPagesPage} />} />
      <Route path="/jobs" component={() => <ProtectedRoute component={JobsPage} />} />
      <Route path="/sitemaps" component={() => <ProtectedRoute component={SitemapsPage} />} />
      <Route path="/users" component={() => <ProtectedRoute component={UsersPage} />} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Toaster />
        <Router />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
