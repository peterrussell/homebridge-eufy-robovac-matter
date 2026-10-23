# homebridge-eufy-robovac-matter

A [Homebridge](https://homebridge.io) 2.x plugin that exposes a **Eufy RoboVac**
as a **native Matter Robotic Vacuum Cleaner** device, controlled locally over
the Tuya LAN protocol.

Unlike the classic HomeKit integration — which has to present a vacuum as a fan
or a switch, because HomeKit (HAP) has no vacuum type — this plugin publishes the
robot through Homebridge 2's Matter support (`api.matter`). In the Home app it
shows up as a real robot vacuum tile with **start / pause / return‑to‑dock**,
**suction mode**, **operational state**, and **battery**.

This is a Matter‑native rebuild of
[@hov3rcraft/homebridge-eufy-robovac](https://github.com/hov3rcraft/homebridge-eufy-robovac);
the local TuyAPI control layer (and therefore the model support and its limits)
is carried over from that project.

## Requirements

- **Homebridge 2.0+** (the `api.matter` API ships in Homebridge 2.0, released
  May 2026).
- **Matter enabled** on the Homebridge instance (or child bridge) that runs this
  plugin. See "Matter setup" below.
- A **Matter controller**: Apple Home (**iOS 18.4+** is required for robot
  vacuums), Amazon Alexa, Google Home, Home Assistant, SmartThings, etc.
- The robot and Homebridge on the **same local network** (Matter also needs
  working IPv6/mDNS on that subnet).

> **Model support.** Control is local via Tuya protocol `3.3`, the same as the
> upstream plugin. Older RoboVac G/C‑series models work; some newer models (e.g.
> the Eufy Clean **L60**) are **not** supported because their messages are
> encrypted. No eufy cloud login is used.

## Getting `deviceId` and `localKey`

Each robot needs its Tuya **device ID** and **local key**. Obtain them with the
[eufy-clean-local-key-grabber](https://github.com/Rjevski/eufy-clean-local-key-grabber)
(same method as the upstream plugin). Setting a static **IP** for the robot is
optional but recommended.

## Configuration

Add the platform via the Homebridge UI, or in `config.json`:

```json
{
  "platforms": [
    {
      "platform": "EufyRobovacMatter",
      "name": "Eufy RoboVac (Matter)",
      "devices": [
        {
          "name": "Living Room RoboVac",
          "deviceId": "xxxxxxxxxxxxxxxxxxxx",
          "localKey": "xxxxxxxxxxxxxxxx",
          "deviceIp": "192.168.1.50"
        }
      ]
    }
  ]
}
```

| Field      | Required | Description                                             |
| ---------- | -------- | ------------------------------------------------------- |
| `name`     | yes      | Name shown for the robot in your Matter/Home app.       |
| `deviceId` | yes      | Tuya device ID.                                         |
| `localKey` | yes      | Tuya local key.                                         |
| `deviceIp` | no       | Static IP of the robot (improves performance).          |

## Matter setup

This plugin publishes **Matter** devices only — it registers nothing over HAP.
You must enable Matter on the bridge running it. The recommended setup is a
**child bridge** for this plugin with Matter turned on:

1. In the Homebridge UI, open this plugin's **Bridge Settings** and run it as a
   **child bridge**.
2. Enable **Matter** for that child bridge.
3. Restart Homebridge. A Matter pairing code is shown in the Homebridge logs / UI
   for the child bridge.
4. In Apple Home (or your controller), choose **Add Accessory** and scan/enter
   that pairing code. The RoboVac appears as a robot vacuum.

Each robot vacuum is published as its own external Matter device, so it pairs and
appears independently.

## How Eufy state maps to Matter

| Matter cluster          | Behaviour                                                                                  |
| ----------------------- | ------------------------------------------------------------------------------------------ |
| **RvcRunMode**          | `Cleaning` → start cleaning; `Idle` → return to dock.                                       |
| **RvcOperationalState** | `pause` / `resume` / `goHome`; state reports Running, Paused, Seeking charger, Charging, Docked, Error. |
| **RvcCleanMode**        | `Standard` / `Turbo` (BoostIQ) / `Max` → Eufy suction speed.                                 |
| **PowerSource**         | Battery percentage and charge state.                                                        |

## Building from source

```bash
npm install
npm run build
```

## Credits & license

- Local Tuya control ported from
  [@hov3rcraft/homebridge-eufy-robovac](https://github.com/hov3rcraft/homebridge-eufy-robovac)
  (itself a rewrite of the original by apexad).
- Matter integration pattern follows Homebridge 2's `api.matter` plugin API.

MIT
