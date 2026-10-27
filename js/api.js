/* Backend client: where the API lives, the session, and a demo mode used when
 * no API URL is configured (the demo reads the form spec from the real backend
 * file, so it can never drift from it). */
"use strict";

// The deployed Apps Script web app. A localStorage override lets a phone point at a test
// deployment: localStorage.setItem("sc.api", url). ?demo=1 runs the in-page demo instead (PIN 1234).
// Deployed 27 Oct 2026 (the Site Checks sheet's script, version 1).
const API_URL = new URLSearchParams(location.search).get("demo") ? ""
  : localStorage.getItem("sc.api") || "https://script.google.com/macros/s/AKfycbyzcv6HBbscnBiPNDe7SLw50y_v8WmzPUhZ_4B-aT2yJPEud0Y0FnG8mL8apiiBAlxx/exec";

const session = {
  get token() { return localStorage.getItem("sc.token") || ""; },
  get name() { return localStorage.getItem("sc.name") || ""; },
  save(a) { localStorage.setItem("sc.token", a.token); localStorage.setItem("sc.name", a.name); },
  clear() { ["sc.token", "sc.name", "sc.home", "sc.meta"].forEach(k => localStorage.removeItem(k)); }, // Lock leaves nothing of the records on a shared phone
};

let inflight = 0; // while any call is in flight the page shows the moving bar at the top (body.busy)
// Apps Script sometimes answers a POST with its ping page or an HTML error even though the script may have run, so only
// actions that are safe to repeat are sent again by themselves; upload reports the error and the person retries.
const RETRY_SAFE = ["list", "meta", "get", "img", "roster", "create", "save", "unphoto", "preview", "complete", "discard", "reopen"]; // create: a repeat finds the check the first try made
async function api(action, payload, attempt) {
  attempt = attempt || 0;
  try { return await apiOnce(action, payload); }
  catch (e) {
    if (action === "discard" && attempt > 0 && /^not found/.test(e.message || "")) return { ok: true }; // the first try did it, Apps Script lost the answer
    const again = e.retry && RETRY_SAFE.includes(action) && attempt < (e.retry === "ping" ? 2 : 1);
    if (!again) throw e;
    await new Promise(r => setTimeout(r, 1200 * (attempt + 1)));
    return api(action, payload, attempt + 1);
  }
}
async function apiOnce(action, payload) {
  const body = Object.assign({ action, token: session.token }, payload || {});
  inflight++; document.body.classList.add("busy");
  try {
    let data;
    if (!API_URL) data = await mock(body);
    else {
      // text/plain keeps the request "simple": Apps Script cannot answer a CORS preflight
      const res = await fetch(API_URL, { method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" }, body: JSON.stringify(body) });
      const text = await res.text();
      try { data = JSON.parse(text); } catch (e) { const err = new Error("The server is busy. Try again in a moment."); err.retry = "html"; throw err; }
      // a POST that Google turns into a GET lands on doGet and answers the ping; never treat that as data
      if (data.app === "site-checks" && !data.items && !data.forms && !data.item && action !== "ping") { const err = new Error("The server is busy. Try again in a moment."); err.retry = "ping"; throw err; }
    }
    if (data.error) { const e = new Error(data.error); e.auth = !!data.auth; throw e; }
    return data;
  } finally { if (--inflight === 0) document.body.classList.remove("busy"); }
}

/* ---------- demo mode: same actions, in memory, PIN 1234. Every name here is invented. ---------- */
let demo = null;
async function mock(b) {
  const d0 = new Date(), today = new Date(d0.getTime() - d0.getTimezoneOffset() * 60000).toISOString().slice(0, 10), hm = d0.toTimeString().slice(0, 5);
  if (!demo) {
    const src = await (async () => { for (const u of ["backend/Code.gs", "../backend/Code.gs"]) { const r = await fetch(u).catch(() => null); if (r && r.ok) return r.text(); } throw new Error("Demo mode needs backend/Code.gs served beside the app (run the server from the project folder)."); })();
    const C = new Function(src + "\nreturn { FORMS, RANGES, DAILY_SITES, DAYS_BACK, fieldsOf, active, missingFor, notOk, dailyStatus, addDays, rangeOf };")();
    const PIC = "https://drive.google.com/open?id=demo-pic"; // one invented photo stands in wherever a seed needs one
    const allOk = (type, site, date) => { const o = { site, date }; C.fieldsOf(type).filter(f => C.active(f, o)).forEach(f => {
      if (f.type === "yesno") o[f.key] = "Y"; if (f.type === "photos") o[f.key] = PIC; if (f.type === "temp") o[f.key] = C.rangeOf(f, o).hi === 5 ? "3" : "-20"; }); return o; };
    const rows = [], who = ["Demo Supervisor", "Demo Staff", "Staffie"];
    let n = 0;
    const seed = (type, site, date, at, extra) => { const ok = allOk(type, site, date), stamp = new Date(`${at.day || date}T${at.time}:00`).toISOString();
      rows.push(Object.assign(ok, { type, id: `${C.FORMS[type].prefix}-demo-${++n}`, status: "done", site, date, by: who[n % 3], created_at: stamp, completed_at: stamp, folder: "demo", pdf: "https://drive.google.com/open?id=demo-pdf", source: "" }, extra || {})); };
    // a week of checks: nearly all on time, a few late, two never done, one left as a draft
    for (let back = C.DAYS_BACK; back >= 1; back--) {
      const date = C.addDays(today, -back);
      C.DAILY_SITES.forEach((site, i) => {
        if (!(back === 3 && site === "S9")) seed("opening", site, date, { time: (back + i) % 5 === 0 ? "10:52" : "10:0" + i });
        if ((C.FORMS.middle.sites || []).includes(site) && !(back === 4 && site === "S6")) seed("middle", site, date, { time: (back + i) % 7 === 0 ? "16:2" + i : "15:1" + i });
        if (back === 2 && site === "S12") rows.push(Object.assign(allOk("closing", site, date), { type: "closing", id: "CL-demo-draft", status: "draft", site, date, by: "Demo Staff", created_at: new Date(`${date}T21:40:00`).toISOString(), completed_at: "", folder: "", pdf: "", source: "", corridor_photo: "" }));
        else if (!(back === 5 && site === "S3")) seed("closing", site, date, { time: (back + i) % 6 === 0 ? "22:25" : "21:4" + i });
      });
    }
    seed("opening", "S1", today, { time: "10:05" }, { lights_on: "N", lights_on_note: "Two tubes out at the pantry, raised on Infraspeak", walkin_freezer: "-14", walkin_freezer_note: "Door left ajar overnight; closed, rechecked at 10:30: -19" });
    rows.push(Object.assign({ type: "opening", id: "OP-demo-today", status: "draft", site: "S3", date: today, by: "Demo Staff", created_at: new Date().toISOString(), completed_at: "", folder: "", pdf: "", source: "" }, { clock_in: "Y", lights_on: "Y", tv_on: "Y" }));
    demo = { C, rows, n: 0, files: { "demo-pic": { mime: "image/png", b64: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=" } },
      names: who, sites: [["S1", "Tampines"], ["S3", "Sembawang"], ["S6", "Bishan"], ["S9", "Bukit Batok"], ["S12", "Mediapolis"]].map(([code, name]) => ({ code, name, address: "" })) };
  }
  await new Promise(r => setTimeout(r, 120));
  const C = demo.C;
  const meta = () => ({ sites: demo.sites, forms: C.FORMS, ranges: C.RANGES, daysBack: C.DAYS_BACK, company: "KitchenBASE (demo)" });
  const find = id => { const r = demo.rows.find(r => r.id === id); if (!r) throw new Error("not found"); return r; };
  const missing = r => { const m = C.missingFor(r.type, r); if (m.length) throw new Error("Missing: " + m.join(", ")); };
  const local = iso => { const d = new Date(iso); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString(); };
  try {
    switch (b.action) {
      case "roster": return { names: demo.names };
      case "login": if (String(b.pin) !== "1234") return { error: "Wrong PIN. The demo PIN is 1234." }; demo.user = b.name; return Object.assign({ token: "demo", name: b.name }, meta());
    }
    if (b.token !== "demo") return { error: "Session expired. Log in again.", auth: true };
    switch (b.action) {
      case "meta": return meta();
      case "list": {
        const items = demo.rows.map(r => ({ type: r.type, id: r.id, status: r.status, site: r.site, date: r.date, by: r.by, created_at: r.created_at, completed_at: r.completed_at, pdf: r.pdf, source: r.source,
          done_day: r.completed_at ? local(r.completed_at).slice(0, 10) : "", done_at: r.completed_at ? local(r.completed_at).slice(11, 16) : "", bad: r.status === "done" ? C.notOk(r.type, r).length : 0 }))
          .sort((a, c) => String(c.created_at).localeCompare(String(a.created_at)));
        return { items, days: C.dailyStatus(items, today, hm) };
      }
      case "get": return { item: find(b.id) };
      case "create": {
        if (!C.DAILY_SITES.includes(b.site)) return { error: "Pick one of the sites that do the daily checks." };
        if (C.FORMS[b.type].sites && !C.FORMS[b.type].sites.includes(b.site)) return { error: `${b.site} does not do the ${C.FORMS[b.type].short} check.` };
        const date = b.date || today;
        if (date > today) return { error: "A check cannot be for a day still to come." };
        const mine = demo.rows.filter(r => r.type === b.type && r.site === b.site && r.date === date), open = mine.find(r => r.status === "done") || mine.find(r => r.status === "draft");
        if (open) return { item: open, existing: true };
        const item = { type: b.type, id: `${C.FORMS[b.type].prefix}-${date.replace(/-/g, "")}-${++demo.n}`, status: "draft", site: b.site, date, by: demo.user || "Demo Staff",
          created_at: new Date().toISOString(), completed_at: "", folder: "demo", pdf: "", source: "" };
        demo.rows.push(item);
        return { item };
      }
      case "save": return { item: Object.assign(find(b.id), b.data) };
      case "upload": { const fileId = "f" + (++demo.n); demo.files[fileId] = { mime: "image/jpeg", b64: b.b64s || b.b64 };
        const url = "https://drive.google.com/open?id=" + fileId, r = find(b.id), f = C.fieldsOf(r.type).find(x => x.key === b.key);
        const have = String(r[b.key] || "").split("\n").filter(Boolean);
        if (have.length >= f.max) return { error: `${f.label}: ${f.max} photos is the maximum.` };
        r[b.key] = have.concat(url).join("\n"); return { url, fileId, value: r[b.key] }; }
      case "unphoto": { const r = find(b.id); r[b.key] = String(r[b.key] || "").split("\n").filter(u => u && u !== b.url).join("\n"); return { value: r[b.key] }; }
      case "preview": { const r = find(b.id); missing(r); const bad = C.notOk(r.type, r), esc = s => String(s).replace(/[<&]/g, "");
        return { html: `<style>body { font-family: sans-serif }</style><h1>Demo preview</h1><p>${esc(C.FORMS[r.type].title)} · ${esc(r.site)} · ${esc(r.date)}</p><p>${bad.length ? "Not OK: " + bad.map(x => esc(x.label + (x.note ? ": " + x.note : ""))).join(", ") : "Everything checked was OK."}</p><p>The live app shows the PDF report here.</p>`, cc: "" }; }
      case "complete": { const r = find(b.id); missing(r);
        Object.assign(r, { status: "done", completed_at: new Date().toISOString(), pdf: "https://drive.google.com/open?id=demo-pdf" });
        return { pdf: r.pdf }; }
      case "reopen": { const r = find(b.id); Object.assign(r, { status: "draft", completed_at: "", pdf: "" }); return { ok: true }; }
      case "discard": { demo.rows = demo.rows.filter(r => r.id !== b.id); return { ok: true }; }
      case "img": return demo.files[b.fileId] || { error: "no such file" };
    }
    return { error: "unknown action " + b.action };
  } catch (e) { return { error: e.message }; }
}
