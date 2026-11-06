/*
 * OrsayCast TV Frontend - Main Application Controller
 *
 * Platform: Samsung Smart TV (Orsay OS 2012-2015, WebKit 534/537)
 * Strict ES5 syntax:
 *   - Only 'var' and 'function' declarations
 *   - No let/const, arrow functions, promises, fetch, or template literals
 *   - Strictly NO setInterval (memory protection against WebKit OOM)
 *   - Recursive setTimeout and XMLHttpRequest for asynchronous operations
 */

/* ==========================================================================
   Global Configuration & Hardware APIs
   ========================================================================== */

var SERVER_URL = ((typeof AppConfig !== 'undefined' && AppConfig.serverUrl) ?
                 AppConfig.serverUrl : 'http://127.0.0.1:7833').replace(/\/+$/, '');

var widgetAPI = null;
var tvKey = null;

try {
  if (typeof Common !== 'undefined' && Common.API && Common.API.Widget) {
    widgetAPI = new Common.API.Widget();
  }
} catch (widgetInitErr) {}

try {
  if (typeof Common !== 'undefined' && Common.API && Common.API.TVKeyValue) {
    tvKey = new Common.API.TVKeyValue();
  }
} catch (keyInitErr) {}

/* ==========================================================================
   Main Application Object
   ========================================================================== */

var App = {
  isPlaying: false,
  currentContentKey: '',
  isPaused: false,
  pollTimeoutId: null,
  clockTimeoutId: null,
  osdTimeoutId: null,
  isPollingActive: false,
  videoElement: null,

  /* ------------------------------------------------------------------------
     Initialization
     ------------------------------------------------------------------------ */
  init: function () {
    this.videoElement = document.getElementById('videoPlayer');
    this.updateServerBadge('pending', 'Connecting: ' + SERVER_URL);

    this.bindVideoEvents();
    this.installKeyHandler();
    this.updateClock();

    /* Signal Orsay runtime that the widget is ready to receive remote input */
    if (widgetAPI && widgetAPI.sendReadyEvent) {
      widgetAPI.sendReadyEvent();
    }

    /* Start the initial polling request */
    this.pollStatus();
  },

  log: function (msg) {
    if (window.console && window.console.log) {
      window.console.log('[OrsayCast] ' + msg);
    }
  },

  escapeHtml: function (str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  },

  /* ------------------------------------------------------------------------
     Clock & Date Loop (Recursive setTimeout, NO setInterval)
     ------------------------------------------------------------------------ */
  updateClock: function () {
    var self = this;
    var now = new Date();
    var hours = now.getHours();
    var minutes = now.getMinutes();

    var hoursStr = (hours < 10 ? '0' : '') + hours;
    var minutesStr = (minutes < 10 ? '0' : '') + minutes;

    var clockEl = document.getElementById('clockDisplay');
    if (clockEl) {
      clockEl.innerHTML = hoursStr + ':' + minutesStr;
    }

    var dateEl = document.getElementById('dateDisplay');
    if (dateEl) {
      var days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
      var months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
      var dayName = days[now.getDay()];
      var monthName = months[now.getMonth()];
      var date = now.getDate();
      var year = now.getFullYear();

      dateEl.innerHTML = dayName + ', ' + monthName + ' ' + date + ', ' + year;
    }

    /* Schedule next clock tick in 1000ms */
    this.clockTimeoutId = setTimeout(function () {
      self.updateClock();
    }, 1000);
  },

  updateServerBadge: function (state, text) {
    var dot = document.getElementById('serverDot');
    var label = document.getElementById('serverUrlLabel');

    if (dot) {
      dot.className = 'serverDot ' + state;
    }
    if (label && text) {
      label.innerHTML = this.escapeHtml(text);
    }
  },

  /* ------------------------------------------------------------------------
     AJAX Status Polling (Recursive setTimeout, NO setInterval)
     ------------------------------------------------------------------------ */
  pollStatus: function () {
    var self = this;

    /* Prevent overlapping requests if a network request is still hanging */
    if (this.isPollingActive) {
      return;
    }
    this.isPollingActive = true;

    var xhr = new XMLHttpRequest();
    /* Cache-busting query parameter prevents WebKit aggressive 304 caching */
    var url = SERVER_URL + '/status?_t=' + (new Date().getTime());

    xhr.open('GET', url, true);
    xhr.setRequestHeader('Accept', 'application/json');

    xhr.onreadystatechange = function () {
      if (xhr.readyState !== 4) {
        return;
      }

      self.isPollingActive = false;

      if (xhr.status === 200) {
        try {
          var data = JSON.parse(xhr.responseText);
          self.updateServerBadge('connected', 'Server: Connected (' + SERVER_URL + ')');

          if (data.status === 'ready' || data.status === 'playing') {
            self.setPlayerMode(data);
          } else if (data.status === 'extracting') {
            self.setIdleMode(data);
          } else {
            self.setIdleMode(data);
          }
        } catch (jsonErr) {
          self.log('Status JSON parse error: ' + jsonErr);
          self.setIdleMode(null);
        }
      } else if (xhr.status === 204) {
        /* 204 No Content -> Server is idle, waiting for casting */
        self.updateServerBadge('connected', 'Server: Ready (' + SERVER_URL + ')');
        self.setIdleMode(null);
      } else {
        /* Connection failure or HTTP error */
        self.updateServerBadge('disconnected', 'Server: Offline (' + SERVER_URL + ')');
        self.setIdleMode(null);
      }

      /* Recursively schedule next poll in 3000ms */
      self.pollTimeoutId = setTimeout(function () {
        self.pollStatus();
      }, 3000);
    };

    try {
      xhr.send(null);
    } catch (sendErr) {
      self.isPollingActive = false;
      self.updateServerBadge('disconnected', 'Network error: ' + sendErr);
      self.setIdleMode(null);

      self.pollTimeoutId = setTimeout(function () {
        self.pollStatus();
      }, 3000);
    }
  },

  /* ------------------------------------------------------------------------
     State Handlers: Idle vs. Player Mode
     ------------------------------------------------------------------------ */
  setIdleMode: function (data) {
    /* If currently playing, stop video and release hardware decoder buffers */
    if (this.isPlaying || (this.videoElement && this.videoElement.src)) {
      if (this.videoElement) {
        try {
          this.videoElement.pause();
        } catch (pauseErr) {}
        this.videoElement.src = '';
        this.videoElement.removeAttribute('src');
        try {
          this.videoElement.load();
        } catch (loadErr) {}
      }
      this.isPlaying = false;
      this.currentContentKey = '';
      this.isPaused = false;
    }

    /* Switch visible layer */
    var playerLayer = document.getElementById('playerLayer');
    var standbyLayer = document.getElementById('standbyLayer');
    if (playerLayer) playerLayer.style.display = 'none';
    if (standbyLayer) standbyLayer.style.display = 'block';

    /* Hide OSD and Pause indicators */
    this.hideOsd();
    var pauseIndicator = document.getElementById('pauseIndicator');
    if (pauseIndicator) pauseIndicator.style.display = 'none';

    /* Update standby status message */
    var statusEl = document.getElementById('standbyStatus');
    var subtextEl = document.getElementById('standbySubtext');

    if (data && data.status === 'extracting') {
      if (statusEl) statusEl.innerHTML = 'Preparing media...';
      if (subtextEl) subtextEl.innerHTML = data.original_url ?
        this.escapeHtml(data.original_url) : 'Please wait, extracting stream...';
    } else {
      if (statusEl) statusEl.innerHTML = 'Ready to Cast';
      if (subtextEl) subtextEl.innerHTML = 'Send video or music from your phone or browser';
    }
  },

  setPlayerMode: function (data) {
    if (!data) return;

    var streamUrl = data.stream_url ? data.stream_url : (SERVER_URL + '/cast_stream.ts');
    var contentKey = (data.original_url || data.title) ?
                     (data.original_url + '::' + (data.title || '')) : streamUrl;

    /* Guard against restarting the video every 3 seconds while already playing */
    var isNewTrack = (!this.isPlaying) || (this.currentContentKey !== contentKey);

    if (isNewTrack) {
      this.currentContentKey = contentKey;
      this.isPlaying = true;

      /* Switch layers */
      var standbyLayer = document.getElementById('standbyLayer');
      var playerLayer = document.getElementById('playerLayer');
      if (standbyLayer) standbyLayer.style.display = 'none';
      if (playerLayer) playerLayer.style.display = 'block';

      /* Music mode vs. Video mode presentation */
      var musicBackdrop = document.getElementById('musicBackdrop');
      if (data.media_type === 'music') {
        if (musicBackdrop) musicBackdrop.style.display = 'block';

        var musicTitle = document.getElementById('musicTitle');
        var musicArtist = document.getElementById('musicArtist');
        var musicCover = document.getElementById('musicCover');
        var lyricsContainer = document.getElementById('lyricsContainer');
        var lyricsContent = document.getElementById('lyricsContent');

        if (musicTitle) musicTitle.innerHTML = this.escapeHtml(data.title || 'Playing Music');
        if (musicArtist) musicArtist.innerHTML = this.escapeHtml(data.artist || 'Unknown Artist');

        if (musicCover) {
          if (data.thumbnail) {
            musicCover.src = data.thumbnail;
            musicCover.style.display = 'block';
          } else {
            musicCover.style.display = 'none';
          }
        }

        if (lyricsContainer && lyricsContent) {
          var lyricsText = '';
          if (data.lyrics) {
            lyricsText = data.lyrics.synced || data.lyrics.plain || '';
          }
          if (lyricsText) {
            lyricsContent.innerHTML = this.escapeHtml(lyricsText);
            lyricsContainer.style.display = 'block';
          } else {
            lyricsContainer.style.display = 'none';
          }
        }
      } else {
        if (musicBackdrop) musicBackdrop.style.display = 'none';
      }

      /* Start HTML5 Video Playback */
      if (this.videoElement) {
        this.videoElement.src = streamUrl;
        try {
          this.videoElement.play();
        } catch (playErr) {
          this.log('Video play error: ' + playErr);
        }
      }

      /* Show OSD Banner */
      var titleText = data.title ? data.title : 'Playing cast stream';
      var subtitleText = '';
      if (data.queue_length && data.queue_length > 1) {
        subtitleText = 'In queue: ' + data.queue_length + ' items';
      }
      this.showOsd(titleText, subtitleText);
    }

    /* Sync pause state with backend state */
    this.handlePauseSync(data.is_paused);
  },

  handlePauseSync: function (serverPaused) {
    var pauseIndicator = document.getElementById('pauseIndicator');
    var isPaused = !!serverPaused;

    if (this.isPaused !== isPaused) {
      this.isPaused = isPaused;
      if (isPaused) {
        if (pauseIndicator) pauseIndicator.style.display = 'block';
        if (this.videoElement) {
          try {
            this.videoElement.pause();
          } catch (e) {}
        }
      } else {
        if (pauseIndicator) pauseIndicator.style.display = 'none';
        if (this.videoElement) {
          try {
            this.videoElement.play();
          } catch (e) {}
        }
      }
    }
  },

  /* ------------------------------------------------------------------------
     Video Events
     ------------------------------------------------------------------------ */
  bindVideoEvents: function () {
    var self = this;
    if (!this.videoElement) return;

    this.videoElement.addEventListener('loadstart', function () {
      self.log('Video loadstart');
      self.showOsd(null, 'Connecting to stream...');
    });

    this.videoElement.addEventListener('waiting', function () {
      self.log('Video buffering');
      self.showOsd(null, 'Buffering...');
    });

    this.videoElement.addEventListener('playing', function () {
      self.log('Video playing event fired');
      self.showOsd(null, '');
    });

    this.videoElement.addEventListener('ended', function () {
      self.log('Video ended event fired -> advancing to next item');
      self.sendNext();
    });

    this.videoElement.addEventListener('error', function () {
      var err = self.videoElement.error ? self.videoElement.error.code : 'unknown';
      var errMsg = 'Playback error (Code: ' + err + ')';
      if (err === 4) {
        errMsg = 'Stream error (Code: 4 - Unsupported format / 403)';
      }
      self.log('Video error encountered: ' + err);
      self.showOsd(null, errMsg);
    });
  },

  /* ------------------------------------------------------------------------
     OSD Management
     ------------------------------------------------------------------------ */
  showOsd: function (title, subtitle) {
    var osd = document.getElementById('playerOsd');
    var titleEl = document.getElementById('osdTitle');
    var subEl = document.getElementById('osdQueueStatus');

    if (title && titleEl) titleEl.innerHTML = this.escapeHtml(title);
    if (typeof subtitle === 'string' && subEl) subEl.innerHTML = this.escapeHtml(subtitle);

    if (osd) {
      osd.className = 'osdVisible';
    }

    if (this.osdTimeoutId) {
      clearTimeout(this.osdTimeoutId);
    }
    var self = this;
    this.osdTimeoutId = setTimeout(function () {
      self.hideOsd();
    }, 4000);
  },

  hideOsd: function () {
    var osd = document.getElementById('playerOsd');
    if (osd) {
      osd.className = 'osdHidden';
    }
  },

  /* ------------------------------------------------------------------------
     Remote Command Dispatchers (XHR POST)
     ------------------------------------------------------------------------ */
  sendPostCommand: function (endpoint, callback) {
    var xhr = new XMLHttpRequest();
    xhr.open('POST', SERVER_URL + endpoint, true);
    xhr.setRequestHeader('Content-Type', 'application/json');

    xhr.onreadystatechange = function () {
      if (xhr.readyState === 4) {
        if (callback) {
          callback(xhr.status === 200, xhr.responseText);
        }
      }
    };

    try {
      xhr.send('{}');
    } catch (postErr) {
      if (window.console && window.console.error) {
        window.console.error('Failed to POST to ' + endpoint, postErr);
      }
    }
  },

  sendStop: function () {
    this.log('Sending STOP command to server');
    this.sendPostCommand('/stop');
    this.setIdleMode(null);
  },

  sendPlayPause: function () {
    this.log('Sending PLAY/PAUSE command to server');
    var self = this;
    this.sendPostCommand('/playpause', function (ok, res) {
      if (ok) {
        try {
          var parsed = JSON.parse(res);
          self.handlePauseSync(parsed.is_paused);
        } catch (e) {}
      }
    });
  },

  sendNext: function () {
    this.log('Sending NEXT command to server');
    this.showOsd('Loading next item...', '');
    var self = this;
    this.sendPostCommand('/next', function () {
      /* Force immediate status poll to catch newly activated track */
      self.pollStatus();
    });
  },

  sendPrevious: function () {
    this.log('Sending PREVIOUS command to server');
    this.showOsd('Loading previous item...', '');
    var self = this;
    this.sendPostCommand('/previous', function () {
      /* Force immediate status poll */
      self.pollStatus();
    });
  },

  /* ------------------------------------------------------------------------
     Remote Control & Keyboard Handling
     ------------------------------------------------------------------------ */
  installKeyHandler: function () {
    var self = this;

    document.onkeydown = function (event) {
      event = event || window.event;
      var code = event.keyCode;

      /* Samsung Orsay keycodes with PC browser fallbacks */
      var KEY_RETURN = (tvKey && tvKey.KEY_RETURN) ? tvKey.KEY_RETURN : 10009;
      var KEY_EXIT = (tvKey && tvKey.KEY_EXIT) ? tvKey.KEY_EXIT : 10182;
      var KEY_STOP = (tvKey && tvKey.KEY_STOP) ? tvKey.KEY_STOP : 70;
      var KEY_PLAY = (tvKey && tvKey.KEY_PLAY) ? tvKey.KEY_PLAY : 71;
      var KEY_PAUSE = (tvKey && tvKey.KEY_PAUSE) ? tvKey.KEY_PAUSE : 74;
      var KEY_PLAY_PAUSE = (tvKey && tvKey.KEY_PLAY_PAUSE) ? tvKey.KEY_PLAY_PAUSE : 10252;
      var KEY_FF = (tvKey && tvKey.KEY_FF) ? tvKey.KEY_FF : 72;
      var KEY_RW = (tvKey && tvKey.KEY_RW) ? tvKey.KEY_RW : 69;
      var KEY_CH_UP = (tvKey && tvKey.KEY_CH_UP) ? tvKey.KEY_CH_UP : 68;
      var KEY_CH_DOWN = (tvKey && tvKey.KEY_CH_DOWN) ? tvKey.KEY_CH_DOWN : 65;

      /* 1. Return / Back / Exit */
      if (code === KEY_RETURN || code === KEY_EXIT || code === 27 || code === 8) {
        if (self.isPlaying) {
          self.sendStop();
          if (event.preventDefault) event.preventDefault();
          event.returnValue = false;
          return false;
        } else {
          /* In standby mode, let Orsay return or exit */
          if (widgetAPI && widgetAPI.sendReturnEvent) {
            widgetAPI.sendReturnEvent();
            if (event.preventDefault) event.preventDefault();
            event.returnValue = false;
            return false;
          }
        }
      }

      /* 2. Stop Key */
      if (code === KEY_STOP || code === 413 || code === 83) { // 83 = 's'
        if (self.isPlaying) {
          self.sendStop();
          if (event.preventDefault) event.preventDefault();
          event.returnValue = false;
          return false;
        }
      }

      /* 3. Play / Pause / Space / Enter */
      if (code === KEY_PLAY || code === KEY_PAUSE || code === KEY_PLAY_PAUSE ||
          code === 32 || (code === 13 && self.isPlaying)) {
        if (self.isPlaying) {
          self.sendPlayPause();
          if (event.preventDefault) event.preventDefault();
          event.returnValue = false;
          return false;
        }
      }

      /* 4. Next Track (FF, Channel Up, Right Arrow, 'N') */
      if (code === KEY_FF || code === KEY_CH_UP || code === 39 || code === 78) {
        if (self.isPlaying) {
          self.sendNext();
          if (event.preventDefault) event.preventDefault();
          event.returnValue = false;
          return false;
        }
      }

      /* 5. Previous Track (RW, Channel Down, Left Arrow, 'P') */
      if (code === KEY_RW || code === KEY_CH_DOWN || code === 37 || code === 80) {
        if (self.isPlaying) {
          self.sendPrevious();
          if (event.preventDefault) event.preventDefault();
          event.returnValue = false;
          return false;
        }
      }

      return true;
    };
  }
};

