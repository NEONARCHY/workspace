FROM python:3.11-slim-bookworm

ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 HOME=/tmp
RUN apt-get update && apt-get install -y --no-install-recommends \
    libreoffice-writer fonts-crosextra-carlito fonts-crosextra-caladea \
    fonts-liberation2 fonts-dejavu-core fonts-noto-core \
    && apt-get clean && rm -rf /var/lib/apt/lists/* \
    && useradd --system --uid 10001 --home-dir /tmp preview \
    && mkdir -p /run/office-preview && chown preview /run/office-preview
WORKDIR /app
COPY services/office-preview/server.py /app/server.py
USER preview
CMD ["python", "/app/server.py"]
