# MeTube Companion: web UI + nginx in front of a stock MeTube.
FROM nginx:1.29-alpine

ENV METUBE_URL=http://metube:8081 \
    RETENTION_DAYS=0 \
    TRASH_DAYS=7 \
    COMPANION_TOKEN= \
    COMPANION_HOSTS= \
    YOUTUBE_WATCH_URL=https://www.youtube.com/watch?v= \
    NGINX_ENTRYPOINT_LOCAL_RESOLVERS=1 \
    NGINX_ENTRYPOINT_QUIET_LOGS=1

COPY docker/nginx.conf /etc/nginx/nginx.conf
COPY nginx/default.conf.template /etc/nginx/templates/default.conf.template
COPY docker/05-check-token.sh /docker-entrypoint.d/05-check-token.sh
COPY docker/16-metube-upstream.envsh /docker-entrypoint.d/16-metube-upstream.envsh
COPY docker/17-companion-hosts.envsh /docker-entrypoint.d/17-companion-hosts.envsh
COPY docker/40-cleanup.sh /docker-entrypoint.d/40-cleanup.sh
COPY web/ /usr/share/nginx/html/

# Runs as any user (set "user:" in compose to the owner of the downloads, so
# deleting works). The entrypoint renders the template into conf.d.
RUN rm -f /etc/nginx/conf.d/default.conf /docker-entrypoint.d/10-listen-on-ipv6-by-default.sh \
 && chmod 1777 /etc/nginx/conf.d \
 && mkdir -p /downloads

EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s \
  CMD wget -q -O /dev/null http://127.0.0.1:8080/healthz || exit 1

LABEL org.opencontainers.image.title="MeTube Companion" \
      org.opencontainers.image.description="A friendlier web UI and browser extension for MeTube" \
      org.opencontainers.image.source="https://github.com/falkloewert/metube-companion" \
      org.opencontainers.image.licenses="MIT"
