import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import DashboardLayout from "@/components/layout/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Search, MoreHorizontal, Trash, Pencil, AlertTriangle, ChevronRight, Building2, RefreshCw, ChevronLeft, Activity, FileText, Globe, BarChart3, Zap } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { api } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";
import { useState } from "react";
import { useLocation } from "wouter";
import { useForm } from "react-hook-form";

export default function AgenciesPage() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [editAgency, setEditAgency] = useState<any>(null);
  const [deleteTarget, setDeleteTarget] = useState<any>(null);
  const [viewAgency, setViewAgency] = useState<any>(null);

  const [, navigate] = useLocation();
  const { register, handleSubmit, reset, setValue } = useForm<any>();
  const { register: regEdit, handleSubmit: handleEdit, reset: resetEdit, setValue: setEditValue } = useForm<any>();

  const [viewClient, setViewClient] = useState<any>(null);
  const [scorePromoting, setScorePromoting] = useState(false);

  const { data: agencies = [], isLoading, isFetching } = useQuery({
    queryKey: ["/api/agencies"],
    queryFn: () => api.get<any[]>("/api/agencies"),
  });

  const { data: viewAccounts = [], isLoading: loadingViewAccounts } = useQuery({
    queryKey: ["/api/agencies", viewAgency?.id, "accounts"],
    queryFn: () => api.get<any[]>(`/api/agencies/${viewAgency.id}/accounts`),
    enabled: !!viewAgency,
  });

  const { data: clientSummary, isLoading: loadingClientSummary } = useQuery({
    queryKey: ["/api/accounts", viewClient?.id, "client-summary"],
    queryFn: () => api.get<any>(`/api/accounts/${viewClient.id}/client-summary`),
    enabled: !!viewClient,
  });

  const { data: allAccounts = [] } = useQuery({
    queryKey: ["/api/accounts"],
    queryFn: () => api.get<any[]>("/api/accounts"),
  });

  const clientCountMap = (() => {
    const m: Record<string, number> = {};
    for (const acc of allAccounts as any[]) {
      if (acc.agencyId) {
        m[acc.agencyId] = (m[acc.agencyId] ?? 0) + 1;
      }
    }
    return m;
  })();

  const create = useMutation({
    mutationFn: (data: any) => api.post("/api/agencies", data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/agencies"] });
      setShowCreate(false);
      reset();
      toast({ title: "Agency created" });
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const update = useMutation({
    mutationFn: ({ id, data }: { id: string; data: any }) => api.put(`/api/agencies/${id}`, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/agencies"] });
      setEditAgency(null);
      resetEdit();
      toast({ title: "Agency updated" });
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/api/agencies/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/agencies"] });
      qc.invalidateQueries({ queryKey: ["/api/accounts"] });
      setDeleteTarget(null);
      toast({ title: "Agency deleted" });
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const openEdit = (agency: any) => {
    setEditAgency(agency);
    resetEdit();
    setEditValue("name", agency.name ?? "");
    setEditValue("contactName", agency.contactName ?? "");
    setEditValue("email", agency.email ?? "");
    setEditValue("phone", agency.phone ?? "");
    setEditValue("monthlyFee", agency.monthlyFee ?? "");
    setEditValue("startDate", agency.startDate ?? "");
    setEditValue("status", agency.status ?? "active");
  };

  const filtered = (agencies as any[]).filter(a =>
    a.name.toLowerCase().includes(search.toLowerCase()) ||
    (a.contactName ?? "").toLowerCase().includes(search.toLowerCase())
  );

  return (
    <DashboardLayout>
      <div className="flex flex-col gap-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Agencies</h1>
            <p className="text-muted-foreground text-sm mt-0.5">Manage agency partners and their client accounts.</p>
          </div>
          <Button className="gap-2" size="sm" onClick={() => setShowCreate(true)} data-testid="button-new-agency">
            <Plus className="size-4" />New Agency
          </Button>
        </div>

        <div className="flex items-center gap-3 bg-card p-3 rounded-lg border">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input placeholder="Search agencies..." className="pl-9 h-9" value={search} onChange={e => setSearch(e.target.value)} data-testid="input-search-agencies" />
          </div>
          <Button variant="outline" size="sm" onClick={() => qc.refetchQueries({ queryKey: ["/api/agencies"] })} disabled={isFetching}>
            <RefreshCw className={`size-4 ${isFetching ? "animate-spin" : ""}`} />
          </Button>
        </div>

        <div className="bg-card rounded-lg border overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Agency Name</TableHead>
                <TableHead>Contact</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Phone</TableHead>
                <TableHead>Monthly Fee</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Clients</TableHead>
                <TableHead className="w-[60px]"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                Array.from({ length: 4 }).map((_, i) => (
                  <TableRow key={i}>
                    {Array.from({ length: 8 }).map((_, j) => (
                      <TableCell key={j}><Skeleton className="h-4 w-full" /></TableCell>
                    ))}
                  </TableRow>
                ))
              ) : filtered.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="text-center py-8 text-muted-foreground">
                    {search ? "No agencies match your search." : "No agencies yet. Create one to get started."}
                  </TableCell>
                </TableRow>
              ) : filtered.map((agency: any) => (
                <TableRow
                  key={agency.id}
                  data-testid={`row-agency-${agency.id}`}
                  className="cursor-pointer hover:bg-muted/50"
                  onClick={() => setViewAgency(agency)}
                >
                  <TableCell className="font-medium flex items-center gap-2">
                    <Building2 className="size-4 text-muted-foreground shrink-0" />
                    {agency.name}
                  </TableCell>
                  <TableCell className="text-muted-foreground">{agency.contactName || "—"}</TableCell>
                  <TableCell className="text-muted-foreground">{agency.email || "—"}</TableCell>
                  <TableCell className="text-muted-foreground">{agency.phone || "—"}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {agency.monthlyFee ? `$${Number(agency.monthlyFee).toLocaleString()}` : "—"}
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className={
                      agency.status === "active" ? "bg-emerald-500/10 text-emerald-600 border-emerald-200" :
                      "bg-muted text-muted-foreground"
                    }>
                      {agency.status}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <span className="text-sm font-medium">{clientCountMap[agency.id] ?? 0}</span>
                  </TableCell>
                  <TableCell onClick={e => e.stopPropagation()}>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" className="h-8 w-8 p-0" data-testid={`menu-agency-${agency.id}`}>
                          <MoreHorizontal className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem className="gap-2 cursor-pointer" onClick={() => setViewAgency(agency)}>
                          <ChevronRight className="size-4" />View Clients
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          className="gap-2 cursor-pointer"
                          onClick={() => openEdit(agency)}
                          data-testid={`button-edit-agency-${agency.id}`}
                        >
                          <Pencil className="size-4" />Edit
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          className="gap-2 text-destructive cursor-pointer"
                          onClick={() => setDeleteTarget(agency)}
                          data-testid={`button-delete-agency-${agency.id}`}
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

      {/* Create Agency Dialog */}
      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>Create Agency</DialogTitle></DialogHeader>
          <form onSubmit={handleSubmit(d => create.mutate(d))} className="space-y-4">
            <div className="space-y-1.5">
              <Label>Agency Name *</Label>
              <Input placeholder="Acme Agency" {...register("name", { required: true })} data-testid="input-create-agency-name" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Contact Name</Label>
                <Input placeholder="Jane Smith" {...register("contactName")} />
              </div>
              <div className="space-y-1.5">
                <Label>Email</Label>
                <Input type="email" placeholder="jane@agency.com" {...register("email")} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Phone</Label>
                <Input placeholder="+1 555 000 0000" {...register("phone")} />
              </div>
              <div className="space-y-1.5">
                <Label>Monthly Fee</Label>
                <Input type="number" placeholder="2500" {...register("monthlyFee")} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Start Date</Label>
                <Input type="date" {...register("startDate")} />
              </div>
              <div className="space-y-1.5">
                <Label>Status</Label>
                <Select onValueChange={v => setValue("status", v)} defaultValue="active">
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="active">Active</SelectItem>
                    <SelectItem value="inactive">Inactive</SelectItem>
                    <SelectItem value="churned">Churned</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => { setShowCreate(false); reset(); }}>Cancel</Button>
              <Button type="submit" disabled={create.isPending} data-testid="button-create-agency-submit">
                {create.isPending ? "Creating…" : "Create Agency"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Edit Agency Dialog */}
      <Dialog open={!!editAgency} onOpenChange={open => { if (!open) { setEditAgency(null); resetEdit(); } }}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>Edit Agency</DialogTitle></DialogHeader>
          <form onSubmit={handleEdit(d => update.mutate({ id: editAgency.id, data: d }))} className="space-y-4">
            <div className="space-y-1.5">
              <Label>Agency Name *</Label>
              <Input placeholder="Acme Agency" {...regEdit("name", { required: true })} data-testid="input-edit-agency-name" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Contact Name</Label>
                <Input placeholder="Jane Smith" {...regEdit("contactName")} />
              </div>
              <div className="space-y-1.5">
                <Label>Email</Label>
                <Input type="email" placeholder="jane@agency.com" {...regEdit("email")} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Phone</Label>
                <Input placeholder="+1 555 000 0000" {...regEdit("phone")} />
              </div>
              <div className="space-y-1.5">
                <Label>Monthly Fee</Label>
                <Input type="number" placeholder="2500" {...regEdit("monthlyFee")} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Start Date</Label>
                <Input type="date" {...regEdit("startDate")} />
              </div>
              <div className="space-y-1.5">
                <Label>Status</Label>
                <Select
                  defaultValue={editAgency?.status ?? "active"}
                  onValueChange={v => setEditValue("status", v)}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="active">Active</SelectItem>
                    <SelectItem value="inactive">Inactive</SelectItem>
                    <SelectItem value="churned">Churned</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => { setEditAgency(null); resetEdit(); }}>Cancel</Button>
              <Button type="submit" disabled={update.isPending} data-testid="button-save-agency-submit">
                {update.isPending ? "Saving…" : "Save Changes"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog open={!!deleteTarget} onOpenChange={open => { if (!open) setDeleteTarget(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-destructive">
              <AlertTriangle className="size-5" />
              Delete Agency
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <p className="text-sm text-muted-foreground">
              You are about to delete <span className="font-semibold text-foreground">{deleteTarget?.name}</span>.
              Client accounts under this agency will not be deleted — they will simply become unassigned.
            </p>
            <p className="text-sm font-medium text-destructive">This cannot be undone.</p>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setDeleteTarget(null)} disabled={remove.isPending} data-testid="button-cancel-delete-agency">
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={() => deleteTarget && remove.mutate(deleteTarget.id)}
              disabled={remove.isPending}
              data-testid="button-confirm-delete-agency"
            >
              {remove.isPending ? "Deleting…" : "Delete Agency"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* View Agency Clients Panel */}
      <Sheet open={!!viewAgency} onOpenChange={open => { if (!open) { setViewAgency(null); setViewClient(null); } }}>
        <SheetContent className="w-[520px] sm:max-w-[520px] overflow-y-auto" aria-describedby={undefined}>
          <SheetHeader>
            {!viewClient ? (
              <SheetTitle className="flex items-center gap-2">
                <Building2 className="size-5 text-primary" />
                {viewAgency?.name}
                <Badge variant="outline" className="ml-1 font-normal">
                  {clientCountMap[viewAgency?.id] ?? 0} clients
                </Badge>
              </SheetTitle>
            ) : (
              <div className="space-y-1">
                <div className="flex items-center gap-1 text-xs text-muted-foreground">
                  <button
                    className="hover:text-foreground transition-colors"
                    onClick={() => setViewClient(null)}
                    data-testid="breadcrumb-agencies"
                  >
                    Agencies
                  </button>
                  <ChevronRight className="size-3" />
                  <button
                    className="hover:text-foreground transition-colors"
                    onClick={() => setViewClient(null)}
                    data-testid="breadcrumb-agency"
                  >
                    {viewAgency?.name}
                  </button>
                  <ChevronRight className="size-3" />
                  <span className="text-foreground font-medium">{viewClient.name}</span>
                </div>
                <SheetTitle className="flex items-center gap-2">
                  <button
                    className="p-1 rounded hover:bg-muted transition-colors"
                    onClick={() => setViewClient(null)}
                    data-testid="button-back-to-clients"
                  >
                    <ChevronLeft className="size-4" />
                  </button>
                  {viewClient.name}
                </SheetTitle>
              </div>
            )}
          </SheetHeader>

          {!viewClient ? (
            /* ── Client list ── */
            <div className="mt-6 space-y-2">
              {loadingViewAccounts ? (
                Array.from({ length: 3 }).map((_, i) => (
                  <div key={i} className="p-3 rounded-lg border bg-card">
                    <Skeleton className="h-4 w-40 mb-2" />
                    <Skeleton className="h-3 w-24" />
                  </div>
                ))
              ) : (viewAccounts as any[]).length === 0 ? (
                <div className="text-center py-12 text-muted-foreground text-sm">
                  No client accounts assigned to this agency yet.
                </div>
              ) : (viewAccounts as any[]).map((acc: any) => (
                <div
                  key={acc.id}
                  className="p-3 rounded-lg border bg-card flex items-center justify-between cursor-pointer hover:bg-accent/40 transition-colors"
                  data-testid={`agency-client-${acc.id}`}
                  onClick={() => setViewClient(acc)}
                >
                  <div>
                    <div className="font-medium text-sm">{acc.name}</div>
                    <div className="text-xs text-muted-foreground font-mono mt-0.5">{acc.slug}</div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant="secondary" className="text-xs">{acc.plan}</Badge>
                    <Badge variant="outline" className={`text-xs ${acc.status === "active" ? "bg-emerald-500/10 text-emerald-600 border-emerald-200" : "bg-muted text-muted-foreground"}`}>
                      {acc.status}
                    </Badge>
                    <ChevronRight className="size-3 text-muted-foreground" />
                  </div>
                </div>
              ))}
            </div>
          ) : (
            /* ── Client detail view ── */
            <div className="mt-6 space-y-5">
              {loadingClientSummary ? (
                <div className="space-y-3">
                  {Array.from({ length: 4 }).map((_, i) => (
                    <Skeleton key={i} className="h-20 w-full rounded-lg" />
                  ))}
                </div>
              ) : clientSummary ? (
                <>
                  {/* Identity row */}
                  <div className="rounded-lg border bg-card p-3 space-y-1.5">
                    {clientSummary.website ? (
                      <div className="flex items-center gap-2 text-sm">
                        <Globe className="size-3.5 text-muted-foreground shrink-0" />
                        <span className="font-mono text-xs text-muted-foreground truncate">{clientSummary.website.domain}</span>
                      </div>
                    ) : (
                      <div className="text-xs text-muted-foreground italic">No website configured</div>
                    )}
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <span className="font-mono">{viewClient.id}</span>
                      <Badge variant="secondary" className="text-xs">{viewClient.plan}</Badge>
                      <Badge variant="outline" className={`text-xs ${viewClient.status === "active" ? "bg-emerald-500/10 text-emerald-600 border-emerald-200" : "bg-muted text-muted-foreground"}`}>
                        {viewClient.status}
                      </Badge>
                    </div>
                  </div>

                  {/* Stat cards grid */}
                  <div className="grid grid-cols-2 gap-3">
                    {/* Pages */}
                    <div className="rounded-lg border bg-card p-3">
                      <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground mb-2">
                        <FileText className="size-3.5" />Pages
                      </div>
                      <div className="text-2xl font-bold">{clientSummary.pages.total.toLocaleString()}</div>
                      <div className="mt-1.5 space-y-0.5 text-xs text-muted-foreground">
                        <div className="flex justify-between"><span>Tier 1</span><span className="font-medium text-foreground">{clientSummary.pages.tier1}</span></div>
                        <div className="flex justify-between"><span>Tier 2</span><span className="font-medium text-foreground">{clientSummary.pages.tier2}</span></div>
                        <div className="flex justify-between"><span>Tier 3</span><span className="font-medium text-foreground">{clientSummary.pages.tier3}</span></div>
                      </div>
                    </div>

                    {/* Bank health */}
                    <div className="rounded-lg border bg-card p-3">
                      <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground mb-2">
                        <Activity className="size-3.5" />Bank Health
                      </div>
                      <div className="text-2xl font-bold">{clientSummary.bankHealth.avgCompleteness}%</div>
                      <div className="mt-1.5 space-y-0.5 text-xs text-muted-foreground">
                        <div className="flex justify-between"><span>Services</span><span className="font-medium text-foreground">{clientSummary.bankHealth.totalServices}</span></div>
                        <div className="flex justify-between"><span className="text-emerald-600">Safe to Scale</span><span className="font-medium text-emerald-600">{clientSummary.bankHealth.safeToScale}</span></div>
                        <div className="flex justify-between"><span className="text-amber-600">Needs Work</span><span className="font-medium text-amber-600">{clientSummary.bankHealth.needsWork}</span></div>
                      </div>
                    </div>

                    {/* Hub pages */}
                    <div className="rounded-lg border bg-card p-3">
                      <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground mb-2">
                        <BarChart3 className="size-3.5" />Hub Pages
                      </div>
                      <div className="text-2xl font-bold">{clientSummary.hubPages.total}</div>
                      <div className="mt-1.5 space-y-0.5 text-xs text-muted-foreground">
                        <div className="flex justify-between"><span className="text-emerald-600">Published</span><span className="font-medium text-emerald-600">{clientSummary.hubPages.published}</span></div>
                        <div className="flex justify-between"><span>Drafts</span><span className="font-medium text-foreground">{clientSummary.hubPages.drafts}</span></div>
                      </div>
                    </div>

                    {/* Last job */}
                    <div className="rounded-lg border bg-card p-3">
                      <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground mb-2">
                        <Zap className="size-3.5" />Last Job
                      </div>
                      {clientSummary.lastJob ? (
                        <>
                          <div className="text-2xl font-bold">{clientSummary.lastJob.pagesGenerated ?? 0}</div>
                          <div className="mt-1.5 space-y-0.5 text-xs text-muted-foreground">
                            <div className="flex justify-between"><span>Status</span><span className={`font-medium ${clientSummary.lastJob.status === "completed" ? "text-emerald-600" : clientSummary.lastJob.status === "failed" ? "text-destructive" : "text-foreground"}`}>{clientSummary.lastJob.status}</span></div>
                            <div className="flex justify-between"><span>Date</span><span className="font-medium text-foreground">{new Date(clientSummary.lastJob.createdAt).toLocaleDateString()}</span></div>
                          </div>
                        </>
                      ) : (
                        <div className="text-xs text-muted-foreground mt-2 italic">No jobs run yet</div>
                      )}
                    </div>
                  </div>

                  {/* Quick actions */}
                  {clientSummary.website && (
                    <div className="space-y-2">
                      <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Quick Actions</div>
                      <div className="grid grid-cols-1 gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          className="w-full justify-start gap-2 text-sm"
                          data-testid={`action-bulk-generator-${viewClient.id}`}
                          onClick={() => { setViewAgency(null); setViewClient(null); navigate(`/bulk-generator?websiteId=${clientSummary.website.id}`); }}
                        >
                          <Zap className="size-4 text-primary" />Run Bulk Generator
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          className="w-full justify-start gap-2 text-sm"
                          data-testid={`action-published-${viewClient.id}`}
                          onClick={() => { setViewAgency(null); setViewClient(null); navigate(`/published?websiteId=${clientSummary.website.id}`); }}
                        >
                          <FileText className="size-4 text-primary" />View Published Pages
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          className="w-full justify-start gap-2 text-sm"
                          data-testid={`action-bank-health-${viewClient.id}`}
                          onClick={() => { setViewAgency(null); setViewClient(null); navigate(`/bank-health?websiteId=${clientSummary.website.id}`); }}
                        >
                          <Activity className="size-4 text-primary" />Check Bank Health
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          className="w-full justify-start gap-2 text-sm"
                          data-testid={`action-sitemap-${viewClient.id}`}
                          onClick={() => { setViewAgency(null); setViewClient(null); navigate(`/sitemaps?websiteId=${clientSummary.website.id}`); }}
                        >
                          <Globe className="size-4 text-primary" />View Sitemap
                        </Button>
                        <Button
                          size="sm"
                          className="w-full justify-start gap-2 text-sm"
                          data-testid={`action-score-promote-${viewClient.id}`}
                          disabled={scorePromoting}
                          onClick={async () => {
                            setScorePromoting(true);
                            try {
                              await api.post(`/api/websites/${clientSummary.website.id}/score-and-promote`, {});
                              toast({ title: "Score & Promote started", description: "Running in background for " + viewClient.name });
                            } catch (e: any) {
                              toast({ title: "Error", description: e.message, variant: "destructive" });
                            } finally {
                              setScorePromoting(false);
                            }
                          }}
                        >
                          <BarChart3 className="size-4" />{scorePromoting ? "Running…" : "Score & Promote All"}
                        </Button>
                      </div>
                    </div>
                  )}
                </>
              ) : (
                <div className="text-center py-12 text-muted-foreground text-sm">Failed to load client data.</div>
              )}
            </div>
          )}
        </SheetContent>
      </Sheet>
    </DashboardLayout>
  );
}
