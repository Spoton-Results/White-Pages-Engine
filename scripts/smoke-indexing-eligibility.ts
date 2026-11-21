import assert from "node:assert/strict";
import { validateIndexingEligibility as validate } from "../server/services/indexing-eligibility";

const context = "https://schema.org";
const wrap = (value: unknown) => `<script type="application/ld+json">${JSON.stringify(value)}</script>`;
const job = { "@type": "JobPosting", title: "Engineer", description: "Build merchant tools.", datePosted: "2026-11-01", hiringOrganization: { "@type": "Organization", name: "Example" }, jobLocation: { "@type": "Place", address: { "@type": "PostalAddress", addressCountry: "US" } } };
const event = { "@type": "BroadcastEvent", isLiveBroadcast: true, startDate: "2026-12-01T10:00:00Z", endDate: "2026-12-01T11:00:00Z" };
const video = { "@type": "VideoObject", name: "Live workshop", description: "Live merchant workshop.", uploadDate: "2026-11-01", thumbnailUrl: "https://example.com/thumb.jpg", publication: event };
const cases: Array<[string, string, boolean]> = [
  ["merchant page", wrap({ "@context": context, "@type": "Service" }), false],
  ["plain text", "JobPosting BroadcastEvent VideoObject", false],
  ["malformed", '<script type="application/ld+json">{</script>', false],
  ["job", wrap({ "@context": context, ...job }), true],
  ["video", wrap({ "@context": context, ...video }), true],
  ["standalone event", wrap({ "@context": context, ...event }), false],
  ["unrelated event", wrap({ "@context": context, "@graph": [{ ...video, publication: undefined }, event] }), false],
  ["graph", wrap({ "@context": context, "@graph": [job] }), true],
  ["array", wrap([{ "@context": context, ...job }]), true],
  ["missing evidence", wrap({ "@context": context, "@type": "JobPosting" }), false],
  ["foreign context", wrap({ "@context": "https://example.com", ...job }), false],
  ["comment", `<!--${wrap({ "@context": context, ...job })}-->`, false],
  ["template", `<template>${wrap({ "@context": context, ...job })}</template>`, false],
  ["invalid mixed block", wrap({ "@context": context, ...job }) + '<script type="application/ld+json">{</script>', false],
  ["not live", wrap({ "@context": context, ...video, publication: { ...event, isLiveBroadcast: false } }), false],
  ["oversized", "x".repeat(2000001), false],
];
for (const [name, html, expected] of cases) assert.equal(validate(html).eligible, expected, name);
assert.equal(validate(wrap({ "@context": context, ...job })).schemaType, "JobPosting");
assert.equal(validate(wrap({ "@context": context, ...video })).schemaType, "VideoObject");
assert.deepEqual(validate("<p>Merchant page</p>").reasons, ["missing_jsonld"]);
console.log(`Passed ${cases.length} indexing eligibility cases and 3 result assertions.`);
