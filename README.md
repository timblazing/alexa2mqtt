<img src="app/logo.png" alt="" width="250" height="150">

# Alexa2MQTT

A Home Assistant App (add-on) that connects **Amazon Smart Air Quality Monitors** to Home Assistant via **MQTT**.

## Quick Start

[![Open your Home Assistant instance and show the add app repository dialog with a specific repository URL pre-filled.](https://my.home-assistant.io/badges/supervisor_add_addon_repository.svg)](https://my.home-assistant.io/redirect/supervisor_add_addon_repository/?repository_url=https%3A%2F%2Fgithub.com%2Ftimblazing%2Falexa2mqtt)

1. **Settings → Apps → Install App → ⋮ (Menu) > Repositories** and add this repository's URL: `https://github.com/timblazing/alexa2mqtt`, and reload.
2. Install **Alexa2MQTT** and start it.
3. Open the Web UI and follow the Amazon login link on port 8098 of the Home Assistant host.

Full app documentation lives in [`app/DOCS.md`](app/DOCS.md).

## What it will do

- Authenticate with your Amazon account using the same proxy-login flow as
  [homebridge-alexa-smarthome](https://github.com/joeyhage/homebridge-alexa-smarthome)
  (no password stored in the app config).
- Discover your Amazon Smart Air Quality Monitor(s) and poll Alexa's API for raw values:
  IAQ score (0–100), temperature, humidity, PM2.5, PM10, CO (ppm), and VOC index.
- Publish one Home Assistant MQTT device per monitor using MQTT device discovery, with
  retained last-known values that survive Amazon outages and restarts.
- Run as a proper Home Assistant App: start on boot, watchdog, and auto-update via
  versioned GHCR images.

## Roadmap

- Support the other device types on the Alexa account, not just air-quality monitors:
  lightbulbs, switches, fans, outlets and smart plugs, thermostats, and locks. These need
  MQTT commands going the other way (turn on, set brightness, set target temperature,
  lock/unlock), where today the bridge only reads.
- An auth reset control, so a fresh Amazon sign-in does not mean reinstalling the app.

## Attribution

Alexa authentication and query logic is adapted from
[joeyhage/homebridge-alexa-smarthome](https://github.com/joeyhage/homebridge-alexa-smarthome) (MIT),
built on [alexa-remote2](https://github.com/Apollon77/alexa-remote) and
[alexa-cookie2](https://github.com/Apollon77/alexa-cookie).
Packaging follows [home-assistant/apps-example](https://github.com/home-assistant/apps-example).

## License

[MIT](LICENSE)
