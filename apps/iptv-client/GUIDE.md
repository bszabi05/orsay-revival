# IPTV Client - Controls & User Guide

This guide details all controls and key bindings for the Samsung Smart TV (Orsay OS) IPTV client, covering the official **Samsung TV Remote**, connected **USB Keyboards**, and **Mouse / Air-mouse** pointers.

---

## 1. Channel Browser (Main Screen)

The main screen features two primary browsing modes:
- **Favorites:** 3D Coverflow Carousel with smooth hardware-accelerated card transitions.
- **All / Categories:** Paginated channel grid (3×5 grid, 15 channels per page, filterable by category and language).

### Main Screen Controls:

| Action | TV Remote | USB Keyboard | Mouse / Pointer |
| :--- | :--- | :--- | :--- |
| **Navigate Carousel (Favorites)** | `Left` / `Right` arrows | `Left` / `Right` arrows | Click adjacent (prev/next) card |
| **Navigate Grid (All / Categories)** | `Arrow keys (Up / Down / Left / Right)` | `Arrow keys (Up / Down / Left / Right)` | Click channel card |
| **Start Channel Playback** | `ENTER` | `Enter` or `Space` | Click focused channel card |
| **Navigate to Top Filter Bar** | `Up` arrow (from top row / card) | `Up` arrow (from top row) or `Tab` | Click target filter button |
| **Return to Channels from Top Bar** | `Down` arrow | `Down` arrow | Click channel area |
| **Switch to 'All' Tab** | Focus `All` + `ENTER` | **`A`** key or focus `All` + `Enter` | Click `All` button |
| **Switch to 'Favorites' Tab** | Focus `Favorites` + `ENTER` | **`F`** key or focus `Favorites` + `Enter` | Click `Favorites` button |
| **Toggle Favorite (Add / Remove)** | `RED` button | **`R`** or **`F1`** key | Click &#9733; star button |
| **Cycle Channel Category** | `GREEN` button | **`G`** or **`F2`** key | Select from dropdown |
| **Open Daily EPG Guide** | `YELLOW` or `GUIDE` button | **`Insert`**, **`Y`**, **`Z`** (QWERTZ), or **`F3`** key | Right-click channel card |
| **Refresh Channel List** | `BLUE` button | **`B`** or **`F4`** key | Click `Refresh` button |
| **Pagination (Grid View)** | `CH UP` / `CH DOWN` (or PageUp/Down) | `Page Up` / `Page Down` | Click Previous / Next page buttons |
| **Quick Channel Tune (Direct Number)** | Number keys `0` - `9` | Number keys `0` - `9` (Row or Numpad) | - |
| **Hardware TV Volume** | `VOL +` / `VOL -` / `MUTE` | Media Volume keys, `+` / `-` / `M` | - |
| **Exit App to Smart Hub** | `RETURN` / `BACK` | `Esc` (Samsung TV OS triggers full exit) | - |

> [!NOTE]
> When focused on the top filter bar (`Favorites`, `All`, Category, Language, Refresh), use `Left` and `Right` to move between items, and press `Down` to return focus directly to the channels.

---

## 2. Live Player View

When a channel is launched, the video plays full-screen using MPEG-TS hardware decoding streamed through the backend proxy server.

### Playback Screen Controls:

| Action | TV Remote | USB Keyboard | Mouse / Pointer |
| :--- | :--- | :--- | :--- |
| **Next Channel** | `Up` arrow or `CH UP` | `Up` arrow | - |
| **Previous Channel** | `Down` arrow or `CH DOWN` | `Down` arrow | - |
| **Toggle OSD Info Banner (Now/Next)** | `ENTER` or `INFO` | `Enter`, `Space`, or **`I`** key | Move mouse over player |
| **Pause / Resume** | `PLAY` / `PAUSE` | `P` or Media Play/Pause key | - |
| **Cycle Aspect Ratio (16:9, 4:3, Fill)** | `BLUE` button | **`B`** or **`F4`** key | Click Aspect button in OSD |
| **Toggle Favorite While Watching** | `RED` button | **`R`** or **`F1`** key | - |
| **Open EPG Guide for Current Channel** | `YELLOW` or `GUIDE` button | **`G`**, **`Insert`**, **`Y`**, **`Z`** (QWERTZ), or **`F3`** key | Click EPG button in OSD |
| **Hardware TV Volume Up** | `VOL +` | `Right` arrow, Media Vol+, or `+` | Vertical drag on right half of screen |
| **Hardware TV Volume Down** | `VOL -` | `Left` arrow, Media Vol-, or `-` | Vertical drag on right half of screen |
| **Toggle TV Mute** | `MUTE` | Media Mute key or **`M`** key | - |
| **Quick Channel Tune (Direct Number)** | Number keys `0` - `9` | Number keys `0` - `9` | - |
| **SAFE EXIT Back to Channel Menu** | `RETURN` / `BACK` or `STOP` | **`Backspace`**, **`Q`**, or **`X`** | Click Back / Close button |

> [!IMPORTANT]
> **Why is `Escape` avoided for returning from playback?**  
> On Samsung Orsay Smart TVs, pressing the physical `Escape` key is intercepted by the Smart Hub operating system to immediately terminate the entire application.  
> To safely stop playback and return to the channel grid/carousel without quitting the app, use **`Backspace`**, **`Q`**, or **`X`** on your keyboard (or `RETURN`/`STOP` on the TV remote).

---

## 3. Daily EPG Guide Modal

The program guide window displays the schedule for the selected channel with program start/stop times and highlights the currently airing live show.

### Guide Features & Navigation:
- **Automatic Center Jump:** Upon opening, the guide automatically calculates the vertical offset of the current live broadcast and smoothly centers it in the viewport.
- **Show-by-Show Scrolling:**
  - On TV Remote: Press `Up` / `Down` arrows.
  - On USB Keyboard: Press `Up` / `Down` arrows.
  - With Mouse: Scroll with mouse wheel or click any broadcast entry to select and center it.
- **Fast Page Scrolling (5 shows at a time):**
  - On TV Remote: Press `CH UP` / `CH DOWN` (Channel up/down buttons).
  - On USB Keyboard: Press `Page Up` / `Page Down`.
- **To Close and Return:**
  - On TV Remote: Press `RETURN`, `BACK`, `YELLOW`, `GUIDE`, or `GREEN`.
  - On USB Keyboard: Press `Backspace`, `Q`, `X`, `G`, `Insert`, `Y`, or `Z`.
  - With Mouse: Click the **[Close]** button or click anywhere on the dark backdrop outside the modal dialog.

---

## 4. Native Hardware Volume Control

Volume adjustments do not merely manipulate the HTML5 player's software gain; instead, they communicate directly with the Samsung TV's system audio hardware via the native Samsung Audio Plugin (`SAMSUNG-INFOLINK-AUDIO`).  
This ensures:
- Consistent volume levels across broadcast TV and the IPTV widget.
- On-screen native TV volume display.
- System-wide hardware muting when toggling mute.
