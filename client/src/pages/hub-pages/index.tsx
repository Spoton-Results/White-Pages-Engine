import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import DashboardLayout from "@/components/layout/DashboardLayout";

// ── Types ─────────────────────────────────────────────────────────────────────

interface Website { id: string; name: string; domain: string; }

interface HubPage {
  id: string;
  websiteId: string;
  hubType: "service" | "state" | "city";
  name: string;
  slug: string;
  tier: number;
  status: string;
  parentSlug: string | null;
  maxChildLinks: number;
  metaDescription: string | null;
  content: string | null;
  createdAt: string;
  updatedAt: string;
}

interface ChildLink {
  title: string;
  slug: string;
  qualityScore: number | null;
  tier: number | null;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const HUB_TYPE_LABELS: Record<string, string> = {
  service: "Service Hub",
  state: "State Hub",
  city: "City Hub",
};

const HUB_TYPE_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  service: { bg: "#eff6ff", text: "#1d4ed8", border: "#bfdbfe" },
  state:   { bg: "#f0fdf4", text: "#15803d", border: "#bbf7d0" },
  city:    { bg: "#fdf4ff", text: "#7e22ce", border: "#e9d5ff" },
};

function StatusBadge({ status }: { status: string }) {
  const colors = status === "published"
    ? { bg: "#dcfce7", text: "#15803d", border: "#bbf7d0" }
    : { bg: "#f3f4f6", text: "#6b7280", border: "#e5e7eb" };
  return (
    <span style={{ background: colors.bg, color: colors.text, border: `1px solid ${colors.border}`, borderRadius: 12, fontSize: ".72rem", fontWeight: 700, padding: "2px 8px" }}>
      {status}
    </span>
  );
}

// ── Create Hub Form ───────────────────────────────────────────────────────────

function CreateHubForm({ websiteId, onCreated }: { websiteId: string; onCreated: () => void }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [hubType, setHubType] = useState<"service" | "state" | "city">("service");
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [parentSlug, setParentSlug] = useState("");
  const [maxChildLinks, setMaxChildLinks] = useState(30);
  const [metaDescription, setMetaDescription] = useState("");
  const [open, setOpen] = useState(false);

  const create = useMutation({
    mutationFn: () => apiRequest("POST", `/api/websites/${websiteId}/hub-pages`, {
      hubType, name, slug: slug || autoSlug(name), parentSlug: parentSlug || null,
      maxChildLinks, metaDescription: metaDescription || null,
    }),
    onSuccess: () => {
      toast({ title: "Hub page created" });
      qc.invalidateQueries({ queryKey: ["/api/websites", websiteId, "hub-pages"] });
      setName(""); setSlug(""); setParentSlug(""); setMetaDescription(""); setOpen(false);
      onCreated();
    },
    onError: (e: any) => toast({ title: "Create failed", description: e.message, variant: "destructive" }),
  });

  function autoSlug(s: string) {
    return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
  }

  if (!open) {
    return (
      <button
        data-testid="btn-new-hub"
        onClick={() => setOpen(true)}
        style={{ background: "#111827", color: "#fff", border: "none", borderRadius: 8, padding: "8px 18px", fontSize: ".9rem", fontWeight: 600, cursor: "pointer" }}
      >
        + New Hub Page
      </button>
    );
  }

  return (
    <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 12, padding: "1.25rem 1.5rem", marginBottom: "1.5rem" }}>
      <div style={{ fontWeight: 700, fontSize: "1rem", marginBottom: "1rem", color: "#111827" }}>New Hub Page</div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, marginBottom: 12 }}>
        <div>
          <label style={labelStyle}>Hub Type</label>
          <select
            data-testid="select-hub-type"
            value={hubType}
            onChange={e => setHubType(e.target.value as any)}
            style={inputStyle}
          >
            <option value="service">Service Hub</option>
            <option value="state">State Hub</option>
            <option value="city">City Hub</option>
          </select>
        </div>
        <div>
          <label style={labelStyle}>Name <span style={{ color: "#9ca3af" }}>(display)</span></label>
          <input
            data-testid="input-hub-name"
            value={name}
            onChange={e => { setName(e.target.value); if (!slug) setSlug(autoSlug(e.target.value)); }}
            placeholder="e.g. Payment Processing"
            style={inputStyle}
          />
        </div>
        <div>
          <label style={labelStyle}>Slug</label>
          <input
            data-testid="input-hub-slug"
            value={slug}
            onChange={e => setSlug(e.target.value)}
            placeholder="payment-processing"
            style={inputStyle}
          />
        </div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, marginBottom: 12 }}>
        <div>
          <label style={labelStyle}>Parent Slug <span style={{ color: "#9ca3af" }}>(optional backlink)</span></label>
          <input
            data-testid="input-parent-slug"
            value={parentSlug}
            onChange={e => setParentSlug(e.target.value)}
            placeholder="services"
            style={inputStyle}
          />
        </div>
        <div>
          <label style={labelStyle}>Max Child Links</label>
          <input
            data-testid="input-max-child-links"
            type="number" min={5} max={500}
            value={maxChildLinks}
            onChange={e => setMaxChildLinks(parseInt(e.target.value) || 30)}
            style={inputStyle}
          />
        </div>
        <div>
          <label style={labelStyle}>Meta Description</label>
          <input
            data-testid="input-meta-description"
            value={metaDescription}
            onChange={e => setMetaDescription(e.target.value)}
            placeholder="Optional — auto-generated if blank"
            style={inputStyle}
          />
        </div>
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        <button
          data-testid="btn-create-hub"
          onClick={() => create.mutate()}
          disabled={create.isPending || !name}
          style={{ background: "#2563eb", color: "#fff", border: "none", borderRadius: 6, padding: "7px 18px", fontSize: ".88rem", fontWeight: 600, cursor: "pointer" }}
        >
          {create.isPending ? "Creating…" : "Create"}
        </button>
        <button onClick={() => setOpen(false)} style={{ background: "#f3f4f6", color: "#374151", border: "none", borderRadius: 6, padding: "7px 14px", fontSize: ".88rem", cursor: "pointer" }}>
          Cancel
        </button>
      </div>
    </div>
  );
}

const labelStyle: React.CSSProperties = { display: "block", fontSize: ".78rem", fontWeight: 600, color: "#6b7280", marginBottom: 4 };
const inputStyle: React.CSSProperties = { width: "100%", border: "1px solid #d1d5db", borderRadius: 6, padding: "7px 10px", fontSize: ".88rem", color: "#111827", background: "#fff" };

// ── Child Links Preview Modal ─────────────────────────────────────────────────

function ChildLinksModal({ hub, websiteId, domain, onClose }: { hub: HubPage; websiteId: string; domain: string; onClose: () => void }) {
  const q = useQuery<ChildLink[]>({
    queryKey: ["/api/websites", websiteId, "hub-pages", hub.id, "child-links"],
    queryFn: () =>
      fetch(`/api/websites/${websiteId}/hub-pages/${hub.id}/child-links`, { credentials: "include" }).then(r => r.json()),
  });

  const links = q.data ?? [];

  return (
    <div
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.4)", zIndex: 1000, display: "flex", alignItems: "flex-start", justifyContent: "center", paddingTop: 60 }}
      onClick={onClose}
    >
      <div
        style={{ background: "#fff", borderRadius: 12, padding: "1.5rem", width: "90%", maxWidth: 700, maxHeight: "80vh", overflowY: "auto", boxShadow: "0 20px 60px rgba(0,0,0,.2)" }}
        onClick={e => e.stopPropagation()}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
          <div>
            <div style={{ fontWeight: 700, fontSize: "1rem", color: "#111827" }}>{hub.name} — Child Links Preview</div>
            <div style={{ fontSize: ".78rem", color: "#9ca3af" }}>Top {hub.maxChildLinks} pages matching "{hub.name}"</div>
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", fontSize: "1.3rem", cursor: "pointer", color: "#9ca3af" }}>✕</button>
        </div>
        {q.isLoading && <div style={{ color: "#9ca3af", padding: "1rem" }}>Loading…</div>}
        {!q.isLoading && links.length === 0 && (
          <div style={{ color: "#9ca3af", padding: "1rem" }}>No matching published pages found. Generate content first or check that the keyword matches page slugs.</div>
        )}
        {links.length > 0 && (
          <div>
            <div style={{ fontSize: ".8rem", color: "#6b7280", marginBottom: 8 }}>{links.length} pages found</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
              {links.map(l => (
                <div key={l.slug} style={{ background: "#f9fafb", border: "1px solid #e5e7eb", borderRadius: 6, padding: "6px 10px", fontSize: ".8rem" }}>
                  <a href={`${window.location.origin}/sites/${domain}/${l.slug}`} target="_blank" rel="noopener noreferrer"
                    style={{ color: "#1d4ed8", fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", display: "block", textDecoration: "none" }}>
                    {l.title}
                  </a>
                  <div style={{ color: "#9ca3af", fontSize: ".72rem", marginTop: 2 }}>
                    score: {l.qualityScore ?? "—"} · T{l.tier ?? "?"}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Hub Row Card ──────────────────────────────────────────────────────────────

function HubCard({
  hub,
  websiteId,
  domain,
  onRefresh,
}: {
  hub: HubPage;
  websiteId: string;
  domain: string;
  onRefresh: () => void;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [showChildren, setShowChildren] = useState(false);
  const [editing, setEditing] = useState(false);
  const [maxChildLinks, setMaxChildLinks] = useState(hub.maxChildLinks);
  const [metaDescription, setMetaDescription] = useState(hub.metaDescription ?? "");
  const [parentSlug, setParentSlug] = useState(hub.parentSlug ?? "");

  const colors = HUB_TYPE_COLORS[hub.hubType] ?? HUB_TYPE_COLORS.service;

  const generate = useMutation({
    mutationFn: () =>
      apiRequest("POST", `/api/websites/${websiteId}/hub-pages/${hub.id}/generate`, {}),
    onSuccess: (data: any) => {
      toast({ title: `Generated — ${data.childCount} child links included` });
      qc.invalidateQueries({ queryKey: ["/api/websites", websiteId, "hub-pages"] });
      onRefresh();
    },
    onError: (e: any) => toast({ title: "Generate failed", description: e.message, variant: "destructive" }),
  });

  const save = useMutation({
    mutationFn: () =>
      apiRequest("PATCH", `/api/websites/${websiteId}/hub-pages/${hub.id}`, {
        maxChildLinks, metaDescription: metaDescription || null, parentSlug: parentSlug || null,
      }),
    onSuccess: () => {
      toast({ title: "Saved" });
      qc.invalidateQueries({ queryKey: ["/api/websites", websiteId, "hub-pages"] });
      setEditing(false);
      onRefresh();
    },
    onError: (e: any) => toast({ title: "Save failed", description: e.message, variant: "destructive" }),
  });

  const del = useMutation({
    mutationFn: () =>
      apiRequest("DELETE", `/api/websites/${websiteId}/hub-pages/${hub.id}`, {}),
    onSuccess: () => {
      toast({ title: "Hub deleted" });
      qc.invalidateQueries({ queryKey: ["/api/websites", websiteId, "hub-pages"] });
      onRefresh();
    },
    onError: (e: any) => toast({ title: "Delete failed", description: e.message, variant: "destructive" }),
  });

  const isBusy = generate.isPending || save.isPending || del.isPending;

  return (
    <>
      {showChildren && <ChildLinksModal hub={hub} websiteId={websiteId} domain={domain} onClose={() => setShowChildren(false)} />}
      <div
        data-testid={`card-hub-${hub.id}`}
        style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 12, padding: "1.25rem 1.5rem", display: "flex", flexDirection: "column", gap: 12 }}
      >
        {/* Header row */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 8 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <span style={{ background: colors.bg, color: colors.text, border: `1px solid ${colors.border}`, borderRadius: 12, fontSize: ".72rem", fontWeight: 700, padding: "2px 8px" }}>
              {HUB_TYPE_LABELS[hub.hubType]}
            </span>
            <span style={{ fontWeight: 700, fontSize: "1rem", color: "#111827" }}>{hub.name}</span>
            <StatusBadge status={hub.status} />
          </div>
          <code style={{ fontSize: ".75rem", color: "#6b7280", background: "#f3f4f6", padding: "2px 8px", borderRadius: 4 }}>/{hub.slug}</code>
        </div>

        {/* Stats row */}
        <div style={{ display: "flex", gap: 16, flexWrap: "wrap", fontSize: ".8rem", color: "#6b7280" }}>
          <span>Max child links: <strong style={{ color: "#374151" }}>{hub.maxChildLinks}</strong></span>
          {hub.parentSlug && <span>Back to: <strong style={{ color: "#374151" }}>/{hub.parentSlug}</strong></span>}
          {hub.content && <span style={{ color: "#16a34a" }}>✓ Content generated</span>}
          {!hub.content && <span style={{ color: "#f97316" }}>⚠ No content yet</span>}
        </div>

        {/* Editing panel */}
        {editing && (
          <div style={{ background: "#f9fafb", border: "1px solid #e5e7eb", borderRadius: 8, padding: "1rem", display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
            <div>
              <label style={labelStyle}>Max Child Links</label>
              <input
                data-testid={`input-max-links-${hub.id}`}
                type="number" min={5} max={500}
                value={maxChildLinks}
                onChange={e => setMaxChildLinks(parseInt(e.target.value) || 30)}
                style={inputStyle}
              />
            </div>
            <div>
              <label style={labelStyle}>Parent Slug (backlink)</label>
              <input
                data-testid={`input-parent-slug-${hub.id}`}
                value={parentSlug}
                onChange={e => setParentSlug(e.target.value)}
                placeholder="e.g. services"
                style={inputStyle}
              />
            </div>
            <div>
              <label style={labelStyle}>Meta Description</label>
              <input
                data-testid={`input-meta-desc-${hub.id}`}
                value={metaDescription}
                onChange={e => setMetaDescription(e.target.value)}
                placeholder="Optional"
                style={inputStyle}
              />
            </div>
          </div>
        )}

        {/* Action buttons */}
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button
            data-testid={`btn-generate-${hub.id}`}
            onClick={() => generate.mutate()}
            disabled={isBusy}
            style={{ background: "#2563eb", color: "#fff", border: "none", borderRadius: 6, padding: "6px 14px", fontSize: ".82rem", fontWeight: 600, cursor: isBusy ? "not-allowed" : "pointer" }}
          >
            {generate.isPending ? "Generating…" : hub.content ? "Regenerate" : "Generate & Publish"}
          </button>
          <button
            data-testid={`btn-preview-children-${hub.id}`}
            onClick={() => setShowChildren(true)}
            disabled={isBusy}
            style={{ background: "#fff", color: "#374151", border: "1px solid #d1d5db", borderRadius: 6, padding: "6px 14px", fontSize: ".82rem", fontWeight: 600, cursor: "pointer" }}
          >
            Preview Child Links
          </button>
          {editing ? (
            <>
              <button
                data-testid={`btn-save-${hub.id}`}
                onClick={() => save.mutate()}
                disabled={isBusy}
                style={{ background: "#16a34a", color: "#fff", border: "none", borderRadius: 6, padding: "6px 14px", fontSize: ".82rem", fontWeight: 600, cursor: "pointer" }}
              >
                {save.isPending ? "Saving…" : "Save"}
              </button>
              <button onClick={() => setEditing(false)} style={{ background: "#f3f4f6", color: "#374151", border: "none", borderRadius: 6, padding: "6px 12px", fontSize: ".82rem", cursor: "pointer" }}>Cancel</button>
            </>
          ) : (
            <button
              data-testid={`btn-edit-${hub.id}`}
              onClick={() => setEditing(true)}
              style={{ background: "#f3f4f6", color: "#374151", border: "none", borderRadius: 6, padding: "6px 14px", fontSize: ".82rem", cursor: "pointer" }}
            >
              Edit Settings
            </button>
          )}
          <button
            data-testid={`btn-delete-${hub.id}`}
            onClick={() => { if (confirm(`Delete hub page "${hub.name}"?`)) del.mutate(); }}
            disabled={isBusy}
            style={{ background: "none", color: "#ef4444", border: "1px solid #fecaca", borderRadius: 6, padding: "6px 12px", fontSize: ".82rem", cursor: "pointer", marginLeft: "auto" }}
          >
            Delete
          </button>
        </div>
      </div>
    </>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

// ── Fix 1: Bulk Generate Hub Dialog ───────────────────────────────────────────

function BulkGenerateHubDialog({ websiteId, accountId, onDone }: { websiteId: string; accountId: string; onDone: () => void }) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [hubType, setHubType] = useState<"service" | "state" | "city">("service");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [maxChildLinks, setMaxChildLinks] = useState(30);
  const [generateAI, setGenerateAI] = useState(false);
  const [jobId, setJobId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [cityTopN, setCityTopN] = useState<number | "all" | null>(null);
  const [cityTierFilter, setCityTierFilter] = useState<number | null>(null);

  const servicesQ = useQuery<any[]>({
    queryKey: ["/api/accounts", accountId, "services"],
    queryFn: () => fetch(`/api/accounts/${accountId}/services`, { credentials: "include" }).then(r => r.json()),
    enabled: !!accountId && open,
  });

  const locationsQ = useQuery<any[]>({
    queryKey: ["/api/websites", websiteId, "locations"],
    queryFn: () => fetch(`/api/websites/${websiteId}/locations`, { credentials: "include" }).then(r => r.json()),
    enabled: !!websiteId && open,
  });

  const jobQ = useQuery<any>({
    queryKey: ["hub-bulk-job", jobId],
    queryFn: () => fetch(`/api/websites/${websiteId}/hub-pages/bulk-job/${jobId}`, { credentials: "include" }).then(r => r.json()),
    enabled: !!jobId,
    refetchInterval: (q: any) => {
      const s = q.state.data?.status;
      return s === "done" || s === "error" ? false : 1200;
    },
  });

  const jobData = jobQ.data as any;
  const isDone = jobData?.status === "done" || jobData?.status === "error";

  useEffect(() => {
    if (isDone && jobId) {
      onDone();
      toast({ title: `Created ${jobData?.created ?? 0} hub page(s)` });
    }
  }, [isDone, jobId]);

  const services: string[] = (servicesQ.data || []).map((s: any) => s.name);
  const locationRows: any[] = Array.isArray(locationsQ.data) ? locationsQ.data : [];
  const states: string[] = [...new Set(locationRows.filter((l: any) => l.type === "state").map((l: any) => l.name as string))].sort();
  const allCityLocs: any[] = locationRows.filter((l: any) => l.type === "city");
  const filteredCityLocs: any[] = (() => {
    let result = [...allCityLocs];
    if (cityTierFilter !== null) result = result.filter((l: any) => l.cityTier === cityTierFilter);
    result.sort((a: any, b: any) => (b.population ?? 0) - (a.population ?? 0));
    if (cityTopN !== null && cityTopN !== "all") result = result.slice(0, cityTopN as number);
    return result;
  })();
  const cities: string[] = filteredCityLocs.map((l: any) => l.name);
  const items = hubType === "service" ? services : hubType === "state" ? states : cities;

  const toggleAll = () => {
    if (selected.size === items.length) setSelected(new Set());
    else setSelected(new Set(items));
  };

  const toggleItem = (name: string) => {
    const next = new Set(selected);
    if (next.has(name)) next.delete(name); else next.add(name);
    setSelected(next);
  };

  const handleSubmit = async () => {
    setSubmitting(true);
    try {
      const resp = await fetch(`/api/websites/${websiteId}/hub-pages/bulk-generate`, {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          hubType,
          services: hubType === "service" ? [...selected] : [],
          states: hubType === "state" ? [...selected] : [],
          cities: hubType === "city" ? [...selected] : [],
          maxChildLinks, generateAI,
        }),
      });
      const data = await resp.json();
      if (data.jobId) setJobId(data.jobId);
      else toast({ title: "Error", description: data.error || "Failed", variant: "destructive" });
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    } finally { setSubmitting(false); }
  };

  const handleClose = () => {
    setOpen(false); setJobId(null); setSelected(new Set());
    setHubType("service"); setMaxChildLinks(30); setGenerateAI(false);
    setCityTopN(null); setCityTierFilter(null);
  };

  const btnStyle = (active: boolean) => ({
    padding: "6px 16px", borderRadius: 8, border: "2px solid", cursor: "pointer", fontSize: ".85rem", fontWeight: 600,
    borderColor: active ? "#2563eb" : "#e5e7eb",
    background: active ? "#eff6ff" : "#fff",
    color: active ? "#1d4ed8" : "#374151",
  });

  const pct = jobData ? Math.round((jobData.done / Math.max(jobData.total, 1)) * 100) : 0;

  return (
    <>
      <button data-testid="btn-bulk-generate-hubs" onClick={() => setOpen(true)}
        style={{ background: "#2563eb", color: "#fff", border: "none", borderRadius: 8, padding: "8px 18px", fontSize: ".9rem", fontWeight: 600, cursor: "pointer" }}>
        Bulk Generate
      </button>
      {open && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.45)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div style={{ background: "#fff", borderRadius: 16, padding: "2rem", width: "min(680px, 95vw)", maxHeight: "90vh", overflow: "auto" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "1.25rem" }}>
              <h2 style={{ fontSize: "1.2rem", fontWeight: 800, color: "#111827", margin: 0 }}>Bulk Generate Hub Pages</h2>
              <button onClick={handleClose} aria-label="Close" style={{ background: "none", border: "none", cursor: "pointer", color: "#6b7280", fontSize: "1.4rem", lineHeight: 1, padding: "2px 6px", borderRadius: 6 }}>✕</button>
            </div>
            {!jobId ? (
              <>
                <div style={{ marginBottom: 14 }}>
                  <label style={{ display: "block", fontWeight: 600, marginBottom: 6, fontSize: ".85rem", color: "#374151" }}>Hub Type</label>
                  <div style={{ display: "flex", gap: 8 }}>
                    {(["service", "state", "city"] as const).map(t => (
                      <button key={t} onClick={() => {
                        setHubType(t);
                        setSelected(new Set());
                        setCityTierFilter(null);
                        setCityTopN(t === "city" ? 100 : null);
                      }} style={btnStyle(hubType === t)}>
                        {t === "service" ? "Service Hub" : t === "state" ? "State Hub" : "City Hub"}
                      </button>
                    ))}
                  </div>
                </div>
                <div style={{ marginBottom: 14 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                    <label style={{ fontWeight: 600, fontSize: ".85rem", color: "#374151" }}>
                      Select {hubType === "service" ? "Services" : hubType === "state" ? "States" : "Cities"} ({selected.size} selected)
                    </label>
                    <button onClick={toggleAll} style={{ fontSize: ".8rem", color: "#2563eb", background: "none", border: "none", cursor: "pointer", fontWeight: 600 }}>
                      {selected.size === items.length && items.length > 0 ? "Deselect All" : "Select All"}
                    </button>
                  </div>
                  {hubType === "city" && (
                    <div style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 8, flexWrap: "wrap" }}>
                      <select
                        data-testid="select-hub-city-top-n"
                        value={cityTopN === null ? "" : String(cityTopN)}
                        onChange={e => {
                          const v = e.target.value;
                          setCityTierFilter(null);
                          setCityTopN(v === "" ? null : v === "all" ? "all" : Number(v));
                          setSelected(new Set());
                        }}
                        style={{ border: "1px solid #d1d5db", borderRadius: 6, padding: "4px 8px", fontSize: ".78rem", color: "#374151", background: "#fff", cursor: "pointer" }}
                      >
                        <option value="">Top Cities…</option>
                        {[20, 50, 100, 250, 500, 750, 1000, 2500, 5000].map(n => (
                          <option key={n} value={String(n)}>Top {n.toLocaleString()}</option>
                        ))}
                        <option value="all">All Cities</option>
                      </select>
                      {([1, 2, 3] as const).map(tier => (
                        <button
                          key={tier}
                          type="button"
                          data-testid={`button-hub-city-tier-${tier}`}
                          onClick={() => {
                            setCityTopN(null);
                            setCityTierFilter(cityTierFilter === tier ? null : tier);
                            setSelected(new Set());
                          }}
                          style={{
                            padding: "4px 10px", borderRadius: 6, border: "1px solid", fontSize: ".78rem", fontWeight: 600, cursor: "pointer",
                            borderColor: cityTierFilter === tier ? "#2563eb" : "#d1d5db",
                            background: cityTierFilter === tier ? "#eff6ff" : "#fff",
                            color: cityTierFilter === tier ? "#1d4ed8" : "#374151",
                          }}
                        >
                          Tier {tier}
                        </button>
                      ))}
                      {(cityTopN !== null || cityTierFilter !== null) && (
                        <button
                          type="button"
                          data-testid="button-hub-city-clear-filter"
                          onClick={() => { setCityTopN(null); setCityTierFilter(null); setSelected(new Set()); }}
                          style={{ padding: "4px 10px", borderRadius: 6, border: "1px solid #d1d5db", fontSize: ".78rem", fontWeight: 500, cursor: "pointer", background: "#fff", color: "#6b7280" }}
                        >
                          Clear
                        </button>
                      )}
                    </div>
                  )}
                  <div style={{ border: "1px solid #e5e7eb", borderRadius: 8, maxHeight: 200, overflow: "auto", padding: "6px 0" }}>
                    {items.length === 0 ? (
                      <div style={{ textAlign: "center", color: "#9ca3af", padding: "1rem", fontSize: ".85rem" }}>
                        {servicesQ.isLoading || locationsQ.isLoading ? "Loading…" : `No ${hubType}s found in this website`}
                      </div>
                    ) : items.map(name => (
                      <label key={name} style={{ display: "flex", alignItems: "center", gap: 10, padding: "5px 14px", cursor: "pointer", background: selected.has(name) ? "#f0f9ff" : "transparent" }}>
                        <input type="checkbox" checked={selected.has(name)} onChange={() => toggleItem(name)} />
                        <span style={{ fontSize: ".88rem", color: "#1f2937" }}>{name}</span>
                      </label>
                    ))}
                  </div>
                </div>
                <div style={{ marginBottom: 18, display: "flex", gap: 20, alignItems: "center", flexWrap: "wrap" }}>
                  <div>
                    <label style={{ display: "block", fontWeight: 600, fontSize: ".85rem", color: "#374151", marginBottom: 4 }}>Max Child Links</label>
                    <input type="number" min={1} max={200} value={maxChildLinks} onChange={e => setMaxChildLinks(parseInt(e.target.value) || 30)}
                      style={{ border: "1px solid #d1d5db", borderRadius: 8, padding: "6px 10px", width: 80, fontSize: ".9rem" }} />
                  </div>
                  <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", paddingTop: 18 }}>
                    <input type="checkbox" checked={generateAI} onChange={e => setGenerateAI(e.target.checked)} data-testid="chk-generate-ai" />
                    <span style={{ fontWeight: 600, fontSize: ".85rem", color: "#374151" }}>Generate AI content &amp; publish</span>
                  </label>
                </div>
                <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
                  <button onClick={handleClose} style={{ padding: "8px 18px", borderRadius: 8, border: "1px solid #d1d5db", background: "#fff", color: "#374151", fontWeight: 600, cursor: "pointer" }}>Cancel</button>
                  <button data-testid="btn-bulk-hub-submit" onClick={handleSubmit} disabled={selected.size === 0 || submitting}
                    style={{ padding: "8px 18px", borderRadius: 8, border: "none", background: selected.size === 0 ? "#9ca3af" : "#111827", color: "#fff", fontWeight: 600, cursor: selected.size === 0 ? "not-allowed" : "pointer" }}>
                    {submitting ? "Starting…" : `Generate ${selected.size} Hub${selected.size !== 1 ? "s" : ""}`}
                  </button>
                </div>
              </>
            ) : (
              <div>
                <div style={{ fontWeight: 600, marginBottom: 8, fontSize: ".9rem", color: "#374151" }}>
                  {isDone ? (jobData?.status === "error" ? "Job failed" : "Complete!") : "Generating hub pages…"}
                </div>
                <div style={{ background: "#f3f4f6", borderRadius: 6, height: 12, overflow: "hidden", marginBottom: 6 }}>
                  <div style={{ background: isDone && jobData?.status !== "error" ? "#16a34a" : "#2563eb", height: "100%", width: `${pct}%`, transition: "width .5s ease" }} />
                </div>
                <div style={{ fontSize: ".82rem", color: "#6b7280", marginBottom: 16 }}>
                  {jobData ? `${jobData.done} / ${jobData.total} processed` : "Starting…"}
                  {isDone && ` — ${jobData?.created ?? 0} created`}
                </div>
                <div style={{ display: "flex", justifyContent: "flex-end" }}>
                  {isDone ? (
                    <button onClick={handleClose} style={{ padding: "8px 18px", borderRadius: 8, border: "none", background: "#111827", color: "#fff", fontWeight: 600, cursor: "pointer" }}>Close</button>
                  ) : (
                    <button onClick={handleClose} style={{ padding: "8px 18px", borderRadius: 8, border: "1px solid #d1d5db", background: "#fff", color: "#374151", fontWeight: 600, cursor: "pointer" }}>
                      Run in Background
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}

// ── Bulk Publish Drafts Button ─────────────────────────────────────────────────

function BulkPublishDraftsButton({
  websiteId,
  hubType,
  draftCount,
  onDone,
}: {
  websiteId: string;
  hubType?: string;
  draftCount: number;
  onDone: () => void;
}) {
  const { toast } = useToast();
  const [confirming, setConfirming] = useState(false);
  const [publishing, setPublishing] = useState(false);

  if (draftCount === 0) return null;

  const typeLabel = hubType ? hubType.charAt(0).toUpperCase() + hubType.slice(1) + " " : "";
  const confirmMsg = `This will publish all ${draftCount.toLocaleString()} draft ${typeLabel}hub pages. Are you sure?`;

  const handleConfirm = async () => {
    setPublishing(true);
    try {
      const resp = await fetch(`/api/websites/${websiteId}/hub-pages/bulk-publish`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ hubType }),
      });
      const data = await resp.json();
      toast({ title: `Published ${(data.published ?? 0).toLocaleString()} hub pages`, description: data.jobId ? "Job logged to Jobs dashboard." : undefined });
      setConfirming(false);
      onDone();
    } catch (e: any) {
      toast({ title: "Publish failed", description: e.message, variant: "destructive" });
    } finally {
      setPublishing(false);
    }
  };

  const isGlobal = !hubType;

  return (
    <>
      {confirming && (
        <div
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.45)", zIndex: 2000, display: "flex", alignItems: "center", justifyContent: "center" }}
          onClick={() => !publishing && setConfirming(false)}
        >
          <div
            style={{ background: "#fff", borderRadius: 12, padding: "1.75rem 2rem", maxWidth: 440, width: "90%", boxShadow: "0 20px 60px rgba(0,0,0,.2)" }}
            onClick={e => e.stopPropagation()}
          >
            <div style={{ fontWeight: 700, fontSize: "1rem", color: "#111827", marginBottom: "0.75rem" }}>
              Publish {typeLabel}Hub Drafts
            </div>
            <div style={{ color: "#374151", fontSize: ".9rem", marginBottom: "1.25rem" }}>{confirmMsg}</div>
            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
              <button
                onClick={() => setConfirming(false)}
                disabled={publishing}
                style={{ padding: "8px 16px", borderRadius: 8, border: "1px solid #d1d5db", background: "#fff", color: "#374151", fontWeight: 600, cursor: "pointer" }}
              >
                Cancel
              </button>
              <button
                data-testid={`btn-confirm-publish-${hubType || "all"}`}
                onClick={handleConfirm}
                disabled={publishing}
                style={{ padding: "8px 16px", borderRadius: 8, border: "none", background: "#16a34a", color: "#fff", fontWeight: 600, cursor: publishing ? "not-allowed" : "pointer" }}
              >
                {publishing ? "Publishing…" : `Publish ${draftCount.toLocaleString()}`}
              </button>
            </div>
          </div>
        </div>
      )}
      <button
        data-testid={`btn-bulk-publish-${hubType || "all"}`}
        onClick={() => setConfirming(true)}
        style={{
          background: "#fff", color: "#16a34a", border: "1px solid #bbf7d0", cursor: "pointer", fontWeight: 600,
          borderRadius: isGlobal ? 8 : 6,
          padding: isGlobal ? "8px 18px" : "3px 10px",
          fontSize: isGlobal ? ".9rem" : ".78rem",
        }}
      >
        {isGlobal
          ? `Publish All Drafts (${draftCount.toLocaleString()})`
          : `Publish ${draftCount.toLocaleString()} Drafts`}
      </button>
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

export default function HubPagesPage() {
  const [websiteId, setWebsiteId] = useState("");
  const qc = useQueryClient();

  const websitesQ = useQuery<Website[]>({
    queryKey: ["/api/websites"],
    queryFn: () => fetch("/api/websites", { credentials: "include" }).then(r => r.json()),
  });

  const hubsQ = useQuery<HubPage[]>({
    queryKey: ["/api/websites", websiteId, "hub-pages"],
    queryFn: () =>
      fetch(`/api/websites/${websiteId}/hub-pages`, { credentials: "include" }).then(r => r.json()),
    enabled: !!websiteId,
  });

  const websites = websitesQ.data ?? [];
  const hubs = hubsQ.data ?? [];
  const currentWebsite = websites.find((w: any) => w.id === websiteId);

  const byType = (t: string) => hubs.filter(h => h.hubType === t);

  const refresh = () => qc.invalidateQueries({ queryKey: ["/api/websites", websiteId, "hub-pages"] });

  const published = hubs.filter(h => h.status === "published").length;
  const withContent = hubs.filter(h => h.content).length;
  const draftCount = hubs.filter(h => h.status === "draft").length;
  const domain = (currentWebsite as any)?.domain || "";

  return (
    <DashboardLayout>
      <div style={{ maxWidth: 1100, margin: "0 auto", padding: "2rem 1.5rem" }}>

        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "1.75rem", flexWrap: "wrap", gap: 12 }}>
          <div>
            <h1 style={{ fontSize: "1.6rem", fontWeight: 800, color: "#111827", margin: 0 }}>Hub Pages</h1>
            <p style={{ color: "#6b7280", marginTop: 4, fontSize: ".9rem" }}>
              Service, state, and city aggregator pages that link to your top-quality child pages.
            </p>
          </div>
          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <select
              data-testid="select-website"
              value={websiteId}
              onChange={e => setWebsiteId(e.target.value)}
              style={{ border: "1px solid #d1d5db", borderRadius: 8, padding: "8px 12px", fontSize: ".9rem", minWidth: 220, cursor: "pointer" }}
            >
              <option value="">— Select website —</option>
              {websites.map(w => (
                <option key={w.id} value={w.id}>{w.name} ({w.domain})</option>
              ))}
            </select>
            {websiteId && <BulkGenerateHubDialog websiteId={websiteId} accountId={(currentWebsite as any)?.accountId || ""} onDone={refresh} />}
            {websiteId && <BulkPublishDraftsButton websiteId={websiteId} draftCount={draftCount} onDone={refresh} />}
            {websiteId && <CreateHubForm websiteId={websiteId} onCreated={refresh} />}
          </div>
        </div>

        {!websiteId && (
          <div style={{ textAlign: "center", padding: "3rem", color: "#9ca3af" }}>
            Select a website to manage hub pages.
          </div>
        )}

        {websiteId && hubsQ.isLoading && (
          <div style={{ textAlign: "center", padding: "3rem", color: "#9ca3af" }}>Loading…</div>
        )}

        {websiteId && !hubsQ.isLoading && hubs.length === 0 && (
          <div style={{ textAlign: "center", padding: "3rem", color: "#9ca3af" }}>
            No hub pages yet. Create the first one above.
          </div>
        )}

        {websiteId && hubs.length > 0 && (
          <>
            {/* Summary strip */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12, marginBottom: "1.5rem" }}>
              {[
                { label: "Total Hubs", value: hubs.length },
                { label: "Published", value: published, color: "#16a34a" },
                { label: "With Content", value: withContent, color: "#2563eb" },
                { label: "Drafts", value: hubs.length - published, color: "#f97316" },
              ].map(s => (
                <div key={s.label} style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 10, padding: "1rem 1.25rem" }}>
                  <div style={{ fontSize: "1.6rem", fontWeight: 800, color: s.color ?? "#111827" }}>{s.value}</div>
                  <div style={{ fontSize: ".8rem", color: "#6b7280", marginTop: 2 }}>{s.label}</div>
                </div>
              ))}
            </div>

            {/* Groups by type */}
            {(["service", "state", "city"] as const).map(type => {
              const group = byType(type);
              if (group.length === 0) return null;
              return (
                <div key={type} style={{ marginBottom: "2rem" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12, flexWrap: "wrap" }}>
                    <h2 style={{ fontSize: "1rem", fontWeight: 700, color: "#374151" }}>{HUB_TYPE_LABELS[type]}s</h2>
                    <span style={{ background: "#f3f4f6", color: "#6b7280", fontSize: ".75rem", fontWeight: 600, padding: "1px 8px", borderRadius: 10 }}>{group.length}</span>
                    <BulkPublishDraftsButton
                      websiteId={websiteId}
                      hubType={type}
                      draftCount={group.filter(h => h.status === "draft").length}
                      onDone={refresh}
                    />
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                    {group.map(hub => (
                      <HubCard key={hub.id} hub={hub} websiteId={websiteId} domain={domain} onRefresh={refresh} />
                    ))}
                  </div>
                </div>
              );
            })}
          </>
        )}

      </div>
    </DashboardLayout>
  );
}
