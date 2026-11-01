# 🚀 Pushing Code to the TV (Local Deployment)

Orsay OS does not support direct sideloading via USB drives. Applications (widgets) must be synced from a local network server using a `widgetlist.xml` manifest.

## 1. Preparing the Developer PC
1. Ensure both the TV and your developer PC are connected to the same local network (LAN/Wi-Fi).
2. Note your PC's local IP address (e.g., `192.168.1.247`).
3. Run the `build_and_serve.py` script located in the `tools/orsay-deployer/` directory. This script will:
   - Package your application into a `.zip` file.
   - Generate a `widgetlist.xml` file pointing to the zipped payload.
   - Start a local HTTP server on **port 80** *(critical: the TV will only look for port 80)*.

## 2. Syncing the TV
1. Log into the Smart Hub using the `develop` account (see `UNLOCK_DEV.md`).
2. Navigate to the **More Apps** screen.
3. Highlight any existing application, then press and hold the **Enter / OK** button on the remote until the Options context menu appears.
4. Select **IP Setting**.
5. Enter the local IP address of your developer PC.
6. Open the Options menu again and select **Start App Sync**.
7. The TV will download the XML, fetch the ZIP, extract it, and your custom application will appear in the Smart Hub list.