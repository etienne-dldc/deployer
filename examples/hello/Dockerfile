# Deploy code for the `hello` service.
#
# This is the image the controller builds from the committed tar and runs once
# per apply. The deploy code talks to the controller through the SDK only.
FROM deployer-runner-base:dev

WORKDIR /app

COPY package.json ./

# Until @dldc/deployer-sdk is published, the base image carries the staged SDK
# built from this repository at /opt/deployer-sdk.
RUN pnpm add file:/opt/deployer-sdk

COPY index.js ./

CMD ["node", "index.js"]
