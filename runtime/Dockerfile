# Supply approved base image digests at build time. Runtime accepts only local sha256 IDs.
ARG NODE_IMAGE
ARG OLLAMA_IMAGE
FROM ${NODE_IMAGE} AS worker
WORKDIR /app
COPY runtime/worker.mjs runtime/probe.mjs /app/
USER 65532:65532
ENTRYPOINT ["node", "/app/worker.mjs", "idle"]

FROM ${NODE_IMAGE} AS node-runtime
FROM ${OLLAMA_IMAGE} AS model
# Node official Debian and Ollama Ubuntu bases must be ABI-compatible; see the runbook.
COPY --from=node-runtime /usr/local/bin/node /usr/local/bin/node
COPY runtime/bridge.mjs runtime/probe.mjs /app/
RUN ["/usr/local/bin/node", "--version"]
USER 65532:65532
ENV HOME=/tmp OLLAMA_HOST=127.0.0.1:11434 OLLAMA_MODELS=/models OLLAMA_NO_CLOUD=1
ENTRYPOINT ["/bin/ollama", "serve"]
