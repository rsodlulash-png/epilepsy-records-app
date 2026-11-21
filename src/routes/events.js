const express = require("express");
const { events, patients, addEvent } = require("../services/store");
const { httpError } = require("../middleware/errorHandler");
const { generateSeizureEvent, SEIZURE_TYPES } = require("../../simulator/generator");

const router = express.Router();

// Returns an error message, or null if valid.
function validateEvent(e) {
  if (!e || typeof e !== "object") return "Request body must be a JSON object";
  if (typeof e.patientId !== "string" || !patients.some((p) => p.id === e.patientId))
    return "patientId is missing or does not match a known patient";
  if (!SEIZURE_TYPES.includes(e.type))
    return `type must be one of: ${SEIZURE_TYPES.join(", ")}`;
  if (!Number.isInteger(e.severity) || e.severity < 1 || e.severity > 5)
    return "severity must be an integer from 1 to 5";
  if (!Number.isInteger(e.durationSec) || e.durationSec < 1 || e.durationSec > 3600)
    return "durationSec must be an integer from 1 to 3600";
  if (typeof e.startTime !== "string" || Number.isNaN(Date.parse(e.startTime)))
    return "startTime must be a valid ISO date string";
  if (
    !Array.isArray(e.readings) ||
    e.readings.length > 1000 ||
    !e.readings.every((n) => typeof n === "number" && Number.isFinite(n))
  )
    return "readings must be an array of up to 1000 numbers";
  return null;
}

// GET /api/events?patientId=&type=&minSeverity=&sort=&order=&limit=
router.get("/", (req, res, next) => {
  try {
    const { patientId, type, minSeverity, sort = "startTime", order = "desc", limit } = req.query;

    if (type && !SEIZURE_TYPES.includes(type)) throw httpError(400, "Unknown seizure type");
    if (!["startTime", "severity", "durationSec"].includes(sort))
      throw httpError(400, "sort must be startTime, severity or durationSec");
    if (!["asc", "desc"].includes(order)) throw httpError(400, "order must be asc or desc");

    let result = events.filter(
      (e) =>
        (!patientId || e.patientId === patientId) &&
        (!type || e.type === type) &&
        (!minSeverity || e.severity >= Number(minSeverity))
    );

    const dir = order === "asc" ? 1 : -1;
    result.sort((a, b) => (a[sort] > b[sort] ? dir : a[sort] < b[sort] ? -dir : 0));

    const max = Number(limit);
    if (Number.isInteger(max) && max > 0) result = result.slice(0, max);

    res.json({ count: result.length, events: result });
  } catch (err) {
    next(err);
  }
});

// GET /api/events/:id
router.get("/:id", (req, res, next) => {
  const event = events.find((e) => e.id === Number(req.params.id));
  if (!event) return next(httpError(404, "Event not found"));
  res.json(event);
});

// POST /api/events  (the device or simulator sends events here)
router.post("/", (req, res, next) => {
  try {
    const problem = validateEvent(req.body);
    if (problem) throw httpError(400, problem);

    // Copy only known fields so unexpected data is never stored
    const { patientId, deviceId, type, startTime, durationSec, severity, readings } = req.body;
    const saved = addEvent({
      patientId,
      deviceId: typeof deviceId === "string" ? deviceId.slice(0, 50) : "UNKNOWN",
      type,
      startTime,
      durationSec,
      severity,
      readings,
      synthetic: true,
    });
    res.status(201).json(saved);
  } catch (err) {
    next(err);
  }
});

// POST /api/events/simulate  (a UI button triggers the simulator server-side)
// Optional body: { "patientId": "PATIENT-002" }
router.post("/simulate", (req, res, next) => {
  try {
    const requested = req.body && req.body.patientId;
    let patient;
    if (requested) {
      patient = patients.find((p) => p.id === requested);
      if (!patient) throw httpError(404, "Patient not found");
    } else {
      patient = patients[Math.floor(Math.random() * patients.length)];
    }
    res.status(201).json(addEvent(generateSeizureEvent(patient.id)));
  } catch (err) {
    next(err);
  }
});

module.exports = router;
