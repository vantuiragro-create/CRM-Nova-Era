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
import math
import os
import re
import base64
import hashlib
import secrets
import threading
import time
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
    "campanha_id", "utm_source", "utm_medium", "utm_campaign", "utm_content",
    "utm_term", "status", "observacoes", "lat", "lng",
}

# Canais aceitos para campanhas cadastradas
CANAIS = ("Meta", "Google", "WhatsApp", "TikTok", "Indicação", "Outro")

# Linha de produtos da empresa (lista fechada no formulario)
PRODUTOS = ("T25P", "T70P", "T55", "T100", "Peças e Serviços")

# Etapas que exigem telefone + e-mail preenchidos (nota fiscal / fechamento)
STAGES_EXIGEM_CONTATO = ("proposta", "ganho")

# Municipios oficiais (IBGE), carregados de public/cidades.json no boot.
# _CIDADES_CANON mapeia minusculo -> forma canonica "Nome - UF".
_CIDADES_CANON = {}


def load_cidades():
    try:
        with open(os.path.join(PUBLIC_DIR, "cidades.json"), "r", encoding="utf-8") as f:
            for nome in json.load(f):
                _CIDADES_CANON[nome.lower()] = nome
        print("  %d cidades carregadas (IBGE)" % len(_CIDADES_CANON))
    except Exception as e:
        print("AVISO: nao carregou cidades.json (%s) — regiao fica sem validacao" % e)


def canon_cidade(valor):
    """Retorna a forma canonica 'Nome - UF' ou None se nao reconhecida."""
    if not valor or not _CIDADES_CANON:
        return None
    return _CIDADES_CANON.get(str(valor).strip().lower())

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
# campaigns: campanhas cadastradas (atribuicao) | settings: config (nro WhatsApp)
_db = {"leads": [], "members": [], "rr_sdr": 0, "campaigns": [], "settings": {}}


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
            if not isinstance(data.get("campaigns"), list):
                data["campaigns"] = []
            if not isinstance(data.get("settings"), dict):
                data["settings"] = {}
            _db = data
    except Exception as e:
        # Arquivo ilegivel (queda de energia, edicao manual): NUNCA sobrescrever.
        # Renomeia para .corrompido-<ts> e recomeca vazio; o original fica salvo.
        backup = "%s.corrompido-%d" % (DB_FILE, int(time.time()))
        try:
            os.replace(DB_FILE, backup)
            print("AVISO: banco ilegivel (%s). Copia guardada em: %s" % (e, backup))
        except OSError:
            print("AVISO: banco ilegivel e nao foi possivel criar backup:", e)
        _db = {"leads": [], "members": [], "rr_sdr": 0, "campaigns": [], "settings": {}}


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
        "campanha": "",     # nome da campanha (texto exibido)
        "campanha_id": "",  # vinculo com uma campanha cadastrada
        "meta_ad_id": "",   # id do anuncio (Meta clique-pro-WhatsApp)
        "ctwa_clid": "",    # id de clique do anuncio (Meta)
        "utm_source": "",
        "utm_medium": "",
        "utm_campaign": "",
        "utm_content": "",
        "utm_term": "",
        "status": "novo",
        "observacoes": "",
        "lat": None,   # localizacao exata da fazenda (ajustada no mapa);
        "lng": None,   # None = usar o centro da cidade (regiao) como aproximacao
        "last_message": "",
        "created_at": now_iso(),
        "updated_at": now_iso(),
    }
    if partial:
        lead.update(partial)
    return lead


PRODUTOR_STAGES = ("produtor", "negociacao", "proposta", "ganho")


def apply_updates(lead, updates):
    """Aplica edicoes manuais. Levanta ValueError com mensagem amigavel quando
    uma regra de negocio e violada (as rotas devolvem 400 com essa mensagem)."""
    for key, value in updates.items():
        if key not in EDITABLE:
            continue
        if key == "status" and value not in STAGES:
            continue
        if key == "tipo" and value not in ("", "produtor", "prestador"):
            continue
        if key in ("telefone", "email") and not str(value or "").strip() and str(lead.get(key) or "").strip():
            campo = "Telefone" if key == "telefone" else "E-mail"
            raise ValueError("%s é obrigatório e não pode ficar vazio" % campo)
        if key == "produto" and value and value not in PRODUTOS:
            raise ValueError("Produto inválido — escolha um da lista")
        if key == "regiao" and value and _CIDADES_CANON:
            canon = canon_cidade(value)
            if not canon:
                raise ValueError("Cidade não reconhecida — escolha uma da lista (ex.: Rio Verde - GO)")
            value = canon  # padroniza a grafia
        if key == "valor":
            try:
                v = float(value) if value not in ("", None) else 0.0
            except (TypeError, ValueError):
                v = 0.0
            # NaN/Infinity passam no float() mas quebrariam o JSON do banco
            lead["valor"] = v if math.isfinite(v) else 0.0
            continue
        if key in ("lat", "lng"):
            if value in ("", None):
                lead[key] = None  # volta a usar o centro da cidade
                continue
            try:
                v = float(value)
            except (TypeError, ValueError):
                raise ValueError("Coordenada inválida")
            limite = 90 if key == "lat" else 180
            if not math.isfinite(v) or abs(v) > limite:
                raise ValueError("Coordenada inválida")
            lead[key] = round(v, 6)
            continue
        lead[key] = value

    # Consistencia automatica entre a coluna e a classificacao do lead:
    if "status" in updates:
        if lead["status"] == "prestador":
            lead["tipo"] = "prestador"
        elif lead["status"] in PRODUTOR_STAGES:
            lead["tipo"] = "produtor"

    # Nota fiscal exige contato completo: barra a MUDANCA para essas etapas
    if updates.get("status") in STAGES_EXIGEM_CONTATO and (
            not str(lead.get("telefone") or "").strip() or not str(lead.get("email") or "").strip()):
        raise ValueError('Para mover para "Proposta"/"Ganho", preencha telefone e e-mail do lead (nota fiscal)')

    # Ao definir um vendedor, a posse do lead passa para ele (a menos que o
    # responsavel tenha sido informado explicitamente na mesma atualizacao).
    if updates.get("vendedor") and "responsavel" not in updates:
        lead["responsavel"] = updates["vendedor"]

    # Vinculo manual com campanha cadastrada: valida e espelha o nome no lead.
    if "campanha_id" in updates:
        camp = next((c for c in _db.get("campaigns", []) if c["id"] == updates["campanha_id"]), None)
        if camp:
            lead["campanha_id"] = camp["id"]
            lead["campanha"] = camp["nome"]
            if not lead.get("origem_canal"):
                lead["origem_canal"] = camp.get("canal", "")
        else:
            lead["campanha_id"] = ""

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


SOURCE_CANAL = {
    "facebook": "Meta", "instagram": "Meta", "fb": "Meta", "ig": "Meta",
    "meta": "Meta", "google": "Google", "adwords": "Google", "youtube": "Google",
    "whatsapp": "WhatsApp", "wa": "WhatsApp", "tiktok": "TikTok",
}


def guess_canal(utms, referer):
    """Deduz o canal comparando tokens exatos (nunca substring solta — 'ig'
    dentro de 'campaign' ou 'digital' nao pode virar Meta)."""
    src = (utms.get("utm_source") or "").strip().lower()
    if src in SOURCE_CANAL:
        return SOURCE_CANAL[src]

    host, query = "", ""
    try:
        parsed = urlparse(referer or "")
        host = (parsed.netloc or "").lower()
        query = (parsed.query or "").lower()
    except Exception:
        pass
    if host:
        if re.search(r"(^|\.)(facebook\.com|instagram\.com|fb\.me|fb\.com|meta\.com)$", host):
            return "Meta"
        if re.search(r"(^|\.)(google\.[a-z.]+|youtube\.com)$", host):
            return "Google"
        if re.search(r"(^|\.)(wa\.me|whatsapp\.com)$", host):
            return "WhatsApp"
        if re.search(r"(^|\.)tiktok\.com$", host):
            return "TikTok"
    # ids de clique presentes na URL denunciam a origem
    if "fbclid=" in query:
        return "Meta"
    if "gclid=" in query:
        return "Google"
    return utms.get("utm_source", "")


def find_referral(payload):
    """
    Procura os dados de anuncio "clique-pro-WhatsApp" (Meta) no evento.

    Quando alguem clica num anuncio do Facebook/Instagram que abre o WhatsApp,
    a primeira mensagem chega com um bloco "referral" (id do anuncio, titulo,
    ctwa_clid...). O lugar exato varia conforme a versao do Chatwoot, entao
    fazemos uma busca em largura (limitada) por um dicionario com essa cara.
    """
    def looks_like_referral(d):
        if not isinstance(d, dict):
            return False
        if d.get("ctwa_clid"):
            return True
        if d.get("source_id") and d.get("source_type"):
            return True
        if d.get("source_url") and (d.get("headline") or d.get("body")):
            return True
        return False

    queue = [payload]
    seen = 0
    while queue and seen < 200:
        node = queue.pop(0)
        seen += 1
        if looks_like_referral(node):
            return {
                "source_id": str(node.get("source_id") or ""),
                "source_type": str(node.get("source_type") or ""),
                "headline": str(node.get("headline") or ""),
                "body": str(node.get("body") or ""),
                "source_url": str(node.get("source_url") or ""),
                "ctwa_clid": str(node.get("ctwa_clid") or ""),
            }
        if isinstance(node, dict):
            queue.extend(node.values())
        elif isinstance(node, list):
            queue.extend(node)
    return None


def match_campaign(utms, message_text):
    """
    Tenta vincular o lead a uma campanha cadastrada. Prioridade:
      1. utm_campaign igual ao codigo, ao utm_campaign ou ao nome da campanha
      2. "#CODIGO" presente no texto da mensagem (link de WhatsApp do anuncio)
      3. palavra-chave da campanha presente na mensagem
    """
    campaigns = [c for c in _db.get("campaigns", []) if c.get("ativo", True)]
    if not campaigns:
        return None

    utm_c = (utms.get("utm_campaign") or "").strip().lower()
    if utm_c:
        for c in campaigns:
            candidates = {c.get("codigo", ""), c.get("utm_campaign", ""), c.get("nome", "")}
            if utm_c in {x.strip().lower() for x in candidates if x}:
                return c

    text = (message_text or "").lower()
    if text:
        for c in campaigns:
            code = (c.get("codigo") or "").strip().lower()
            # fronteira apos o codigo: evita "#SOJA" casar com "#SOJA25"
            if code and re.search("#" + re.escape(code) + r"(?![a-z0-9])", text):
                return c
        # keywords mais longas primeiro ("soja premium" vence "soja"), e com
        # fronteira de palavra ("uva" nao pode casar "chuva", "milho"/"milhoes")
        by_len = sorted(campaigns, key=lambda c: len(c.get("keyword") or ""), reverse=True)
        for c in by_len:
            kw = (c.get("keyword") or "").strip().lower()
            if kw and re.search(r"\b" + re.escape(kw) + r"\b", text):
                return c
    return None


def gen_codigo(nome):
    """Gera um codigo curto e unico a partir do nome (ex.: 'Soja Safra 2025' -> SOJA25)."""
    letters = re.sub(r"[^A-Za-z]", "", nome or "").upper()[:4] or "CAMP"
    digits = re.sub(r"[^0-9]", "", nome or "")[-2:]
    base = letters + digits
    existing = {(c.get("codigo") or "").upper() for c in _db.get("campaigns", [])}
    codigo, n = base, 1
    while codigo.upper() in existing:
        n += 1
        codigo = "%s%d" % (base, n)
    return codigo


# Eventos do Chatwoot que realmente representam conversa/mensagem de lead.
# contact_updated & cia. tem "id" de CONTATO no topo — tratar como conversa
# criaria leads fantasma com id trocado (colisao garantida entre sequencias).
CONVERSATION_EVENTS = ("conversation_created", "conversation_updated", "conversation_status_changed")
MESSAGE_EVENTS = ("message_created", "message_updated")


def _is_incoming(msg):
    """So mensagem do LEAD conta (nao a resposta do atendente nem nota privada)."""
    if not isinstance(msg, dict):
        return False
    if msg.get("private"):
        return False
    mt = msg.get("message_type")
    return mt in ("incoming", 0, None)  # None: payload minimo/sintetico


def handle_chatwoot_event(payload):
    event = payload.get("event") if isinstance(payload, dict) else None
    if not event:
        return {"ok": False, "reason": "sem evento"}

    # Filtra os tipos de evento suportados; os demais sao confirmados e ignorados
    if event in CONVERSATION_EVENTS:
        conversation = payload
        conversation_id = payload.get("id")
    elif event in MESSAGE_EVENTS:
        # mensagem do atendente/nota privada: nao mexe no lead
        if not _is_incoming(payload):
            return {"ok": True, "ignored": "mensagem nao-recebida (outgoing/privada)"}
        conversation = payload.get("conversation") or {}
        conversation_id = conversation.get("id") or payload.get("conversation_id")
    else:
        return {"ok": True, "ignored": event}

    meta = conversation.get("meta") or payload.get("meta") or {}
    sender = (
        meta.get("sender")
        or payload.get("sender")
        or (payload.get("contact_inbox") or {}).get("contact")
        or {}
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
        incoming_msgs = [m for m in msgs if _is_incoming(m)]
        if incoming_msgs:
            last_message = incoming_msgs[-1].get("content") or ""
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
    # padroniza grafia sem rejeitar (lead do webhook nunca pode ser perdido)
    regiao = canon_cidade(regiao) or regiao
    for p in PRODUTOS:
        if produto and str(produto).strip().lower() == p.lower():
            produto = p
            break

    # ---- Atribuicao de campanha ----
    # Rota 1: anuncio Meta clique-pro-WhatsApp (bloco "referral" no evento)
    referral = find_referral(payload)
    meta_ad_id = ""
    ctwa_clid = ""
    campanha_nome = utms.get("utm_campaign", "")
    if referral:
        canal = canal or "Meta"
        meta_ad_id = referral["source_id"]
        ctwa_clid = referral["ctwa_clid"]
        if not campanha_nome:
            campanha_nome = referral["headline"] or ("Anúncio " + meta_ad_id if meta_ad_id else "")

    # Rotas 2 e 3: campanha cadastrada casando com UTM ou com o texto da
    # mensagem (o titulo/texto do anuncio tambem entram na busca por
    # palavra-chave, para vincular leads de anuncio CTWA automaticamente)
    match_text = last_message
    if referral:
        match_text = " ".join(x for x in (last_message, referral["headline"], referral["body"]) if x)
    campanha_id = ""
    camp = match_campaign(utms, match_text)
    if camp:
        campanha_id = camp["id"]
        campanha_nome = camp["nome"]
        canal = canal or camp.get("canal", "")

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
        "campanha": campanha_nome,
        "campanha_id": campanha_id,
        "meta_ad_id": meta_ad_id,
        "ctwa_clid": ctwa_clid,
        "last_message": last_message,
    }
    incoming.update(utms)

    with _lock:
        # A campanha casada pode ter sido excluida entre o match (fora do lock)
        # e agora; revalida para nao gravar vinculo orfao.
        if incoming.get("campanha_id") and not any(
                c["id"] == incoming["campanha_id"] for c in _db.get("campaigns", [])):
            incoming["campanha_id"] = ""

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

        # Se a campanha cadastrada foi identificada agora (ex.: o codigo veio na
        # mensagem seguinte), vincula e espelha o nome mesmo que o campo texto
        # ja tivesse algo generico (titulo do anuncio, utm solto).
        if incoming.get("campanha_id") and not lead.get("campanha_id"):
            lead["campanha_id"] = incoming["campanha_id"]
            lead["campanha"] = incoming["campanha"]

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
        data = json.loads(raw.decode("utf-8"))
        # As rotas assumem objeto; lista/string/numero viraria AttributeError
        if not isinstance(data, dict):
            raise ValueError("esperado um objeto JSON")
        return data

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
        # Qualquer erro nao previsto vira 500 com resposta valida, em vez de
        # derrubar a conexao sem status.
        try:
            return self._handle_api(method, parsed)
        except Exception as e:
            print("Erro na API %s %s: %r" % (method, parsed.path, e))
            if not self.wfile.closed:
                try:
                    return self.send_json(500, {"error": "Erro interno"})
                except Exception:
                    pass

    def _handle_api(self, method, parsed):
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

        # Campanhas
        if path == "/api/campaigns" and method == "GET":
            with _lock:
                return self.send_json(200, {
                    "campaigns": list(_db.get("campaigns", [])),
                    "settings": dict(_db.get("settings", {})),
                })

        if path == "/api/campaigns" and method == "POST":
            try:
                body = self.read_body()
            except Exception:
                return self.send_json(400, {"error": "Corpo invalido"})
            nome = (body.get("nome") or "").strip()
            if not nome:
                return self.send_json(400, {"error": "Informe o nome da campanha"})
            canal = body.get("canal") if body.get("canal") in CANAIS else "Meta"
            with _lock:
                codigo = (body.get("codigo") or "").strip().upper()
                codigo = re.sub(r"[^A-Z0-9]", "", codigo)
                if codigo:
                    existing = {(c.get("codigo") or "").upper() for c in _db.get("campaigns", [])}
                    if codigo in existing:
                        return self.send_json(400, {"error": "Ja existe campanha com esse codigo"})
                else:
                    codigo = gen_codigo(nome)
                camp = {
                    "id": new_id(),
                    "nome": nome,
                    "canal": canal,
                    "codigo": codigo,
                    "keyword": (body.get("keyword") or "").strip(),
                    "utm_campaign": (body.get("utm_campaign") or "").strip(),
                    "ativo": True,
                    "created_at": now_iso(),
                }
                _db.setdefault("campaigns", []).append(camp)
                save_db()
                return self.send_json(201, {"campaign": camp})

        mc = re.match(r"^/api/campaigns/([^/]+)$", path)
        if mc:
            camp_id = mc.group(1)
            body = None
            if method in ("PATCH", "PUT"):
                # le o corpo ANTES do lock: rfile.read e I/O de rede bloqueante
                try:
                    body = self.read_body()
                except Exception:
                    return self.send_json(400, {"error": "Corpo invalido"})
            with _lock:
                camp = next((c for c in _db.get("campaigns", []) if c["id"] == camp_id), None)
                if not camp:
                    return self.send_json(404, {"error": "Campanha nao encontrada"})
                if method in ("PATCH", "PUT"):
                    if "nome" in body and str(body["nome"]).strip():
                        camp["nome"] = str(body["nome"]).strip()
                    if body.get("canal") in CANAIS:
                        camp["canal"] = body["canal"]
                    if "keyword" in body:
                        camp["keyword"] = str(body["keyword"]).strip()
                    if "utm_campaign" in body:
                        camp["utm_campaign"] = str(body["utm_campaign"]).strip()
                    if "ativo" in body:
                        camp["ativo"] = bool(body["ativo"])
                    save_db()
                    return self.send_json(200, {"campaign": camp})
                if method == "DELETE":
                    _db["campaigns"] = [c for c in _db.get("campaigns", []) if c["id"] != camp_id]
                    # leads mantem o nome da campanha em texto; so desfaz o vinculo
                    for l in _db["leads"]:
                        if l.get("campanha_id") == camp_id:
                            l["campanha_id"] = ""
                    save_db()
                    return self.send_json(200, {"ok": True})

        # Configuracoes (numero do WhatsApp para gerar links de anuncio)
        if path == "/api/settings" and method in ("PATCH", "PUT", "POST"):
            try:
                body = self.read_body()
            except Exception:
                return self.send_json(400, {"error": "Corpo invalido"})
            with _lock:
                st = _db.setdefault("settings", {})
                if "whatsapp_number" in body:
                    st["whatsapp_number"] = re.sub(r"[^0-9]", "", str(body["whatsapp_number"]))
                save_db()
                return self.send_json(200, {"settings": dict(st)})

        # Relatorio por campanha (quantos leads/produtores/ganhos e R$ cada uma gerou)
        if path == "/api/report/campanhas" and method == "GET":
            with _lock:
                camps = list(_db.get("campaigns", []))
                rows = {c["id"]: {
                    "id": c["id"], "nome": c["nome"], "canal": c.get("canal", ""),
                    "codigo": c.get("codigo", ""), "ativo": c.get("ativo", True),
                    "leads": 0, "produtores": 0, "ganhos": 0,
                    "valor_ganho": 0.0, "valor_aberto": 0.0,
                } for c in camps}
                sem = {"id": "", "nome": "Sem campanha identificada", "canal": "",
                       "codigo": "", "ativo": True, "leads": 0, "produtores": 0,
                       "ganhos": 0, "valor_ganho": 0.0, "valor_aberto": 0.0}
                for l in _db["leads"]:
                    row = rows.get(l.get("campanha_id") or "", sem)
                    row["leads"] += 1
                    if l.get("tipo") == "produtor":
                        row["produtores"] += 1
                    valor = float(l.get("valor") or 0)
                    if l.get("status") == "ganho":
                        row["ganhos"] += 1
                        row["valor_ganho"] += valor
                    elif l.get("status") not in ("perdido", "prestador"):
                        row["valor_aberto"] += valor
                out = sorted(rows.values(), key=lambda r: r["leads"], reverse=True)
                if sem["leads"]:
                    out.append(sem)
                return self.send_json(200, {"report": out})

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
            body = None
            if method in ("PATCH", "PUT"):
                try:
                    body = self.read_body()
                except Exception:
                    return self.send_json(400, {"error": "Corpo invalido"})
            with _lock:
                member = next((x for x in _db.get("members", []) if x["id"] == member_id), None)
                if not member:
                    return self.send_json(404, {"error": "Membro nao encontrado"})
                if method in ("PATCH", "PUT"):
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
                try:
                    apply_updates(lead, body)
                except ValueError as e:
                    return self.send_json(400, {"error": str(e)})
                if not str(lead.get("telefone") or "").strip() or not str(lead.get("email") or "").strip():
                    return self.send_json(400, {"error": "Telefone e e-mail são obrigatórios"})
                _db["leads"].append(lead)
                save_db()
                return self.send_json(201, {"lead": lead})

        # Editar / excluir por id
        m = re.match(r"^/api/leads/([^/]+)$", path)
        if m:
            lead_id = m.group(1)
            body = None
            if method in ("PATCH", "PUT"):
                try:
                    body = self.read_body()
                except Exception:
                    return self.send_json(400, {"error": "Corpo invalido"})
            with _lock:
                lead = next((l for l in _db["leads"] if l["id"] == lead_id), None)
                if not lead:
                    return self.send_json(404, {"error": "Lead nao encontrado"})
                if method in ("PATCH", "PUT"):
                    # aplica numa copia: se uma regra barrar no meio, o lead
                    # original nao fica meio-editado na memoria
                    tentativa = dict(lead)
                    try:
                        apply_updates(tentativa, body)
                    except ValueError as e:
                        return self.send_json(400, {"error": str(e)})
                    lead.update(tentativa)
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
        # sem cache: apos atualizar o CRM, um recarregar simples ja traz a
        # versao nova (evita interface velha presa no navegador da equipe)
        self.send_header("Cache-Control", "no-cache")
        self.end_headers()
        self.wfile.write(data)


def main():
    load_db()
    load_cidades()
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
