import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import DashboardLayout from "@/components/layout/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Search, ExternalLink, Settings, RefreshCw, Trash, Globe, MoreHorizontal } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import { api } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";
import { Link, useSearch } from "wouter";
import { useForm } from "react-hook-form";

export default function WebsitesPage() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const search = useSearch();
  const params = new URLSearchParams(search);
  const accountIdFilter = params.get("accountId");

  const [searchText, setSearchText] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const { register, handleSubmit, reset, setValue } = useForm<any>();

  const { data: websites = [], isLoading } = useQuery({
    queryKey: ["/api/websites", accountIdFilter],
    queryFn: () => api.get<any[]>(`/api/websites${accountIdFilter ? `?accountId=${accountIdFilter}` : ""}`),
  });

  const { data: accounts = [] } = useQuery({
    queryKey: ["/api/accounts"],
    queryFn: () => api.get<any[]>("/api/accounts"),
  });

  const create = useMutation({
    mutationFn: (data: any) => api.post("/api/websites", data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/websites"] });
      qc.invalidateQueries({ queryKey: ["/api/dashboard/stats"] });
      setShowCreate(false);
      reset();
      toast({ title: "Website created" });
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/api/websites/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/websites"] });
      toast({ title: "Website deleted" });
    },
  });

  const filtered = websites.filter((w: any) =>
    w.domain.toLowerCase().includes(searchText.toLowerCase()) ||
    w.name.toLowerCase().includes(searchText.toLowerCase())
  );

  return (
    <DashboardLayout>
      <div className="flex flex-col gap-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Websites</h1>
            <p className="text-muted-foreground text-sm mt-0.5">Manage target domains and deployment settings.</p>
          </div>
          <Button className="gap-2" size="sm" onClick={() => setShowCreate(true)}>
            <Plus className="size-4" />Add Website
          </Button>
        </div>

        <div className="flex items-center gap-3 bg-card p-3 rounded-lg border">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input placeholder="Search domains..." className="pl-9 h-9" value={searchText} onChange={e => setSearchText(e.target.value)} />
          </div>
          <Button variant="outline" size="sm" onClick={() => qc.invalidateQueries({ queryKey: ["/api/websites"] })}>
            <RefreshCw className="size-4" />
          </Button>
        </div>

        <div className="bg-card rounded-lg border overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Domain</TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Published</TableHead>
                <TableHead className="w-[60px]"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                Array.from({ length: 4 }).map((_, i) => (
                  <TableRow key={i}>
                    {Array.from({ length: 5 }).map((_, j) => (
                      <TableCell key={j}><Skeleton className="h-4 w-full" /></TableCell>
                    ))}
                  </TableRow>
                ))
              ) : filtered.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">
                    No websites found.
                  </TableCell>
                </TableRow>
              ) : filtered.map((w: any) => (
                <TableRow key={w.id} data-testid={`row-website-${w.id}`}>
                  <TableCell>
                    <div className="flex items-center gap-2 font-mono text-sm">
                      {w.domain}
                      <a href={`https://${w.domain}`} target="_blank" rel="noopener noreferrer">
                        <ExternalLink className="size-3 text-muted-foreground hover:text-primary" />
                      </a>
                    </div>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{w.name}</TableCell>
                  <TableCell>
                    <Badge variant="outline" className={
                      w.status === "live" ? "bg-emerald-500/10 text-emerald-600 border-emerald-200" :
                      w.status === "syncing" ? "bg-blue-500/10 text-blue-600 border-blue-200" :
                      w.status === "error" ? "bg-red-500/10 text-red-600 border-red-200" :
                      "bg-muted text-muted-foreground"
                    }>
                      {w.status === "syncing" && <RefreshCw className="mr-1 size-3 animate-spin" />}
                      {w.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">{w.publishedPages?.toLocaleString() || 0}</TableCell>
                  <TableCell>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" className="h-8 w-8 p-0">
                          <MoreHorizontal className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <Link href={`/published?websiteId=${w.id}`}>
                          <DropdownMenuItem className="gap-2 cursor-pointer"><Globe className="size-4" />View Pages</DropdownMenuItem>
                        </Link>
                        <Link href={`/jobs?websiteId=${w.id}`}>
                          <DropdownMenuItem className="gap-2 cursor-pointer"><Settings className="size-4" />Run Generation</DropdownMenuItem>
                        </Link>
                        <Link href={`/sitemaps?websiteId=${w.id}`}>
                          <DropdownMenuItem className="gap-2 cursor-pointer">Sitemaps</DropdownMenuItem>
                        </Link>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          className="gap-2 text-destructive cursor-pointer"
                          onClick={() => confirm("Delete website?") && remove.mutate(w.id)}
                        >
                          <Trash className="size-4" />Delete
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </div>

      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent>
          <DialogHeader><DialogTitle>Add Website</DialogTitle></DialogHeader>
          <form onSubmit={handleSubmit(d => create.mutate(d))} className="space-y-4">
            <div className="space-y-1.5">
              <Label>Account</Label>
              <Select onValueChange={v => setValue("accountId", v)}>
                <SelectTrigger><SelectValue placeholder="Select account" /></SelectTrigger>
                <SelectContent>
                  {accounts.map((a: any) => (
                    <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Website Name</Label>
              <Input placeholder="My Plumbing Site" {...register("name", { required: true })} />
            </div>
            <div className="space-y-1.5">
              <Label>Domain</Label>
              <Input placeholder="mysite.com" {...register("domain", { required: true })} />
            </div>
            <div className="space-y-1.5">
              <Label>Status</Label>
              <Select onValueChange={v => setValue("status", v)} defaultValue="paused">
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="paused">Paused</SelectItem>
                  <SelectItem value="live">Live</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setShowCreate(false)}>Cancel</Button>
              <Button type="submit" disabled={create.isPending}>Create</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
}
