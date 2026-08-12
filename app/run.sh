#!/usr/bin/with-contenv bashio
# shellcheck shell=bash
# Reads the app options, resolves the MQTT broker, and hands over to Node.
# Restart and retry behaviour lives in the Node poll loop, not here.
set -euo pipefail

declare login_host
declare mqtt_url

mqtt_url=$(bashio::config 'mqtt_url')

if [[ "${mqtt_url}" == *"auto_hostname"* ]]; then
    if ! bashio::services.available 'mqtt'; then
        bashio::exit.nok \
            "No MQTT service is available. Install and start the Mosquitto broker app, or set the mqtt_url option to your own broker."
    fi

    MQTT_HOST=$(bashio::services mqtt 'host')
    MQTT_PORT=$(bashio::services mqtt 'port')
    MQTT_USERNAME=$(bashio::services mqtt 'username')
    MQTT_PASSWORD=$(bashio::services mqtt 'password')
    MQTT_PROTOCOL='mqtt'
    if bashio::var.true "$(bashio::services mqtt 'ssl')"; then
        MQTT_PROTOCOL='mqtts'
    fi
    export MQTT_HOST MQTT_PASSWORD MQTT_PORT MQTT_PROTOCOL MQTT_USERNAME
    bashio::log.info "Using the Home Assistant MQTT service at ${MQTT_HOST}:${MQTT_PORT}"
else
    export MQTT_URL="${mqtt_url}"
    bashio::log.info "Using the MQTT broker from the mqtt_url option"
fi

login_host=""
if bashio::config.has_value 'login_host'; then
    login_host=$(bashio::config 'login_host')
    bashio::log.info "Using the configured login host ${login_host}"
else
    if ! login_host=$(bashio::network 'network.info.primary_ipv4' \
        '[.interfaces[]? | select(.primary == true) | .ipv4.address[0] // empty] | first // ""'); then
        login_host=""
    fi
    login_host="${login_host%%/*}"

    if ! bashio::var.has_value "${login_host}"; then
        login_host="$(bashio::info.hostname).local"
    fi
fi

bashio::log.info "Amazon login proxy will advertise http://${login_host}:8098/"

export ALEXA_AUTH_PATH='/data/auth.json'
export ALEXA_CAPTURE_FIXTURES='false'
export ALEXA_DATA_DIR='/data'
export ALEXA_DEBUG="$(bashio::config 'debug')"
export ALEXA_ONCE='false'
export ALEXA_PROXY_HOST="${login_host}"
export ALEXA_PROXY_PORT='8098'
export ALEXA_STATE_PATH='/data/last-state.json'
export AMAZON_DOMAIN="$(bashio::config 'amazon_domain')"
export MQTT_TOPIC_PREFIX="$(bashio::config 'mqtt_topic_prefix')"
export POLL_INTERVAL="$(bashio::config 'poll_interval')"
export STATUS_PORT='8099'

exec node /app/dist/index.js
