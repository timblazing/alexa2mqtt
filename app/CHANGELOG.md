# Changelog

## 0.3.0

First published release. Images now come from GitHub Container Registry instead
of being built by Supervisor.

- Adds the versioned `image:` key, so **Auto update** works. Installing no longer
  waits several minutes for a local build.
- Publishes `ghcr.io/timblazing/alexa2mqtt-amd64` and
  `ghcr.io/timblazing/alexa2mqtt-aarch64` from a `v*` tag, after checking that the
  tag matches the version in `config.yaml`.
- New app icon and logo.

## 0.2.0

Renamed from *Amazon Air Quality to MQTT* to **Alexa2MQTT**. Both identifiers
that Home Assistant keys off of changed, so this release is a clean reinstall
rather than an update:

- App slug is now `alexa2mqtt` (was `amazon_air_quality_mqtt`). Supervisor treats
  it as a new app: uninstall the old one, then install this one and sign in to
  Amazon again.
- Default `mqtt_topic_prefix` is now `alexa2mqtt` (was `amazon_air_quality`).
  Entities are re-created under the new topics; delete the stale MQTT device in
  Home Assistant afterwards. Set the option back to `amazon_air_quality` to keep
  the old topics.
- New app icon and logo.

## 0.1.1

- Adds a PM10 sensor. The monitor reports `Particulate matter PM10` alongside
  `Particulate matter`, but only the latter was mapped, so PM10 was discarded.
  PM2.5 readings were never affected.

## 0.1.0

First packaged release. Not published to a registry yet — Supervisor builds the
app locally from the Dockerfile.

- Bridges every Amazon Smart Air Quality Monitor on the account to Home Assistant
  over MQTT device discovery: IAQ score, temperature, humidity, PM2.5, CO level,
  CO detected, VOC index, last update, and two connectivity diagnostics.
- Signs in to Amazon through the login proxy on port 8098; authentication is
  stored in `/data/auth.json` and survives restarts.
- Keeps the last known readings in `/data/last-state.json`. Amazon outages and
  restarts never blank out a measurement.
- Resolves broker credentials from the Home Assistant MQTT service by default;
  `mqtt_url` can point at an external broker instead.
- Ingress status page with a `/healthz` endpoint for the watchdog.
