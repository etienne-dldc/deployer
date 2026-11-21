# Deploy code for the `hello` service.
#
# This is the image the controller builds from the committed tar and runs once
# per apply. The deploy code talks to the controller through the SDK only.
FROM deployer-runner-base:dev

WORKDIR /app

COPY package.json ./

# The SDK is a normal npm dependency, like in any other deploy repo.
RUN pnpm add @dldc/deployer-sdk@^0.1.1

COPY index.js ./

CMD ["node", "index.js"]
