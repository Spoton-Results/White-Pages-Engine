import { ReactNode, useState } from "react";
import { Link, useLocation } from "wouter";
import {
  LayoutDashboard, Users, Globe,
  Bell, LogOut, Building2, MapPin, Wrench,
  Search as SearchIcon, Layers, Briefcase, Zap, BarChart3,
  Map, Menu, X, BookOpen, Inbox, Factory, ShieldCheck, Activity, Network
} from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";

interface DashboardLayoutProps {
  children: ReactNode;
}

const navigation = [
  { name: "Overview", href: "/", icon: LayoutDashboard },
  { name: "Accounts", href: "/accounts", icon: Building2 },
  { name: "Websites", href: "/websites", icon: Globe },
  { name: "Brand Profiles", href: "/brand-profiles", icon: Briefcase },
  { name: "Industries", href: "/industries", icon: Factory },
  { name: "Locations", href: "/locations", icon: MapPin },
  { name: "Services", href: "/services", icon: Wrench },
  { name: "Query Clusters", href: "/query-clusters", icon: SearchIcon },
  { name: "Blueprints", href: "/blueprints", icon: Layers },
];

const contentNav = [
  { name: "Published Pages", href: "/published", icon: Globe },
  { name: "Leads", href: "/leads", icon: Inbox },
  { name: "Bulk Generator", href: "/bulk-generator", icon: Zap },
  { name: "Generation Jobs", href: "/jobs", icon: BarChart3 },
  { name: "Sitemap Manager", href: "/sitemaps", icon: Map },
  { name: "Hub Pages", href: "/hub-pages", icon: Network },
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

export default function DashboardLayout({ children }: DashboardLayoutProps) {
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
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

          <div className="flex items-center gap-2">
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
  );
}
