import { ReactNode, useState, useCallback } from "react";
import { Link, useLocation } from "wouter";
import {
  LayoutDashboard, Users, Globe,
  Bell, LogOut, Building2, MapPin, Wrench,
  Search as SearchIcon, Layers, Briefcase, Zap, BarChart3,
  Map, Menu, X, BookOpen, Inbox, Factory, ShieldCheck, Activity, Network, Link2, Bot,
  ChevronDown, Handshake, FlaskConical, PhoneCall,
} from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import {
  AccountContext,
  useAccountContext,
  loadFromStorage,
  saveToStorage,
  STORAGE_KEY_AGENCY,
  STORAGE_KEY_ACCOUNT,
} from "@/hooks/use-account-context";

interface DashboardLayoutProps {
  children: ReactNode;
}

const navigation = [
  { name: "Overview", href: "/", icon: LayoutDashboard },
  { name: "Agencies", href: "/agencies", icon: Handshake },
  { name: "Accounts", href: "/accounts", icon: Building2 },
  { name: "Websites", href: "/websites", icon: Globe },
  { name: "Brand Profiles", href: "/brand-profiles", icon: Briefcase },
  { name: "Industries", href: "/industries", icon: Factory },
  { name: "Locations", href: "/locations", icon: MapPin },
  { name: "Services", href: "/services", icon: Wrench },
  { name: "Query Clusters", href: "/query-clusters", icon: SearchIcon },
  { name: "Blueprints", href: "/blueprints", icon: Layers },
  { name: "Hub Pages", href: "/hub-pages", icon: Network },
];

const testingNav = [
  { name: "Onboarding Test", href: "/onboarding-test", icon: FlaskConical },
];

const contentNav = [
  { name: "Published Pages", href: "/published", icon: Globe },
  { name: "Leads", href: "/leads", icon: Inbox },
  { name: "Leads & Conversions", href: "/agency-dashboard", icon: PhoneCall },
  { name: "Bulk Generator", href: "/bulk-generator", icon: Zap },
  { name: "Generation Jobs", href: "/jobs", icon: BarChart3 },
  { name: "Sitemap Manager", href: "/sitemaps", icon: Map },
  { name: "Internal Links", href: "/internal-links", icon: Link2 },
  { name: "Automation", href: "/automation", icon: Bot },
  { name: "Bank Health", href: "/bank-health", icon: Activity },
  { name: "SEO Control", href: "/search-control", icon: ShieldCheck },
  { name: "Users & Roles", href: "/users", icon: Users },
  { name: "Operations Guide", href: "/guide", icon: BookOpen },
];

function NavItem({ item, onClick }: { item: { name: string; href: string; icon: any }; onClick?: () => void }) {
  const [location] = useLocation();
  const isActive = location === item.href || (item.href !== "/" && location.startsWith(item.href));
  return (
    <Link href={item.href}>
      <a
        onClick={onClick}
        className={`flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors ${
          isActive
            ? "bg-primary/10 text-primary"
            : "text-muted-foreground hover:bg-muted hover:text-foreground"
        }`}
      >
        <item.icon className={`size-4 shrink-0 ${isActive ? "text-primary" : ""}`} />
        {item.name}
      </a>
    </Link>
  );
}

function SidebarContent({ onNav }: { onNav?: () => void }) {
  const { user, logout } = useAuth();
  const { toast } = useToast();

  const handleLogout = async () => {
    try {
      await logout.mutateAsync();
    } catch (err: any) {
      toast({ title: "Logout failed", description: err.message, variant: "destructive" });
    }
  };

  return (
    <div className="flex flex-col h-full">
      <div className="h-14 flex items-center px-4 border-b shrink-0">
        <div className="flex items-center gap-2 font-bold text-lg tracking-tight">
          <div className="size-7 rounded bg-primary flex items-center justify-center text-primary-foreground">
            <Globe className="size-4" />
          </div>
          <span>Nexus</span>
        </div>
      </div>

      <div className="md:hidden px-3 py-3 border-b">
        <AgencyClientSwitcher stacked />
      </div>

      <div className="flex-1 py-4 px-3 flex flex-col gap-0.5 overflow-y-auto">
        <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1 px-2">
          Platform
        </div>
        {navigation.map(item => <NavItem key={item.name} item={item} onClick={onNav} />)}

        <Separator className="my-3" />
        <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1 px-2">
          Content
        </div>
        {contentNav.map(item => <NavItem key={item.name} item={item} onClick={onNav} />)}

        <Separator className="my-3" />
        <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1 px-2">
          Testing
        </div>
        {testingNav.map(item => <NavItem key={item.name} item={item} onClick={onNav} />)}
      </div>

      <div className="p-3 mt-auto border-t shrink-0">
        <div className="flex items-center gap-3 px-2 py-1.5">
          <Avatar className="size-7">
            <AvatarFallback className="text-xs bg-primary/10 text-primary">
              {user?.username?.slice(0, 2).toUpperCase() || "??"}
            </AvatarFallback>
          </Avatar>
          <div className="flex flex-col flex-1 min-w-0">
            <span className="text-sm font-medium leading-none truncate">{user?.username || "..."}</span>
            <span className="text-xs text-muted-foreground truncate">{user?.role || ""}</span>
          </div>
          <Button variant="ghost" size="icon" className="size-7 text-muted-foreground" onClick={handleLogout} data-testid="button-logout">
            <LogOut className="size-3.5" />
          </Button>
        </div>
      </div>
    </div>
  );
}

function AgencyClientSwitcher({ stacked = false }: { stacked?: boolean }) {
  const { selectedAgencyId, selectedAccountId, setSelectedAgencyId, setSelectedAccountId } = useAccountContext();

  const { data: agencies = [] } = useQuery({
    queryKey: ["/api/agencies"],
    queryFn: () => api.get<any[]>("/api/agencies"),
  });

  const { data: accounts = [] } = useQuery({
    queryKey: ["/api/accounts"],
    queryFn: () => api.get<any[]>("/api/accounts"),
  });

  const filteredAccounts = selectedAgencyId
    ? (accounts as any[]).filter((a: any) => a.agencyId === selectedAgencyId)
    : (accounts as any[]);

  const handleAgencyChange = (val: string) => {
    const newAgencyId = val === "all" ? null : val;
    setSelectedAgencyId(newAgencyId);
    setSelectedAccountId(null);
  };

  const handleAccountChange = (val: string) => {
    setSelectedAccountId(val === "all" ? null : val);
  };

  const selectedAgencyLabel = selectedAgencyId
    ? (agencies as any[]).find((a: any) => a.id === selectedAgencyId)?.name ?? "Agency"
    : "All Agencies";

  const selectedAccountLabel = selectedAccountId
    ? (accounts as any[]).find((a: any) => a.id === selectedAccountId)?.name ?? "Client"
    : "All Clients";

  return (
    <div className={stacked ? "flex flex-col gap-2 w-full" : "flex items-center gap-2"} data-testid="agency-client-switcher">
      <Select value={selectedAgencyId ?? "all"} onValueChange={handleAgencyChange}>
        <SelectTrigger className={`h-8 text-xs gap-1 ${stacked ? "w-full" : "w-[160px]"}`} data-testid="select-agency">
          <Handshake className="size-3 text-muted-foreground shrink-0" />
          <SelectValue placeholder="All Agencies">
            <span className="truncate">{selectedAgencyLabel}</span>
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All Agencies</SelectItem>
          {(agencies as any[]).map((a: any) => (
            <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select value={selectedAccountId ?? "all"} onValueChange={handleAccountChange}>
        <SelectTrigger className={`h-8 text-xs gap-1 ${stacked ? "w-full" : "w-[160px]"}`} data-testid="select-client">
          <Building2 className="size-3 text-muted-foreground shrink-0" />
          <SelectValue placeholder="All Clients">
            <span className="truncate">{selectedAccountLabel}</span>
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All Clients</SelectItem>
          {filteredAccounts.map((a: any) => (
            <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

export default function DashboardLayout({ children }: DashboardLayoutProps) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [selectedAgencyId, setSelectedAgencyIdRaw] = useState<string | null>(() => loadFromStorage(STORAGE_KEY_AGENCY));
  const [selectedAccountId, setSelectedAccountIdRaw] = useState<string | null>(() => loadFromStorage(STORAGE_KEY_ACCOUNT));

  const setSelectedAgencyId = useCallback((id: string | null) => {
    setSelectedAgencyIdRaw(id);
    saveToStorage(STORAGE_KEY_AGENCY, id);
  }, []);

  const setSelectedAccountId = useCallback((id: string | null) => {
    setSelectedAccountIdRaw(id);
    saveToStorage(STORAGE_KEY_ACCOUNT, id);
  }, []);

  return (
    <AccountContext.Provider value={{ selectedAgencyId, selectedAccountId, setSelectedAgencyId, setSelectedAccountId }}>
      <div className="min-h-screen bg-background flex">
        {/* Desktop Sidebar */}
        <aside className="hidden md:flex w-60 flex-col border-r bg-card sticky top-0 h-screen z-40 shrink-0">
          <SidebarContent />
        </aside>

        {/* Mobile Drawer */}
        <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
          <SheetContent side="left" className="p-0 w-64" aria-describedby={undefined}>
            <SheetHeader className="sr-only">
              <SheetTitle>Navigation</SheetTitle>
            </SheetHeader>
            <SidebarContent onNav={() => setMobileOpen(false)} />
          </SheetContent>
        </Sheet>

        {/* Main Content */}
        <main className="flex-1 flex flex-col min-h-screen overflow-hidden">
          <header className="h-14 border-b bg-background/95 backdrop-blur sticky top-0 z-30 flex items-center justify-between px-4 gap-3">
            {/* Hamburger — mobile only */}
            <Button
              variant="ghost"
              size="icon"
              className="md:hidden shrink-0"
              onClick={() => setMobileOpen(true)}
              data-testid="button-mobile-menu"
            >
              <Menu className="size-5" />
            </Button>

            {/* Logo — mobile only (desktop shows in sidebar) */}
            <div className="md:hidden flex items-center gap-2 font-bold text-base">
              <div className="size-6 rounded bg-primary flex items-center justify-center text-primary-foreground">
                <Globe className="size-3.5" />
              </div>
              <span>Nexus</span>
            </div>

            <div className="flex-1 hidden md:block" />

            <div className="flex items-center gap-3">
              <div className="hidden md:flex">
                <AgencyClientSwitcher />
              </div>
              <Button variant="ghost" size="icon" className="text-muted-foreground size-8">
                <Bell className="size-4" />
              </Button>
            </div>
          </header>

          <div className="flex-1 overflow-auto bg-muted/20">
            <div className="p-4 md:p-6 max-w-7xl mx-auto">
              {children}
            </div>
          </div>
        </main>
      </div>
    </AccountContext.Provider>
  );
}
