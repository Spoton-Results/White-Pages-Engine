import DashboardLayout from "@/components/layout/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Plus, Search, MoreHorizontal, Settings, ExternalLink, RefreshCw } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

const websites = [
  { id: "web_1", domain: "plumbing-atlanta.com", account: "Acme Corp", status: "Live", pages: "1,240", lastUpdate: "2h ago" },
  { id: "web_2", domain: "hvac-pros-dallas.net", account: "Global Services", status: "Syncing", pages: "840", lastUpdate: "10m ago" },
  { id: "web_3", domain: "electrician-miami.org", account: "Acme Corp", status: "Live", pages: "2,100", lastUpdate: "1d ago" },
  { id: "web_4", domain: "roofing-chicago.com", account: "Tech Solutions", status: "Error", pages: "0", lastUpdate: "5m ago" },
  { id: "web_5", domain: "pest-control-nyc.com", account: "National HVAC", status: "Live", pages: "3,500", lastUpdate: "4h ago" },
];

export default function WebsitesPage() {
  return (
    <DashboardLayout>
      <div className="flex flex-col gap-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Websites</h1>
            <p className="text-muted-foreground mt-1">Manage target domains and content deployment.</p>
          </div>
          <Button className="gap-2">
            <Plus className="size-4" />
            Add Website
          </Button>
        </div>

        <div className="flex items-center justify-between gap-4 bg-card p-4 rounded-lg border shadow-sm">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input placeholder="Search domains..." className="pl-9" />
          </div>
          <div className="flex gap-2">
            <Button variant="outline">Filter by Account</Button>
          </div>
        </div>

        <div className="bg-card rounded-lg border shadow-sm overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Domain</TableHead>
                <TableHead>Account</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Published Pages</TableHead>
                <TableHead className="text-right">Last Sync</TableHead>
                <TableHead className="w-[50px]"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {websites.map((website) => (
                <TableRow key={website.id}>
                  <TableCell className="font-medium flex items-center gap-2">
                    {website.domain}
                    <ExternalLink className="size-3 text-muted-foreground hover:text-primary cursor-pointer" />
                  </TableCell>
                  <TableCell className="text-muted-foreground">{website.account}</TableCell>
                  <TableCell>
                    <Badge variant="outline" className={
                      website.status === "Live" ? "bg-emerald-500/10 text-emerald-500 border-emerald-500/20" :
                      website.status === "Syncing" ? "bg-blue-500/10 text-blue-500 border-blue-500/20" :
                      "bg-destructive/10 text-destructive border-destructive/20"
                    }>
                      {website.status === "Syncing" && <RefreshCw className="mr-1 size-3 animate-spin" />}
                      {website.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">{website.pages}</TableCell>
                  <TableCell className="text-right text-muted-foreground">{website.lastUpdate}</TableCell>
                  <TableCell>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" className="h-8 w-8 p-0">
                          <span className="sr-only">Open menu</span>
                          <MoreHorizontal className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuLabel>Actions</DropdownMenuLabel>
                        <DropdownMenuItem className="gap-2"><Settings className="size-4" /> Cloudflare Config</DropdownMenuItem>
                        <DropdownMenuItem className="gap-2"><RefreshCw className="size-4" /> Force Sync</DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem className="gap-2 text-primary">View Sitemap</DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </div>
    </DashboardLayout>
  );
}