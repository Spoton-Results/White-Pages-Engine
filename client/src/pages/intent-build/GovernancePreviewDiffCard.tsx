import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  AlertTriangle,
  CheckCircle2,
  FileText,
  Layers,
  Link2,
  Merge,
} from "lucide-react";

// ---------------------------------------------------------------------------
// Types (kept local; mirrored from intent-build-v2/index.tsx)
// ---------------------------------------------------------------------------

interface GovernancePreviewWinner {
  id: string;
  slug: string;
  title: string;
  tier?: number;
  pageType?: string;
}

interface GovernancePreview {
  action: "consolidate" | "merge";
  winner: GovernancePreviewWinner;
  winnerReason?: any;
  affectedPages: any[];
  linkDiff?: any;
  plannedChanges: string[];
  safetyRules: string[];
  counts: {
    affectedPages: number;
    internalLinksToRepair: number;
  };
}

interface GovernancePreviewDiffCardProps {
  ownerIntentCluster: string;
  action: "consolidate" | "merge";
  preview: GovernancePreview;
  actionBusy: string | null;
  onCancel: () => void;
  onRunChanges: () => void;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function ActionIcon({ action }: { action: "consolidate" | "merge" }) {
  return action === "merge" ? (
    <Merge className="h-4 w-4" />
  ) : (
    <Layers className="h-4 w-4" />
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
      {children}
    </h3>
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function GovernancePreviewDiffCard({
  ownerIntentCluster,
  action,
  preview,
  actionBusy,
  onCancel,
  onRunChanges,
}: GovernancePreviewDiffCardProps) {
  const isBusy = !!actionBusy;
  const label = action === "merge" ? "Merge" : "Consolidate";

  return (
    <Card className="border-blue-200 bg-blue-50/40 shadow-sm">
      {/* ── Header ── */}
      <CardHeader className="pb-3">
        <div className="flex items-center gap-2">
          <div className="rounded-md bg-blue-100 p-1.5 text-blue-700">
            <ActionIcon action={action} />
          </div>
          <div>
            <CardTitle className="text-base">Preview — {label}</CardTitle>
            <CardDescription className="mt-0.5 text-xs">
              Intent cluster:{" "}
              <span className="font-medium text-gray-700">
                {ownerIntentCluster}
              </span>
            </CardDescription>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-5">

        {/* ── Canonical winner ── */}
        <div>
          <SectionLabel>Canonical winner</SectionLabel>
          <div className="rounded-lg border border-green-200 bg-white px-4 py-3">
            <div className="flex flex-wrap items-center gap-2">
              <CheckCircle2 className="h-4 w-4 shrink-0 text-green-600" />
              <span className="break-all font-mono text-sm font-semibold text-gray-800">
                /{preview.winner.slug}
              </span>
              {preview.winner.title && (
                <span className="text-sm text-gray-600">
                  — {preview.winner.title}
                </span>
              )}
              {preview.winner.tier != null && (
                <Badge
                  variant="outline"
                  className="border-blue-200 text-blue-700"
                >
                  Tier {preview.winner.tier}
                </Badge>
              )}
              {preview.winner.pageType && (
                <Badge variant="outline" className="text-xs">
                  {preview.winner.pageType}
                </Badge>
              )}
            </div>
            {preview.winnerReason && (
              <p className="mt-2 text-xs text-gray-500">
                {typeof preview.winnerReason === "string"
                  ? preview.winnerReason
                  : JSON.stringify(preview.winnerReason)}
              </p>
            )}
          </div>
        </div>

        {/* ── Impact counts ── */}
        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-lg border bg-white px-4 py-3 text-center">
            <FileText className="mx-auto mb-1 h-4 w-4 text-gray-400" />
            <p className="text-xl font-bold text-gray-800">
              {preview.counts.affectedPages}
            </p>
            <p className="text-xs text-gray-500">Affected pages</p>
          </div>
          <div className="rounded-lg border bg-white px-4 py-3 text-center">
            <Link2 className="mx-auto mb-1 h-4 w-4 text-gray-400" />
            <p className="text-xl font-bold text-gray-800">
              {preview.counts.internalLinksToRepair}
            </p>
            <p className="text-xs text-gray-500">Links to repair</p>
          </div>
        </div>

        {/* ── Planned changes ── */}
        {preview.plannedChanges?.length > 0 && (
          <div>
            <SectionLabel>Planned changes</SectionLabel>
            <ul className="space-y-1.5 rounded-lg border bg-white px-4 py-3">
              {preview.plannedChanges.map((change, i) => (
                <li
                  key={i}
                  className="flex items-start gap-2 text-sm text-gray-700"
                >
                  <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-blue-500" />
                  {change}
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* ── Safety rules ── */}
        {preview.safetyRules?.length > 0 && (
          <div>
            <SectionLabel>Safety rules applied</SectionLabel>
            <ul className="space-y-1.5 rounded-lg border border-yellow-200 bg-yellow-50 px-4 py-3">
              {preview.safetyRules.map((rule, i) => (
                <li
                  key={i}
                  className="flex items-start gap-2 text-sm text-yellow-800"
                >
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-yellow-600" />
                  {rule}
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* ── Link diff (collapsible raw) ── */}
        {preview.linkDiff && (
          <details className="rounded-lg border bg-white">
            <summary className="cursor-pointer select-none px-4 py-2.5 text-xs font-medium text-gray-600 hover:bg-gray-50">
              Link diff (raw)
            </summary>
            <pre className="max-h-48 overflow-auto px-4 pb-3 pt-2 text-xs text-gray-700">
              {typeof preview.linkDiff === "string"
                ? preview.linkDiff
                : JSON.stringify(preview.linkDiff, null, 2)}
            </pre>
          </details>
        )}

        {/* ── Affected pages list (collapsible) ── */}
        {preview.affectedPages?.length > 0 && (
          <details className="rounded-lg border bg-white">
            <summary className="cursor-pointer select-none px-4 py-2.5 text-xs font-medium text-gray-600 hover:bg-gray-50">
              Affected pages ({preview.affectedPages.length})
            </summary>
            <ul className="max-h-48 space-y-1 overflow-auto px-4 pb-3 pt-2">
              {preview.affectedPages.map((p: any, i: number) => (
                <li key={i} className="font-mono text-xs text-gray-600">
                  {typeof p === "string" ? p : (p?.slug ?? JSON.stringify(p))}
                </li>
              ))}
            </ul>
          </details>
        )}

        {/* ── Action buttons ── */}
        <div className="flex flex-wrap items-center justify-end gap-3 border-t border-blue-100 pt-4">
          <Button
            variant="outline"
            size="sm"
            disabled={isBusy}
            onClick={onCancel}
          >
            Cancel
          </Button>
          <Button
            size="sm"
            className="gap-2 bg-blue-700 hover:bg-blue-800 text-white"
            disabled={isBusy}
            onClick={onRunChanges}
          >
            <ActionIcon action={action} />
            {isBusy ? "Running…" : `Run ${label} Changes`}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
