import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, useEffect } from "react";
import DashboardLayout from "@/components/layout/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Search, ExternalLink, Settings, RefreshCw, Trash, Globe, MoreHorizontal, Pencil } from "lucide-react";
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
  const [editWebsite, setEditWebsite] = useState<any>(null);
  const { register, handleSubmit, reset, setValue } = useForm<any>();
  const { register: regEdit, handleSubmit: handleEdit, reset: resetEdit, setValue: setEditValue, watch: watchEdit } = useForm<any>();

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

  const update = useMutation({
    mutationFn: ({ id, data }: { id: string; data: any }) => api.patch(`/api/websites/${id}`, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/websites"] });
      setEditWebsite(null);
      toast({ title: "Website updated" });
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/api/websites/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/websites"] });
      toast({ title: "Website deleted" });
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  // Pre-fill edit form when a website is selected for editing
  useEffect(() => {
    if (editWebsite) {
      const s = editWebsite.settings || {};
      resetEdit({
        name: editWebsite.name,
        domain: editWebsite.domain,
        status: editWebsite.status,
        demoBannerUrl: s.demoBannerUrl || "",
        demoBannerHeading: s.demoBannerHeading || "",
        demoBannerSubtext: s.demoBannerSubtext || "",
        demoBannerButtonLabel: s.demoBannerButtonLabel || "",
      });
    }
  }, [editWebsite, resetEdit]);

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
          <Button className="gap-2" size="sm" onClick={() => setShowCreate(true)} data-testid="button-add-website">
            <Plus className="size-4" />Add Website
          </Button>
        </div>

        <div className="flex items-center gap-3 bg-card p-3 rounded-lg border">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input placeholder="Search domains..." className="pl-9 h-9" value={searchText} onChange={e => setSearchText(e.target.value)} data-testid="input-search-websites" />
          </div>
          <Button variant="outline" size="sm" onClick={() => qc.invalidateQueries({ queryKey: ["/api/websites"] })} data-testid="button-refresh-websites">
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
                        <Button variant="ghost" className="h-8 w-8 p-0" data-testid={`button-menu-website-${w.id}`}>
                          <MoreHorizontal className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem className="gap-2 cursor-pointer" onClick={() => setEditWebsite(w)} data-testid={`button-edit-website-${w.id}`}>
                          <Pencil className="size-4" />Edit
                        </DropdownMenuItem>
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
                          onClick={() => confirm("Delete website and all its pages? This cannot be undone.") && remove.mutate(w.id)}
                          data-testid={`button-delete-website-${w.id}`}
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

      {/* ── Create Dialog ── */}
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
              <Input placeholder="My Plumbing Site" {...register("name", { required: true })} data-testid="input-website-name" />
            </div>
            <div className="space-y-1.5">
              <Label>Domain</Label>
              <Input placeholder="mysite.com" {...register("domain", { required: true })} data-testid="input-website-domain" />
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
              <Button type="submit" disabled={create.isPending} data-testid="button-submit-create-website">Create</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* ── Edit Dialog ── */}
      <Dialog open={!!editWebsite} onOpenChange={open => !open && setEditWebsite(null)}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Edit Website</DialogTitle></DialogHeader>
          <form onSubmit={handleEdit(d => {
            const { demoBannerUrl, demoBannerHeading, demoBannerSubtext, demoBannerButtonLabel, ...rest } = d;
            const existingSettings = editWebsite?.settings || {};
            update.mutate({
              id: editWebsite.id,
              data: {
                ...rest,
                settings: {
                  ...existingSettings,
                  demoBannerUrl: demoBannerUrl || "",
                  demoBannerHeading: demoBannerHeading || "",
                  demoBannerSubtext: demoBannerSubtext || "",
                  demoBannerButtonLabel: demoBannerButtonLabel || "",
                },
              },
            });
          })} className="space-y-4">
            <div className="space-y-1.5">
              <Label>Website Name</Label>
              <Input {...regEdit("name", { required: true })} data-testid="input-edit-website-name" />
            </div>
            <div className="space-y-1.5">
              <Label>Domain</Label>
              <Input {...regEdit("domain", { required: true })} data-testid="input-edit-website-domain" />
            </div>
            <div className="space-y-1.5">
              <Label>Status</Label>
              <Select
                value={watchEdit("status") || editWebsite?.status || "paused"}
                onValueChange={v => setEditValue("status", v)}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="paused">Paused</SelectItem>
                  <SelectItem value="live">Live</SelectItem>
                  <SelectItem value="syncing">Syncing</SelectItem>
                  <SelectItem value="error">Error</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Demo Banner */}
            <div className="border rounded-lg p-3 space-y-3 bg-muted/30">
              <p className="text-sm font-semibold">Demo Banner <span className="text-muted-foreground font-normal">(appears at top of every page)</span></p>
              <div className="space-y-1.5">
                <Label className="text-xs">Demo URL <span className="text-muted-foreground">(leave blank to hide banner)</span></Label>
                <Input {...regEdit("demoBannerUrl")} placeholder="https://sospages.replit.app" data-testid="input-demo-banner-url" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Heading</Label>
                <Input {...regEdit("demoBannerHeading")} placeholder="See This Platform in Action" data-testid="input-demo-banner-heading" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Subtext</Label>
                <Input {...regEdit("demoBannerSubtext")} placeholder="This page was generated automatically..." data-testid="input-demo-banner-subtext" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Button Label</Label>
                <Input {...regEdit("demoBannerButtonLabel")} placeholder="Try the Live Demo →" data-testid="input-demo-banner-button" />
              </div>
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setEditWebsite(null)}>Cancel</Button>
              <Button type="submit" disabled={update.isPending} data-testid="button-submit-edit-website">Save</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
}
