# 🌱 CRM Agro — Leads do Chatwoot

CRM para organizar os leads de produtores rurais que chegam no seu **Chatwoot**
vindos de **tráfego pago** (Meta, Google, etc). Quadro em **raias (swimlanes)** por
pessoa, com fluxo **SDR → Vendedor**: o lead novo cai por rodízio num SDR, que faz
o primeiro contato e classifica se é **produtor rural** (foco) ou **prestador de
serviço**; os produtores seguem para um vendedor. Cada card traz região do
produtor, área cultivada, produto, valor e origem do anúncio (UTM).

Não precisa instalar nada além do que você já tem: roda com **Python 3**
(já vem no seu Mac). Os dados ficam num arquivo local (`data/leads.json`).

---

## 1. Como iniciar

**Jeito fácil (duplo-clique):**
- Abra a pasta `chatwoot-crm` no Finder e dê **duplo-clique em `iniciar.command`**.
  (Na primeira vez, se o macOS bloquear, clique com o **botão direito → Abrir**.)
- O painel abre sozinho em `http://localhost:3000`.

**Pelo terminal:**
```bash
cd ~/chatwoot-crm
python3 server.py
```
Depois abra `http://localhost:3000` no navegador.

Para **parar**, feche a janela do terminal ou aperte `Ctrl + C`.

---

## 2. Usando o painel

**Primeiro passo — cadastre a equipe:** clique em **👥 Equipe** e adicione seus
**SDRs** e **vendedores**. Os leads novos do Chatwoot são distribuídos
automaticamente entre os SDRs ativos, em **rodízio** (um para cada, na sequência).

- **Raias (linhas)** = cada SDR/vendedor tem sua faixa com o próprio mini-funil.
  O rótulo à esquerda mostra quantos leads, quantos ganhos e o valor em aberto.
- **Colunas** = etapas: Novo (SDR) → Em triagem (SDR) → Produtor rural →
  Em negociação → Proposta enviada → Fechado (ganho) → Perdido, e a coluna
  separada **Prestador / fora do perfil**.
- **Arraste um card** para outra célula: ao soltar na raia de um **vendedor** na
  coluna **Produtor rural**, o lead é qualificado como produtor **e** reatribuído
  ao vendedor de uma vez só.
- **Clique num card** para classificar (produtor/prestador), definir SDR e
  vendedor, mudar a etapa e editar todos os dados.
- **Filtro por raia** no topo mostra só uma pessoa (útil para cobrar cada um).
- **+ Novo lead** cadastra manualmente; **busca** e **filtro por canal** no topo.
- O painel **atualiza sozinho a cada 15s** — leads novos do Chatwoot aparecem
  sem precisar recarregar.

---

## 3. Conectar o Chatwoot (leads automáticos)

O CRM recebe os leads por **webhook**. Quando o servidor inicia, ele mostra no
terminal a URL do webhook com seu token, algo como:

```
Webhook:  http://localhost:3000/webhook/chatwoot?token=SEU_TOKEN
```

> Defina um token só seu editando `WEBHOOK_TOKEN` no arquivo `iniciar.command`.

No Chatwoot:
1. Vá em **Configurações → Integrações → Webhooks → Adicionar novo webhook**.
2. Cole a URL do webhook (com o `?token=...`).
3. Marque os eventos: **Conversation Created**, **Message Created** e
   (opcional) **Contact Updated**.
4. Salve.

Pronto: cada nova conversa vira um lead na coluna **Novo (SDR)**, já na raia de
um SDR escolhido por rodízio.

### De onde vêm os dados do anúncio (UTM)
O CRM tenta identificar o canal (Meta/Google/…) e a campanha a partir de:
- o **referer** da conversa (URL da sua landing page com `?utm_source=...&utm_campaign=...`);
- **atributos personalizados** da conversa/contato no Chatwoot (`utm_source`,
  `regiao`, `area_cultivada`, `produto`, etc).

👉 Dica: mande o tráfego pago para uma landing com UTMs na URL, e configure o
widget do Chatwoot para capturar o referer. Assim o canal já vem preenchido.

---

## 4. Importante: rodar 24h (produção)

Rodando no seu Mac, o webhook só funciona **enquanto o computador está ligado e o
servidor aberto** — e o Chatwoot precisa alcançar seu computador pela internet.
Duas formas de resolver:

**A) Túnel temporário (para testar):** exponha o `localhost:3000` com um túnel,
por exemplo o Cloudflare Tunnel:
```bash
# instala uma vez (precisa de internet); depois:
cloudflared tunnel --url http://localhost:3000
```
Ele te dá uma URL pública `https://...trycloudflare.com` — use ela no webhook do
Chatwoot (mantendo o `/webhook/chatwoot?token=...`).

**B) Hospedar na nuvem (recomendado para uso de verdade):** suba numa hospedagem
que fica sempre no ar. O projeto já vem com **`Dockerfile`** e
**`docker-compose.yml`** prontos, e o passo a passo completo está no
**`DEPLOY.md`** (inclui como publicar no mesmo servidor do seu Chatwoot, num
subdomínio `crm.seudominio.com.br`).

---

## 5. Backup dos leads

Todos os leads ficam em **`data/leads.json`**. Para fazer backup, é só copiar
esse arquivo. Para começar do zero, apague-o (o servidor cria de novo, vazio).

---

## Estrutura do projeto
```
chatwoot-crm/
├── server.py            ← servidor (Python, sem dependências)
├── iniciar.command      ← duplo-clique para iniciar no Mac
├── Dockerfile           ← para hospedar na nuvem / no servidor do Chatwoot
├── docker-compose.yml   ← sobe tudo com um comando (volume persistente)
├── DEPLOY.md            ← passo a passo para publicar em produção
├── data/leads.json      ← seu banco de leads e equipe (criado ao rodar)
└── public/              ← a interface (swimlanes)
    ├── index.html
    ├── styles.css
    └── app.js
```
