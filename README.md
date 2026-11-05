# 📺 Orsay OS Revival Project

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)

**A complete monorepo ecosystem to rescue 2015-era Samsung Smart TVs from planned obsolescence.**

While the display hardware of 2015 Samsung Smart TVs remains excellent, the proprietary Orsay OS ecosystem is abandoned, lacking support for modern web standards like WebAssembly and MediaSource Extensions. This repository serves as a centralized development hub to build, deploy, and maintain modern applications for these legacy devices.

## 🏗️ The Core Philosophy: "Dumb TV, Smart Proxy"
All applications in this monorepo follow a split-workload architecture. Because the TV's built-in browser cannot handle modern web traffic, heavy API parsing, or media transcoding, we offload the heavy lifting.

1. **`apps/` (The Frontend):** Bare-metal, ultra-lightweight HTML/JS/CSS clients running natively on the TV. They handle only the UI and media playback.
2. **`services/` (The Backend):** Dedicated, low-resource proxy servers designed to run on a local Raspberry Pi, old smartphone, or cheap VPS. These proxies translate modern internet protocols, APIs, and media streams into raw data the TV can natively digest.

## 📂 Monorepo Structure

This repository is organized into four main pillars:

```text
orsay-revival/
├── apps/                 # Native Orsay TV Clients
│   ├── iptv-client/      # A lightweight HLS/m3u8 player (see GUIDE.md)
│   ├── ...
│
├── services/             # Backend Proxies & Bridges
│   ├── iptv-proxy/       # Modular Flask/FFmpeg stream & media proxy (see README.md)
│   └── ...
│
├── tools/                # Developer Tooling
│   └── orsay-deployer/   # Local network sync & widget deployment server
│
└── docs/                 # The Lost Knowledge Base
    ├── UNLOCK_DEV.md     # How to enable Developer Mode & login
    ├── DEPLOYMENT.md     # How to push code to the TV via local network
    └── LIMITATIONS.md    # Known hardware and API constraints
```

## 🚀 Quick Start Guide

### 1. Start the Backend Proxy
The proxy remuxes streams into native MPEG-TS and caches channel logos with low RAM usage:
```bash
pip install -r services/iptv-proxy/requirements.txt
python services/iptv-proxy/server.py
```
*(For detailed endpoint documentation and modular blueprint extension, see [services/iptv-proxy/README.md](services/iptv-proxy/README.md).)*

### 2. Configure Client Settings
Copy `apps/iptv-client/config.js.example` to `apps/iptv-client/config.js` (if not already done) and configure your proxy server's IP and port:
```javascript
var AppConfig = {
  proxyUrl: 'http://<YOUR_PROXY_IP>:7833/stream.ts?b64=',
  logoProxyUrl: 'http://<YOUR_PROXY_IP>:7833'
};
```

### 3. Deploy to the TV
Run the deployer on your developer machine:
```bash
python tools/orsay-deployer/build_and_serve.py
```
Follow [docs/UNLOCK_DEV.md](docs/UNLOCK_DEV.md) to log in as `develop`, and [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) to sync the widget to your Samsung TV. For remote and keyboard controls, see [apps/iptv-client/GUIDE.md](apps/iptv-client/GUIDE.md).
