# managed by glass-factory kit v1.2.0 (8b5ada6), do not edit; change factory/evidence.config.sh or factory/evidence/tests/
FROM mcr.microsoft.com/playwright:v1.65.1-noble

RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json ./
RUN npm install
COPY playwright.config.mjs ./
COPY tests ./tests
COPY scripts ./scripts
RUN chmod -R a+rX /app
ENV HOME=/tmp
USER pwuser
CMD ["sh", "-c", "npx playwright test; E2E_STATUS=$?; node scripts/generate-report.mjs; GEN_STATUS=$?; node scripts/quality-gate.mjs; GATE_STATUS=$?; if [ $E2E_STATUS -ne 0 ]; then exit $E2E_STATUS; fi; if [ $GEN_STATUS -ne 0 ]; then exit $GEN_STATUS; fi; if [ $GATE_STATUS -ne 0 ]; then exit $GATE_STATUS; fi; head -n 1 \"${EVIDENCE_OUT:-/artifacts}/EVIDENCE.md\" | grep -qx '# Level 1 Evidence Report – PASS'"]
