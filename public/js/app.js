"use strict";

/* ---------- Helpers ---------- */

const TYPE_LABELS = {
  focal_aware: "Focal aware",
  focal_impaired_awareness: "Focal impaired awareness",
  generalized_tonic_clonic: "Generalized tonic-clonic",
  absence: "Absence",
  myoclonic: "Myoclonic",
};
const typeLabel = (t) => TYPE_LABELS[t] || t;

const $ = (selector) => document.querySelector(selector);

// Builds an element safely: text goes in as text, never as HTML.
function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (key === "class") node.className = value;
    else if (key === "text") node.textContent = value;
    else if (key.startsWith("on")) node.addEventListener(key.slice(2), value);
    else if (value !== false && value != null) node.setAttribute(key, value === true ? "" : value);
  }
  for (const child of children.flat()) {
    if (child != null) node.append(child);
  }
  return node;
}

function svgEl(tag, attrs = {}, ...children) {
  const node = document.createElementNS("http://www.w3.org/2000/svg", tag);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
  for (const child of children) node.append(child);
  return node;
}

function formatDate(iso) {
  if (!iso) return "None yet";
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? "Unknown"
    : d.toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
}

function setStatus(selector, message, kind = "") {
  const node = $(selector);
  node.textContent = message;
  node.className = `status ${kind}`.trim();
}

// All server calls go through here so errors are handled in one place.
async function api(path, options = {}) {
  const { timeout = 15000, ...fetchOptions } = options;
  let res;
  try {
    res = await fetch(path, { ...fetchOptions, signal: AbortSignal.timeout(timeout) });
  } catch {
    throw new Error("Cannot reach the server. Check your connection and try again.");
  }

  const servedBy = res.headers.get("x-served-by");
  if (servedBy) $("#served-by").textContent = servedBy;

  let body = null;
  try {
    body = await res.json();
  } catch {
    /* not JSON */
  }
  if (!res.ok) throw new Error((body && body.error) || `Request failed (HTTP ${res.status})`);
  if (body === null) throw new Error("The server sent an unreadable response.");
  return body;
}

/* ---------- State ---------- */

const state = { patientId: null, eventId: null, events: [] };
let patientsRequest = 0; // lets us ignore out-of-date responses
let detailRequest = 0;
let medsRequest = 0;

/* ---------- Patients list ---------- */

async function loadPatients() {
  const myRequest = ++patientsRequest;
  const params = new URLSearchParams();
  const q = $("#search").value.trim();
  if (q) params.set("q", q);
  if ($("#type-filter").value) params.set("type", $("#type-filter").value);
  params.set("sort", $("#sort").value);
  params.set("order", $("#order").value);

  $("#retry").hidden = true;
  setStatus("#patients-status", "Loading patients...");

  try {
    const data = await api(`/api/patients?${params}`);
    if (myRequest !== patientsRequest) return;
    renderPatients(data.patients);
    setStatus(
      "#patients-status",
      data.count === 0
        ? "No patients match your search or filter."
        : `${data.count} patient${data.count === 1 ? "" : "s"} shown`
    );
  } catch (err) {
    if (myRequest !== patientsRequest) return;
    $("#patients-body").replaceChildren();
    setStatus("#patients-status", err.message, "error");
    $("#retry").hidden = false;
  }
}

function renderPatients(patients) {
  const rows = patients.map((p) =>
    el(
      "tr",
      { "data-patient-id": p.id, "aria-selected": String(p.id === state.patientId) },
      el("td", {}, el("button", { class: "link-btn", type: "button", onclick: () => selectPatient(p.id), text: p.name }),
        el("div", { class: "muted small", text: p.id })),
      el("td", { text: String(p.age) }),
      el("td", {}, el("span", { class: "badge", text: typeLabel(p.epilepsyType) })),
      el("td", { text: String(p.seizureCount) }),
      el("td", { text: formatDate(p.lastSeizure) })
    )
  );
  $("#patients-body").replaceChildren(...rows);
}

function markSelectedPatientRow() {
  document.querySelectorAll("#patients-body tr").forEach((row) => {
    row.setAttribute("aria-selected", String(row.dataset.patientId === state.patientId));
  });
}

/* ---------- Patient detail ---------- */

async function selectPatient(id) {
  state.patientId = id;
  state.eventId = null;
  markSelectedPatientRow();

  const myRequest = ++detailRequest;
  $("#detail-empty").hidden = true;
  setStatus("#detail-status", "Loading patient...");

  try {
    const patient = await api(`/api/patients/${encodeURIComponent(id)}`);
    if (myRequest !== detailRequest) return;
    state.events = patient.events;
    renderDetail(patient);
    setStatus("#detail-status", "");
    loadMedications(patient.epilepsyType);
  } catch (err) {
    if (myRequest !== detailRequest) return;
    $("#detail").hidden = true;
    setStatus("#detail-status", err.message, "error");
  }
}

function renderDetail(patient) {
  $("#detail").hidden = false;
  $("#detail-title").textContent = patient.name;
  $("#detail-meta").textContent =
    `${patient.id} | Age ${patient.age} | ${typeLabel(patient.epilepsyType)} | ` +
    `Device ${patient.deviceId} | ${patient.seizureCount} seizure${patient.seizureCount === 1 ? "" : "s"} | ` +
    `Last: ${formatDate(patient.lastSeizure)}`;

  renderTimeline(patient.events);
  renderHistory(patient.events);
  selectEvent(patient.events.length ? patient.events[0].id : null); // newest first
}

function renderTimeline(events) {
  const box = $("#timeline");
  if (events.length === 0) {
    box.replaceChildren(el("p", { class: "muted", text: "No seizures recorded yet. Use \"Simulate seizure\" to add one." }));
    return;
  }

  const recent = events.slice(0, 20).reverse(); // oldest to newest, left to right
  const W = 600, H = 130, pad = 8;
  const slot = (W - pad * 2) / recent.length;
  const barW = Math.min(slot * 0.7, 36);

  const bars = recent.map((ev, i) => {
    const h = ev.severity * 20;
    const rect = svgEl("rect", {
      class: `bar sev-${ev.severity}`,
      "data-event-id": ev.id,
      x: pad + i * slot + (slot - barW) / 2,
      y: H - pad - h,
      width: barW,
      height: h,
      rx: 3,
      tabindex: 0,
      role: "button",
      "aria-label": `Seizure ${ev.id}, ${typeLabel(ev.type)}, severity ${ev.severity}, ${formatDate(ev.startTime)}`,
    });
    rect.append(svgEl("title", {}, document.createTextNode(`${typeLabel(ev.type)} | severity ${ev.severity} | ${formatDate(ev.startTime)}`)));
    rect.addEventListener("click", () => selectEvent(ev.id));
    rect.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); selectEvent(ev.id); }
    });
    return rect;
  });

  box.replaceChildren(
    svgEl("svg", { class: "chart", viewBox: `0 0 ${W} ${H}`, role: "group", "aria-label": "Seizure timeline" }, ...bars)
  );
  markSelectedEvent();
}

function renderHistory(events) {
  const body = $("#history-body");
  if (events.length === 0) {
    body.replaceChildren(el("tr", {}, el("td", { colspan: "5", class: "muted", text: "No seizures recorded." })));
    return;
  }
  body.replaceChildren(
    ...events.map((ev) =>
      el(
        "tr",
        { "data-event-id": ev.id },
        el("td", { text: formatDate(ev.startTime) }),
        el("td", { text: typeLabel(ev.type) }),
        el("td", { text: `${ev.durationSec}s` }),
        el("td", {}, el("span", { class: `sev sev-${ev.severity}`, text: String(ev.severity) })),
        el("td", {}, el("button", { class: "btn secondary small-btn", type: "button", onclick: () => selectEvent(ev.id), text: "View trace" }))
      )
    )
  );
  markSelectedEvent();
}

function selectEvent(eventId) {
  state.eventId = eventId;
  markSelectedEvent();
  renderTrace(state.events.find((e) => e.id === eventId));
}

function markSelectedEvent() {
  document.querySelectorAll("[data-event-id]").forEach((node) => {
    node.classList.toggle("selected", Number(node.dataset.eventId) === state.eventId);
  });
}

function renderTrace(event) {
  const box = $("#trace");
  const caption = $("#trace-caption");

  if (!event) {
    caption.textContent = "";
    box.replaceChildren(el("p", { class: "muted", text: "Select a seizure to view its simulated brain-activity trace." }));
    return;
  }

  caption.textContent = `Event #${event.id}: ${typeLabel(event.type)}, ${event.durationSec}s, severity ${event.severity} (simulated data)`;

  const r = event.readings;
  if (!Array.isArray(r) || r.length < 2) {
    box.replaceChildren(el("p", { class: "muted", text: "No readings were recorded for this event." }));
    return;
  }

  const W = 600, H = 160, pad = 10;
  const min = Math.min(...r), max = Math.max(...r);
  const y = (v) => H - pad - ((v - min) / (max - min || 1)) * (H - pad * 2);
  const points = r.map((v, i) => `${((i / (r.length - 1)) * W).toFixed(1)},${y(v).toFixed(1)}`).join(" ");

  const parts = [];
  if (min < 0 && max > 0) {
    parts.push(svgEl("line", { class: "zero-line", x1: 0, x2: W, y1: y(0), y2: y(0) }));
  }
  parts.push(svgEl("polyline", { class: "trace-line", points }));

  box.replaceChildren(
    svgEl("svg", { class: "chart", viewBox: `0 0 ${W} ${H}`, role: "img", "aria-label": "Simulated brain activity trace" }, ...parts)
  );
}

/* ---------- Medications (openFDA) ---------- */

async function loadMedications(type) {
  const box = $("#meds");
  const myRequest = ++medsRequest;
  box.replaceChildren(el("p", { class: "muted", text: "Loading medication label data from openFDA..." }));

  try {
    const data = await api(`/api/medications?type=${encodeURIComponent(type)}`, { timeout: 25000 });
    if (myRequest !== medsRequest) return;
    renderMedications(data);
  } catch (err) {
    if (myRequest !== medsRequest) return;
    box.replaceChildren(
      el("p", { class: "status error", text: err.message }),
      el("button", { class: "btn secondary", type: "button", onclick: () => loadMedications(type), text: "Retry" })
    );
  }
}

function labelSection(title, text, extraClass = "") {
  if (!text) return null;
  return el("section", {}, el("h5", { text: title }), el("p", { class: extraClass, text }));
}

function renderMedications(data) {
  const items = data.medicines.map((m) => {
    if (m.error || !m.label) {
      return el(
        "details",
        {},
        el("summary", { text: m.name }),
        el("p", { class: "med-error", text: `Label data unavailable: ${m.error || "unknown error"}` })
      );
    }
    const l = m.label;
    return el(
      "details",
      {},
      el("summary", { text: l.brandName ? `${m.name} (${l.brandName})` : m.name }),
      labelSection("Boxed warning", l.boxedWarning, "label-warning"),
      labelSection("Indications and usage", l.indications),
      labelSection("Warnings", l.warnings),
      labelSection("Adverse reactions", l.adverseReactions)
    );
  });

  $("#meds").replaceChildren(
    el("p", { class: "disclaimer", text: data.disclaimer }),
    el("p", { class: "muted small", text: `${data.description}. Reference list source: ${data.source}. Label text: ${data.labelSource}.` }),
    ...items
  );
}

/* ---------- Simulate a seizure ---------- */

async function simulate(patientId) {
  const buttons = [$("#simulate-random"), $("#simulate-patient")];
  buttons.forEach((b) => (b.disabled = true));
  setStatus("#patients-status", "Sending simulated device event...");

  try {
    const event = await api("/api/events/simulate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patientId ? { patientId } : {}),
    });
    await loadPatients();
    await selectPatient(event.patientId);
    setStatus(
      "#patients-status",
      `Simulated ${typeLabel(event.type)} seizure for ${event.patientId} (severity ${event.severity}).`,
      "success"
    );
  } catch (err) {
    setStatus("#patients-status", `Could not simulate a seizure: ${err.message}`, "error");
  } finally {
    buttons.forEach((b) => (b.disabled = false));
  }
}

/* ---------- Wiring ---------- */

let searchTimer;
$("#search").addEventListener("input", () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(loadPatients, 250); // wait until typing pauses
});
["#type-filter", "#sort", "#order"].forEach((s) => $(s).addEventListener("change", loadPatients));
$("#filters").addEventListener("submit", (e) => e.preventDefault());
$("#reset").addEventListener("click", () => {
  $("#filters").reset();
  loadPatients();
});
$("#retry").addEventListener("click", loadPatients);
$("#simulate-random").addEventListener("click", () => simulate(null));
$("#simulate-patient").addEventListener("click", () => simulate(state.patientId));

loadPatients();
