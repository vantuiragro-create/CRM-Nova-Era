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

import csv
import heapq
import io
import json
import math
import os
import re
import base64
import hashlib
import secrets
import threading
import time
import unicodedata
from datetime import datetime, timezone, timedelta
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs

# ---------------------------------------------------------------------------
# Configuracao
# ---------------------------------------------------------------------------
PORT = int(os.environ.get("PORT", "3000"))

# Token do webhook (protege o endpoint). Prioridade: variavel de ambiente
# WEBHOOK_TOKEN; senao, um token aleatorio persistido no banco (settings) na
# primeira execucao. NUNCA derivado do nome de usuario (seria adivinhavel).
WEBHOOK_TOKEN = os.environ.get("WEBHOOK_TOKEN") or None  # resolvido no boot

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
# DATA_DIR pode ser sobrescrito por variavel de ambiente (ex.: um volume /data
# na nuvem), para os leads nao sumirem quando o servidor reinicia.
DATA_DIR = os.environ.get("DATA_DIR") or os.path.join(BASE_DIR, "data")
DB_FILE = os.path.join(DATA_DIR, "leads.json")
FOTOS_DIR = os.path.join(DATA_DIR, "fotos")  # fotos das visitas de campo
PUBLIC_DIR = os.path.join(BASE_DIR, "public")

# Tipos de resultado de visita aceitos
RESULTADOS_VISITA = (
    "Interessado — avançar", "Em negociação", "Vai pensar", "Reagendar",
    "Sem interesse", "Fechou negócio", "Não encontrou o cliente", "Outro",
)

# Etapas do funil (ordem = ordem das colunas)
#   novo/triagem          -> fase do SDR (primeiro contato e qualificacao)
#   qualificado..ganho    -> funil de vendas (o "tipo" diz se e produtor ou
#                            prestador; cada tipo tem sua aba)
#   perdido               -> venda/lead que nao avancou (guardado p/ resgate)
STAGES = ["novo", "triagem", "qualificado", "decidindo", "negociacao", "proposta",
          "financiamento", "ganho", "desistiu", "perdido", "curioso"]

# Etapas do funil de vendas (ja qualificado). "decidindo" = cliente avaliando se
# vai adquirir o drone (antes de negociar); "financiamento" = proposta aceita,
# cliente aguardando a liberacao do recurso no banco.
SALES_STAGES = ("qualificado", "decidindo", "negociacao", "proposta",
                "financiamento", "ganho")

# Painel de SERVIÇOS (pós-venda): depois de vender o drone (ganho), o cliente
# entra num funil separado de venda de serviços/pecas/manutencao.
SERVICO_STAGES = ("recebido_serv", "ofertado", "negociando_serv",
                  "proposta_serv", "vendido_serv", "recusado_serv")

# Papeis da equipe (raias dos funis)
PAPEIS = ("sdr", "vendedor")

# Papeis de usuario (login):
#   admin    -> tudo + gerencia usuarios e niveis de acesso
#   gerente  -> tudo, exceto gerenciar usuarios
#   vendedor -> so leads do funil de Vendas que sao dele ou sem responsavel
#   sdr      -> so os leads dele (campo sdr)
PAPEIS_USUARIO = ("admin", "gerente", "vendedor", "sdr")

SESSAO_DIAS = 30

EDITABLE = {
    "nome", "telefone", "email", "regiao", "area_cultivada", "produto", "itens", "valor",
    "cargo", "decisor", "decisor_cargo", "formas_pagamento",
    "vendedor", "sdr", "responsavel", "tipo", "origem_canal", "campanha",
    "campanha_id", "utm_source", "utm_medium", "utm_campaign", "utm_content",
    "utm_term", "status", "observacoes", "lat", "lng", "recuperacao",
    "em_servicos", "status_servico", "valor_servico",
}

# Canais aceitos para campanhas cadastradas
CANAIS = ("Meta", "Google", "WhatsApp", "TikTok", "Indicação", "Outro")

# Linha de produtos da empresa (lista fechada no formulario)
PRODUTOS = ("T25P", "T70P", "T55", "T100", "Peças e Serviços")

# Formas de pagamento aceitas (um lead pode combinar varias = pagamento misto)
PAGAMENTOS = (
    "À vista", "Financiamento", "Cartão BNDES", "Cartão de crédito",
    "Permuta / Troca", "Consórcio", "CPR", "Boleto / Parcelado", "Outro",
)
# Formas que aceitam entrada + parcelamento (as demais zeram esses campos)
PARCELAVEIS = frozenset({
    "Financiamento", "Cartão BNDES", "Cartão de crédito",
    "Consórcio", "CPR", "Boleto / Parcelado",
})

# Etapas que exigem telefone + e-mail preenchidos (nota fiscal / fechamento)
STAGES_EXIGEM_CONTATO = ("proposta", "financiamento", "ganho")

# Municipios oficiais (IBGE), carregados de public/cidades.json no boot.
# _CIDADES_CANON mapeia minusculo -> forma canonica "Nome - UF".
_CIDADES_CANON = {}
# Mesorregioes do IBGE (Goias): "Nome - GO" -> mesorregiao. De public/mesorregioes.json.
_MESO = {}
MESORREGIOES = ["Noroeste Goiano", "Norte Goiano", "Centro Goiano",
                "Leste Goiano", "Sul Goiano"]


def load_cidades():
    try:
        with open(os.path.join(PUBLIC_DIR, "cidades.json"), "r", encoding="utf-8") as f:
            for nome in json.load(f):
                _CIDADES_CANON[nome.lower()] = nome
        print("  %d cidades carregadas (IBGE)" % len(_CIDADES_CANON))
    except Exception as e:
        print("AVISO: nao carregou cidades.json (%s) — regiao fica sem validacao" % e)
    try:
        with open(os.path.join(PUBLIC_DIR, "mesorregioes.json"), "r", encoding="utf-8") as f:
            _MESO.update(json.load(f))
        print("  %d municipios com mesorregiao (GO)" % len(_MESO))
    except Exception as e:
        print("AVISO: nao carregou mesorregioes.json (%s)" % e)


def meso_da_regiao(regiao):
    """Mesorregiao (GO) da cidade do lead, ou None."""
    return _MESO.get(str(regiao or "").strip())


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
    ".webmanifest": "application/manifest+json; charset=utf-8",
    ".svg": "image/svg+xml",
    ".ico": "image/x-icon",
    ".png": "image/png",
    ".webp": "image/webp",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
}

# ---------------------------------------------------------------------------
# Camada de dados (JSON em arquivo + lock para acesso concorrente)
# ---------------------------------------------------------------------------
_lock = threading.Lock()
# presenca "online": user_id -> ultima vez visto (ISO). So em memoria (efemero,
# nao vai pro disco); atualizado a cada requisicao autenticada.
_online = {}
ONLINE_LIMIAR_S = 100  # visto nos ultimos N segundos = online
# users: pessoas com login (a equipe: admin/gerente/vendedor/sdr)
# rr_sdr: indice do rodizio de SDRs | campaigns: campanhas | settings: config
# sessions: sessoes de login ativas (token -> user_id/validade)
_db = {"leads": [], "users": [], "rr_sdr": 0, "campaigns": [], "settings": {}, "sessions": {}}


def now_iso():
    return datetime.now(timezone.utc).isoformat()


BRT = timezone(timedelta(hours=-3))  # horario de Brasilia (sem horario de verao)


def dia_brt(iso):
    """Converte um timestamp ISO (UTC) para a data 'AAAA-MM-DD' em Brasilia."""
    if not iso:
        return None
    try:
        dt = datetime.fromisoformat(str(iso))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.astimezone(BRT).strftime("%Y-%m-%d")
    except (ValueError, TypeError):
        return None


def _parse_iso(iso):
    """ISO -> datetime aware (UTC). None se invalido."""
    if not iso:
        return None
    try:
        dt = datetime.fromisoformat(str(iso))
    except (ValueError, TypeError):
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt


def ts_offline(valor):
    """Horario de um registro feito OFFLINE (visita/nota): usa o instante do
    evento enviado pelo cliente, se for valido e plausivel (nao no futuro, nao
    mais de 30 dias atras). Caso contrario, usa agora. Assim uma visita feita as
    08h e sincronizada as 18h fica com 08h, sem confiar cegamente no relogio."""
    t = _parse_iso(valor)
    if not t:
        return now_iso()
    agora = datetime.now(timezone.utc)
    if t > agora + timedelta(minutes=1) or t < agora - timedelta(days=30):
        return now_iso()
    return t.isoformat()


HEAT_DIAS = 7        # janela do "termometro" (mesma regra do front)
HEAT_QUENTE = 3      # nº de atualizacoes recentes p/ virar "quente"


def heat_nivel(lead):
    """Termometro do lead: "" | "recente" (👍) | "quente" (🔥) — conta as
    entradas de historico dos ultimos HEAT_DIAS dias (igual ao front). A entrada
    automatica de criacao (tipo "novo") NAO conta: criar nao e engajamento."""
    hist = lead.get("historico") or []
    if not hist:
        return ""
    limite = datetime.now(timezone.utc) - timedelta(days=HEAT_DIAS)
    n = 0
    for h in hist:
        if h.get("tipo") == "novo":
            continue
        t = _parse_iso(h.get("data"))
        if t and t >= limite:
            n += 1
    if n >= HEAT_QUENTE:
        return "quente"
    if n >= 1:
        return "recente"
    return ""


def precisa_retorno(lead, cadencia_dias):
    """True quando o lead ativo passou do prazo sem contato e merece o alerta de
    retorno. Leads quentes sao cobrados na metade do prazo. Um lead que ja espera
    o registro da resposta (aguardando_resposta) NAO gera alerta de retorno."""
    if lead.get("status") in ("ganho", "perdido", "desistiu", "curioso"):
        return False
    if lead.get("aguardando_resposta"):
        return False
    t = _parse_iso(lead.get("updated_at") or lead.get("created_at"))
    if not t:
        return False
    idade_dias = (datetime.now(timezone.utc) - t).total_seconds() / 86400
    metade = max(1, (cadencia_dias + 1) // 2)
    # checa a idade (barato) antes do termometro (varre o historico): a maioria
    # dos leads cai fora da "banda do meio" e nem calcula o heat.
    if idade_dias < metade:
        return False                       # nem um lead quente dispara antes da metade
    if idade_dias >= cadencia_dias:
        return True                        # ate frio dispara; termometro nao muda nada
    return heat_nivel(lead) == "quente"    # banda do meio: so o quente (🔥) dispara


def cadencia_dias_cfg():
    """Prazo (dias) do alerta de retorno, configuravel; padrao 2, limites 1..30."""
    try:
        v = int(_db.get("settings", {}).get("cadencia_dias") or 2)
    except (TypeError, ValueError):
        v = 2
    return max(1, min(30, v))


def resposta_horas_cfg():
    """Prazo (horas) p/ a resposta virar urgente; padrao 3, limites 1..168."""
    try:
        v = int(_db.get("settings", {}).get("resposta_horas") or 3)
    except (TypeError, ValueError):
        v = 3
    return max(1, min(168, v))


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
            if not isinstance(data.get("users"), list):
                data["users"] = []
            if not isinstance(data.get("rr_sdr"), int):
                data["rr_sdr"] = 0
            if not isinstance(data.get("campaigns"), list):
                data["campaigns"] = []
            if not isinstance(data.get("settings"), dict):
                data["settings"] = {}
            if not isinstance(data.get("sessions"), dict):
                data["sessions"] = {}
            # Migracao: a antiga "equipe" (members, sem login) vira usuarios com
            # senha pendente — o admin define a senha de cada um.
            if data.get("members") and not data["users"]:
                logins_usados = set()
                for m in data.pop("members"):
                    login = _slug_login(m.get("nome", ""))
                    while login in logins_usados:  # desambigua nomes parecidos
                        login = _slug_login(m.get("nome", "")) + secrets.token_hex(2)
                    logins_usados.add(login)
                    data["users"].append({
                        "id": m.get("id") or new_id(), "nome": m.get("nome", ""),
                        "login": login, "salt": "", "senha_hash": "",
                        "papel": m.get("papel", "sdr"), "ativo": m.get("ativo", True),
                    })
                print("  equipe antiga migrada para usuarios (defina as senhas no painel)")
            data.pop("members", None)
            # Migracao das etapas antigas:
            #   status "produtor" (recebido no funil) -> "qualificado"
            #   status "prestador" (fora do perfil)   -> qualificado + tipo prestador
            for l in data["leads"]:
                if l.get("status") == "produtor":
                    l["status"] = "qualificado"
                    l.setdefault("tipo", "") or l.__setitem__("tipo", l.get("tipo") or "produtor")
                elif l.get("status") == "prestador":
                    l["status"] = "qualificado"
                    l["tipo"] = "prestador"
                l.setdefault("qualificado_em", None)
                if l.get("tipo") and not l.get("qualificado_em"):
                    l["qualificado_em"] = l.get("updated_at") or l.get("created_at")
                # leads antigos que ja tem vendedor contam como atendidos
                l.setdefault("atendido_em", None)
                if l.get("vendedor") and not l.get("atendido_em"):
                    l["atendido_em"] = l.get("updated_at") or l.get("created_at")
                # congela a data de ganho/perda dos leads antigos na data atual
                # (updated_at) para que edicoes/notas futuras nao movam a vitoria
                # ou perda de dia no relatorio.
                l.setdefault("ganho_em", None)
                if l.get("status") == "ganho" and not l.get("ganho_em"):
                    l["ganho_em"] = l.get("updated_at") or l.get("created_at")
                l.setdefault("perdido_em", None)
                if l.get("status") == "perdido" and not l.get("perdido_em"):
                    l["perdido_em"] = l.get("updated_at") or l.get("created_at")
                l.setdefault("desistiu_em", None)
                if l.get("status") == "desistiu" and not l.get("desistiu_em"):
                    l["desistiu_em"] = l.get("updated_at") or l.get("created_at")
                if not isinstance(l.get("formas_pagamento"), list):
                    l["formas_pagamento"] = []
                if not isinstance(l.get("itens"), list):
                    # lead antigo tinha um produto unico -> vira 1 item do pedido
                    l["itens"] = itens_de_produto(l.get("produto"))
                # leads que ja existiam ANTES desta versao sao o lote de
                # recuperacao (clientes do passado); os novos nascem como atuais.
                l.setdefault("recuperacao", True)
                l.setdefault("em_servicos", False)
                l.setdefault("status_servico", "")
                l.setdefault("valor_servico", 0)
                if not isinstance(l.get("visitas"), list):
                    l["visitas"] = []
                if not isinstance(l.get("historico"), list):
                    l["historico"] = []
                l.setdefault("aguardando_resposta", None)
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
        _db = {"leads": [], "users": [], "rr_sdr": 0, "campaigns": [],
               "settings": {}, "sessions": {}}


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
        "produto": "",       # espelho (nomes juntos) dos itens — busca/legado
        "itens": [],         # drones do pedido: lista de {produto, qtd}
        "valor": 0,
        "cargo": "",          # cargo de QUEM entrou em contato
        "decisor": "",        # quem decide/paga (vazio = o proprio contato)
        "decisor_cargo": "",  # cargo do decisor, quando for outra pessoa
        "formas_pagamento": [],  # lista de {tipo, valor} (misto = varias)
        "visitas": [],           # visitas de campo: {id, data, visitante, resultado, obs, foto}
        "historico": [],         # linha do tempo de atualizacoes: {data, autor, itens}
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
        "recuperacao": False,  # True = cliente antigo em recuperacao (fica na aba
                               # "Recuperacao", fora do funil dos leads NOVOS)
        "em_servicos": False,  # True = tambem esta no painel de Servicos (pos-venda)
        "status_servico": "",  # etapa no funil de Servicos (SERVICO_STAGES)
        "valor_servico": 0,    # valor do negocio de servicos (separado do drone)
        "observacoes": "",
        "lat": None,   # localizacao exata da fazenda (ajustada no mapa);
        "lng": None,   # None = usar o centro da cidade (regiao) como aproximacao
        "last_message": "",
        "qualificado_em": None,  # quando o SDR classificou (entra no funil de vendas)
        "atendido_em": None,     # quando um vendedor assumiu (mede a agilidade)
        "ganho_em": None,        # data em que o negocio foi GANHO (fixa; p/ relatorio)
        "perdido_em": None,      # data em que o negocio foi PERDIDO (fixa; p/ relatorio)
        "desistiu_em": None,     # data em que o cliente DESISTIU da compra (fixa)
        "aguardando_resposta": None,  # ISO do contato por WhatsApp que ainda espera
                                      # o vendedor REGISTRAR o que o cliente respondeu
        "created_at": now_iso(),  # data/hora de ENTRADA do lead
        "updated_at": now_iso(),
    }
    if partial:
        lead.update(partial)
    return lead


def _num_pos(x, teto=None):
    """Converte para float >= 0 e finito; retorna 0.0 se invalido."""
    try:
        v = float(x) if x not in ("", None) else 0.0
    except (TypeError, ValueError):
        return 0.0
    if not math.isfinite(v) or v < 0:
        return 0.0
    if teto is not None and v > teto:
        v = teto
    return v


def salva_foto_visita(data_url, visita_id):
    """Recebe um data URL (base64) de imagem, valida e grava em fotos/<id>.jpg.
    Retorna o nome do arquivo ou None. Levanta ValueError se invalida/grande."""
    if not data_url or not isinstance(data_url, str):
        return None
    m = re.match(r"^data:image/(jpeg|jpg|png|webp);base64,(.+)$", data_url, re.DOTALL)
    if not m:
        raise ValueError("Formato de imagem inválido")
    try:
        raw = base64.b64decode(m.group(2), validate=True)
    except Exception:
        raise ValueError("Imagem corrompida")
    if len(raw) > 8 * 1024 * 1024:
        raise ValueError("Foto muito grande (máx. 8 MB)")
    # confere a assinatura do arquivo (nao confia so na extensao)
    ok = raw[:3] == b"\xff\xd8\xff" or raw[:8] == b"\x89PNG\r\n\x1a\n" or raw[:4] == b"RIFF"
    if not ok:
        raise ValueError("Arquivo não é uma imagem válida")
    ext = "png" if raw[:8] == b"\x89PNG\r\n\x1a\n" else ("webp" if raw[:4] == b"RIFF" else "jpg")
    nome = "%s.%s" % (visita_id, ext)
    os.makedirs(FOTOS_DIR, exist_ok=True)
    with open(os.path.join(FOTOS_DIR, nome), "wb") as f:
        f.write(raw)
    return nome


def sanitiza_pagamentos(value):
    """Aceita uma lista de {tipo, valor, entrada, parcelas}; descarta lixo/NaN,
    remove tipos repetidos (pagamento misto = formas distintas) e zera
    entrada/parcelas nas formas que nao sao parcelaveis."""
    if not isinstance(value, list):
        return []
    out = []
    vistos = set()
    for item in value:
        if not isinstance(item, dict):
            continue
        tipo = str(item.get("tipo") or "").strip()
        if tipo not in PAGAMENTOS or tipo in vistos:
            continue
        vistos.add(tipo)
        parcelavel = tipo in PARCELAVEIS
        out.append({
            "tipo": tipo,
            "valor": round(_num_pos(item.get("valor")), 2),
            "entrada": round(_num_pos(item.get("entrada")), 2) if parcelavel else 0.0,
            "parcelas": int(_num_pos(item.get("parcelas"), teto=360)) if parcelavel else 0,
        })
    return out


def sanitiza_itens(value):
    """Aceita uma lista de {produto, qtd} (os drones do pedido); mantem so
    produtos validos, SOMA quantidades de um produto repetido e limita 1..99."""
    if not isinstance(value, list):
        return []
    somas, ordem = {}, []
    for item in value:
        if not isinstance(item, dict):
            continue
        prod = str(item.get("produto") or "").strip()
        if prod not in PRODUTOS:
            continue
        try:
            qf = float(item.get("qtd") or 1)
            q = int(qf) if math.isfinite(qf) else 1  # inf/NaN (via API) não podem estourar
        except (TypeError, ValueError):
            q = 1
        q = max(1, min(99, q))
        if prod not in somas:
            somas[prod] = 0
            ordem.append(prod)
        somas[prod] = min(99, somas[prod] + q)
    return [{"produto": p, "qtd": somas[p]} for p in ordem]


def resumo_produtos(itens):
    """Nomes dos produtos do pedido, juntos — usado na busca e como espelho do
    campo legado `produto`. Ex.: [T25P x2, T70P] -> 'T25P, T70P'."""
    return ", ".join(it["produto"] for it in (itens or []) if it.get("produto"))


def itens_de_produto(produto):
    """Um produto unico (webhook/importacao/legado) vira uma lista de 1 item."""
    p = str(produto or "").strip()
    return [{"produto": p, "qtd": 1}] if p in PRODUTOS else []


# ---------------------------------------------------------------------------
# Historico (linha do tempo de atualizacoes do lead)
# ---------------------------------------------------------------------------
STATUS_LABEL = {
    "novo": "Novo lead", "triagem": "Em triagem", "qualificado": "Qualificado",
    "decidindo": "Decidindo", "negociacao": "Em negociação", "proposta": "Proposta enviada",
    "financiamento": "Aguardando financiamento",
    "ganho": "Fechado (ganho)", "desistiu": "Desistiu da compra", "perdido": "Perdido p/ concorrente",
    "curioso": "Só curioso (sem perspectiva)",
}
HIST_LABEL = {
    "status": "Etapa", "vendedor": "Vendedor", "sdr": "SDR", "tipo": "Classificação",
    "valor": "Valor", "produto": "Drone", "regiao": "Cidade", "nome": "Nome",
    "telefone": "Telefone", "email": "E-mail", "area_cultivada": "Área cultivada",
    "cargo": "Cargo do contato", "decisor": "Decisor", "decisor_cargo": "Cargo do decisor",
    "campanha": "Campanha", "observacoes": "Observações", "formas_pagamento": "Forma de pagamento",
    "origem_canal": "Canal", "lat": "Localização", "lng": "Localização",
}


def registra_hist(lead, autor, itens, papel=None, tipo=None, op_id=None, quando=None):
    """Anexa uma entrada na linha do tempo do lead (mantem as ultimas 300).

    papel = cargo de quem fez (admin/gerente/vendedor/sdr) para aparecer no
    painel; tipo = 'nota' quando for uma atualizacao escrita a mao; op_id =
    id do registro offline (para nao duplicar em reenvios); quando = horario do
    evento (registros offline) — padrao agora."""
    itens = [i for i in itens if i]
    if not itens:
        return
    entrada = {"data": quando or now_iso(), "autor": autor or "Sistema", "itens": itens}
    if papel:
        entrada["papel"] = papel
    if tipo:
        entrada["tipo"] = tipo
    if op_id:
        entrada["op_id"] = op_id
    lead.setdefault("historico", []).append(entrada)
    if len(lead["historico"]) > 300:
        lead["historico"] = lead["historico"][-300:]


def descreve_mudancas(antes, depois, campos):
    """Gera frases legiveis do que mudou (so os campos informados)."""
    itens = []
    vistos = set()
    for k in campos:
        if k in ("lat", "lng"):
            k = "localizacao"
        if k in vistos:
            continue
        vistos.add(k)
        if k == "localizacao":
            if antes.get("lat") != depois.get("lat") or antes.get("lng") != depois.get("lng"):
                itens.append("📍 Localização da fazenda atualizada")
            continue
        a, d = antes.get(k), depois.get(k)
        if a == d:
            continue
        if k == "status":
            itens.append("➡️ Etapa: %s → %s" % (STATUS_LABEL.get(a, a or "—"), STATUS_LABEL.get(d, d)))
        elif k == "tipo":
            itens.append("✅ Classificado como %s" % (d or "—"))
        elif k == "valor":
            itens.append("💰 Valor: R$ %s" % ("{:,.0f}".format(float(d or 0)).replace(",", ".")))
        elif k == "vendedor":
            itens.append("👤 Vendedor: %s" % (d or "(removido)"))
        elif k == "sdr":
            itens.append("📞 SDR: %s" % (d or "(removido)"))
        elif k == "itens":
            itens.append("📦 Pedido (drones) atualizado")
        elif k == "status_servico":
            itens.append("🔧 Serviços — etapa: %s" % (d or "—"))
        elif k == "valor_servico":
            itens.append("🔧 Serviços — valor: R$ %s" % ("{:,.0f}".format(float(d or 0)).replace(",", ".")))
        elif k == "formas_pagamento":
            itens.append("💳 Forma de pagamento atualizada")
        elif k == "observacoes":
            itens.append("📝 Observações atualizadas")
        elif k in HIST_LABEL:
            itens.append("✏️ %s: %s" % (HIST_LABEL[k], str(d)[:60] if d else "(vazio)"))
    return itens


def apply_updates(lead, updates):
    """Aplica edicoes manuais. Levanta ValueError com mensagem amigavel quando
    uma regra de negocio e violada (as rotas devolvem 400 com essa mensagem)."""
    status_antes = lead.get("status")
    for key, value in updates.items():
        if key not in EDITABLE:
            continue
        if key == "status" and value not in STAGES:
            continue
        if key == "tipo" and value not in ("", "produtor", "prestador", "pecuarista"):
            continue
        if key in ("telefone", "email") and not str(value or "").strip() and str(lead.get(key) or "").strip():
            campo = "Telefone" if key == "telefone" else "E-mail"
            raise ValueError("%s é obrigatório e não pode ficar vazio" % campo)
        if key == "telefone" and str(value or "").strip() and len(norm_phone(value)) < 8:
            raise ValueError("Telefone inválido — informe DDD e número")
        if key == "produto":
            # produto unico (import/webhook/legado): vira 1 item; itens e a fonte
            if value and value not in PRODUTOS:
                raise ValueError("Produto inválido — escolha um da lista")
            lead["itens"] = itens_de_produto(value)
            lead["produto"] = value if value in PRODUTOS else ""
            continue
        if key == "itens":
            # os drones do pedido; `produto` vira o espelho (nomes juntos) p/ busca
            lead["itens"] = sanitiza_itens(value)
            lead["produto"] = resumo_produtos(lead["itens"])
            continue
        if key == "formas_pagamento":
            lead["formas_pagamento"] = sanitiza_pagamentos(value)
            continue
        if key == "recuperacao":
            lead["recuperacao"] = bool(value)
            continue
        if key == "em_servicos":
            lead["em_servicos"] = bool(value)
            if lead["em_servicos"] and not lead.get("status_servico"):
                lead["status_servico"] = SERVICO_STAGES[0]  # entrou -> primeira etapa
            continue
        if key == "status_servico":
            if value in SERVICO_STAGES:
                lead["status_servico"] = value
                lead["em_servicos"] = True  # ter etapa de servico = estar no painel
            elif value == "":
                lead["status_servico"] = ""
            continue
        if key == "valor_servico":
            try:
                vs = float(value) if value not in ("", None) else 0.0
            except (TypeError, ValueError):
                vs = 0.0
            lead["valor_servico"] = vs if math.isfinite(vs) and vs >= 0 else 0.0
            continue
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

    # "Curioso" e um lead de nivel SDR (sem perspectiva de compra): sai do funil
    # de vendas, entao zera o tipo/qualificacao por QUALQUER caminho (arraste,
    # seletor de etapa do modal ou PATCH) — senao ficaria contado como produtor.
    if lead.get("status") == "curioso":
        lead["tipo"] = ""
        lead["qualificado_em"] = None
    # Consistencia: entrar no funil de vendas sem tipo assume "produtor";
    # ao ganhar o tipo pela primeira vez, marca a data de qualificacao.
    if lead.get("status") in SALES_STAGES and not lead.get("tipo"):
        lead["tipo"] = "produtor"
    if lead.get("tipo") and not lead.get("qualificado_em"):
        lead["qualificado_em"] = now_iso()
    # Primeiro momento em que um vendedor assume o lead = "atendimento".
    if lead.get("vendedor") and not lead.get("atendido_em"):
        lead["atendido_em"] = now_iso()
    # Carimba a data de ganho/perda no momento da TRANSICAO (nao em cada save),
    # para o relatorio nao depender de updated_at (que muda com nota/visita/edicao).
    if lead.get("status") == "ganho" and status_antes != "ganho":
        lead["ganho_em"] = now_iso()
        # vendeu o drone -> entra AUTOMATICAMENTE no painel de Servicos (pos-venda),
        # sem sair do funil de drones (o ganho continua contando).
        if not lead.get("em_servicos"):
            lead["em_servicos"] = True
            lead["status_servico"] = SERVICO_STAGES[0]
    if lead.get("status") == "perdido" and status_antes != "perdido":
        lead["perdido_em"] = now_iso()
    if lead.get("status") == "desistiu" and status_antes != "desistiu":
        lead["desistiu_em"] = now_iso()
    # Lead encerrado nao deve mais cobrar "registre a resposta".
    if lead.get("status") in ("ganho", "perdido", "desistiu", "curioso"):
        lead["aguardando_resposta"] = None

    # Nota fiscal exige contato completo: barra a MUDANCA para essas etapas
    if updates.get("status") in STAGES_EXIGEM_CONTATO and (
            not str(lead.get("telefone") or "").strip() or not str(lead.get("email") or "").strip()):
        # lista gerada das proprias etapas: nao desatualiza ao criar uma nova
        etapas = "/".join('"%s"' % STATUS_LABEL.get(s, s) for s in STAGES_EXIGEM_CONTATO)
        raise ValueError("Para mover para %s, preencha telefone e e-mail do lead (nota fiscal)" % etapas)

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

    # Invariante do painel de Serviços: dentro do painel SEMPRE há uma etapa
    # válida (senão o card ficaria contado mas invisível); fora do painel, etapa
    # vazia. em_servicos manda; a etapa se ajusta.
    if lead.get("em_servicos"):
        if lead.get("status_servico") not in SERVICO_STAGES:
            lead["status_servico"] = SERVICO_STAGES[0]
    else:
        lead["status_servico"] = ""

    lead["updated_at"] = now_iso()
    return lead


def norm_phone(v):
    return re.sub(r"[^0-9]", "", str(v or ""))


def _canon_br(d):
    """Forma canonica para comparacao de numero brasileiro: remove o DDI 55,
    o 0 de tronco e o 9º dígito do celular (o WhatsApp ora inclui, ora omite)."""
    if d.startswith("55") and len(d) in (12, 13):
        d = d[2:]
    if d.startswith("0") and len(d) in (11, 12):  # 0 + DDD + numero
        d = d[1:]
    if len(d) == 11 and d[2] == "9":  # DDD + 9 + 8 digitos
        d = d[:2] + d[3:]
    return d


def same_phone(a, b):
    """Mesmo numero ignorando formatacao, +55/0/DDD e o 9º dígito do celular.
    Comparacao por igualdade canonica — sem casamento por sufixo, que mesclava
    numeros internacionais parecidos com numeros brasileiros."""
    da, db = norm_phone(a), norm_phone(b)
    if not da or not db:
        return False
    return da == db or _canon_br(da) == _canon_br(db)


def find_duplicado(telefone, email, exclude_id=None):
    """Procura outro lead com o mesmo telefone (ou e-mail). Retorna (lead, campo)."""
    email_n = str(email or "").strip().lower()
    for l in _db["leads"]:
        if exclude_id and l["id"] == exclude_id:
            continue
        if telefone and same_phone(l.get("telefone"), telefone):
            return l, "telefone"
        if email_n and str(l.get("email") or "").strip().lower() == email_n:
            return l, "e-mail"
    return None, None


# ---------------------------------------------------------------------------
# Importacao em massa (CSV)
# ---------------------------------------------------------------------------
def _slug_header(h):
    """Normaliza cabecalho de coluna: 'Região do Produtor' -> 'regiaodoprodutor'."""
    s = unicodedata.normalize("NFD", str(h or "")).encode("ascii", "ignore").decode()
    return re.sub(r"[^a-z0-9]", "", s.lower())


# nomes de coluna aceitos -> campo do lead
IMPORT_COLS = {
    "nome": "nome", "cliente": "nome", "nomedoprodutor": "nome",
    "tipo": "tipo",
    "telefone": "telefone", "celular": "telefone", "whatsapp": "telefone",
    "fone": "telefone", "telefonewhatsapp": "telefone",
    "email": "email", "emailnf": "email",
    "regiao": "regiao", "cidade": "regiao", "municipio": "regiao", "regiaodoprodutor": "regiao",
    "area": "area_cultivada", "areacultivada": "area_cultivada",
    "produto": "produto", "produtodeinteresse": "produto",
    "cargo": "cargo", "cargodocontato": "cargo", "funcao": "cargo",
    "decisor": "decisor", "quemdecide": "decisor", "quempaga": "decisor",
    "pagamento": "pagamento", "formapagamento": "pagamento", "formadepagamento": "pagamento",
    "valor": "valor", "valorestimado": "valor", "valorestimadors": "valor",
    "sdr": "sdr", "vendedor": "vendedor", "vendedorresponsavel": "vendedor",
    "canal": "origem_canal", "origemcanal": "origem_canal", "origem": "origem_canal",
    "campanha": "campanha",
    "observacoes": "observacoes", "observacao": "observacoes", "obs": "observacoes",
    "status": "status", "etapa": "status",
}


def parse_hectares(s):
    """Extrai o numero de hectares de um texto livre ('3600', '500 ha',
    '1.200 hectares', '1.200,5'). Retorna float ou None."""
    if not s:
        return None
    m = re.search(r"[\d.,]+", str(s))
    if not m:
        return None
    num = m.group(0).strip(".,")
    if "." in num and "," in num:            # 1.200,5 -> 1200.5
        num = num.replace(".", "").replace(",", ".")
    elif "," in num:                          # 1200,5 -> 1200.5
        num = num.replace(",", ".")
    elif num.count(".") == 1 and len(num.split(".")[1]) == 3:
        num = num.replace(".", "")            # 1.200 -> 1200 (separador de milhar)
    try:
        return float(num)
    except ValueError:
        return None


def _parse_valor_br(texto):
    """Aceita '250000', '250000.50' e o formato brasileiro '250.000,50'."""
    t = str(texto or "").strip().replace("R$", "").strip()
    if not t:
        return 0.0
    if "," in t:
        t = t.replace(".", "").replace(",", ".")
    try:
        v = float(t)
    except ValueError:
        return 0.0
    return v if math.isfinite(v) else 0.0


def importar_csv(texto):
    """Importa leads de um CSV. Retorna (criados, rejeitados). Chamar SEM o lock."""
    primeira = texto.splitlines()[0] if texto.splitlines() else ""
    delim = ";" if primeira.count(";") >= primeira.count(",") else ","
    reader = csv.DictReader(io.StringIO(texto), delimiter=delim)
    if not reader.fieldnames:
        raise ValueError("Cabeçalho não encontrado no arquivo")
    campos = {orig: IMPORT_COLS.get(_slug_header(orig)) for orig in reader.fieldnames}
    if "telefone" not in campos.values():
        raise ValueError("O CSV precisa ter uma coluna de telefone (e de preferência nome e email)")

    criados = 0
    rejeitados = []
    with _lock:
        for i, row in enumerate(reader, start=2):  # linha 1 = cabecalho
            if criados >= 2000:
                rejeitados.append({"linha": i, "motivo": "limite de 2000 leads por importação — divida o arquivo"})
                break
            dados = {}
            for orig, alvo in campos.items():
                if alvo and row.get(orig) is not None:
                    dados[alvo] = str(row.get(orig) or "").strip()
            if not any(dados.values()):
                continue  # linha vazia
            nome = dados.get("nome", "")
            tel = dados.get("telefone", "")
            email = dados.get("email", "")
            if not tel or not email:
                rejeitados.append({"linha": i, "motivo": "%s: sem telefone e/ou e-mail (obrigatórios)" % (nome or "(sem nome)")})
                continue
            if len(norm_phone(tel)) < 8:
                rejeitados.append({"linha": i, "motivo": "%s: telefone inválido (%s)" % (nome or "(sem nome)", tel)})
                continue
            dup, campo_dup = find_duplicado(tel, email)
            if dup:
                rejeitados.append({"linha": i, "motivo": "%s: mesmo %s de \"%s\" (duplicado)" % (
                    nome or tel, campo_dup, dup.get("nome") or "lead existente")})
                continue

            lead = make_lead({"source": "importacao"})
            lead["nome"] = nome
            lead["telefone"] = tel
            lead["email"] = email
            # tolerante como o webhook: padroniza quando reconhece, aceita quando nao
            reg = dados.get("regiao", "")
            lead["regiao"] = canon_cidade(reg) or reg
            prod = dados.get("produto", "")
            for p in PRODUTOS:
                if prod and prod.lower() == p.lower():
                    prod = p
                    break
            lead["produto"] = prod if prod in PRODUTOS else ""
            lead["itens"] = itens_de_produto(prod)
            lead["valor"] = _parse_valor_br(dados.get("valor"))
            lead["area_cultivada"] = dados.get("area_cultivada", "")
            lead["cargo"] = dados.get("cargo", "")
            lead["decisor"] = dados.get("decisor", "")
            # "Financiamento + Permuta" -> duas formas (valores ficam zerados)
            pg = dados.get("pagamento", "")
            if pg:
                # casa ignorando espacos: "Permuta/Troca" == "Permuta / Troca"
                nomes = {re.sub(r"\s+", "", p.lower()): p for p in PAGAMENTOS}
                # separadores: + ; , (NUNCA "/", pois nomes tem "Permuta / Troca")
                achadas = [nomes[re.sub(r"\s+", "", t.lower())]
                           for t in re.split(r"[+;,]", pg) if re.sub(r"\s+", "", t.lower()) in nomes]
                lead["formas_pagamento"] = sanitiza_pagamentos(
                    [{"tipo": t} for t in achadas])
            lead["sdr"] = dados.get("sdr", "")
            lead["vendedor"] = dados.get("vendedor", "")
            lead["responsavel"] = lead["vendedor"] or lead["sdr"]
            if lead["vendedor"]:
                lead["atendido_em"] = now_iso()
            lead["origem_canal"] = dados.get("origem_canal", "")
            lead["campanha"] = dados.get("campanha", "")
            lead["observacoes"] = dados.get("observacoes", "")
            st = dados.get("status", "").lower()
            lead["status"] = st if st in STAGES else "novo"
            tp = dados.get("tipo", "").lower()
            if tp in ("produtor", "prestador", "pecuarista"):
                lead["tipo"] = tp
            elif lead["status"] in SALES_STAGES:
                lead["tipo"] = "produtor"
            if lead.get("tipo"):
                lead["qualificado_em"] = now_iso()
            if lead["status"] == "ganho":
                lead["ganho_em"] = now_iso()
            elif lead["status"] == "perdido":
                lead["perdido_em"] = now_iso()
            elif lead["status"] == "desistiu":
                lead["desistiu_em"] = now_iso()
            _db["leads"].append(lead)
            criados += 1
        if criados:
            save_db()
    return criados, rejeitados


# ---------------------------------------------------------------------------
# Usuarios, senhas e sessoes
# ---------------------------------------------------------------------------
def _slug_login(nome):
    s = unicodedata.normalize("NFD", str(nome or "")).encode("ascii", "ignore").decode()
    return re.sub(r"[^a-z0-9.]", "", s.lower().replace(" ", ".")) or "usuario"


def hash_senha(senha, salt=None):
    salt = salt or secrets.token_hex(16)
    h = hashlib.pbkdf2_hmac("sha256", str(senha).encode(), bytes.fromhex(salt), 120000).hex()
    return salt, h


def verifica_senha(user, senha):
    if not user.get("senha_hash") or not user.get("salt"):
        return False  # senha ainda nao definida pelo admin
    _, h = hash_senha(senha, user["salt"])
    return secrets.compare_digest(h, user["senha_hash"])


def ensure_admin():
    """Garante que exista ao menos um administrador para dar o primeiro acesso.
    A senha padrao fica marcada (senha_padrao=True) para o painel avisar que
    precisa ser trocada; a flag some quando o admin define uma senha nova."""
    if any(u.get("papel") == "admin" for u in _db["users"]):
        return None
    senha = "novaera123"
    salt, h = hash_senha(senha)
    _db["users"].append({
        "id": new_id(), "nome": "Administrador", "login": "admin",
        "salt": salt, "senha_hash": h, "papel": "admin", "ativo": True,
        "senha_padrao": True,
    })
    save_db()
    return senha


def ensure_webhook_token():
    """Resolve o token do webhook: env var ou um aleatorio persistido."""
    global WEBHOOK_TOKEN
    if WEBHOOK_TOKEN:
        return WEBHOOK_TOKEN
    tok = _db.get("settings", {}).get("webhook_token")
    if not tok:
        tok = secrets.token_urlsafe(24)
        _db.setdefault("settings", {})["webhook_token"] = tok
        save_db()
    WEBHOOK_TOKEN = tok
    return tok


def cria_sessao(user_id):
    token = secrets.token_urlsafe(32)
    _db["sessions"][token] = {"user_id": user_id, "exp": time.time() + SESSAO_DIAS * 86400}
    # faxina de sessoes vencidas
    agora = time.time()
    _db["sessions"] = {t: s for t, s in _db["sessions"].items() if s.get("exp", 0) > agora}
    save_db()
    return token


def usuario_da_sessao(token):
    if not token:
        return None
    s = _db.get("sessions", {}).get(token)
    if not s or s.get("exp", 0) < time.time():
        return None
    u = next((x for x in _db["users"] if x["id"] == s["user_id"]), None)
    if not u or not u.get("ativo", True):
        return None
    return u


def nome_em_uso(nome, exclude_id=None):
    alvo = str(nome or "").strip().lower()
    return any(str(u.get("nome") or "").strip().lower() == alvo and u["id"] != exclude_id
               for u in _db.get("users", []))


def renomeia_dono_leads(antigo, novo):
    """A posse do lead e gravada pelo NOME; ao renomear, atualiza todos os leads
    para o dono nao virar orfao (perder visibilidade e sair do rodizio)."""
    if not antigo or antigo == novo:
        return
    for l in _db["leads"]:
        for campo in ("sdr", "vendedor", "responsavel"):
            if l.get(campo) == antigo:
                l[campo] = novo
        for v in l.get("visitas", []):
            if v.get("visitante") == antigo:
                v["visitante"] = novo


def pode_recuperacao(user):
    """Quem pode ver/trabalhar o painel de Recuperação: admin/gerente sempre;
    SDR/vendedor só quando liberado individualmente (acesso_recuperacao)."""
    return user.get("papel") in ("admin", "gerente") or bool(user.get("acesso_recuperacao"))


def user_publico(u):
    return {"id": u["id"], "nome": u["nome"], "login": u["login"],
            "papel": u["papel"], "ativo": u.get("ativo", True),
            "senha_definida": bool(u.get("senha_hash")),
            "senha_padrao": bool(u.get("senha_padrao")),
            "acesso_recuperacao": bool(u.get("acesso_recuperacao")),
            "pode_recuperacao": pode_recuperacao(u)}


def settings_publico():
    """Config exposta ao painel — sem o token do webhook (segredo do servidor)."""
    return {k: v for k, v in _db.get("settings", {}).items() if k != "webhook_token"}


# ---------------------------------------------------------------------------
# Permissoes por papel
# ---------------------------------------------------------------------------
VENDAS_STATUSES = SALES_STAGES  # etapas em que o lead esta no funil de vendas


def no_funil_vendas(lead):
    return lead.get("status") in VENDAS_STATUSES or (
        lead.get("status") in ("perdido", "desistiu") and bool(lead.get("tipo")))


def pode_ver_lead(user, lead):
    p = user.get("papel")
    if p in ("admin", "gerente"):
        return True
    if p == "sdr":
        return lead.get("sdr") == user.get("nome")
    if p == "vendedor":
        dono = str(lead.get("vendedor") or "").strip()
        return no_funil_vendas(lead) and dono in ("", user.get("nome"))
    return False


def active_members(papel=None):
    """Equipe = usuarios ativos com papel de raia (sdr/vendedor)."""
    out = [u for u in _db.get("users", []) if u.get("ativo", True) and u.get("papel") in PAPEIS]
    if papel:
        out = [u for u in out if u.get("papel") == papel]
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
    cargo = sender_custom.get("cargo") or custom.get("cargo") or ""
    decisor = sender_custom.get("decisor") or custom.get("decisor") or ""
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
        "itens": itens_de_produto(produto),
        "cargo": cargo,
        "decisor": decisor,
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

        # Cliente conhecido abrindo conversa NOVA: reconhece pelo id do contato,
        # telefone ou e-mail e atualiza o lead existente em vez de duplicar
        # (adota a conversa nova para as proximas mensagens chegarem certo).
        if lead is None and (contact_id is not None or telefone or email):
            email_n = str(email or "").strip().lower()
            candidatos = [l for l in _db["leads"] if (
                (contact_id is not None and l.get("chatwoot_contact_id") == contact_id)
                or (telefone and same_phone(l.get("telefone"), telefone))
                or (email_n and str(l.get("email") or "").strip().lower() == email_n))]
            if candidatos:
                # prefere um lead em atendimento; so cai num encerrado se nao houver
                ativos = [l for l in candidatos if l.get("status") not in ("ganho", "perdido", "desistiu", "curioso")]
                lead = (ativos or candidatos)[0]
                if conversation_id is not None:
                    lead["chatwoot_conversation_id"] = conversation_id
                # cliente que estava dado como perdido/desistiu/curioso voltou:
                # reentra na triagem para a equipe enxergar
                if lead.get("status") in ("perdido", "desistiu", "curioso"):
                    lead["status"] = "novo"
                    lead["tipo"] = ""  # volta para a triagem do SDR
                    registra_hist(lead, "Chatwoot", ["🔄 Cliente voltou pelo Chatwoot — reaberto na triagem"])
                else:
                    registra_hist(lead, "Chatwoot", ["💬 Nova conversa no Chatwoot"])
                print("[webhook] conversa nova %s reconhecida -> lead %s" % (
                    conversation_id, lead.get("nome") or lead["id"]))

        if lead is None:
            if conversation_id is None and not telefone and not email:
                return {"ok": False, "reason": "evento sem dados de contato"}
            lead = make_lead(incoming)
            # Rodizio: o lead novo ja cai para um SDR fazer o primeiro contato.
            sdr = next_sdr()
            if sdr:
                lead["sdr"] = sdr
                lead["responsavel"] = sdr
            registra_hist(lead, "Chatwoot", [
                "🆕 Lead recebido do Chatwoot" + (" (canal: %s)" % canal if canal else ""),
                "📞 SDR: %s (rodízio)" % sdr if sdr else "",
            ], tipo="novo")
            _db["leads"].append(lead)
            save_db()
            print("[webhook] novo lead: %s -> SDR %s (canal: %s)" % (
                nome or telefone or conversation_id, sdr or "-", canal or "-"))
            return {"ok": True, "created": True, "id": lead["id"], "sdr": sdr}

        # Se a campanha cadastrada foi identificada agora (ex.: o codigo veio na
        # mensagem seguinte), vincula e espelha o nome mesmo que o campo texto
        # ja tivesse algo generico (titulo do anuncio, utm solto). Lead ja GANHO
        # nao recebe vinculo novo: a venda fechada nao pode ser creditada a uma
        # campanha que nao a gerou (distorceria o relatorio).
        if incoming.get("campanha_id") and not lead.get("campanha_id") and lead.get("status") != "ganho":
            lead["campanha_id"] = incoming["campanha_id"]
            lead["campanha"] = incoming["campanha"]

        for key, value in incoming.items():
            if key == "last_message":
                if value:
                    lead["last_message"] = value
                continue
            if value and not lead.get(key):
                # nao preenche telefone/email que criaria duplicata com OUTRO lead
                if key in ("telefone", "email"):
                    d, _campo = find_duplicado(
                        value if key == "telefone" else None,
                        value if key == "email" else None,
                        exclude_id=lead["id"])
                    if d:
                        continue
                lead[key] = value
        # mantém o espelho `produto` (usado na busca) coerente com os itens do
        # pedido — o merge acima trata as chaves soltas e poderia divergir.
        if lead.get("itens"):
            lead["produto"] = resumo_produtos(lead["itens"])
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
    def send_json(self, status, obj, headers=None):
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        for k, v in (headers or {}).items():
            self.send_header(k, v)
        self.end_headers()
        self.wfile.write(body)

    def _cookie(self, nome):
        raw = self.headers.get("Cookie") or ""
        for parte in raw.split(";"):
            k, _, v = parte.strip().partition("=")
            if k == nome:
                return v
        return None

    def read_body(self):
        length = int(self.headers.get("Content-Length") or 0)
        if length <= 0:
            return {}
        if length > 15 * 1024 * 1024:  # fotos de visita chegam em base64
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

        # ---- Login (unica rota aberta sem sessao) ----
        if path == "/api/login" and method == "POST":
            try:
                body = self.read_body()
            except Exception:
                return self.send_json(400, {"error": "Corpo invalido"})
            login = str(body.get("login") or "").strip().lower()
            senha = str(body.get("senha") or "")
            with _lock:
                u = next((x for x in _db["users"] if x.get("login") == login and x.get("ativo", True)), None)
            # A verificacao PBKDF2 e o atraso ocorrem FORA do lock (senao logins
            # errados em rajada congelariam o CRM inteiro). Quando o login nao
            # existe, roda um hash "fantasma" para o tempo de resposta nao
            # denunciar quais logins sao validos.
            if u and verifica_senha(u, senha):
                with _lock:
                    token = cria_sessao(u["id"])
                return self.send_json(200, {"user": user_publico(u)}, headers={
                    "Set-Cookie": "sessao=%s; Path=/; HttpOnly; SameSite=Lax; Max-Age=%d" % (
                        token, SESSAO_DIAS * 86400)})
            if not u:
                hash_senha(senha, "00" * 16)  # equaliza o tempo (login inexistente)
            time.sleep(0.4)  # freia adivinhacao de senha, sem segurar o lock
            return self.send_json(401, {"error": "Login ou senha incorretos"})

        # ---- Daqui em diante, toda rota exige sessao valida ----
        with _lock:
            user = usuario_da_sessao(self._cookie("sessao"))
            if user is not None:
                _online[user["id"]] = now_iso()  # marca presenca (qualquer requisicao)
        if user is None:
            return self.send_json(401, {"error": "Sessão expirada — faça login novamente"})
        gestor = user["papel"] in ("admin", "gerente")

        if path == "/api/me" and method == "GET":
            return self.send_json(200, {"user": user_publico(user)})

        # ---- Heartbeat: mantem a presenca viva mesmo com um modal aberto ----
        if path == "/api/heartbeat" and method == "GET":
            return self.send_json(200, {"ok": True})

        # ---- Quem esta online + ultimas movimentacoes (so gestor) ----
        if path == "/api/online" and method == "GET":
            if not gestor:
                return self.send_json(403, {"error": "Disponível só para gerente/administrador"})
            agora = datetime.now(timezone.utc)
            out = []
            with _lock:
                usuarios = [u for u in _db["users"] if u.get("ativo", True)]
                for u in usuarios:
                    ls = _online.get(u["id"])
                    seg = None
                    if ls:
                        try:
                            seg = int((agora - datetime.fromisoformat(ls)).total_seconds())
                        except (ValueError, TypeError):
                            seg = None
                    out.append({
                        "nome": u["nome"], "papel": u["papel"],
                        "online": seg is not None and seg <= ONLINE_LIMIAR_S,
                        "segundos": seg,
                    })
            out.sort(key=lambda x: (not x["online"], x["segundos"] if x["segundos"] is not None else 10 ** 12))
            return self.send_json(200, {"usuarios": out, "limiar": ONLINE_LIMIAR_S})

        if path == "/api/atividades" and method == "GET":
            if not gestor:
                return self.send_json(403, {"error": "Disponível só para gerente/administrador"})
            try:
                limite = min(int((qs.get("limite") or ["60"])[0]), 200)
            except ValueError:
                limite = 60
            # Segura o _lock (global) o MINIMO possivel: so coleta tuplas leves das
            # ultimas 'limite' entradas de CADA lead (as unicas que poderiam entrar
            # no top-N global). A ordenacao/montagem pesada fica FORA do lock.
            parciais = []
            with _lock:
                for l in _db["leads"]:
                    nome = l.get("nome") or "(sem nome)"
                    lid = l.get("id")
                    for h in (l.get("historico") or [])[-limite:]:
                        parciais.append((h.get("data") or "", h.get("autor"), h.get("papel"),
                                         h.get("tipo"), list(h.get("itens") or []), lid, nome))
            top = heapq.nlargest(limite, parciais, key=lambda t: t[0])
            ev = [{"data": t[0], "autor": t[1], "papel": t[2], "tipo": t[3],
                   "itens": t[4], "lead_id": t[5], "lead_nome": t[6]} for t in top]
            return self.send_json(200, {"atividades": ev})

        # ---- Foto de visita (serve o arquivo; exige sessao) ----
        mf = re.match(r"^/api/foto/([A-Za-z0-9_.-]+)$", path)
        if mf and method == "GET":
            nome = mf.group(1)
            caminho = os.path.join(FOTOS_DIR, nome)
            if ".." in nome or not os.path.abspath(caminho).startswith(os.path.abspath(FOTOS_DIR)) \
                    or not os.path.isfile(caminho):
                return self.send_json(404, {"error": "Foto não encontrada"})
            with open(caminho, "rb") as f:
                data = f.read()
            ext = os.path.splitext(nome)[1].lower()
            ct = {".png": "image/png", ".webp": "image/webp"}.get(ext, "image/jpeg")
            self.send_response(200)
            self.send_header("Content-Type", ct)
            self.send_header("Content-Length", str(len(data)))
            self.send_header("Cache-Control", "private, max-age=86400")
            self.end_headers()
            self.wfile.write(data)
            return

        if path == "/api/logout" and method == "POST":
            with _lock:
                _db.get("sessions", {}).pop(self._cookie("sessao"), None)
                save_db()
            return self.send_json(200, {"ok": True}, headers={
                "Set-Cookie": "sessao=; Path=/; HttpOnly; Max-Age=0"})

        # ---- Usuarios e niveis de acesso (so admin) ----
        if path.startswith("/api/users"):
            if user["papel"] != "admin":
                return self.send_json(403, {"error": "Só o administrador gerencia usuários"})
            if path == "/api/users" and method == "GET":
                with _lock:
                    return self.send_json(200, {"users": [user_publico(u) for u in _db["users"]]})
            if path == "/api/users" and method == "POST":
                try:
                    body = self.read_body()
                except Exception:
                    return self.send_json(400, {"error": "Corpo invalido"})
                nome = str(body.get("nome") or "").strip()
                papel = body.get("papel")
                senha = str(body.get("senha") or "")
                if not nome:
                    return self.send_json(400, {"error": "Informe o nome"})
                if papel not in PAPEIS_USUARIO:
                    return self.send_json(400, {"error": "Nível de acesso inválido"})
                if senha and len(senha) < 6:
                    return self.send_json(400, {"error": "Senha muito curta (mínimo 6 caracteres)"})
                with _lock:
                    login = str(body.get("login") or "").strip().lower() or _slug_login(nome)
                    if any(u.get("login") == login for u in _db["users"]):
                        return self.send_json(400, {"error": "Já existe usuário com esse login"})
                    if nome_em_uso(nome):
                        return self.send_json(400, {"error": "Já existe usuário com esse nome — use um nome diferente"})
                    salt, h = hash_senha(senha) if senha else ("", "")
                    novo = {"id": new_id(), "nome": nome, "login": login, "salt": salt,
                            "senha_hash": h, "papel": papel, "ativo": True}
                    _db["users"].append(novo)
                    save_db()
                    return self.send_json(201, {"user": user_publico(novo)})
            mu = re.match(r"^/api/users/([^/]+)$", path)
            if mu:
                body = None
                if method in ("PATCH", "PUT"):
                    try:
                        body = self.read_body()
                    except Exception:
                        return self.send_json(400, {"error": "Corpo invalido"})
                with _lock:
                    alvo = next((u for u in _db["users"] if u["id"] == mu.group(1)), None)
                    if not alvo:
                        return self.send_json(404, {"error": "Usuário não encontrado"})
                    if method in ("PATCH", "PUT"):
                        if "nome" in body and str(body["nome"]).strip():
                            novo_nome = str(body["nome"]).strip()
                            if nome_em_uso(novo_nome, exclude_id=alvo["id"]):
                                return self.send_json(400, {"error": "Já existe usuário com esse nome"})
                            renomeia_dono_leads(alvo["nome"], novo_nome)  # leads seguem o dono
                            alvo["nome"] = novo_nome
                        if body.get("papel") in PAPEIS_USUARIO:
                            if alvo["id"] == user["id"] and body["papel"] != "admin":
                                return self.send_json(400, {"error": "Você não pode rebaixar o próprio acesso"})
                            alvo["papel"] = body["papel"]
                        if "ativo" in body:
                            if alvo["id"] == user["id"] and not body["ativo"]:
                                return self.send_json(400, {"error": "Você não pode desativar a si mesmo"})
                            alvo["ativo"] = bool(body["ativo"])
                        if "acesso_recuperacao" in body:
                            alvo["acesso_recuperacao"] = bool(body["acesso_recuperacao"])
                        if body.get("senha"):
                            if len(str(body["senha"])) < 6:
                                return self.send_json(400, {"error": "Senha muito curta (mínimo 6 caracteres)"})
                            alvo["salt"], alvo["senha_hash"] = hash_senha(str(body["senha"]))
                            alvo.pop("senha_padrao", None)  # deixou de ser a senha padrao
                            # troca de senha derruba sessoes antigas desse usuario
                            _db["sessions"] = {t: s for t, s in _db["sessions"].items()
                                               if s.get("user_id") != alvo["id"]}
                        save_db()
                        return self.send_json(200, {"user": user_publico(alvo)})
                    if method == "DELETE":
                        if alvo["id"] == user["id"]:
                            return self.send_json(400, {"error": "Você não pode excluir a si mesmo"})
                        _db["users"] = [u for u in _db["users"] if u["id"] != alvo["id"]]
                        _db["sessions"] = {t: s for t, s in _db["sessions"].items()
                                           if s.get("user_id") != alvo["id"]}
                        save_db()
                        return self.send_json(200, {"ok": True})

        # Estatisticas (calculadas sobre os leads que ESTE usuario pode ver)
        if path == "/api/stats" and method == "GET":
            escopo = (qs.get("escopo") or ["atuais"])[0]
            with _lock:
                todos_visiveis = [l for l in _db["leads"] if pode_ver_lead(user, l)]
                # contagens dos lotes (para os botoes Atuais/Recuperacao/Servicos).
                # Recuperacao so conta/aparece para quem tem acesso liberado.
                pode_rec = pode_recuperacao(user)
                n_recuperacao = sum(1 for l in todos_visiveis if l.get("recuperacao")) if pode_rec else 0
                n_servicos = sum(1 for l in todos_visiveis if l.get("em_servicos"))
                n_atuais = sum(1 for l in todos_visiveis if not l.get("recuperacao"))
                if escopo == "servicos":
                    visiveis = [l for l in todos_visiveis if l.get("em_servicos")]
                elif escopo == "recuperacao":
                    visiveis = [l for l in todos_visiveis if l.get("recuperacao")] if pode_rec else []
                else:
                    visiveis = [l for l in todos_visiveis if not l.get("recuperacao")]
                por_status = {s: {"count": 0, "valor": 0} for s in STAGES}
                total_valor = 0
                for l in visiveis:
                    s = l.get("status") if l.get("status") in STAGES else "novo"
                    por_status[s]["count"] += 1
                    por_status[s]["valor"] += float(l.get("valor") or 0)
                    if l.get("status") not in ("perdido", "desistiu", "curioso"):
                        total_valor += float(l.get("valor") or 0)
                produtores = sum(1 for l in visiveis if l.get("tipo") == "produtor")
                prestadores = sum(1 for l in visiveis if l.get("tipo") == "prestador")
                pecuaristas = sum(1 for l in visiveis if l.get("tipo") == "pecuarista")
                aguardando = sum(1 for l in visiveis if l.get("aguardando_resposta"))
                _cad = cadencia_dias_cfg()
                retornos = sum(1 for l in visiveis if precisa_retorno(l, _cad))
                # cidades presentes nos leads visiveis (para o filtro de cidade)
                cidades = sorted({str(l.get("regiao") or "").strip()
                                  for l in visiveis if str(l.get("regiao") or "").strip()})
                return self.send_json(200, {
                    "total": len(visiveis),
                    "valor_pipeline": total_valor,
                    "produtores": produtores,
                    "prestadores": prestadores,
                    "pecuaristas": pecuaristas,
                    "aguardando_resposta": aguardando,
                    "retornos": retornos,
                    "alertas": aguardando + retornos,
                    "atuais_total": n_atuais,
                    "recuperacao_total": n_recuperacao,
                    "servicos_total": n_servicos,
                    "cadencia_dias": _cad,
                    "resposta_horas": resposta_horas_cfg(),
                    "cidades": cidades,
                    "mesorregioes": MESORREGIOES,
                    "por_status": por_status,
                    "stages": STAGES,
                })

        # Campanhas
        if path == "/api/campaigns" and method == "GET":
            with _lock:
                return self.send_json(200, {
                    "campaigns": list(_db.get("campaigns", [])),
                    "settings": settings_publico(),
                })

        if path == "/api/campaigns" and method == "POST":
            if not gestor:
                return self.send_json(403, {"error": "Sem permissão para gerenciar campanhas"})
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
            if not gestor:
                return self.send_json(403, {"error": "Sem permissão para gerenciar campanhas"})
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
            if not gestor:
                return self.send_json(403, {"error": "Sem permissão para alterar configurações"})
            try:
                body = self.read_body()
            except Exception:
                return self.send_json(400, {"error": "Corpo invalido"})
            with _lock:
                st = _db.setdefault("settings", {})
                if "whatsapp_number" in body:
                    st["whatsapp_number"] = re.sub(r"[^0-9]", "", str(body["whatsapp_number"]))
                if "cadencia_dias" in body:
                    try:
                        st["cadencia_dias"] = max(1, min(30, int(body["cadencia_dias"])))
                    except (TypeError, ValueError):
                        return self.send_json(400, {"error": "Prazo de retorno inválido (use 1 a 30 dias)"})
                if "resposta_horas" in body:
                    try:
                        st["resposta_horas"] = max(1, min(168, int(body["resposta_horas"])))
                    except (TypeError, ValueError):
                        return self.send_json(400, {"error": "Prazo da resposta inválido (use 1 a 168 horas)"})
                save_db()
                return self.send_json(200, {"settings": settings_publico()})

        # Relatorio por campanha (quantos leads/produtores/ganhos e R$ cada uma gerou)
        if path == "/api/report/campanhas" and method == "GET":
            if not gestor:
                return self.send_json(403, {"error": "Relatório disponível só para gerente/administrador"})
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
                    if l.get("recuperacao"):
                        continue  # relatorio = pipeline atual, sem o lote de recuperacao
                    row = rows.get(l.get("campanha_id") or "", sem)
                    row["leads"] += 1
                    if l.get("tipo") == "produtor":
                        row["produtores"] += 1
                    valor = float(l.get("valor") or 0)
                    if l.get("status") == "ganho":
                        row["ganhos"] += 1
                        row["valor_ganho"] += valor
                    elif l.get("status") not in ("perdido", "desistiu", "curioso"):
                        row["valor_aberto"] += valor
                out = sorted(rows.values(), key=lambda r: r["leads"], reverse=True)
                if sem["leads"]:
                    out.append(sem)
                return self.send_json(200, {"report": out})

        # Relatorio diario: quantos leads chegaram e quantos foram qualificados
        if path == "/api/report/diario" and method == "GET":
            if not gestor:
                return self.send_json(403, {"error": "Relatório disponível só para gerente/administrador"})
            try:
                dias = min(int((qs.get("dias") or ["30"])[0]), 180)
            except ValueError:
                dias = 30
            with _lock:
                por_dia = {}

                def bucket(d):
                    return por_dia.setdefault(d, {
                        "dia": d, "recebidos": 0, "recebidos_chatwoot": 0,
                        "qualificados": 0, "produtores": 0, "prestadores": 0, "pecuaristas": 0,
                        "ganhos": 0, "perdidos": 0, "desistidos": 0})

                for l in _db["leads"]:
                    if l.get("recuperacao"):
                        continue  # relatorio = leads NOVOS, sem o lote de recuperacao
                    d = dia_brt(l.get("created_at"))
                    if d:
                        b = bucket(d)
                        b["recebidos"] += 1
                        if l.get("source") == "chatwoot":
                            b["recebidos_chatwoot"] += 1
                    dq = dia_brt(l.get("qualificado_em"))
                    if dq:
                        b = bucket(dq)
                        b["qualificados"] += 1
                        if l.get("tipo") == "produtor":
                            b["produtores"] += 1
                        elif l.get("tipo") == "prestador":
                            b["prestadores"] += 1
                        elif l.get("tipo") == "pecuarista":
                            b["pecuaristas"] += 1
                    if l.get("status") == "ganho":
                        dg = dia_brt(l.get("ganho_em") or l.get("updated_at"))
                        if dg:
                            bucket(dg)["ganhos"] += 1
                    elif l.get("status") == "perdido":
                        dp = dia_brt(l.get("perdido_em") or l.get("updated_at"))
                        if dp:
                            bucket(dp)["perdidos"] += 1
                    elif l.get("status") == "desistiu":
                        dd = dia_brt(l.get("desistiu_em") or l.get("updated_at"))
                        if dd:
                            bucket(dd)["desistidos"] += 1

                linhas = sorted(por_dia.values(), key=lambda r: r["dia"], reverse=True)[:dias]
                totais = {"recebidos": sum(r["recebidos"] for r in linhas),
                          "recebidos_chatwoot": sum(r["recebidos_chatwoot"] for r in linhas),
                          "qualificados": sum(r["qualificados"] for r in linhas),
                          "ganhos": sum(r["ganhos"] for r in linhas)}
                return self.send_json(200, {"report": linhas, "totais": totais})

        # Equipe (visao dos usuarios com papel de raia: SDRs e vendedores).
        # Leitura para todos (nomes das raias); criacao/edicao so gestores —
        # a gestao completa (login/senha/nivel) fica em /api/users (admin).
        if path == "/api/members" and method == "GET":
            with _lock:
                equipe = [user_publico(u) for u in _db["users"] if u.get("papel") in PAPEIS]
                return self.send_json(200, {"members": equipe})

        if path == "/api/members" and method == "POST":
            if not gestor:
                return self.send_json(403, {"error": "Sem permissão para alterar a equipe"})
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
                if nome_em_uso(nome):
                    return self.send_json(400, {"error": "Já existe alguém com esse nome — use um nome diferente"})
                login = _slug_login(nome)
                if any(u.get("login") == login for u in _db["users"]):
                    login = login + secrets.token_hex(2)
                novo = {"id": new_id(), "nome": nome, "login": login, "salt": "",
                        "senha_hash": "", "papel": papel, "ativo": True}
                _db["users"].append(novo)
                save_db()
                return self.send_json(201, {"member": user_publico(novo)})

        mm = re.match(r"^/api/members/([^/]+)$", path)
        if mm:
            if not gestor:
                return self.send_json(403, {"error": "Sem permissão para alterar a equipe"})
            member_id = mm.group(1)
            body = None
            if method in ("PATCH", "PUT"):
                try:
                    body = self.read_body()
                except Exception:
                    return self.send_json(400, {"error": "Corpo invalido"})
            with _lock:
                member = next((x for x in _db["users"] if x["id"] == member_id and x.get("papel") in PAPEIS), None)
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
                    return self.send_json(200, {"member": user_publico(member)})
                if method == "DELETE":
                    _db["users"] = [x for x in _db["users"] if x["id"] != member_id]
                    _db["sessions"] = {t: s for t, s in _db["sessions"].items()
                                       if s.get("user_id") != member_id}
                    save_db()
                    return self.send_json(200, {"ok": True})

        # Listar (cada papel enxerga so o que lhe cabe). Todos os filtros se
        # combinam (E logico): busca + canal + pagamento + produto + cidade + hectare.
        if path == "/api/leads" and method == "GET":
            q = (qs.get("q") or [""])[0].lower().strip()
            canal = (qs.get("canal") or [""])[0]
            pagamento = (qs.get("pagamento") or [""])[0]
            produto = (qs.get("produto") or [""])[0]
            cidade = (qs.get("cidade") or [""])[0]
            mesorregiao = (qs.get("mesorregiao") or [""])[0]
            f_vendedor = (qs.get("vendedor") or [""])[0]
            f_sdr = (qs.get("sdr") or [""])[0]
            # escopo: "atuais" (padrao, funil dos leads NOVOS) x "recuperacao"
            escopo = (qs.get("escopo") or ["atuais"])[0]

            def _f(k):
                try:
                    return float((qs.get(k) or [""])[0])
                except ValueError:
                    return None
            ha_min, ha_max = _f("ha_min"), _f("ha_max")

            with _lock:
                leads = [l for l in _db["leads"] if pode_ver_lead(user, l)]
            # separa os lotes: recuperacao (antigos), servicos (pos-venda, em
            # paralelo) e atuais (funil de drones dos leads novos).
            if escopo == "servicos":
                leads = [l for l in leads if l.get("em_servicos")]
            elif escopo == "recuperacao":
                # só quem tem acesso liberado vê a Recuperação
                leads = [l for l in leads if l.get("recuperacao")] if pode_recuperacao(user) else []
            else:
                leads = [l for l in leads if not l.get("recuperacao")]
            if q:
                def match(l):
                    blob = " ".join(str(l.get(k) or "") for k in
                                    ("nome", "telefone", "email", "regiao", "produto", "campanha", "vendedor", "cargo", "decisor")).lower()
                    return q in blob
                leads = [l for l in leads if match(l)]
            if canal:
                leads = [l for l in leads if l.get("origem_canal") == canal]
            if pagamento:
                leads = [l for l in leads
                         if any(fp.get("tipo") == pagamento for fp in (l.get("formas_pagamento") or []))]
            if produto:
                # casa se QUALQUER drone do pedido for esse modelo (pedido com vários)
                leads = [l for l in leads
                         if any(it.get("produto") == produto for it in (l.get("itens") or []))
                         or l.get("produto") == produto]
            if cidade:
                leads = [l for l in leads if str(l.get("regiao") or "").strip() == cidade]
            if mesorregiao:
                leads = [l for l in leads if meso_da_regiao(l.get("regiao")) == mesorregiao]
            if f_vendedor:
                if f_vendedor == "__none__":
                    leads = [l for l in leads if not str(l.get("vendedor") or "").strip()]
                else:
                    leads = [l for l in leads if l.get("vendedor") == f_vendedor]
            if f_sdr:
                if f_sdr == "__none__":
                    leads = [l for l in leads if not str(l.get("sdr") or "").strip()]
                else:
                    leads = [l for l in leads if l.get("sdr") == f_sdr]
            if ha_min is not None or ha_max is not None:
                def na_faixa(l):
                    h = parse_hectares(l.get("area_cultivada"))
                    if h is None:
                        return False  # sem area informada nao entra numa faixa
                    if ha_min is not None and h < ha_min:
                        return False
                    if ha_max is not None and h > ha_max:
                        return False
                    return True
                leads = [l for l in leads if na_faixa(l)]
            leads.sort(key=lambda l: l.get("updated_at") or "", reverse=True)
            return self.send_json(200, {"leads": leads, "stages": STAGES})

        # ---- Acao em massa: atribuir vendedor / classificar varios leads ----
        # (ANTES da rota por id, senao 'bulk' casaria no regex)
        if path == "/api/leads/bulk" and method == "POST":
            if not gestor:
                return self.send_json(403, {"error": "Só gerente/administrador pode alterar vários leads de uma vez"})
            try:
                body = self.read_body()
            except Exception:
                return self.send_json(400, {"error": "Corpo invalido"})
            ids = body.get("ids")
            if not isinstance(ids, list) or not ids:
                return self.send_json(400, {"error": "Nenhum lead selecionado"})
            if len(ids) > 2000:
                return self.send_json(400, {"error": "Seleção grande demais (máximo 2000)"})
            updates = {}
            vend = str(body.get("vendedor") or "").strip()
            if vend:
                updates["vendedor"] = vend
            if body.get("tipo") in ("produtor", "prestador", "pecuarista"):
                updates["tipo"] = body["tipo"]
            if body.get("qualificar"):
                updates["status"] = "qualificado"
            if not updates:
                return self.send_json(400, {"error": "Escolha o que alterar (vendedor e/ou classificação)"})
            alvo = set(str(i) for i in ids)
            ok, sem_mudanca, fechados, falhas = 0, 0, 0, []
            with _lock:
                for lead in _db["leads"]:
                    if lead["id"] not in alvo or not pode_ver_lead(user, lead):
                        continue
                    # Caso ja encerrado/arquivado (ganho/perdido/desistiu/curioso)
                    # NAO e tocado pela acao em massa.
                    if lead.get("status") in ("ganho", "perdido", "desistiu", "curioso"):
                        fechados += 1
                        continue
                    u = dict(updates)
                    # "qualificar" so vale para quem ainda esta na triagem: nunca
                    # puxa de volta quem ja avancou (negociacao/proposta/...)
                    if lead.get("status") not in ("novo", "triagem"):
                        u.pop("status", None)
                    if not u:
                        sem_mudanca += 1
                        continue
                    tentativa = dict(lead)
                    try:
                        apply_updates(tentativa, u)
                    except ValueError as e:
                        falhas.append({"nome": lead.get("nome") or lead["id"], "motivo": str(e)})
                        continue
                    itens = descreve_mudancas(lead, tentativa, list(u.keys()))
                    if not itens:
                        # nada mudou de verdade: nao carimba updated_at nem gera
                        # entrada no historico (senao "queima" o selo de atividade)
                        sem_mudanca += 1
                        continue
                    lead.update(tentativa)
                    registra_hist(lead, user["nome"], itens, papel=user["papel"], tipo="massa")
                    ok += 1
                if ok:
                    save_db()
            print("[massa] %d atualizados, %d sem mudanca, %d fechados ignorados (por %s)"
                  % (ok, sem_mudanca, fechados, user["nome"]))
            return self.send_json(200, {"atualizados": ok, "sem_alteracao": sem_mudanca,
                                        "fechados_ignorados": fechados, "falhas": falhas})

        # Importacao em massa (ANTES da rota por id: 'import' casaria no regex)
        if path == "/api/leads/import" and method == "POST":
            if not gestor:
                return self.send_json(403, {"error": "Importação disponível só para gerente/administrador"})
            try:
                body = self.read_body()
            except Exception:
                return self.send_json(400, {"error": "Corpo invalido"})
            csv_texto = body.get("csv")
            if not isinstance(csv_texto, str) or not csv_texto.strip():
                return self.send_json(400, {"error": "Envie o conteúdo do arquivo CSV"})
            try:
                criados, rejeitados = importar_csv(csv_texto)
            except ValueError as e:
                return self.send_json(400, {"error": str(e)})
            print("[importacao] %d lead(s) criados, %d rejeitados" % (criados, len(rejeitados)))
            return self.send_json(200, {"criados": criados, "rejeitados": rejeitados})

        # ---- Visitas de campo de um lead ----
        mv = re.match(r"^/api/leads/([^/]+)/visitas(?:/([^/]+))?$", path)
        if mv:
            lead_id, visita_id = mv.group(1), mv.group(2)
            if method == "POST" and not visita_id:
                try:
                    body = self.read_body()
                except Exception:
                    return self.send_json(400, {"error": "Corpo invalido"})
                resultado = str(body.get("resultado") or "").strip()
                if resultado and resultado not in RESULTADOS_VISITA:
                    return self.send_json(400, {"error": "Resultado de visita inválido"})
                # GPS obrigatorio: toda visita tem que registrar a localizacao
                try:
                    la, lo = float(body.get("lat")), float(body.get("lng"))
                except (TypeError, ValueError):
                    return self.send_json(400, {"error": "É obrigatório registrar a localização (GPS) da visita — permita o acesso à localização"})
                if not (math.isfinite(la) and math.isfinite(lo) and abs(la) <= 90 and abs(lo) <= 180) \
                        or (abs(la) < 0.0001 and abs(lo) < 0.0001):  # 0,0 = leitura invalida
                    return self.send_json(400, {"error": "Localização (GPS) inválida"})
                la, lo = round(la, 6), round(lo, 6)
                try:
                    acc = float(body.get("acc"))  # precisao em metros (se enviada)
                except (TypeError, ValueError):
                    acc = None
                op_id = str(body.get("op_id") or "").strip()[:64]
                vid = new_id()
                with _lock:
                    lead = next((l for l in _db["leads"] if l["id"] == lead_id), None)
                    if not lead or not pode_ver_lead(user, lead):
                        return self.send_json(404, {"error": "Lead nao encontrado"})
                    # idempotencia: visita registrada offline pode ser reenviada — se
                    # o op_id ja existe, devolve a visita existente (nao duplica foto).
                    if op_id:
                        ja = next((v for v in lead.get("visitas", []) if v.get("op_id") == op_id), None)
                        if ja:
                            return self.send_json(201, {"visita": ja, "total": len(lead["visitas"])})
                    # foto so e gravada em disco APOS confirmar o lead (evita arquivo orfao)
                    try:
                        foto = salva_foto_visita(body.get("foto"), vid)
                    except ValueError as e:
                        return self.send_json(400, {"error": str(e)})
                    quando = ts_offline(body.get("criado_em"))  # hora da visita (offline) ou agora
                    visita = {
                        "id": vid,
                        "data": quando,
                        "visitante": user["nome"],
                        "resultado": resultado,
                        "obs": str(body.get("obs") or "").strip()[:2000],
                        "foto": foto,
                        "lat": la, "lng": lo,
                    }
                    if op_id:
                        visita["op_id"] = op_id
                    lead.setdefault("visitas", []).append(visita)
                    # So atualiza a localizacao da fazenda se ela ainda nao foi
                    # ajustada, ou se a leitura for precisa (<=150 m). Assim uma
                    # posicao ruim (Wi-Fi/desktop) nao apaga um pino ja acertado.
                    sem_local = lead.get("lat") is None or lead.get("lng") is None
                    if sem_local or (acc is not None and acc <= 150):
                        lead["lat"], lead["lng"] = la, lo
                    registra_hist(lead, user["nome"], ["🚗 Visita registrada" + (": " + resultado if resultado else "")], papel=user["papel"], op_id=op_id or None, quando=quando)
                    lead["updated_at"] = now_iso()
                    save_db()
                    return self.send_json(201, {"visita": visita, "total": len(lead["visitas"])})

            if method == "DELETE" and visita_id:
                with _lock:
                    lead = next((l for l in _db["leads"] if l["id"] == lead_id), None)
                    if not lead or not pode_ver_lead(user, lead):
                        return self.send_json(404, {"error": "Lead nao encontrado"})
                    v = next((x for x in lead.get("visitas", []) if x["id"] == visita_id), None)
                    if not v:
                        return self.send_json(404, {"error": "Visita nao encontrada"})
                    if not gestor and v.get("visitante") != user["nome"]:
                        return self.send_json(403, {"error": "Só quem registrou (ou um gestor) pode excluir a visita"})
                    if v.get("foto"):
                        try:
                            os.remove(os.path.join(FOTOS_DIR, v["foto"]))
                        except OSError:
                            pass
                    lead["visitas"] = [x for x in lead["visitas"] if x["id"] != visita_id]
                    save_db()
                    return self.send_json(200, {"ok": True, "total": len(lead["visitas"])})

        # ---- Nota manual na linha do tempo (vendedor/gerente escrevem updates) ----
        mn = re.match(r"^/api/leads/([^/]+)/notas$", path)
        if mn and method == "POST":
            lead_id = mn.group(1)
            try:
                body = self.read_body()
            except Exception:
                return self.send_json(400, {"error": "Corpo invalido"})
            texto = str(body.get("texto") or "").strip()[:2000]
            if not texto:
                return self.send_json(400, {"error": "Escreva a atualização antes de salvar"})
            op_id = str(body.get("op_id") or "").strip()[:64]
            with _lock:
                lead = next((l for l in _db["leads"] if l["id"] == lead_id), None)
                if not lead or not pode_ver_lead(user, lead):
                    return self.send_json(404, {"error": "Lead nao encontrado"})
                # idempotencia: nota registrada offline pode ser reenviada — se o
                # op_id ja existe, devolve a entrada existente sem duplicar.
                if op_id:
                    ja = next((h for h in lead.get("historico", []) if h.get("op_id") == op_id), None)
                    if ja:
                        return self.send_json(201, {"entrada": ja,
                                                    "aguardando_resposta": lead.get("aguardando_resposta")})
                registra_hist(lead, user["nome"], ["💬 " + texto], papel=user["papel"], tipo="nota", op_id=op_id or None, quando=ts_offline(body.get("criado_em")))
                # A atualizacao escrita E o registro da resposta: some o alerta.
                lead["aguardando_resposta"] = None
                lead["updated_at"] = now_iso()
                save_db()
                return self.send_json(201, {"entrada": lead["historico"][-1],
                                            "aguardando_resposta": lead["aguardando_resposta"]})

        # Contato por WhatsApp: marca "aguardando o vendedor registrar a resposta"
        # e anota no historico. O alerta some quando alguem escreve uma nota.
        mc = re.match(r"^/api/leads/([^/]+)/contato-whatsapp$", path)
        if mc and method == "POST":
            lead_id = mc.group(1)
            with _lock:
                lead = next((l for l in _db["leads"] if l["id"] == lead_id), None)
                if not lead or not pode_ver_lead(user, lead):
                    return self.send_json(404, {"error": "Lead nao encontrado"})
                # Lead encerrado nao gera cobranca de registro.
                if lead.get("status") in ("ganho", "perdido", "desistiu", "curioso"):
                    return self.send_json(200, {"lead": lead})
                ja_pendente = bool(lead.get("aguardando_resposta"))
                ultimo = lead["historico"][-1] if lead.get("historico") else None
                # Anota o contato — menos em cliques repetidos (ja aguardando E a
                # ultima entrada ja foi um contato), para nao poluir o historico.
                if not (ja_pendente and ultimo and ultimo.get("tipo") == "contato"):
                    registra_hist(lead, user["nome"], ["📱 Contato por WhatsApp"],
                                  papel=user["papel"], tipo="contato")
                    lead["updated_at"] = now_iso()
                # So carimba o horario no PRIMEIRO contato sem resposta registrada:
                # reabrir a conversa nao pode zerar o cronometro (senao nunca fica
                # vermelho). O relogio conta desde o contato que ainda espera nota.
                if not ja_pendente:
                    lead["aguardando_resposta"] = now_iso()
                save_db()
                return self.send_json(200, {"lead": lead})

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
                # SDR cadastra para si; vendedor cadastra ja no proprio funil
                if user["papel"] == "sdr":
                    lead["sdr"] = user["nome"]
                    lead["responsavel"] = user["nome"]
                elif user["papel"] == "vendedor":
                    lead["vendedor"] = user["nome"]
                    lead["responsavel"] = user["nome"]
                    lead["atendido_em"] = now_iso()
                    if lead.get("status") not in VENDAS_STATUSES:
                        lead["status"] = "qualificado"
                        if not lead.get("tipo"):
                            lead["tipo"] = "produtor"
                        lead["qualificado_em"] = now_iso()
                if not str(lead.get("telefone") or "").strip() or not str(lead.get("email") or "").strip():
                    return self.send_json(400, {"error": "Telefone e e-mail são obrigatórios"})
                dup, campo = find_duplicado(lead["telefone"], lead["email"])
                if dup:
                    return self.send_json(400, {"error": "Já existe um lead com esse %s: %s" % (
                        campo, dup.get("nome") or dup.get("telefone") or "(sem nome)")})
                registra_hist(lead, user["nome"], ["🆕 Lead criado (cadastro manual)"], papel=user["papel"], tipo="novo")
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
                if not lead or not pode_ver_lead(user, lead):
                    # invisivel para este papel = como se nao existisse
                    return self.send_json(404, {"error": "Lead nao encontrado"})
                if method in ("PATCH", "PUT"):
                    # Regras por papel: cada um so mexe no que e seu
                    if user["papel"] == "sdr" and "sdr" in body and body["sdr"] != user["nome"]:
                        return self.send_json(403, {"error": "SDR não pode transferir o lead para outro SDR"})
                    if user["papel"] == "vendedor" and "vendedor" in body and body["vendedor"] not in ("", user["nome"]):
                        return self.send_json(403, {"error": "Vendedor só pode assumir o lead para si"})
                    # aplica numa copia: se uma regra barrar no meio, o lead
                    # original nao fica meio-editado na memoria
                    tentativa = dict(lead)
                    try:
                        apply_updates(tentativa, body)
                    except ValueError as e:
                        return self.send_json(400, {"error": str(e)})
                    if "telefone" in body or "email" in body:
                        # checa SO o campo alterado: um duplicado pre-existente
                        # no OUTRO campo nao pode travar esta edicao
                        dup, campo = find_duplicado(
                            tentativa.get("telefone") if "telefone" in body else None,
                            tentativa.get("email") if "email" in body else None,
                            exclude_id=lead["id"])
                        if dup:
                            return self.send_json(400, {"error": "Outro lead já usa esse %s: %s" % (
                                campo, dup.get("nome") or dup.get("telefone") or "(sem nome)")})
                    # registra no historico o que mudou (antes de sobrescrever)
                    itens = descreve_mudancas(lead, tentativa, list(body.keys()))
                    lead.update(tentativa)
                    registra_hist(lead, user["nome"], itens, papel=user["papel"])
                    save_db()
                    return self.send_json(200, {"lead": lead})
                if method == "DELETE":
                    if not gestor:
                        return self.send_json(403, {"error": "Só gerente/administrador pode excluir leads"})
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
    senha_admin = ensure_admin()
    ensure_webhook_token()
    httpd = ThreadingHTTPServer(("0.0.0.0", PORT), Handler)
    print("")
    print("  CRM Nova Era Drones rodando")
    if senha_admin:
        print("  -----------------------------------------------")
        print("  PRIMEIRO ACESSO -> login: admin | senha: %s" % senha_admin)
        print("  (troque a senha no painel de Usuarios)")
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
