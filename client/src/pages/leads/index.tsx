import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import DashboardLayout from "@/components/layout/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Mail, Phone, Building2, FileText, Calendar, Inbox } from "lucide-react";
import { api } from "@/lib/api";

function formatDate(iso: string) {
  return new Date(iso).toLocaleString("en-US", {
    month: "short", day: "numeric", year: "numeric",
    hour: "numeric", minute: "2-digit",
  });
}

export default function LeadsPage() {
  const [selectedWebsite, setSelectedWebsite] = useState<string>("all");

  const { data: websites } = useQuery({
    queryKey: ["websites"],
    queryFn: () => api.get("/api/websites").then(r => r.json()),
  });

  const { data: leadsData, isLoading } = useQuery({
    queryKey: ["leads", selectedWebsite],
    queryFn: async () => {
      if (selectedWebsite === "all") {
        return api.get("/api/leads").then(r => r.json());
      }
      return api.get(`/api/websites/${selectedWebsite}/leads`).then(r => r.json());
    },
  });

  const leads = leadsData?.leads ?? [];
  const total = leadsData?.total ?? leads.length;

  return (
    <DashboardLayout>
      <div className="p-6 space-y-6">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Leads</h1>
            <p className="text-muted-foreground text-sm mt-1">
              Contact form submissions from your published pages.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <Select value={selectedWebsite} onValueChange={setSelectedWebsite}>
              <SelectTrigger className="w-52" data-testid="select-website">
                <SelectValue placeholder="All websites" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All websites</SelectItem>
                {(websites || []).map((w: any) => (
                  <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Badge variant="secondary" data-testid="text-lead-count">
              {isLoading ? "…" : `${total} lead${total !== 1 ? "s" : ""}`}
            </Badge>
          </div>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-20 text-muted-foreground">
            Loading leads…
          </div>
        ) : leads.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-20 text-center">
              <Inbox className="size-10 text-muted-foreground mb-3" />
              <p className="font-medium">No leads yet</p>
              <p className="text-muted-foreground text-sm mt-1">
                Contact form submissions will appear here once visitors fill out the form on your pages.
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-4">
            {leads.map((lead: any) => (
              <Card key={lead.id} data-testid={`card-lead-${lead.id}`}>
                <CardHeader className="pb-2">
                  <div className="flex items-start justify-between gap-3 flex-wrap">
                    <CardTitle className="text-base font-semibold" data-testid={`text-lead-name-${lead.id}`}>
                      {lead.name}
                    </CardTitle>
                    <div className="flex items-center gap-2 shrink-0">
                      {lead.pageSlug && (
                        <Badge variant="outline" className="text-xs font-normal gap-1">
                          <FileText className="size-3" />
                          {lead.pageSlug}
                        </Badge>
                      )}
                      <span className="text-xs text-muted-foreground flex items-center gap-1">
                        <Calendar className="size-3" />
                        {formatDate(lead.createdAt)}
                      </span>
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 text-sm">
                    {lead.businessName && (
                      <div className="flex items-center gap-2 text-muted-foreground">
                        <Building2 className="size-4 shrink-0" />
                        <span data-testid={`text-lead-biz-${lead.id}`}>{lead.businessName}</span>
                      </div>
                    )}
                    <div className="flex items-center gap-2">
                      <Mail className="size-4 shrink-0 text-muted-foreground" />
                      <a
                        href={`mailto:${lead.email}`}
                        className="text-primary hover:underline"
                        data-testid={`link-lead-email-${lead.id}`}
                      >
                        {lead.email}
                      </a>
                    </div>
                    {lead.phone && (
                      <div className="flex items-center gap-2">
                        <Phone className="size-4 shrink-0 text-muted-foreground" />
                        <a
                          href={`tel:${lead.phone}`}
                          className="text-primary hover:underline"
                          data-testid={`link-lead-phone-${lead.id}`}
                        >
                          {lead.phone}
                        </a>
                      </div>
                    )}
                  </div>
                  {lead.message && (
                    <p
                      className="mt-3 text-sm text-muted-foreground border-t pt-3"
                      data-testid={`text-lead-msg-${lead.id}`}
                    >
                      {lead.message}
                    </p>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
