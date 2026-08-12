# Changelog

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
