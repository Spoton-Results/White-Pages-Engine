import { Switch, Route, useLocation } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useEffect } from "react";
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

function AuthGuard({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isLoading } = useAuth();
  const [, navigate] = useLocation();

  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      navigate("/login");
    }
  }, [isLoading, isAuthenticated, navigate]);

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
  const { isAuthenticated, isLoading } = useAuth();
  const [, navigate] = useLocation();

  useEffect(() => {
    if (!isLoading && isAuthenticated) {
      navigate("/");
    }
  }, [isLoading, isAuthenticated, navigate]);

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
  return (
    <Switch>
      <Route path="/login">
        <LoginGuard />
      </Route>
      <Route path="/">
        <AuthGuard><Dashboard /></AuthGuard>
      </Route>
      <Route path="/accounts">
        <AuthGuard><AccountsPage /></AuthGuard>
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
        <Router />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
