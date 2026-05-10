type Preview = {
  winner?: { slug?: string };
  winnerReason?: { summary?: string; factors?: string[] };
  linkDiff?: {
    before?: { linksPointingToWinner?: number; linksPointingToAffectedPages?: number };
    after?: { linksPointingToWinner?: number; linksPointingToAffectedPages?: number };
    changes?: Array<{ linkId: string; fromSlug?: string; oldToSlug?: string; newToSlug?: string; anchorText?: string | null }>;
  };
  affectedPages?: Array<{ id: string; slug?: string; title?: string; status?: string; tier?: number }>;
  plannedChanges?: string[];
  safetyRules?: string[];
  counts?: { affectedPages?: number; internalLinksToRepair?: number };
};

export default function GovernancePreviewDiffCard({ preview, action, ownerIntentCluster, actionBusy, onCancel, onRunChanges }: { preview: Preview; action: string; ownerIntentCluster: string; actionBusy: string | null; onCancel: () => void; onRunChanges: () => void }) {
  const diff = preview.linkDiff;
  return <div className="rounded-lg border border-blue-200 bg-blue-50/40 p-4 space-y-4">
    <div className="flex items-start justify-between gap-3"><div><h2 className="font-semibold text-gray-900">Governance Preview Diff</h2><p className="text-sm text-gray-600">Review winner reason and internal-link changes before running.</p></div><button className="text-sm text-gray-600" onClick={onCancel}>Close</button></div>
    <div className="grid gap-3 md:grid-cols-4"><div className="rounded border bg-white p-3"><p className="text-xs text-gray-500">Action</p><p className="font-semibold capitalize">{action}</p></div><div className="rounded border bg-white p-3"><p className="text-xs text-gray-500">Winner</p><p className="font-semibold truncate">{preview.winner?.slug || "-"}</p></div><div className="rounded border bg-white p-3"><p className="text-xs text-gray-500">Affected</p><p className="font-semibold">{preview.counts?.affectedPages ?? 0}</p></div><div className="rounded border bg-white p-3"><p className="text-xs text-gray-500">Links</p><p className="font-semibold">{preview.counts?.internalLinksToRepair ?? 0}</p></div></div>
    {preview.winnerReason && <div className="rounded border bg-white p-3"><p className="font-semibold">Why winner was selected</p><p className="text-sm text-gray-600">{preview.winnerReason.summary}</p><p className="mt-2 text-xs text-gray-500">Intent cluster: {ownerIntentCluster || "-"}</p><ul className="mt-2 text-sm text-gray-600">{(preview.winnerReason.factors || []).map((f, i) => <li key={i}>• {f}</li>)}</ul></div>}
    {diff && <div className="grid gap-3 md:grid-cols-2"><div className="rounded border bg-white p-3"><p className="font-semibold">Before</p><p className="text-sm">Winner links: {diff.before?.linksPointingToWinner ?? 0}</p><p className="text-sm">Affected links: {diff.before?.linksPointingToAffectedPages ?? 0}</p></div><div className="rounded border bg-white p-3"><p className="font-semibold">After</p><p className="text-sm">Winner links: {diff.after?.linksPointingToWinner ?? 0}</p><p className="text-sm">Affected links: {diff.after?.linksPointingToAffectedPages ?? 0}</p></div></div>}
    {diff && <div className="rounded border bg-white p-3"><p className="font-semibold">Internal link changes</p>{(diff.changes || []).length === 0 ? <p className="text-sm text-gray-500">No internal links need repointing.</p> : <div className="mt-2 space-y-2">{(diff.changes || []).slice(0, 10).map(c => <div key={c.linkId} className="rounded bg-gray-50 p-2 text-sm"><span className="font-medium">{c.fromSlug || "-"}</span> | {c.oldToSlug || "-"} → {c.newToSlug || "-"} | {c.anchorText || "-"}</div>)}</div>}</div>}
    <div className="grid gap-3 md:grid-cols-2"><div className="rounded border bg-white p-3"><p className="font-semibold">Planned changes</p><ul className="text-sm text-gray-600">{(preview.plannedChanges || []).map((x, i) => <li key={i}>• {x}</li>)}</ul></div><div className="rounded border bg-white p-3"><p className="font-semibold">Safety rules</p><ul className="text-sm text-gray-600">{(preview.safetyRules || []).map((x, i) => <li key={i}>• {x}</li>)}</ul></div></div>
    <div className="rounded border bg-white p-3"><p className="font-semibold">Affected pages</p>{(preview.affectedPages || []).slice(0, 10).map(p => <div key={p.id} className="text-sm text-gray-600">{p.slug || "-"} | {p.status || "-"} | tier {p.tier ?? "-"}</div>)}</div>
    <div className="flex justify-end gap-2"><button className="rounded border px-3 py-2 text-sm" onClick={onCancel}>Cancel</button><button className="rounded bg-blue-600 px-3 py-2 text-sm text-white disabled:opacity-60" disabled={!!actionBusy} onClick={onRunChanges}>{actionBusy?.endsWith(":run") ? "Running..." : "Run Changes"}</button></div>
  </div>;
}
