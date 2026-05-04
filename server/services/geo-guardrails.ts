export interface GeoTarget {
  locationName: string;
  locationType: string;
  stateAbbr: string;
  stateName: string;
}

function normalizeText(value: string | null | undefined): string {
  return (value ?? "")
    .trim()
    .replace(/\s+/g, " ");
}

function equalLoose(a: string | null | undefined, b: string | null | undefined): boolean {
  return normalizeText(a).toLowerCase() === normalizeText(b).toLowerCase();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function normalizeGeoTarget(target: GeoTarget): GeoTarget {
  const locationName = normalizeText(target.locationName);
  const stateName = normalizeText(target.stateName);
  const stateAbbr = normalizeText(target.stateAbbr).toUpperCase();
  const locationType = normalizeText(target.locationType).toLowerCase();

  if (locationType === "state") {
    return {
      locationName: stateName || locationName,
      locationType: "state",
      stateAbbr,
      stateName: stateName || locationName,
    };
  }

  return {
    locationName,
    locationType: locationType || "city",
    stateAbbr,
    stateName,
  };
}

export function getDisplayLocation(target: GeoTarget): string {
  const normalized = normalizeGeoTarget(target);

  if (normalized.locationType === "state") {
    return normalized.stateName;
  }

  if (!normalized.locationName) return normalized.stateName;
  if (!normalized.stateName) return normalized.locationName;

  if (equalLoose(normalized.locationName, normalized.stateName)) {
    return normalized.stateName;
  }

  return `${normalized.locationName}, ${normalized.stateName}`;
}

export function hasDuplicatedGeoName(target: GeoTarget): boolean {
  const normalized = normalizeGeoTarget(target);
  return !!(
    normalized.locationName &&
    normalized.stateName &&
    equalLoose(normalized.locationName, normalized.stateName) &&
    normalized.locationType !== "state"
  );
}

export function validateGeoTarget(target: GeoTarget): { ok: true; target: GeoTarget } | { ok: false; reason: string; target: GeoTarget } {
  const normalized = normalizeGeoTarget(target);

  if (!normalized.stateAbbr || normalized.stateAbbr.length !== 2) {
    return { ok: false, reason: `Invalid state abbreviation: ${target.stateAbbr || "missing"}`, target: normalized };
  }

  if (!normalized.stateName) {
    return { ok: false, reason: "Missing state name", target: normalized };
  }

  if (!normalized.locationName) {
    return { ok: false, reason: "Missing location name", target: normalized };
  }

  if (hasDuplicatedGeoName(normalized)) {
    return {
      ok: false,
      reason: `Invalid city/state pairing: ${normalized.locationName}, ${normalized.stateName}`,
      target: normalized,
    };
  }

  return { ok: true, target: normalized };
}

export function sanitizeGeoText(text: string, target: GeoTarget): string {
  const normalized = normalizeGeoTarget(target);
  if (!text) return text;

  const stateName = normalized.stateName;
  const stateAbbr = normalized.stateAbbr;
  if (!stateName) return text;

  const escapedState = escapeRegExp(stateName);
  const escapedAbbr = stateAbbr ? escapeRegExp(stateAbbr) : "";

  let output = text
    // Alabama, Alabama -> Alabama
    .replace(new RegExp(`\\b${escapedState}\\s*,\\s*${escapedState}\\b`, "gi"), stateName)
    // Alabama, AL -> Alabama for state-level pages only. City pages still need City, AL.
    .replace(
      normalized.locationType === "state" && escapedAbbr
        ? new RegExp(`\\b${escapedState}\\s*,\\s*${escapedAbbr}\\b`, "gi")
        : /a^/g,
      stateName,
    );

  // Generic duplicate phrase cleanup catches blueprint/rendered strings without target context.
  output = output.replace(/\b([A-Z][A-Za-z .'-]{2,})\s*,\s*\1\b/g, "$1");

  return output
    .replace(/\s{2,}/g, " ")
    .replace(/\s+([,.;:!?])/g, "$1")
    .trim();
}

export function sanitizeSlug(slug: string): string {
  if (!slug) return slug;

  // Fix repeated state slugs at the end: seasonal-payment-processing-alabama-alabama -> seasonal-payment-processing-alabama
  const parts = slug.split("-").filter(Boolean);
  if (parts.length >= 2 && parts[parts.length - 1] === parts[parts.length - 2]) {
    parts.pop();
  }

  return parts.join("-").replace(/-{2,}/g, "-").replace(/(^-|-$)/g, "");
}
