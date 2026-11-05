# 🚀 Pushing Code to the TV (Local Deployment)

Orsay OS does not support direct sideloading via USB drives. Applications (widgets) must be synced from a local network server using a `widgetlist.xml` manifest over HTTP on **port 80**.

## 1. Preparing the Developer PC
1. Ensure both the TV and your developer PC are connected to the same local network (LAN/Wi-Fi).
2. Configure your client configuration in `apps/iptv-client/config.js` to point to your running proxy server IP (see `services/iptv-proxy/README.md`).
3. Run the deployment server from the repository root:
   ```bash
   python tools/orsay-deployer/build_and_serve.py
   ```
   The script will:
   - Automatically detect your active local IP address (e.g., `192.168.1.137`).
   - Package the widget into `orsay_tv_app.zip`.
   - Generate `widgetlist.xml` pointing to the detected IP.
   - Start an HTTP server on **port 80** and print step-by-step instructions.

## 2. Syncing the TV
1. Turn on the TV and press the **Smart Hub** button.
2. Log into the Smart Hub using the `develop` account (see `UNLOCK_DEV.md`).
3. Navigate to the **More Apps** (or **Apps**) screen.
4. Highlight any existing application, then **press and hold the Enter / OK button** on the remote for 2-3 seconds until the Options context menu appears.
5. Select **IP Setting**.
6. Enter your developer PC's IP address (shown in the `build_and_serve.py` terminal output).
7. Press and hold Enter / OK on an app again to re-open the Options context menu.
8. Select **Start App Sync** (or *User App Sync*).
9. The TV will fetch `widgetlist.xml`, download `orsay_tv_app.zip`, extract it, and "Legacy TV" will appear in your apps list.

## ⚠️ Troubleshooting: Why is the TV not syncing?
* **Wrong IP entered on TV:** Verify the IP displayed in the `build_and_serve.py` console matches the IP you entered on the TV.
* **Windows Firewall blocking Port 80:** Windows Firewall often blocks incoming port 80 traffic for Python. Add an inbound rule allowing port 80, or temporarily permit Python through the firewall on Private networks.
* **Forgot 'Start App Sync':** Entering the IP in *IP Setting* does not start the download by itself. You must open the options menu a second time and click *Start App Sync*.
* **Router AP Isolation:** Ensure your router does not have "AP Isolation" or "Guest Network Isolation" enabled, which blocks direct device-to-device communication on Wi-Fi.
