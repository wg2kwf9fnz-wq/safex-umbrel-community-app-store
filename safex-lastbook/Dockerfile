FROM python:3.12-slim-bookworm

ARG LASTBOOK_COMMIT=83f2ca99609f3d420c2bf25bfdae2cedbdaaafae

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl libzstd1 poppler-utils \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /opt/lastbook

# Pin the upstream source to a reviewed commit rather than tracking a moving branch.
RUN curl -fsSL "https://github.com/Immortal-Protocols/lastbook/archive/${LASTBOOK_COMMIT}.tar.gz" \
    | tar -xz --strip-components=1 -C /opt/lastbook

# Runtime dependencies used by Lastbook's browser library server.
RUN python -m pip install --no-cache-dir \
    libzim==3.13.1 \
    numpy==2.4.6 \
    beautifulsoup4==4.15.0 \
    pypdfium2==5.14.0

COPY umbrel_server.py /opt/lastbook/umbrel_server.py
COPY umbrel.js /opt/lastbook/web/umbrel.js

# Use Lastbook's own first-run pack installer in the browser, but do not offer
# the desktop-only local-AI model in this server image.
RUN python - <<'PY'
from pathlib import Path
page = Path("/opt/lastbook/web/setup.html")
html = page.read_text(encoding="utf-8")
needle = '<script src="/ui/setup.js?v=4"></script>'
if needle not in html:
    raise SystemExit("Could not find the expected Lastbook setup script tag")
page.write_text(html.replace(needle, '<script src="/ui/umbrel.js"></script>\\n' + needle), encoding="utf-8")

js = Path("/opt/lastbook/web/setup.js")
source = js.read_text(encoding="utf-8")
needle = "const model = () => ((S.manifest && S.manifest.models) || [])[0] || null;"
if needle not in source:
    raise SystemExit("Could not find the expected Lastbook model selector")
js.write_text(source.replace(needle, "const model = () => null;"), encoding="utf-8")
PY

EXPOSE 8890

ENTRYPOINT ["python", "/opt/lastbook/umbrel_server.py", "--port", "8890"]
