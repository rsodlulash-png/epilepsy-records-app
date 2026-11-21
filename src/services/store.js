// Loads synthetic data once at startup.
// NOTE: events added at runtime live only in this server's memory.
// Behind a load balancer, Web01 and Web02 each keep their own copy (see README).
const patients = require("../data/patients.json");
const seedEvents = require("../data/events.seed.json");

const events = seedEvents.map((e, i) => ({ id: i + 1, ...e }));
let nextId = events.length + 1;

function addEvent(event) {
  const saved = { ...event, id: nextId++, receivedAt: new Date().toISOString() };
  events.push(saved);
  return saved;
}

module.exports = { patients, events, addEvent };
