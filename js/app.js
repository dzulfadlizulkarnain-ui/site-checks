/* Site Checks — screens and flows. The same skeleton as the Kitchen Handover, Audit and Pre-onboarding apps: one
 * <section> per screen, shown by show(); the form and the record view are rendered from the spec the backend sends
 * (meta.forms), so a question changed in Code.gs is the whole change. Every user-supplied string enters the DOM as text. */
"use strict";

const $ = id => document.getElementById(id);
function el(tag, attrs, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === "class") n.className = v;
    else if (k.startsWith("on")) n.addEventListener(k.slice(2), v);
    else n.setAttribute(k, v === true ? "" : v);
  }
  for (const k of kids.flat(Infinity)) if (k != null && k !== false && k !== "") n.append(k.nodeType ? k : String(k));
  return n;
}
let toastTimer = null;
function toast(msg) { const t = $("toast"); t.textContent = msg; t.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, 3000); }
function show(id) { document.querySelectorAll(".screen").forEach(s => { s.hidden = s.id !== id; }); window.scrollTo(0, 0); }
function fmtDate(s) { if (!s) return ""; const d = /^\d{4}-\d{2}-\d{2}$/.test(s) ? new Date(s + "T12:00:00") : new Date(s); return isNaN(d) ? String(s || "") : d.toLocaleDateString("en-SG", { day: "numeric", month: "short", year: "numeric" }); }
function fmtDay(s) { const d = new Date(s + "T12:00:00"); return isNaN(d) ? s : d.toLocaleDateString("en-SG", { weekday: "short", day: "numeric", month: "short" }); }
function fmtTime(hm) { const [h, m] = String(hm || "").split(":").map(Number); return isNaN(h) ? "" : `${h % 12 || 12}${m ? ":" + String(m).padStart(2, "0") : ""}${h < 12 ? "am" : "pm"}`; }
function todayISO() { const d = new Date(); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); }
function initials(name) { return name.split(/\s+/).slice(0, 2).map(w => w[0] || "").join("").toUpperCase(); }
function idFromUrl(u) { return (String(u).match(/id=([\w-]+)/) || [])[1] || ""; }
async function guard(fn) { try { await fn(); } catch (e) { if (e.auth) { session.clear(); App.cur = null; loadLogin(); } toast(e.message || String(e)); } }

const App = { meta: null, items: [], days: [], site: "", q: "", tab: "today", cur: null, names: [] };
const siteName = code => { const s = (App.meta ? App.meta.sites : []).find(s => s.code === code); return s ? s.name : ""; };
const form = type => App.meta.forms[type];
const TYPES = ["opening", "middle", "closing"]; // in the order of the day
const doesCheck = (type, site) => !form(type).sites || form(type).sites.includes(site); // Middle is done at three sites only
const kNum = k => Number(String(k).replace(/\D/g, "")) || 0;

/* ---------- login ---------- */
async function loadLogin() {
  show("scr-login");
  $("pin-panel").hidden = true; $("login-pick").hidden = false;
  if (!App.names.length) {
    $("login-list").replaceChildren(el("p", { class: "empty" }, "Loading names…"));
    try { App.names = (await api("roster")).names; }
    catch (e) { $("login-list").replaceChildren(el("button", { class: "row", type: "button", onclick: () => loadLogin() }, "Could not load the names. Tap to retry.")); throw e; }
  }
  renderNames($("login-search").value);
}
function renderNames(q) {
  const list = $("login-list"); list.replaceChildren();
  App.names.filter(n => n.toLowerCase().includes(q.trim().toLowerCase())).forEach(n => list.append(
    el("button", { class: "row", type: "button", onclick: () => pickName(n) }, el("span", { class: "avatar" }, initials(n)), el("span", { class: "row-title" }, n))));
}
function pickName(name) {
  $("login-pick").hidden = true; $("pin-panel").hidden = false;
  $("pin-name").textContent = name;
  const pin = $("pin"); pin.value = ""; pin.focus();
  const btn = $("pin-panel").querySelector("button[type=submit]");
  $("pin-panel").onsubmit = ev => {
    ev.preventDefault();
    busyBtn(btn, "Checking PIN…", async () => { const a = await api("login", { name, pin: pin.value }); session.save(a); await enterApp(a); });
  };
}
// a second tap within a few seconds confirms; pop-up confirm() boxes are blocked on some phones and the tap then does nothing
function sure(btn, label) {
  if (btn.dataset.sure) { delete btn.dataset.sure; btn.textContent = btn.dataset.was || btn.textContent; delete btn.dataset.was; return true; }
  const was = btn.textContent; btn.dataset.sure = "1"; btn.dataset.was = was; btn.textContent = label;
  setTimeout(() => { if (btn.dataset.sure) { delete btn.dataset.sure; delete btn.dataset.was; btn.textContent = was; } }, 5000);
  return false;
}
function busyBtn(btn, label, fn) { // a tapped button says what it is doing until the call returns
  const was = btn.textContent; btn.disabled = true; btn.textContent = label;
  return guard(async () => { try { await fn(); } finally { btn.disabled = false; btn.textContent = was; } });
}
$("login-search").oninput = e => renderNames(e.target.value);
$("pin-back").onclick = () => loadLogin();

/* ---------- home ---------- */
// last known data, so a reopened app paints at once and refreshes in the background
const cached = k => { try { return JSON.parse(localStorage.getItem(k) || "null"); } catch (e) { return null; } };
const remember = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} };
async function enterApp(meta) { // login already carries the sites and the forms; a resumed session uses the cached copy
  const fromCache = !(meta && meta.forms) && cached("sc.meta");
  App.meta = meta && meta.forms ? meta : (fromCache || await api("meta"));
  if (!App.meta.forms) throw new Error("Could not load the app settings. Try again.");
  remember("sc.meta", App.meta);
  await loadHome();
  if (fromCache) api("meta").then(m => { if (m.forms) { App.meta = m; remember("sc.meta", m); if (!$("scr-home").hidden) renderHome(); } }).catch(() => {});
}
async function loadHome() {
  show("scr-home");
  $("home-user").textContent = session.name;
  const snap = cached("sc.home");
  if (snap && Array.isArray(snap.items) && Array.isArray(snap.days)) { App.items = snap.items; App.days = snap.days; renderHome(); }
  else $("home-list").replaceChildren(el("p", { class: "empty" }, "Loading…"));
  const l = await api("list");
  App.items = l.items; App.days = l.days || [];
  remember("sc.home", { items: App.items, days: App.days });
  renderHome();
}
// what one check of the board says: done (on time or late), in progress, due by, overdue, missed
function stateBadge(d) {
  const due = fmtTime(d.due);
  switch (d.state) {
    case "done": return { cls: d.late ? "soon" : "done", text: d.late ? "Done late" : "Done", sub: `${d.by} · ${fmtTime(d.done_at)}${d.late ? ` (due ${due})` : ""}` + (d.bad ? ` · ${d.bad} not OK` : "") };
    case "draft": return { cls: "draft", text: "In progress", sub: `${d.by} · due by ${due}` };
    case "overdue": return { cls: "late", text: "Overdue", sub: d.id ? `In progress by ${d.by} · was due by ${due}` : `Not started · was due by ${due}` };
    case "missed": return { cls: "late", text: "Missed", sub: d.id ? `Started by ${d.by}, never completed` : "Not done" };
    default: return { cls: "", text: "Start", sub: `Due by ${due}` };
  }
}
const openDay = d => guard(() => d.id ? (d.state === "done" ? openDetail(d.type, d.id) : resumeForm(d.type, d.id)) : startCheck(d.type, d.site, d.date));
function renderHome() {
  // two tabs: Today (each site's checks of the day, and what was missed this week) and Records (completed checks, by site, searchable)
  const tabs = $("home-tabs"); tabs.replaceChildren(...[["today", "Today"], ["records", "Records"]].map(([k, label]) =>
    el("button", { class: "seg-btn" + (App.tab === k ? " on" : ""), type: "button", onclick: () => { App.tab = k; renderHome(); } }, label)));
  const records = App.tab === "records";
  $("home-search").hidden = !records;
  const chips = $("site-chips"); chips.replaceChildren();
  const chip = (code, label) => el("button", { class: "chip" + (App.site === code ? " on" : ""), type: "button", onclick: () => { App.site = code; renderHome(); } }, label);
  chips.append(chip("", "All"), ...App.meta.sites.map(s => chip(s.code, `${s.code} ${s.name}`)));
  const list = $("home-list"); list.replaceChildren();
  const sites = App.meta.sites.filter(s => !App.site || s.code === App.site);
  if (!records) {
    const today = (App.days[0] || {}).date || todayISO(); // the server's today: the board is built in the sheet's time zone
    list.append(el("div", { class: "listhead" }, `Today · ${fmtDay(today)}`));
    sites.forEach(s => {
      const card = el("div", { class: "card site" }, el("div", { class: "site-name" }, `${s.code} ${s.name}`));
      TYPES.filter(type => doesCheck(type, s.code)).forEach(type => {
        const d = App.days.find(x => x.date === today && x.site === s.code && x.type === type) || { date: today, site: s.code, type, due: form(type).due, state: "due" };
        const b = stateBadge(d);
        card.append(el("button", { class: "row check", type: "button", onclick: () => openDay(d) },
          el("div", { class: "row-main" }, el("div", { class: "row-title" }, form(type).short), el("div", { class: "row-sub" }, b.sub)),
          el("span", { class: "badge " + b.cls }, b.text)));
      });
      list.append(card);
    });
    // the week behind: every check not completed, newest first; tapping one fills it in late, or finishes the one started
    const missed = App.days.filter(d => d.date !== today && d.state === "missed" && (!App.site || d.site === App.site));
    const late = App.days.filter(d => d.date !== today && d.state === "done" && d.late && (!App.site || d.site === App.site)).length;
    list.append(el("div", { class: "listhead" }, `Last ${App.meta.daysBack || 7} days`));
    list.append(el("p", { class: "muted small" }, missed.length ? `${missed.length} missed${late ? `, ${late} done late` : ""}. Tap one to fill it in late.` : `Nothing missed${late ? `; ${late} done late` : ""}.`));
    missed.forEach(d => {
      const b = stateBadge(d), dt = new Date(d.date + "T12:00:00");
      list.append(el("button", { class: "row", type: "button", onclick: () => openDay(d) },
        el("div", { class: "mv-date" }, el("span", { class: "d" }, String(dt.getDate())), el("span", { class: "mo" }, dt.toLocaleDateString("en-SG", { weekday: "short" }))),
        el("div", { class: "row-main" }, el("div", { class: "row-title" }, `${d.site} ${siteName(d.site)} · ${form(d.type).short}`), el("div", { class: "row-sub" }, b.sub)),
        el("span", { class: "badge " + b.cls }, b.text)));
    });
    list.append(el("button", { class: "btn ghost", type: "button", onclick: () => openNew() }, "Another site or day…"));
    return;
  }
  const q = App.q.trim().toLowerCase();
  const done = App.items.filter(i => i.status === "done" && (!App.site || i.site === App.site) && (!q || `${form(i.type).short} ${i.site} ${siteName(i.site)} ${i.by} ${i.date} ${fmtDate(i.date)}`.toLowerCase().includes(q)));
  if (!done.length) { list.append(el("p", { class: "empty" }, q ? "Nothing matches." : "No completed checks here yet.")); return; }
  const row = i => el("button", { class: "row", type: "button", onclick: () => guard(() => openDetail(i.type, i.id)) },
    el("div", { class: "row-main" }, el("div", { class: "row-title" }, `${fmtDay(i.date)} · ${form(i.type).short}`),
      el("div", { class: "row-sub" }, `${i.by} · ${fmtTime(i.done_at)}${i.done_day > i.date || (i.done_day === i.date && i.done_at > form(i.type).due) ? " (late)" : ""}` + (i.source ? " · from AppSheet" : ""))),
    el("span", { class: "badge " + (i.bad ? "late" : "done") }, i.bad ? `${i.bad} not OK` : "All OK"));
  if (q) { done.forEach(i => list.append(row(i))); return; } // a search cuts across everything
  [...new Set(done.map(i => i.site))].sort((a, b) => kNum(a) - kNum(b)).forEach(code => {
    const recs = done.filter(i => i.site === code).sort((x, y) => String(y.date).localeCompare(String(x.date)) || TYPES.indexOf(y.type) - TYPES.indexOf(x.type)); // newest day first, its closing on top
    const group = el("details", { class: "group", open: App.site ? "" : null }, el("summary", {}, `${code} ${siteName(code)}`, el("span", { class: "count" }, recs.length)));
    recs.forEach(i => group.append(row(i)));
    list.append(group);
  });
}
$("home-search").oninput = e => { App.q = e.target.value; renderHome(); };
$("btn-lock").onclick = () => { session.clear(); App.cur = null; guard(loadLogin); };

/* ---------- start a check ---------- */
async function startCheck(type, site, date) {
  const { item, existing } = await api("create", { type, site, date });
  if (existing && item.status === "done") { toast(`${site} ${form(type).short} for ${fmtDate(item.date)} is already completed, by ${item.by}.`); return openDetail(type, item.id); }
  if (existing && item.by !== session.name) toast(`${item.by} started this one. Carrying on with it.`); // one check a site a day: everyone fills the same one
  App.cur = { type, item, dirty: {} };
  openForm();
}
function openNew() { // a site, the check and the day: for a check missed on an earlier day, or a site filtered out of the board
  show("scr-new");
  $("new-form").reset();
  $("new-site").replaceChildren(el("option", { value: "" }, "Choose site"), ...App.meta.sites.map(s => el("option", { value: s.code }, `${s.code} · ${s.name}`)));
  $("new-site").value = App.site || "";
  const t = todayISO(); $("new-date").value = t; $("new-date").max = t;
  const seg = $("new-type"); seg.replaceChildren(...TYPES.map(type => el("button", { type: "button", class: "seg-btn" + (type === App.newType ? " on" : ""), onclick: () => { App.newType = type; [...seg.children].forEach((b, i) => b.classList.toggle("on", TYPES[i] === type)); } }, form(type).short, el("small", { class: "seg-sub" }, `by ${fmtTime(form(type).due)}`))));
  if (!App.newType) seg.firstChild.click();
}
$("new-back").onclick = () => guard(loadHome);
$("new-form").onsubmit = ev => {
  ev.preventDefault();
  busyBtn($("new-form").querySelector("button[type=submit]"), "Starting…", () => startCheck(App.newType || "opening", $("new-site").value, $("new-date").value));
};

/* ---------- form ---------- */
async function resumeForm(type, id) {
  const { item } = await api("get", { type, id });
  if (item.status === "done") return openDetail(type, id);
  App.cur = { type, item, dirty: {} };
  openForm();
}
function openForm() {
  const { type, item } = App.cur;
  show("scr-form");
  $("form-title").textContent = `${item.site} ${siteName(item.site)} · ${form(type).short}`;
  $("form-sub").textContent = `${fmtDay(item.date)} · due by ${fmtTime(form(type).due)}`;
  setStatus("");
  const body = $("form-body"); body.replaceChildren(el("p", { class: "note", id: "form-note" }));
  form(type).sections.forEach(sec => {
    const card = el("section", { class: "card" }, el("h2", {}, sec.title));
    sec.fields.forEach(f => card.append(fieldEl(f)));
    if (card.children.length > 1) body.append(card);
  });
  body.append(discardBtn(type, item));
  syncWhen();
}
// only the person who started a check sees this; the row is deleted and its files go to the bin
function discardBtn(type, item) {
  if (item.by !== session.name) return "";
  return el("button", { class: "btn danger", type: "button", onclick: ev => {
    if (!sure(ev.currentTarget, "Tap again to discard it and its photos")) return;
    busyBtn(ev.currentTarget, "Discarding…", async () => { await api("discard", { type, id: item.id }); App.cur = null; toast("Discarded."); await loadHome(); });
  } }, "Discard this check");
}
function setStatus(s) { $("form-status").textContent = s; }

let saveTimer = null;
function queueSave(key, value) {
  const cur = App.cur;
  cur.dirty[key] = value; setStatus("Saving…");
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => flushSave().catch(e => guard(() => { throw e; })), 800);
}
document.addEventListener("visibilitychange", () => { flushSave().catch(() => {}); }); // going to the background: save now, not in 0.8 s
let saving = null; // the save in flight: Review and complete must not read the row before the last answer has landed
async function flushSave() {
  const cur = App.cur; clearTimeout(saveTimer);
  if (saving) await saving.catch(() => {});
  if (!cur || !Object.keys(cur.dirty).length) return;
  const data = cur.dirty; cur.dirty = {};
  saving = api("save", { type: cur.type, id: cur.item.id, data });
  try { await saving; setStatus("Saved"); }
  catch (e) { cur.dirty = Object.assign(data, cur.dirty); setStatus("Not saved"); throw e; }
  finally { saving = null; }
}

// the same rules as the backend (Code.gs active / missingFor / notOk): a photos cell holds one link per line; a field applies only at its sites,
// on its weekdays, while its yes/no is No (`whenNo`) or while its reading is out of range (`out`); `per` names a fridge slot per site
const links = v => String(v == null ? "" : v).split(/\r?\n/).map(x => x.trim()).filter(Boolean);
const ansOf = (item, k) => String(item[k] == null ? "" : item[k]).trim().toUpperCase();
const dow = iso => /^\d{4}-\d{2}-\d{2}$/.test(String(iso || "")) ? new Date(iso + "T12:00:00Z").getUTCDay() : -1;
const labelOf = (f, item) => f.per && f.per[item.site] && f.per[item.site].label ? f.per[item.site].label + (f.tail || "") : f.label;
const rangeOf = (f, item) => App.meta.ranges[f.per ? (f.per[item.site] || {}).kind : f.kind] || null;
const tempOf = v => { const s = String(v == null ? "" : v).trim().replace(/[−–]/g, "-"); return /^-?\d+(\.\d+)?$/.test(s) ? Number(s) : null; };
function isOut(f, item) { const r = rangeOf(f, item), v = tempOf(item[f.out || f.key]); return !!r && v != null && ((r.lo != null && v < r.lo) || (r.hi != null && v > r.hi)); }
function atSite(f, item) { return !f.legacy && !(f.sites && !f.sites.includes(String(item.site))) && !(f.per && !f.per[item.site]) && !(f.days && !f.days.includes(dow(item.date))); }
function activeField(f, item) {
  if (!atSite(f, item)) return false;
  if (f.whenNo && ansOf(item, f.whenNo) !== "N") return false;
  if (f.out && !isOut(f, item)) return false;
  return true;
}
const isMedia = f => f.type === "photos";
const fields = type => form(type).sections.flatMap(s => s.fields);
function missingFor(type, item) {
  return fields(type).filter(f => activeField(f, item)).filter(f => {
    const v = item[f.key], empty = v == null || String(v).trim() === "";
    if (f.type === "temp") return tempOf(v) == null;
    return (f.req && empty) || (f.min && links(v).length < f.min);
  }).map(f => isMedia(f) ? labelOf(f, item) + " (photo)" : labelOf(f, item));
}
const NOTHING = /^(-+|nil|n\.?a\.?|n\/a|none|no|0+|pending)$/i; // a remark that says nothing, left out as the backend leaves it out
function notOk(type, item) {
  const said = k => String(item[k] == null ? "" : item[k]).trim(), remark = k => NOTHING.test(said(k + "_note")) ? "" : said(k + "_note");
  return fields(type).filter(f => activeField(f, item) && ((f.type === "yesno" && ansOf(item, f.key) === "N") || (f.type === "temp" && isOut(f, item)))).map(f => f.type === "temp"
    ? { label: `${labelOf(f, item).replace(/ \(°C\)$/, "")} ${tempOf(item[f.key])} °C (should be ${rangeOf(f, item).text})`, note: remark(f.key) }
    : { label: f.short || f.label, note: remark(f.key) });
}
const badLine = b => b.label + (b.note ? ": " + b.note : "");
function syncWhen() { // remarks show only while a No or a reading out of range asks for one; the note at the top counts what is left
  const item = App.cur.item;
  document.querySelectorAll("#form-body [data-cond]").forEach(w => { w.hidden = !activeField(w._field, item); });
  document.querySelectorAll("#form-body [data-temp]").forEach(w => { w.classList.toggle("out", isOut(w._field, item)); });
  const n = $("form-note");
  if (n) { const bad = notOk(App.cur.type, item), left = missingFor(App.cur.type, item).length; n.textContent = (bad.length ? `${bad.length} not OK` : "Nothing marked not OK") + (left ? ` · ${left} still to answer` : " · everything answered"); }
}
function fieldEl(f) {
  const { item } = App.cur;
  if (!atSite(f, item)) return "";
  const node = fieldNode(f), hint = f.hint && !isMedia(f) ? el("span", { class: "hint" }, f.hint) : null;
  if (hint) node.append(hint);
  if (!f.whenNo && !f.out) return node;
  const wrap = el("div", { "data-cond": "", class: "cond" }, node); wrap._field = f;
  return wrap;
}
function fieldNode(f) {
  const { item } = App.cur, v = item[f.key];
  if (isMedia(f)) return galleryTile(f);
  if (f.type === "yesno") {
    const seg = el("div", { class: "seg" });
    const mk = (val, text) => el("button", { type: "button", class: "seg-btn " + (val === "Y" ? "yes" : "no") + (v === val ? " on" : ""), onclick: () => {
      item[f.key] = val; [...seg.children].forEach(b => b.classList.toggle("on", b.textContent === text)); queueSave(f.key, val); syncWhen();
    } }, text);
    seg.append(mk("Y", "Yes"), mk("N", "No"));
    return el("div", { class: "field q" }, el("span", { class: "label" }, f.label), seg);
  }
  if (f.type === "temp") { // a reading in °C; phones' number pads often have no minus key, so the sign is a button
    const r = rangeOf(f, item);
    const input = el("input", { type: "text", inputmode: "decimal", value: v == null ? "" : String(v), autocomplete: "off", "aria-label": labelOf(f, item) });
    const set = s => { item[f.key] = s; queueSave(f.key, s); syncWhen(); };
    input.oninput = () => set(input.value.trim().replace(/[−–]/g, "-"));
    const sign = el("button", { type: "button", class: "btn ghost small sign", "aria-label": "Plus or minus" }, "±");
    sign.onclick = () => { const s = input.value.trim(); input.value = s.startsWith("-") ? s.slice(1) : s ? "-" + s : "-"; set(input.value); input.focus(); };
    const wrap = el("div", { class: "field temp", "data-temp": "" }, el("span", { class: "label" }, labelOf(f, item)), el("div", { class: "temp-row" }, sign, input, el("span", { class: "unit" }, "°C")),
      el("span", { class: "hint" }, `Should be ${r ? r.text : "in range"}.`), el("span", { class: "out-msg" }, "Out of range: say what was done below."));
    wrap._field = f;
    return wrap;
  }
  const big = /_note$|^remarks$/.test(f.key);
  const input = el(big ? "textarea" : "input", { rows: big ? 2 : null, placeholder: f.ph || "", autocomplete: "off", "aria-label": labelOf(f, item) });
  input.value = v == null ? "" : String(v);
  input.oninput = () => { item[f.key] = input.value.trim(); queueSave(f.key, item[f.key]); syncWhen(); };
  return el("label", { class: "field" + (f.whenNo || f.out ? " remark" : "") }, el("span", { class: "label" }, labelOf(f, item), f.req ? el("span", { class: "field-sub" }, " · required") : null), input);
}

/* photos: resized on the phone, uploaded as they are taken */
// ponytail: quality knobs. 2048px @ 0.9 keeps detail legible (~1 MB); 1000px @ 0.8 is the copy the lists and the PDF use.
const FULL_EDGE = 2048, FULL_Q = 0.9, SMALL_EDGE = 1000, SMALL_Q = 0.8;
async function shrink(file, maxEdge, quality) { // via <img>, which every browser draws with EXIF rotation applied
  const url = URL.createObjectURL(file);
  try {
    const im = await new Promise((ok, err) => { const i = new Image(); i.onload = () => ok(i); i.onerror = err; i.src = url; });
    const scale = Math.min(1, maxEdge / Math.max(im.naturalWidth, im.naturalHeight));
    const c = document.createElement("canvas");
    c.width = Math.round(im.naturalWidth * scale); c.height = Math.round(im.naturalHeight * scale);
    c.getContext("2d").drawImage(im, 0, 0, c.width, c.height);
    return await new Promise(res => c.toBlob(res, "image/jpeg", quality));
  } finally { URL.revokeObjectURL(url); }
}
const b64 = blob => new Promise(res => { const r = new FileReader(); r.onload = () => res(r.result.split(",")[1]); r.readAsDataURL(blob); });
// photos come back through the API as base64 so the phone never needs a Google login; loaded when scrolled into view
const lazy = new IntersectionObserver(entries => entries.forEach(en => {
  if (!en.isIntersecting) return;
  lazy.unobserve(en.target); queue.push(en.target); pump();
}), { rootMargin: "300px" });
const queue = []; let loading = 0; // ponytail: three photo fetches at a time; each takes the backend seconds, a burst just stalls
function pump() {
  while (loading < 3 && queue.length) {
    const box = queue.shift(), img = box.querySelector("img[data-drive]");
    if (!img) continue; // the photo was deleted while the tile waited
    loading++; box.classList.add("loading");
    api("img", { fileId: idFromUrl(img.dataset.drive) })
      .then(r => { img.src = `data:${r.mime};base64,${r.b64}`; img.hidden = false; })
      .catch(e => { box.classList.add("failed"); if (e.auth) guard(() => Promise.reject(e)); })
      .finally(() => { box.classList.remove("loading"); loading--; pump(); });
  }
}
function showDriveImage(img, url) { img.dataset.drive = url; requestAnimationFrame(() => lazy.observe(img.parentElement || img)); }
function galleryTile(f) { // first photo as the thumbnail, a count, Add while under the maximum; tap to browse or delete
  const { type, item } = App.cur, label = labelOf(f, item);
  const list = () => links(item[f.key]);
  const img = el("img", { alt: "", hidden: true }), count = el("span", { class: "count" });
  const state = el("div", { class: "tile-state" });
  const add = el("button", { class: "btn ghost small", type: "button" }, "+ Take photo");
  const lib = el("button", { class: "linkbtn", type: "button" }, "Upload from gallery");
  const stop = ev => ev.stopPropagation(); // input.click() bubbles to the tile, which would open the viewer over the camera
  const input = el("input", { type: "file", accept: "image/*", capture: "environment", hidden: true, onclick: stop }); // camera
  const libInput = el("input", { type: "file", accept: "image/*", hidden: true, onclick: stop });                       // the phone's gallery
  const tile = el("div", { class: "tile gallery" },
    el("div", { class: "tile-img" }, img, el("span", { class: "tile-icon" }, "📷"), count),
    el("div", { class: "tile-cap" }, label, el("span", { class: "field-sub" }, ` · ${f.min ? "at least " + f.min : "optional"}, up to ${f.max}`)),
    state, f.hint ? el("span", { class: "hint" }, f.hint) : null, el("div", { class: "tile-actions" }, add, lib), input, libInput);
  const refresh = () => {
    const l = list(), n = l.length;
    count.textContent = n ? `${n} / ${f.max}` : ""; add.hidden = lib.hidden = n >= f.max;
    state.textContent = n ? `${n} photo${n > 1 ? "s" : ""} · tap to view` : "No photo yet";
    if (!n) { img.hidden = true; img.removeAttribute("src"); delete img.dataset.drive; }
    else if (idFromUrl(l[0]) && img.dataset.drive !== l[0]) { img.hidden = true; img.removeAttribute("src"); showDriveImage(img, l[0]); }
    syncWhen();
  };
  refresh();
  add.onclick = ev => { ev.stopPropagation(); if (!tile.classList.contains("busy")) input.click(); };
  lib.onclick = ev => { ev.stopPropagation(); if (!tile.classList.contains("busy")) libInput.click(); };
  input.onchange = () => picked(input); libInput.onchange = () => picked(libInput);
  const picked = inp => guard(async () => {
    const files = [...inp.files].slice(0, Math.max(0, f.max - list().length)); inp.value = "";
    if (!files.length) return;
    tile.classList.add("busy"); // from the first moment: a second tap while a photo is still being shrunk must not start a second upload
    try {
      for (const [i, file] of files.entries()) { // several picked from the gallery go up one after another
        const first = !list().length;
        state.textContent = files.length > 1 ? `Preparing ${i + 1} of ${files.length}…` : "Preparing…";
        const [full, small] = await Promise.all([shrink(file, FULL_EDGE, FULL_Q), shrink(file, SMALL_EDGE, SMALL_Q)]);
        if (first) { img.src = URL.createObjectURL(small); img.hidden = false; }
        state.textContent = files.length > 1 ? `Uploading ${i + 1} of ${files.length}…` : "Uploading…";
        try {
          const r = await api("upload", { type, id: item.id, key: f.key, mime: "image/jpeg", b64: await b64(full), b64s: await b64(small) });
          item[f.key] = r.value;
          if (first) img.dataset.drive = r.url; // the preview already shows it
        } catch (e) { if (e.auth) throw e; toast("Upload failed: " + e.message); break; }
      }
    } finally { tile.classList.remove("busy"); refresh(); }
  });
  libInput.multiple = true;
  tile.onclick = () => {
    const l = list();
    if (l.length) gallery(label, l, async url => { const r = await api("unphoto", { type, id: item.id, key: f.key, url }); item[f.key] = r.value; refresh(); });
  };
  return tile;
}
const mediaCache = {}; // one fetch per file, then a local URL
function mediaSrc(url) {
  if (!mediaCache[url]) mediaCache[url] = api("img", { fileId: idFromUrl(url) }).then(r => {
    const bytes = Uint8Array.from(atob(r.b64), c => c.charCodeAt(0));
    return URL.createObjectURL(new Blob([bytes], { type: r.mime }));
  }).catch(e => { delete mediaCache[url]; throw e; });
  return mediaCache[url];
}
function gallery(label, urls, onDelete) { // full-screen viewer: buttons through the list, delete while editing
  let i = 0;
  const stage = el("div", { class: "stage" }), cap = el("div", { class: "lightbox-cap" });
  const box = el("div", { class: "lightbox gallery" });
  const btn = (text, cls, fn) => el("button", { type: "button", class: "lb-btn " + cls, onclick: ev => { ev.stopPropagation(); fn(ev); } }, text);
  const close = () => { box.remove(); document.body.classList.remove("noscroll"); };
  const showAt = async n => {
    i = (n + urls.length) % urls.length;
    const u = urls[i];
    cap.textContent = `${label} · ${i + 1} of ${urls.length}`;
    stage.replaceChildren(el("div", { class: "lb-msg" }, "Loading…"));
    if (!idFromUrl(u)) { stage.replaceChildren(el("div", { class: "lb-msg" }, "Photo not available")); return; }
    try {
      const src = await mediaSrc(u);
      if (urls[i] !== u) return;
      stage.replaceChildren(el("img", { src, alt: label }));
    } catch (e) { stage.replaceChildren(el("div", { class: "lb-msg" }, "Could not load")); }
  };
  box.append(...[stage, cap, btn("✕", "lb-close", close),
    urls.length > 1 ? btn("‹", "lb-prev", () => showAt(i - 1)) : null,
    urls.length > 1 ? btn("›", "lb-next", () => showAt(i + 1)) : null,
    onDelete ? btn("Delete", "lb-del", ev => {
      if (!sure(ev.currentTarget, "Tap again to delete")) return;
      const u = urls[i];
      guard(async () => { await onDelete(u); urls.splice(i, 1); if (!urls.length) return close(); showAt(i); });
    }) : null].filter(Boolean)); // DOM append would print an absent button as "null"
  box.onclick = close; stage.onclick = ev => ev.stopPropagation();
  document.body.append(box); document.body.classList.add("noscroll");
  showAt(0);
}
$("form-back").onclick = () => guard(async () => {
  if (document.querySelector("#form-body .tile.busy")) { toast("Wait for the upload to finish."); return; } // leaving mid-upload would show the photo missing and invite a second one
  await flushSave(); await loadHome();
});
$("btn-complete").onclick = () => {
  const { type, item } = App.cur;
  if (document.querySelector("#form-body .tile.busy")) { toast("Wait for the upload to finish."); return; }
  const missing = missingFor(type, item);
  if (missing.length) { toast("Still needed: " + missing.slice(0, 4).join(", ") + (missing.length > 4 ? ` and ${missing.length - 4} more` : "")); return; }
  // the PDF is shown first; nothing is filed until "Complete check" on that page
  busyBtn($("btn-complete"), "Preparing preview…", async () => { await flushSave(); showPreview(type, item, await api("preview", { type, id: item.id })); });
};
async function finish(type, item) { // files the PDF and marks the check done
  await flushSave();
  const r = await api("complete", { type, id: item.id });
  toast(r.mailError ? "Completed and saved to Drive, but the email did not go out: " + r.mailError : "Completed. PDF saved to Drive.");
  await openDetail(type, item.id);
}
let previewFrom = 0; // where the form was scrolled to, for Back
function showPreview(type, item, r) { // the PDF's own page, to read through before it is filed; Back returns to the form untouched
  previewFrom = window.scrollY;
  show("scr-preview");
  $("preview-sub").textContent = `${item.site} ${siteName(item.site)} · ${form(type).short} · ${fmtDay(item.date)}`;
  $("preview-note").textContent = `This is the PDF report. "Complete check" files it in the site's Drive folder${r.cc ? " and emails a copy to " + r.cc : ""}.`;
  const host = el("div", { class: "paper" }); // a shadow root keeps the report's own styles inside it
  host.attachShadow({ mode: "open" }).innerHTML = r.html.replace("body {", ":host { font-size: 13px !important; ");
  $("preview-paper").replaceChildren(host);
}
$("preview-back").onclick = () => { show("scr-form"); window.scrollTo(0, previewFrom); };
$("btn-send").onclick = () => { const { type, item } = App.cur; busyBtn($("btn-send"), "Generating PDF…", () => finish(type, item)); };

/* ---------- record ---------- */
function display(f, v) {
  if (v == null || v === "") return "—";
  if (f.type === "yesno") return v === "Y" ? "Yes" : v === "N" ? "No" : String(v);
  if (f.type === "temp") return tempOf(v) == null ? String(v) : tempOf(v) + " °C";
  return String(v);
}
async function openDetail(type, id) {
  show("scr-detail");
  const body = $("detail-body"); body.replaceChildren(el("p", { class: "empty" }, "Loading…"));
  const { item } = await api("get", { type, id });
  const done = item.status === "done";
  $("detail-title").textContent = `${item.site} ${siteName(item.site)} · ${form(type).short}`;
  $("detail-sub").textContent = `${fmtDay(item.date)} · ${item.by}` + (done && item.completed_at ? ` · completed ${new Date(item.completed_at).toLocaleString("en-SG", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}` : "");
  body.replaceChildren();
  const actions = el("div", { class: "actions" });
  if (!done) actions.append(el("button", { class: "btn primary", type: "button", onclick: () => guard(() => resumeForm(type, id)) }, "Continue check"));
  if (item.pdf) actions.append(el("a", { class: "btn dark", href: item.pdf, target: "_blank", rel: "noopener" }, "Open PDF"));
  if (done && !item.source) actions.append(el("button", { class: "btn ghost", type: "button", onclick: ev => { // a check imported from AppSheet stays as it was
    if (!sure(ev.currentTarget, "Tap again to reopen it: the PDF is replaced when it is completed again")) return;
    guard(async () => { await api("reopen", { type, id }); await resumeForm(type, id); });
  } }, "Reopen to correct it"));
  if (item.source) actions.append(el("p", { class: "muted small" }, "Recorded in the old AppSheet app; shown as it was filed there."));
  body.append(actions);
  const bad = notOk(type, item);
  body.append(el("section", { class: "card" }, el("h2", {}, "Not OK"), bad.length ? el("ul", { class: "bad" }, bad.map(b => el("li", {}, badLine(b)))) : el("p", { class: "muted" }, "Everything checked was OK.")));
  form(type).sections.forEach(sec => {
    const card = el("section", { class: "card" }, el("h2", {}, sec.title));
    const fs = sec.fields.filter(f => activeField(f, item) || (atSite(f, item) && item[f.key] != null && String(item[f.key]).trim() !== ""));
    const rows = fs.filter(f => !isMedia(f)), pics = fs.filter(f => isMedia(f) && links(item[f.key]).length); // an empty photo field is not worth a tile
    if (!rows.length && !pics.length) return;
    const red = f => (f.type === "yesno" && item[f.key] === "N") || (f.type === "temp" && isOut(f, item));
    if (rows.length) card.append(el("dl", {}, rows.map(f => [el("dt", {}, labelOf(f, item)), el("dd", { class: red(f) ? "no" : "" }, display(f, item[f.key]))])));
    if (pics.length) {
      const g = el("div", { class: "grid" });
      pics.forEach(f => {
        const urls = links(item[f.key]), n = urls.length, has = n && idFromUrl(urls[0]), label = labelOf(f, item);
        const img = el("img", { alt: label, hidden: true });
        if (has) showDriveImage(img, urls[0]);
        g.append(el("figure", { onclick: () => { if (has) gallery(label, urls); } },
          el("div", { class: "tile-img" }, img, has ? null : el("span", { class: "muted small" }, "not available"), n > 1 ? el("span", { class: "count" }, String(n)) : null),
          el("figcaption", {}, label)));
      });
      card.append(g);
    }
    body.append(card);
  });
  if (!done) body.append(discardBtn(type, item));
}
$("detail-back").onclick = () => guard(loadHome);

/* ---------- boot ---------- */
(async () => {
  if (!API_URL) $("demo-banner").hidden = false;
  // the demo and the real app share this origin's storage: switching between them starts clean, so demo rows never paint over real ones
  const mode = API_URL ? "live" : "demo";
  if (localStorage.getItem("sc.mode") !== mode) {
    Object.keys(localStorage).filter(k => k.startsWith("sc.") && k !== "sc.api").forEach(k => localStorage.removeItem(k));
    localStorage.setItem("sc.mode", mode);
  }
  if (session.token) { // stays signed in until Lock is tapped or the server session ends
    try { await enterApp(); return; }
    catch (e) {
      if (e.auth) session.clear();                 // the server no longer knows this session: sign in again
      else { toast(e.message); if (App.meta) return; } // a network blip: keep the session and whatever is on screen
    }
  }
  guard(loadLogin);
})();
