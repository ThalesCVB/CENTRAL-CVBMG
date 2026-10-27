const $ = (s, r = document) => r.querySelector(s);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const api = async (method, url, body) => {
  const r = await fetch(url, { method, headers: body ? { "Content-Type": "application/json" } : {}, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error || r.statusText);
  return j;
};
const COLORS = ["#0079bf", "#d29034", "#519839", "#b04632", "#89609e", "#cd5a91", "#00aecc", "#4bbf6b"];
let board = null; // quadro aberto

// ---------- utilidades de prazo ----------
function dueBadge(due, done) {
  if (!due) return "";
  const d = new Date(due), diff = (d - new Date()) / 36e5;
  const txt = d.toLocaleString("pt-BR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
  const cls = done ? "ok" : diff < 0 ? "late" : diff <= 24 ? "soon" : "due";
  return `<span class="badge ${cls}">🕒 ${txt}</span>`;
}

// ---------- modal ----------
function openModal(html) {
  $("#modalBody").innerHTML = `<button class="close" id="mclose">×</button>` + html;
  $("#modal").hidden = false;
  $("#mclose").onclick = closeModal;
}
function closeModal() { $("#modal").hidden = true; $("#modalBody").innerHTML = ""; }
$("#modal").addEventListener("mousedown", e => { if (e.target.id === "modal") closeModal(); });
document.addEventListener("keydown", e => { if (e.key === "Escape") closeModal(); });

// ---------- home ----------
async function showHome() {
  board = null;
  document.body.className = "home";
  $("#boardTitleTop").textContent = "";
  $("#btnMeetings").hidden = true;
  const boards = await api("GET", "/api/boards");
  $("#app").innerHTML = `<div class="home-wrap"><h2>Seus projetos</h2><div class="boards">
    ${boards.map(b => `<div class="board-tile" data-id="${b.id}" style="background:${esc(b.color)}">${esc(b.title)}<small>${b.due ? "Prazo: " + new Date(b.due).toLocaleDateString("pt-BR") : ""}</small></div>`).join("")}
    <div class="board-tile new" id="newBoard">+ Criar projeto</div></div></div>`;
  document.querySelectorAll(".board-tile[data-id]").forEach(t => t.onclick = () => openBoard(+t.dataset.id));
  $("#newBoard").onclick = () => {
    openModal(`<h3>Novo projeto</h3><label>Nome</label><input id="nb_t" autofocus>
      <div class="grid2"><div><label>Prazo do projeto (opcional)</label><input id="nb_d" type="datetime-local"></div>
      <div><label>E-mail do responsável</label><input id="nb_e" type="email"></div></div>
      <label>Cor</label><div>${COLORS.map((c, i) => `<label style="display:inline-block;margin-right:6px"><input type="radio" name="nb_c" value="${c}" ${i ? "" : "checked"} style="width:auto"> <span style="background:${c};display:inline-block;width:24px;height:16px;vertical-align:middle;border-radius:3px"></span></label>`).join("")}</div>
      <div class="actions"><button class="btn" id="nb_ok">Criar</button></div>`);
    $("#nb_ok").onclick = async () => {
      const title = $("#nb_t").value.trim(); if (!title) return;
      const { id } = await api("POST", "/api/boards", { title, color: document.querySelector("input[name=nb_c]:checked").value });
      await api("PATCH", "/api/boards/" + id, { due: $("#nb_d").value, owner_email: $("#nb_e").value.trim() });
      closeModal(); openBoard(id);
    };
  };
}
$("#home").onclick = e => { e.preventDefault(); showHome(); };

// ---------- quadro ----------
async function openBoard(id) {
  board = await api("GET", "/api/boards/" + id);
  renderBoard();
}
async function reload() { board = await api("GET", "/api/boards/" + board.id); renderBoard(); }

function renderBoard() {
  document.body.className = "";
  document.body.style.background = board.color;
  $("#boardTitleTop").innerHTML = `${esc(board.title)} ${dueBadge(board.due, false)}`;
  $("#boardTitleTop").style.cursor = "pointer";
  $("#boardTitleTop").onclick = editBoard;
  $("#btnMeetings").hidden = false;
  const lists = board.lists.map(l => `
    <div class="list" data-id="${l.id}">
      <div class="list-head"><input value="${esc(l.title)}" data-rename="${l.id}"><button class="x" data-dellist="${l.id}" title="Excluir lista">🗑</button></div>
      <div class="cards" data-list="${l.id}">${l.cards.map(cardHtml).join("")}</div>
      <div class="add"><button class="add-btn" data-addcard="${l.id}">+ Adicionar cartão</button></div>
    </div>`).join("");
  $("#app").innerHTML = `<div class="lists">${lists}
    <div class="newlist"><button class="add-btn" id="addList">+ Adicionar outra lista</button></div></div>`;
  wireBoard();
}
function cardHtml(k) {
  return `<div class="card ${k.done ? "done" : ""}" draggable="true" data-card="${k.id}">
    <div class="t">${esc(k.title)}</div>
    <div class="badges">${dueBadge(k.due, k.done)}${k.meetings ? `<span class="badge">🎙 ${k.meetings}</span>` : ""}${k.description ? `<span class="badge">≡</span>` : ""}${k.assignee_email ? `<span class="badge">👤 ${esc(k.assignee_email.split("@")[0])}</span>` : ""}</div></div>`;
}

function wireBoard() {
  document.querySelectorAll("[data-rename]").forEach(i => i.onchange = async () => { await api("PATCH", "/api/lists/" + i.dataset.rename, { title: i.value }); });
  document.querySelectorAll("[data-dellist]").forEach(b => b.onclick = async () => { if (confirm("Excluir a lista e seus cartões?")) { await api("DELETE", "/api/lists/" + b.dataset.dellist); reload(); } });
  document.querySelectorAll("[data-addcard]").forEach(b => b.onclick = () => {
    const wrap = b.parentElement;
    wrap.innerHTML = `<form><textarea placeholder="Título do cartão…" style="min-height:54px" autofocus></textarea><div class="row"><button class="btn">Adicionar</button><button type="button" class="btn sec">✕</button></div></form>`;
    const ta = $("textarea", wrap); ta.focus();
    ta.onkeydown = e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); wrap.querySelector("form").requestSubmit(); } };
    $(".sec", wrap).onclick = renderBoard;
    $("form", wrap).onsubmit = async e => { e.preventDefault(); if (ta.value.trim()) { await api("POST", "/api/cards", { list_id: +b.dataset.addcard, title: ta.value.trim() }); reload(); } };
  });
  $("#addList").onclick = e => {
    const wrap = e.target.parentElement;
    wrap.innerHTML = `<form class="add"><input placeholder="Título da lista…"><div class="row"><button class="btn">Adicionar</button></div></form>`;
    $("input", wrap).focus();
    $("form", wrap).onsubmit = async ev => { ev.preventDefault(); const v = $("input", wrap).value.trim(); if (v) { await api("POST", "/api/lists", { board_id: board.id, title: v }); reload(); } };
  };
  document.querySelectorAll(".card").forEach(c => {
    c.onclick = () => openCard(+c.dataset.card);
    c.ondragstart = e => { e.dataTransfer.setData("text/plain", c.dataset.card); setTimeout(() => c.classList.add("dragging"), 0); };
    c.ondragend = () => c.classList.remove("dragging");
  });
  document.querySelectorAll(".cards").forEach(zone => {
    zone.ondragover = e => { e.preventDefault(); zone.classList.add("drop-hint"); };
    zone.ondragleave = () => zone.classList.remove("drop-hint");
    zone.ondrop = async e => {
      e.preventDefault(); zone.classList.remove("drop-hint");
      const id = +e.dataTransfer.getData("text/plain");
      const others = [...zone.querySelectorAll(".card:not(.dragging)")];
      let index = others.findIndex(el => e.clientY < el.getBoundingClientRect().top + el.offsetHeight / 2);
      if (index < 0) index = others.length;
      await api("POST", `/api/cards/${id}/move`, { list_id: +zone.dataset.list, index });
      reload();
    };
  });
}

function findCard(id) {
  for (const l of board.lists) for (const k of l.cards) if (k.id === id) return k;
}

function editBoard() {
  openModal(`<h3>Projeto</h3><label>Nome</label><input id="eb_t" value="${esc(board.title)}">
    <div class="grid2"><div><label>Prazo</label><input id="eb_d" type="datetime-local" value="${esc(board.due || "")}"></div>
    <div><label>E-mail do responsável (recebe o aviso)</label><input id="eb_e" type="email" value="${esc(board.owner_email)}"></div></div>
    <div class="actions"><button class="btn" id="eb_ok">Salvar</button><button class="btn danger" id="eb_del">Excluir projeto</button></div>`);
  $("#eb_ok").onclick = async () => { await api("PATCH", "/api/boards/" + board.id, { title: $("#eb_t").value, due: $("#eb_d").value, owner_email: $("#eb_e").value.trim() }); closeModal(); reload(); };
  $("#eb_del").onclick = async () => { if (confirm("Excluir o projeto inteiro?")) { await api("DELETE", "/api/boards/" + board.id); closeModal(); showHome(); } };
}

// ---------- cartão ----------
function openCard(id) {
  const k = findCard(id);
  const ms = board.meetings.filter(m => m.card_id === id);
  openModal(`<h3>Cartão</h3>
    <label>Título</label><input id="c_t" value="${esc(k.title)}">
    <label>Descrição</label><textarea id="c_d">${esc(k.description)}</textarea>
    <div class="grid2"><div><label>Prazo</label><input id="c_due" type="datetime-local" value="${esc(k.due || "")}"></div>
    <div><label>Responsável (e-mail para o aviso)</label><input id="c_e" type="email" value="${esc(k.assignee_email)}"></div></div>
    <label style="display:flex;gap:6px;align-items:center;text-transform:none;font-size:14px"><input id="c_done" type="checkbox" style="width:auto" ${k.done ? "checked" : ""}> Concluída</label>
    <div class="actions"><button class="btn" id="c_ok">Salvar</button><button class="btn danger" id="c_del">Excluir</button></div>
    <h3 style="margin-top:22px">🎙 Reuniões deste cartão</h3>
    <div id="mList">${ms.map(meetingHtml).join("") || `<p class="muted">Nenhuma gravação do Plaud vinculada. Dê à gravação um nome que contenha o título deste cartão.</p>`}</div>`);
  $("#c_ok").onclick = async () => {
    await api("PATCH", "/api/cards/" + id, { title: $("#c_t").value, description: $("#c_d").value, due: $("#c_due").value, assignee_email: $("#c_e").value.trim(), done: $("#c_done").checked });
    closeModal(); reload();
  };
  $("#c_del").onclick = async () => { if (confirm("Excluir o cartão?")) { await api("DELETE", "/api/cards/" + id); closeModal(); reload(); } };
  wireMeetings($("#mList"), () => openCardAfterReload(id));
}
async function openCardAfterReload(id) { await reload(); openCard(id); }

// ---------- reuniões ----------
function meetingHtml(m) {
  return `<div class="meeting" data-m="${m.id}">
    <h4>${esc(m.title)}</h4><small>${new Date(m.created).toLocaleString("pt-BR")}${m.card_id ? " · cartão: " + esc(findCard(m.card_id)?.title || "") : " · projeto"}</small>
    ${m.summary ? `<pre>${esc(m.summary)}</pre>` : ""}
    <details ${m.summary ? "" : "open"}><summary>Transcrição</summary><textarea data-tr="${m.id}" style="min-height:120px">${esc(m.transcript)}</textarea></details>
    <div class="actions" style="margin-top:8px"><button class="btn sec" data-save="${m.id}">Salvar texto</button>
    <button class="btn sec" data-sum="${m.id}">✨ Resumir e organizar</button><button class="btn sec" data-delm="${m.id}">Excluir</button></div></div>`;
}
function wireMeetings(root, after) {
  root.querySelectorAll("[data-save]").forEach(b => b.onclick = async () => { await api("PATCH", "/api/meetings/" + b.dataset.save, { transcript: $(`[data-tr="${b.dataset.save}"]`, root).value }); b.textContent = "Salvo ✓"; });
  root.querySelectorAll("[data-delm]").forEach(b => b.onclick = async () => { if (confirm("Excluir esta reunião?")) { await api("DELETE", "/api/meetings/" + b.dataset.delm); after(); } });
  root.querySelectorAll("[data-sum]").forEach(b => b.onclick = async () => {
    b.disabled = true; b.textContent = "Resumindo…";
    try {
      await api("PATCH", "/api/meetings/" + b.dataset.sum, { transcript: $(`[data-tr="${b.dataset.sum}"]`, root).value });
      await api("POST", `/api/meetings/${b.dataset.sum}/summarize`); after();
    } catch (e) { alert(e.message); b.disabled = false; b.textContent = "✨ Resumir e organizar"; }
  });
}

// painel de reuniões do projeto
$("#btnMeetings").onclick = () => {
  openModal(`<h3>🎙 Gravações Plaud — ${esc(board.title)}</h3>
    <div id="mList">${board.meetings.map(meetingHtml).join("") || `<p class="muted">Nenhuma gravação ainda. Dê à gravação um nome que contenha o título do projeto ou de um cartão.</p>`}</div>`);
  wireMeetings($("#mList"), async () => { await reload(); $("#btnMeetings").click(); });
};

// caixa de entrada: gravações cujo nome não bateu com nenhum projeto/cartão
$("#btnInbox").onclick = async () => {
  const [inbox, targets] = await Promise.all([api("GET", "/api/inbox"), api("GET", "/api/targets")]);
  const opts = targets.map(t => `<option value="${t.board_id}|${t.card_id || ""}">${esc(t.board)}${t.card ? " › " + esc(t.card) : ""}</option>`).join("");
  const seen = new Set();
  const uniq = [...targets.map(t => [`${t.board_id}|`, esc(t.board)])].filter(([v]) => !seen.has(v) && seen.add(v)).map(([v, n]) => `<option value="${v}">${n} (projeto)</option>`).join("");
  openModal(`<h3>📥 Plaud sem destino</h3><p class="muted">Gravações cujo nome não contém o título de nenhum projeto ou cartão. Escolha onde guardar.</p>
    ${inbox.map(m => `<div class="meeting"><h4>${esc(m.title)}</h4><small>${esc(m.created.replace("T", " "))}</small>
      <div class="recbar"><select data-to="${m.id}"><option value="">Escolher destino…</option>${uniq}${opts}</select><button class="btn" data-go="${m.id}">Mover</button></div></div>`).join("") || `<p>Nada pendente ✓</p>`}`);
  document.querySelectorAll("[data-go]").forEach(b => b.onclick = async () => {
    const v = $(`[data-to="${b.dataset.go}"]`).value; if (!v) return;
    const [bid, cid] = v.split("|");
    await api("PATCH", "/api/meetings/" + b.dataset.go, { board_id: +bid, card_id: cid ? +cid : null });
    $("#btnInbox").click();
  });
};

// ---------- notificações ----------
$("#btnSettings").onclick = async () => {
  const s = await api("GET", "/api/status");
  openModal(`<h3>✉ Notificações por e-mail</h3>
    <p>Aviso automático quando um cartão ou projeto (com responsável e prazo) estiver a <b>${esc(s.notify_hours)}h</b> do vencimento — ou já vencido. Cada prazo avisa uma vez.</p>
    <p>SMTP (Outlook): <b>${s.smtp ? "configurado ✓" : "não configurado — e-mails ficam só no histórico (modo simulado)"}</b><br>
    Resumo extra com Claude: <b>${s.claude ? "ativo ✓" : "inativo"}</b></p>
    <label>Enviar e-mail de teste para</label><div class="recbar"><input id="t_mail" type="email" placeholder="voce@empresa.com"><button class="btn" id="t_go">Enviar</button></div>
    <div class="actions"><button class="btn sec" id="t_check">Verificar prazos agora</button></div>
    <h3 style="margin-top:20px">Histórico</h3>
    <table><tr><th>Quando</th><th>Para</th><th>Assunto</th><th>Status</th></tr>${s.outbox.map(o => `<tr><td>${esc(o.sent_at.replace("T", " "))}</td><td>${esc(o.to_email)}</td><td>${esc(o.subject)}</td><td>${esc(o.status)}</td></tr>`).join("") || `<tr><td colspan=4 class="muted">Vazio</td></tr>`}</table>`);
  $("#t_go").onclick = async () => { const r = await api("POST", "/api/notify", { email: $("#t_mail").value }); alert(r.status); $("#btnSettings").click(); };
  $("#t_check").onclick = async () => { await api("POST", "/api/check", {}); $("#btnSettings").click(); };
};

showHome();
