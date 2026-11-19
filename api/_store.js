// Tiny per-doctor memory for the WhatsApp bot (where each doctor is in the chat, and the details they typed).
// Uses Upstash Redis over REST. Connect it in Vercel: Storage → Upstash (Redis) → connect to this project,
// which adds KV_REST_API_URL and KV_REST_API_TOKEN (or UPSTASH_REDIS_REST_URL / _TOKEN) automatically.
// Without it the bot still works, but skips the typed questions (name, practice, speciality, challenge).
// RS_STORE=memory keeps state in this process only (tests and local runs).

const TTL = 14 * 24 * 60 * 60; // forget an unfinished chat after 14 days
const mem = new Map();

const url = () => process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || "";
const token = () => process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || "";
const useMemory = () => process.env.RS_STORE === "memory";

const enabled = () => useMemory() || Boolean(url() && token());

async function cmd(args) {
  const r = await fetch(url(), {
    method: "POST",
    headers: { Authorization: `Bearer ${token()}`, "Content-Type": "application/json" },
    body: JSON.stringify(args),
  });
  const j = await r.json();
  if (j.error) throw new Error("Upstash: " + j.error);
  return j.result;
}

async function get(key) {
  if (useMemory()) return mem.has(key) ? JSON.parse(mem.get(key)) : null;
  if (!enabled()) return null;
  try { const v = await cmd(["GET", key]); return v ? JSON.parse(v) : null; } catch (e) { console.error(e.message); return null; }
}

async function set(key, value) {
  if (useMemory()) { mem.set(key, JSON.stringify(value)); return; }
  if (!enabled()) return;
  try { await cmd(["SET", key, JSON.stringify(value), "EX", String(TTL)]); } catch (e) { console.error(e.message); }
}

async function del(key) {
  if (useMemory()) { mem.delete(key); return; }
  if (!enabled()) return;
  try { await cmd(["DEL", key]); } catch (e) { console.error(e.message); }
}

module.exports = { enabled, get, set, del };
