const express = require("express");
const { patients, events } = require("../services/store");
const { httpError } = require("../middleware/errorHandler");
const { SEIZURE_TYPES } = require("../../simulator/generator");

const router = express.Router();

// Adds seizure count and last seizure date to a patient
function withStats(patient) {
  const mine = events.filter((e) => e.patientId === patient.id);
  const lastSeizure = mine.reduce(
    (latest, e) => (!latest || e.startTime > latest ? e.startTime : latest),
    null
  );
  return { ...patient, seizureCount: mine.length, lastSeizure };
}

// GET /api/patients?q=&type=&sort=&order=
router.get("/", (req, res, next) => {
  try {
    const { q, type, sort = "name", order = "asc" } = req.query;

    if (type && !SEIZURE_TYPES.includes(type)) throw httpError(400, "Unknown epilepsy type");
    if (!["name", "seizureCount", "lastSeizure"].includes(sort))
      throw httpError(400, "sort must be name, seizureCount or lastSeizure");
    if (!["asc", "desc"].includes(order)) throw httpError(400, "order must be asc or desc");

    const needle = q ? String(q).trim().toLowerCase() : "";
    let result = patients
      .filter(
        (p) =>
          (!needle ||
            p.name.toLowerCase().includes(needle) ||
            p.id.toLowerCase().includes(needle)) &&
          (!type || p.epilepsyType === type)
      )
      .map(withStats);

    const dir = order === "asc" ? 1 : -1;
    result.sort((a, b) => {
      const x = a[sort];
      const y = b[sort];
      if (x === y) return 0;
      if (x === null) return 1;   // patients with no seizures always go last
      if (y === null) return -1;
      return (x > y ? 1 : -1) * dir;
    });

    res.json({ count: result.length, patients: result });
  } catch (err) {
    next(err);
  }
});

// GET /api/patients/:id  (patient plus full seizure history, newest first)
router.get("/:id", (req, res, next) => {
  const patient = patients.find((p) => p.id === req.params.id);
  if (!patient) return next(httpError(404, "Patient not found"));

  const history = events
    .filter((e) => e.patientId === patient.id)
    .sort((a, b) => (a.startTime < b.startTime ? 1 : -1));

  res.json({ ...withStats(patient), events: history });
});

module.exports = router;
