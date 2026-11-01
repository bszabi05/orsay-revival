# ⚠️ Known Hardware and API Constraints (Orsay OS)

The embedded browser (WebKit-based) on the 2015 Samsung J-series is severely outdated. Developers building for this platform must design around the following physical and software limitations:

## 1. API and Standard Deficits
* **No WebAssembly (Wasm):** Modern client-side video processing libraries (e.g., `ffmpeg.js` or `ffmpeg.wasm`) will immediately throw a Parse/Syntax Error. C/C++ code cannot run in this browser.
* **No MediaSource Extensions (MSE):** The modern web standard for chunking and splicing video streams does not exist here. You cannot pipe raw video data into an HTML5 `<video>` buffer via JavaScript.
* **Legacy JavaScript Engine:** Modern ES6+ syntax (Arrow functions, Promises, let/const) will often break execution. Code must be written in strict ES5 or compiled down using polyfills/transpilers (like Babel).

## 2. Hardware and Memory Limits
* **Critical RAM Scarcity:** The TV's HTML5 media player and browser engine share a very tight memory pool. Storing large arrays in memory (such as downloaded binary video chunks) will trigger an immediate "Out of Memory" (OOM) crash, force-closing the app.
* **Weak CPU:** Heavy DOM manipulation and non-GPU-accelerated CSS animations (anything outside of `transform` and `opacity`) will cause drastic frame drops and UI freezing.
* **USB Power Output (0.5A - 1A):** The TV's built-in USB ports cannot provide enough amperage to power a modern Raspberry Pi (like the Pi 3 or 4) reliably. At most, you can power a Raspberry Pi Zero W directly from the TV.

## 3. Aggressive Proprietary Media Player
* The built-in media player enforces extremely strict MIME-type and file extension validation.
* If a stream URL ends in `.m3u8` or `.m3u`, the player automatically attempts to parse the incoming binary video bytes as a text-based playlist. This results in an infinite error loop (often visible in logs as a hexadecimal `0x47` or "G" character parsing error).
* **The Workaround:** The proxy URL must completely mask the original stream link (e.g., using Base64 encoding) and force a video file extension at the endpoint (e.g., `/stream.ts?b64=...`). This tricks the TV into natively decoding the incoming bytes as a video stream.