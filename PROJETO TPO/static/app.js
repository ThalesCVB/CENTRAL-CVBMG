"use strict";
/* Central CVB-MG: tarefas por setor, reuniões do Plaud, notificações e calendário */

// ---------- utilidades ----------
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const pad = n => String(n).padStart(2, "0");
const wait = ms => new Promise(r => setTimeout(r, ms));

let me = null, sectors = [], tasks = [], notifs = { items: [], unread: 0 }, users = [];
let calMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
let homeSector = "", qFilter = { sector: "", assignee: "", priority: "" }, myTab = "all", notifTab = "all", meetSector = "";

async function api(method, url, body) {
  const r = await fetch(url, { method, headers: body ? { "Content-Type": "application/json" } : {}, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json();
  if (r.status === 401 && !/\/api\/(login|setup|invite|forgot)/.test(url)) { me = null; render(); throw new Error(j.error); }
  if (!r.ok) throw new Error(j.error || r.statusText);
  return j;
}

const ROLE_NAMES = { admin: "Administrador (TI)", gestor: "Gestor", membro: "Membro", leitor: "Leitor" };
const STATUS = { todo: "A fazer", doing: "Em andamento", done: "Concluído", blocked: "Bloqueado" };
const STATUS_ORDER = ["todo", "doing", "done", "blocked"];
const PRIORITY = { alta: "Alta", media: "Média", baixa: "Baixa" };
const SWATCHES = ["#E51E2A", "#F59E0B", "#F2D600", "#10B981", "#1687F8", "#60A5FA", "#9B5DE5", "#FF78CB", "#D6A6A6", "#8795A7"];
const isAdmin = () => me && me.role === "admin";
const isStaff = () => me && ["admin", "gestor"].includes(me.role);                 // gestão: vê e edita tudo
const canComplete = () => me && ["admin", "gestor", "membro"].includes(me.role);   // concluir e comentar

const ICONS = {
  home: '<path d="m3 11 9-8 9 8v9a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1z"/>',
  grid: '<rect x="3" y="4" width="8" height="7" rx="1"/><rect x="13" y="4" width="8" height="7" rx="1"/><rect x="3" y="13" width="8" height="7" rx="1"/><rect x="13" y="13" width="8" height="7" rx="1"/>',
  check: '<rect x="4" y="3" width="16" height="18" rx="3"/><path d="m8 12 2.5 2.5L16 9"/>',
  bell: '<path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 10h18"/>',
  file: '<path d="M6 3h9l5 5v13H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z"/><path d="M14 3v6h6M8 13h8M8 17h8"/>',
  monitor: '<rect x="3" y="4" width="18" height="13" rx="2"/><path d="M8 21h8M12 17v4"/>',
  users: '<circle cx="9" cy="8" r="3"/><path d="M3 20v-2a6 6 0 0 1 12 0v2M16 5a3 3 0 0 1 0 6M18 14a5 5 0 0 1 3 4v2"/>',
  wallet: '<rect x="3" y="6" width="18" height="14" rx="2"/><path d="M7 6V4h10v2M3 11h18"/>',
  cart: '<circle cx="9" cy="20" r="1"/><circle cx="19" cy="20" r="1"/><path d="M2 3h2l3 13h13l3-9H5"/>',
  car: '<rect x="2" y="7" width="20" height="12" rx="2"/><path d="M6 7l2-4h8l2 4M6 19v2M18 19v2M7 12h.01M17 12h.01"/>',
  folder: '<path d="M3 5a2 2 0 0 1 2-2h5l2 3h7a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  search: '<circle cx="10.8" cy="10.8" r="6.8"/><path d="m16 16 4.5 4.5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  chat: '<path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z"/>',
  mic: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  checkc: '<circle cx="12" cy="12" r="9"/><path d="m8 12 2.5 2.5L16 9"/>',
  tasks: '<rect x="4" y="4" width="16" height="17" rx="2"/><path d="M8 2v4M16 2v4M4 9h16M8 13h3M8 17h7"/>',
  chevL: '<path d="m15 18-6-6 6-6"/>', chevR: '<path d="m9 18 6-6-6-6"/>', chevD: '<path d="m6 9 6 6 6-6"/>',
  menu: '<path d="M4 6h16M4 12h16M4 18h16"/>', x: '<path d="M6 6l12 12M18 6 6 18"/>',
};
const ic = (n, s = 18) => `<svg viewBox="0 0 24 24" width="${s}" height="${s}" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[n] || ""}</svg>`;

const initials = n => String(n || "?").trim().split(/\s+/).slice(0, 2).map(p => p[0]).join("").toUpperCase();
function paintAvatar(el, u) {
  el.style.backgroundImage = u && u.avatar ? `url("${u.avatar}")` : "";
  el.textContent = u && u.avatar ? "" : initials(u && u.name);
}
const avatarHtml = name => name ? `<span class="avatar" title="${esc(name)}">${esc(initials(name))}</span>` : `<span class="avatar empty" title="Sem responsável">?</span>`;
const sameDay = (a, b) => a.toDateString() === b.toDateString();
function dueLabel(s) {
  if (!s) return "";
  const d = new Date(s), now = new Date(), t = new Date(now), y = new Date(now);
  t.setDate(t.getDate() + 1); y.setDate(y.getDate() - 1);
  if (sameDay(d, now)) return `Hoje, ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  if (sameDay(d, t)) return "Amanhã";
  if (sameDay(d, y)) return "Ontem";
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}`;
}
const fmtDateTime = s => s ? new Date(s).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "";
const isLate = t => t.status !== "done" && t.due && new Date(t.due) < new Date();
function timeAgo(iso) {
  const s = (Date.now() - new Date(iso)) / 1000;
  if (s < 60) return "agora";
  if (s < 3600) return `há ${Math.floor(s / 60)} min`;
  if (s < 86400) return `há ${Math.floor(s / 3600)} h`;
  if (s < 172800) return "ontem";
  return new Date(iso).toLocaleDateString("pt-BR");
}
const byDue = (a, b) => (a.due ? new Date(a.due) : 8.64e15) - (b.due ? new Date(b.due) : 8.64e15) || a.id - b.id;
const myTasks = () => tasks.filter(t => t.assignee_id === me.id);
const stripe = t => t.color || (t.status === "done" ? "#10B981" : t.sector_color);

function toast(msg) {
  const el = $("#toast"); el.textContent = msg; el.hidden = false;
  clearTimeout(toast.t); toast.t = setTimeout(() => { el.hidden = true; }, 2600);
}

// ---------- modal ----------
function openModal(html, narrow) {
  $("#modalBody").className = "modal" + (narrow ? " narrow" : "");
  $("#modalBody").innerHTML = `<button class="close" id="mclose" aria-label="Fechar">${ic("x", 18)}</button>` + html;
  $("#modal").hidden = false;
  $("#mclose").onclick = closeModal;
}
function closeModal() { $("#modal").hidden = true; $("#modalBody").innerHTML = ""; }
$("#modal").addEventListener("mousedown", e => { if (e.target.id === "modal") closeModal(); });
document.addEventListener("keydown", e => {
  if (e.key === "Escape") { closeModal(); $("#popover").hidden = true; $("#searchResults").hidden = true; closeDrawer(); }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k" && me) { e.preventDefault(); $("#search").focus(); $("#search").select(); }
});

// ---------- dados ----------
async function loadData() {
  const [s, t, n] = await Promise.all([api("GET", "/api/sectors"), api("GET", "/api/tasks"), api("GET", "/api/notifications")]);
  sectors = s; tasks = t; notifs = n;
  if (isStaff()) users = await api("GET", "/api/users"); else users = [];
}
async function refresh(msg) {
  await loadData();
  render();
  if (msg) toast(msg);
}
async function refreshBell() {
  if (!me || document.hidden) return;
  try { notifs = await api("GET", "/api/notifications"); paintBell(); paintSidebar(); if (parseRoute().name === "home") paintRight(); } catch { /* sessão caiu */ }
}
setInterval(refreshBell, 60000);

// ---------- roteamento ----------
function parseRoute() {
  const h = location.hash || "#/";
  let m;
  if ((m = h.match(/^#\/convite\/(t[0-9a-f]+)$/))) return { name: "invite", token: m[1] };
  if ((m = h.match(/^#\/setor\/(\d+)$/))) return { name: "sector", id: +m[1] };
  const map = { "#/quadros": "boards", "#/minhas-tarefas": "mine", "#/notificacoes": "notifs", "#/calendario": "calendar", "#/arquivos": "files", "#/reunioes": "meetings" };
  return { name: map[h] || "home" };
}
window.addEventListener("hashchange", () => { closeModal(); closeDrawer(); render(); });

function render() {
  const r = parseRoute();
  if (r.name === "invite") return showInvite(r.token);
  if (!me) return showLogin();
  $("#auth").hidden = true; $("#shell").hidden = false;
  $("#layout").classList.toggle("no-right", r.name !== "home");
  paintHeader(); paintSidebar();
  const main = $("#main");
  ({ home: pageHome, boards: pageBoards, mine: pageMine, notifs: pageNotifs, calendar: pageCalendar, files: pageFiles, meetings: pageMeetings, sector: pageSector }[r.name])(main, r);
  if (r.name === "home") paintRight();
  window.scrollTo(0, 0);
}

// ---------- cabeçalho e menu ----------
function paintHeader() {
  $("#userAvatar").className = "avatar"; paintAvatar($("#userAvatar"), me);
  $("#userName").textContent = me.name; $("#userRole").textContent = ROLE_NAMES[me.role];
  $("#bellIcon").innerHTML = ic("bell", 21); $("#searchIcon").innerHTML = ic("search");
  $("#userChevron").innerHTML = ic("chevD", 15); $("#openDrawer").innerHTML = ic("menu", 20);
  paintBell();
}
function paintBell() { const c = $("#bellCount"); c.hidden = !notifs.unread; c.textContent = notifs.unread > 99 ? "99+" : notifs.unread; }
function paintSidebar() {
  const r = parseRoute();
  const open = myTasks().filter(t => t.status !== "done").length;
  const item = (name, label, href, icon, badge) => `<a class="nav-item ${r.name === name ? "active" : ""}" href="${href}" title="${label}">${ic(icon)}<span class="nav-label">${label}</span>${badge ? `<span class="nav-badge">${badge}</span>` : ""}</a>`;
  $("#sidebar").innerHTML = `<nav class="nav-group">
      ${item("home", "Início", "#/", "home")}${item("boards", "Quadros", "#/quadros", "grid")}
      ${item("mine", "Minhas tarefas", "#/minhas-tarefas", "check", open)}${item("notifs", "Notificações", "#/notificacoes", "bell", notifs.unread)}
      ${item("calendar", "Calendário", "#/calendario", "calendar")}${item("files", "Arquivos", "#/arquivos", "file")}${item("meetings", "Reuniões", "#/reunioes", "mic")}
    </nav><div class="nav-separator"></div><div class="nav-heading">Setores</div>
    <nav class="nav-group">${sectors.map(s => `<a class="nav-item sector ${r.name === "sector" && r.id === s.id ? "selected" : ""}" href="#/setor/${s.id}" title="${esc(s.name)}">${ic(s.icon)}<span class="nav-label">${esc(s.name)}</span></a>`).join("") || `<span class="muted" style="padding:0 15px;font-size:11px">Você ainda não foi adicionado a nenhum setor.</span>`}</nav>
    <div class="principles">Humanidade<br>Imparcialidade<br>Neutralidade<br>Independência<br>Voluntariado<br>Unidade<br>Universalidade</div>`;
  $$(".nav-item", $("#sidebar")).forEach(a => a.addEventListener("click", closeDrawer));
}
function closeDrawer() { $("#sidebar").classList.remove("open"); $("#drawerOverlay").classList.remove("open"); }
$("#openDrawer").onclick = () => { $("#sidebar").classList.add("open"); $("#drawerOverlay").classList.add("open"); };
$("#drawerOverlay").onclick = closeDrawer;
$("#bell").onclick = () => { location.hash = "#/notificacoes"; };

// tema claro/escuro (lembrado neste navegador)
const theme = () => document.documentElement.dataset.theme === "light" ? "light" : "dark";
function setTheme(t) {
  document.documentElement.dataset.theme = t;
  try { localStorage.setItem("cvb-theme", t); } catch { }
  const m = $('meta[name="theme-color"]'); if (m) m.content = t === "light" ? "#FFFFFF" : "#0A111A";
}
const themeLabel = () => theme() === "light" ? "Tema escuro" : "Tema claro";

// menu do usuário
$("#userMenu").onclick = e => {
  e.stopPropagation();
  const p = $("#popover");
  if (!p.hidden) { p.hidden = true; return; }
  p.innerHTML = `<div class="who"><strong>${esc(me.name)}</strong><small>${esc(me.email)}</small><small>${ROLE_NAMES[me.role]}</small></div>
    <button id="pm_profile">Meu perfil</button><button id="pm_theme">${themeLabel()}</button>${isAdmin() ? `<button id="pm_users">Usuários e convites</button><button id="pm_settings">Configurações</button>` : ""}<button id="pm_out">Sair</button>`;
  p.hidden = false;
  $("#pm_profile").onclick = () => { p.hidden = true; openProfile(); };
  $("#pm_theme").onclick = () => { p.hidden = true; setTheme(theme() === "light" ? "dark" : "light"); };
  if (isAdmin()) { $("#pm_users").onclick = () => { p.hidden = true; openUsers(); }; $("#pm_settings").onclick = () => { p.hidden = true; openSettings(); }; }
  $("#pm_out").onclick = async () => { p.hidden = true; await api("POST", "/api/logout", {}).catch(() => { }); me = null; tasks = []; sectors = []; location.hash = "#/"; render(); };
};
document.addEventListener("click", e => { if (!e.target.closest("#popover") && !e.target.closest("#userMenu")) $("#popover").hidden = true; if (!e.target.closest(".search-wrap")) $("#searchResults").hidden = true; });

// ---------- busca (Ctrl+K) ----------
$("#search").addEventListener("input", () => {
  const q = $("#search").value.trim().toLowerCase(), box = $("#searchResults");
  if (!q) { box.hidden = true; return; }
  const has = (...f) => f.some(x => String(x || "").toLowerCase().includes(q));
  const T = tasks.filter(t => has(t.title, t.sector_name, t.assignee_name)).slice(0, 8);
  const S = sectors.filter(s => has(s.name)).slice(0, 4);
  const P = isStaff() ? users.filter(u => has(u.name, u.email)).slice(0, 4) : [];
  let html = "";
  if (T.length) html += `<div class="sr-group">Tarefas</div>` + T.map(t => `<div class="sr-item" data-sr="task:${t.id}">${ic("check", 16)}<span>${esc(t.title)}</span><small>${esc(t.sector_name)} · ${STATUS[t.status]}</small></div>`).join("");
  if (S.length) html += `<div class="sr-group">Setores</div>` + S.map(s => `<div class="sr-item" data-sr="sector:${s.id}">${ic(s.icon, 16)}<span>${esc(s.name)}</span></div>`).join("");
  if (P.length) html += `<div class="sr-group">Pessoas</div>` + P.map(u => `<div class="sr-item" data-sr="user:${u.id}">${ic("users", 16)}<span>${esc(u.name)}</span><small>${esc(ROLE_NAMES[u.role])}</small></div>`).join("");
  box.innerHTML = html || `<div class="sr-empty">Nada encontrado para “${esc(q)}”.</div>`;
  box.hidden = false;
  $$(".sr-item", box).forEach(el => el.onclick = () => {
    const [kind, id] = el.dataset.sr.split(":");
    box.hidden = true; $("#search").value = "";
    if (kind === "task") openTask(+id);
    else if (kind === "sector") location.hash = "#/setor/" + id;
    else { qFilter = { sector: "", assignee: id, priority: "" }; location.hash = "#/quadros"; render(); }
  });
});
$("#search").addEventListener("keydown", e => { if (e.key === "Enter") { const f = $(".sr-item", $("#searchResults")); if (f) f.click(); } });

// ---------- quadro (kanban) ----------
function taskCard(t) {
  const late = isLate(t);
  return `<article class="task-card ${t.status === "done" ? "done-card" : ""} ${t.status === "blocked" ? "blocked-card" : ""}" draggable="${isStaff()}" data-task="${t.id}" style="--task-color:${esc(stripe(t))}">
    <div class="task-sector">${t.status === "done" ? ic("checkc", 13) : ""}${esc(t.sector_name)}</div>
    <h3 class="task-title">${esc(t.title)}</h3>
    <div class="task-meta">
      ${t.comments ? `<span class="meta-piece">${ic("chat", 13)}${t.comments}</span>` : ""}
      ${t.meetings ? `<span class="meta-piece">${ic("mic", 13)}${t.meetings}</span>` : ""}
      ${t.due ? `<span class="meta-piece ${late ? "late" : ""}">${ic("clock", 13)}${dueLabel(t.due)}</span>` : ""}
      ${avatarHtml(t.assignee_name)}</div></article>`;
}
function kanbanHtml(list) {
  return `<div class="kanban">${STATUS_ORDER.map(st => {
    const col = list.filter(t => t.status === st).sort(byDue);
    return `<section class="kanban-column ${st}" data-status="${st}"><header class="column-head"><span class="status-dot"></span><strong>${STATUS[st]}</strong><span class="column-count">${col.length}</span></header>
      <div class="task-list">${col.map(taskCard).join("")}</div>${isStaff() ? `<button class="add-task" data-add="${st}">＋ Adicionar tarefa</button>` : ""}</section>`;
  }).join("")}</div>`;
}
function wireKanban(root, sectorId) {
  $$(".task-card", root).forEach(c => {
    c.onclick = () => openTask(+c.dataset.task);
    if (isStaff()) {
      c.ondragstart = e => { e.dataTransfer.setData("text/plain", c.dataset.task); setTimeout(() => c.classList.add("dragging"), 0); };
      c.ondragend = () => c.classList.remove("dragging");
    }
  });
  $$("[data-add]", root).forEach(b => b.onclick = () => openNewTask({ status: b.dataset.add, sector_id: sectorId }));
  if (isStaff()) $$(".kanban-column", root).forEach(col => {
    col.ondragover = e => { e.preventDefault(); col.classList.add("drop-hint"); };
    col.ondragleave = () => col.classList.remove("drop-hint");
    col.ondrop = async e => {
      e.preventDefault(); col.classList.remove("drop-hint");
      const id = +e.dataTransfer.getData("text/plain"), t = tasks.find(x => x.id === id);
      if (!t || t.status === col.dataset.status) return;
      try { await api("PATCH", "/api/tasks/" + id, { status: col.dataset.status }); await refresh(); } catch (err) { toast(err.message); }
    };
  });
}

// ---------- página: Início ----------
function pageHome(main) {
  const staff = isStaff(), mine = myTasks(), h = new Date().getHours();
  const hello = h < 12 ? "Bom dia" : h < 18 ? "Boa tarde" : "Boa noite";
  const src = staff ? tasks : mine;
  const k = staff
    ? [["red", "tasks", tasks.filter(t => t.status !== "done").length, "Em aberto"], ["blue", "clock", tasks.filter(t => t.status === "doing").length, "Em andamento"], ["green", "checkc", tasks.filter(t => t.status === "done").length, "Concluídas"]]
    : [["red", "tasks", mine.length, "Tarefas atribuídas"], ["blue", "clock", mine.filter(t => t.status === "doing").length, "Em andamento"], ["green", "checkc", mine.filter(t => t.status === "done").length, "Concluídas"]];
  const list = tasks.filter(t => !homeSector || String(t.sector_id) === homeSector);
  main.innerHTML = `<section class="welcome-row">
      <div><div class="greeting">${hello}, ${esc(me.name.split(" ")[0])}!</div><h1>Vamos organizar o dia?</h1><div class="subtitle">Aqui está um resumo das ${staff ? "tarefas de todos os setores" : "suas tarefas e dos seus setores"}.</div></div>
      <div class="summary-grid">${k.map(([c, i, n, l]) => `<article class="summary"><span class="summary-icon ${c}">${ic(i, 17)}</span><span><strong class="summary-number">${n}</strong><span class="summary-label">${l}</span></span></article>`).join("")}
        <article class="summary"><span class="summary-icon gray">${ic("calendar", 17)}</span><span><strong class="summary-number" style="font-size:13px">Hoje</strong><span class="summary-label">${new Date().toLocaleDateString("pt-BR", { day: "numeric", month: "short", year: "numeric" })}</span></span></article></div></section>
    <section><div class="section-head"><h2 class="section-title">${ic("grid", 21)}Quadros de tarefas</h2>
      <div class="controls"><select id="homeSector" aria-label="Filtrar por setor"><option value="">Todos os setores</option>${sectors.map(s => `<option value="${s.id}" ${String(s.id) === homeSector ? "selected" : ""}>${esc(s.name)}</option>`).join("")}</select>
      ${staff ? `<button class="btn" id="newTask">${ic("plus", 16)} Nova tarefa</button>` : ""}</div></div>
      ${sectors.length ? kanbanHtml(list) : `<div class="empty-state">${ic("folder", 32)}<div>Você ainda não foi adicionado a nenhum setor. Peça a um gestor ou à TI.</div></div>`}</section>`;
  $("#homeSector").onchange = e => { homeSector = e.target.value; pageHome(main); };
  if ($("#newTask")) $("#newTask").onclick = () => openNewTask({ sector_id: homeSector ? +homeSector : null });
  wireKanban(main, homeSector ? +homeSector : null);
}

// painel direito do Início
function monthTitle(d) { const t = d.toLocaleDateString("pt-BR", { month: "long", year: "numeric" }); return t[0].toUpperCase() + t.slice(1); }
function calendarWidget() {
  const y = calMonth.getFullYear(), m = calMonth.getMonth(), first = new Date(y, m, 1).getDay(), days = new Date(y, m + 1, 0).getDate(), prev = new Date(y, m, 0).getDate();
  const withTask = new Set(tasks.filter(t => t.due && t.status !== "done").map(t => t.due.slice(0, 10)));
  const now = new Date(), cells = [];
  for (let i = first - 1; i >= 0; i--) cells.push(`<span class="muted">${prev - i}</span>`);
  for (let d = 1; d <= days; d++) {
    const key = `${y}-${pad(m + 1)}-${pad(d)}`, today = sameDay(new Date(y, m, d), now);
    cells.push(`<span class="${withTask.has(key) ? "has-task" : ""} ${today ? "today" : ""}">${d}</span>`);
  }
  for (let d = 1; cells.length % 7; d++) cells.push(`<span class="muted">${d}</span>`);
  return `<div class="calendar"><div class="calendar-title"><span>${monthTitle(calMonth)}</span><div class="calendar-nav"><button data-cal="-1" aria-label="Mês anterior">${ic("chevL", 14)}</button><button data-cal="1" aria-label="Próximo mês">${ic("chevR", 14)}</button></div></div>
    <div class="calendar-grid">${["D", "S", "T", "Q", "Q", "S", "S"].map(d => `<span class="weekday">${d}</span>`).join("")}${cells.join("")}</div></div>`;
}
function paintRight() {
  const today = (isStaff() ? tasks : myTasks()).filter(t => t.due && sameDay(new Date(t.due), new Date())).sort(byDue);
  const n = notifs.items.slice(0, 4);
  $("#right").innerHTML = `<section><div class="panel-head"><h2>Calendário</h2><a href="#/calendario" class="text-link">Ver completo →</a></div>${calendarWidget()}</section>
    <section class="today-tasks"><div class="panel-head"><h2>Tarefas de hoje (${today.length})</h2></div>
      ${today.map(t => `<div class="today-row" data-task="${t.id}"><span class="task-status ${t.status}">${t.status === "done" ? "✓" : ""}</span><span>${esc(t.title)}</span><time>${new Date(t.due).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}</time></div>`).join("") || `<div class="muted" style="font-size:11px;padding:8px 0">Nenhuma tarefa para hoje.</div>`}</section>
    <section class="notifications"><div class="panel-head"><h2>Notificações</h2><a href="#/notificacoes" class="text-link">Ver todas →</a></div>
      ${n.map(x => `<article class="notification-item" data-notif="${x.id}" data-task="${x.task_id || ""}"><span class="avatar">${x.actor_name ? esc(initials(x.actor_name)) : ic("bell", 14)}</span>
        <div class="notification-copy">${notifCopy(x)}<time>${timeAgo(x.created)}</time></div>${x.read ? "<span></span>" : `<span class="unread"></span>`}</article>`).join("") || `<div class="muted" style="font-size:11px;padding:8px 0">Sem notificações.</div>`}</section>
    <article class="mission-card"><div class="mission-logo"><span class="brand-mark"><svg viewBox="0 0 40 40" aria-hidden="true"><path fill="#E51E2A" d="M14 2h12v12h12v12H26v12H14V26H2V14h12z"/></svg></span><span><strong>Cruz Vermelha Brasileira</strong><small>Filial Minas Gerais</small></span></div><p>Juntos por um<br>mundo mais humano.</p></article>`;
  $$("[data-cal]", $("#right")).forEach(b => b.onclick = () => { calMonth = new Date(calMonth.getFullYear(), calMonth.getMonth() + +b.dataset.cal, 1); paintRight(); });
  $$(".today-row", $("#right")).forEach(r => r.onclick = () => openTask(+r.dataset.task));
  $$("[data-notif]", $("#right")).forEach(r => r.onclick = () => openNotif(+r.dataset.notif, +r.dataset.task));
}
function notifCopy(x) {
  const who = x.actor_name ? `<strong>${esc(x.actor_name)}</strong> ` : "";
  return `${who}${esc(x.text)}${x.task_title ? `<br><strong>${esc(x.task_title)}</strong>` : ""}`;
}
async function openNotif(id, taskId) {
  try { await api("POST", `/api/notifications/${id}/read`, {}); notifs = await api("GET", "/api/notifications"); paintBell(); paintSidebar(); } catch { }
  if (taskId) openTask(taskId);
}

// ---------- página: Quadros ----------
function pageBoards(main) {
  const list = tasks.filter(t => (!qFilter.sector || String(t.sector_id) === qFilter.sector) && (!qFilter.assignee || String(t.assignee_id) === qFilter.assignee) && (!qFilter.priority || t.priority === qFilter.priority));
  main.innerHTML = `<div class="page-head"><div><h2 class="page-title">${ic("grid", 24)}Quadros</h2><div class="page-sub">${list.length} tarefa(s) nos filtros atuais</div></div>
    <div class="controls"><select id="fSector"><option value="">Todos os setores</option>${sectors.map(s => `<option value="${s.id}" ${String(s.id) === qFilter.sector ? "selected" : ""}>${esc(s.name)}</option>`).join("")}</select>
      ${isStaff() ? `<select id="fAssignee"><option value="">Todos os responsáveis</option>${users.map(u => `<option value="${u.id}" ${String(u.id) === qFilter.assignee ? "selected" : ""}>${esc(u.name)}</option>`).join("")}</select>` : ""}
      <select id="fPrio"><option value="">Qualquer prioridade</option>${Object.entries(PRIORITY).map(([k, v]) => `<option value="${k}" ${k === qFilter.priority ? "selected" : ""}>${v}</option>`).join("")}</select>
      ${isStaff() ? `<button class="btn" id="newTask">${ic("plus", 16)} Nova tarefa</button>` : ""}</div></div>${kanbanHtml(list)}`;
  const upd = () => { qFilter = { sector: $("#fSector").value, assignee: $("#fAssignee") ? $("#fAssignee").value : "", priority: $("#fPrio").value }; pageBoards(main); };
  ["#fSector", "#fAssignee", "#fPrio"].forEach(s => { if ($(s)) $(s).onchange = upd; });
  if ($("#newTask")) $("#newTask").onclick = () => openNewTask({ sector_id: qFilter.sector ? +qFilter.sector : null });
  wireKanban(main, qFilter.sector ? +qFilter.sector : null);
}

// ---------- página: Setor ----------
function pageSector(main, r) {
  const s = sectors.find(x => x.id === r.id);
  if (!s) { main.innerHTML = `<div class="empty-state">${ic("folder", 32)}<div>Setor não encontrado ou sem acesso.</div></div>`; return; }
  const list = tasks.filter(t => t.sector_id === s.id);
  main.innerHTML = `<div class="page-head"><div><h2 class="page-title" style="--c:${s.color}">${ic(s.icon, 26)}${esc(s.name)}</h2><div class="page-sub">${list.length} tarefa(s) neste setor</div></div>
    <div class="controls"><button class="btn btn-secondary" id="secMembers">${ic("users", 16)} Membros</button>${isStaff() ? `<button class="btn" id="newTask">${ic("plus", 16)} Nova tarefa</button>` : ""}</div></div>
    <div class="summary-grid" style="margin-bottom:20px">${STATUS_ORDER.map((st, i) => `<article class="summary"><span class="summary-icon ${["red", "blue", "green", "gray"][i]}">${ic(["tasks", "clock", "checkc", "x"][i], 17)}</span><span><strong class="summary-number">${list.filter(t => t.status === st).length}</strong><span class="summary-label">${STATUS[st]}</span></span></article>`).join("")}</div>
    ${kanbanHtml(list)}`;
  $("#secMembers").onclick = () => openMembers(s.id);
  if ($("#newTask")) $("#newTask").onclick = () => openNewTask({ sector_id: s.id });
  wireKanban(main, s.id);
}
async function openMembers(sid) {
  let sec; try { sec = await api("GET", "/api/sectors/" + sid); } catch (e) { return toast(e.message); }
  const ids = new Set(sec.members.map(m => m.id)), cand = users.filter(u => ["membro", "leitor"].includes(u.role) && u.active && !ids.has(u.id));
  openModal(`<h3>Membros — ${esc(sec.name)}</h3><p class="muted">Gestores e a TI enxergam todos os setores. Aqui ficam os funcionários e leitores com acesso a este setor.</p>
    ${sec.members.map(m => `<div class="box row between"><span>${esc(m.name)} <small>${esc(m.email)} · ${ROLE_NAMES[m.role]}</small></span>${isStaff() ? `<button class="btn btn-secondary btn-sm" data-rm="${m.id}">Remover</button>` : ""}</div>`).join("") || `<div class="box muted">Ninguém adicionado ainda.</div>`}
    ${isStaff() ? `<div class="row" style="margin-top:14px"><select id="m_add"><option value="">Adicionar pessoa…</option>${cand.map(u => `<option value="${u.id}">${esc(u.name)} (${ROLE_NAMES[u.role]})</option>`).join("")}</select><button class="btn" id="m_go">Adicionar</button></div>` : ""}`, true);
  $$("[data-rm]").forEach(b => b.onclick = async () => { await api("POST", `/api/sectors/${sid}/members`, { user_id: +b.dataset.rm, add: false }); await loadData(); openMembers(sid); });
  if ($("#m_go")) $("#m_go").onclick = async () => { const v = $("#m_add").value; if (v) { await api("POST", `/api/sectors/${sid}/members`, { user_id: +v, add: true }); await loadData(); openMembers(sid); } };
}

// ---------- página: Minhas tarefas ----------
function pageMine(main) {
  const mine = myTasks().sort(byDue), tabs = [["all", "Todas"], ["todo", "A fazer"], ["doing", "Em andamento"], ["done", "Concluídas"], ["blocked", "Bloqueadas"]];
  const list = mine.filter(t => myTab === "all" || t.status === myTab);
  main.innerHTML = `<div class="page-head"><div><h2 class="page-title">${ic("check", 24)}Minhas tarefas</h2><div class="page-sub">Tarefas atribuídas a você, ordenadas por prazo</div></div></div>
    <div class="tabs">${tabs.map(([k, l]) => `<button class="tab ${myTab === k ? "on" : ""}" data-tab="${k}">${l} (${k === "all" ? mine.length : mine.filter(t => t.status === k).length})</button>`).join("")}</div>
    ${list.length ? `<table class="tbl"><thead><tr><th></th><th>Tarefa</th><th>Setor</th><th>Prazo</th><th>Prioridade</th><th>Status</th></tr></thead><tbody>
      ${list.map(t => `<tr class="click" data-task="${t.id}"><td>${canComplete() ? `<input type="checkbox" data-done="${t.id}" ${t.status === "done" ? "checked" : ""} title="Marcar como concluída">` : ""}</td>
        <td><strong>${esc(t.title)}</strong></td><td>${esc(t.sector_name)}</td><td class="${isLate(t) ? "meta-piece late" : ""}">${t.due ? dueLabel(t.due) : "—"}</td>
        <td><span class="pill ${t.priority}">${PRIORITY[t.priority]}</span></td><td><span class="pill ${t.status}"><i></i>${STATUS[t.status]}</span></td></tr>`).join("")}</tbody></table>`
      : `<div class="empty-state">${ic("check", 32)}<div>Nenhuma tarefa aqui.</div></div>`}`;
  $$("[data-tab]", main).forEach(b => b.onclick = () => { myTab = b.dataset.tab; pageMine(main); });
  $$("tr[data-task]", main).forEach(r => r.onclick = () => openTask(+r.dataset.task));
  $$("[data-done]", main).forEach(c => {
    c.onclick = e => e.stopPropagation();
    c.onchange = async () => { try { await api("PATCH", "/api/tasks/" + c.dataset.done, { status: c.checked ? "done" : "todo" }); await refresh(c.checked ? "Tarefa concluída" : "Tarefa reaberta"); } catch (err) { toast(err.message); c.checked = !c.checked; } };
  });
}

// ---------- página: Notificações ----------
function pageNotifs(main) {
  const list = notifs.items.filter(x => notifTab === "all" || !x.read);
  main.innerHTML = `<div class="page-head"><div><h2 class="page-title">${ic("bell", 24)}Notificações</h2><div class="page-sub">${notifs.unread} não lida(s)</div></div>
    <div class="controls"><button class="btn btn-secondary" id="readAll" ${notifs.unread ? "" : "disabled"}>Marcar todas como lidas</button></div></div>
    <div class="tabs"><button class="tab ${notifTab === "all" ? "on" : ""}" data-nt="all">Todas</button><button class="tab ${notifTab === "unread" ? "on" : ""}" data-nt="unread">Não lidas</button></div>
    ${list.map(x => `<div class="notif-row ${x.read ? "" : "unread-row"}" data-notif="${x.id}" data-task="${x.task_id || ""}"><span class="avatar">${x.actor_name ? esc(initials(x.actor_name)) : ic("bell", 16)}</span>
      <div class="notification-copy" style="font-size:12px">${notifCopy(x)}</div><time>${timeAgo(x.created)}</time></div>`).join("") || `<div class="empty-state">${ic("bell", 32)}<div>Nada por aqui.</div></div>`}`;
  $$("[data-nt]", main).forEach(b => b.onclick = () => { notifTab = b.dataset.nt; pageNotifs(main); });
  $("#readAll").onclick = async () => { await api("POST", "/api/notifications/readall", {}); notifs = await api("GET", "/api/notifications"); paintBell(); paintSidebar(); pageNotifs(main); };
  $$("[data-notif]", main).forEach(r => r.onclick = async () => { await openNotif(+r.dataset.notif, +r.dataset.task); pageNotifs(main); });
}

// ---------- página: Calendário ----------
function pageCalendar(main) {
  const y = calMonth.getFullYear(), m = calMonth.getMonth(), first = new Date(y, m, 1).getDay(), days = new Date(y, m + 1, 0).getDate(), now = new Date();
  const list = tasks.filter(t => t.due && (!qFilter.sector || String(t.sector_id) === qFilter.sector));
  const cells = [];
  for (let i = 0; i < first; i++) cells.push(`<div class="cal-cell out"></div>`);
  for (let d = 1; d <= days; d++) {
    const key = `${y}-${pad(m + 1)}-${pad(d)}`, day = list.filter(t => t.due.slice(0, 10) === key).sort(byDue);
    cells.push(`<div class="cal-cell ${sameDay(new Date(y, m, d), now) ? "today" : ""}"><span class="cal-num">${d}</span>
      ${day.slice(0, 3).map(t => `<span class="cal-chip ${t.status === "done" ? "done" : ""}" style="--c:${esc(stripe(t))}" data-task="${t.id}" title="${esc(t.title)}">${esc(t.title)}</span>`).join("")}${day.length > 3 ? `<div class="cal-more">+${day.length - 3} mais</div>` : ""}</div>`);
  }
  while (cells.length % 7) cells.push(`<div class="cal-cell out"></div>`);
  main.innerHTML = `<div class="page-head"><div><h2 class="page-title">${ic("calendar", 24)}Calendário</h2><div class="page-sub">Prazos das tarefas</div></div>
    <div class="controls"><select id="fSector"><option value="">Todos os setores</option>${sectors.map(s => `<option value="${s.id}" ${String(s.id) === qFilter.sector ? "selected" : ""}>${esc(s.name)}</option>`).join("")}</select></div></div>
    <div class="cal-head"><button class="btn btn-secondary btn-sm" data-cal="-1">${ic("chevL", 14)}</button><h2>${monthTitle(calMonth)}</h2><button class="btn btn-secondary btn-sm" data-cal="1">${ic("chevR", 14)}</button>
      <button class="btn btn-secondary btn-sm" id="calToday">Hoje</button></div>
    <div class="cal-full">${["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"].map(d => `<div class="cal-wd">${d}</div>`).join("")}${cells.join("")}</div>`;
  $$("[data-cal]", main).forEach(b => b.onclick = () => { calMonth = new Date(y, m + +b.dataset.cal, 1); pageCalendar(main); });
  $("#calToday").onclick = () => { calMonth = new Date(now.getFullYear(), now.getMonth(), 1); pageCalendar(main); };
  $("#fSector").onchange = e => { qFilter.sector = e.target.value; pageCalendar(main); };
  $$("[data-task]", main).forEach(c => c.onclick = () => openTask(+c.dataset.task));
}

// ---------- página: Arquivos ----------
function pageFiles(main) {
  main.innerHTML = `<div class="page-head"><div><h2 class="page-title">${ic("file", 24)}Arquivos</h2><div class="page-sub">Anexos de tarefas e documentos por setor</div></div></div>
    <div class="empty-state">${ic("file", 36)}<div><strong>Em breve</strong></div><div>O envio e a consulta de arquivos ainda não foram construídos.</div></div>`;
}

// ---------- reuniões (Plaud) ----------
function meetingCard(m, showWhere = true) {
  const ed = isStaff();
  return `<div class="box" data-m="${m.id}"><strong>${esc(m.title)}</strong>
    <div><small>${fmtDateTime(m.created)}${showWhere ? " · " + (m.sector_name ? esc(m.sector_name) + (m.task_title ? " › " + esc(m.task_title) : "") : "Sem destino") : ""}</small></div>
    ${m.summary ? `<pre class="sum">${esc(m.summary)}</pre>` : ""}
    <details ${m.summary ? "" : "open"}><summary>Transcrição</summary><textarea data-tr="${m.id}" rows="7" ${ed ? "" : "disabled"}>${esc(m.transcript)}</textarea></details>
    ${ed ? `<div class="actions" style="margin-top:8px"><button class="btn btn-secondary btn-sm" data-save="${m.id}">Salvar texto</button><button class="btn btn-secondary btn-sm" data-sum="${m.id}">✨ Resumir e organizar</button><button class="btn btn-danger btn-sm" data-delm="${m.id}">Excluir</button></div>` : ""}</div>`;
}
function wireMeetings(root, after) {
  $$("[data-save]", root).forEach(b => b.onclick = async () => { try { await api("PATCH", "/api/meetings/" + b.dataset.save, { transcript: $(`[data-tr="${b.dataset.save}"]`, root).value }); b.textContent = "Salvo ✓"; } catch (e) { toast(e.message); } });
  $$("[data-delm]", root).forEach(b => b.onclick = async () => { if (confirm("Excluir esta reunião?")) { await api("DELETE", "/api/meetings/" + b.dataset.delm); after(); } });
  $$("[data-sum]", root).forEach(b => b.onclick = async () => {
    b.disabled = true; b.textContent = "Resumindo…";
    try { await api("PATCH", "/api/meetings/" + b.dataset.sum, { transcript: $(`[data-tr="${b.dataset.sum}"]`, root).value }); await api("POST", `/api/meetings/${b.dataset.sum}/summarize`); after(); }
    catch (e) { toast(e.message); b.disabled = false; b.textContent = "✨ Resumir e organizar"; }
  });
}
async function pageMeetings(main) {
  let list; try { list = await api("GET", "/api/meetings"); } catch (e) { main.innerHTML = `<div class="empty-state">${esc(e.message)}</div>`; return; }
  const orphans = list.filter(m => !m.sector_id), rest = list.filter(m => m.sector_id && (!meetSector || String(m.sector_id) === meetSector));
  const opts = sectors.map(s => `<optgroup label="${esc(s.name)}"><option value="${s.id}|">Setor inteiro: ${esc(s.name)}</option>${tasks.filter(t => t.sector_id === s.id).map(t => `<option value="${s.id}|${t.id}">${esc(t.title)}</option>`).join("")}</optgroup>`).join("");
  main.innerHTML = `<div class="page-head"><div><h2 class="page-title">${ic("mic", 24)}Reuniões</h2><div class="page-sub">Gravações do Plaud ligadas às tarefas e aos setores pelo nome da gravação</div></div>
    <div class="controls"><select id="fSector"><option value="">Todos os setores</option>${sectors.map(s => `<option value="${s.id}" ${String(s.id) === meetSector ? "selected" : ""}>${esc(s.name)}</option>`).join("")}</select></div></div>
    ${isStaff() && orphans.length ? `<h3 style="margin:0 0 8px">Sem destino (${orphans.length})</h3><p class="muted">O nome da gravação não contém o título de nenhuma tarefa nem o nome de um setor. Escolha onde guardar.</p>
      ${orphans.map(m => `<div class="box"><strong>${esc(m.title)}</strong> <small>${fmtDateTime(m.created)}</small><div class="row" style="margin-top:10px"><select data-to="${m.id}"><option value="">Escolher destino…</option>${opts}</select><button class="btn btn-sm" data-go="${m.id}">Mover</button></div></div>`).join("")}<div style="height:22px"></div>` : ""}
    ${rest.map(m => meetingCard(m)).join("") || `<div class="empty-state">${ic("mic", 32)}<div>Nenhuma reunião ainda. Dê à gravação um nome que contenha o título da tarefa ou o nome do setor.</div></div>`}`;
  $("#fSector").onchange = e => { meetSector = e.target.value; pageMeetings(main); };
  $$("[data-go]", main).forEach(b => b.onclick = async () => {
    const v = $(`[data-to="${b.dataset.go}"]`, main).value; if (!v) return;
    const [sid, tid] = v.split("|");
    try { await api("PATCH", "/api/meetings/" + b.dataset.go, { sector_id: +sid, task_id: tid ? +tid : null }); await refresh("Reunião movida"); } catch (e) { toast(e.message); }
  });
  wireMeetings(main, () => pageMeetings(main));
}

// ---------- tarefa: ver, editar, criar ----------
const options = (obj, sel) => Object.entries(obj).map(([k, v]) => `<option value="${k}" ${k === sel ? "selected" : ""}>${v}</option>`).join("");
function assigneeOptions(list, sel) {
  return `<option value="">Sem responsável</option>` + list.map(u => `<option value="${u.id}" ${u.id === sel ? "selected" : ""}>${esc(u.name)}</option>`).join("");
}
function colorPicker(cur) {
  return `<div class="swatches" id="t_colors"><button type="button" class="sw ${cur ? "" : "sel"}" data-c="" title="Cor do setor">✕</button>${SWATCHES.map(c => `<button type="button" class="sw ${c === cur ? "sel" : ""}" data-c="${c}" style="background:${c}" title="${c}"></button>`).join("")}</div>`;
}
async function openTask(id) {
  let t, sec = null;
  try { t = await api("GET", "/api/tasks/" + id); if (isStaff()) sec = await api("GET", "/api/sectors/" + t.sector_id); } catch (e) { return toast(e.message); }
  const ro = isStaff() ? "" : "disabled", staff = isStaff();
  openModal(`<div class="row between" style="padding-right:36px"><h3>Tarefa</h3><span class="pill ${t.status}"><i></i>${STATUS[t.status]}</span></div>
    <label class="lbl">Título</label><input id="t_title" value="${esc(t.title)}" ${ro} maxlength="200">
    <div class="grid2">
      <div><label class="lbl">Status</label><select id="t_status" ${ro}>${options(STATUS, t.status)}</select></div>
      <div><label class="lbl">Prioridade</label><select id="t_prio" ${ro}>${options(PRIORITY, t.priority)}</select></div>
      <div><label class="lbl">Setor</label><select id="t_sector" ${ro}>${sectors.map(s => `<option value="${s.id}" ${s.id === t.sector_id ? "selected" : ""}>${esc(s.name)}</option>`).join("")}</select></div>
      <div><label class="lbl">Responsável</label><select id="t_assignee" ${ro}>${staff ? assigneeOptions(sec.assignable, t.assignee_id) : `<option>${esc(t.assignee_name || "Sem responsável")}</option>`}</select></div>
      <div><label class="lbl">Prazo</label><input id="t_due" type="datetime-local" value="${esc(t.due || "")}" ${ro}></div>
      ${staff ? `<div><label class="lbl">Cor do cartão</label>${colorPicker(t.color)}</div>` : ""}</div>
    <label class="lbl">Descrição</label><textarea id="t_desc" ${ro}>${esc(t.description)}</textarea>
    <div class="actions">${staff ? `<button class="btn" id="t_save">Salvar</button><button class="btn btn-danger" id="t_del">Excluir</button>`
      : canComplete() ? `<button class="btn ${t.status === "done" ? "btn-secondary" : ""}" id="t_complete">${t.status === "done" ? "Reabrir tarefa" : "✓ Marcar como concluída"}</button>` : ""}</div>
    <h4>Comentários (${t.comment_list.length})</h4>
    ${t.comment_list.map(c => `<div class="box"><small><strong>${esc(c.author)}</strong> · ${fmtDateTime(c.created)}</small><div style="white-space:pre-wrap;margin-top:4px">${esc(c.text)}</div>${c.user_id === me.id || staff ? `<button class="btn btn-secondary btn-sm" style="margin-top:8px" data-delc="${c.id}">Excluir</button>` : ""}</div>`).join("") || `<div class="muted" style="margin-top:8px">Sem comentários.</div>`}
    ${canComplete() ? `<div class="row" style="margin-top:10px"><input id="c_text" placeholder="Escreva um comentário…" maxlength="5000"><button class="btn" id="c_go">Enviar</button></div>` : ""}
    <h4>Reuniões (${t.meeting_list.length})</h4>
    <div id="mList">${t.meeting_list.map(m => meetingCard({ ...m, sector_name: t.sector_name }, false)).join("") || `<div class="muted" style="margin-top:8px">Nenhuma reunião ligada. Dê à gravação do Plaud um nome que contenha o título desta tarefa.</div>`}</div>`);
  const reopen = async () => { await loadData(); render(); openTask(id); };
  if (staff) {
    let color = t.color || "";
    $$("#t_colors .sw").forEach(b => b.onclick = () => { color = b.dataset.c; $$("#t_colors .sw").forEach(x => x.classList.toggle("sel", x === b)); });
    $("#t_sector").onchange = async e => {  // o responsável depende do setor
      try { const s2 = await api("GET", "/api/sectors/" + e.target.value); $("#t_assignee").innerHTML = assigneeOptions(s2.assignable, null); } catch (err) { toast(err.message); }
    };
    $("#t_save").onclick = async () => {
      try {
        await api("PATCH", "/api/tasks/" + id, { title: $("#t_title").value, status: $("#t_status").value, priority: $("#t_prio").value, sector_id: +$("#t_sector").value,
          assignee_id: $("#t_assignee").value ? +$("#t_assignee").value : null, due: $("#t_due").value, description: $("#t_desc").value, color });
        closeModal(); await refresh("Tarefa salva");
      } catch (err) { toast(err.message); }
    };
    $("#t_del").onclick = async () => { if (confirm("Excluir esta tarefa?")) { await api("DELETE", "/api/tasks/" + id); closeModal(); await refresh("Tarefa excluída"); } };
  } else if ($("#t_complete")) {
    $("#t_complete").onclick = async () => { try { await api("PATCH", "/api/tasks/" + id, { status: t.status === "done" ? "todo" : "done" }); await refresh(t.status === "done" ? "Tarefa reaberta" : "Tarefa concluída"); openTask(id); } catch (err) { toast(err.message); } };
  }
  if ($("#c_go")) {
    const send = async () => { const v = $("#c_text").value.trim(); if (!v) return; try { await api("POST", `/api/tasks/${id}/comments`, { text: v }); await reopen(); } catch (err) { toast(err.message); } };
    $("#c_go").onclick = send; $("#c_text").onkeydown = e => { if (e.key === "Enter") send(); };
  }
  $$("[data-delc]").forEach(b => b.onclick = async () => { await api("DELETE", "/api/comments/" + b.dataset.delc); await reopen(); });
  wireMeetings($("#mList"), reopen);
}

async function openNewTask({ status = "todo", sector_id = null } = {}) {
  if (!sectors.length) return toast("Nenhum setor disponível.");
  const sid = sector_id || sectors[0].id;
  let sec; try { sec = await api("GET", "/api/sectors/" + sid); } catch (e) { return toast(e.message); }
  openModal(`<h3>Nova tarefa</h3>
    <label class="lbl">Título</label><input id="n_title" maxlength="200" autofocus>
    <div class="grid2">
      <div><label class="lbl">Setor</label><select id="n_sector">${sectors.map(s => `<option value="${s.id}" ${s.id === sid ? "selected" : ""}>${esc(s.name)}</option>`).join("")}</select></div>
      <div><label class="lbl">Status</label><select id="n_status">${options(STATUS, status)}</select></div>
      <div><label class="lbl">Responsável</label><select id="n_assignee">${assigneeOptions(sec.assignable, null)}</select></div>
      <div><label class="lbl">Prioridade</label><select id="n_prio">${options(PRIORITY, "media")}</select></div>
      <div><label class="lbl">Prazo</label><input id="n_due" type="datetime-local"></div></div>
    <label class="lbl">Descrição</label><textarea id="n_desc"></textarea>
    <p id="n_err" style="color:#FF6972;min-height:18px;margin:10px 0 0"></p>
    <div class="actions" style="margin-top:6px"><button class="btn" id="n_go">Criar tarefa</button><button class="btn btn-secondary" id="n_cancel">Cancelar</button></div>`);
  $("#n_title").focus();
  $("#n_sector").onchange = async e => { try { const s2 = await api("GET", "/api/sectors/" + e.target.value); $("#n_assignee").innerHTML = assigneeOptions(s2.assignable, null); } catch (err) { toast(err.message); } };
  $("#n_cancel").onclick = closeModal;
  $("#n_go").onclick = async () => {
    try {
      await api("POST", "/api/tasks", { sector_id: +$("#n_sector").value, title: $("#n_title").value, status: $("#n_status").value, priority: $("#n_prio").value,
        assignee_id: $("#n_assignee").value ? +$("#n_assignee").value : null, due: $("#n_due").value, description: $("#n_desc").value });
      closeModal(); await refresh("Tarefa criada");
    } catch (err) { $("#n_err").textContent = err.message; }
  };
}

// ---------- login, convite e senha ----------
const LOGO = `<span class="brand-mark"><svg viewBox="0 0 40 40" aria-hidden="true"><path fill="#E51E2A" d="M14 2h12v12h12v12H26v12H14V26H2V14h12z"/></svg></span>`;
function authShell(inner) {
  $("#shell").hidden = true; $("#auth").hidden = false; closeModal();
  $("#auth").innerHTML = `<button type="button" class="btn btn-secondary btn-sm" id="authTheme" style="position:fixed;top:16px;right:16px">${themeLabel()}</button><form class="auth-card" id="af">${LOGO}${inner}</form>`;
  $("#authTheme").onclick = e => { setTheme(theme() === "light" ? "dark" : "light"); e.target.textContent = themeLabel(); };
}
async function showLogin(msg) {
  const { needed } = await api("GET", "/api/setup");
  authShell(`<h2>${needed ? "Primeiro acesso: conta da TI" : "Entrar na Central CVB-MG"}</h2>
    ${needed ? `<p class="muted">Esta será a conta do administrador (a TI), a única do sistema.</p><label class="lbl">Nome</label><input id="l_n" required>` : `<p class="muted">Cruz Vermelha Brasileira — Filial Minas Gerais</p>`}
    <label class="lbl">E-mail institucional</label><input id="l_e" type="email" required placeholder="nome@cvbmg.org.br" autocomplete="username">
    <label class="lbl">Senha${needed ? " (mínimo 8 caracteres)" : ""}</label><input id="l_p" type="password" required ${needed ? 'minlength="8"' : ""} autocomplete="${needed ? "new-password" : "current-password"}">
    <p class="err" id="l_err">${esc(msg || "")}</p><button class="btn">${needed ? "Criar e entrar" : "Entrar"}</button>
    ${needed ? "" : `<p style="text-align:center;margin-top:16px"><a href="#" class="link" id="l_forgot">Primeiro acesso ou esqueci a senha</a></p>`}`);
  $("#af").onsubmit = async e => {
    e.preventDefault();
    try {
      me = await api("POST", needed ? "/api/setup" : "/api/login", { name: needed ? $("#l_n").value : undefined, email: $("#l_e").value, password: $("#l_p").value });
      await loadData(); location.hash = "#/"; render();
    } catch (err) { $("#l_err").textContent = err.message; }
  };
  if ($("#l_forgot")) $("#l_forgot").onclick = e => {
    e.preventDefault();
    openModal(`<h3>Criar ou redefinir senha</h3><p class="muted">Digite o seu e-mail institucional. Se ele estiver cadastrado, enviamos um link para você criar uma senha nova.</p>
      <label class="lbl">E-mail</label><input id="f_e" type="email" placeholder="nome@cvbmg.org.br" value="${esc($("#l_e").value)}"><p id="f_msg" style="min-height:20px;margin:10px 0 0"></p>
      <div class="actions" style="margin-top:6px"><button class="btn" id="f_go">Enviar link</button></div>`, true);
    $("#f_go").onclick = async () => {
      try { await api("POST", "/api/forgot", { email: $("#f_e").value }); $("#f_msg").textContent = "Pronto! Se o e-mail estiver cadastrado, o link chegará em instantes."; }
      catch (err) { $("#f_msg").textContent = err.message; }
    };
  };
}
async function showInvite(token) {
  let info;
  try { info = await api("GET", "/api/invite/" + token); }
  catch (err) { history.replaceState(null, "", location.pathname); me = null; return showLogin(err.message); }
  authShell(`<h2>Bem-vindo(a), ${esc(info.name.split(" ")[0])}!</h2><p class="muted">Crie a sua senha para acessar a Central CVB-MG.</p>
    <label class="lbl">E-mail</label><input value="${esc(info.email)}" disabled>
    <label class="lbl">Senha (mínimo 8 caracteres)</label><input id="i_p" type="password" required minlength="8" autocomplete="new-password">
    <label class="lbl">Repita a senha</label><input id="i_p2" type="password" required minlength="8" autocomplete="new-password">
    <p class="err" id="i_err"></p><button class="btn">Criar senha e entrar</button>`);
  $("#af").onsubmit = async e => {
    e.preventDefault();
    if ($("#i_p").value !== $("#i_p2").value) { $("#i_err").textContent = "As senhas não são iguais."; return; }
    try {
      me = await api("POST", "/api/invite/" + token, { password: $("#i_p").value });
      history.replaceState(null, "", location.pathname); await loadData(); location.hash = "#/"; render();
    } catch (err) { $("#i_err").textContent = err.message; }
  };
}

// ---------- perfil ----------
function resizePhoto(file) {  // recorta ao centro e reduz para 160x160 (JPEG)
  return new Promise((ok, fail) => {
    const img = new Image(), url = URL.createObjectURL(file);
    img.onload = () => {
      const n = 160, s = Math.min(img.width, img.height), cv = document.createElement("canvas");
      cv.width = cv.height = n; cv.getContext("2d").drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, 0, 0, n, n);
      URL.revokeObjectURL(url); ok(cv.toDataURL("image/jpeg", 0.85));
    };
    img.onerror = () => fail(new Error("Não consegui ler essa imagem."));
    img.src = url;
  });
}
function openProfile() {
  let avatar = me.avatar || "";
  openModal(`<h3>Meu perfil</h3>
    <div class="row" style="margin:14px 0"><span class="avatar avatar-lg" id="p_prev"></span><div><input id="p_file" type="file" accept="image/*"><button class="btn btn-secondary btn-sm" id="p_rm" type="button" style="margin-top:8px">Remover foto</button></div></div>
    <label class="lbl">Nome</label><input id="p_name" value="${esc(me.name)}" maxlength="80">
    <label class="lbl">E-mail</label><input value="${esc(me.email)}" disabled>
    <p id="p_err" style="color:#FF6972;min-height:18px;margin:10px 0 0"></p><div class="actions" style="margin-top:6px"><button class="btn" id="p_ok">Salvar</button></div>`, true);
  const prev = () => paintAvatar($("#p_prev"), { name: $("#p_name").value || me.name, avatar });
  prev(); $("#p_name").oninput = prev;
  $("#p_rm").onclick = () => { avatar = ""; $("#p_file").value = ""; prev(); };
  $("#p_file").onchange = async e => { const f = e.target.files[0]; if (!f) return; try { avatar = await resizePhoto(f); prev(); $("#p_err").textContent = ""; } catch (err) { $("#p_err").textContent = err.message; } };
  $("#p_ok").onclick = async () => { try { me = await api("PATCH", "/api/me", { name: $("#p_name").value, avatar }); closeModal(); paintHeader(); toast("Perfil atualizado"); } catch (err) { $("#p_err").textContent = err.message; } };
}

// ---------- administração: usuários e convites ----------
const fmtDate = s => s ? new Date(s).toLocaleDateString("pt-BR") : "";
const copyText = async t => { try { await navigator.clipboard.writeText(t); return true; } catch { prompt("Copie o texto abaixo:", t); return false; } };
function showInvites(list) {
  const ok = list.filter(x => x.status === "enviado").length, text = list.map(x => `${x.email}\t${x.link}`).join("\n");
  openModal(`<h3>Convites</h3><p>${ok} de ${list.length} enviados por e-mail.${ok < list.length ? " Os demais não foram enviados (envio de e-mail não configurado ou com erro): copie os links abaixo e mande por outro meio." : ""}</p>
    ${list.length ? `<div style="overflow-x:auto;max-height:300px"><table class="tbl"><thead><tr><th>E-mail</th><th>Situação</th><th>Link</th></tr></thead><tbody>${list.map(x => `<tr><td>${esc(x.email)}</td><td>${esc(x.status)}</td><td><input readonly value="${esc(x.link)}" onclick="this.select()"></td></tr>`).join("")}</tbody></table></div>
      <div class="actions"><button class="btn" id="v_copy">Copiar e-mail e link de todos</button><button class="btn btn-secondary" id="v_back">Voltar</button></div>` : `<div class="actions"><button class="btn btn-secondary" id="v_back">Voltar</button></div>`}`);
  if ($("#v_copy")) $("#v_copy").onclick = async e => { if (await copyText(text)) e.target.textContent = "Copiado ✓"; };
  $("#v_back").onclick = openUsers;
}
async function openUsers() {
  const list = await api("GET", "/api/users");
  const pend = list.filter(u => u.pending && u.active && u.role !== "admin" && !u.invited_at).length;
  const status = u => !u.active ? "Inativo" : u.role === "admin" ? "Ativo" : u.pending ? (u.invited_at ? `Convite enviado em ${fmtDate(u.invited_at)}` : "Convite não enviado") : "Ativo";
  const roleOpts = sel => ["gestor", "membro", "leitor"].map(k => `<option value="${k}" ${sel === k ? "selected" : ""}>${ROLE_NAMES[k]}</option>`).join("");
  openModal(`<h3>Usuários e convites</h3>
    <div class="actions" style="margin:12px 0"><button class="btn" id="u_all" ${pend ? "" : "disabled"}>✉ Enviar convites a todos (${pend} pendentes)</button></div>
    <div style="overflow-x:auto"><table class="tbl"><thead><tr><th>Nome</th><th>E-mail</th><th>Perfil</th><th>Situação</th><th>Ativo</th><th></th></tr></thead><tbody>
    ${list.map(u => `<tr><td>${esc(u.name)}</td><td>${esc(u.email)}</td>
      <td>${u.role === "admin" ? "Administrador (TI)" : `<select data-role="${u.id}" style="width:auto">${roleOpts(u.role)}</select>`}</td><td>${status(u)}</td>
      <td>${u.role === "admin" ? "" : `<input type="checkbox" data-act="${u.id}" ${u.active ? "checked" : ""}>`}</td>
      <td style="white-space:nowrap">${u.role === "admin" || !u.active ? "" : `<button class="btn btn-secondary btn-sm" data-inv="${u.id}">✉ ${u.pending ? (u.invited_at ? "Reenviar" : "Enviar") : "Redefinir senha"}</button> <button class="btn btn-secondary btn-sm" data-link="${u.id}">Link</button> <button class="btn btn-danger btn-sm" data-del="${u.id}">Excluir</button>`}</td></tr>`).join("")}</tbody></table></div>
    <h4>Cadastrar pessoas</h4><label class="lbl">E-mails institucionais (um por linha; se quiser, “Nome &lt;email&gt;”)</label>
    <textarea id="u_text" placeholder="maria.silva@cvbmg.org.br&#10;João Souza &lt;joao.souza@cvbmg.org.br&gt;"></textarea>
    <label class="lbl">Perfil</label><select id="u_r">${roleOpts("membro")}</select>
    <div class="actions"><button class="btn" id="u_go">Cadastrar</button></div>
    <p class="muted" style="font-size:12px">As pessoas ficam cadastradas sem senha. No lançamento, use “Enviar convites a todos”: cada uma recebe por e-mail um link para criar a própria senha. Depois, adicione cada pessoa aos setores dela (menu Setores &gt; Membros).</p>`);
  const again = () => openUsers();
  const act = async fn => { try { await fn(); } catch (e) { toast(e.message); } again(); };
  $$("[data-role]").forEach(s => s.onchange = () => act(() => api("PATCH", "/api/users/" + s.dataset.role, { role: s.value })));
  $$("[data-act]").forEach(s => s.onchange = () => act(() => api("PATCH", "/api/users/" + s.dataset.act, { active: s.checked })));
  $$("[data-del]").forEach(b => b.onclick = () => { if (confirm("Excluir este usuário?")) act(() => api("DELETE", "/api/users/" + b.dataset.del)); });
  $$("[data-inv]").forEach(b => b.onclick = async () => { try { showInvites([await api("POST", `/api/users/${b.dataset.inv}/invite`, {})]); } catch (e) { toast(e.message); } });
  $$("[data-link]").forEach(b => b.onclick = async () => { try { const { link } = await api("POST", `/api/users/${b.dataset.link}/link`, {}); if (await copyText(link)) b.textContent = "Copiado ✓"; } catch (e) { toast(e.message); } });
  $("#u_all").onclick = async () => { if (!confirm(`Enviar o convite por e-mail para ${pend} pessoa(s)?`)) return; try { showInvites((await api("POST", "/api/invites", {})).sent); } catch (e) { toast(e.message); } };
  $("#u_go").onclick = async () => {
    try {
      const r = await api("POST", "/api/users", { text: $("#u_text").value, role: $("#u_r").value });
      if (r.skipped.length) alert(`${r.created.length} cadastrado(s).\n\nNão cadastrados:\n` + r.skipped.map(s => `• ${s.email}: ${s.reason}`).join("\n"));
      await loadData();
    } catch (e) { toast(e.message); }
    again();
  };
}
async function openSettings() {
  const s = await api("GET", "/api/status");
  openModal(`<h3>Configurações</h3>
    <p>Aviso automático por e-mail e no sino quando uma tarefa (com responsável e prazo) estiver a <b>${esc(s.notify_hours)}h</b> do vencimento ou já vencida. Cada prazo avisa uma vez.</p>
    <p>E-mail (SMTP/Outlook): <b>${s.smtp ? "configurado ✓" : "não configurado — os e-mails ficam só no histórico (modo simulado)"}</b><br>Resumo com Claude: <b>${s.claude ? "ativo ✓" : "inativo"}</b></p>
    <label class="lbl">Enviar e-mail de teste para</label><div class="row"><input id="t_mail" type="email" placeholder="voce@cvbmg.org.br"><button class="btn" id="t_go">Enviar</button></div>
    <div class="actions" style="margin-top:12px"><button class="btn btn-secondary" id="t_check">Verificar prazos agora</button></div>
    <h4>Token de importação do Plaud</h4><p class="muted">Quem envia gravações para <code>POST /api/plaud</code> usa o cabeçalho <code>X-Import-Token</code>. Guarde em segredo.</p>
    <input readonly value="${esc(s.import_token)}" onclick="this.select()">
    <h4>Histórico de e-mails</h4><div style="overflow-x:auto"><table class="tbl"><thead><tr><th>Quando</th><th>Para</th><th>Assunto</th><th>Status</th></tr></thead><tbody>
    ${s.outbox.map(o => `<tr><td>${esc(o.sent_at.replace("T", " "))}</td><td>${esc(o.to_email)}</td><td>${esc(o.subject)}</td><td>${esc(o.status)}</td></tr>`).join("") || `<tr><td colspan="4" class="muted">Vazio</td></tr>`}</tbody></table></div>`);
  $("#t_go").onclick = async () => { try { const r = await api("POST", "/api/notify", { email: $("#t_mail").value }); toast(r.status); openSettings(); } catch (e) { toast(e.message); } };
  $("#t_check").onclick = async () => { await api("POST", "/api/check", {}); await refresh("Prazos verificados"); openSettings(); };
}

// ---------- início ----------
(async () => {
  if (parseRoute().name !== "invite") {
    try { me = await api("GET", "/api/me"); await loadData(); } catch { me = null; }
  }
  render();
})();
