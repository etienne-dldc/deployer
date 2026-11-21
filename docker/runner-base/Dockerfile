# Runner image for deploy packages.
#
# It carries Node and the harness only: the package is mounted read-only at
# /deploy, and nothing is installed at deploy time. Rebuild it with
# `pnpm base:build` whenever the harness changes.
FROM node:26-slim

COPY dist/harness /opt/deployer

# The run container starts with User 1000:1000 and WorkingDir /deploy; the
# controller passes both, so nothing is declared here.
CMD ["node", "--enable-source-maps", "/opt/deployer/harness.mjs"]
