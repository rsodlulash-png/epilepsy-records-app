// Device simulator: pretends to be the head-worn seizure tracker.
// It sends synthetic seizure events to the app over HTTP, exactly as the real
// device would. Run `npm run simulate -- --help` for options.

const { generateSeizureEvent, SEIZURE_TYPES } = require("./generator");

const FALLBACK_PATIENTS = [
  { id: "PATIENT-001", deviceId: "SIM-DEVICE-001" },
  { id: "PATIENT-002", deviceId: "SIM-DEVICE-002" },
  { id: "PATIENT-003", deviceId: "SIM-DEVICE-003" },
  { id: "PATIENT-004", deviceId: "SIM-DEVICE-004" },
];

const HELP = `
Device simulator - sends synthetic seizure events to the Epilepsy Records App.

Usage: npm run simulate -- [options]

Options:
  --api <url>        App address (default: http://localhost:3000, or $API_URL)
  --patient <id>     Send only for this patient, e.g. PATIENT-002 (default: random)
  --type <type>      Seizure type: ${SEIZURE_TYPES.join(", ")}
  --interval <sec>   Seconds between events (default: 5)
  --count <n>        Stop after n events (default: 0 = run until Ctrl+C)
  --help             Show this message
`;

function fail(message) {
  console.error(`Error: ${message}\nRun with --help for usage.`);
  process.exit(1);
}

function parseArgs(argv) {
  const opts = {
    api: process.env.API_URL || "http://localhost:3000",
    patient: null,
    type: null,
    interval: 5,
    count: 0,
  };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    const value = argv[i + 1];
    switch (flag) {
      case "--help":
      case "-h":
        console.log(HELP);
        process.exit(0);
      case "--api":      opts.api = value; i++; break;
      case "--patient":  opts.patient = value; i++; break;
      case "--type":     opts.type = value; i++; break;
      case "--interval": opts.interval = Number(value); i++; break;
      case "--count":    opts.count = Number(value); i++; break;
      default:           fail(`Unknown option "${flag}"`);
    }
  }
  if (!opts.api) fail("--api needs a value");
  opts.api = opts.api.replace(/\/+$/, ""); // drop trailing slash
  if (opts.type && !SEIZURE_TYPES.includes(opts.type)) fail(`--type must be one of: ${SEIZURE_TYPES.join(", ")}`);
  if (!Number.isFinite(opts.interval) || opts.interval < 1) fail("--interval must be a number of 1 or more");
  if (!Number.isInteger(opts.count) || opts.count < 0) fail("--count must be a whole number, 0 or more");
  return opts;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Ask the app which patients exist; fall back to a built-in list if unreachable
async function loadPatients(api) {
  try {
    const res = await fetch(`${api}/api/patients`, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = await res.json();
    if (!Array.isArray(body.patients) || body.patients.length === 0) throw new Error("no patients returned");
    return body.patients;
  } catch (err) {
    console.warn(`[WARN] Could not load patients from ${api} (${err.message}). Using built-in list.`);
    return FALLBACK_PATIENTS;
  }
}

async function sendEvent(opts, patient) {
  const event = generateSeizureEvent(patient.id, { type: opts.type, deviceId: patient.deviceId });
  const res = await fetch(`${opts.api}/api/events`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(event),
    signal: AbortSignal.timeout(5000),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
  return { event, saved: body, servedBy: res.headers.get("x-served-by") || "unknown" };
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const patients = await loadPatients(opts.api);

  let patientPool = patients;
  if (opts.patient) {
    patientPool = patients.filter((p) => p.id === opts.patient);
    if (patientPool.length === 0) fail(`Unknown patient "${opts.patient}". Known: ${patients.map((p) => p.id).join(", ")}`);
  }

  const stats = { sent: 0, failed: 0 };
  const showSummary = () => {
    console.log(`\nStopped. Sent: ${stats.sent}, failed: ${stats.failed}`);
    process.exit(0);
  };
  process.on("SIGINT", showSummary);

  console.log(`Device simulator started -> ${opts.api}`);
  console.log(`Every ${opts.interval}s${opts.count ? `, ${opts.count} events` : ""}. Press Ctrl+C to stop.\n`);

  for (let n = 1; opts.count === 0 || n <= opts.count; n++) {
    const patient = patientPool[Math.floor(Math.random() * patientPool.length)];
    try {
      const { event, saved, servedBy } = await sendEvent(opts, patient);
      stats.sent++;
      console.log(
        `[OK]     #${saved.id} ${event.patientId} ${event.type.padEnd(24)} ` +
        `${String(event.durationSec).padStart(3)}s  severity ${event.severity}  served-by=${servedBy}`
      );
    } catch (err) {
      stats.failed++;
      console.error(`[FAILED] ${patient.id}: ${err.message}`);
    }
    if (opts.count === 0 || n < opts.count) await sleep(opts.interval * 1000);
  }
  showSummary();
}

main();
