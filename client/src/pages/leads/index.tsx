import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import DashboardLayout from "@/components/layout/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Toggle } from "@/components/ui/toggle";
import { Mail, Phone, Building2, FileText, Calendar, Inbox, Download, Search, Copy, Sparkles, Loader2, ChevronDown, ChevronUp, ClipboardCopy } from "lucide-react";
import { api } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";

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

const labelColors: Record<string, string> = {
  Hot: "bg-red-100 text-red-700 border-red-300",
  Warm: "bg-amber-100 text-amber-700 border-amber-300",
  Cold: "bg-blue-100 text-blue-700 border-blue-300",
};

export default function LeadsPage() {
  const { toast } = useToast();
  const [overrideWebsite, setOverrideWebsite] = useState<string>("");
  const [search, setSearch] = useState("");
  const [dupeOnly, setDupeOnly] = useState(false);
  const [aiLoading, setAiLoading] = useState<Record<string, boolean>>({});
  const [aiResults, setAiResults] = useState<Record<string, { score: number; label: string; reasoning: string; draftReply: string }>>({});
  const [aiOpen, setAiOpen] = useState<Record<string, boolean>>({});

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
        : api.get<any>(`/api/leads/${selectedWebsite}`),
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

  async function qualifyLead(lead: any) {
    if (aiLoading[lead.id]) return;
    setAiLoading(prev => ({ ...prev, [lead.id]: true }));
    try {
      const result = await api.post<any>("/api/leads/ai-qualify", {
        name: lead.name,
        email: lead.email,
        businessName: lead.businessName,
        phone: lead.phone,
        message: lead.message,
        pageSlug: lead.pageSlug,
      });
      setAiResults(prev => ({ ...prev, [lead.id]: result }));
      setAiOpen(prev => ({ ...prev, [lead.id]: true }));
    } catch (e: any) {
      toast({ title: "AI error", description: e.message, variant: "destructive" });
    } finally {
      setAiLoading(prev => ({ ...prev, [lead.id]: false }));
    }
  }

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
              const aiRes = aiResults[lead.id];
              const isAiOpen = aiOpen[lead.id];
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
                        {aiRes && (
                          <Badge variant="outline" className={`text-xs gap-1 ${labelColors[aiRes.label] ?? ""}`}>
                            {aiRes.label} · {aiRes.score}/100
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
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 gap-1.5 text-xs text-violet-600 border-violet-300 hover:bg-violet-50"
                          disabled={!!aiLoading[lead.id]}
                          onClick={() => aiRes ? setAiOpen(prev => ({ ...prev, [lead.id]: !prev[lead.id] })) : qualifyLead(lead)}
                          data-testid={`button-ai-qualify-${lead.id}`}
                        >
                          {aiLoading[lead.id] ? <Loader2 className="size-3 animate-spin" /> : <Sparkles className="size-3" />}
                          {aiLoading[lead.id] ? "Qualifying…" : aiRes ? (isAiOpen ? "Hide AI" : "Show AI") : "AI Qualify"}
                        </Button>
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

                    {aiRes && isAiOpen && (
                      <div className="mt-3 border-t pt-3 space-y-3">
                        <div className="rounded-lg border border-violet-200 bg-violet-50 p-3 space-y-2">
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-semibold text-violet-700">AI Assessment</span>
                            <Badge variant="outline" className={`text-xs ${labelColors[aiRes.label] ?? ""}`}>
                              {aiRes.label} · {aiRes.score}/100
                            </Badge>
                          </div>
                          <p className="text-xs text-muted-foreground">{aiRes.reasoning}</p>
                        </div>
                        <div className="rounded-lg border bg-muted/40 p-3 space-y-2">
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-semibold text-foreground">Draft Reply</span>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-6 gap-1 text-xs"
                              onClick={() => { navigator.clipboard.writeText(aiRes.draftReply); toast({ title: "Copied to clipboard" }); }}
                            >
                              <ClipboardCopy className="size-3" />Copy
                            </Button>
                          </div>
                          <p className="text-xs text-muted-foreground whitespace-pre-line">{aiRes.draftReply}</p>
                          <a
                            href={`mailto:${lead.email}?subject=Re: Your inquiry&body=${encodeURIComponent(aiRes.draftReply)}`}
                            className="inline-flex items-center gap-1.5 text-xs text-primary hover:underline"
                          >
                            <Mail className="size-3" />Open in email client
                          </a>
                        </div>
                      </div>
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
