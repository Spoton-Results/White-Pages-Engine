import { useState } from "react";
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

function ChildLinksModal({ hub, websiteId, onClose }: { hub: HubPage; websiteId: string; onClose: () => void }) {
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
                  <div style={{ color: "#1d4ed8", fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{l.title}</div>
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
  onRefresh,
}: {
  hub: HubPage;
  websiteId: string;
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
      {showChildren && <ChildLinksModal hub={hub} websiteId={websiteId} onClose={() => setShowChildren(false)} />}
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

  const byType = (t: string) => hubs.filter(h => h.hubType === t);

  const refresh = () => qc.invalidateQueries({ queryKey: ["/api/websites", websiteId, "hub-pages"] });

  const published = hubs.filter(h => h.status === "published").length;
  const withContent = hubs.filter(h => h.content).length;

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
                  <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
                    <h2 style={{ fontSize: "1rem", fontWeight: 700, color: "#374151" }}>{HUB_TYPE_LABELS[type]}s</h2>
                    <span style={{ background: "#f3f4f6", color: "#6b7280", fontSize: ".75rem", fontWeight: 600, padding: "1px 8px", borderRadius: 10 }}>{group.length}</span>
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                    {group.map(hub => (
                      <HubCard key={hub.id} hub={hub} websiteId={websiteId} onRefresh={refresh} />
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
