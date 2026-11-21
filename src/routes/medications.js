const express = require("express");
const reference = require("../data/medication-reference.json");
const { getDrugLabel } = require("../services/openfda");
const { httpError } = require("../middleware/errorHandler");

const router = express.Router();

const DISCLAIMER =
  "For clinician review only. This is reference information, not a prescription or medical advice.";

// GET /api/medications/types  (seizure types and the medicines listed for each)
router.get("/types", (req, res) => {
  res.json({ source: reference.source, disclaimer: DISCLAIMER, types: reference.types });
});

// GET /api/medications?type=absence  (reference medicines plus live openFDA label data)
router.get("/", async (req, res, next) => {
  try {
    const { type } = req.query;
    if (!type) throw httpError(400, "Query parameter 'type' is required");

    const entry = reference.types[type];
    if (!entry) throw httpError(404, `No medication reference for type "${type}"`);

    // One drug failing must not break the whole response, so use allSettled
    const settled = await Promise.allSettled(entry.medicines.map((m) => getDrugLabel(m)));

    const medicines = entry.medicines.map((name, i) =>
      settled[i].status === "fulfilled"
        ? { name, label: settled[i].value, error: null }
        : { name, label: null, error: settled[i].reason.message }
    );

    res.json({
      type,
      description: entry.description,
      source: reference.source,
      disclaimer: DISCLAIMER,
      labelSource: "openFDA (https://open.fda.gov)",
      medicines,
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
