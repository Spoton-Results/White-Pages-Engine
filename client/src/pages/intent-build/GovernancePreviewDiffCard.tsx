import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

interface GovernancePreview {
  action: "consolidate" | "merge";
  winner: { id: string; slug: string; title: string; tier?: number; pageType?: string };
  winnerReason?: any;
  affectedPages: any[];
  linkDiff?: any;
  plannedChanges: string[];
  safetyRules: string[];
  counts: { affectedPages: number; internalLinksToRepair: number };
}

interface Props {
  ownerIntentCluster: string;
  action: "consolidate" | "merge";
  preview: GovernancePreview;
  actionBusy: string | null;
  onCancel: () => void;
  onRunChanges: () => void;
}

export default function GovernancePreviewDiffCard({
  ownerIntentCluster,
  action,
  preview,
  actionBusy,
  onCancel,
  onRunChanges,
}: Props) {
  return (
    <Card className="border-blue-200 bg-blue-50">
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          Preview:{" "}
          <Badge variant="outline" className="capitalize">
            {action}
          </Badge>
          <span className="text-sm font-normal text-gray-600">{ownerIntentCluster}</span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div>
          <p className="text-sm font-semibold">Winner: {preview.winner.title}</p>
          <p className="text-xs text-gray-500">Slug: {preview.winner.slug}</p>
        </div>
        <div className="flex gap-4 text-sm">
          <span>
            Affected pages: <strong>{preview.counts.affectedPages}</strong>
          </span>
          <span>
            Internal links to repair:{" "}
            <strong>{preview.counts.internalLinksToRepair}</strong>
          </span>
        </div>
        {preview.plannedChanges.length > 0 && (
          <div>
            <p className="text-xs font-semibold text-gray-700 mb-1">Planned changes</p>
            <ul className="text-xs text-gray-600 list-disc list-inside space-y-0.5">
              {preview.plannedChanges.map((c, i) => (
                <li key={i}>{c}</li>
              ))}
            </ul>
          </div>
        )}
        {preview.safetyRules.length > 0 && (
          <div>
            <p className="text-xs font-semibold text-gray-700 mb-1">Safety rules</p>
            <ul className="text-xs text-gray-600 list-disc list-inside space-y-0.5">
              {preview.safetyRules.map((r, i) => (
                <li key={i}>{r}</li>
              ))}
            </ul>
          </div>
        )}
        <div className="flex gap-2 pt-2">
          <Button
            variant="outline"
            size="sm"
            onClick={onCancel}
            disabled={!!actionBusy}
          >
            Cancel
          </Button>
          <Button size="sm" onClick={onRunChanges} disabled={!!actionBusy}>
            {actionBusy ? "Working..." : "Run Changes"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
