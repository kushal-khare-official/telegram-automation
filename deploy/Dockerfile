# Omulimu on Render (or any Docker host): n8n + the workflow exports + a start-up script that
# imports credentials/workflows from env vars and activates the bot on every boot.
FROM n8nio/n8n:1.123.84

COPY --chown=node:node workflows /opt/omulimu/workflows
COPY --chown=node:node deploy/*.sh deploy/*.js /opt/omulimu/

ENV GENERIC_TIMEZONE=Africa/Kampala \
    TZ=Africa/Kampala \
    N8N_PORT=10000 \
    N8N_PROTOCOL=https \
    N8N_PROXY_HOPS=1 \
    N8N_BLOCK_ENV_ACCESS_IN_NODE=false \
    N8N_RUNNERS_ENABLED=true \
    DB_POSTGRESDB_POOL_SIZE=3 \
    DB_POSTGRESDB_CONNECTION_TIMEOUT=30000 \
    N8N_DIAGNOSTICS_ENABLED=false \
    N8N_PERSONALIZATION_ENABLED=false \
    N8N_ENFORCE_SETTINGS_FILE_PERMISSIONS=true \
    EXECUTIONS_DATA_PRUNE=true \
    EXECUTIONS_DATA_MAX_AGE=336 \
    LLM_BASE_URL=https://openrouter.ai/api/v1 \
    LLM_MODEL=openai/gpt-4o-mini

EXPOSE 10000
ENTRYPOINT ["tini", "--", "/bin/sh", "/opt/omulimu/entrypoint.sh"]
