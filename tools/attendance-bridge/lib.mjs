// Pure helpers of the bridge (no network, no machine), so they can be checked on their own.

/** "+03:00" -> 180 (minutes east of UTC). */
export function parseOffset(text) {
  const m = /^([+-])(\d\d):?(\d\d)$/.exec(String(text ?? "").trim());
  if (!m) throw new Error(`MACHINE_UTC_OFFSET must look like +03:00 (got "${text}")`);
  return (m[1] === "-" ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3]));
}

/**
 * A ZKTeco machine stores the WALL-CLOCK time on its screen, with no time zone. The library hands it back as a Date built in the
 * time zone of THIS computer, so we read the wall-clock parts back out of it (whatever zone this computer is in) and apply the
 * machine's real offset. Result: the true moment of the touch, in epoch milliseconds.
 */
export function wallClockToEpoch(date, offsetMinutes) {
  const asUtc = Date.UTC(date.getFullYear(), date.getMonth(), date.getDate(), date.getHours(), date.getMinutes(), date.getSeconds());
  return asUtc - offsetMinutes * 60_000;
}

/** Records from the machine -> punches for the server, oldest first, only the ones after `since` (epoch ms). */
export function buildPunches(records, { offsetMinutes, prefix = "", since = 0 }) {
  const out = [];
  for (const r of records) {
    const id = String(r.deviceUserId ?? "").trim();
    const when = r.recordTime instanceof Date ? r.recordTime : new Date(r.recordTime);
    if (!id || Number.isNaN(when.getTime())) continue;
    const at = wallClockToEpoch(when, offsetMinutes);
    if (at <= since) continue;
    out.push({ code: `${prefix}${id}`, at });
  }
  return out.sort((a, b) => a.at - b.at);
}

export function chunk(list, size) {
  const out = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}
