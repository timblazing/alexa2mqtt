# Alexa2MQTT

Connects Amazon Smart Air Quality Monitors to Home Assistant over MQTT, without
Homebridge. The app polls Alexa's cloud API and publishes one MQTT device per
monitor using MQTT device discovery.

> This app uses Amazon's unofficial Alexa API. Amazon can change or break it at
> any time. Cloud-derived carbon monoxide readings are **not** a substitute for a
> certified local CO alarm.

## Installation

1. Install and start the **Mosquitto broker** app, and make sure the **MQTT**
   integration is set up in Home Assistant.
2. Install this app and press **Start**.
3. Open the **Log** tab. The app publishes cached state immediately and then
   waits for the Amazon sign-in.
4. Open the **Web UI** (status page). It links to the Amazon login proxy on port
   8098 of your Home Assistant host, for example `http://192.168.1.10:8098/`.
5. Sign in with your Amazon account in that tab. When the login completes, the
   app saves the session and starts polling — no restart needed.

The login proxy is only used while signing in. Authentication is stored in the
app's `/data` volume and refreshes itself every few days, so you normally sign in
once.

## Options

| Option              | Default                                            | Meaning                                                                     |
| ------------------- | -------------------------------------------------- | --------------------------------------------------------------------------- |
| `mqtt_url`          | `mqtt://auto_username:auto_password@auto_hostname` | Sentinel value: use the broker Home Assistant already knows about. Replace it with a full URL (`mqtt://user:pass@host:1883`, `mqtts://…`) to use an external broker. |
| `amazon_domain`     | `amazon.com`                                       | The Amazon site your account belongs to.                                     |
| `login_host`        | _(empty)_                                          | Host the Amazon login proxy advertises. Empty means the Home Assistant host's primary IPv4. Set it to the address you actually browse to (for example a Tailscale IP) when that differs. |
| `poll_interval`     | `60`                                               | Seconds between Alexa queries (15–900).                                      |
| `mqtt_topic_prefix` | `amazon_air_quality`                               | Prefix for the availability and state topics.                                |
| `debug`             | `false`                                            | Extra logging. Cookies, tokens and credentials are never logged.             |

## Entities

Each monitor appears as a single device with these entities:

| Entity           | Type          | Notes                                                    |
| ---------------- | ------------- | -------------------------------------------------------- |
| IAQ score        | sensor        | Amazon's raw 0–100 indoor air quality score               |
| Temperature      | sensor        | °C                                                        |
| Humidity         | sensor        | %                                                         |
| PM2.5            | sensor        | µg/m³                                                     |
| PM10             | sensor        | µg/m³                                                     |
| CO level         | sensor        | ppm                                                       |
| CO detected      | binary sensor | Derived: CO level above 10 ppm                            |
| VOC index        | sensor        | An index, not a concentration                             |
| Last update      | sensor        | Timestamp of the last successful Alexa poll               |
| Amazon connected | binary sensor | Diagnostic: last poll succeeded                           |
| Bridge connected | binary sensor | Diagnostic: MQTT last will of this app                    |

Measurements are retained and never blanked out. If Amazon is unreachable, the
last known values stay visible and only **Amazon connected** turns off. Stopping
the app turns off **Bridge connected** and leaves the readings in place.

## Topics

```text
amazon_air_quality/bridge/availability     # online/offline, retained
amazon_air_quality/<device_id>/state       # retained JSON with all measurements
homeassistant/device/<device_id>/config    # retained MQTT device discovery
```

The bridge republishes discovery and state when Home Assistant sends its
`homeassistant/status` birth message.

## Troubleshooting

- **The Web UI shows "Amazon sign-in required" and the login link does not
  load.** The login proxy only answers to the exact address it advertises. The
  Log tab prints it on start (`Amazon login proxy will advertise http://…:8098/`)
  — open that address verbatim, not a different name for the same host, and make
  sure port 8098 is neither blocked nor remapped.
- **Nothing appears in Home Assistant.** Check the MQTT integration is
  configured, then look at the Log tab for `MQTT connected`.
- **`No MQTT service is available`.** Install and start the Mosquitto broker
  app, or set `mqtt_url` to a broker of your own.
- **Sign-in loops or fails.** Stop the app, delete `auth.json` from the app's
  `/data` directory (via the SSH or Terminal app), and start it again.

## Data

`/data/auth.json` holds the Amazon session; `/data/last-state.json` holds the
last known readings. Both are owner-readable only and are included in Home
Assistant backups of this app.
