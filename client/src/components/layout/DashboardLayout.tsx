import { ReactNode } from "react";
import { Link, useLocation } from "wouter";
import { 
  LayoutDashboard, Users, Globe, FileText, Settings, CreditCard,
  Bell, Search, LogOut, Building2, MapPin, Wrench, Factory,
  Search as SearchIcon, Layers, Briefcase, Zap, BarChart3,
  Map, ChevronDown, ChevronRight
} from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
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
  { name: "Locations", href: "/locations", icon: MapPin },
  { name: "Services", href: "/services", icon: Wrench },
  { name: "Industries", href: "/industries", icon: Factory },
  { name: "Query Clusters", href: "/query-clusters", icon: SearchIcon },
  { name: "Blueprints", href: "/blueprints", icon: Layers },
];

const contentNav = [
  { name: "Draft Review", href: "/drafts", icon: FileText },
  { name: "Publish Queue", href: "/publish-queue", icon: Zap },
  { name: "Published Pages", href: "/published", icon: Globe },
  { name: "Generation Jobs", href: "/jobs", icon: BarChart3 },
  { name: "Sitemap Manager", href: "/sitemaps", icon: Map },
  { name: "Users & Roles", href: "/users", icon: Users },
];

export default function DashboardLayout({ children }: DashboardLayoutProps) {
  const [location] = useLocation();
  const { user, logout } = useAuth();
  const { toast } = useToast();

  const handleLogout = async () => {
    try {
      await logout.mutateAsync();
    } catch (err: any) {
      toast({ title: "Logout failed", description: err.message, variant: "destructive" });
    }
  };

  const NavItem = ({ item }: { item: { name: string; href: string; icon: any } }) => {
    const isActive = location === item.href || (item.href !== "/" && location.startsWith(item.href));
    return (
      <Link href={item.href}>
        <a className={`flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors ${
          isActive 
            ? "bg-primary/10 text-primary" 
            : "text-muted-foreground hover:bg-muted hover:text-foreground"
        }`}>
          <item.icon className={`size-4 shrink-0 ${isActive ? "text-primary" : ""}`} />
          {item.name}
        </a>
      </Link>
    );
  };

  return (
    <div className="min-h-screen bg-background flex">
      {/* Sidebar */}
      <aside className="hidden md:flex w-60 flex-col border-r bg-card sticky top-0 h-screen z-40 shrink-0">
        <div className="h-14 flex items-center px-4 border-b">
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
          {navigation.map((item) => <NavItem key={item.name} item={item} />)}

          <Separator className="my-3" />
          <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1 px-2">
            Content
          </div>
          {contentNav.map((item) => <NavItem key={item.name} item={item} />)}
        </div>

        <div className="p-3 mt-auto border-t">
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
            <Button variant="ghost" size="icon" className="size-7 text-muted-foreground" onClick={handleLogout}>
              <LogOut className="size-3.5" />
            </Button>
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col min-h-screen overflow-hidden">
        <header className="h-14 border-b bg-background/95 backdrop-blur sticky top-0 z-30 flex items-center justify-between px-6">
          <div className="flex items-center gap-3 flex-1">
            <div className="relative w-full max-w-sm hidden md:block">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <input
                type="search"
                placeholder="Search..."
                className="w-full bg-muted/50 pl-9 h-9 rounded-md border-none text-sm focus:outline-none focus:ring-1 focus:ring-ring px-3"
              />
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="icon" className="relative text-muted-foreground size-8">
              <Bell className="size-4" />
            </Button>
          </div>
        </header>

        <div className="flex-1 overflow-auto bg-muted/20">
          <div className="p-6 max-w-7xl mx-auto">
            {children}
          </div>
        </div>
      </main>
    </div>
  );
}
