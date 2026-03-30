import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import DashboardLayout from "@/components/layout/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Toggle } from "@/components/ui/toggle";
import { Mail, Phone, Building2, FileText, Calendar, Inbox, Download, Search, Copy } from "lucide-react";
import { api } from "@/lib/api";

function formatDate(iso: string) {
  return new Date(iso).toLocaleString("en-US", {
    month: "short", day: "numeric", year: "numeric",
    hour: "numeric", minute: "2-digit",
  });
}

function exportToCsv(leads: any[], filename = "leads.csv") {
  const headers = ["Name", "Business", "Email", "Phone", "Page", "Message", "Date"];
  const rows = leads.map((l) => [
    l.name,
    l.businessName ?? "",
    l.email,
    l.phone ?? "",
    l.pageSlug ?? "",
    (l.message ?? "").replace(/\n/g, " "),
    new Date(l.createdAt).toISOString(),
  ]);
  const csv = [headers, ...rows]
    .map((row) => row.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(","))
    .join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export default function LeadsPage() {
  const [overrideWebsite, setOverrideWebsite] = useState<string>("");
  const [search, setSearch] = useState("");
  const [dupeOnly, setDupeOnly] = useState(false);

  const { data: websites } = useQuery<any[]>({
    queryKey: ["websites"],
    queryFn: () => api.get<any[]>("/api/websites"),
  });

  const selectedWebsite = overrideWebsite || "all";

  const { data: leadsData, isLoading } = useQuery<any>({
    queryKey: ["leads", selectedWebsite],
    queryFn: () =>
      selectedWebsite === "all"
        ? api.get<any>("/api/leads")
        : api.get<any>(`/api/websites/${selectedWebsite}/leads`),
  });

  const allLeads: any[] = leadsData?.leads ?? [];

  const dupeEmails = useMemo(() => {
    const seen = new Set<string>();
    const dupes = new Set<string>();
    for (const l of allLeads) {
      if (seen.has(l.email)) dupes.add(l.email);
      else seen.add(l.email);
    }
    return dupes;
  }, [allLeads]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    return allLeads.filter((l) => {
      if (dupeOnly && !dupeEmails.has(l.email)) return false;
      if (!q) return true;
      return (
        l.name?.toLowerCase().includes(q) ||
        l.email?.toLowerCase().includes(q) ||
        l.businessName?.toLowerCase().includes(q) ||
        l.message?.toLowerCase().includes(q) ||
        l.pageSlug?.toLowerCase().includes(q)
      );
    });
  }, [allLeads, search, dupeOnly, dupeEmails]);

  const dupeCount = dupeEmails.size;

  return (
    <DashboardLayout>
      <div className="p-6 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Leads</h1>
            <p className="text-muted-foreground text-sm mt-1">
              Contact form submissions from your published pages.
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <Select value={selectedWebsite} onValueChange={setOverrideWebsite}>
              <SelectTrigger className="w-48" data-testid="select-website">
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
              {isLoading ? "…" : `${filtered.length} lead${filtered.length !== 1 ? "s" : ""}`}
            </Badge>

            {dupeCount > 0 && (
              <Toggle
                pressed={dupeOnly}
                onPressedChange={setDupeOnly}
                variant="outline"
                size="sm"
                data-testid="toggle-dupes"
                className="gap-1.5 text-xs"
              >
                <Copy className="size-3" />
                {dupeCount} duplicate email{dupeCount !== 1 ? "s" : ""}
              </Toggle>
            )}

            <Button
              variant="outline"
              size="sm"
              disabled={filtered.length === 0}
              onClick={() => {
                const site = websites?.find((w: any) => w.id === selectedWebsite);
                exportToCsv(filtered, `leads${site ? `-${site.name}` : ""}.csv`);
              }}
              data-testid="button-export-csv"
              className="gap-1.5"
            >
              <Download className="size-4" />
              Export CSV
            </Button>
          </div>
        </div>

        {/* Search */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground pointer-events-none" />
          <Input
            placeholder="Search by name, email, business, page, or message…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
            data-testid="input-search-leads"
          />
        </div>

        {/* Body */}
        {isLoading ? (
          <div className="flex items-center justify-center py-20 text-muted-foreground">
            Loading leads…
          </div>
        ) : filtered.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-20 text-center">
              <Inbox className="size-10 text-muted-foreground mb-3" />
              <p className="font-medium">
                {allLeads.length === 0 ? "No leads yet" : "No leads match your filters"}
              </p>
              <p className="text-muted-foreground text-sm mt-1">
                {allLeads.length === 0
                  ? "Contact form submissions will appear here once visitors fill out the form on your pages."
                  : "Try adjusting your search or clearing the duplicate filter."}
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-4">
            {filtered.map((lead: any) => {
              const isDupe = dupeEmails.has(lead.email);
              return (
                <Card
                  key={lead.id}
                  data-testid={`card-lead-${lead.id}`}
                  className={isDupe ? "border-orange-300 dark:border-orange-700" : ""}
                >
                  <CardHeader className="pb-2">
                    <div className="flex items-start justify-between gap-3 flex-wrap">
                      <div className="flex items-center gap-2">
                        <CardTitle className="text-base font-semibold" data-testid={`text-lead-name-${lead.id}`}>
                          {lead.name}
                        </CardTitle>
                        {isDupe && (
                          <Badge variant="outline" className="text-xs text-orange-600 border-orange-400 gap-1">
                            <Copy className="size-3" />
                            Duplicate email
                          </Badge>
                        )}
                      </div>
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
              );
            })}
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
