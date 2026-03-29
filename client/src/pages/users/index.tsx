import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import DashboardLayout from "@/components/layout/DashboardLayout";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Users, ShieldCheck, Plus } from "lucide-react";
import { api } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";

const emptyForm = {
  username: "",
  email: "",
  password: "",
  role: "viewer" as string,
  accountId: "",
  isSuperAdmin: false,
};

export default function UsersPage() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ ...emptyForm });

  const { data: users = [], isLoading } = useQuery({
    queryKey: ["/api/users"],
    queryFn: () => api.get<any[]>("/api/users"),
  });

  const { data: accounts = [] } = useQuery({
    queryKey: ["/api/accounts"],
    queryFn: () => api.get<any[]>("/api/accounts"),
  });

  const createUser = useMutation({
    mutationFn: (data: typeof form) =>
      api.post("/api/users", {
        username: data.username,
        email: data.email,
        password: data.password || "changeme",
        role: data.role,
        accountId: data.isSuperAdmin ? undefined : (data.accountId || undefined),
        isSuperAdmin: data.isSuperAdmin,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/users"] });
      setShowCreate(false);
      setForm({ ...emptyForm });
      toast({ title: "User created successfully" });
    },
    onError: (err: any) => toast({ title: "Error creating user", description: err.message, variant: "destructive" }),
  });

  const roleColors: Record<string, string> = {
    super_admin: "bg-red-500/10 text-red-600 border-red-200",
    account_admin: "bg-primary/10 text-primary border-primary/20",
    editor: "bg-amber-500/10 text-amber-600 border-amber-200",
    viewer: "bg-muted text-muted-foreground",
  };

  const isFormValid = form.username.trim() && form.email.trim() &&
    (form.isSuperAdmin || form.accountId);

  return (
    <DashboardLayout>
      <div className="flex flex-col gap-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Users & Roles</h1>
            <p className="text-muted-foreground text-sm mt-0.5">Manage platform users and access control.</p>
          </div>
          <Button size="sm" className="gap-2" onClick={() => setShowCreate(true)} data-testid="button-create-user">
            <Plus className="size-4" />Create User
          </Button>
        </div>

        <div className="bg-card rounded-lg border overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Username</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Account</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Type</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                Array.from({ length: 3 }).map((_, i) => (
                  <TableRow key={i}>
                    {Array.from({ length: 5 }).map((_, j) => (
                      <TableCell key={j}><Skeleton className="h-4 w-full" /></TableCell>
                    ))}
                  </TableRow>
                ))
              ) : users.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">
                    No users found.
                  </TableCell>
                </TableRow>
              ) : users.map((user: any) => (
                <TableRow key={user.id} data-testid={`row-user-${user.id}`}>
                  <TableCell className="font-medium">{user.username}</TableCell>
                  <TableCell className="text-muted-foreground">{user.email}</TableCell>
                  <TableCell className="text-muted-foreground">{user.accountName || "—"}</TableCell>
                  <TableCell>
                    <Badge variant="outline" className={`text-xs capitalize ${roleColors[user.role] || ""}`}>
                      {user.role?.replace("_", " ")}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    {user.isSuperAdmin ? (
                      <Badge variant="outline" className="text-xs gap-1 bg-red-50 text-red-600 border-red-200">
                        <ShieldCheck className="size-3" />Super Admin
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="text-xs">Client</Badge>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </div>

      <Dialog open={showCreate} onOpenChange={open => { setShowCreate(open); if (!open) setForm({ ...emptyForm }); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Create User</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>Username</Label>
              <Input
                placeholder="john.doe"
                data-testid="input-username"
                value={form.username}
                onChange={e => setForm(p => ({ ...p, username: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Email</Label>
              <Input
                type="email"
                placeholder="john@example.com"
                data-testid="input-email"
                value={form.email}
                onChange={e => setForm(p => ({ ...p, email: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Password <span className="text-muted-foreground font-normal text-xs">(leave blank to use "changeme")</span></Label>
              <Input
                type="password"
                placeholder="••••••••"
                data-testid="input-password"
                value={form.password}
                onChange={e => setForm(p => ({ ...p, password: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Role</Label>
              <Select value={form.role} onValueChange={v => setForm(p => ({ ...p, role: v }))}>
                <SelectTrigger data-testid="select-role">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="viewer">Viewer</SelectItem>
                  <SelectItem value="editor">Editor</SelectItem>
                  <SelectItem value="account_admin">Account Admin</SelectItem>
                  <SelectItem value="super_admin">Super Admin</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-3">
              <Switch
                id="super-admin-toggle"
                checked={form.isSuperAdmin}
                onCheckedChange={v => setForm(p => ({ ...p, isSuperAdmin: v, accountId: v ? "" : p.accountId }))}
                data-testid="switch-super-admin"
              />
              <Label htmlFor="super-admin-toggle" className="cursor-pointer">
                Platform Super Admin
                <span className="block text-xs text-muted-foreground font-normal">Full access to all accounts and settings</span>
              </Label>
            </div>
            {!form.isSuperAdmin && (
              <div className="space-y-1.5">
                <Label>Account</Label>
                <Select value={form.accountId} onValueChange={v => setForm(p => ({ ...p, accountId: v }))}>
                  <SelectTrigger data-testid="select-user-account">
                    <SelectValue placeholder="Select account" />
                  </SelectTrigger>
                  <SelectContent>
                    {accounts.map((a: any) => (
                      <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>
          <DialogFooter className="gap-2 mt-2">
            <Button variant="outline" onClick={() => setShowCreate(false)}>Cancel</Button>
            <Button
              onClick={() => createUser.mutate(form)}
              disabled={createUser.isPending || !isFormValid}
              data-testid="button-confirm-create-user"
            >
              {createUser.isPending ? "Creating…" : "Create User"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
}
