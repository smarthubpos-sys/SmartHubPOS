// SmartHub POS - fingerprint machine bridge (ZKTeco and compatible machines).
// Every POLL_SECONDS it reads the new touches from the machine over the local network and sends them to SmartHub.
// Run it on any always-on computer in the same network as the machine:   node bridge.mjs
import fs from "node:fs";
import { createRequire } from "node:module";
import { buildPunches, chunk, parseOffset } from "./lib.mjs";

const require = createRequire(import.meta.url);
const env = (name, fallback) => process.env[name] ?? fallback;
const need = (name) => { const v = process.env[name]; if (!v) { console.error(`Missing setting ${name}. See README.`); process.exit(1); } return v; };

const MACHINE_IP = need("MACHINE_IP");
const MACHINE_PORT = Number(env("MACHINE_PORT", "4370"));
const ENDPOINT = need("SMARTHUB_ENDPOINT").replace(/\/+$/, ""); // e.g. https://your-name-123.convex.site
const KEY = need("SMARTHUB_DEVICE_KEY"); // shown once in SmartHub > Payroll > Attendance > Fingerprint machines
const POLL_MS = Math.max(10, Number(env("POLL_SECONDS", "30"))) * 1000;
const OFFSET = parseOffset(env("MACHINE_UTC_OFFSET", "+03:00")); // the time zone the machine's clock is set to (East Africa = +03:00)
const PREFIX = env("CODE_PREFIX", ""); // machine user "12" + CODE_PREFIX "E" -> employee code "E12"
const BACKFILL_DAYS = Number(env("BACKFILL_DAYS", "2")); // on the first run only look this far back
const STATE_FILE = env("STATE_FILE", new URL("./state.json", import.meta.url).pathname);

const log = (...a) => console.log(new Date().toISOString(), ...a);
const readState = () => { try { return JSON.parse(fs.readFileSync(STATE_FILE, "utf8")); } catch { return {}; } };
const writeState = (s) => fs.writeFileSync(STATE_FILE, JSON.stringify(s));

async function readMachine() {
  const ZKLib = require("node-zklib");
  const zk = new ZKLib(MACHINE_IP, MACHINE_PORT, 10000, 4000);
  try {
    await zk.createSocket();
    const { data } = await zk.getAttendances();
    return data ?? [];
  } finally {
    try { await zk.disconnect(); } catch { /* already closed */ }
  }
}

async function send(punches) {
  const res = await fetch(`${ENDPOINT}/attendance/punches`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${KEY}` }, body: JSON.stringify({ punches }) });
  if (res.status === 401) throw new Error("SmartHub refused the key (401). Check SMARTHUB_DEVICE_KEY, and that the machine is switched on in SmartHub.");
  if (!res.ok) throw new Error(`SmartHub answered ${res.status}: ${await res.text()}`);
  return (await res.json()).results ?? [];
}

async function round() {
  const state = readState();
  const since = state.lastSent ?? Date.now() - BACKFILL_DAYS * 86_400_000;
  const punches = buildPunches(await readMachine(), { offsetMinutes: OFFSET, prefix: PREFIX, since });
  if (punches.length === 0) return;
  let lastSent = since;
  // lastSent moves forward only after SmartHub has answered for a whole batch, so a failure never loses a touch (a resend is harmless: the server ignores repeats).
  for (const part of chunk(punches, 100)) {
    const results = await send(part);
    for (const r of results) if (r.status !== "in" && r.status !== "out" && r.status !== "already_received") log(`  ${r.code} ${new Date(r.at).toISOString()} -> ${r.status}${r.message ? `: ${r.message}` : ""}`);
    lastSent = part[part.length - 1].at;
    writeState({ lastSent });
  }
  log(`sent ${punches.length} touch(es)`);
}

log(`SmartHub bridge started: machine ${MACHINE_IP}:${MACHINE_PORT}, every ${POLL_MS / 1000}s`);
for (;;) {
  try { await round(); } catch (e) { log("problem:", e instanceof Error ? e.message : e); }
  await new Promise((r) => setTimeout(r, POLL_MS));
}
