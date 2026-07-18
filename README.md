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

## 2. Login e níveis de acesso

O CRM exige **login e senha**. No primeiro boot é criado o usuário
**admin / novaera123** (o terminal mostra) — troque a senha em **👥 Usuários**.

| Nível | O que enxerga / pode fazer |
|---|---|
| **SDR** | Só os leads dele (funil SDR); cadastra leads para si |
| **Vendedor** | Só o funil de Vendas: leads dele + "Sem responsável" (para assumir) |
| **Gerente** | Tudo: funis, mapa, campanhas, importação, relatórios |
| **Administrador** | Tudo + cria usuários, define senhas e níveis de acesso |

O webhook do Chatwoot não usa login (continua protegido pelo token na URL).

## 3. Usando o painel

**Primeiro passo — cadastre a equipe:** clique em **👥 Equipe** e adicione seus
**SDRs** e **vendedores**. Os leads novos do Chatwoot são distribuídos
automaticamente entre os SDRs ativos, em **rodízio** (um para cada, na sequência).

São **três funis em abas** (mais o Mapa), cada um com raias por pessoa:

- **📞 Funil SDR** (raias = SDRs): `Novo lead → Em triagem`, e as colunas de
  qualificação **🌾 → Produtores** e **🔧 → Prestadores** (arrastar para lá
  qualifica o lead **e** o envia para a aba do tipo), mais **Perdido na triagem**.
- **🌾 Produtores** e **🔧 Prestadores** (raias = vendedores): funis de venda
  idênticos, mas separados — `📥 Recebido do SDR → Em negociação → Proposta
  enviada → 🏆 Ganho` e **🚩 Perdido**. Leads qualificados chegam em "Sem
  responsável"; o vendedor arrasta para a própria raia para assumir.
- **Bandeiras:** cards e pinos de negócios **ganhos** ficam com bandeira 🟢 e
  os **perdidos** com 🔴 — para resgatar oportunidades depois.
- **📊 Relatório** (gerente/admin): quantos leads chegaram por dia (e quantos
  vieram do Chatwoot) × quantos foram qualificados, com download em CSV.
- **Clique num card** para classificar (produtor/prestador), definir SDR e
  vendedor, mudar a etapa e editar todos os dados.
- **Anti-duplicado:** o sistema recusa cadastrar/editar um lead com telefone ou
  e-mail que já existe (compara ignorando formatação, +55/DDD e o 9º dígito do
  celular). Cliente conhecido que abre conversa nova no Chatwoot **não vira
  lead duplicado** — o CRM reconhece pelo contato/telefone e, se ele estava
  "perdido", volta para a triagem.
- **⬆️ Importar:** botão no topo para importação em massa via planilha **CSV**
  (baixe o modelo no próprio painel). Linhas duplicadas ou sem telefone/e-mail
  são puladas e listadas no relatório da importação.
- **Padronização:** a Região usa a lista oficial de municípios do IBGE
  (autocompletar — digite e escolha; grafia é corrigida sozinha) e o Produto é
  lista fechada (T25P, T70P, T55, T100, Peças e Serviços).
- **Contato obrigatório:** cadastro manual exige telefone + e-mail, e nenhum
  lead entra em **Proposta/Ganho** sem os dois preenchidos (nota fiscal). Leads
  do webhook entram sem e-mail normalmente — o SDR completa na triagem.

### 🗺️ Aba Mapa (banco de localizações dos clientes)

A aba **Mapa** (ao lado dos funis) mostra cada lead como um pino:

- 🟠 **Aproximado** — o lead tem só a cidade preenchida; o pino fica no centro
  do município (coordenadas oficiais do IBGE, já embutidas).
- 🟢 **Fazenda exata** — a localização já foi ajustada para o ponto real.

Clique num pino para abrir o cartão com dois botões: **✏️ Editar lead** (abre a
ficha) e **📍 Ajustar local** (entra no modo de ajuste — então **clique no mapa**
onde fica a fazenda, ou arraste o pino, e a coordenada é salva). Pinos de
negócios ganhos aparecem com bandeira 🟢 e perdidos com 🔴. Com o tempo isso
forma o mapa real da sua carteira. O fundo é imagem de **satélite** (dá para ver
sede, barracão e pivô); há um botão no canto para alternar para o mapa de ruas.

> O mapa usa OpenStreetMap (gratuito) e precisa de internet para carregar o
> fundo; os pinos e coordenadas são todos locais.
- **Filtro por raia** no topo mostra só uma pessoa (útil para cobrar cada um).
- **+ Novo lead** cadastra manualmente; **busca** e **filtro por canal** no topo.
- O painel **atualiza sozinho a cada 15s** — leads novos do Chatwoot aparecem
  sem precisar recarregar.

### 📣 Campanhas (saber de onde veio cada lead)

Clique em **📣 Campanhas**, salve seu número de WhatsApp e cadastre cada campanha
de tráfego pago. Cada uma ganha um **código** (ex.: `#SOJA25`) e o CRM gera:

- **Link p/ anúncio** — um link de WhatsApp com mensagem pronta contendo o
  código. Use-o como destino do anúncio (Meta/Google): quando o lead manda a
  primeira mensagem, o CRM identifica a campanha na hora.
- **Landing (UTM)** — o sufixo de UTMs para colar na URL da sua landing page.

A atribuição é automática por 3 rotas (nesta ordem): dados do anúncio Meta
clique-pro-WhatsApp (título/id do anúncio, ctwa_clid), UTMs da landing, e
código `#…` ou palavra-chave na mensagem. O painel mostra o **resultado por
campanha** (leads, produtores, ganhos e R$) para você saber o que converte.

> Dica para anúncios Meta → WhatsApp: cadastre a campanha com uma
> **palavra-chave** que apareça no título do anúncio (ex.: "soja premium") —
> os leads desses anúncios vinculam sozinhos, sem precisar do código.

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
