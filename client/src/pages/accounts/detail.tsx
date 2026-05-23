import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useParams, Link } from "wouter";
import DashboardLayout from "@/components/layout/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  ChevronLeft, Plus, Layers, MapPin, Wrench, BookOpen, Network,
  Trash, Pencil, MoreHorizontal, Globe,
} from "lucide-react";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { api } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";
import { useState } from "react";
import { useForm } from "react-hook-form";

type Tab = "overview" | "services" | "blueprints" | "clusters" | "locations";

export default function AccountDetailPage() {
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const { toast } = useToast();
  const [tab, setTab] = useState<Tab>("overview");

  // ── Account ──────────────────────────────────────────────────────────────
  const { data: account, isLoading: loadingAccount } = useQuery({
    queryKey: ["/api/accounts", id],
    queryFn: () => api.get<any>(`/api/accounts/${id}`),
    enabled: !!id,
  });

  // ── Websites (resolve accountId → websiteId for child queries) ───────────
  const { data: websites = [] } = useQuery({
    queryKey: ["/api/websites", { accountId: id }],
    queryFn: () => api.get<any[]>(`/api/websites?accountId=${id}`),
    enabled: !!id,
  });

  // The primary website for this account — all child resources are scoped to it
  const websiteId: string | undefined = (websites as any[])[0]?.id;

  // ── Services ─────────────────────────────────────────────────────────────
  // ✅ CHANGED: was /api/services?accountId=... (route doesn't exist)
  //            now /api/websites/:websiteId/services (correct server route)
  const { data: services = [], isLoading: loadingServices } = useQuery({
    queryKey: ["/api/websites", websiteId, "services"],
    queryFn: () => api.get<any[]>(`/api/websites/${websiteId}/services`),
    enabled: !!websiteId && tab === "services",
  });

  // ── Blueprints ────────────────────────────────────────────────────────────
  // ✅ CHANGED: was /api/blueprints?accountId=... 
  //            now /api/websites/:websiteId/blueprints (correct server route)
  const { data: blueprints = [], isLoading: loadingBlueprints } = useQuery({
    queryKey: ["/api/websites", websiteId, "blueprints"],
    queryFn: () => api.get<any[]>(`/api/websites/${websiteId}/blueprints`),
    enabled: !!websiteId && tab === "blueprints",
  });

  // ── Query Clusters ────────────────────────────────────────────────────────
  // ✅ CHANGED: was /api/query-clusters?accountId=... (route doesn't exist)
  //            now /api/websites/:websiteId/query-clusters (correct server route)
  const { data: clusters = [], isLoading: loadingClusters } = useQuery({
    queryKey: ["/api/websites", websiteId, "query-clusters"],
    queryFn: () => api.get<any[]>(`/api/websites/${websiteId}/query-clusters`),
    enabled: !!websiteId && tab === "clusters",
  });

  // ── Locations ─────────────────────────────────────────────────────────────
  // ✅ CHANGED: was /api/locations?accountId=... (route doesn't exist)
  //            now /api/websites/:websiteId/locations (correct server route)
  const { data: locations = [], isLoading: loadingLocations } = useQuery({
    queryKey: ["/api/websites", websiteId, "locations"],
    queryFn: () => api.get<any[]>(`/api/websites/${websiteId}/locations`),
    enabled: !!websiteId && tab === "locations",
  });

  // ── Service CRUD ─────────────────────────────────────────────────────────
  const [showServiceCreate, setShowServiceCreate] = useState(false);
  const [editService, setEditService] = useState<any>(null);
  const { register: regSvc, handleSubmit: handleSvc, reset: resetSvc } = useForm<any>();
  const { register: regSvcEdit, handleSubmit: handleSvcEdit, reset: resetSvcEdit, setValue: setSvcEditVal } = useForm<any>();

  const createService = useMutation({
    // ✅ CHANGED: POST to nested website route, not flat /api/services
    mutationFn: (data: any) => api.post(`/api/websites/${websiteId}/services`, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/websites", websiteId, "services"] });
      setShowServiceCreate(false); resetSvc();
      toast({ title: "Service created" });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const updateService = useMutation({
    mutationFn: ({ sid, data }: { sid: string; data: any }) => api.put(`/api/services/${sid}`, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/websites", websiteId, "services"] });
      setEditService(null); resetSvcEdit();
      toast({ title: "Service updated" });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const deleteService = useMutation({
    mutationFn: (sid: string) => api.delete(`/api/services/${sid}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/websites", websiteId, "services"] });
      toast({ title: "Service deleted" });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  // ── Location CRUD ─────────────────────────────────────────────────────────
  const [showLocCreate, setShowLocCreate] = useState(false);
  const [editLoc, setEditLoc] = useState<any>(null);
  const { register: regLoc, handleSubmit: handleLoc, reset: resetLoc } = useForm<any>();
  const { register: regLocEdit, handleSubmit: handleLocEdit, reset: resetLocEdit, setValue: setLocEditVal } = useForm<any>();

  const createLocation = useMutation({
    // ✅ CHANGED: POST to nested website route, not flat /api/locations
    mutationFn: (data: any) => api.post(`/api/websites/${websiteId}/locations`, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/websites", websiteId, "locations"] });
      setShowLocCreate(false); resetLoc();
      toast({ title: "Location created" });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const updateLocation = useMutation({
    mutationFn: ({ lid, data }: { lid: string; data: any }) => api.put(`/api/locations/${lid}`, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/websites", websiteId, "locations"] });
      setEditLoc(null); resetLocEdit();
      toast({ title: "Location updated" });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const deleteLocation = useMutation({
    mutationFn: (lid: string) => api.delete(`/api/locations/${lid}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/websites", websiteId, "locations"] });
      toast({ title: "Location deleted" });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const TABS: { key: Tab; label: string; icon: any }[] = [
    { key: "overview",   label: "Overview",       icon: Layers },
    { key: "services",   label: "Services",        icon: Wrench },
    { key: "blueprints", label: "Blueprints",      icon: BookOpen },
    { key: "clusters",   label: "Query Clusters",  icon: Network },
    { key: "locations",  label: "Locations",       icon: MapPin },
  ];

  if (loadingAccount) {
    return (
      <DashboardLayout>
        <div className="space-y-4 p-6">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-4 w-64" />
          <Skeleton className="h-32 w-full" />
        </div>
      </DashboardLayout>
    );
  }

  if (!account) {
    return (
      <DashboardLayout>
        <div className="flex flex-col items-center justify-center py-24 text-muted-foreground gap-3">
          <p className="text-lg font-medium">Account not found</p>
          <Link href="/accounts">
            <Button variant="outline" size="sm"><ChevronLeft className="size-4 mr-1" />Back to Accounts</Button>
          </Link>
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <div className="flex flex-col gap-6">
        {/* Header */}
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <Link href="/accounts">
              <Button variant="ghost" size="sm" className="gap-1 text-muted-foreground hover:text-foreground">
                <ChevronLeft className="size-4" />Accounts
              </Button>
            </Link>
            <div className="h-5 w-px bg-border" />
            <div>
              <h1 className="text-2xl font-bold tracking-tight">{account.name}</h1>
              <p className="text-xs text-muted-foreground font-mono mt-0.5">{account.slug}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="secondary" className={account.plan === "enterprise" ? "bg-primary/10 text-primary" : ""}>
              {account.plan}
            </Badge>
            <Badge variant="outline" className={
              account.status === "active"
                ? "bg-emerald-500/10 text-emerald-600 border-emerald-200"
                : "bg-muted text-muted-foreground"
            }>
              {account.status}
            </Badge>
          </div>
        </div>

        {/* Tab nav */}
        <div className="flex items-center gap-1 border-b pb-0">
          {TABS.map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={`flex items-center gap-1.5 px-3 py-2.5 text-sm font-medium border-b-2 transition-colors ${
                tab === key
                  ? "border-primary text-primary"
                  : "border-transparent text-muted-foreground hover:text-foreground hover:border-border"
              }`}
            >
              <Icon className="size-3.5" />{label}
            </button>
          ))}
        </div>

        {/* ── Overview ── */}
        {tab === "overview" && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {[
              { label: "Websites",        value: websites.length,   href: `/websites?accountId=${id}`,      icon: Globe },
              { label: "Services",        value: "→",               href: null,   icon: Wrench,   action: () => setTab("services") },
              { label: "Blueprints",      value: "→",               href: null,   icon: BookOpen, action: () => setTab("blueprints") },
              { label: "Locations",       value: "→",               href: null,   icon: MapPin,   action: () => setTab("locations") },
            ].map(({ label, value, href, icon: Icon, action }) => (
              <div
                key={label}
                onClick={() => { if (action) action(); }}
                className="bg-card border rounded-lg p-4 flex flex-col gap-2 cursor-pointer hover:border-primary/40 hover:bg-primary/5 transition-colors"
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground font-medium uppercase tracking-wide">{label}</span>
                  <Icon className="size-4 text-muted-foreground" />
                </div>
                {href ? (
                  <Link href={href}>
                    <span className="text-2xl font-bold text-foreground hover:text-primary transition-colors">{value}</span>
                  </Link>
                ) : (
                  <span className="text-2xl font-bold text-foreground">{value}</span>
                )}
              </div>
            ))}

            {/* Account settings card */}
            {account.settings && (
              <div className="col-span-2 md:col-span-4 bg-card border rounded-lg p-5 space-y-3">
                <h3 className="text-sm font-semibold text-foreground">Account Details</h3>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                  {[
                    ["Owner", account.settings.ownerName],
                    ["Email", account.settings.email],
                    ["Phone", account.settings.phone],
                  ].map(([label, value]) => value ? (
                    <div key={label as string}>
                      <p className="text-xs text-muted-foreground">{label}</p>
                      <p className="text-sm font-medium text-foreground">{value}</p>
                    </div>
                  ) : null)}
                </div>
                {account.settings.notes && (
                  <div>
                    <p className="text-xs text-muted-foreground mb-1">Notes</p>
                    <p className="text-sm text-foreground whitespace-pre-line">{account.settings.notes}</p>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* ── Services ── */}
        {tab === "services" && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <p className="text-sm text-muted-foreground">{services.length} service{services.length !== 1 ? "s" : ""}</p>
              <Button size="sm" className="gap-1.5" onClick={() => setShowServiceCreate(true)}>
                <Plus className="size-4" />New Service
              </Button>
            </div>
            <div className="bg-card border rounded-lg overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Service Name</TableHead>
                    <TableHead>Slug</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="w-[60px]"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loadingServices ? (
                    Array.from({ length: 3 }).map((_, i) => (
                      <TableRow key={i}>{Array.from({ length: 4 }).map((_, j) => (
                        <TableCell key={j}><Skeleton className="h-4 w-full" /></TableCell>
                      ))}</TableRow>
                    ))
                  ) : services.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={4} className="text-center py-10 text-muted-foreground">
                        No services yet for this account.
                      </TableCell>
                    </TableRow>
                  ) : (services as any[]).map((svc: any) => (
                    <TableRow key={svc.id}>
                      <TableCell className="font-medium">{svc.name}</TableCell>
                      <TableCell className="text-muted-foreground font-mono text-xs">{svc.slug}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className={svc.status === "active" ? "bg-emerald-500/10 text-emerald-600 border-emerald-200" : ""}>
                          {svc.status ?? "active"}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-8 w-8">
                              <MoreHorizontal className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem className="gap-2 cursor-pointer" onClick={() => {
                              setEditService(svc);
                              setSvcEditVal("name", svc.name);
                              setSvcEditVal("slug", svc.slug);
                            }}>
                              <Pencil className="size-4" />Edit
                            </DropdownMenuItem>
                            <DropdownMenuItem className="gap-2 text-destructive cursor-pointer"
                              onClick={() => deleteService.mutate(svc.id)}>
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
        )}

        {/* ── Blueprints ── */}
        {tab === "blueprints" && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <p className="text-sm text-muted-foreground">{blueprints.length} blueprint{blueprints.length !== 1 ? "s" : ""}</p>
              <Link href={`/blueprints?accountId=${id}`}>
                <Button size="sm" variant="outline" className="gap-1.5">
                  <BookOpen className="size-4" />Manage in Blueprints
                </Button>
              </Link>
            </div>
            <div className="bg-card border rounded-lg overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Blueprint Name</TableHead>
                    <TableHead>Industry</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loadingBlueprints ? (
                    Array.from({ length: 3 }).map((_, i) => (
                      <TableRow key={i}>{Array.from({ length: 3 }).map((_, j) => (
                        <TableCell key={j}><Skeleton className="h-4 w-full" /></TableCell>
                      ))}</TableRow>
                    ))
                  ) : blueprints.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={3} className="text-center py-10 text-muted-foreground">
                        No blueprints yet for this account.
                      </TableCell>
                    </TableRow>
                  ) : (blueprints as any[]).map((bp: any) => (
                    <TableRow key={bp.id}>
                      <TableCell className="font-medium">{bp.name}</TableCell>
                      <TableCell className="text-muted-foreground text-sm">{bp.industryName ?? bp.industry ?? "—"}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className={bp.status === "active" ? "bg-emerald-500/10 text-emerald-600 border-emerald-200" : ""}>
                          {bp.status ?? "active"}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>
        )}

        {/* ── Query Clusters ── */}
        {tab === "clusters" && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <p className="text-sm text-muted-foreground">{clusters.length} cluster{clusters.length !== 1 ? "s" : ""}</p>
              <Link href={`/query-clusters?accountId=${id}`}>
                <Button size="sm" variant="outline" className="gap-1.5">
                  <Network className="size-4" />Manage in Clusters
                </Button>
              </Link>
            </div>
            <div className="bg-card border rounded-lg overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Cluster Name</TableHead>
                    <TableHead>Service</TableHead>
                    <TableHead>Keywords</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loadingClusters ? (
                    Array.from({ length: 3 }).map((_, i) => (
                      <TableRow key={i}>{Array.from({ length: 3 }).map((_, j) => (
                        <TableCell key={j}><Skeleton className="h-4 w-full" /></TableCell>
                      ))}</TableRow>
                    ))
                  ) : clusters.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={3} className="text-center py-10 text-muted-foreground">
                        No query clusters yet for this account.
                      </TableCell>
                    </TableRow>
                  ) : (clusters as any[]).map((cl: any) => (
                    <TableRow key={cl.id}>
                      <TableCell className="font-medium">{cl.name}</TableCell>
                      <TableCell className="text-muted-foreground text-sm">{cl.serviceName ?? "—"}</TableCell>
                      <TableCell className="text-muted-foreground text-sm">{Array.isArray(cl.keywords) ? cl.keywords.length : "—"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>
        )}

        {/* ── Locations ── */}
        {tab === "locations" && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <p className="text-sm text-muted-foreground">{locations.length} location{locations.length !== 1 ? "s" : ""}</p>
              <Button size="sm" className="gap-1.5" onClick={() => setShowLocCreate(true)}>
                <Plus className="size-4" />New Location
              </Button>
            </div>
            <div className="bg-card border rounded-lg overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>City</TableHead>
                    <TableHead>State</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead className="w-[60px]"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loadingLocations ? (
                    Array.from({ length: 3 }).map((_, i) => (
                      <TableRow key={i}>{Array.from({ length: 4 }).map((_, j) => (
                        <TableCell key={j}><Skeleton className="h-4 w-full" /></TableCell>
                      ))}</TableRow>
                    ))
                  ) : locations.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={4} className="text-center py-10 text-muted-foreground">
                        No locations yet for this account.
                      </TableCell>
                    </TableRow>
                  ) : (locations as any[]).map((loc: any) => (
                    <TableRow key={loc.id}>
                      <TableCell className="font-medium">{loc.city}</TableCell>
                      <TableCell className="text-muted-foreground">{loc.state}</TableCell>
                      <TableCell>
                        <Badge variant="secondary">{loc.locationType ?? "city"}</Badge>
                      </TableCell>
                      <TableCell>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-8 w-8">
                              <MoreHorizontal className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem className="gap-2 cursor-pointer" onClick={() => {
                              setEditLoc(loc);
                              setLocEditVal("city", loc.city);
                              setLocEditVal("state", loc.state);
                              setLocEditVal("locationType", loc.locationType ?? "city");
                            }}>
                              <Pencil className="size-4" />Edit
                            </DropdownMenuItem>
                            <DropdownMenuItem className="gap-2 text-destructive cursor-pointer"
                              onClick={() => deleteLocation.mutate(loc.id)}>
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
        )}
      </div>

      {/* ── Create Service Dialog ── */}
      <Dialog open={showServiceCreate} onOpenChange={setShowServiceCreate}>
        <DialogContent>
          <DialogHeader><DialogTitle>Add Service</DialogTitle></DialogHeader>
          <form onSubmit={handleSvc(d => createService.mutate(d))} className="space-y-4">
            <div className="space-y-1.5">
              <Label>Service Name</Label>
              <Input placeholder="e.g. Merchant Services" {...regSvc("name", { required: true })} />
            </div>
            <div className="space-y-1.5">
              <Label>Slug</Label>
              <Input placeholder="e.g. merchant-services" {...regSvc("slug", { required: true })} />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setShowServiceCreate(false)}>Cancel</Button>
              <Button type="submit" disabled={createService.isPending}>Create</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* ── Edit Service Dialog ── */}
      <Dialog open={!!editService} onOpenChange={o => { if (!o) { setEditService(null); resetSvcEdit(); } }}>
        <DialogContent>
          <DialogHeader><DialogTitle>Edit Service</DialogTitle></DialogHeader>
          <form onSubmit={handleSvcEdit(d => updateService.mutate({ sid: editService?.id, data: d }))} className="space-y-4">
            <div className="space-y-1.5">
              <Label>Service Name</Label>
              <Input {...regSvcEdit("name", { required: true })} />
            </div>
            <div className="space-y-1.5">
              <Label>Slug</Label>
              <Input {...regSvcEdit("slug", { required: true })} />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => { setEditService(null); resetSvcEdit(); }}>Cancel</Button>
              <Button type="submit" disabled={updateService.isPending}>Save</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* ── Create Location Dialog ── */}
      <Dialog open={showLocCreate} onOpenChange={setShowLocCreate}>
        <DialogContent>
          <DialogHeader><DialogTitle>Add Location</DialogTitle></DialogHeader>
          <form onSubmit={handleLoc(d => createLocation.mutate(d))} className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>City</Label>
                <Input placeholder="Dallas" {...regLoc("city", { required: true })} />
              </div>
              <div className="space-y-1.5">
                <Label>State</Label>
                <Input placeholder="TX" {...regLoc("state", { required: true })} maxLength={2} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Type</Label>
              <Select onValueChange={v => regLoc("locationType").onChange({ target: { value: v } })} defaultValue="city">
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="city">City</SelectItem>
                  <SelectItem value="state">State</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setShowLocCreate(false)}>Cancel</Button>
              <Button type="submit" disabled={createLocation.isPending}>Create</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* ── Edit Location Dialog ── */}
      <Dialog open={!!editLoc} onOpenChange={o => { if (!o) { setEditLoc(null); resetLocEdit(); } }}>
        <DialogContent>
          <DialogHeader><DialogTitle>Edit Location</DialogTitle></DialogHeader>
          <form onSubmit={handleLocEdit(d => updateLocation.mutate({ lid: editLoc?.id, data: d }))} className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>City</Label>
                <Input {...regLocEdit("city", { required: true })} />
              </div>
              <div className="space-y-1.5">
                <Label>State</Label>
                <Input {...regLocEdit("state", { required: true })} maxLength={2} />
              </div>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => { setEditLoc(null); resetLocEdit(); }}>Cancel</Button>
              <Button type="submit" disabled={updateLocation.isPending}>Save</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
}
