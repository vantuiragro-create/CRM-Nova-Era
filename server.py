#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
CRM de Leads do Agro — servidor sem dependencias (so a biblioteca padrao do Python).

Como rodar:
    python3 server.py

Abre em http://localhost:3000
Webhook do Chatwoot: http://localhost:3000/webhook/chatwoot?token=SEU_TOKEN
(o token aparece no terminal quando o servidor inicia)
"""

import json
import os
import re
import base64
import hashlib
import secrets
import threading
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs

# ---------------------------------------------------------------------------
# Configuracao
# ---------------------------------------------------------------------------
PORT = int(os.environ.get("PORT", "3000"))

# Token do webhook (protege o endpoint). Defina WEBHOOK_TOKEN no ambiente para fixar.
WEBHOOK_TOKEN = os.environ.get("WEBHOOK_TOKEN") or hashlib.sha256(
    ("chatwoot-crm-" + os.environ.get("USER", "local")).encode()
).hexdigest()[:16]

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
# DATA_DIR pode ser sobrescrito por variavel de ambiente (ex.: um volume /data
# na nuvem), para os leads nao sumirem quando o servidor reinicia.
DATA_DIR = os.environ.get("DATA_DIR") or os.path.join(BASE_DIR, "data")
DB_FILE = os.path.join(DATA_DIR, "leads.json")
PUBLIC_DIR = os.path.join(BASE_DIR, "public")

# Etapas do funil (ordem = ordem das colunas)
#   novo/triagem       -> fase do SDR (primeiro contato e qualificacao)
#   produtor..ganho    -> fase do vendedor (produtor rural qualificado)
#   perdido / prestador-> terminais (perdido = produtor que nao fechou;
#                         prestador = fora do perfil)
STAGES = ["novo", "triagem", "produtor", "negociacao", "proposta", "ganho", "perdido", "prestador"]

# Papeis da equipe
PAPEIS = ("sdr", "vendedor")

EDITABLE = {
    "nome", "telefone", "email", "regiao", "area_cultivada", "produto", "valor",
    "vendedor", "sdr", "responsavel", "tipo", "origem_canal", "campanha",
    "utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term",
    "status", "observacoes",
}

MIME = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".svg": "image/svg+xml",
    ".ico": "image/x-icon",
}

# ---------------------------------------------------------------------------
# Camada de dados (JSON em arquivo + lock para acesso concorrente)
# ---------------------------------------------------------------------------
_lock = threading.Lock()
# members: equipe (SDRs e vendedores) | rr_sdr: indice do rodizio de SDRs
_db = {"leads": [], "members": [], "rr_sdr": 0}


def now_iso():
    return datetime.now(timezone.utc).isoformat()


def new_id():
    return base64.urlsafe_b64encode(secrets.token_bytes(9)).decode().rstrip("=")


def load_db():
    global _db
    try:
        if os.path.exists(DB_FILE):
            with open(DB_FILE, "r", encoding="utf-8") as f:
                data = json.load(f)
            if not isinstance(data.get("leads"), list):
                data["leads"] = []
            if not isinstance(data.get("members"), list):
                data["members"] = []
            if not isinstance(data.get("rr_sdr"), int):
                data["rr_sdr"] = 0
            _db = data
    except Exception as e:
        print("Falha ao ler o banco, comecando vazio:", e)
        _db = {"leads": []}


def save_db():
    """Escrita atomica: grava em .tmp e renomeia."""
    try:
        os.makedirs(DATA_DIR, exist_ok=True)
        tmp = DB_FILE + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(_db, f, ensure_ascii=False, indent=2)
        os.replace(tmp, DB_FILE)
    except Exception as e:
        print("Falha ao salvar o banco:", e)


def make_lead(partial=None):
    lead = {
        "id": new_id(),
        "source": "manual",
        "chatwoot_conversation_id": None,
        "chatwoot_contact_id": None,
        "nome": "",
        "telefone": "",
        "email": "",
        "regiao": "",
        "area_cultivada": "",
        "produto": "",
        "valor": 0,
        "tipo": "",        # ""=nao classificado | "produtor" | "prestador"
        "sdr": "",         # SDR que recebeu/qualificou
        "vendedor": "",    # vendedor responsavel apos qualificar
        "responsavel": "", # dono atual do lead (SDR na triagem, vendedor depois)
        "origem_canal": "",
        "campanha": "",
        "utm_source": "",
        "utm_medium": "",
        "utm_campaign": "",
        "utm_content": "",
        "utm_term": "",
        "status": "novo",
        "observacoes": "",
        "last_message": "",
        "created_at": now_iso(),
        "updated_at": now_iso(),
    }
    if partial:
        lead.update(partial)
    return lead


PRODUTOR_STAGES = ("produtor", "negociacao", "proposta", "ganho")


def apply_updates(lead, updates):
    for key, value in updates.items():
        if key not in EDITABLE:
            continue
        if key == "status" and value not in STAGES:
            continue
        if key == "tipo" and value not in ("", "produtor", "prestador"):
            continue
        if key == "valor":
            try:
                lead["valor"] = float(value) if value not in ("", None) else 0
            except (TypeError, ValueError):
                lead["valor"] = 0
            continue
        lead[key] = value

    # Consistencia automatica entre a coluna e a classificacao do lead:
    if "status" in updates:
        if lead["status"] == "prestador":
            lead["tipo"] = "prestador"
        elif lead["status"] in PRODUTOR_STAGES:
            lead["tipo"] = "produtor"

    # Ao definir um vendedor, a posse do lead passa para ele (a menos que o
    # responsavel tenha sido informado explicitamente na mesma atualizacao).
    if updates.get("vendedor") and "responsavel" not in updates:
        lead["responsavel"] = updates["vendedor"]

    lead["updated_at"] = now_iso()
    return lead


def active_members(papel=None):
    out = [m for m in _db.get("members", []) if m.get("ativo", True)]
    if papel:
        out = [m for m in out if m.get("papel") == papel]
    return out


def next_sdr():
    """Escolhe o proximo SDR no rodizio (round-robin). Retorna nome ou ''."""
    sdrs = active_members("sdr")
    if not sdrs:
        return ""
    idx = _db.get("rr_sdr", 0) % len(sdrs)
    _db["rr_sdr"] = (idx + 1) % len(sdrs)
    return sdrs[idx].get("nome", "")


# ---------------------------------------------------------------------------
# Integracao com o Chatwoot
# ---------------------------------------------------------------------------
def parse_utms(referer):
    out = {}
    if not referer or not isinstance(referer, str):
        return out
    try:
        qs = parse_qs(urlparse(referer).query)
        for f in ("utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term"):
            if qs.get(f):
                out[f] = qs[f][0]
    except Exception:
        pass
    return out


def guess_canal(utms, referer):
    hay = ((utms.get("utm_source") or "") + " " + (referer or "")).lower()
    if re.search(r"facebook|instagram|fb|ig|meta", hay):
        return "Meta"
    if re.search(r"google|adwords|gclid", hay):
        return "Google"
    if re.search(r"whatsapp|wa\.me", hay):
        return "WhatsApp"
    if re.search(r"tiktok", hay):
        return "TikTok"
    if utms.get("utm_source"):
        return utms["utm_source"]
    return ""


def handle_chatwoot_event(payload):
    event = payload.get("event") if isinstance(payload, dict) else None
    if not event:
        return {"ok": False, "reason": "sem evento"}

    conversation = payload.get("conversation") or payload
    meta = conversation.get("meta") or payload.get("meta") or {}
    sender = (
        meta.get("sender")
        or payload.get("sender")
        or (payload.get("contact_inbox") or {}).get("contact")
        or {}
    )

    conversation_id = (
        conversation.get("id")
        or payload.get("conversation_id")
        or (payload.get("conversation") or {}).get("id")
    )

    add_attrs = conversation.get("additional_attributes") or payload.get("additional_attributes") or {}
    referer = add_attrs.get("referer") or add_attrs.get("referrer") or ""
    utms = dict(parse_utms(referer))
    custom = conversation.get("custom_attributes") or payload.get("custom_attributes") or {}
    for f in ("utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term"):
        if not utms.get(f) and custom.get(f):
            utms[f] = str(custom[f])
        if not utms.get(f) and add_attrs.get(f):
            utms[f] = str(add_attrs[f])
    canal = guess_canal(utms, referer)

    last_message = ""
    msgs = payload.get("messages")
    if isinstance(msgs, list) and msgs:
        last_message = msgs[-1].get("content") or ""
    elif payload.get("content"):
        last_message = payload.get("content")

    nome = sender.get("name") or sender.get("pushname") or ""
    telefone = sender.get("phone_number") or sender.get("phone") or ""
    email = sender.get("email") or ""
    contact_id = sender.get("id")

    sender_custom = sender.get("custom_attributes") or {}
    regiao = sender_custom.get("regiao") or sender_custom.get("region") or custom.get("regiao") or ""
    area = sender_custom.get("area_cultivada") or sender_custom.get("area") or custom.get("area_cultivada") or ""
    produto = sender_custom.get("produto") or custom.get("produto") or ""

    incoming = {
        "source": "chatwoot",
        "chatwoot_conversation_id": conversation_id,
        "chatwoot_contact_id": contact_id,
        "nome": nome,
        "telefone": telefone,
        "email": email,
        "regiao": regiao,
        "area_cultivada": area,
        "produto": produto,
        "origem_canal": canal,
        "campanha": utms.get("utm_campaign", ""),
        "last_message": last_message,
    }
    incoming.update(utms)

    with _lock:
        lead = None
        if conversation_id is not None:
            lead = next((l for l in _db["leads"] if l.get("chatwoot_conversation_id") == conversation_id), None)

        if lead is None:
            if conversation_id is None and not telefone and not email:
                return {"ok": False, "reason": "evento sem dados de contato"}
            lead = make_lead(incoming)
            # Rodizio: o lead novo ja cai para um SDR fazer o primeiro contato.
            sdr = next_sdr()
            if sdr:
                lead["sdr"] = sdr
                lead["responsavel"] = sdr
            _db["leads"].append(lead)
            save_db()
            print("[webhook] novo lead: %s -> SDR %s (canal: %s)" % (
                nome or telefone or conversation_id, sdr or "-", canal or "-"))
            return {"ok": True, "created": True, "id": lead["id"], "sdr": sdr}

        for key, value in incoming.items():
            if key == "last_message":
                if value:
                    lead["last_message"] = value
                continue
            if value and not lead.get(key):
                lead[key] = value
        lead["updated_at"] = now_iso()
        save_db()
        print("[webhook] lead atualizado: %s" % (lead.get("nome") or lead.get("telefone") or lead["id"]))
        return {"ok": True, "created": False, "id": lead["id"]}


# ---------------------------------------------------------------------------
# Servidor HTTP
# ---------------------------------------------------------------------------
class Handler(BaseHTTPRequestHandler):
    server_version = "AgroCRM/1.0"

    def log_message(self, fmt, *args):
        pass  # silencioso (evita poluir o terminal com cada request)

    # -- helpers de resposta --
    def send_json(self, status, obj):
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def read_body(self):
        length = int(self.headers.get("Content-Length") or 0)
        if length <= 0:
            return {}
        if length > 5 * 1024 * 1024:
            raise ValueError("corpo muito grande")
        raw = self.rfile.read(length)
        if not raw:
            return {}
        return json.loads(raw.decode("utf-8"))

    # -- roteamento --
    def do_GET(self):
        parsed = urlparse(self.path)
        path = parsed.path
        if path.startswith("/api/"):
            return self.handle_api("GET", parsed)
        return self.serve_static(path)

    def do_POST(self):
        parsed = urlparse(self.path)
        path = parsed.path
        if path == "/webhook/chatwoot":
            return self.handle_webhook(parsed)
        if path.startswith("/api/"):
            return self.handle_api("POST", parsed)
        self.send_json(404, {"error": "Nao encontrado"})

    def do_PATCH(self):
        parsed = urlparse(self.path)
        if parsed.path.startswith("/api/"):
            return self.handle_api("PATCH", parsed)
        self.send_json(404, {"error": "Nao encontrado"})

    def do_PUT(self):
        self.do_PATCH()

    def do_DELETE(self):
        parsed = urlparse(self.path)
        if parsed.path.startswith("/api/"):
            return self.handle_api("DELETE", parsed)
        self.send_json(404, {"error": "Nao encontrado"})

    # -- webhook --
    def handle_webhook(self, parsed):
        qs = parse_qs(parsed.query)
        token = (qs.get("token") or [None])[0] or self.headers.get("X-Webhook-Token")
        if token != WEBHOOK_TOKEN:
            return self.send_json(401, {"error": "Token invalido"})
        try:
            payload = self.read_body()
        except Exception:
            return self.send_json(400, {"error": "Corpo invalido"})
        try:
            result = handle_chatwoot_event(payload)
        except Exception as e:
            print("Erro no webhook:", e)
            result = {"ok": False, "reason": "erro interno"}
        # Responde 200 sempre pro Chatwoot nao reenviar em loop.
        self.send_json(200, result)

    # -- API --
    def handle_api(self, method, parsed):
        path = parsed.path
        qs = parse_qs(parsed.query)

        # Estatisticas
        if path == "/api/stats" and method == "GET":
            with _lock:
                por_status = {s: {"count": 0, "valor": 0} for s in STAGES}
                total_valor = 0
                for l in _db["leads"]:
                    s = l.get("status") if l.get("status") in STAGES else "novo"
                    por_status[s]["count"] += 1
                    por_status[s]["valor"] += float(l.get("valor") or 0)
                    if l.get("status") not in ("perdido", "prestador"):
                        total_valor += float(l.get("valor") or 0)
                produtores = sum(1 for l in _db["leads"] if l.get("tipo") == "produtor")
                return self.send_json(200, {
                    "total": len(_db["leads"]),
                    "valor_pipeline": total_valor,
                    "produtores": produtores,
                    "por_status": por_status,
                    "stages": STAGES,
                })

        # Equipe (SDRs e vendedores)
        if path == "/api/members" and method == "GET":
            with _lock:
                return self.send_json(200, {"members": list(_db.get("members", []))})

        if path == "/api/members" and method == "POST":
            try:
                body = self.read_body()
            except Exception:
                return self.send_json(400, {"error": "Corpo invalido"})
            nome = (body.get("nome") or "").strip()
            papel = body.get("papel")
            if not nome:
                return self.send_json(400, {"error": "Informe o nome"})
            if papel not in PAPEIS:
                return self.send_json(400, {"error": "Papel invalido"})
            with _lock:
                member = {"id": new_id(), "nome": nome, "papel": papel, "ativo": True}
                _db.setdefault("members", []).append(member)
                save_db()
                return self.send_json(201, {"member": member})

        mm = re.match(r"^/api/members/([^/]+)$", path)
        if mm:
            member_id = mm.group(1)
            with _lock:
                member = next((x for x in _db.get("members", []) if x["id"] == member_id), None)
                if not member:
                    return self.send_json(404, {"error": "Membro nao encontrado"})
                if method in ("PATCH", "PUT"):
                    try:
                        body = self.read_body()
                    except Exception:
                        return self.send_json(400, {"error": "Corpo invalido"})
                    if "nome" in body and str(body["nome"]).strip():
                        member["nome"] = str(body["nome"]).strip()
                    if body.get("papel") in PAPEIS:
                        member["papel"] = body["papel"]
                    if "ativo" in body:
                        member["ativo"] = bool(body["ativo"])
                    save_db()
                    return self.send_json(200, {"member": member})
                if method == "DELETE":
                    _db["members"] = [x for x in _db.get("members", []) if x["id"] != member_id]
                    save_db()
                    return self.send_json(200, {"ok": True})

        # Listar
        if path == "/api/leads" and method == "GET":
            q = (qs.get("q") or [""])[0].lower().strip()
            canal = (qs.get("canal") or [""])[0]
            with _lock:
                leads = list(_db["leads"])
            if q:
                def match(l):
                    blob = " ".join(str(l.get(k) or "") for k in
                                    ("nome", "telefone", "email", "regiao", "produto", "campanha", "vendedor")).lower()
                    return q in blob
                leads = [l for l in leads if match(l)]
            if canal:
                leads = [l for l in leads if l.get("origem_canal") == canal]
            leads.sort(key=lambda l: l.get("updated_at") or "", reverse=True)
            return self.send_json(200, {"leads": leads, "stages": STAGES})

        # Criar
        if path == "/api/leads" and method == "POST":
            try:
                body = self.read_body()
            except Exception:
                return self.send_json(400, {"error": "Corpo invalido"})
            with _lock:
                lead = make_lead({"source": "manual"})
                apply_updates(lead, body)
                if body.get("status") in STAGES:
                    lead["status"] = body["status"]
                _db["leads"].append(lead)
                save_db()
                return self.send_json(201, {"lead": lead})

        # Editar / excluir por id
        m = re.match(r"^/api/leads/([^/]+)$", path)
        if m:
            lead_id = m.group(1)
            with _lock:
                lead = next((l for l in _db["leads"] if l["id"] == lead_id), None)
                if not lead:
                    return self.send_json(404, {"error": "Lead nao encontrado"})
                if method in ("PATCH", "PUT"):
                    try:
                        body = self.read_body()
                    except Exception:
                        return self.send_json(400, {"error": "Corpo invalido"})
                    apply_updates(lead, body)
                    save_db()
                    return self.send_json(200, {"lead": lead})
                if method == "DELETE":
                    _db["leads"] = [l for l in _db["leads"] if l["id"] != lead_id]
                    save_db()
                    return self.send_json(200, {"ok": True})

        return self.send_json(404, {"error": "Rota nao encontrada"})

    # -- arquivos estaticos --
    def serve_static(self, path):
        rel = "/index.html" if path == "/" else path
        # normaliza e impede path traversal
        rel = os.path.normpath(rel).lstrip("/\\")
        file_path = os.path.join(PUBLIC_DIR, rel)
        if not os.path.abspath(file_path).startswith(PUBLIC_DIR):
            self.send_response(403)
            self.end_headers()
            self.wfile.write(b"Forbidden")
            return
        if not os.path.isfile(file_path):
            self.send_response(404)
            self.send_header("Content-Type", "text/plain; charset=utf-8")
            self.end_headers()
            self.wfile.write("Nao encontrado".encode("utf-8"))
            return
        ext = os.path.splitext(file_path)[1].lower()
        with open(file_path, "rb") as f:
            data = f.read()
        self.send_response(200)
        self.send_header("Content-Type", MIME.get(ext, "application/octet-stream"))
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)


def main():
    load_db()
    httpd = ThreadingHTTPServer(("0.0.0.0", PORT), Handler)
    print("")
    print("  CRM de Leads do Agro rodando")
    print("  -----------------------------------------------")
    print("  Painel:   http://localhost:%d" % PORT)
    print("  Webhook:  http://localhost:%d/webhook/chatwoot?token=%s" % (PORT, WEBHOOK_TOKEN))
    print("  Leads salvos em: %s" % DB_FILE)
    print("  -----------------------------------------------")
    print("  (Ctrl+C para parar)")
    print("")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\n  Encerrando...")
        httpd.shutdown()


if __name__ == "__main__":
    main()
