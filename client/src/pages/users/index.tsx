import { useQuery } from "@tanstack/react-query";
import DashboardLayout from "@/components/layout/DashboardLayout";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Users, ShieldCheck } from "lucide-react";
import { api } from "@/lib/api";

export default function UsersPage() {
  const { data: users = [], isLoading } = useQuery({
    queryKey: ["/api/users"],
    queryFn: () => api.get<any[]>("/api/users"),
  });

  const roleColors: Record<string, string> = {
    super_admin: "bg-red-500/10 text-red-600 border-red-200",
    account_admin: "bg-primary/10 text-primary border-primary/20",
    editor: "bg-amber-500/10 text-amber-600 border-amber-200",
    viewer: "bg-muted text-muted-foreground",
  };

  return (
    <DashboardLayout>
      <div className="flex flex-col gap-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Users & Roles</h1>
            <p className="text-muted-foreground text-sm mt-0.5">Manage platform users and access control.</p>
          </div>
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
                <TableRow key={user.id}>
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
    </DashboardLayout>
  );
}
