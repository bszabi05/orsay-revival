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

if (!String.prototype.trim) {
  String.prototype.trim = function () {
    return this.replace(/^\s+|\s+$/g, '');
  };
}

var SERVER_URL = ((typeof AppConfig !== 'undefined' && AppConfig.serverUrl) ?
                 AppConfig.serverUrl : 'http://127.0.0.1:7833').replace(/\/+$/, '');

var widgetAPI = null;
var tvKey = null;
var pluginAPI = null;

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

try {
  if (typeof Common !== 'undefined' && Common.API && Common.API.Plugin) {
    pluginAPI = new Common.API.Plugin();
  }
} catch (pluginInitErr) {}

/* ==========================================================================
   Main Application Object
   ========================================================================== */

var App = {
  isPlaying: false,
  currentContentKey: '',
  isPaused: false,
  trackDuration: 0,
  pollTimeoutId: null,
  clockTimeoutId: null,
  controlsTimeoutId: null,
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
    this.registerKeys();
    this.updateClock();

    /* Signal Orsay runtime that the widget is ready to receive remote input */
    if (widgetAPI && widgetAPI.sendReadyEvent) {
      widgetAPI.sendReadyEvent();
    }

    /* Start the initial polling request */
    this.pollStatus();
  },

  registerKeys: function () {
    if (!pluginAPI || !pluginAPI.registKey) return;

    if (tvKey) {
      for (var k in tvKey) {
        if (tvKey.hasOwnProperty(k) && typeof tvKey[k] === 'number') {
          try {
            pluginAPI.registKey(tvKey[k]);
          } catch (e1) {}
        }
      }
    }

    var customKeys = [
      65, 66, 67, 68, 69, 70, 71, 72, 73, 74, 75, 76, 77,
      78, 79, 80, 81, 82, 83, 84, 85, 86, 87, 88, 89, 90,
      8, 13, 27, 32, 37, 38, 39, 40,
      412, 413, 415, 417, 10009, 10182, 10252, 10253, 10254
    ];
    for (var i = 0; i < customKeys.length; i++) {
      try {
        pluginAPI.registKey(customKeys[i]);
      } catch (e2) {}
    }
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

  formatTime: function (sec) {
    if (isNaN(sec) || sec < 0) return '0:00';
    var m = Math.floor(sec / 60);
    var s = Math.floor(sec % 60);
    return m + ':' + (s < 10 ? '0' : '') + s;
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

    if (this.isPollingActive) {
      return;
    }
    this.isPollingActive = true;

    var xhr = new XMLHttpRequest();
    var url = SERVER_URL + '/status?_t=' + (new Date().getTime());

    xhr.open('GET', url, true);
    xhr.timeout = 5000;
    xhr.setRequestHeader('Accept', 'application/json');

    var completed = false;
    function finalizePoll() {
      if (completed) return;
      completed = true;
      self.isPollingActive = false;
      if (self.pollTimeoutId) {
        clearTimeout(self.pollTimeoutId);
      }
      self.pollTimeoutId = setTimeout(function () {
        self.pollStatus();
      }, 3000);
    }

    xhr.onreadystatechange = function () {
      if (xhr.readyState !== 4) {
        return;
      }

      if (xhr.status === 200) {
        try {
          var data = JSON.parse(xhr.responseText);
          self.updateServerBadge('connected', 'Server: Ready (' + SERVER_URL + ')');

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
        self.updateServerBadge('connected', 'Server: Ready (' + SERVER_URL + ')');
        self.setIdleMode(null);
      } else {
        self.updateServerBadge('disconnected', 'Server: Offline (' + SERVER_URL + ')');
        self.setIdleMode(null);
      }

      finalizePoll();
    };

    xhr.ontimeout = function () {
      self.updateServerBadge('disconnected', 'Server timeout (' + SERVER_URL + ')');
      self.setIdleMode(null);
      finalizePoll();
    };

    xhr.onerror = function () {
      self.updateServerBadge('disconnected', 'Server offline / CORS error');
      self.setIdleMode(null);
      finalizePoll();
    };

    try {
      xhr.send(null);
    } catch (sendErr) {
      self.updateServerBadge('disconnected', 'Network error: ' + sendErr);
      self.setIdleMode(null);
      finalizePoll();
    }
  },

  /* ------------------------------------------------------------------------
     State Handlers: Idle vs. Player Mode
     ------------------------------------------------------------------------ */
  setIdleMode: function (data) {
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

    var playerLayer = document.getElementById('playerLayer');
    var standbyLayer = document.getElementById('standbyLayer');
    if (playerLayer) playerLayer.style.display = 'none';
    if (standbyLayer) standbyLayer.style.display = 'block';

    var pauseIndicator = document.getElementById('pauseIndicator');
    if (pauseIndicator) pauseIndicator.style.display = 'none';

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

    var streamBase = data.stream_url ? data.stream_url : (SERVER_URL + '/cast_stream.ts');
    var streamUrl = streamBase + (streamBase.indexOf('?') === -1 ? '?_t=' : '&_t=') + (new Date().getTime());
    var contentKey = (data.original_url || data.title) ?
                     (data.original_url + '::' + (data.title || '')) : streamBase;

    var isNewTrack = (!this.isPlaying) || (this.currentContentKey !== contentKey);

    if (isNewTrack) {
      this.currentContentKey = contentKey;
      this.isPlaying = true;

      if (data.duration) {
        this.trackDuration = data.duration;
      }

      var standbyLayer = document.getElementById('standbyLayer');
      var playerLayer = document.getElementById('playerLayer');
      if (standbyLayer) standbyLayer.style.display = 'none';
      if (playerLayer) playerLayer.style.display = 'block';

      /* Update Top Bar Title */
      var topTitle = document.getElementById('playerTopTitle');
      if (topTitle) {
        topTitle.innerHTML = this.escapeHtml(data.title || 'Playing stream');
      }

      /* Update Music visualizer if media_type is music */
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
            lyricsText = (typeof data.lyrics === 'string') ? data.lyrics : (data.lyrics.synced || data.lyrics.plain || '');
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
          this.videoElement.load();
        } catch (loadErr) {}
        try {
          this.videoElement.play();
        } catch (playErr) {
          this.log('Video play error: ' + playErr);
        }
      }

      /* Show controls overlay and auto-hide */
      this.showControls();
    }

    this.handlePauseSync(data.is_paused);
  },

  handlePauseSync: function (serverPaused) {
    var pauseIndicator = document.getElementById('pauseIndicator');
    var btnPlayPause = document.getElementById('btnPlayPause');
    var isPaused = !!serverPaused;

    this.isPaused = isPaused;
    if (isPaused) {
      if (pauseIndicator) pauseIndicator.style.display = 'block';
      if (btnPlayPause) btnPlayPause.innerHTML = '&#9658;';
      if (this.videoElement) {
        try { this.videoElement.pause(); } catch (e) {}
      }
    } else {
      if (pauseIndicator) pauseIndicator.style.display = 'none';
      if (btnPlayPause) btnPlayPause.innerHTML = '&#10074;&#10074;';
      if (this.videoElement) {
        try { this.videoElement.play(); } catch (e) {}
      }
    }
  },

  /* ------------------------------------------------------------------------
     Controls Overlay (OSD) Management
     ------------------------------------------------------------------------ */
  showControls: function () {
    var bar = document.getElementById('castControlsBar');
    var topBar = document.getElementById('playerTopBar');

    if (bar) bar.className = 'cast-controls-bar';
    if (topBar) topBar.style.opacity = '1';

    if (this.controlsTimeoutId) {
      clearTimeout(this.controlsTimeoutId);
    }

    var self = this;
    this.controlsTimeoutId = setTimeout(function () {
      self.hideControls();
    }, 4500);
  },

  hideControls: function () {
    if (!this.isPlaying || this.isPaused) return;

    var bar = document.getElementById('castControlsBar');
    var topBar = document.getElementById('playerTopBar');

    if (bar) bar.className = 'cast-controls-bar controls-hidden';
    if (topBar) topBar.style.opacity = '0';
  },

  seekOffset: function (seconds) {
    if (!this.videoElement) return;

    var cur = this.videoElement.currentTime || 0;
    var dur = this.videoElement.duration || this.trackDuration || 0;
    var target = cur + seconds;

    if (target < 0) target = 0;
    if (dur > 0 && target > dur) target = dur;

    try {
      this.videoElement.currentTime = target;
    } catch (e) {}

    this.showControls();
  },

  onProgressClick: function (event) {
    if (!this.videoElement) return;

    var wrap = document.getElementById('castProgressWrap');
    if (!wrap) return;

    var rect = wrap.getBoundingClientRect();
    var clickX = (event.clientX || event.pageX) - rect.left;
    var pct = Math.max(0, Math.min(1, clickX / rect.width));

    var dur = this.videoElement.duration || this.trackDuration || 0;
    if (dur > 0) {
      try {
        this.videoElement.currentTime = pct * dur;
      } catch (e) {}
    }

    this.showControls();
  },

  /* ------------------------------------------------------------------------
     Video Events
     ------------------------------------------------------------------------ */
  bindVideoEvents: function () {
    var self = this;
    if (!this.videoElement) return;

    this.videoElement.addEventListener('timeupdate', function () {
      if (!self.videoElement) return;

      var cur = self.videoElement.currentTime;
      var dur = self.videoElement.duration || self.trackDuration || 0;

      // If playback is advancing, hide buffering indicator immediately
      if (cur > 0) {
        var badge = document.getElementById('playerBufferingBadge');
        if (badge && badge.style.display !== 'none' && badge.innerHTML.indexOf('error') === -1) {
          badge.style.display = 'none';
        }
      }

      var curEl = document.getElementById('castTimeCurrent');
      if (curEl) curEl.innerHTML = self.formatTime(cur);

      var totalEl = document.getElementById('castTimeTotal');
      if (totalEl && dur > 0) totalEl.innerHTML = self.formatTime(dur);

      var fill = document.getElementById('castProgressFill');
      if (fill && dur > 0) {
        var pct = Math.min(100, (cur / dur) * 100);
        fill.style.width = pct + '%';
      }
    });

    this.videoElement.addEventListener('loadstart', function () {
      self.log('Video loadstart');
      var badge = document.getElementById('playerBufferingBadge');
      if (badge) {
        badge.innerHTML = 'CONNECTING...';
        badge.style.display = 'inline-block';
        badge.style.backgroundColor = '#f59e0b';
        badge.style.color = '#000000';
      }
    });

    this.videoElement.addEventListener('loadeddata', function () {
      self.log('Video loadeddata event fired');
      var badge = document.getElementById('playerBufferingBadge');
      if (badge) badge.style.display = 'none';
    });

    this.videoElement.addEventListener('canplay', function () {
      self.log('Video canplay event fired');
      var badge = document.getElementById('playerBufferingBadge');
      if (badge) badge.style.display = 'none';
      self.showControls();
    });

    this.videoElement.addEventListener('waiting', function () {
      self.log('Video buffering');
      var badge = document.getElementById('playerBufferingBadge');
      if (badge) {
        badge.innerHTML = 'BUFFERING...';
        badge.style.display = 'inline-block';
      }
    });

    this.videoElement.addEventListener('playing', function () {
      self.log('Video playing event fired');
      var badge = document.getElementById('playerBufferingBadge');
      if (badge) badge.style.display = 'none';
      self.showControls();
    });

    this.videoElement.addEventListener('ended', function () {
      self.log('Video ended event fired -> advancing to next item');
      self.sendNext();
    });

    this.videoElement.addEventListener('stalled', function () {
      self.log('Video stalled');
      var badge = document.getElementById('playerBufferingBadge');
      if (badge && (!self.videoElement || self.videoElement.currentTime === 0)) {
        badge.innerHTML = 'WAITING STREAM...';
        badge.style.display = 'inline-block';
      }
    });

    this.videoElement.addEventListener('error', function () {
      var err = self.videoElement.error ? self.videoElement.error.code : 0;
      var reason = 'Stream error';
      if (err === 1) reason = 'Aborted';
      else if (err === 2) reason = 'Network failed';
      else if (err === 3) reason = 'Decode failed';
      else if (err === 4) reason = 'Format not supported';
      var errMsg = reason + ' (' + err + ')';
      self.log('Video error encountered: ' + errMsg);

      var badge = document.getElementById('playerBufferingBadge');
      if (badge) {
        badge.innerHTML = errMsg;
        badge.style.display = 'inline-block';
        badge.style.backgroundColor = '#ef4444';
        badge.style.color = '#ffffff';
      }
      self.showControls();
    });
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
    this.showControls();
  },

  sendNext: function () {
    this.log('Sending NEXT command to server');
    var self = this;
    this.sendPostCommand('/next', function () {
      self.pollStatus();
    });
    this.showControls();
  },

  sendPrevious: function () {
    this.log('Sending PREVIOUS command to server');
    var self = this;
    this.sendPostCommand('/previous', function () {
      self.pollStatus();
    });
    this.showControls();
  },

  /* ------------------------------------------------------------------------
     Remote Control & Keyboard Handling
     ------------------------------------------------------------------------ */
  installKeyHandler: function () {
    var self = this;

    document.onkeydown = function (event) {
      event = event || window.event;
      var code = event.keyCode;

      var KEY_RETURN = (tvKey && tvKey.KEY_RETURN) ? tvKey.KEY_RETURN : 10009;
      var KEY_EXIT = (tvKey && tvKey.KEY_EXIT) ? tvKey.KEY_EXIT : 10182;
      var KEY_STOP = (tvKey && tvKey.KEY_STOP) ? tvKey.KEY_STOP : 70;
      var KEY_PLAY = (tvKey && tvKey.KEY_PLAY) ? tvKey.KEY_PLAY : 71;
      var KEY_PAUSE = (tvKey && tvKey.KEY_PAUSE) ? tvKey.KEY_PAUSE : 74;
      var KEY_PLAY_PAUSE = (tvKey && tvKey.KEY_PLAY_PAUSE) ? tvKey.KEY_PLAY_PAUSE : 10252;
      var KEY_FF = (tvKey && tvKey.KEY_FF) ? tvKey.KEY_FF : 72;
      var KEY_RW = (tvKey && tvKey.KEY_RW) ? tvKey.KEY_RW : 69;

      /* 1. Return / Back / Exit */
      if (code === KEY_RETURN || code === KEY_EXIT || code === 27 || code === 8) {
        if (self.isPlaying) {
          self.sendStop();
          if (event.preventDefault) event.preventDefault();
          event.returnValue = false;
          return false;
        } else {
          if (widgetAPI && widgetAPI.sendReturnEvent) {
            widgetAPI.sendReturnEvent();
            if (event.preventDefault) event.preventDefault();
            event.returnValue = false;
            return false;
          }
        }
      }

      /* 2. Stop Key */
      if (code === KEY_STOP || code === 413 || code === 83) {
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

      /* 4. Seek +10s (Right Arrow or FastForward) */
      if (code === KEY_FF || code === 417 || code === 10253 || code === 39) {
        if (self.isPlaying) {
          self.seekOffset(10);
          if (event.preventDefault) event.preventDefault();
          event.returnValue = false;
          return false;
        }
      }

      /* 5. Seek -10s (Left Arrow or Rewind) */
      if (code === KEY_RW || code === 412 || code === 10254 || code === 37) {
        if (self.isPlaying) {
          self.seekOffset(-10);
          if (event.preventDefault) event.preventDefault();
          event.returnValue = false;
          return false;
        }
      }

      /* 6. Up / Down arrows: Wake up controls */
      if (code === 38 || code === 40) {
        self.showControls();
        if (event.preventDefault) event.preventDefault();
        event.returnValue = false;
        return false;
      }

      return true;
    };
  }
};
