// API del sistema de reservas de gabinete.
// Una sola Netlify Function (v2) que atiende /api/*. Datos en Netlify Blobs.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

/* ------------------------------------------------------------------ */
/* Almacenamiento: Netlify Blobs en producción, archivos JSON en local */
/* ------------------------------------------------------------------ */
let _store;
async function store() {
  if (_store) return _store;
  const localDir = process.env.LOCAL_DATA_DIR;
  if (localDir) {
    fs.mkdirSync(localDir, { recursive: true });
    const file = (k) => path.join(localDir, encodeURIComponent(k) + ".json");
    _store = {
      async get(k) {
        try { return JSON.parse(fs.readFileSync(file(k), "utf8")); } catch { return null; }
      },
      async set(k, v) { fs.writeFileSync(file(k), JSON.stringify(v, null, 1)); },
      async del(k) { try { fs.unlinkSync(file(k)); } catch {} },
      async keys(prefix) {
        return fs.readdirSync(localDir).map((f) => decodeURIComponent(f.replace(/\.json$/, ""))).filter((k) => k.startsWith(prefix));
      },
      async update(k, fn) {
        const cur = await this.get(k);
        const next = await fn(cur);
        if (next !== undefined) await this.set(k, next);
        return next;
      },
    };
    return _store;
  }
  const { getStore } = await import("@netlify/blobs");
  const s = getStore({ name: "gabinete", consistency: "strong" });
  _store = {
    get: (k) => s.get(k, { type: "json" }),
    set: (k, v) => s.setJSON(k, v),
    del: (k) => s.delete(k),
    async keys(prefix) {
      const { blobs } = await s.list({ prefix });
      return blobs.map((b) => b.key);
    },
    // Lectura-modificación-escritura con control de concurrencia (ETag).
    async update(k, fn) {
      for (let i = 0; i < 6; i++) {
        const cur = await s.getWithMetadata(k, { type: "json" });
        const next = await fn(cur ? cur.data : null);
        if (next === undefined) return undefined;
        const opts = cur ? { onlyIfMatch: cur.etag } : { onlyIfNew: true };
        const res = await s.setJSON(k, next, opts);
        if (!res || res.modified !== false) return next;
        await new Promise((r) => setTimeout(r, 60 + Math.random() * 120));
      }
      throw httpError(409, "El sistema está ocupado, intentá de nuevo.");
    },
  };
  return _store;
}

/* ------------------------------ Utilidades ------------------------------ */
const TZ = "-03:00"; // Argentina (sin horario de verano)
function httpError(status, message) { const e = new Error(message); e.status = status; return e; }
const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
const uid = (n = 8) => crypto.randomBytes(n).toString("base64url").replace(/[-_]/g, "").slice(0, n).toUpperCase();
const clean = (v, max = 200) => String(v ?? "").trim().slice(0, max);
const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s);
const isTime = (s) => /^([01]\d|2[0-3]):[0-5]\d$/.test(s);
const toMin = (t) => +t.slice(0, 2) * 60 + +t.slice(3, 5);
const normPhone = (p) => String(p || "").replace(/\D/g, "").slice(-10);
const normDni = (d) => String(d || "").replace(/\D/g, "").replace(/^0+/, "");
const dniOk = (d) => /^\d{7,8}$/.test(d);
const instant = (date, time) => new Date(`${date}T${time}:00${TZ}`);
function todayAR() {
  return new Date(Date.now() - 3 * 3600e3).toISOString().slice(0, 10);
}
function addDays(date, n) {
  const d = new Date(date + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10);
}

/* ------------------------------ Datos base ------------------------------ */
const DEFAULT_SETTINGS = {
  schoolName: "ENS Justo José de Urquiza",
  notice: "Reservá los recursos con al menos 24 horas de anticipación. Las reservas de laboratorio pueden variar según la disponibilidad de materiales.",
  minHoursAdvance: 24,
  maxDaysAhead: 60,
  dayStart: "07:00",
  dayEnd: "23:00",
  weekdays: [1, 2, 3, 4, 5],
  modules: [
    { label: "1ª hora", start: "07:30", end: "08:10" },
    { label: "2ª hora", start: "08:10", end: "08:50" },
    { label: "3ª hora", start: "09:00", end: "09:40" },
    { label: "4ª hora", start: "09:40", end: "10:20" },
    { label: "5ª hora", start: "10:30", end: "11:10" },
    { label: "6ª hora", start: "11:10", end: "11:50" },
    { label: "7ª hora", start: "11:55", end: "12:35" },
  ],
};
const DEFAULT_RESOURCES = [
  { name: "Televisor", category: "Tecnología", icon: "📺", location: "Gabinete – planta baja", quantity: 2 },
  { name: "Proyector", category: "Tecnología", icon: "📽️", location: "Gabinete – planta baja", quantity: 2 },
  { name: "Notebook", category: "Tecnología", icon: "💻", location: "Gabinete – planta baja", quantity: 10 },
  { name: "Parlante / equipo de sonido", category: "Tecnología", icon: "🔊", location: "Gabinete – planta baja", quantity: 1 },
  { name: "Sala de informática", category: "Espacios", icon: "🖥️", location: "", quantity: 1, requiresReport: true, machines: 30 },
  { name: "Laboratorio de Ciencias", category: "Espacios", icon: "🧪", location: "Planta alta", quantity: 1, notes: "Sujeto a disponibilidad de materiales." },
  { name: "Instrumentos musicales", category: "Música", icon: "🎸", location: "Sala de música", quantity: 1 },
];

// Migraciones de datos ya guardados (se aplican una sola vez por instalación)
let _migrated = false;
async function migrate() {
  if (_migrated) return;
  const st = await store();
  const done = (await st.get("migrations")) || [];
  if (!done.includes("v2-informatica-horario")) {
    const res = await st.get("resources");
    if (res && !res.some((x) => /inform[aá]tica/i.test(x.name))) {
      await st.update("resources", (list) => [...(list || []), { id: uid(6), active: true, notes: "", ...DEFAULT_RESOURCES.find((x) => x.name === "Sala de informática") }]);
    }
    const set = await st.get("settings");
    if (set) await st.set("settings", { ...set, dayStart: "07:00", dayEnd: "23:00" });
    done.push("v2-informatica-horario");
    await st.set("migrations", done);
  }
  if (!done.includes("v3-reporte-informatica")) {
    const res = await st.get("resources");
    if (res) await st.update("resources", (list) => (list || []).map((x) => (/inform[aá]tica/i.test(x.name) && x.requiresReport === undefined ? { ...x, requiresReport: true, machines: x.machines || 30 } : x)));
    done.push("v3-reporte-informatica");
    await st.set("migrations", done);
  }
  _migrated = true;
}

async function getSettings() {
  await migrate();
  const s = await (await store()).get("settings");
  const out = { ...DEFAULT_SETTINGS, ...(s || {}) };
  if (out.schoolName === "Gabinete de Recursos") out.schoolName = DEFAULT_SETTINGS.schoolName;
  return out;
}
async function getResources() {
  await migrate();
  const st = await store();
  let r = await st.get("resources");
  if (!r) {
    r = DEFAULT_RESOURCES.map((x) => ({ id: uid(6), active: true, notes: "", ...x }));
    await st.set("resources", r);
  }
  return r;
}

/* -------------------------------- Auth -------------------------------- */
const SECRET = () => process.env.AUTH_SECRET || process.env.IT_PASSWORD || "cambiar-este-secreto";
function hashPwd(pwd, salt = crypto.randomBytes(16).toString("hex")) {
  return { salt, hash: crypto.scryptSync(String(pwd), salt, 32).toString("hex") };
}
function checkPwd(pwd, u) {
  const h = crypto.scryptSync(String(pwd), u.salt, 32);
  return crypto.timingSafeEqual(h, Buffer.from(u.hash, "hex"));
}
function sign(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = crypto.createHmac("sha256", SECRET()).update(body).digest("base64url");
  return body + "." + sig;
}
function verify(token) {
  if (!token || !token.includes(".")) return null;
  const [body, sig] = token.split(".");
  const exp = crypto.createHmac("sha256", SECRET()).update(body).digest("base64url");
  if (sig.length !== exp.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(exp))) return null;
  const p = JSON.parse(Buffer.from(body, "base64url").toString());
  return p.exp > Date.now() ? p : null;
}
async function getUsers() { return (await (await store()).get("users")) || []; }
async function auth(req, roles = ["admin", "it"]) {
  const t = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  const p = verify(t);
  if (!p) throw httpError(401, "Sesión vencida. Volvé a ingresar.");
  if (!p.env) {
    const u = (await getUsers()).find((x) => x.username === p.u);
    if (!u || u.disabled) throw httpError(401, "Usuario deshabilitado.");
    p.r = u.role;
  }
  if (!roles.includes(p.r)) throw httpError(403, "No tenés permiso para esta acción.");
  return p;
}

/* ----------------------------- Reservas ----------------------------- */
const ACTIVE = (r) => r.status !== "cancelada";
function overlap(a, b) { return toMin(a.start) < toMin(b.end) && toMin(b.start) < toMin(a.end); }

function validateReservation(input, settings, resources, { admin = false } = {}) {
  const r = {
    date: clean(input.date, 10),
    start: clean(input.start, 5),
    end: clean(input.end, 5),
    teacher: clean(input.teacher, 80),
    phone: clean(input.phone, 30),
    dni: normDni(input.dni),
    course: clean(input.course, 60),
    place: clean(input.place, 80),
    floor: clean(input.floor, 20),
    comment: clean(input.comment, 500),
    items: Array.isArray(input.items) ? input.items : [],
  };
  if (!isDate(r.date)) throw httpError(400, "Elegí una fecha válida.");
  if (!isTime(r.start) || !isTime(r.end)) throw httpError(400, "Elegí un horario válido.");
  if (toMin(r.end) <= toMin(r.start)) throw httpError(400, "La hora de fin debe ser posterior a la de inicio.");
  if (!r.teacher) throw httpError(400, "Completá tu nombre.");
  if (!admin && !dniOk(r.dni)) throw httpError(400, "Completá tu DNI (solo números, sin puntos).");
  if (admin && r.dni && !dniOk(r.dni)) throw httpError(400, "DNI inválido (7 u 8 números, sin puntos).");
  if (!admin && normPhone(r.phone).length < 6) throw httpError(400, "Completá un teléfono válido.");
  if (!r.course) throw httpError(400, "Completá curso y nivel.");
  const merged = new Map();
  for (const it of r.items) {
    const res = resources.find((x) => x.id === it.resourceId && x.active !== false);
    if (!res) throw httpError(400, "Uno de los recursos ya no está disponible.");
    const q = Math.max(1, Math.min(+it.qty || 1, res.quantity || 1));
    merged.set(res.id, (merged.get(res.id) || 0) + q);
  }
  if (!merged.size) throw httpError(400, "Elegí al menos un recurso.");
  r.items = [...merged].map(([resourceId, qty]) => ({ resourceId, qty }));

  if (!admin) {
    const wd = new Date(r.date + "T12:00:00Z").getUTCDay();
    if (settings.weekdays?.length && !settings.weekdays.includes(wd)) throw httpError(400, "Ese día no se pueden hacer reservas.");
    if (toMin(r.start) < toMin(settings.dayStart) || toMin(r.end) > toMin(settings.dayEnd))
      throw httpError(400, `El horario de reservas es de ${settings.dayStart} a ${settings.dayEnd}.`);
    const hours = (instant(r.date, r.start) - Date.now()) / 3600e3;
    if (hours < settings.minHoursAdvance)
      throw httpError(400, `Las reservas se hacen con al menos ${settings.minHoursAdvance} horas de anticipación. Para algo urgente consultá en el gabinete.`);
    if (r.date > addDays(todayAR(), settings.maxDaysAhead))
      throw httpError(400, `Se puede reservar hasta ${settings.maxDaysAhead} días hacia adelante.`);
  }
  return r;
}

function conflicts(dayList, r, resources, ignoreId) {
  const problems = [];
  for (const it of r.items) {
    const res = resources.find((x) => x.id === it.resourceId);
    const used = dayList
      .filter((x) => ACTIVE(x) && x.id !== ignoreId && overlap(x, r))
      .reduce((acc, x) => acc + x.items.filter((i) => i.resourceId === it.resourceId).reduce((a, i) => a + i.qty, 0), 0);
    const free = (res.quantity || 1) - used;
    if (it.qty > free) problems.push(free > 0 ? `${res.name}: solo quedan ${free} libre(s) en ese horario` : `${res.name}: ocupado en ese horario`);
  }
  return problems;
}

async function createReservation(input, { admin, by }) {
  const [settings, resources] = await Promise.all([getSettings(), getResources()]);
  const r = validateReservation(input, settings, resources, { admin });
  const st = await store();
  let created;
  await st.update("day/" + r.date, (list) => {
    list = list || [];
    const prob = conflicts(list, r, resources);
    if (prob.length) throw httpError(409, "No disponible: " + prob.join("; ") + ".");
    created = { id: r.date.replaceAll("-", "") + "-" + uid(5), ...r, status: "confirmada", createdAt: new Date().toISOString(), createdBy: by || "docente" };
    list.push(created);
    return list;
  });
  return created;
}

// Vista pública (Ocupación): solo qué está ocupado y cuándo, sin datos de quién reservó
function publicView(r) {
  return { date: r.date, start: r.start, end: r.end, items: r.items, status: r.status };
}
// Vista del propio docente (identificado por DNI)
function mineView(r) {
  const { adminNote, history, cancelledByUser, ...rest } = r;
  return rest;
}
const ROOM_STATES = ["ordenada", "observaciones"];
function cleanReport(b) {
  const rep = {
    subject: clean(b.subject, 80),
    topic: clean(b.topic, 600),
    tools: (Array.isArray(b.tools) ? b.tools : []).map((t) => clean(t, 40)).filter(Boolean).slice(0, 30),
    students: (Array.isArray(b.students) ? b.students : [])
      .map((x) => ({ machine: clean(x.machine, 10), name: clean(x.name, 80) }))
      .filter((x) => x.name || x.machine).slice(0, 80),
    roomState: ROOM_STATES.includes(b.roomState) ? b.roomState : "",
    roomNotes: clean(b.roomNotes, 600),
    exitNotes: clean(b.exitNotes, 600),
    faultyMachines: clean(b.faultyMachines, 120),
  };
  if (!rep.subject) throw httpError(400, "Completá la materia.");
  if (!rep.topic) throw httpError(400, "Completá el tema que se dio.");
  if (!rep.roomState) throw httpError(400, "Indicá cómo encontraste la sala.");
  if (rep.roomState === "observaciones" && !rep.roomNotes) throw httpError(400, "Contá qué observaste al ingresar a la sala.");
  const seen = new Set();
  for (const x of rep.students) {
    if (!x.name) throw httpError(400, `Falta el nombre del alumno en la máquina ${x.machine}.`);
    if (x.machine && seen.has(x.machine)) throw httpError(400, `La máquina ${x.machine} está asignada a más de un alumno.`);
    if (x.machine) seen.add(x.machine);
  }
  return rep;
}
const dateFromId = (id) => { const m = /^(\d{4})(\d{2})(\d{2})-/.exec(id || ""); return m ? `${m[1]}-${m[2]}-${m[3]}` : null; };

async function listRange(from, to) {
  const st = await store();
  const keys = (await st.keys("day/")).filter((k) => k.slice(4) >= from && k.slice(4) <= to).sort();
  const days = await Promise.all(keys.map((k) => st.get(k)));
  return days.flat().filter(Boolean).sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start));
}

/* ------------------------------- Router ------------------------------- */
export default async (req) => {
  try {
    const url = new URL(req.url);
    const p = url.pathname.replace(/^\/(\.netlify\/functions\/api|api)/, "").replace(/\/$/, "");
    const m = req.method;
    const body = m === "GET" || m === "DELETE" ? {} : await req.json().catch(() => ({}));
    const q = (k) => url.searchParams.get(k) || "";
    const st = await store();

    /* ---------- Público (docentes) ---------- */
    if (p === "/public/config" && m === "GET") {
      const [settings, resources] = await Promise.all([getSettings(), getResources()]);
      return json({ settings, resources: resources.filter((r) => r.active !== false), today: todayAR() });
    }
    if (p === "/public/day" && m === "GET") {
      const d = q("date");
      if (!isDate(d)) throw httpError(400, "Fecha inválida");
      const list = ((await st.get("day/" + d)) || []).filter(ACTIVE).map(publicView);
      return json({ date: d, reservations: list });
    }
    if (p === "/public/reservations" && m === "POST") {
      const r = await createReservation(body, { admin: false });
      return json({ reservation: r }, 201);
    }
    if (p === "/public/mine" && m === "GET") {
      const dni = normDni(q("dni"));
      if (!dniOk(dni)) throw httpError(400, "Ingresá tu DNI (solo números, sin puntos).");
      const list = (await listRange(addDays(todayAR(), -30), "9999-12-31")).filter((r) => r.dni && r.dni === dni);
      return json({ reservations: list.map(mineView), today: todayAR() });
    }
    if (p === "/public/report" && m === "POST") {
      const d = dateFromId(body.id);
      const dni = normDni(body.dni);
      if (!d || !dniOk(dni)) throw httpError(400, "Reserva o DNI inválido");
      await st.update("day/" + d, (list) => {
        const r = (list || []).find((x) => x.id === body.id);
        if (!r || !r.dni || r.dni !== dni) throw httpError(404, "No encontramos esa reserva con ese DNI.");
        if (r.status === "cancelada") throw httpError(400, "La reserva está cancelada.");
        const report = cleanReport(body.report || {});
        r.report = { ...report, submittedAt: r.report?.submittedAt || new Date().toISOString(), updatedAt: new Date().toISOString(), by: "docente" };
        return list;
      });
      return json({ ok: true });
    }
    if (p === "/public/cancel" && m === "POST") {
      const d = dateFromId(body.id);
      const dni = normDni(body.dni);
      if (!d || !dniOk(dni)) throw httpError(400, "Reserva o DNI inválido");
      let ok = false;
      await st.update("day/" + d, (list) => {
        const r = (list || []).find((x) => x.id === body.id);
        if (!r || !r.dni || r.dni !== dni) throw httpError(404, "No encontramos esa reserva con ese DNI.");
        if (r.status !== "confirmada") throw httpError(400, "Esa reserva ya no se puede cancelar.");
        r.status = "cancelada"; r.cancelledAt = new Date().toISOString(); r.cancelledBy = "docente"; ok = true;
        return list;
      });
      return json({ ok });
    }

    /* ---------- Login ---------- */
    if (p === "/auth/login" && m === "POST") {
      const username = clean(body.username, 40).toLowerCase();
      const password = String(body.password || "");
      const itUser = (process.env.IT_USER || "it").toLowerCase();
      let payload = null;
      if (process.env.IT_PASSWORD && username === itUser && password === process.env.IT_PASSWORD) {
        payload = { u: itUser, n: "Admin IT", r: "it", env: 1 };
      } else {
        const u = (await getUsers()).find((x) => x.username === username);
        if (u && !u.disabled && checkPwd(password, u)) payload = { u: u.username, n: u.name, r: u.role };
      }
      if (!payload) { await new Promise((r) => setTimeout(r, 600)); throw httpError(401, "Usuario o contraseña incorrectos."); }
      payload.exp = Date.now() + 1000 * 3600 * 12;
      return json({ token: sign(payload), user: { username: payload.u, name: payload.n, role: payload.r, env: !!payload.env } });
    }

    /* ---------- Admin (gabinete + IT) ---------- */
    if (p.startsWith("/admin/")) {
      const me = await auth(req, ["admin", "it"]);

      if (p === "/admin/reservations" && m === "GET") {
        const from = isDate(q("from")) ? q("from") : todayAR();
        const to = isDate(q("to")) ? q("to") : addDays(from, 30);
        return json({ reservations: await listRange(from, to) });
      }
      if (p === "/admin/reservations" && m === "POST") {
        const r = await createReservation(body, { admin: true, by: me.u });
        return json({ reservation: r }, 201);
      }
      const rm = /^\/admin\/reservations\/([\w-]+)$/.exec(p);
      if (rm && (m === "PUT" || m === "DELETE")) {
        const id = rm[1], d = dateFromId(id);
        if (!d) throw httpError(400, "Reserva inválida");
        const resources = await getResources();
        let out;
        if (m === "PUT" && body.date && body.date !== d) {
          // Cambio de fecha: crear en el nuevo día y borrar del anterior
          const old = ((await st.get("day/" + d)) || []).find((x) => x.id === id);
          if (!old) throw httpError(404, "Reserva no encontrada");
          const created = await createReservation({ ...old, ...body }, { admin: true, by: old.createdBy });
          await st.update("day/" + d, (list) => list.filter((x) => x.id !== id));
          return json({ reservation: created });
        }
        await st.update("day/" + d, (list) => {
          list = list || [];
          const i = list.findIndex((x) => x.id === id);
          if (i < 0) throw httpError(404, "Reserva no encontrada");
          if (m === "DELETE") { if (list[i].status !== "cancelada") throw httpError(400, "Primero cancelá la reserva (así el docente ve el motivo)."); list.splice(i, 1); return list; }
          const cur = list[i];
          const allowedStatus = ["confirmada", "entregada", "devuelta", "cancelada"];
          if (body.status && !allowedStatus.includes(body.status)) throw httpError(400, "Estado inválido");
          const fields = ["start", "end", "teacher", "phone", "dni", "course", "place", "floor", "comment", "items", "adminNote"];
          const next = { ...cur };
          for (const f of fields) if (body[f] !== undefined) next[f] = body[f];
          if (fields.some((f) => body[f] !== undefined && f !== "adminNote")) {
            const v = validateReservation(next, DEFAULT_SETTINGS, resources, { admin: true });
            Object.assign(next, v);
            const prob = conflicts(list, next, resources, id);
            if (prob.length && next.status !== "cancelada") throw httpError(409, "No disponible: " + prob.join("; ") + ".");
          }
          if (body.adminNote !== undefined) next.adminNote = clean(body.adminNote, 300);
          if (body.report !== undefined) throw httpError(403, "El reporte de uso lo carga únicamente el docente que reservó.");
          if (body.status && body.status !== cur.status) {
            if (body.status === "confirmada" && cur.status === "cancelada") {
              const prob = conflicts(list, next, resources, id);
              if (prob.length) throw httpError(409, "No se puede reactivar: " + prob.join("; ") + ".");
            }
            if (body.status === "cancelada") {
              const reason = clean(body.cancelReason, 300);
              if (!reason) throw httpError(400, "Indicá el motivo de la cancelación: el docente lo va a ver.");
              Object.assign(next, { cancelReason: reason, cancelledAt: new Date().toISOString(), cancelledBy: "gabinete", cancelledByUser: me.u });
            }
            if (cur.status === "cancelada" && body.status !== "cancelada") { delete next.cancelReason; delete next.cancelledAt; delete next.cancelledBy; delete next.cancelledByUser; }
            next.status = body.status;
            next.history = [...(cur.history || []), { at: new Date().toISOString(), by: me.u, status: body.status }];
          }
          next.updatedAt = new Date().toISOString(); next.updatedBy = me.u;
          list[i] = out = next;
          return list;
        });
        return json({ reservation: out || null });
      }

      /* Recursos */
      if (p === "/admin/resources" && m === "GET") return json({ resources: await getResources() });
      if (p === "/admin/resources" && (m === "POST" || m === "PUT")) {
        await getResources();
        let saved;
        await st.update("resources", (list) => {
          list = list || [];
          const data = {
            name: clean(body.name, 80), category: clean(body.category, 40) || "Otros", icon: clean(body.icon, 8) || "📦",
            location: clean(body.location, 80), notes: clean(body.notes, 300),
            quantity: Math.max(1, Math.min(999, parseInt(body.quantity) || 1)), active: body.active !== false,
            requiresReport: !!body.requiresReport, machines: Math.max(0, Math.min(200, parseInt(body.machines) || 0)),
          };
          if (!data.name) throw httpError(400, "El recurso necesita un nombre.");
          if (m === "POST") { saved = { id: uid(6), ...data }; list.push(saved); }
          else {
            const i = list.findIndex((x) => x.id === body.id);
            if (i < 0) throw httpError(404, "Recurso no encontrado");
            saved = list[i] = { ...list[i], ...data };
          }
          return list;
        });
        return json({ resource: saved });
      }
      const resm = /^\/admin\/resources\/(\w+)$/.exec(p);
      if (resm && m === "DELETE") {
        await st.update("resources", (list) => (list || []).filter((x) => x.id !== resm[1]));
        return json({ ok: true });
      }

      /* Configuración */
      if (p === "/admin/settings" && m === "GET") return json({ settings: await getSettings() });
      if (p === "/admin/settings" && m === "PUT") {
        if (me.r !== "it") throw httpError(403, "Solo Admin IT puede cambiar la configuración.");
        const cur = await getSettings();
        const s = {
          schoolName: clean(body.schoolName ?? cur.schoolName, 80),
          notice: clean(body.notice ?? cur.notice, 600),
          minHoursAdvance: Math.max(0, Math.min(720, +(body.minHoursAdvance ?? cur.minHoursAdvance) || 0)),
          maxDaysAhead: Math.max(1, Math.min(365, +(body.maxDaysAhead ?? cur.maxDaysAhead) || 60)),
          dayStart: isTime(body.dayStart) ? body.dayStart : cur.dayStart,
          dayEnd: isTime(body.dayEnd) ? body.dayEnd : cur.dayEnd,
          weekdays: Array.isArray(body.weekdays) ? body.weekdays.map(Number).filter((n) => n >= 0 && n <= 6) : cur.weekdays,
          modules: Array.isArray(body.modules)
            ? body.modules.filter((x) => isTime(x.start) && isTime(x.end) && toMin(x.end) > toMin(x.start)).map((x) => ({ label: clean(x.label, 30), start: x.start, end: x.end }))
            : cur.modules,
        };
        await st.set("settings", s);
        return json({ settings: s });
      }

      /* Usuarios (solo IT) */
      if (p === "/admin/me/password" && m === "POST") {
        if (me.env) throw httpError(400, "La contraseña de Admin IT se cambia en las variables de entorno de Netlify.");
        if (String(body.newPassword || "").length < 6) throw httpError(400, "La contraseña nueva debe tener al menos 6 caracteres.");
        await st.update("users", (list) => {
          const u = (list || []).find((x) => x.username === me.u);
          if (!u || !checkPwd(body.currentPassword || "", u)) throw httpError(400, "La contraseña actual no es correcta.");
          Object.assign(u, hashPwd(body.newPassword));
          return list;
        });
        return json({ ok: true });
      }
      if (p.startsWith("/admin/users")) {
        if (me.r !== "it") throw httpError(403, "Solo Admin IT puede gestionar usuarios.");
        const strip = (u) => ({ username: u.username, name: u.name, role: u.role, disabled: !!u.disabled, createdAt: u.createdAt });
        if (m === "GET") return json({ users: (await getUsers()).map(strip) });
        if (m === "POST" || m === "PUT") {
          const username = clean(body.username, 40).toLowerCase().replace(/[^a-z0-9._-]/g, "");
          if (!username) throw httpError(400, "Usuario inválido (solo letras, números, punto o guion).");
          if (username === (process.env.IT_USER || "it").toLowerCase()) throw httpError(400, "Ese nombre de usuario está reservado.");
          const role = body.role === "it" ? "it" : "admin";
          let saved;
          await st.update("users", (list) => {
            list = list || [];
            const ex = list.find((x) => x.username === username);
            if (m === "POST") {
              if (ex) throw httpError(400, "Ya existe ese usuario.");
              if (String(body.password || "").length < 6) throw httpError(400, "La contraseña debe tener al menos 6 caracteres.");
              saved = { username, name: clean(body.name, 80) || username, role, disabled: false, createdAt: new Date().toISOString(), ...hashPwd(body.password) };
              list.push(saved);
            } else {
              if (!ex) throw httpError(404, "Usuario no encontrado");
              if (body.name !== undefined) ex.name = clean(body.name, 80);
              ex.role = role;
              if (body.disabled !== undefined) ex.disabled = !!body.disabled;
              if (body.password) {
                if (String(body.password).length < 6) throw httpError(400, "La contraseña debe tener al menos 6 caracteres.");
                Object.assign(ex, hashPwd(body.password));
              }
              saved = ex;
            }
            return list;
          });
          return json({ user: strip(saved) });
        }
        const um = /^\/admin\/users\/([\w.-]+)$/.exec(p);
        if (um && m === "DELETE") {
          await st.update("users", (list) => (list || []).filter((x) => x.username !== um[1]));
          return json({ ok: true });
        }
      }
    }
    throw httpError(404, "Ruta no encontrada");
  } catch (e) {
    if (!e.status) console.error(e);
    return json({ error: e.status ? e.message : "Error interno del servidor" }, e.status || 500);
  }
};

export const config = { path: "/api/*" };
