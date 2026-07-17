# Imagem enxuta com Python (o servidor nao precisa de nenhuma dependencia extra)
FROM python:3.11-slim

WORKDIR /app
COPY . .

# Porta e pasta de dados (a pasta /data deve ser um volume persistente)
ENV PORT=3000
ENV DATA_DIR=/data

EXPOSE 3000

# Cria a pasta de dados caso o volume ainda nao exista e sobe o servidor
CMD ["sh", "-c", "mkdir -p \"$DATA_DIR\" && python3 server.py"]
