#!/bin/bash
# Duplo-clique neste arquivo para iniciar o CRM.
# (Na 1a vez, se o macOS bloquear, clique com o botao direito > Abrir.)

cd "$(dirname "$0")" || exit 1

# Fixe seu token do webhook aqui (troque por algo so seu):
export WEBHOOK_TOKEN="agro-leads-troque-este-token"
export PORT="3000"

# Abre o navegador no painel apos 1s
( sleep 1 && open "http://localhost:$PORT" ) &

echo "Iniciando o CRM Agro..."
python3 server.py
