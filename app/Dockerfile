# Supervisor passes BUILD_ARCH; the base tag stays pinned so a rebuild never
# silently moves to a new Alpine release.
ARG BUILD_ARCH=amd64

FROM node:22-alpine AS builder
WORKDIR /build
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev

FROM ghcr.io/home-assistant/${BUILD_ARCH}-base:3.21

RUN apk add --no-cache nodejs

WORKDIR /app
COPY --from=builder /build/dist ./dist
COPY --from=builder /build/node_modules ./node_modules
COPY package.json ./
COPY run.sh /run.sh
RUN chmod 0755 /run.sh

ARG BUILD_ARCH
ARG BUILD_DESCRIPTION="Amazon Smart Air Quality Monitor to Home Assistant via MQTT"
ARG BUILD_NAME="Alexa2MQTT"
ARG BUILD_REF=unknown
ARG BUILD_REPOSITORY=timblazing/alexa2mqtt
ARG BUILD_VERSION=0.1.0

LABEL \
  io.hass.name="${BUILD_NAME}" \
  io.hass.description="${BUILD_DESCRIPTION}" \
  io.hass.arch="${BUILD_ARCH}" \
  io.hass.type="addon" \
  io.hass.version="${BUILD_VERSION}" \
  org.opencontainers.image.source="https://github.com/${BUILD_REPOSITORY}" \
  org.opencontainers.image.revision="${BUILD_REF}" \
  org.opencontainers.image.version="${BUILD_VERSION}"

CMD ["/run.sh"]
