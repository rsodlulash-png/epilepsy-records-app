const { httpError } = require("../middleware/errorHandler");

const BASE_URL = "https://api.fda.gov/drug/label.json";
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour
const MAX_TEXT = 1500;               // keep responses readable
const cache = new Map();

const firstText = (field) =>
  Array.isArray(field) && field.length
    ? field[0].slice(0, MAX_TEXT)
    : null;

// Fetches label info for one generic drug name.
// Dosage text is deliberately NOT returned: this app informs, it does not prescribe.
async function getDrugLabel(genericName) {
  const hit = cache.get(genericName);
  if (hit && Date.now() - hit.time < CACHE_TTL_MS) return hit.data;

  const params = new URLSearchParams({
    search: `openfda.generic_name:"${genericName}"`,
    limit: "1",
  });
  if (process.env.OPENFDA_API_KEY) params.set("api_key", process.env.OPENFDA_API_KEY);

  let res;
  try {
    res = await fetch(`${BASE_URL}?${params}`, { signal: AbortSignal.timeout(8000) });
  } catch {
    throw httpError(503, "openFDA is unreachable or timed out. Please try again later.");
  }

  if (res.status === 404) throw httpError(404, `No label found for "${genericName}"`);
  if (res.status === 429) throw httpError(429, "openFDA rate limit reached. Please wait and retry.");
  if (!res.ok) throw httpError(502, `openFDA returned an unexpected response (${res.status})`);

  let body;
  try {
    body = await res.json();
  } catch {
    throw httpError(502, "openFDA returned an invalid response");
  }

  const r = body.results && body.results[0];
  if (!r) throw httpError(404, `No label found for "${genericName}"`);

  const data = {
    genericName,
    brandName: (r.openfda && r.openfda.brand_name && r.openfda.brand_name[0]) || null,
    indications: firstText(r.indications_and_usage),
    boxedWarning: firstText(r.boxed_warning),
    warnings: firstText(r.warnings) || firstText(r.warnings_and_cautions),
    adverseReactions: firstText(r.adverse_reactions),
  };
  cache.set(genericName, { time: Date.now(), data });
  return data;
}

module.exports = { getDrugLabel };
