# 🚀 Colocar o CRM no ar (integração automática com o Chatwoot)

Para o Chatwoot enviar os leads sozinho, o CRM precisa de um **endereço público
e fixo** na internet. Como o seu Chatwoot é próprio (self-hosted), o melhor
caminho é o **Caminho A**. Se preferir não mexer no servidor, use o **Caminho B**.

> Em qualquer caminho, escolha um **token secreto** (uma senha só sua) e use o
> mesmo token no deploy e na URL do webhook. Neste guia ele aparece como
> `SEU_TOKEN`.

---

## ✅ Caminho A — No mesmo servidor do Chatwoot (recomendado)

Vantagens: grátis (usa o servidor que você já tem), dados não se perdem, e fica
ao lado do Chatwoot. Se foi outra pessoa que instalou seu Chatwoot, envie este
guia para ela.

### 1. Copie o projeto para o servidor
No servidor (via SSH), por exemplo:
```bash
# opção 1: copiar do seu Mac
scp -r ~/chatwoot-crm  usuario@SEU_SERVIDOR:/opt/chatwoot-crm

# opção 2: se preferir, coloque num repositório Git e faça git clone
```

### 2. Defina o token e suba o container
```bash
cd /opt/chatwoot-crm
# edite o docker-compose.yml e troque WEBHOOK_TOKEN por SEU_TOKEN
docker compose up -d --build
```
Isso deixa o CRM rodando na porta **3000**, com os leads guardados no volume
`crm_dados` (não somem ao reiniciar).

### 3. Aponte um subdomínio para ele
- No seu DNS, crie um registro **A**: `crm.seudominio.com.br → IP do servidor`.
- No seu proxy reverso (o mesmo que já serve o Chatwoot com HTTPS):

**Se for Nginx**, adicione um server block:
```nginx
server {
    server_name crm.seudominio.com.br;
    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```
Depois rode o certbot para o HTTPS:
```bash
sudo certbot --nginx -d crm.seudominio.com.br
```

**Se for Caddy** (mais simples), uma linha no Caddyfile:
```
crm.seudominio.com.br {
    reverse_proxy 127.0.0.1:3000
}
```
(o Caddy cuida do HTTPS sozinho)

### 4. Pronto — endereço final do webhook
```
https://crm.seudominio.com.br/webhook/chatwoot?token=SEU_TOKEN
```
Vá para a seção **"Configurar o webhook no Chatwoot"** no fim deste arquivo.

---

## 🅱️ Caminho B — Numa hospedagem separada (Railway)

Se você não quiser mexer no servidor do Chatwoot. Requer uma conta (o plano
inicial da Railway é pago, ~US$5/mês; há alternativas como Fly.io).

1. Crie uma conta em **railway.app** e uma conta no **GitHub**.
2. Suba a pasta `chatwoot-crm` num repositório no GitHub.
3. Na Railway: **New Project → Deploy from GitHub repo** e escolha o repositório.
   A Railway detecta o `Dockerfile` automaticamente.
4. Em **Variables**, adicione: `WEBHOOK_TOKEN = SEU_TOKEN`.
5. Em **Volumes**, crie um volume montado em **`/data`** (para os leads não
   sumirem — passo importante!).
6. Em **Settings → Networking**, gere um domínio público. A Railway te dá algo
   como `https://seu-crm.up.railway.app`.
7. Endereço do webhook:
   ```
   https://seu-crm.up.railway.app/webhook/chatwoot?token=SEU_TOKEN
   ```

---

## 🔗 Configurar o webhook no Chatwoot (vale para A e B)

1. No Chatwoot, abra **Configurações → Integrações → Webhooks**.
2. Clique em **Adicionar novo webhook**.
3. Em **URL**, cole o endereço do seu webhook (com `?token=SEU_TOKEN`).
4. Marque os eventos:
   - ✅ **Conversation Created** (cria o lead)
   - ✅ **Message Created** (atualiza a última mensagem)
   - ✅ **Contact Updated** (opcional — atualiza dados do contato)
5. Salve.

Faça um teste: inicie uma conversa nova no seu canal. Em segundos ela deve
aparecer como um card na coluna **"Novo lead"** do CRM.

---

## 🎯 Fazer o canal/campanha (Meta, Google) aparecer preenchido

Para o CRM saber de qual anúncio veio o lead, o Chatwoot precisa receber essa
informação. Duas formas:

- **Pelo site (referer):** mande o tráfego pago para uma landing page com UTMs na
  URL, ex.: `...?utm_source=facebook&utm_medium=cpc&utm_campaign=soja_2526`, e
  use o **widget do Chatwoot** nessa página. O CRM lê o referer e preenche
  canal + campanha sozinho.
- **Por atributos personalizados:** se você usa formulário pré-chat ou automação,
  salve na conversa/contato os atributos `utm_source`, `utm_campaign`, `regiao`,
  `area_cultivada`, `produto`. O CRM aproveita todos eles.

Se algum lead vier sem essa info, é só abrir o card e preencher à mão.
