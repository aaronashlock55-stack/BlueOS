# Running the BlueOS frontend against a simulated vehicle (SITL)

> Why you need this: the BlueOS **frontend** (`core/frontend`, what `yarn dev`
> starts) is only the UI. It needs a BlueOS **backend** to answer its API calls,
> and the **Motors tab** needs a *vehicle* (real or simulated) to populate the
> port board — the ports come from ArduSub's `SERVOn_FUNCTION` parameters.
> "Backend offline" simply means there's no backend at the address the frontend
> is pointed at. **It is not a bug in our changes.**

This guide gets the Motors tab populated with **no rover and no flight
controller**, using ArduSub **SITL** (Software-In-The-Loop = a simulated sub).

## The key mechanism (no code changes needed)

The dev server already proxies every backend path (`/status`, `/mavlink2rest`
(incl. websocket), `/bag`, `/ardupilot-manager`, …) to whatever you point it at:

```bash
# core/frontend/vite.config.js, already in the repo:
const SERVER_ADDRESS = process.env.BLUEOS_ADDRESS ?? 'http://blueos-avahi.local/'
```

So you run the frontend like this, pointing it at a BlueOS backend:

```bash
cd core/frontend
BLUEOS_ADDRESS=http://<backend-address>/ yarn dev   # → http://localhost:8080
```

All you need is a **BlueOS backend running with a SITL autopilot** at
`<backend-address>`. Two ways to get one:

---

## Option A — Spare Raspberry Pi running BlueOS (most reliable)

No rover, no Navigator, no thrusters — just a Pi.

1. Flash **BlueOS** onto a Pi (or use the rover's Pi on the bench, motors
   unpowered) and boot it.
2. Open its UI (`http://blueos.local/`). Go to **Autopilot Firmware** →
   set the board to **SITL**. BlueOS now runs ArduSub SITL internally and
   reports a full parameter set — including `SERVOn_FUNCTION`.
3. On your laptop, point the dev frontend at it:
   ```bash
   BLUEOS_ADDRESS=http://blueos.local/ yarn dev     # or use the Pi's IP
   ```
4. Open `http://localhost:8080` → **Vehicle Setup → Motors**. The board now
   populates with the simulated vehicle's ports; you can assign, name, and
   (in SITL) spin-test them.

## Option B — BlueOS in Docker (Linux recommended)

BlueOS is built to run on the Pi's Linux host and uses host networking, so this
is reliable on **Linux** and finicky on Docker Desktop for macOS/Windows
(host-networking + privileged-device limitations). On a Linux box:

```bash
# Pull and run BlueOS core (verify the current image/tag against Blue Robotics docs)
docker run --rm -it --privileged --net=host \
  --name blueos-core bluerobotics/blueos-core:master
```

Then open `http://localhost/`, set **Autopilot Firmware → SITL** as in Option A,
and run the frontend with `BLUEOS_ADDRESS=http://localhost/ yarn dev`.

> On macOS, prefer **Option A (a Pi)** or run Option B inside a Linux VM. The
> exact `docker run` flags for BlueOS evolve — cross-check Blue Robotics'
> current "run BlueOS / SITL" documentation before relying on them.

---

## What works in SITL vs. needs real hardware

| Works against SITL | Needs the real rover |
|---|---|
| Motors board populates from live `SERVOn_FUNCTION` params | Confirming a port spins the **correct physical thruster** |
| Assigning ports (writes params over MAVLink) | — |
| Naming motors (persists via the `/bag` service) | — |
| Arm/disarm + spin in simulation | Real thrust / reversed-motor detection in water |

## Quick sanity checks

- `BLUEOS_ADDRESS` must start with `http://` (the config asserts this).
- If the banner still says "offline", the backend address is wrong/unreachable —
  open `http://<backend-address>/status` directly; it should return `204`.
- If the board is empty but the backend is up, the autopilot isn't running —
  confirm **Autopilot Firmware → SITL** is active and parameters finished loading.

## TL;DR

```bash
# 1. Have a BlueOS backend with Autopilot = SITL (a spare Pi is easiest)
# 2. Point the dev frontend at it:
cd core/frontend
BLUEOS_ADDRESS=http://blueos.local/ yarn dev
# 3. http://localhost:8080 → Vehicle Setup → Motors
```
