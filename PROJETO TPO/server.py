"""TaskMeet - gestão de tarefas (estilo Trello) + reuniões transcritas (estilo Plaud)
+ avisos de prazo por e-mail (Outlook/SMTP). Só biblioteca padrão do Python 3.
Rodar:  python server.py   ->  http://localhost:8000
"""
import json, os, re, smtplib, sqlite3, threading, time, unicodedata, urllib.request
from datetime import datetime, timedelta
from email.message import EmailMessage
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

BASE = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.join(BASE, "taskmeet.db")
AUDIO_DIR = os.path.join(BASE, "audios")
os.makedirs(AUDIO_DIR, exist_ok=True)

# ---------- configuração (config.json ou variáveis de ambiente) ----------
CFG = {
    "SMTP_HOST": "smtp.office365.com", "SMTP_PORT": "587", "SMTP_USER": "", "SMTP_PASS": "",
    "SMTP_FROM": "", "ANTHROPIC_API_KEY": "",
    "NOTIFY_HOURS": "24", "CHECK_MINUTES": "10", "PORT": "8000",
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


def init_db():
    with db() as c:
        c.executescript("""
        CREATE TABLE IF NOT EXISTS boards(id INTEGER PRIMARY KEY, title TEXT, color TEXT DEFAULT '#0079bf',
            due TEXT, owner_email TEXT DEFAULT '', notified INTEGER DEFAULT 0);
        CREATE TABLE IF NOT EXISTS lists(id INTEGER PRIMARY KEY, board_id INTEGER, title TEXT, pos INTEGER DEFAULT 0);
        CREATE TABLE IF NOT EXISTS cards(id INTEGER PRIMARY KEY, list_id INTEGER, title TEXT, description TEXT DEFAULT '',
            due TEXT, assignee_email TEXT DEFAULT '', done INTEGER DEFAULT 0, notified INTEGER DEFAULT 0, pos INTEGER DEFAULT 0);
        CREATE TABLE IF NOT EXISTS meetings(id INTEGER PRIMARY KEY, board_id INTEGER, card_id INTEGER, title TEXT,
            created TEXT, transcript TEXT DEFAULT '', summary TEXT DEFAULT '', audio TEXT DEFAULT '', status TEXT DEFAULT 'ok');
        CREATE TABLE IF NOT EXISTS outbox(id INTEGER PRIMARY KEY, to_email TEXT, subject TEXT, body TEXT, sent_at TEXT, status TEXT);
        """)


    with db() as c:
        cols = [r[1] for r in c.execute("PRAGMA table_info(meetings)")]
        if "plaud_id" not in cols:
            c.execute("ALTER TABLE meetings ADD COLUMN plaud_id TEXT")


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


def check_deadlines():
    limit = datetime.now() + timedelta(hours=float(CFG["NOTIFY_HOURS"]))
    with db_lock, db() as c:
        cards = rows(c, """SELECT c.*, b.title AS board_title FROM cards c JOIN lists l ON l.id=c.list_id
            JOIN boards b ON b.id=l.board_id WHERE c.done=0 AND c.notified=0 AND c.due IS NOT NULL AND c.due!=''
            AND c.assignee_email!=''""")
        boards = rows(c, "SELECT * FROM boards WHERE notified=0 AND due IS NOT NULL AND due!='' AND owner_email!=''")
    for k in cards:
        d = parse_due(k["due"])
        if d and d <= limit:
            late = d < datetime.now()
            send_email(k["assignee_email"],
                       ("[ATRASADA] " if late else "[Prazo próximo] ") + k["title"],
                       "Olá!\n\nA tarefa \"%s\" (projeto %s) %s em %s.\n\nAbra o TaskMeet para atualizá-la."
                       % (k["title"], k["board_title"], "venceu" if late else "vence", d.strftime("%d/%m/%Y %H:%M")))
            with db_lock, db() as c:
                c.execute("UPDATE cards SET notified=1 WHERE id=?", (k["id"],))
    for b in boards:
        d = parse_due(b["due"])
        if d and d <= limit:
            late = d < datetime.now()
            send_email(b["owner_email"],
                       ("[ATRASADO] " if late else "[Prazo próximo] ") + "Projeto " + b["title"],
                       "Olá!\n\nO projeto \"%s\" %s em %s." % (b["title"], "venceu" if late else "vence", d.strftime("%d/%m/%Y %H:%M")))
            with db_lock, db() as c:
                c.execute("UPDATE boards SET notified=1 WHERE id=?", (b["id"],))


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
    """Acha o cartão (ou, se não houver, o projeto) cujo título aparece no nome da gravação.
    Vence o título mais longo (mais específico). Retorna (board_id, card_id) ou (None, None)."""
    n = norm(name)
    best = None
    for k in rows(c, "SELECT c.id, c.title, l.board_id FROM cards c JOIN lists l ON l.id=c.list_id"):
        t = norm(k["title"])
        if t and t in n and (best is None or len(t) > best[0]):
            best = (len(t), k["board_id"], k["id"])
    if best:
        return best[1], best[2]
    for b in rows(c, "SELECT id, title FROM boards"):
        t = norm(b["title"])
        if t and t in n and (best is None or len(t) > best[0]):
            best = (len(t), b["id"], None)
    return (best[1], best[2]) if best else (None, None)


def import_recording(c, d):
    """d: {plaud_id?, name, transcript?, summary?, created?}. Idempotente por plaud_id."""
    pid = str(d.get("plaud_id") or "")
    if pid:
        old = rows(c, "SELECT id, board_id, card_id FROM meetings WHERE plaud_id=?", pid)
        if old:  # atualiza texto (ex.: transcrição ficou pronta depois), mantém o vínculo
            for f in ("transcript", "summary"):
                if d.get(f):
                    c.execute("UPDATE meetings SET %s=? WHERE id=?" % f, (d[f], old[0]["id"]))
            return {"id": old[0]["id"], "board_id": old[0]["board_id"], "card_id": old[0]["card_id"], "updated": True}
    bid, cid = match_target(c, d.get("name", ""))
    cur = c.execute("INSERT INTO meetings(board_id,card_id,title,created,transcript,summary,plaud_id) VALUES(?,?,?,?,?,?,?)",
                    (bid, cid, d.get("name") or "Gravação Plaud", (d.get("created") or datetime.now().isoformat())[:16],
                     d.get("transcript", ""), d.get("summary", ""), pid or None))
    return {"id": cur.lastrowid, "board_id": bid, "card_id": cid, "matched": bid is not None}


# ---------- API ----------
def board_payload(c, bid):
    b = rows(c, "SELECT * FROM boards WHERE id=?", bid)
    if not b:
        return None
    b = b[0]
    b["lists"] = rows(c, "SELECT * FROM lists WHERE board_id=? ORDER BY pos,id", bid)
    for l in b["lists"]:
        l["cards"] = rows(c, "SELECT *, (SELECT COUNT(*) FROM meetings m WHERE m.card_id=cards.id) AS meetings "
                             "FROM cards WHERE list_id=? ORDER BY pos,id", l["id"])
    b["meetings"] = rows(c, "SELECT id,board_id,card_id,title,created,transcript,summary,plaud_id "
                            "FROM meetings WHERE board_id=? ORDER BY id DESC", bid)
    return b


CARD_FIELDS = ("title", "description", "due", "assignee_email", "done")
BOARD_FIELDS = ("title", "color", "due", "owner_email")


def patch(c, table, id_, data, allowed):
    sets = {k: data[k] for k in allowed if k in data}
    if not sets:
        return
    if table == "cards" and "due" in sets or table == "boards" and "due" in sets:
        sets["notified"] = 0  # novo prazo => pode avisar de novo
    if table == "cards" and "done" in sets:
        sets["done"] = 1 if sets["done"] else 0
    c.execute("UPDATE %s SET %s WHERE id=?" % (table, ",".join(k + "=?" for k in sets)), (*sets.values(), id_))


def handle(method, path, data, raw, ctype):
    """Retorna (status, objeto_json)."""
    m = re.fullmatch(r"/api/(\w+)(?:/(\d+))?(?:/(\w+))?", path)
    if not m:
        return 404, {"error": "rota inválida"}
    res, id_, sub = m.group(1), int(m.group(2)) if m.group(2) else None, m.group(3)
    with db_lock, db() as c:
        if res == "status":
            return 200, {"smtp": smtp_ok(), "claude": bool(CFG["ANTHROPIC_API_KEY"]), "notify_hours": CFG["NOTIFY_HOURS"],
                         "outbox": rows(c, "SELECT * FROM outbox ORDER BY id DESC LIMIT 20")}
        if res == "plaud" and method == "POST":
            return 200, import_recording(c, data)
        if res == "inbox":
            return 200, rows(c, "SELECT * FROM meetings WHERE board_id IS NULL ORDER BY id DESC")
        if res == "targets":
            return 200, rows(c, "SELECT b.id AS board_id, b.title AS board, c.id AS card_id, c.title AS card FROM boards b "
                                "LEFT JOIN lists l ON l.board_id=b.id LEFT JOIN cards c ON c.list_id=l.id ORDER BY b.id, c.id")
        if res == "boards":
            if method == "GET" and id_ is None:
                return 200, rows(c, "SELECT * FROM boards ORDER BY id")
            if method == "GET":
                p = board_payload(c, id_)
                return (200, p) if p else (404, {"error": "não encontrado"})
            if method == "POST":
                cur = c.execute("INSERT INTO boards(title,color) VALUES(?,?)", (data["title"], data.get("color", "#0079bf")))
                for i, t in enumerate(("A fazer", "Em andamento", "Concluído")):
                    c.execute("INSERT INTO lists(board_id,title,pos) VALUES(?,?,?)", (cur.lastrowid, t, i))
                return 200, {"id": cur.lastrowid}
            if method == "PATCH":
                patch(c, "boards", id_, data, BOARD_FIELDS)
                return 200, {}
            if method == "DELETE":
                for l in rows(c, "SELECT id FROM lists WHERE board_id=?", id_):
                    c.execute("DELETE FROM cards WHERE list_id=?", (l["id"],))
                c.execute("DELETE FROM lists WHERE board_id=?", (id_,))
                c.execute("DELETE FROM meetings WHERE board_id=?", (id_,))
                c.execute("DELETE FROM boards WHERE id=?", (id_,))
                return 200, {}
        if res == "lists":
            if method == "POST":
                pos = c.execute("SELECT COALESCE(MAX(pos),-1)+1 FROM lists WHERE board_id=?", (data["board_id"],)).fetchone()[0]
                cur = c.execute("INSERT INTO lists(board_id,title,pos) VALUES(?,?,?)", (data["board_id"], data["title"], pos))
                return 200, {"id": cur.lastrowid}
            if method == "PATCH":
                c.execute("UPDATE lists SET title=? WHERE id=?", (data["title"], id_))
                return 200, {}
            if method == "DELETE":
                c.execute("DELETE FROM cards WHERE list_id=?", (id_,))
                c.execute("DELETE FROM lists WHERE id=?", (id_,))
                return 200, {}
        if res == "cards":
            if method == "POST" and id_ is None:
                pos = c.execute("SELECT COALESCE(MAX(pos),-1)+1 FROM cards WHERE list_id=?", (data["list_id"],)).fetchone()[0]
                cur = c.execute("INSERT INTO cards(list_id,title,pos) VALUES(?,?,?)", (data["list_id"], data["title"], pos))
                return 200, {"id": cur.lastrowid}
            if method == "POST" and sub == "move":
                ids = [r["id"] for r in rows(c, "SELECT id FROM cards WHERE list_id=? AND id!=? ORDER BY pos,id", data["list_id"], id_)]
                ids.insert(max(0, min(int(data["index"]), len(ids))), id_)
                for i, cid in enumerate(ids):
                    c.execute("UPDATE cards SET pos=?, list_id=? WHERE id=?", (i, data["list_id"], cid))
                return 200, {}
            if method == "PATCH":
                patch(c, "cards", id_, data, CARD_FIELDS)
                return 200, {}
            if method == "DELETE":
                c.execute("DELETE FROM cards WHERE id=?", (id_,))
                return 200, {}
        if res == "meetings":
            if method == "POST" and id_ is None:
                cur = c.execute("INSERT INTO meetings(board_id,card_id,title,created,transcript) VALUES(?,?,?,?,?)",
                                (data["board_id"], data.get("card_id") or None, data.get("title") or "Reunião",
                                 datetime.now().isoformat(timespec="minutes"), data.get("transcript", "")))
                return 200, {"id": cur.lastrowid}
            if method == "PATCH":
                sets = {k: data[k] for k in ("title", "transcript", "summary", "card_id", "board_id") if k in data}
                if sets:
                    c.execute("UPDATE meetings SET %s WHERE id=?" % ",".join(k + "=?" for k in sets), (*sets.values(), id_))
                return 200, {}
            if method == "DELETE":
                c.execute("DELETE FROM meetings WHERE id=?", (id_,))
                return 200, {}
            if method == "POST" and sub == "summarize":
                t = rows(c, "SELECT transcript FROM meetings WHERE id=?", id_)[0]["transcript"]
                if not t.strip():
                    return 400, {"error": "Sem transcrição para resumir."}
                if not CFG["ANTHROPIC_API_KEY"]:
                    return 400, {"error": "Configure ANTHROPIC_API_KEY para gerar resumo automático."}
                try:
                    s = summarize(t)
                except Exception as e:  # noqa
                    return 502, {"error": "Falha no resumo: %s" % e}
                c.execute("UPDATE meetings SET summary=? WHERE id=?", (s, id_))
                return 200, {"summary": s}
        if res == "notify" and method == "POST":
            pass
    if res == "notify":  # fora do lock (send_email também usa o lock)
        return 200, {"status": send_email(data["email"], "TaskMeet - teste de notificação", "Se você recebeu isto, o envio de e-mails está funcionando.")}
    if res == "check":
        check_deadlines()
        return 200, {}
    return 404, {"error": "rota inválida"}


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *a, **k):
        super().__init__(*a, directory=os.path.join(BASE, "static"), **k)

    def log_message(self, *a):
        pass

    def _api(self, method):
        n = int(self.headers.get("Content-Length") or 0)
        raw = self.rfile.read(n) if n else b""
        ctype = self.headers.get("Content-Type", "")
        data = {}
        path = self.path.split("?")[0]
        try:
            if raw and "json" in ctype:
                data = json.loads(raw.decode("utf-8"))
            code, out = handle(method, path, data, raw, ctype)
        except Exception as e:  # noqa
            code, out = 500, {"error": str(e)}
        body = json.dumps(out, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path.startswith("/api/"):
            return self._api("GET")
        if self.path.startswith("/audio/"):
            fn = os.path.basename(self.path[7:])
            p = os.path.join(AUDIO_DIR, fn)
            if os.path.exists(p):
                with open(p, "rb") as f:
                    body = f.read()
                self.send_response(200)
                self.send_header("Content-Type", "audio/webm")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)
                return
            return self.send_error(404)
        return super().do_GET()

    def do_POST(self):
        self._api("POST")

    def do_PATCH(self):
        self._api("PATCH")

    def do_DELETE(self):
        self._api("DELETE")


if __name__ == "__main__":
    init_db()
    threading.Thread(target=notifier_loop, daemon=True).start()
    port = int(CFG["PORT"])
    print("TaskMeet em http://localhost:%d  (SMTP: %s, Claude: %s)" % (
        port, "ok" if smtp_ok() else "não configurado", "ok" if CFG["ANTHROPIC_API_KEY"] else "não"))
    ThreadingHTTPServer(("127.0.0.1", port), Handler).serve_forever()
