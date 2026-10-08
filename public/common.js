// Utilidades compartidas entre la vista de docentes y el panel de administración.
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const toMin = (t) => +t.slice(0, 2) * 60 + +t.slice(3, 5);
const fromMin = (m) => String(Math.floor(m / 60)).padStart(2, "0") + ":" + String(m % 60).padStart(2, "0");
const overlap = (a, b) => toMin(a.start) < toMin(b.end) && toMin(b.start) < toMin(a.end);

const store = {
  get(k, d = null) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
  del(k) { try { localStorage.removeItem(k); } catch {} },
};

async function api(path, { method = "GET", body, token } = {}) {
  const headers = { "content-type": "application/json" };
  if (token) headers.authorization = "Bearer " + token;
  let res;
  try {
    res = await fetch("/api" + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  } catch {
    throw new Error("Sin conexión. Revisá internet e intentá de nuevo.");
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) { const e = new Error(data.error || "Ocurrió un error"); e.status = res.status; throw e; }
  return data;
}

let toastT;
function toast(msg, err = false) {
  let t = $("#toast");
  if (!t) { t = document.createElement("div"); t.id = "toast"; document.body.appendChild(t); }
  t.textContent = msg; t.className = err ? "err" : ""; t.style.display = "block";
  clearTimeout(toastT); toastT = setTimeout(() => (t.style.display = "none"), err ? 5000 : 2800);
}

function modal(html, { onMount, wide } = {}) {
  const bg = document.createElement("div");
  bg.className = "modal-bg";
  bg.innerHTML = `<div class="modal" role="dialog" aria-modal="true" ${wide ? 'style="max-width:680px"' : ""}>${html}</div>`;
  const close = () => bg.remove();
  bg.addEventListener("click", (e) => { if (e.target === bg) close(); });
  bg.addEventListener("click", (e) => { if (e.target.closest("[data-close]")) close(); });
  document.addEventListener("keydown", function k(e) { if (e.key === "Escape") { close(); document.removeEventListener("keydown", k); } });
  document.body.appendChild(bg);
  onMount && onMount(bg.firstElementChild, close);
  return close;
}
function confirmBox(text, okLabel = "Confirmar", danger = false) {
  return new Promise((resolve) => {
    modal(`<h3>${esc(text)}</h3><div class="foot"><button class="btn" data-close>Volver</button><button class="btn ${danger ? "danger" : "primary"}" id="cb-ok">${esc(okLabel)}</button></div>`, {
      onMount: (m, close) => {
        $("#cb-ok", m).onclick = () => { close(); resolve(true); };
        m.parentElement.addEventListener("click", (e) => { if (e.target === m.parentElement || e.target.closest("[data-close]")) resolve(false); });
      },
    });
  });
}

const DIAS = ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"];
const DIAS_L = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
const MESES_L = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
const dObj = (s) => new Date(s + "T12:00:00");
const addDays = (s, n) => { const d = dObj(s); d.setDate(d.getDate() + n); return iso(d); };
const iso = (d) => d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
const fmtDate = (s) => { const d = dObj(s); return `${DIAS[d.getDay()]} ${d.getDate()}/${d.getMonth() + 1}`; };
const fmtDateLong = (s) => { const d = dObj(s); return `${DIAS_L[d.getDay()]} ${d.getDate()} de ${MESES_L[d.getMonth()]}`; };

function itemsText(items, resources) {
  return items.map((i) => {
    const r = resources.find((x) => x.id === i.resourceId);
    return (r ? `${r.icon || ""} ${r.name}` : "Recurso eliminado") + (i.qty > 1 ? ` ×${i.qty}` : "");
  }).join(", ");
}

// Calcula disponibilidad de cada recurso para un rango horario
function availability(resource, reservations, start, end) {
  const total = resource.quantity || 1;
  if (!start || !end || toMin(end) <= toMin(start)) return { free: total, total, clashes: [] };
  const clashes = reservations.filter((r) => r.status !== "cancelada" && overlap(r, { start, end }) && r.items.some((i) => i.resourceId === resource.id));
  const used = clashes.reduce((a, r) => a + r.items.filter((i) => i.resourceId === resource.id).reduce((s, i) => s + i.qty, 0), 0);
  return { free: Math.max(0, total - used), total, clashes };
}

// Línea de tiempo por recurso
function timeline(el, { resources, reservations, dayStart = "07:00", dayEnd = "23:00", modules, selection, onBlock, admin }) {
  // Rango visible: módulos + reservas del día (más compacto que todo el horario habilitado)
  const pts = [...(modules || []).flatMap((m) => [toMin(m.start), toMin(m.end)]), ...reservations.filter((x) => x.status !== "cancelada").flatMap((x) => [toMin(x.start), toMin(x.end)])];
  if (selection && selection.start && selection.end) pts.push(toMin(selection.start), toMin(selection.end));
  let s = Math.floor((pts.length ? Math.min(...pts) : toMin(dayStart)) / 60) * 60;
  let e = Math.ceil((pts.length ? Math.max(...pts) : toMin(dayEnd)) / 60) * 60;
  if (e - s < 360) e = Math.min(24 * 60, s + 360);
  const span = e - s;
  const pct = (m) => ((m - s) / span) * 100;
  const hours = []; for (let m = s; m <= e; m += 60) hours.push(m);
  const hourW = 100 / (span / 60);
  let html = `<div class="tl"><div class="tl-inner" style="--hour:${hourW}%"><div class="tl-head"><div></div><div class="hrs">${hours.map((m) => `<span style="left:${pct(m)}%">${m / 60}h</span>`).join("")}</div></div>`;
  for (const r of resources) {
    const list = reservations.filter((x) => x.status !== "cancelada" && x.items.some((i) => i.resourceId === r.id));
    html += `<div class="tl-row"><div class="lbl">${esc(r.icon || "")} <span>${esc(r.name)}${(r.quantity || 1) > 1 ? ` <small>(${r.quantity})</small>` : ""}</span></div><div class="lane">`;
    // apilar reservas solapadas
    const lanes = [];
    const sorted = [...list].sort((a, b) => toMin(a.start) - toMin(b.start));
    const pos = sorted.map((x) => { let li = lanes.findIndex((end) => end <= toMin(x.start)); if (li < 0) { li = lanes.length; lanes.push(0); } lanes[li] = toMin(x.end); return li; });
    const n = Math.max(1, lanes.length);
    sorted.forEach((x, k) => {
      const q = x.items.filter((i) => i.resourceId === r.id).reduce((a, i) => a + i.qty, 0);
      // Vista pública: solo "Ocupado". Panel: curso y docente.
      const label = admin ? `${x.start}–${x.end} · ${x.course}${q > 1 ? ` ×${q}` : ""} · ${x.teacher}` : `${x.start}–${x.end} · ` + ((r.quantity || 1) > 1 ? `${q} de ${r.quantity} en uso` : "Ocupado");
      const inner = admin ? `<b>${x.start}–${x.end}</b><br>${esc(x.course)}${q > 1 ? ` ×${q}` : ""} · ${esc(x.teacher)}` : `<b>${x.start}–${x.end}</b><br>` + ((r.quantity || 1) > 1 ? `${q} de ${r.quantity} en uso` : "Ocupado");
      const h = 100 / n;
      html += `<div class="blk s-${x.status} ${onBlock ? "click" : ""}" data-id="${x.id}" title="${esc(label)}" style="left:${pct(toMin(x.start))}%;width:${pct(toMin(x.end)) - pct(toMin(x.start))}%;top:calc(${h * pos[k]}% + 4px);bottom:auto;height:calc(${h}% - 8px)">${inner}</div>`;
    });
    if (selection && selection.start && selection.end && toMin(selection.end) > toMin(selection.start) && (!selection.ids || selection.ids.includes(r.id)))
      html += `<div class="blk sel" style="left:${pct(toMin(selection.start))}%;width:${pct(toMin(selection.end)) - pct(toMin(selection.start))}%">tu horario</div>`;
    html += `</div></div>`;
  }
  html += `</div></div>`;
  el.innerHTML = resources.length ? html : `<div class="empty">No hay recursos cargados.</div>`;
  // ajustar altura de filas con muchos solapamientos
  $$(".tl-row", el).forEach((row) => {
    const tops = new Set($$(".blk:not(.sel)", row).map((b) => b.style.top));
    row.style.minHeight = 44 * Math.max(1, tops.size) + 10 + "px";
  });
  if (onBlock) $$(".blk[data-id]", el).forEach((b) => (b.onclick = () => onBlock(b.dataset.id)));
}

function gcalLink(r, resources, schoolName) {
  const d = r.date.replaceAll("-", "");
  const t = (x) => x.replace(":", "") + "00";
  const p = new URLSearchParams({
    action: "TEMPLATE",
    text: `Reserva: ${itemsText(r.items, resources).replace(/\p{Extended_Pictographic}\s?/gu, "")}`,
    dates: `${d}T${t(r.start)}/${d}T${t(r.end)}`,
    ctz: "America/Argentina/Cordoba",
    details: `${schoolName}\nCurso: ${r.course}\nCódigo: ${r.id}`,
    location: [r.place, r.floor].filter(Boolean).join(" – "),
  });
  return "https://calendar.google.com/calendar/render?" + p;
}

/* ======================= Reporte de uso de sala ======================= */
const TOOL_SUGGEST = ["Procesador de texto (Word/Writer)", "Planilla de cálculo (Excel/Calc)", "Presentaciones (PowerPoint/Impress)", "Navegador web", "Google Drive/Docs", "Classroom", "Canva", "Scratch", "Python", "GeoGebra", "Tinkercad / Arduino", "Juegos educativos"];
const needsReport = (r, resources) => r.items.some((i) => resources.find((x) => x.id === i.resourceId)?.requiresReport);
const reportMachines = (r, resources) => Math.max(0, ...r.items.map((i) => resources.find((x) => x.id === i.resourceId)).filter((x) => x?.requiresReport).map((x) => x.machines || 0));
const courseKey = (c) => "alumnos:" + String(c || "").toLowerCase().replace(/\s+/g, " ").trim();

// Arma el formulario de reporte dentro de `el`. Devuelve una función que junta los datos.
function mountReport(el, { report = {}, machines = 0, course = "" } = {}) {
  const tools = new Set(report.tools || []);
  let students = (report.students || []).map((x) => ({ ...x }));
  let roomState = report.roomState || "";
  const prevList = store.get(courseKey(course), []);
  const subjects = store.get("materias", []);
  el.innerHTML = `
    <div class="grid2">
      <div><label class="f">Materia</label><input class="in-f" id="rp-subject" list="rp-subjects" value="${esc(report.subject || "")}" placeholder="Ej: Tecnología"><datalist id="rp-subjects">${subjects.map((x) => `<option value="${esc(x)}">`).join("")}</datalist></div>
      <div><label class="f">Curso</label><input class="in-f" value="${esc(course)}" disabled></div>
    </div>
    <label class="f" style="margin-top:12px">Tema que se dio</label>
    <textarea class="in-f" id="rp-topic" placeholder="Ej: Introducción a planillas de cálculo: fórmulas SUMA y PROMEDIO">${esc(report.topic || "")}</textarea>

    <label class="f" style="margin-top:12px">Herramientas o software que se usaron</label>
    <div class="chips" id="rp-tools"></div>
    <div class="row" style="margin-top:8px"><input class="in-f" id="rp-tool-new" placeholder="Otra herramienta…" style="flex:1;min-width:160px"><button type="button" class="btn sm" id="rp-tool-add">Agregar</button></div>

    <div class="row" style="justify-content:space-between;margin-top:16px">
      <label class="f" style="margin:0">Alumnos y máquinas <span class="opt" id="rp-count"></span></label>
      <div class="row" style="gap:6px">
        ${prevList.length && !students.length ? `<button type="button" class="btn sm" id="rp-prev">↺ Usar lista anterior (${prevList.length})</button>` : ""}
        <button type="button" class="btn sm" id="rp-paste">📋 Pegar lista</button>
      </div>
    </div>
    <div id="rp-paste-box" class="hide" style="margin-top:8px">
      <textarea class="in-f" id="rp-paste-txt" placeholder="Pegá un nombre por línea (ej. copiado de Excel o del Classroom). Se numeran las máquinas solas.&#10;También podés escribir: 5 - Juan Pérez"></textarea>
      <div class="row" style="justify-content:flex-end;margin-top:6px"><button type="button" class="btn sm primary" id="rp-paste-ok">Cargar alumnos</button></div>
    </div>
    <div id="rp-students" style="margin-top:8px"></div>
    <button type="button" class="btn sm" id="rp-add" style="margin-top:6px">➕ Agregar alumno</button>

    <label class="f" style="margin-top:16px">¿Cómo encontraste la sala al ingresar?</label>
    <div class="seg" id="rp-state"><button type="button" data-v="ordenada">✅ Ordenada y en condiciones</button><button type="button" data-v="observaciones">⚠️ Con observaciones</button></div>
    <textarea class="in-f hide" id="rp-room" style="margin-top:8px" placeholder="¿Qué encontraste? Ej: máquina 7 encendida, sillas desordenadas, falta un mouse…">${esc(report.roomNotes || "")}</textarea>

    <label class="f" style="margin-top:16px">Novedades al salir <span class="opt">(opcional)</span></label>
    <textarea class="in-f" id="rp-exit" placeholder="Ej: la máquina 12 no enciende, quedó un pendrive olvidado…">${esc(report.exitNotes || "")}</textarea>
    <label class="f" style="margin-top:10px">Máquinas con fallas <span class="opt">(números, opcional)</span></label>
    <input class="in-f" id="rp-faulty" value="${esc(report.faultyMachines || "")}" placeholder="Ej: 4, 12">`;

  const drawTools = () => {
    const all = [...new Set([...TOOL_SUGGEST, ...tools])];
    $("#rp-tools", el).innerHTML = all.map((t) => `<button type="button" class="chip ${tools.has(t) ? "on" : ""}" data-t="${esc(t)}" style="padding:6px 10px;font-size:14px">${esc(t)}</button>`).join("");
    $$("#rp-tools .chip", el).forEach((b) => (b.onclick = () => { tools.has(b.dataset.t) ? tools.delete(b.dataset.t) : tools.add(b.dataset.t); drawTools(); }));
  };
  const addTool = () => { const v = $("#rp-tool-new", el).value.trim(); if (v) { tools.add(v); $("#rp-tool-new", el).value = ""; drawTools(); } };
  $("#rp-tool-add", el).onclick = addTool;
  $("#rp-tool-new", el).onkeydown = (e) => { if (e.key === "Enter") { e.preventDefault(); addTool(); } };

  const nextMachine = () => { const used = new Set(students.map((s) => +s.machine).filter(Boolean)); let n = 1; while (used.has(n)) n++; return String(n); };
  const drawStudents = () => {
    const box = $("#rp-students", el);
    const dup = new Set(students.map((s) => s.machine).filter((m, i, a) => m && a.indexOf(m) !== i));
    box.innerHTML = students.length ? students.map((s, i) => `<div class="row" style="gap:6px;margin-bottom:6px;flex-wrap:nowrap">
        <input class="in-f" data-k="machine" data-i="${i}" value="${esc(s.machine)}" inputmode="numeric" placeholder="N°" title="Número de máquina" style="width:64px;flex:none;text-align:center;${dup.has(s.machine) ? "border-color:var(--bad)" : ""}">
        <input class="in-f" data-k="name" data-i="${i}" value="${esc(s.name)}" placeholder="Nombre y apellido" style="flex:1;min-width:0">
        <button type="button" class="btn sm ghost" data-del="${i}" title="Quitar">✕</button></div>`).join("")
      : `<div class="muted small" style="padding:6px 0">Todavía no cargaste alumnos. Agregalos de a uno o pegá la lista completa.</div>`;
    $("#rp-count", el).textContent = students.length ? `(${students.length})` : "";
    $$("input[data-k]", box).forEach((inp) => (inp.oninput = () => { students[+inp.dataset.i][inp.dataset.k] = inp.value; if (inp.dataset.k === "machine") { const c = document.activeElement === inp; drawStudents(); if (c) { const again = $(`input[data-k="machine"][data-i="${inp.dataset.i}"]`, box); again.focus(); again.setSelectionRange(99, 99); } } }));
    $$("input[data-k='name']", box).forEach((inp) => (inp.onkeydown = (e) => { if (e.key === "Enter") { e.preventDefault(); add(true); } }));
    $$("[data-del]", box).forEach((b) => (b.onclick = () => { students.splice(+b.dataset.del, 1); drawStudents(); }));
  };
  const add = (focus) => { students.push({ machine: nextMachine(), name: "" }); drawStudents(); if (focus) $$("#rp-students input[data-k='name']", el).at(-1).focus(); };
  $("#rp-add", el).onclick = () => add(true);
  $("#rp-paste", el).onclick = () => { $("#rp-paste-box", el).classList.toggle("hide"); $("#rp-paste-txt", el).focus(); };
  $("#rp-paste-ok", el).onclick = () => {
    $("#rp-paste-txt", el).value.split(/\r?\n/).map((l) => l.replace(/\t/g, " ").trim()).filter(Boolean).forEach((l) => {
      const m = /^(\d{1,3})\s*[-.):]?\s+(.+)$/.exec(l);
      students.push(m ? { machine: m[1], name: m[2].trim() } : { machine: nextMachine(), name: l });
    });
    $("#rp-paste-txt", el).value = ""; $("#rp-paste-box", el).classList.add("hide"); drawStudents();
  };
  $("#rp-prev", el) && ($("#rp-prev", el).onclick = (e) => { students = prevList.map((x) => ({ ...x })); e.target.remove(); drawStudents(); });

  const drawState = () => { $$("#rp-state button", el).forEach((b) => b.classList.toggle("on", b.dataset.v === roomState)); $("#rp-room", el).classList.toggle("hide", roomState !== "observaciones"); };
  $$("#rp-state button", el).forEach((b) => (b.onclick = () => { roomState = b.dataset.v; drawState(); if (roomState === "observaciones") $("#rp-room", el).focus(); }));
  drawTools(); drawStudents(); drawState();

  return () => ({
    subject: $("#rp-subject", el).value.trim(), topic: $("#rp-topic", el).value.trim(), tools: [...tools],
    students: students.map((s) => ({ machine: String(s.machine || "").trim(), name: s.name.trim() })).filter((s) => s.name || s.machine),
    roomState, roomNotes: roomState === "observaciones" ? $("#rp-room", el).value.trim() : "", exitNotes: $("#rp-exit", el).value.trim(), faultyMachines: $("#rp-faulty", el).value.trim(),
  });
}
function rememberReport(course, rep) {
  if (rep.students.length) store.set(courseKey(course), rep.students);
  if (rep.subject) store.set("materias", [...new Set([rep.subject, ...store.get("materias", [])])].slice(0, 10));
}

// Vista de solo lectura del reporte
function reportView(rep) {
  if (!rep) return "";
  const studs = [...(rep.students || [])].sort((a, b) => (+a.machine || 999) - (+b.machine || 999));
  return `<dl class="kv">
      <dt>Materia</dt><dd><b>${esc(rep.subject)}</b></dd>
      <dt>Tema</dt><dd>${esc(rep.topic)}</dd>
      <dt>Herramientas</dt><dd>${rep.tools?.length ? rep.tools.map((t) => `<span class="badge devuelta" style="margin:0 4px 4px 0">${esc(t)}</span>`).join("") : "—"}</dd>
      <dt>Sala al ingresar</dt><dd>${rep.roomState === "ordenada" ? "✅ Ordenada y en condiciones" : "⚠️ Con observaciones: " + esc(rep.roomNotes)}</dd>
      <dt>Al salir</dt><dd>${esc(rep.exitNotes || "Sin novedades")}</dd>
      ${rep.faultyMachines ? `<dt>Máq. con fallas</dt><dd><b style="color:var(--bad)">${esc(rep.faultyMachines)}</b></dd>` : ""}
    </dl>
    <div style="margin-top:12px"><b>Alumnos (${studs.length})</b>
      ${studs.length ? `<table class="tbl" style="margin-top:6px"><thead><tr><th style="width:80px">Máquina</th><th>Alumno</th></tr></thead><tbody>${studs.map((s) => `<tr><td><b>${esc(s.machine || "—")}</b></td><td>${esc(s.name)}</td></tr>`).join("")}</tbody></table>` : `<div class="muted small">Sin alumnos cargados.</div>`}
    </div>
    <div class="muted small" style="margin-top:8px">Enviado ${new Date(rep.updatedAt || rep.submittedAt).toLocaleString("es-AR")}${rep.by && rep.by !== "docente" ? " por " + esc(rep.by) : ""}</div>`;
}
function printReport(r, resources, school) {
  const w = window.open("", "_blank");
  if (!w) return toast("Permití las ventanas emergentes para imprimir.", true);
  w.document.write(`<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Reporte ${r.id}</title><link rel="stylesheet" href="/styles.css">
    <style>body{background:#fff;padding:24px;max-width:800px;margin:auto}@media print{button{display:none}}</style></head><body>
    <h2 style="margin:0">${esc(school)} — Reporte de uso</h2>
    <p class="muted">${esc(itemsText(r.items, resources))} · ${fmtDateLong(r.date)}, ${r.start} a ${r.end} · Docente: ${esc(r.teacher)} · Curso: ${esc(r.course)}</p>
    ${reportView(r.report)}<p><button class="btn primary" onclick="print()">🖨️ Imprimir</button></p></body></html>`);
  w.document.close();
}
