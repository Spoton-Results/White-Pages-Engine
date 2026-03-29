import DashboardLayout from "@/components/layout/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Plus, Search, MoreHorizontal, Settings, Trash, Eye } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

const accounts = [
  { id: "acc_1", name: "Acme Corp", plan: "Enterprise", status: "Active", websites: 12, pages: "45,000" },
  { id: "acc_2", name: "Global Services", plan: "Pro", status: "Active", websites: 5, pages: "12,400" },
  { id: "acc_3", name: "Local Plumbers LLC", plan: "Starter", status: "Paused", websites: 1, pages: "500" },
  { id: "acc_4", name: "Tech Solutions", plan: "Pro", status: "Active", websites: 3, pages: "8,200" },
  { id: "acc_5", name: "National HVAC", plan: "Enterprise", status: "Active", websites: 24, pages: "112,000" },
];

export default function AccountsPage() {
  return (
    <DashboardLayout>
      <div className="flex flex-col gap-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Accounts</h1>
            <p className="text-muted-foreground mt-1">Manage client accounts and platform access.</p>
          </div>
          <Button className="gap-2">
            <Plus className="size-4" />
            New Account
          </Button>
        </div>

        <div className="flex items-center justify-between gap-4 bg-card p-4 rounded-lg border shadow-sm">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input placeholder="Search accounts..." className="pl-9" />
          </div>
          <div className="flex gap-2">
            <Button variant="outline">Filter</Button>
            <Button variant="outline">Export</Button>
          </div>
        </div>

        <div className="bg-card rounded-lg border shadow-sm overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Account Name</TableHead>
                <TableHead>Plan</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Websites</TableHead>
                <TableHead className="text-right">Total Pages</TableHead>
                <TableHead className="w-[50px]"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {accounts.map((account) => (
                <TableRow key={account.id}>
                  <TableCell className="font-medium">{account.name}</TableCell>
                  <TableCell>
                    <Badge variant="secondary" className={
                      account.plan === "Enterprise" ? "bg-primary/10 text-primary hover:bg-primary/20" : ""
                    }>
                      {account.plan}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <Badge variant={account.status === "Active" ? "default" : "secondary"} className={
                      account.status === "Active" ? "bg-emerald-500/10 text-emerald-500 hover:bg-emerald-500/20 hover:text-emerald-600" : ""
                    }>
                      {account.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">{account.websites}</TableCell>
                  <TableCell className="text-right">{account.pages}</TableCell>
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
                        <DropdownMenuItem className="gap-2"><Eye className="size-4" /> View Details</DropdownMenuItem>
                        <DropdownMenuItem className="gap-2"><Settings className="size-4" /> Edit Configuration</DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem className="text-destructive gap-2"><Trash className="size-4" /> Delete Account</DropdownMenuItem>
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