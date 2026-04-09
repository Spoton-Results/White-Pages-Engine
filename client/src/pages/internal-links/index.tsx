import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import DashboardLayout from "@/components/layout/DashboardLayout";

interface Website { id: string; name: string; domain: string; }

interface LinkStats {
  totalLinks: number;
  pagesWithLinks: number;
  totalPublished: number;
  topLinkedPages: Array<{ title: string; slug: string; inboundCount: number }>;
}

export default function InternalLinksPage() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [websiteId, setWebsiteId] = useState("");
  const [rebuilding, setRebuilding] = useState(false);

  const websitesQ = useQuery<Website[]>({
    queryKey: ["/api/websites"],
    queryFn: () => fetch("/api/websites", { credentials: "include" }).then(r => r.json()),
  });

  const statsQ = useQuery<LinkStats>({
    queryKey: ["/api/websites", websiteId, "internal-links-stats"],
    queryFn: () =>
      fetch(`/api/websites/${websiteId}/internal-links/stats`, { credentials: "include" }).then(r => r.json()),
    enabled: !!websiteId,
    refetchInterval: rebuilding ? 8000 : false,
  });

  const rebuild = useMutation({
    mutationFn: () =>
      apiRequest("POST", `/api/websites/${websiteId}/internal-links/rebuild`, {}),
    onSuccess: () => {
      setRebuilding(true);
      toast({ title: "Rebuild started", description: "Internal links are being computed. Stats will refresh automatically." });
      setTimeout(() => {
        setRebuilding(false);
        qc.invalidateQueries({ queryKey: ["/api/websites", websiteId, "internal-links-stats"] });
      }, 25000);
    },
    onError: (e: any) => toast({ title: "Rebuild failed", description: e.message, variant: "destructive" }),
  });

  const websites = websitesQ.data ?? [];
  const stats = statsQ.data;

  const coverage = stats && stats.totalPublished > 0
    ? Math.round((stats.pagesWithLinks / stats.totalPublished) * 100)
    : 0;
  const orphaned = stats ? stats.totalPublished - stats.pagesWithLinks : 0;
  const maxInbound = Math.max(...(stats?.topLinkedPages.map(p => p.inboundCount) ?? [1]), 1);

  return (
    <DashboardLayout>
      <div style={{ maxWidth: 1000, margin: "0 auto", padding: "2rem 1.5rem" }}>

        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "1.75rem", flexWrap: "wrap", gap: 12 }}>
          <div>
            <h1 style={{ fontSize: "1.6rem", fontWeight: 800, color: "#111827", margin: 0 }}>Internal Links</h1>
            <p style={{ color: "#6b7280", marginTop: 4, fontSize: ".9rem" }}>
              Auto-build contextual links between service, state, and city pages to distribute PageRank.
            </p>
          </div>
          <select
            data-testid="select-website"
            value={websiteId}
            onChange={e => setWebsiteId(e.target.value)}
            style={{ border: "1px solid #d1d5db", borderRadius: 8, padding: "8px 12px", fontSize: ".9rem", minWidth: 220, cursor: "pointer" }}
          >
            <option value="">— Select website —</option>
            {websites.map(w => <option key={w.id} value={w.id}>{w.name} ({w.domain})</option>)}
          </select>
        </div>

        {!websiteId && (
          <div style={{ textAlign: "center", padding: "3rem", color: "#9ca3af" }}>Select a website to manage internal links.</div>
        )}

        {websiteId && statsQ.isLoading && (
          <div style={{ textAlign: "center", padding: "3rem", color: "#9ca3af" }}>Loading…</div>
        )}

        {websiteId && stats && (
          <>
            {/* Summary strip */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 12, marginBottom: "1.5rem" }}>
              {[
                { label: "Total Links", value: stats.totalLinks.toLocaleString(), color: "#2563eb" },
                { label: "Pages with Links", value: stats.pagesWithLinks.toLocaleString(), color: "#16a34a" },
                { label: "Orphaned Pages", value: orphaned.toLocaleString(), color: orphaned > 0 ? "#f97316" : "#16a34a" },
                { label: "Link Coverage", value: `${coverage}%`, color: coverage >= 80 ? "#16a34a" : coverage >= 50 ? "#eab308" : "#ef4444" },
              ].map(s => (
                <div key={s.label} style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 10, padding: "1rem 1.25rem" }}>
                  <div style={{ fontSize: "1.6rem", fontWeight: 800, color: s.color }}>{s.value}</div>
                  <div style={{ fontSize: ".8rem", color: "#6b7280", marginTop: 2 }}>{s.label}</div>
                </div>
              ))}
            </div>

            {/* How it works */}
            <div style={{ background: "#f0f9ff", border: "1px solid #bae6fd", borderRadius: 12, padding: "1rem 1.25rem", marginBottom: "1.5rem", fontSize: ".85rem", color: "#0c4a6e" }}>
              <strong>How the link builder works:</strong> For each service+city page, it creates:
              (1) a <em>state-nav</em> link to its state hub, and (2) up to 3 <em>cross-service</em> links to other services in the same city.
              State hubs also get <em>hub-to-city</em> links to their top 10 city pages.
              Links are stored in the database and used for internal analytics — they can also be injected into page HTML in a future update.
            </div>

            {/* Coverage bar */}
            <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 12, padding: "1.25rem 1.5rem", marginBottom: "1.5rem" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                <h2 style={{ margin: 0, fontSize: "1rem", fontWeight: 700, color: "#111827" }}>Link Coverage</h2>
                <button
                  data-testid="btn-rebuild-links"
                  onClick={() => rebuild.mutate()}
                  disabled={rebuild.isPending || rebuilding}
                  style={{ background: "#2563eb", color: "#fff", border: "none", borderRadius: 8, padding: "8px 20px", fontSize: ".88rem", fontWeight: 700, cursor: "pointer", opacity: (rebuild.isPending || rebuilding) ? .7 : 1 }}
                >
                  {rebuild.isPending || rebuilding ? "Rebuilding…" : "Rebuild Internal Links"}
                </button>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <div style={{ flex: 1, height: 18, background: "#f3f4f6", borderRadius: 9, overflow: "hidden" }}>
                  <div style={{ height: "100%", width: `${coverage}%`, background: coverage >= 80 ? "#16a34a" : coverage >= 50 ? "#eab308" : "#ef4444", borderRadius: 9, transition: "width .4s" }} />
                </div>
                <span style={{ fontWeight: 800, fontSize: "1rem", color: "#374151", width: 48 }}>{coverage}%</span>
              </div>
              <div style={{ fontSize: ".78rem", color: "#9ca3af", marginTop: 6 }}>
                {stats.pagesWithLinks.toLocaleString()} of {stats.totalPublished.toLocaleString()} published pages have outbound internal links
              </div>
            </div>

            {/* Top linked pages */}
            {stats.topLinkedPages.length > 0 && (
              <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 12, padding: "1.25rem 1.5rem" }}>
                <h2 style={{ margin: "0 0 1rem", fontSize: "1rem", fontWeight: 700, color: "#111827" }}>Top Linked Pages (by Inbound Links)</h2>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {stats.topLinkedPages.map(p => (
                    <div key={p.slug} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <div style={{ width: 220, fontSize: ".8rem", color: "#374151", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flexShrink: 0 }} title={p.title}>{p.title}</div>
                      <div style={{ flex: 1, height: 14, background: "#f3f4f6", borderRadius: 4, overflow: "hidden" }}>
                        <div style={{ height: "100%", width: `${Math.round((p.inboundCount / maxInbound) * 100)}%`, background: "#2563eb", borderRadius: 4 }} />
                      </div>
                      <div style={{ width: 40, fontSize: ".8rem", fontWeight: 700, color: "#374151", textAlign: "right" }}>{p.inboundCount}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </DashboardLayout>
  );
}
