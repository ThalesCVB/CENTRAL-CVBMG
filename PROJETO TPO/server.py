"""Central CVB - tarefas por setor (A fazer / Em andamento / Concluído / Bloqueado) + reuniões transcritas (Plaud)
+ avisos de prazo por e-mail (Outlook/SMTP). Só biblioteca padrão do Python 3.
Rodar:  python server.py   ->  http://localhost:8000
"""
import hashlib, hmac, json, os, re, secrets, smtplib, sqlite3, sys, threading, time, unicodedata, urllib.request
from http.cookies import SimpleCookie
from datetime import datetime, timedelta
from email.message import EmailMessage
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

BASE = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.join(BASE, "taskmeet.db")

# ---------- configuração (config.json ou variáveis de ambiente) ----------
CFG = {
    "SMTP_HOST": "smtp.office365.com", "SMTP_PORT": "587", "SMTP_USER": "", "SMTP_PASS": "",
    "SMTP_FROM": "", "ANTHROPIC_API_KEY": "",
    "NOTIFY_HOURS": "24", "CHECK_MINUTES": "10", "PORT": "8000", "HOST": "127.0.0.1",
    "ALLOWED_DOMAIN": "cvbmg.org.br", "BASE_URL": "", "INVITE_DAYS": "14",
}
try:
    with open(os.path.join(BASE, "config.json"), encoding="utf-8") as f:
        CFG.update({k: str(v) for k, v in json.load(f).items()})
except FileNotFoundError:
    pass
for k in CFG:
    if os.environ.get(k):
        CFG[k] = os.environ[k]

db_lock = threading.Lock()


def db():
    c = sqlite3.connect(DB_PATH)
    c.row_factory = sqlite3.Row
    return c


STATUSES = ("todo", "doing", "done", "blocked")
PRIORITIES = ("alta", "media", "baixa")
DEFAULT_SECTORS = (("TI", "monitor", "#EF3340"), ("Administrativo e RH", "users", "#60A5FA"), ("Financeiro", "wallet", "#F59E0B"),
                   ("Compras", "cart", "#EF4444"), ("Frotas", "car", "#D6A6A6"), ("Projetos", "folder", "#A855F7"))


def init_db():
    with db() as c:
        c.executescript("""
        CREATE TABLE IF NOT EXISTS boards(id INTEGER PRIMARY KEY, title TEXT, color TEXT DEFAULT '#373334',
            due TEXT, owner_email TEXT DEFAULT '', notified INTEGER DEFAULT 0);
        CREATE TABLE IF NOT EXISTS lists(id INTEGER PRIMARY KEY, board_id INTEGER, title TEXT, pos INTEGER DEFAULT 0);
        CREATE TABLE IF NOT EXISTS cards(id INTEGER PRIMARY KEY, list_id INTEGER, title TEXT, description TEXT DEFAULT '',
            due TEXT, assignee_email TEXT DEFAULT '', done INTEGER DEFAULT 0, notified INTEGER DEFAULT 0, pos INTEGER DEFAULT 0);
        CREATE TABLE IF NOT EXISTS meetings(id INTEGER PRIMARY KEY, board_id INTEGER, card_id INTEGER, title TEXT,
            created TEXT, transcript TEXT DEFAULT '', summary TEXT DEFAULT '', audio TEXT DEFAULT '', status TEXT DEFAULT 'ok');
        CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY, name TEXT, email TEXT UNIQUE, pw TEXT,
            role TEXT DEFAULT 'membro', active INTEGER DEFAULT 1);
        CREATE TABLE IF NOT EXISTS sessions(token_hash TEXT PRIMARY KEY, user_id INTEGER, created REAL);
        CREATE TABLE IF NOT EXISTS board_members(board_id INTEGER, user_id INTEGER, PRIMARY KEY(board_id, user_id));
        CREATE TABLE IF NOT EXISTS comments(id INTEGER PRIMARY KEY, card_id INTEGER, user_id INTEGER, text TEXT, created TEXT);
        CREATE TABLE IF NOT EXISTS sectors(id INTEGER PRIMARY KEY, name TEXT UNIQUE, icon TEXT, color TEXT, pos INTEGER DEFAULT 0);
        CREATE TABLE IF NOT EXISTS sector_members(sector_id INTEGER, user_id INTEGER, PRIMARY KEY(sector_id, user_id));
        CREATE TABLE IF NOT EXISTS tasks(id INTEGER PRIMARY KEY, sector_id INTEGER, title TEXT, description TEXT DEFAULT '',
            status TEXT DEFAULT 'todo', priority TEXT DEFAULT 'media', due TEXT, assignee_id INTEGER, color TEXT DEFAULT '',
            created_by INTEGER, created TEXT, done_at TEXT, notified INTEGER DEFAULT 0);
        CREATE TABLE IF NOT EXISTS task_comments(id INTEGER PRIMARY KEY, task_id INTEGER, user_id INTEGER, text TEXT, created TEXT);
        CREATE TABLE IF NOT EXISTS notifications(id INTEGER PRIMARY KEY, user_id INTEGER, kind TEXT, text TEXT, task_id INTEGER,
            actor_id INTEGER, created TEXT, read INTEGER DEFAULT 0);
        CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY, value TEXT);
        CREATE TABLE IF NOT EXISTS outbox(id INTEGER PRIMARY KEY, to_email TEXT, subject TEXT, body TEXT, sent_at TEXT, status TEXT);
        """)


    with db() as c:
        cols = [r[1] for r in c.execute("PRAGMA table_info(meetings)")]
        for col, typ in (("plaud_id", "TEXT"), ("sector_id", "INTEGER"), ("task_id", "INTEGER")):
            if col not in cols:
                c.execute("ALTER TABLE meetings ADD COLUMN %s %s" % (col, typ))
        if not c.execute("SELECT 1 FROM sectors").fetchone():
            for i, (name, icon, color) in enumerate(DEFAULT_SECTORS):
                c.execute("INSERT INTO sectors(name,icon,color,pos) VALUES(?,?,?,?)", (name, icon, color, i))
        c.execute("UPDATE boards SET color='#373334' WHERE color='#0079bf'")  # azul antigo -> cinza da marca
        for tb in ("lists", "cards"):
            if "color" not in [r[1] for r in c.execute("PRAGMA table_info(%s)" % tb)]:
                c.execute("ALTER TABLE %s ADD COLUMN color TEXT DEFAULT ''" % tb)
        ucols = [r[1] for r in c.execute("PRAGMA table_info(users)")]
        for col, typ in (("invite_hash", "TEXT"), ("invite_exp", "REAL"), ("invited_at", "TEXT")):
            if col not in ucols:
                c.execute("ALTER TABLE users ADD COLUMN %s %s" % (col, typ))
        if "avatar" not in [r[1] for r in c.execute("PRAGMA table_info(users)")]:
            c.execute("ALTER TABLE users ADD COLUMN avatar TEXT DEFAULT ''")
        if not c.execute("SELECT 1 FROM settings WHERE key='import_token'").fetchone():
            c.execute("INSERT INTO settings VALUES('import_token', ?)", (secrets.token_urlsafe(24),))


def rows(c, sql, *a):
    return [dict(r) for r in c.execute(sql, a).fetchall()]


# ---------- e-mail ----------
def smtp_ok():
    return bool(CFG["SMTP_USER"] and CFG["SMTP_PASS"])


def send_email(to, subject, body):
    status = "simulado (SMTP não configurado)"
    if smtp_ok():
        try:
            m = EmailMessage()
            m["From"] = CFG["SMTP_FROM"] or CFG["SMTP_USER"]
            m["To"] = to
            m["Subject"] = subject
            m.set_content(body)
            with smtplib.SMTP(CFG["SMTP_HOST"], int(CFG["SMTP_PORT"]), timeout=30) as s:
                s.starttls()
                s.login(CFG["SMTP_USER"], CFG["SMTP_PASS"])
                s.send_message(m)
            status = "enviado"
        except Exception as e:  # noqa
            status = "erro: %s" % e
    with db_lock, db() as c:
        c.execute("INSERT INTO outbox(to_email,subject,body,sent_at,status) VALUES(?,?,?,?,?)",
                  (to, subject, body, datetime.now().isoformat(timespec="seconds"), status))
    print("[email] %s -> %s: %s" % (status, to, subject))
    return status


def parse_due(s):
    try:
        return datetime.fromisoformat(s)
    except Exception:
        return None


def notify(c, user_id, kind, actor_id, task_id, text):
    """Notificação dentro do sistema (sino). Não avisa a pessoa sobre a própria ação."""
    if user_id and user_id != actor_id:
        c.execute("INSERT INTO notifications(user_id,kind,text,task_id,actor_id,created,read) VALUES(?,?,?,?,?,?,0)",
                  (user_id, kind, text, task_id, actor_id, datetime.now().isoformat(timespec="seconds")))


def check_deadlines():
    """Tarefas abertas, com responsável, a NOTIFY_HOURS do prazo (ou vencidas): e-mail + notificação, uma vez por prazo."""
    limit = datetime.now() + timedelta(hours=float(CFG["NOTIFY_HOURS"]))
    with db_lock, db() as c:
        tasks = rows(c, """SELECT t.id, t.title, t.due, t.assignee_id, s.name AS sector, u.email, u.name FROM tasks t
            JOIN sectors s ON s.id=t.sector_id JOIN users u ON u.id=t.assignee_id
            WHERE t.status!='done' AND t.notified=0 AND t.due IS NOT NULL AND t.due!='' AND u.active=1""")
    for k in tasks:
        d = parse_due(k["due"])
        if d and d <= limit:
            late = d < datetime.now()
            send_email(k["email"], ("[ATRASADA] " if late else "[Prazo próximo] ") + k["title"],
                       "Olá, %s!\n\nA tarefa \"%s\" (setor %s) %s em %s.\n\nAbra a Central CVB para atualizá-la."
                       % (k["name"], k["title"], k["sector"], "venceu" if late else "vence", d.strftime("%d/%m/%Y %H:%M")))
            with db_lock, db() as c:
                c.execute("UPDATE tasks SET notified=1 WHERE id=?", (k["id"],))
                notify(c, k["assignee_id"], "due", None, k["id"], "Tarefa atrasada" if late else "Prazo próximo da tarefa")


def notifier_loop():
    while True:
        try:
            check_deadlines()
        except Exception as e:  # noqa
            print("[notifier] erro:", e)
        time.sleep(max(1, float(CFG["CHECK_MINUTES"])) * 60)


# ---------- transcrição / resumo (opcionais) ----------
def http_json(url, data, headers):
    req = urllib.request.Request(url, data=data, headers=headers)
    with urllib.request.urlopen(req, timeout=300) as r:
        return json.loads(r.read().decode("utf-8"))


def summarize(text):
    """Resumo organizado (Claude). Retorna markdown simples."""
    prompt = ("Organize a transcrição de reunião abaixo em português, em markdown simples, com as seções: "
              "Resumo (3-5 linhas), Decisões, Ações (quem/o quê/prazo, se citado) e Pendências. "
              "Não invente informações.\n\nTRANSCRIÇÃO:\n" + text)
    out = http_json("https://api.anthropic.com/v1/messages",
                    json.dumps({"model": "claude-haiku-5-5", "max_tokens": 1500,
                                "messages": [{"role": "user", "content": prompt}]}).encode(),
                    {"x-api-key": CFG["ANTHROPIC_API_KEY"], "anthropic-version": "2023-06-01",
                     "content-type": "application/json"})
    return "".join(b.get("text", "") for b in out.get("content", []))


# ---------- Plaud: importação por nome da gravação ----------
def norm(t):
    t = unicodedata.normalize("NFKD", t or "").encode("ascii", "ignore").decode().lower()
    return re.sub(r"[^a-z0-9]+", " ", t).strip()


def match_target(c, name):
    """Acha a tarefa (ou, se não houver, o setor) cujo título aparece no nome da gravação.
    Vence o título mais longo (mais específico). Retorna (sector_id, task_id) ou (None, None)."""
    n = norm(name)
    best = None
    for k in rows(c, "SELECT id, title, sector_id FROM tasks"):
        t = norm(k["title"])
        if t and t in n and (best is None or len(t) > best[0]):
            best = (len(t), k["sector_id"], k["id"])
    if best:
        return best[1], best[2]
    for b in rows(c, "SELECT id, name FROM sectors"):
        t = norm(b["name"])
        if t and re.search(r"\b" + re.escape(t) + r"\b", n) and (best is None or len(t) > best[0]):
            best = (len(t), b["id"], None)
    return (best[1], best[2]) if best else (None, None)


def import_recording(c, d):
    """d: {plaud_id?, name, transcript?, summary?, created?}. Idempotente por plaud_id."""
    pid = str(d.get("plaud_id") or "")
    if pid:
        old = rows(c, "SELECT id, sector_id, task_id FROM meetings WHERE plaud_id=?", pid)
        if old:  # atualiza texto (ex.: transcrição ficou pronta depois), mantém o vínculo
            for f in ("transcript", "summary"):
                if d.get(f):
                    c.execute("UPDATE meetings SET %s=? WHERE id=?" % f, (d[f], old[0]["id"]))
            return {"id": old[0]["id"], "sector_id": old[0]["sector_id"], "task_id": old[0]["task_id"], "updated": True}
    sid, tid = match_target(c, d.get("name", ""))
    cur = c.execute("INSERT INTO meetings(sector_id,task_id,title,created,transcript,summary,plaud_id) VALUES(?,?,?,?,?,?,?)",
                    (sid, tid, d.get("name") or "Gravação Plaud", (d.get("created") or datetime.now().isoformat())[:16],
                     d.get("transcript", ""), d.get("summary", ""), pid or None))
    if tid:
        t = c.execute("SELECT assignee_id FROM tasks WHERE id=?", (tid,)).fetchone()
        if t:
            notify(c, t[0], "meeting", None, tid, "Reunião registrada na tarefa")
    return {"id": cur.lastrowid, "sector_id": sid, "task_id": tid, "matched": sid is not None}


# ---------- usuários, sessões e permissões ----------
ROLES = ("admin", "gestor", "membro", "leitor")
SESSION_SECONDS = 14 * 86400
LOGIN_FAILS = {}  # e-mail -> [instantes das últimas falhas]


class ApiError(Exception):
    def __init__(self, code, msg):
        self.code, self.msg = code, msg


def hash_pw(pw):
    salt = os.urandom(16)
    return salt.hex() + "$" + hashlib.pbkdf2_hmac("sha256", pw.encode("utf-8"), salt, 200_000).hex()


def check_pw(pw, stored):
    try:
        salt, h = stored.split("$")
        new = hashlib.pbkdf2_hmac("sha256", pw.encode("utf-8"), bytes.fromhex(salt), 200_000).hex()
        return hmac.compare_digest(new, h)
    except Exception:  # noqa
        return False


def tok_hash(t):
    return hashlib.sha256(t.encode()).hexdigest()


def new_session(c, user_id):
    t = secrets.token_urlsafe(32)
    c.execute("INSERT INTO sessions VALUES(?,?,?)", (tok_hash(t), user_id, time.time()))
    return t


def user_from_token(c, t):
    if not t:
        return None
    r = c.execute("SELECT u.id,u.name,u.email,u.role,u.avatar FROM sessions s JOIN users u ON u.id=s.user_id "
                  "WHERE s.token_hash=? AND u.active=1 AND s.created>?", (tok_hash(t), time.time() - SESSION_SECONDS)).fetchone()
    return dict(r) if r else None


def setting(c, k):
    r = c.execute("SELECT value FROM settings WHERE key=?", (k,)).fetchone()
    return r[0] if r else ""


def is_member(c, u, sid):
    return bool(c.execute("SELECT 1 FROM sector_members WHERE sector_id=? AND user_id=?", (sid, u["id"])).fetchone())


PERMS = {"view": ROLES, "comment": ("membro",), "complete": ("membro",), "edit": (), "manage": ()}
INVITABLE_ROLES = ("gestor", "membro", "leitor")  # só existe um administrador (a TI)


def need(c, u, action, sid):
    """admin (TI) e gestor (CEO): tudo, em todos os setores. Membro e leitor precisam ter sido adicionados ao setor:
    leitor só visualiza; membro também comenta e marca tarefas como concluídas."""
    if sid is None or not c.execute("SELECT 1 FROM sectors WHERE id=?", (sid,)).fetchone():
        raise ApiError(404, "Não encontrado")
    if u["role"] in ("admin", "gestor"):
        return
    if not is_member(c, u, sid) or u["role"] not in PERMS[action]:
        raise ApiError(403, "Sem permissão para esta ação")


def need_role(u, *roles):
    if u["role"] not in roles:
        raise ApiError(403, "Sem permissão para esta ação")


def sector_of(c, table, id_):
    q = {"tasks": "SELECT sector_id FROM tasks WHERE id=?", "meetings": "SELECT sector_id FROM meetings WHERE id=?"}[table]
    r = c.execute(q, (id_,)).fetchone()
    if not r:
        raise ApiError(404, "Não encontrado")
    return r[0]


def admins_left(c, excluding):
    return c.execute("SELECT COUNT(*) FROM users WHERE role='admin' AND active=1 AND id!=?", (excluding,)).fetchone()[0]


def valid_email(email):
    return bool(re.fullmatch(r"[a-z0-9._%+-]+@" + re.escape(CFG["ALLOWED_DOMAIN"].lower()), email or ""))


def name_from_email(email):
    return " ".join(p.capitalize() for p in re.split(r"[._-]+", email.split("@")[0]) if p) or email


def make_invite(c, user_id):
    """Gera um link novo (o anterior deixa de valer). Só o hash do token fica no banco."""
    t = "t" + secrets.token_hex(24)
    c.execute("UPDATE users SET invite_hash=?, invite_exp=? WHERE id=?",
              (tok_hash(t), time.time() + float(CFG["INVITE_DAYS"]) * 86400, user_id))
    return t


def invite_link(headers, t):
    base = (CFG["BASE_URL"] or "http://" + headers.get("Host", "localhost:%s" % CFG["PORT"])).rstrip("/")
    return "%s/#/convite/%s" % (base, t)


def send_invites(items, reset=False):
    """items: [(user_id, email, nome, link)]. Roda FORA do lock (send_email usa o lock)."""
    out = []
    for uid, email, name, link in items:
        if reset:
            subject = "Central CVB: redefinir sua senha"
            body = ("Olá, %s!\n\nPara criar uma nova senha na Central CVB, use o link abaixo (vale por %s dias):\n\n%s\n\n"
                    "Se não foi você quem pediu, ignore este e-mail." % (name, CFG["INVITE_DAYS"], link))
        else:
            subject = "Central CVB: ative seu acesso"
            body = ("Olá, %s!\n\nA Central CVB é a ferramenta da CVB-MG para acompanhar projetos, tarefas e reuniões.\n"
                    "Para ativar seu acesso, crie sua senha pelo link abaixo (vale por %s dias):\n\n%s\n\n"
                    "Seu usuário é o seu e-mail institucional: %s" % (name, CFG["INVITE_DAYS"], link, email))
        status = send_email(email, subject, body)
        if not reset:
            with db_lock, db() as c:
                c.execute("UPDATE users SET invited_at=? WHERE id=?", (datetime.now().isoformat(timespec="minutes"), uid))
        out.append({"email": email, "status": status, "link": link})
    return out


FORGOT_AT = {}  # e-mail -> instante do último pedido (limite de 1 por minuto)


def login(c, ctx, email, pw):
    email = (email or "").strip().lower()
    now = time.time()
    recent = [t for t in LOGIN_FAILS.get(email, []) if now - t < 300]
    if len(recent) >= 5:
        raise ApiError(429, "Muitas tentativas. Aguarde alguns minutos.")
    r = c.execute("SELECT * FROM users WHERE email=?", (email,)).fetchone()
    if not r or not r["active"] or not check_pw(pw or "", r["pw"]):
        LOGIN_FAILS[email] = recent + [now]
        raise ApiError(401, "E-mail ou senha incorretos")
    LOGIN_FAILS.pop(email, None)
    ctx["set_cookie"] = new_session(c, r["id"])
    return {"id": r["id"], "name": r["name"], "email": r["email"], "role": r["role"], "avatar": r["avatar"] or ""}


# ---------- API ----------
TASK_SELECT = """SELECT t.*, s.name AS sector_name, s.color AS sector_color, u.name AS assignee_name,
    (SELECT COUNT(*) FROM task_comments k WHERE k.task_id=t.id) AS comments,
    (SELECT COUNT(*) FROM meetings m WHERE m.task_id=t.id) AS meetings
    FROM tasks t JOIN sectors s ON s.id=t.sector_id LEFT JOIN users u ON u.id=t.assignee_id"""
TASK_TEXT = ("title", "description", "due")


def assignable(c, uid, sid):
    """O responsável precisa estar ativo e ser da gestão (gestor/admin) ou membro do setor."""
    return bool(c.execute("SELECT 1 FROM users WHERE id=? AND active=1 AND (role IN ('admin','gestor') OR id IN "
                          "(SELECT user_id FROM sector_members WHERE sector_id=?))", (uid, sid)).fetchone())


def task_fields(c, u, data, sid, current=None):
    """Valida os campos enviados e devolve o dict a gravar."""
    sets = {}
    if "title" in data:
        if not (data["title"] or "").strip():
            raise ApiError(400, "Informe o título da tarefa")
        sets["title"] = data["title"].strip()[:200]
    if "description" in data:
        sets["description"] = (data["description"] or "")[:10000]
    if "due" in data:
        d = (data["due"] or "").strip()
        if d and not parse_due(d):
            raise ApiError(400, "Prazo inválido")
        sets["due"] = d or None
        sets["notified"] = 0  # novo prazo => pode avisar de novo
    if "priority" in data:
        if data["priority"] not in PRIORITIES:
            raise ApiError(400, "Prioridade inválida")
        sets["priority"] = data["priority"]
    if "color" in data:
        if not re.fullmatch(r"(#[0-9a-fA-F]{6})?", data["color"] or ""):
            raise ApiError(400, "Cor inválida")
        sets["color"] = data["color"] or ""
    if "status" in data:
        if data["status"] not in STATUSES:
            raise ApiError(400, "Status inválido")
        sets["status"] = data["status"]
        sets["done_at"] = datetime.now().isoformat(timespec="minutes") if data["status"] == "done" else None
        if current and current["status"] == "done" and data["status"] != "done":
            sets["notified"] = 0
    if "assignee_id" in data:
        a = data["assignee_id"] or None
        if a is not None and not assignable(c, a, sid):
            raise ApiError(400, "Essa pessoa não participa do setor")
        sets["assignee_id"] = a
    return sets


def route(c, u, ctx, method, res, id_, sub, data, headers):
    """Roda dentro do lock. Retorna (status, json) ou uma função a executar depois de soltar o lock."""
    # ----- públicas -----
    if res == "setup":
        n = c.execute("SELECT COUNT(*) FROM users").fetchone()[0]
        if method == "GET":
            return 200, {"needed": n == 0}
        if n:
            raise ApiError(403, "O sistema já foi configurado")
        name, email, pw = (data.get("name") or "").strip(), (data.get("email") or "").strip().lower(), data.get("password") or ""
        if not name or len(pw) < 8:
            raise ApiError(400, "Informe o nome e uma senha com pelo menos 8 caracteres")
        if not valid_email(email):
            raise ApiError(400, "Use o e-mail institucional (@%s)" % CFG["ALLOWED_DOMAIN"])
        c.execute("INSERT INTO users(name,email,pw,role) VALUES(?,?,?,'admin')", (name, email, hash_pw(pw)))
        return 200, login(c, ctx, email, pw)
    if res == "login" and method == "POST":
        return 200, login(c, ctx, data.get("email"), data.get("password"))
    if res == "invite":  # /api/invite/<token>: a pessoa cria a própria senha
        tk = str(sub or id_ or "")
        r = c.execute("SELECT * FROM users WHERE invite_hash=? AND invite_exp>? AND active=1",
                      (tok_hash(tk), time.time())).fetchone() if tk else None
        if not r:
            raise ApiError(404, "Este link é inválido ou expirou. Use “Esqueci minha senha” na tela de entrada.")
        if method == "GET":
            return 200, {"name": r["name"], "email": r["email"]}
        pw = data.get("password") or ""
        if len(pw) < 8:
            raise ApiError(400, "A senha precisa ter pelo menos 8 caracteres")
        c.execute("UPDATE users SET pw=?, invite_hash=NULL, invite_exp=NULL WHERE id=?", (hash_pw(pw), r["id"]))
        c.execute("DELETE FROM sessions WHERE user_id=?", (r["id"],))
        return 200, login(c, ctx, r["email"], pw)
    if res == "forgot" and method == "POST":  # resposta sempre igual, exista ou não o e-mail
        email = (data.get("email") or "").strip().lower()
        now = time.time()
        r = c.execute("SELECT * FROM users WHERE email=? AND active=1", (email,)).fetchone() if valid_email(email) else None
        if not r or now - FORGOT_AT.get(email, 0) < 60:
            return 200, {"ok": True}
        FORGOT_AT[email] = now
        item = (r["id"], r["email"], r["name"], invite_link(headers, make_invite(c, r["id"])))
        return lambda: (send_invites([item], reset=True), (200, {"ok": True}))[1]
    if res == "logout" and method == "POST":
        ck = SimpleCookie(headers.get("Cookie", "")).get("tm")
        if ck:
            c.execute("DELETE FROM sessions WHERE token_hash=?", (tok_hash(ck.value),))
        ctx["set_cookie"] = ""
        return 200, {}
    if res == "plaud" and method == "POST":  # app de sincronização usa o token; admin logado também pode
        tk = headers.get("X-Import-Token", "")
        if not ((tk and hmac.compare_digest(tk, setting(c, "import_token"))) or (u and u["role"] in ("admin", "gestor"))):
            raise ApiError(401, "Token de importação inválido")
        return 200, import_recording(c, data)

    # ----- exigem login -----
    if not u:
        raise ApiError(401, "Faça login")
    if res == "me":
        if method == "PATCH":  # cada um edita só o próprio nome e foto
            if "name" in data:
                name = (data["name"] or "").strip()
                if not name or len(name) > 80:
                    raise ApiError(400, "Informe um nome (até 80 caracteres)")
                c.execute("UPDATE users SET name=? WHERE id=?", (name, u["id"]))
            if "avatar" in data:
                av = data["avatar"] or ""
                if av and (not re.fullmatch(r"data:image/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+", av) or len(av) > 300_000):
                    raise ApiError(400, "Foto inválida ou grande demais")
                c.execute("UPDATE users SET avatar=? WHERE id=?", (av, u["id"]))
            u = user_from_token(c, SimpleCookie(headers.get("Cookie", "")).get("tm").value)
        return 200, u
    if res == "status":
        need_role(u, "admin")
        return 200, {"smtp": smtp_ok(), "claude": bool(CFG["ANTHROPIC_API_KEY"]), "notify_hours": CFG["NOTIFY_HOURS"],
                     "import_token": setting(c, "import_token"),
                     "outbox": rows(c, "SELECT * FROM outbox ORDER BY id DESC LIMIT 20")}
    if res == "notify" and method == "POST":
        need_role(u, "admin")
        return lambda: (200, {"status": send_email(data["email"], "Central CVB - teste de notificação",
                                                   "Se você recebeu isto, o envio de e-mails está funcionando.")})
    if res == "check" and method == "POST":
        need_role(u, "admin")
        return lambda: (check_deadlines(), (200, {}))[1]
    # ----- usuários: só o administrador (TI) cadastra; a senha é criada pela própria pessoa pelo link do convite -----
    if res == "users":
        if method == "GET":
            need_role(u, "admin", "gestor")
            q = ("SELECT id,name,email,role,active,invited_at,(pw='') AS pending FROM users"
                 + ("" if u["role"] == "admin" else " WHERE active=1") + " ORDER BY name")
            return 200, rows(c, q)
        need_role(u, "admin")
        if method == "POST" and id_ is None:
            role = data.get("role")
            if role not in INVITABLE_ROLES:
                raise ApiError(400, "Perfil inválido (use Gestor, Membro ou Leitor)")
            created, skipped = [], []
            for item in (x.strip() for x in re.split(r"[\n;,]+", data.get("text") or "")):
                if not item:
                    continue
                m = re.fullmatch(r"(?:(.+?)\s*<([^<>\s]+)>|(\S+))", item)
                if not m:
                    skipped.append({"email": item, "reason": "formato inválido"})
                    continue
                name, email = (m.group(1) or "").strip(), (m.group(2) or m.group(3)).lower()
                if not valid_email(email):
                    skipped.append({"email": email, "reason": "use um e-mail @%s" % CFG["ALLOWED_DOMAIN"]})
                    continue
                try:
                    cur = c.execute("INSERT INTO users(name,email,pw,role) VALUES(?,?,?,?)", (name or name_from_email(email), email, "", role))
                except sqlite3.IntegrityError:
                    skipped.append({"email": email, "reason": "já cadastrado"})
                    continue
                created.append({"id": cur.lastrowid, "email": email})
            return 200, {"created": created, "skipped": skipped}
        if id_ is None:
            raise ApiError(404, "rota inválida")
        t = c.execute("SELECT * FROM users WHERE id=?", (id_,)).fetchone()
        if not t:
            raise ApiError(404, "Não encontrado")
        if method == "PATCH":
            sets = {}
            if "name" in data and (data["name"] or "").strip():
                sets["name"] = data["name"].strip()
            if "role" in data:
                if data["role"] not in ROLES:
                    raise ApiError(400, "Perfil inválido")
                if (data["role"] == "admin") != (t["role"] == "admin"):
                    raise ApiError(400, "Só existe um administrador (a TI): não dá para criar outro nem rebaixar este")
                sets["role"] = data["role"]
            if "active" in data:
                if t["role"] == "admin" and not data["active"]:
                    raise ApiError(400, "O administrador não pode ser desativado")
                sets["active"] = 1 if data["active"] else 0
            if sets:
                c.execute("UPDATE users SET %s WHERE id=?" % ",".join(k + "=?" for k in sets), (*sets.values(), id_))
            if sets.get("active") == 0:
                c.execute("DELETE FROM sessions WHERE user_id=?", (id_,))
            return 200, {}
        if method == "DELETE":
            if t["role"] == "admin":
                raise ApiError(400, "O administrador não pode ser excluído")
            for tb in ("sessions", "sector_members", "notifications"):
                c.execute("DELETE FROM %s WHERE user_id=?" % tb, (id_,))
            c.execute("UPDATE tasks SET assignee_id=NULL WHERE assignee_id=?", (id_,))
            c.execute("DELETE FROM users WHERE id=?", (id_,))
            return 200, {}
        if method == "POST" and sub == "link":  # só gera o link (para copiar e mandar por outro meio), sem enviar e-mail
            if not t["active"] or t["role"] == "admin":
                raise ApiError(400, "Não é possível convidar este usuário")
            return 200, {"link": invite_link(headers, make_invite(c, id_))}
        if method == "POST" and sub == "invite":  # envia (ou reenvia) o link; vale também para redefinir senha
            if not t["active"] or t["role"] == "admin":
                raise ApiError(400, "Não é possível convidar este usuário")
            item = (t["id"], t["email"], t["name"], invite_link(headers, make_invite(c, id_)))
            return lambda: (200, send_invites([item], reset=not t["pw"] == "")[0])
    if res == "invites" and method == "POST":  # lançamento: envia o link a todos que ainda não receberam
        need_role(u, "admin")
        items = [(r["id"], r["email"], r["name"], invite_link(headers, make_invite(c, r["id"])))
                 for r in c.execute("SELECT id,email,name FROM users WHERE pw='' AND active=1 AND role!='admin' AND invited_at IS NULL").fetchall()]
        return lambda: (200, {"sent": send_invites(items)})

    # ----- notificações (sino) -----
    if res == "notifications":
        if method == "GET":
            items = rows(c, """SELECT n.id, n.kind, n.text, n.task_id, n.created, n.read, a.name AS actor_name, t.title AS task_title
                FROM notifications n LEFT JOIN users a ON a.id=n.actor_id LEFT JOIN tasks t ON t.id=n.task_id
                WHERE n.user_id=? ORDER BY n.id DESC LIMIT 60""", u["id"])
            unread = c.execute("SELECT COUNT(*) FROM notifications WHERE user_id=? AND read=0", (u["id"],)).fetchone()[0]
            return 200, {"items": items, "unread": unread}
        if method == "POST" and sub == "readall":
            c.execute("UPDATE notifications SET read=1 WHERE user_id=?", (u["id"],))
            return 200, {}
        if method == "POST" and sub == "read" and id_:
            c.execute("UPDATE notifications SET read=1 WHERE id=? AND user_id=?", (id_, u["id"]))
            return 200, {}

    # ----- setores -----
    if res == "sectors":
        if method == "GET" and id_ is None:
            if u["role"] in ("admin", "gestor"):
                return 200, rows(c, "SELECT * FROM sectors ORDER BY pos,id")
            return 200, rows(c, "SELECT s.* FROM sectors s JOIN sector_members m ON m.sector_id=s.id WHERE m.user_id=? ORDER BY s.pos,s.id", u["id"])
        need(c, u, "view", id_)
        if method == "GET":
            sec = rows(c, "SELECT * FROM sectors WHERE id=?", id_)[0]
            sec["members"] = rows(c, "SELECT u.id,u.name,u.email,u.role FROM sector_members m JOIN users u ON u.id=m.user_id "
                                     "WHERE m.sector_id=? AND u.active=1 ORDER BY u.name", id_)
            sec["assignable"] = rows(c, "SELECT id,name,email,role FROM users WHERE active=1 AND (role IN ('admin','gestor') OR id IN "
                                        "(SELECT user_id FROM sector_members WHERE sector_id=?)) ORDER BY name", id_) \
                if u["role"] in ("admin", "gestor") else []
            return 200, sec
        if method == "POST" and sub == "members":
            need(c, u, "manage", id_)
            t = c.execute("SELECT id FROM users WHERE id=? AND active=1", (data.get("user_id"),)).fetchone()
            if not t:
                raise ApiError(404, "Usuário não encontrado")
            if data.get("add", True):
                c.execute("INSERT OR IGNORE INTO sector_members VALUES(?,?)", (id_, t[0]))
            else:
                c.execute("DELETE FROM sector_members WHERE sector_id=? AND user_id=?", (id_, t[0]))
                c.execute("UPDATE tasks SET assignee_id=NULL WHERE sector_id=? AND assignee_id=? AND ? NOT IN "
                          "(SELECT id FROM users WHERE role IN ('admin','gestor'))", (id_, t[0], t[0]))
            return 200, {}

    # ----- tarefas -----
    if res == "tasks":
        if method == "GET" and id_ is None:
            if u["role"] in ("admin", "gestor"):
                return 200, rows(c, TASK_SELECT + " ORDER BY t.id")
            return 200, rows(c, TASK_SELECT + " WHERE t.sector_id IN (SELECT sector_id FROM sector_members WHERE user_id=?) ORDER BY t.id", u["id"])
        if method == "POST" and id_ is None:
            sid = data.get("sector_id")
            need(c, u, "edit", sid)
            sets = task_fields(c, u, {"status": "todo", "priority": "media", **data}, sid)
            if "title" not in sets:
                raise ApiError(400, "Informe o título da tarefa")
            cols = {**sets, "sector_id": sid, "created_by": u["id"], "created": datetime.now().isoformat(timespec="minutes"),
                    "assignee_id": sets.get("assignee_id")}
            cur = c.execute("INSERT INTO tasks(%s) VALUES(%s)" % (",".join(cols), ",".join("?" * len(cols))), tuple(cols.values()))
            notify(c, cols["assignee_id"], "assign", u["id"], cur.lastrowid, "atribuiu você na tarefa")
            return 200, {"id": cur.lastrowid}
        if id_ is None:
            raise ApiError(404, "rota inválida")
        sid = sector_of(c, "tasks", id_)
        cur_task = c.execute("SELECT * FROM tasks WHERE id=?", (id_,)).fetchone()
        if method == "GET":
            need(c, u, "view", sid)
            t = rows(c, TASK_SELECT + " WHERE t.id=?", id_)[0]
            t["comment_list"] = rows(c, "SELECT k.id, k.user_id, k.text, k.created, COALESCE(a.name,'Usuário removido') AS author "
                                        "FROM task_comments k LEFT JOIN users a ON a.id=k.user_id WHERE k.task_id=? ORDER BY k.id", id_)
            t["meeting_list"] = rows(c, "SELECT id, title, created, transcript, summary FROM meetings WHERE task_id=? ORDER BY id DESC", id_)
            return 200, t
        if method == "POST" and sub == "comments":
            need(c, u, "comment", sid)
            text = (data.get("text") or "").strip()
            if not text:
                raise ApiError(400, "Escreva o comentário")
            cid = c.execute("INSERT INTO task_comments(task_id,user_id,text,created) VALUES(?,?,?,?)",
                            (id_, u["id"], text[:5000], datetime.now().isoformat(timespec="minutes"))).lastrowid
            for uid in {cur_task["assignee_id"], cur_task["created_by"]}:
                notify(c, uid, "comment", u["id"], id_, "comentou na tarefa")
            return 200, {"id": cid}
        if method == "PATCH":
            # funcionário (membro) só pode concluir (ou reabrir uma tarefa que ele mesmo concluiu); o resto é da gestão
            only_done = set(data) == {"status"} and (data["status"] == "done" or (data["status"] == "todo" and cur_task["status"] == "done"))
            need(c, u, "complete" if only_done else "edit", sid)
            new_sid = sid
            if "sector_id" in data and data["sector_id"] != sid:
                new_sid = data["sector_id"]
                need(c, u, "edit", new_sid)
            sets = task_fields(c, u, {k: v for k, v in data.items() if k != "sector_id"}, new_sid, cur_task)
            if new_sid != sid:
                sets["sector_id"] = new_sid
                if "assignee_id" not in data and cur_task["assignee_id"] and not assignable(c, cur_task["assignee_id"], new_sid):
                    sets["assignee_id"] = None
            if sets:
                c.execute("UPDATE tasks SET %s WHERE id=?" % ",".join(k + "=?" for k in sets), (*sets.values(), id_))
            if "assignee_id" in sets and sets["assignee_id"] != cur_task["assignee_id"]:
                notify(c, sets["assignee_id"], "assign", u["id"], id_, "atribuiu você na tarefa")
            return 200, {}
        if method == "DELETE":
            need(c, u, "edit", sid)
            c.execute("DELETE FROM tasks WHERE id=?", (id_,))
            c.execute("UPDATE meetings SET task_id=NULL WHERE task_id=?", (id_,))
            return 200, {}

    # ----- comentários -----
    if res == "comments" and method == "DELETE":
        r = c.execute("SELECT task_id, user_id FROM task_comments WHERE id=?", (id_,)).fetchone()
        if not r:
            raise ApiError(404, "Não encontrado")
        need(c, u, "comment" if r["user_id"] == u["id"] else "manage", sector_of(c, "tasks", r["task_id"]))
        c.execute("DELETE FROM task_comments WHERE id=?", (id_,))
        return 200, {}

    # ----- reuniões (gravações do Plaud) -----
    if res == "meetings":
        if method == "GET" and id_ is None:
            sel = ("SELECT m.id, m.title, m.created, m.transcript, m.summary, m.plaud_id, m.sector_id, m.task_id, "
                   "s.name AS sector_name, t.title AS task_title FROM meetings m LEFT JOIN sectors s ON s.id=m.sector_id "
                   "LEFT JOIN tasks t ON t.id=m.task_id")
            if u["role"] in ("admin", "gestor"):  # inclui as sem destino (só a gestão vê)
                return 200, rows(c, sel + " WHERE m.sector_id IS NOT NULL OR m.board_id IS NULL ORDER BY m.id DESC")
            return 200, rows(c, sel + " WHERE m.sector_id IN (SELECT sector_id FROM sector_members WHERE user_id=?) ORDER BY m.id DESC", u["id"])
        if method == "POST" and id_ is None:
            need(c, u, "edit", data.get("sector_id"))
            if data.get("task_id") and sector_of(c, "tasks", data["task_id"]) != data["sector_id"]:
                raise ApiError(400, "A tarefa não pertence ao setor")
            cur = c.execute("INSERT INTO meetings(sector_id,task_id,title,created,transcript) VALUES(?,?,?,?,?)",
                            (data["sector_id"], data.get("task_id") or None, data.get("title") or "Reunião",
                             datetime.now().isoformat(timespec="minutes"), data.get("transcript", "")))
            return 200, {"id": cur.lastrowid}
        sid = sector_of(c, "meetings", id_)
        if sid is None:  # sem destino: só a gestão (gestor/admin) mexe
            need_role(u, "admin", "gestor")
        if method == "PATCH":
            if "sector_id" in data or "task_id" in data:  # reatribuir (reuniões sem destino)
                need_role(u, "admin", "gestor")
                tsid = data.get("sector_id", sid)
                need(c, u, "manage", tsid)
                if data.get("task_id") and sector_of(c, "tasks", data["task_id"]) != tsid:
                    raise ApiError(400, "A tarefa não pertence ao setor")
            else:
                need(c, u, "edit", sid)
            sets = {k: data[k] for k in ("title", "transcript", "summary", "task_id", "sector_id") if k in data}
            if sets:
                c.execute("UPDATE meetings SET %s WHERE id=?" % ",".join(k + "=?" for k in sets), (*sets.values(), id_))
            return 200, {}
        if method == "DELETE":
            need(c, u, "manage", sid) if sid else None
            c.execute("DELETE FROM meetings WHERE id=?", (id_,))
            return 200, {}
        if method == "POST" and sub == "summarize":
            need(c, u, "edit", sid)
            t = c.execute("SELECT transcript FROM meetings WHERE id=?", (id_,)).fetchone()[0]
            if not t.strip():
                raise ApiError(400, "Sem transcrição para resumir.")
            if not CFG["ANTHROPIC_API_KEY"]:
                raise ApiError(400, "Configure ANTHROPIC_API_KEY para gerar resumo automático.")
            try:
                s = summarize(t)
            except Exception as e:  # noqa
                raise ApiError(502, "Falha no resumo: %s" % e)
            c.execute("UPDATE meetings SET summary=? WHERE id=?", (s, id_))
            return 200, {"summary": s}
    raise ApiError(404, "rota inválida")

def handle(method, path, data, headers, ctx):
    m = re.fullmatch(r"/api/(\w+)(?:/(\d+))?(?:/(\w+))?", path)
    if not m:
        raise ApiError(404, "rota inválida")
    res, id_, sub = m.group(1), int(m.group(2)) if m.group(2) else None, m.group(3)
    ck = SimpleCookie(headers.get("Cookie", "")).get("tm")
    with db_lock, db() as c:
        u = user_from_token(c, ck.value if ck else None)
        out = route(c, u, ctx, method, res, id_, sub, data, headers)
        if method == "DELETE":  # tarefas apagadas levam os comentários
            c.execute("DELETE FROM task_comments WHERE task_id NOT IN (SELECT id FROM tasks)")
    return out() if callable(out) else out  # envio de e-mail etc. fora do lock


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *a, **k):
        super().__init__(*a, directory=os.path.join(BASE, "static"), **k)

    def log_message(self, *a):
        pass

    def end_headers(self):
        self.send_header("Cache-Control", "no-cache")
        super().end_headers()

    def _api(self, method):
        n = int(self.headers.get("Content-Length") or 0)
        raw = self.rfile.read(min(n, 5_000_000)) if n else b""
        ctx = {}
        try:
            data = json.loads(raw.decode("utf-8")) if raw and "json" in self.headers.get("Content-Type", "") else {}
            code, out = handle(method, self.path.split("?")[0], data, self.headers, ctx)
        except ApiError as e:
            code, out = e.code, {"error": e.msg}
        except (KeyError, TypeError, ValueError) as e:
            code, out = 400, {"error": "Requisição inválida (%s)" % e}
        except Exception as e:  # noqa
            code, out = 500, {"error": str(e)}
        body = json.dumps(out, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        if "set_cookie" in ctx:
            t = ctx["set_cookie"]
            self.send_header("Set-Cookie", "tm=%s; Path=/; HttpOnly; SameSite=Lax; Max-Age=%d" % (t, SESSION_SECONDS if t else 0))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        return self._api("GET") if self.path.startswith("/api/") else super().do_GET()

    def do_POST(self):
        self._api("POST")

    def do_PATCH(self):
        self._api("PATCH")

    def do_DELETE(self):
        self._api("DELETE")


if __name__ == "__main__":
    init_db()
    if len(sys.argv) == 4 and sys.argv[1] == "setpw":  # recuperar acesso: python server.py setpw EMAIL NOVA_SENHA
        with db() as c:
            n = c.execute("UPDATE users SET pw=?, active=1 WHERE email=?", (hash_pw(sys.argv[3]), sys.argv[2].lower())).rowcount
            c.execute("DELETE FROM sessions")
        sys.exit("Senha alterada." if n else "Usuário não encontrado.")
    threading.Thread(target=notifier_loop, daemon=True).start()
    port = int(CFG["PORT"])
    print("Central CVB em http://%s:%d  (SMTP: %s, Claude: %s)" % (
        "localhost" if CFG["HOST"] == "127.0.0.1" else CFG["HOST"], port,
        "ok" if smtp_ok() else "não configurado", "ok" if CFG["ANTHROPIC_API_KEY"] else "não"))
    ThreadingHTTPServer((CFG["HOST"], port), Handler).serve_forever()
