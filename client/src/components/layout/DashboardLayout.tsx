import { ReactNode } from "react";
import { Link, useLocation } from "wouter";
import { 
  LayoutDashboard, 
  Users, 
  Globe, 
  FileText, 
  Settings, 
  CreditCard,
  LogOut,
  Bell,
  Search
} from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";

interface DashboardLayoutProps {
  children: ReactNode;
}

const navigation = [
  { name: "Overview", href: "/", icon: LayoutDashboard },
  { name: "Accounts", href: "/accounts", icon: Users },
  { name: "Websites", href: "/websites", icon: Globe },
  { name: "Campaigns", href: "/campaigns", icon: FileText },
  { name: "Billing", href: "/billing", icon: CreditCard },
  { name: "Settings", href: "/settings", icon: Settings },
];

export default function DashboardLayout({ children }: DashboardLayoutProps) {
  const [location] = useLocation();

  return (
    <div className="min-h-screen bg-background flex flex-col md:flex-row">
      {/* Sidebar */}
      <aside className="hidden md:flex w-64 flex-col border-r bg-card/50 backdrop-blur-sm sticky top-0 h-screen z-40">
        <div className="h-16 flex items-center px-6 border-b">
          <div className="flex items-center gap-2 font-bold text-xl tracking-tight">
            <div className="size-8 rounded bg-primary flex items-center justify-center text-primary-foreground">
              <Globe className="size-5" />
            </div>
            <span>Nexus</span>
          </div>
        </div>

        <div className="flex-1 py-6 px-4 flex flex-col gap-1 overflow-y-auto">
          <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2 px-2">
            Platform
          </div>
          {navigation.map((item) => {
            const isActive = location === item.href;
            return (
              <Link key={item.name} href={item.href}>
                <a className={`flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                  isActive 
                    ? "bg-primary/10 text-primary" 
                    : "text-muted-foreground hover:bg-muted hover:text-foreground"
                }`}>
                  <item.icon className={`size-4 ${isActive ? "text-primary" : ""}`} />
                  {item.name}
                </a>
              </Link>
            );
          })}
        </div>

        <div className="p-4 mt-auto border-t">
          <div className="flex items-center gap-3 px-2 py-2">
            <Avatar className="size-8">
              <AvatarImage src="https://i.pravatar.cc/150?u=admin" />
              <AvatarFallback>AD</AvatarFallback>
            </Avatar>
            <div className="flex flex-col">
              <span className="text-sm font-medium leading-none">Admin User</span>
              <span className="text-xs text-muted-foreground">admin@nexus.io</span>
            </div>
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col min-h-screen overflow-hidden">
        {/* Top Header */}
        <header className="h-16 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 sticky top-0 z-30 flex items-center justify-between px-6">
          <div className="flex items-center gap-4 flex-1">
            <div className="relative w-full max-w-md hidden md:block">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                type="search"
                placeholder="Search accounts, websites, or campaigns..."
                className="w-full bg-muted/50 pl-9 border-none focus-visible:ring-1"
              />
            </div>
          </div>
          
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="icon" className="relative text-muted-foreground hover:text-foreground">
              <Bell className="size-5" />
              <span className="absolute top-1.5 right-1.5 size-2 bg-destructive rounded-full border-2 border-background"></span>
            </Button>
            <Button variant="ghost" size="icon" className="text-muted-foreground hover:text-foreground">
              <Settings className="size-5" />
            </Button>
          </div>
        </header>

        {/* Page Content */}
        <div className="flex-1 overflow-auto bg-muted/20">
          <div className="p-6 md:p-8 max-w-7xl mx-auto">
            {children}
          </div>
        </div>
      </main>
    </div>
  );
}