// Generates SYNTHETIC seizure events. This is NOT real medical or EEG data.
// The numbers below are arbitrary simulation parameters, not clinical values.

const SEIZURE_TYPES = [
  "focal_aware",
  "focal_impaired_awareness",
  "generalized_tonic_clonic",
  "absence",
  "myoclonic",
];

// Per-type simulation settings: duration range (seconds), wave speed, wave size
const PROFILES = {
  absence:                  { durationSec: [5, 30],   speed: 0.9, amplitude: 70 },
  myoclonic:                { durationSec: [1, 10],   speed: 1.6, amplitude: 90 },
  generalized_tonic_clonic: { durationSec: [60, 180], speed: 2.4, amplitude: 120 },
  focal_aware:              { durationSec: [10, 60],  speed: 1.2, amplitude: 60 },
  focal_impaired_awareness: { durationSec: [30, 120], speed: 1.2, amplitude: 80 },
};

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function pick(list) {
  return list[randomInt(0, list.length - 1)];
}

// Background activity (gentle wave + noise) with an optional seizure burst
// that builds up and fades out in the middle of the recording.
function generateReadings(type, isSeizure, samples = 100) {
  const profile = PROFILES[type] || PROFILES.absence;
  const readings = [];
  for (let i = 0; i < samples; i++) {
    const background = Math.sin(i / 4) * 15 + (Math.random() - 0.5) * 10;
    let burst = 0;
    if (isSeizure) {
      const envelope = Math.sin((i / (samples - 1)) * Math.PI); // 0 -> 1 -> 0
      burst = Math.sin(i * profile.speed) * profile.amplitude * envelope;
    }
    readings.push(Math.round((background + burst) * 10) / 10);
  }
  return readings;
}

// options (all optional): { type, deviceId, startTime }
function generateSeizureEvent(patientId, options = {}) {
  const type = options.type && SEIZURE_TYPES.includes(options.type)
    ? options.type
    : pick(SEIZURE_TYPES);
  const profile = PROFILES[type];

  return {
    patientId,
    deviceId: options.deviceId || patientId.replace("PATIENT", "SIM-DEVICE"),
    type,
    startTime: options.startTime || new Date().toISOString(),
    durationSec: randomInt(...profile.durationSec),
    severity: randomInt(1, 5),
    readings: generateReadings(type, true),
    synthetic: true,
  };
}

module.exports = { generateSeizureEvent, generateReadings, SEIZURE_TYPES };
