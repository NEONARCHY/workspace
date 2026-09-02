FROM python:3.11-slim AS runtime

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /workspace

RUN groupadd --system yuksalish \
    && useradd --system --gid yuksalish --home-dir /workspace yuksalish

COPY pyproject.toml README.md ./
COPY apps ./apps
COPY modules ./modules

RUN python -m pip install --no-cache-dir . \
    && chown -R yuksalish:yuksalish /workspace

USER yuksalish

EXPOSE 8000

CMD ["uvicorn", "yuksalish_api.main:app", "--host", "0.0.0.0", "--port", "8000"]
