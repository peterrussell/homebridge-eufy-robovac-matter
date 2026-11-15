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

> **Two backends.** The plugin supports both:
> - **Local (Tuya LAN)** — older/legacy RoboVacs (G/C‑series etc.). Direct local
>   control with `deviceId` + `localKey`; no cloud, no internet needed.
> - **Cloud (eufy account)** — newer "novel"‑protocol models such as the **Eufy
>   Clean L60**, which don't speak the legacy local protocol. Logs in with your
>   eufy email/password and controls the robot via the eufy/Tuya cloud (needs
>   internet; a little more latency than local).
>
> The backend is chosen per device from its config (see below).

## Getting `deviceId` and `localKey`

Each robot needs its Tuya **device ID** and **local key**. Obtain them with the
[eufy-clean-local-key-grabber](https://github.com/Rjevski/eufy-clean-local-key-grabber)
(same method as the upstream plugin). Setting a static **IP** for the robot is
optional but recommended.

## Configuration

Add the platform via the Homebridge UI, or in `config.json`. Each device uses
either the **local** or the **cloud** backend.

**Local backend** (older/legacy models):

```json
{
  "platform": "EufyRobovacMatter",
  "name": "Eufy RoboVac (Matter)",
  "devices": [
    {
      "name": "Living Room RoboVac",
      "backend": "local",
      "deviceId": "xxxxxxxxxxxxxxxxxxxx",
      "localKey": "xxxxxxxxxxxxxxxx",
      "deviceIp": "192.168.1.50",
      "protocolVersion": "3.3"
    }
  ]
}
```

**Cloud backend** (novel models such as the L60):

```json
{
  "platform": "EufyRobovacMatter",
  "name": "Eufy RoboVac (Matter)",
  "devices": [
    {
      "name": "L60",
      "backend": "cloud",
      "deviceId": "xxxxxxxxxxxxxxxxxxxx",
      "email": "you@example.com",
      "password": "your-eufy-password"
    }
  ]
}
```

| Field      | Backend | Required | Description                                             |
| ---------- | ------- | -------- | ------------------------------------------------------- |
| `name`     | both    | yes      | Name shown for the robot in your Matter/Home app.       |
| `backend`  | both    | no       | `auto` (default), `local`, or `cloud`. `auto` picks local when a `localKey` is set, otherwise cloud. |
| `deviceId` | both    | yes      | Tuya/eufy device ID.                                    |
| `localKey` | local   | yes\*    | Tuya local key (\*required for local).                  |
| `deviceIp` | local   | no       | Static IP of the robot (improves local performance).    |
| `protocolVersion` | local | no | Tuya LAN protocol version (`3.3` default, or `3.4` / `3.5` / `3.1`). |
| `email`    | cloud   | yes\*    | Eufy account email (\*required for cloud).              |
| `password` | cloud   | yes\*    | Eufy account password (\*required for cloud).           |
| `mop`      | cloud   | no       | `true` for Hybrid models — exposes Vacuum/Mop/Vacuum & Mop clean modes. |
| `rooms`    | cloud   | no       | List of `{ "id": <room id>, "name": "..." }` for Apple Home room selection (Service Area). |
| `mapId`    | cloud   | no       | Map the rooms belong to (usually leave blank).          |

### Rooms (Service Area)

Apple Home (iOS 18.4+) can show **per‑room selection** for Matter vacuums. The
eufy cloud doesn't expose the robot's room list, so you define it yourself:

```json
{
  "name": "L60", "backend": "cloud", "deviceId": "…", "email": "…", "password": "…",
  "mop": true,
  "rooms": [ { "id": 1, "name": "Living Room" }, { "id": 2, "name": "Kitchen" } ]
}
```

Selecting rooms in Home and starting a clean sends the robot a room‑clean for
those ids; with none selected it does a full clean. The `id` must match the
robot's **map room id**.

On a **fresh install** the plugin seeds three editable placeholders
(`Room 1`–`Room 3`, ids `1`–`3`) into the device config automatically, so they
appear in the settings UI and Apple Home's Service Area straight away. Later
restarts **never overwrite** your edits — once the `rooms` key exists (even if
you empty it), the plugin leaves it alone. To discover the real ids, clean each
placeholder from Home to see which room it runs, then rename it — and add or
remove rows — to match your robot's rooms.

### Troubleshooting: connects but every command times out

If the log shows `Connected to device!` but then `Timeout waiting for status response`,
the TCP connection is fine but the robot can't decode the requests — almost always a
**protocol version** or **localKey** mismatch:

1. Set `protocolVersion` to **`3.4`**, restart, and test. If still timing out, try **`3.5`**.
2. If no version works, your **`localKey` is likely stale** (it rotates whenever the robot is
   re-added in the eufy app). Re-grab it with the key grabber and update the config.
3. Make sure nothing else holds the single local connection — close the eufy app and stop any
   other local Tuya integration polling the robot.

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

- **Local Tuya control** ported from
  [@hov3rcraft/homebridge-eufy-robovac](https://github.com/hov3rcraft/homebridge-eufy-robovac)
  (itself a rewrite of the original by apexad).
- **Cloud (novel) protocol** — the eufy/Tuya‑cloud login, the novel DPS map, the
  protobuf command/state definitions and the error codes are a self‑contained
  port of [martijnpoppen/eufy-clean](https://github.com/martijnpoppen/eufy-clean)
  (MIT). This plugin reimplements the relevant pieces using Node's built‑in
  `fetch`/`crypto` and `protobufjs` rather than depending on that library.
- Matter integration follows Homebridge 2's `api.matter` plugin API.

MIT
