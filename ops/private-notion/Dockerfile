# G24: no build-time secrets and no dependencies beyond Node built-ins.
# The execution wrapper enforces --network none, a read-only filesystem,
# no extra capabilities, and a UID matching the owner of the private vault.
# Do not use this image for G23 live API reads.
FROM node:22-bookworm-slim
WORKDIR /app
COPY src/ /app/src/
ENTRYPOINT ["node", "/app/src/notion-private-offline-runner.mjs"]
