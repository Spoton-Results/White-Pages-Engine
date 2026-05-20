import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import DashboardLayout from "@/components/layout/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Search, MoreHorizontal, Trash, Eye, RefreshCw, Pencil, AlertTriangle, Handshake, ChevronRight } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { api } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { Link, useLocation } from "wouter";

export default function AccountsPage() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const [search, setSearch] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [editAccount, setEditAccount] = useState<any>(null);
  const [deleteTarget, setDeleteTarget] = useState<any>(null);
  const { register, handleSubmit, reset, setValue } = useForm<any>();
  const { register: regEdit, handleSubmit: handleEdit, reset: resetEdit, setValue: setEditValue } = useForm<any>();

  const { data: accounts = [], isLoading, isFetching: accountsFetching } = useQuery({
    queryKey: ["/api/accounts"],
    queryFn: () => api.get<any[]>("/api/accounts"),
  });

  const { data: agencies = [] } = useQuery({
    queryKey: ["/api/agencies"],
    queryFn: () => api.get<any[]>("/api/agencies"),
  });

  const create = useMutation({
    mutationFn: (data: any) => api.post("/api/accounts", data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/accounts"] });
      qc.invalidateQueries({ queryKey: ["/api/dashboard/stats"] });
      setShowCreate(false);
      reset();
      toast({ title: "Account created" });
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const update = useMutation({
    mutationFn: ({ id, data }: { id: string; data: any }) => api.put(`/api/accounts/${id}`, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/accounts"] });
      setEditAccount(null);
      resetEdit();
      toast({ title: "Account updated" });
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const [deleteImpact, setDeleteImpact] = useState<any>(null);
  const [loadingImpact, setLoadingImpact] = useState(false);

  const openDeleteDialog = async (account: any) => {
    setDeleteTarget(account);
    setDeleteImpact(null);
    setLoadingImpact(true);
    try {
      const impact = await api.delete<any>(`/api/accounts/${account.id}`);
      setDeleteImpact(impact.willDelete);
    } catch (_) {}
    setLoadingImpact(false);
  };

  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/api/accounts/${id}?confirm=true`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/accounts"] });
      qc.invalidateQueries({ queryKey: ["/api/dashboard/stats"] });
      setDeleteTarget(null);
      setDeleteImpact(null);
      toast({ title: "Account deleted" });
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const openEdit = (account: any) => {
    const s = account.settings ?? {};
    setEditAccount(account);
    resetEdit();
    setEditValue("name", account.name);
    setEditValue("slug", account.slug);
    setEditValue("plan", account.plan);
    setEditValue("status", account.status);
    setEditValue("agencyId", account.agencyId ?? "");
    setEditValue("ownerName", s.ownerName ?? "");
    setEditValue("email", s.email ?? "");
    setEditValue("phone", s.phone ?? "");
    setEditValue("anthropicApiKey", s.anthropicApiKey ?? "");
    setEditValue("notes", s.notes ?? "");
  };

  const onEditSubmit = (d: any) => {
    const { name, slug, plan, status, agencyId, ownerName, email, phone, anthropicApiKey, notes } = d;
    update.mutate({
      id: editAccount.id,
      data: {
        name,
        slug,
        plan,
        status,
        agencyId: agencyId === "" ? null : (agencyId || null),
        settings: { ownerName, email, phone, anthropicApiKey, notes },
      },
    });
  };

  const filtered = accounts.filter((a: any) =>
    a.name.toLowerCase().includes(search.toLowerCase()) ||
    a.slug.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <DashboardLayout>
      <div className="flex flex-col gap-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Accounts</h1>
            <p className="text-muted-foreground text-sm mt-0.5">Manage client accounts and platform access.</p>
          </div>
          <Button className="gap-2" size="sm" onClick={() => setShowCreate(true)} data-testid="button-new-account">
            <Plus className="size-4" />New Account
          </Button>
        </div>

        <div className="flex items-center gap-3 bg-card p-3 rounded-lg border">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input placeholder="Search accounts..." className="pl-9 h-9" value={search} onChange={e => setSearch(e.target.value)} />
          </div>
          <Button variant="outline" size="sm" onClick={() => qc.refetchQueries({ queryKey: ["/api/accounts"] })} disabled={accountsFetching}>
            <RefreshCw className={`size-4 ${accountsFetching ? "animate-spin" : ""}`} />
          </Button>
        </div>

        <div className="bg-card rounded-lg border overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Account Name</TableHead>
                <TableHead>Slug</TableHead>
                <TableHead>Plan</TableHead>
                <TableHead>Status</TableHead>
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
                    {search ? "No accounts match your search." : "No accounts yet. Create one to get started."}
                  </TableCell>
                </TableRow>
              ) : filtered.map((account: any) => (
                <TableRow
                  key={account.id}
                  data-testid={`row-account-${account.id}`}
                  className="cursor-pointer hover:bg-muted/50"
                  onClick={() => navigate(`/accounts/${account.id}`)}
                >
                  <TableCell className="font-medium">
                    <span className="flex items-center gap-1.5">
                      {account.name}
                      <ChevronRight className="size-3.5 text-muted-foreground opacity-50" />
                    </span>
                  </TableCell>
                  <TableCell className="text-muted-foreground font-mono text-xs">{account.slug}</TableCell>
                  <TableCell>
                    <Badge variant="secondary" className={account.plan === "enterprise" ? "bg-primary/10 text-primary" : ""}>
                      {account.plan}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className={
                      account.status === "active" ? "bg-emerald-500/10 text-emerald-600 border-emerald-200" :
                      "bg-muted text-muted-foreground"
                    }>
                      {account.status}
                    </Badge>
                  </TableCell>
                  <TableCell onClick={e => e.stopPropagation()}>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" className="h-8 w-8 p-0" data-testid={`menu-account-${account.id}`}>
                          <MoreHorizontal className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem className="gap-2 cursor-pointer" onClick={() => navigate(`/accounts/${account.id}`)}>
                          <Eye className="size-4" />View Details
                        </DropdownMenuItem>
                        <Link href={`/websites?accountId=${account.id}`}>
                          <DropdownMenuItem className="gap-2 cursor-pointer"><Eye className="size-4" />View Websites</DropdownMenuItem>
                        </Link>
                        <DropdownMenuItem
                          className="gap-2 cursor-pointer"
                          onClick={() => openEdit(account)}
                          data-testid={`button-edit-account-${account.id}`}
                        >
                          <Pencil className="size-4" />Edit
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          className="gap-2 text-destructive cursor-pointer"
                          onClick={() => openDeleteDialog(account)}
                          data-testid={`button-delete-account-${account.id}`}
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

      {/* Create Account Dialog */}
      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent>
          <DialogHeader><DialogTitle>Create Account</DialogTitle></DialogHeader>
          <form onSubmit={handleSubmit(d => create.mutate(d))} className="space-y-4">
            <div className="space-y-1.5">
              <Label>Account Name</Label>
              <Input placeholder="Acme Corp" {...register("name", { required: true })} />
            </div>
            <div className="space-y-1.5">
              <Label>Slug</Label>
              <Input placeholder="acme-corp" {...register("slug", { required: true })} />
            </div>
            <div className="space-y-1.5">
              <Label className="flex items-center gap-1.5"><Handshake className="size-3.5 text-muted-foreground" />Agency</Label>
              <Select onValueChange={v => setValue("agencyId", v === "none" ? null : v)} defaultValue="none">
                <SelectTrigger data-testid="select-create-agency"><SelectValue placeholder="Unassigned" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Unassigned</SelectItem>
                  {(agencies as any[]).map((a: any) => (
                    <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Plan</Label>
              <Select onValueChange={v => setValue("plan", v)} defaultValue="starter">
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="starter">Starter</SelectItem>
                  <SelectItem value="pro">Pro</SelectItem>
                  <SelectItem value="enterprise">Enterprise</SelectItem>
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

      {/* Delete Confirmation Dialog */}
      <Dialog open={!!deleteTarget} onOpenChange={open => { if (!open) setDeleteTarget(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-destructive">
              <AlertTriangle className="size-5" />
              Delete Account
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <p className="text-sm text-muted-foreground">
              You are about to permanently delete <span className="font-semibold text-foreground">{deleteTarget?.name}</span> and everything attached to it.
            </p>
            {loadingImpact ? (
              <p className="text-sm text-muted-foreground italic">Calculating impact…</p>
            ) : deleteImpact ? (
              <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 space-y-1">
                <p className="text-xs font-semibold text-destructive uppercase tracking-wide mb-2">What will be deleted</p>
                {[
                  ["Websites", deleteImpact.websites],
                  ["Published Pages", deleteImpact.pages],
                  ["Hub Pages", deleteImpact.hubPages],
                  ["Blueprints", deleteImpact.blueprints],
                  ["Services", deleteImpact.services],
                  ["Locations", deleteImpact.locations],
                ].map(([label, count]) => (
                  <div key={label as string} className="flex justify-between text-sm">
                    <span className="text-muted-foreground">{label}</span>
                    <span className={Number(count) > 0 ? "font-semibold text-destructive" : "text-muted-foreground"}>{count}</span>
                  </div>
                ))}
              </div>
            ) : null}
            <p className="text-sm font-medium text-destructive">This cannot be undone.</p>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setDeleteTarget(null)}
              disabled={remove.isPending}
              data-testid="button-cancel-delete"
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={() => deleteTarget && remove.mutate(deleteTarget.id)}
              disabled={remove.isPending}
              data-testid="button-confirm-delete"
            >
              {remove.isPending ? "Deleting…" : "Delete Account"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Account Dialog */}
      <Dialog open={!!editAccount} onOpenChange={open => { if (!open) { setEditAccount(null); resetEdit(); } }}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>Edit Account</DialogTitle></DialogHeader>
          <form onSubmit={handleEdit(onEditSubmit)} className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Account Name</Label>
                <Input placeholder="Acme Corp" {...regEdit("name", { required: true })} data-testid="input-edit-name" />
              </div>
              <div className="space-y-1.5">
                <Label>Slug</Label>
                <Input placeholder="acme-corp" {...regEdit("slug", { required: true })} data-testid="input-edit-slug" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Owner Name</Label>
                <Input placeholder="Jane Smith" {...regEdit("ownerName")} data-testid="input-edit-owner-name" />
              </div>
              <div className="space-y-1.5">
                <Label>Email</Label>
                <Input type="email" placeholder="jane@acme.com" {...regEdit("email")} data-testid="input-edit-email" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Phone</Label>
                <Input placeholder="+1 555 000 0000" {...regEdit("phone")} data-testid="input-edit-phone" />
              </div>
              <div className="space-y-1.5">
                <Label>Anthropic API Key</Label>
                <Input type="password" placeholder="sk-ant-…" {...regEdit("anthropicApiKey")} data-testid="input-edit-api-key" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Plan</Label>
                <Select
                  defaultValue={editAccount?.plan ?? "starter"}
                  onValueChange={v => setEditValue("plan", v)}
                >
                  <SelectTrigger data-testid="select-edit-plan"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="starter">Starter</SelectItem>
                    <SelectItem value="pro">Pro</SelectItem>
                    <SelectItem value="enterprise">Enterprise</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Status</Label>
                <Select
                  defaultValue={editAccount?.status ?? "active"}
                  onValueChange={v => setEditValue("status", v)}
                >
                  <SelectTrigger data-testid="select-edit-status"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="active">Active</SelectItem>
                    <SelectItem value="inactive">Inactive</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="flex items-center gap-1.5"><Handshake className="size-3.5 text-muted-foreground" />Agency</Label>
              <Select
                defaultValue={editAccount?.agencyId ?? "none"}
                onValueChange={v => setEditValue("agencyId", v === "none" ? "" : v)}
              >
                <SelectTrigger data-testid="select-edit-agency"><SelectValue placeholder="Unassigned" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Unassigned</SelectItem>
                  {(agencies as any[]).map((a: any) => (
                    <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Notes</Label>
              <Textarea
                placeholder="Internal notes about this account…"
                rows={3}
                {...regEdit("notes")}
                data-testid="input-edit-notes"
              />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => { setEditAccount(null); resetEdit(); }}>Cancel</Button>
              <Button type="submit" disabled={update.isPending} data-testid="button-save-account">
                {update.isPending ? "Saving…" : "Save Changes"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
}
