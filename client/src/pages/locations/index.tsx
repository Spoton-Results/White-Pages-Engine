import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import DashboardLayout from "@/components/layout/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Plus, MapPin, Trash2, Search } from "lucide-react";
import { api } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";
import { useForm } from "react-hook-form";

export default function LocationsPage() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [selectedAccount, setSelectedAccount] = useState<string>("");
  const [showCreate, setShowCreate] = useState(false);
  const [searchText, setSearchText] = useState("");
  const { register, handleSubmit, reset, setValue } = useForm<any>();

  const { data: accounts = [] } = useQuery({
    queryKey: ["/api/accounts"],
    queryFn: () => api.get<any[]>("/api/accounts"),
  });

  const { data: locations = [], isLoading } = useQuery({
    queryKey: ["/api/locations", selectedAccount],
    queryFn: () => selectedAccount ? api.get<any[]>(`/api/accounts/${selectedAccount}/locations`) : Promise.resolve([]),
    enabled: !!selectedAccount,
  });

  const create = useMutation({
    mutationFn: (data: any) => api.post(`/api/accounts/${selectedAccount}/locations`, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/locations"] });
      setShowCreate(false);
      reset();
      toast({ title: "Location added" });
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/api/locations/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/locations"] });
      toast({ title: "Location removed" });
    },
  });

  const filtered = (locations as any[]).filter((l: any) =>
    !searchText || l.name.toLowerCase().includes(searchText.toLowerCase()) ||
    l.stateCode?.toLowerCase().includes(searchText.toLowerCase())
  );

  const typeColors: Record<string, string> = {
    state: "bg-violet-500/10 text-violet-600",
    city: "bg-blue-500/10 text-blue-600",
    county: "bg-emerald-500/10 text-emerald-600",
    neighborhood: "bg-amber-500/10 text-amber-600",
  };

  return (
    <DashboardLayout>
      <div className="flex flex-col gap-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Locations</h1>
            <p className="text-muted-foreground text-sm mt-0.5">Manage target states, cities, and neighborhoods.</p>
          </div>
          {selectedAccount && (
            <Button className="gap-2" size="sm" onClick={() => setShowCreate(true)}>
              <Plus className="size-4" />Add Location
            </Button>
          )}
        </div>

        <div className="flex items-center gap-3 bg-card p-3 rounded-lg border flex-wrap">
          <Select onValueChange={setSelectedAccount} value={selectedAccount}>
            <SelectTrigger className="w-52">
              <SelectValue placeholder="Select account" />
            </SelectTrigger>
            <SelectContent>
              {accounts.map((a: any) => (
                <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          {selectedAccount && (
            <div className="relative flex-1 max-w-xs">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input placeholder="Search..." className="pl-9 h-9" value={searchText} onChange={e => setSearchText(e.target.value)} />
            </div>
          )}
          {selectedAccount && <span className="text-sm text-muted-foreground">{(locations as any[]).length} locations</span>}
        </div>

        {!selectedAccount ? (
          <div className="flex flex-col items-center justify-center py-16 text-center gap-3">
            <MapPin className="size-12 text-muted-foreground/30" />
            <p className="text-muted-foreground">Select an account to manage locations</p>
          </div>
        ) : (
          <div className="bg-card rounded-lg border overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>State</TableHead>
                  <TableHead>Slug</TableHead>
                  <TableHead>Population</TableHead>
                  <TableHead className="w-[50px]"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  Array.from({ length: 5 }).map((_, i) => (
                    <TableRow key={i}>{Array.from({ length: 6 }).map((_, j) => <TableCell key={j}><Skeleton className="h-4 w-full" /></TableCell>)}</TableRow>
                  ))
                ) : filtered.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                      {searchText ? "No locations match." : "No locations added yet."}
                    </TableCell>
                  </TableRow>
                ) : filtered.map((loc: any) => (
                  <TableRow key={loc.id}>
                    <TableCell className="font-medium">{loc.name}</TableCell>
                    <TableCell>
                      <Badge variant="secondary" className={`text-xs capitalize ${typeColors[loc.type] || ""}`}>{loc.type}</Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground">{loc.stateName || loc.stateCode || "—"}</TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">{loc.slug}</TableCell>
                    <TableCell className="text-muted-foreground">{loc.population?.toLocaleString() || "—"}</TableCell>
                    <TableCell>
                      <Button variant="ghost" size="icon" className="size-7 text-muted-foreground hover:text-destructive"
                        onClick={() => confirm("Remove location?") && remove.mutate(loc.id)}>
                        <Trash2 className="size-3.5" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>

      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent>
          <DialogHeader><DialogTitle>Add Location</DialogTitle></DialogHeader>
          <form onSubmit={handleSubmit(d => create.mutate(d))} className="space-y-4">
            <div className="space-y-1.5">
              <Label>Type</Label>
              <Select onValueChange={v => setValue("type", v)}>
                <SelectTrigger><SelectValue placeholder="Select type" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="state">State</SelectItem>
                  <SelectItem value="city">City</SelectItem>
                  <SelectItem value="county">County</SelectItem>
                  <SelectItem value="neighborhood">Neighborhood</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Name</Label>
              <Input placeholder="Atlanta" {...register("name", { required: true })} />
            </div>
            <div className="space-y-1.5">
              <Label>Slug</Label>
              <Input placeholder="atlanta" {...register("slug", { required: true })} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>State Code</Label>
                <Input placeholder="GA" {...register("stateCode")} />
              </div>
              <div className="space-y-1.5">
                <Label>State Name</Label>
                <Input placeholder="Georgia" {...register("stateName")} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Population</Label>
              <Input type="number" placeholder="498000" {...register("population", { valueAsNumber: true })} />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setShowCreate(false)}>Cancel</Button>
              <Button type="submit" disabled={create.isPending}>Add</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
}
