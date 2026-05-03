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
  if (!stateName) return text;

  const escapedState = stateName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return text
    .replace(new RegExp(`\\b${escapedState}\\s*,\\s*${escapedState}\\b`, "gi"), stateName)
    .replace(/\s{2,}/g, " ")
    .trim();
}
