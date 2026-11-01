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
│   ├── iptv-client/      # A lightweight HLS/m3u8 player
│   ├── ...
│
├── services/             # Backend Proxies & Bridges
│   ├── iptv-proxy/       # Zero-overhead Flask/FFmpeg stream proxy
│   └── ...
│
├── tools/                # Developer Tooling
│   └── orsay-deployer/   # Local network sync & widget deployment server
│
└── docs/                 # The Lost Knowledge Base
    ├── UNLOCK_DEV.md     # How to enable Developer Mode & login
    ├── DEPLOYMENT.md     # How to push code to the TV via local network
    └── LIMITATIONS.md    # Known hardware and API constraints