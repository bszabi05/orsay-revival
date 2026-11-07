/*
 * Music TV Client - Main Application Controller (Spotify TV Style with Autoplay & Up Next)
 *
 * Platform: Samsung Smart TV (Orsay OS 2012-2015, WebKit 534/537)
 * Strict ES5 syntax:
 *   - Only 'var' and 'function' declarations
 *   - Strictly NO let, const, arrow functions, classes, promises, fetch, or template literals
 *   - Strictly NO setInterval (memory protection against WebKit 534/537 OOM)
 *   - Recursive setTimeout and XMLHttpRequest for asynchronous operations
 */

/* ==========================================================================
   Global Configuration & Hardware APIs
   ========================================================================== */

var SERVER_URL = ((typeof AppConfig !== 'undefined' && AppConfig.serverUrl) ?
                 AppConfig.serverUrl : 'http://127.0.0.1:7833').replace(/\/+$/, '');

var widgetAPI = null;
var tvKey = null;
var pluginAPI = null;

try {
  if (typeof Common !== 'undefined' && Common.API && Common.API.Widget) {
    widgetAPI = new Common.API.Widget();
  }
} catch (widgetErr) {}

try {
  if (typeof Common !== 'undefined' && Common.API && Common.API.TVKeyValue) {
    tvKey = new Common.API.TVKeyValue();
  }
} catch (keyErr) {}

try {
  if (typeof Common !== 'undefined' && Common.API && Common.API.Plugin) {
    pluginAPI = new Common.API.Plugin();
  }
} catch (pluginErr) {}

/* ==========================================================================
   Main Application Object
   ========================================================================== */

var App = {
  currentView: 'search',          // 'search' | 'player'
  focusTarget: 'pills',           // 'input' | 'pills' | 'cards' | 'miniplayer'
  playerTab: 'lyrics',            // 'lyrics' | 'queue'
  playerFocus: 'controls',        // 'controls' | 'queue'
  activePillIndex: 0,
  selectedPillIndex: 0,
  activeCardIndex: 0,
  activeQueueIndex: 0,
  searchResults: [],
  recommendedTracks: [],
  currentVideoId: '',
  currentContentKey: '',
  ime: null,
  currentLyricsRaw: '',
  lyricsList: [],
  activeLyricIndex: -1,
  pollTimeoutId: null,
  isPollingActive: false,
  isPlaying: false,
  isPaused: false,
  trackDuration: 0,
  videoElement: null,

  pills: [
    { query: 'Top Hits', name: 'Top Hits' },
    { query: 'Pop Hits', name: 'Pop' },
    { query: 'Rock Classics', name: 'Rock' },
    { query: 'Hip-Hop', name: 'Hip-Hop' },
    { query: 'Chill Vibes', name: 'Chill' },
    { query: 'Hungarian Hits', name: 'Magyar Dalok' }
  ],

  /* ------------------------------------------------------------------------
     Initialization
     ------------------------------------------------------------------------ */
  init: function () {
    this.videoElement = document.getElementById('music-player');

    this.initIme();
    this.installKeyHandler();
    this.registerKeys();
    this.bindVideoEvents();

    /* Signal Orsay runtime that widget is ready */
    if (widgetAPI && widgetAPI.sendReadyEvent) {
      widgetAPI.sendReadyEvent();
    }

    /* Start with first genre pill selected and load initial popular tracks */
    this.selectPill(0, false);

    /* Start background status polling */
    this.pollStatus();
  },

  initIme: function () {
    var self = this;
    if (typeof IMEShell === 'undefined') {
      this.log('IMEShell is not defined in this environment (PC/browser)');
      return;
    }

    try {
      this.ime = new IMEShell('search-input', function () {
        self.log('Samsung TV IME ready callback fired');
        if (!self.ime) return;

        if (self.ime.setEnterFunc) {
          self.ime.setEnterFunc(function () {
            self.submitSearch();
          });
        }

        if (self.ime.setKeyFunc) {
          var KEY_DOWN = (tvKey && tvKey.KEY_DOWN) ? tvKey.KEY_DOWN : 40;
          var KEY_RETURN = (tvKey && tvKey.KEY_RETURN) ? tvKey.KEY_RETURN : 10009;

          self.ime.setKeyFunc(KEY_DOWN, function () {
            self.blurInput();
            self.setPillFocus(self.activePillIndex);
            return false;
          });

          self.ime.setKeyFunc(KEY_RETURN, function () {
            self.blurInput();
            return false;
          });
        }
      }, 'en');
    } catch (imeErr) {
      this.log('Failed to instantiate IMEShell: ' + imeErr);
    }
  },

  registerKeys: function () {
    if (!pluginAPI || !pluginAPI.registKey) return;

    if (tvKey) {
      for (var k in tvKey) {
        if (tvKey.hasOwnProperty(k) && typeof tvKey[k] === 'number') {
          var val = tvKey[k];
          // Skip standard alphanumeric characters so input typing is NOT blocked by Orsay
          if ((val >= 48 && val <= 57) || (val >= 65 && val <= 90) || (val >= 97 && val <= 122)) {
            continue;
          }
          try {
            pluginAPI.registKey(val);
          } catch (e1) {}
        }
      }
    }

    // Only register essential remote navigation and media keys
    var navKeys = [
      8, 13, 27, 32, 33, 34, 37, 38, 39, 40,
      404, 412, 413, 415, 417, 10009, 10182, 10252, 10253, 10254
    ];
    for (var i = 0; i < navKeys.length; i++) {
      try {
        pluginAPI.registKey(navKeys[i]);
      } catch (e2) {}
    }
  },

  log: function (msg) {
    if (window.console && window.console.log) {
      window.console.log('[MusicTV] ' + msg);
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
     Focus & Navigation Management
     ------------------------------------------------------------------------ */
  focusSearchInput: function () {
    this.setInputFocus();
  },

  setInputFocus: function () {
    this.focusTarget = 'input';
    var input = document.getElementById('search-input');
    if (input) {
      input.className = 'active';
      if (this.ime && this.ime.focus) {
        try {
          this.ime.focus();
        } catch (fErr) {
          try { input.focus(); } catch (e) {}
        }
      } else {
        try { input.focus(); } catch (e) {}
      }
    }

    this.clearCardFocus();
    this.clearPillFocus();
    this.clearMiniPlayerFocus();
  },

  blurInput: function () {
    var input = document.getElementById('search-input');
    if (this.ime && this.ime.blur) {
      try { this.ime.blur(); } catch (e) {}
    }
    if (input) {
      input.className = '';
      try { input.blur(); } catch (e) {}
    }
  },

  submitSearch: function () {
    var input = document.getElementById('search-input');
    var query = '';
    if (this.ime && this.ime.getText) {
      try { query = this.ime.getText(); } catch (e) {}
    }
    if (!query && input) {
      query = input.value;
    }
    this.blurInput();
    if (query && query.trim()) {
      this.searchMusic(query.trim());
    }
  },

  onSearchBtnClick: function () {
    this.submitSearch();
  },

  clearCardFocus: function () {
    var cards = document.querySelectorAll('.song-card');
    for (var i = 0; i < cards.length; i++) {
      cards[i].className = 'song-card';
    }
  },

  clearPillFocus: function () {
    for (var i = 0; i < this.pills.length; i++) {
      var p = document.getElementById('pill-' + i);
      if (p) {
        var base = (i === this.selectedPillIndex) ? 'filter-pill active-pill' : 'filter-pill';
        p.className = base;
      }
    }
  },

  clearMiniPlayerFocus: function () {
    var mini = document.getElementById('mini-player-bar');
    if (mini) {
      mini.className = 'mini-player-bar';
    }
  },

  setPillFocus: function (index) {
    if (index < 0) index = 0;
    if (index >= this.pills.length) index = this.pills.length - 1;

    this.focusTarget = 'pills';
    this.activePillIndex = index;

    this.blurInput();
    this.clearCardFocus();
    this.clearMiniPlayerFocus();
    this.clearPillFocus();

    var targetPill = document.getElementById('pill-' + index);
    if (targetPill) {
      var isSelected = (index === this.selectedPillIndex);
      targetPill.className = isSelected ? 'filter-pill active-pill focused-pill' : 'filter-pill focused-pill';
    }
  },

  selectPill: function (index, keepCurrentFocus) {
    if (index < 0 || index >= this.pills.length) return;
    this.selectedPillIndex = index;

    for (var i = 0; i < this.pills.length; i++) {
      var p = document.getElementById('pill-' + i);
      if (p) {
        p.className = (i === index) ? 'filter-pill active-pill' : 'filter-pill';
      }
    }

    if (!keepCurrentFocus) {
      this.setPillFocus(index);
    }

    var selected = this.pills[index];
    this.searchMusic(selected.query, selected.name);
  },

  setCardFocus: function (index) {
    if (!this.searchResults || this.searchResults.length === 0) {
      this.setPillFocus(this.activePillIndex);
      return;
    }

    if (index < 0) index = 0;
    if (index >= this.searchResults.length) index = this.searchResults.length - 1;

    this.activeCardIndex = index;
    this.focusTarget = 'cards';

    this.blurInput();
    this.clearPillFocus();
    this.clearCardFocus();
    this.clearMiniPlayerFocus();

    var targetCard = document.getElementById('card-' + index);
    if (targetCard) {
      targetCard.className = 'song-card active';
    }

    /* Scroll grid so active row is visible (4 cards per row, card height 240px + margin 14px = 254px) */
    var row = Math.floor(index / 4);
    var translateY = row * 254;
    var grid = document.getElementById('results-grid');
    if (grid) {
      grid.style.webkitTransform = 'translate3d(0, -' + translateY + 'px, 0)';
      grid.style.transform = 'translate3d(0, -' + translateY + 'px, 0)';
    }
  },

  setMiniPlayerFocus: function () {
    if (!this.isPlaying) return;

    this.focusTarget = 'miniplayer';

    this.blurInput();
    this.clearCardFocus();
    this.clearPillFocus();

    var mini = document.getElementById('mini-player-bar');
    if (mini) {
      mini.className = 'mini-player-bar active-focus';
    }
  },

  /* ------------------------------------------------------------------------
     View Switching & Player Tabs (Lyrics vs Up Next)
     ------------------------------------------------------------------------ */
  showSearchView: function () {
    this.currentView = 'search';
    var searchView = document.getElementById('search-view');
    var playerView = document.getElementById('player-view');

    if (playerView) playerView.style.display = 'none';
    if (searchView) searchView.style.display = 'block';

    this.updateMiniPlayerVisibility();

    if (this.searchResults && this.searchResults.length > 0) {
      this.setCardFocus(this.activeCardIndex);
    } else {
      this.setPillFocus(this.activePillIndex);
    }
  },

  showPlayerView: function (track) {
    this.blurInput();
    this.currentView = 'player';
    var searchView = document.getElementById('search-view');
    var playerView = document.getElementById('player-view');

    if (searchView) searchView.style.display = 'none';
    if (playerView) playerView.style.display = 'block';

    if (track) {
      this.updatePlayerMetadata(track.title, track.artist, track.thumbnail);
    }

    var badge = document.getElementById('player-badge');
    if (badge) badge.innerHTML = 'CONNECTING...';

    /* Default to Lyrics tab on open */
    this.switchPlayerTab(this.playerTab || 'lyrics');

    var pauseIndicator = document.getElementById('player-pause-indicator');
    if (pauseIndicator) pauseIndicator.style.display = 'none';
  },

  switchPlayerTab: function (targetTab) {
    this.playerTab = (targetTab === 'queue') ? 'queue' : 'lyrics';

    var tabLyrics = document.getElementById('tab-lyrics');
    var tabQueue = document.getElementById('tab-queue');
    var lyricsWin = document.getElementById('lyrics-window');
    var queueWin = document.getElementById('queue-window');
    var maskTop = document.getElementById('lyrics-mask-top');
    var maskBottom = document.getElementById('lyrics-mask-bottom');

    if (this.playerTab === 'queue') {
      if (tabLyrics) tabLyrics.className = 'header-tab';
      if (tabQueue) tabQueue.className = 'header-tab active-tab';
      if (lyricsWin) lyricsWin.style.display = 'none';
      if (queueWin) queueWin.style.display = 'block';
      if (maskTop) maskTop.style.display = 'none';
      if (maskBottom) maskBottom.style.display = 'none';

      this.playerFocus = 'queue';
      this.setQueueFocus(this.activeQueueIndex || 0);
    } else {
      if (tabLyrics) tabLyrics.className = 'header-tab active-tab';
      if (tabQueue) tabQueue.className = 'header-tab';
      if (lyricsWin) lyricsWin.style.display = 'block';
      if (queueWin) queueWin.style.display = 'none';
      if (maskTop) maskTop.style.display = 'block';
      if (maskBottom) maskBottom.style.display = 'block';

      this.playerFocus = 'controls';
      this.clearQueueFocus();
    }
  },

  setQueueFocus: function (index) {
    if (!this.recommendedTracks || this.recommendedTracks.length === 0) return;

    if (index < 0) index = 0;
    if (index >= this.recommendedTracks.length) index = this.recommendedTracks.length - 1;

    this.activeQueueIndex = index;
    this.playerFocus = 'queue';

    var items = document.querySelectorAll('.queue-item');
    for (var i = 0; i < items.length; i++) {
      items[i].className = 'queue-item';
    }

    var target = document.getElementById('queue-item-' + index);
    if (target) {
      target.className = 'queue-item active';
    }

    /* Scroll queue list smoothly: item height 56px + 8px margin = 64px */
    var translateY = Math.max(0, (index - 2) * 64);
    var container = document.getElementById('queue-container');
    if (container) {
      container.style.webkitTransform = 'translate3d(0, -' + translateY + 'px, 0)';
      container.style.transform = 'translate3d(0, -' + translateY + 'px, 0)';
    }
  },

  clearQueueFocus: function () {
    var items = document.querySelectorAll('.queue-item');
    for (var i = 0; i < items.length; i++) {
      items[i].className = 'queue-item';
    }
  },

  updatePlayerMetadata: function (title, artist, thumbnail) {
    var titleEl = document.getElementById('player-title');
    var artistEl = document.getElementById('player-artist');
    var coverEl = document.getElementById('player-cover');
    var bgEl = document.getElementById('player-bg');

    var miniTitle = document.getElementById('mini-title');
    var miniArtist = document.getElementById('mini-artist');
    var miniCover = document.getElementById('mini-cover');

    if (title) {
      if (titleEl) titleEl.innerHTML = this.escapeHtml(title);
      if (miniTitle) miniTitle.innerHTML = this.escapeHtml(title);
    }

    if (artist) {
      if (artistEl) artistEl.innerHTML = this.escapeHtml(artist);
      if (miniArtist) miniArtist.innerHTML = this.escapeHtml(artist);
    }

    if (thumbnail) {
      if (coverEl) coverEl.src = thumbnail;
      if (miniCover) miniCover.src = thumbnail;
      if (bgEl) bgEl.style.backgroundImage = 'url(' + thumbnail + ')';
    }
  },

  updateMiniPlayerVisibility: function () {
    var mini = document.getElementById('mini-player-bar');
    var footer = document.getElementById('search-footer');

    if (this.currentView === 'search') {
      if (this.isPlaying) {
        if (mini) mini.style.display = 'block';
        if (footer) footer.style.display = 'none';
      } else {
        if (mini) mini.style.display = 'none';
        if (footer) footer.style.display = 'block';
      }
    }
  },

  /* ------------------------------------------------------------------------
     Music Search (XHR GET /api/music/search?q=...)
     ------------------------------------------------------------------------ */
  searchMusic: function (query, headingText) {
    var self = this;
    if (!query) {
      var input = document.getElementById('search-input');
      query = input ? input.value : '';
    }

    query = (query || '').replace(/^\s+|\s+$/g, '');
    if (!query) {
      var statusEl = document.getElementById('search-status');
      if (statusEl) statusEl.innerHTML = 'Please enter a song or artist name!';
      return;
    }

    var headingEl = document.getElementById('results-heading');
    if (headingEl) {
      headingEl.innerHTML = this.escapeHtml(headingText || query);
    }

    var statusLine = document.getElementById('search-status');
    if (statusLine) {
      statusLine.innerHTML = 'Searching for "' + this.escapeHtml(query) + '"...';
    }

    var xhr = new XMLHttpRequest();
    var url = SERVER_URL + '/api/music/search?q=' + encodeURIComponent(query);

    xhr.open('GET', url, true);
    xhr.setRequestHeader('Accept', 'application/json');

    xhr.onreadystatechange = function () {
      if (xhr.readyState !== 4) return;

      if (xhr.status === 200) {
        try {
          var tracks = JSON.parse(xhr.responseText);
          self.renderResults(tracks, query);
        } catch (jsonErr) {
          self.log('Search JSON parse error: ' + jsonErr);
          if (statusLine) statusLine.innerHTML = 'Error parsing response.';
        }
      } else {
        self.log('Search HTTP error: ' + xhr.status);
        if (statusLine) {
          statusLine.innerHTML = 'Search failed (HTTP ' + xhr.status + ').';
        }
      }
    };

    try {
      xhr.send(null);
    } catch (sendErr) {
      self.log('Search XHR send error: ' + sendErr);
      if (statusLine) statusLine.innerHTML = 'Network error during search.';
    }
  },

  renderResults: function (tracks, query) {
    this.searchResults = tracks || [];
    var grid = document.getElementById('results-grid');
    var statusLine = document.getElementById('search-status');

    if (!grid) return;

    /* Reset grid scroll position */
    grid.style.webkitTransform = 'translate3d(0, 0, 0)';
    grid.style.transform = 'translate3d(0, 0, 0)';

    if (!tracks || tracks.length === 0) {
      grid.innerHTML = '<div class="results-placeholder">' +
        '<div class="placeholder-icon">&#9834;</div>' +
        '<div class="placeholder-text">No tracks found for "' + this.escapeHtml(query) + '". Try another genre!</div>' +
        '</div>';
      if (statusLine) statusLine.innerHTML = 'No tracks found.';
      return;
    }

    var html = '';
    for (var i = 0; i < tracks.length; i++) {
      var track = tracks[i];
      var thumb = track.thumbnail ? track.thumbnail : 'icon.png';

      html += '<div id="card-' + i + '" class="song-card" data-index="' + i + '" onclick="App.onCardClick(' + i + ')">' +
        '<div class="card-thumb-wrap">' +
        '<img class="card-thumb" src="' + this.escapeHtml(thumb) + '" alt="" onerror="this.src=\'icon.png\';" />' +
        '<div class="card-play-btn">&#9658;</div>' +
        '</div>' +
        '<div class="card-title">' + this.escapeHtml(track.title || 'Untitled') + '</div>' +
        '<div class="card-artist">' + this.escapeHtml(track.artist || 'Unknown Artist') + '</div>' +
        '</div>';
    }

    grid.innerHTML = html;

    if (statusLine) {
      statusLine.innerHTML = tracks.length + ' tracks available';
    }
  },

  onCardClick: function (index) {
    this.setCardFocus(index);
    if (this.searchResults && this.searchResults[index]) {
      var selected = this.searchResults[index];
      this.castMusic(selected.videoId, selected);
    }
  },

  onPillClick: function (index) {
    this.selectPill(index, false);
  },

  onSearchBtnClick: function () {
    var input = document.getElementById('search-input');
    var q = input ? input.value : '';
    this.searchMusic(q);
  },

  onGridWheel: function (event) {
    event = event || window.event;
    var delta = event.deltaY || event.detail || (-event.wheelDelta);
    if (delta > 0) {
      this.scrollGrid(1);
    } else if (delta < 0) {
      this.scrollGrid(-1);
    }
    if (event.preventDefault) event.preventDefault();
    return false;
  },

  scrollGrid: function (direction) {
    if (!this.searchResults || this.searchResults.length === 0) return;
    var newIndex = this.activeCardIndex + (direction * 4);
    if (newIndex < 0) newIndex = 0;
    if (newIndex >= this.searchResults.length) newIndex = this.searchResults.length - 1;
    this.setCardFocus(newIndex);
  },

  onQueueWheel: function (event) {
    event = event || window.event;
    var delta = event.deltaY || event.detail || (-event.wheelDelta);
    if (delta > 0) {
      if (this.activeQueueIndex < this.recommendedTracks.length - 1) {
        this.setQueueFocus(this.activeQueueIndex + 1);
      }
    } else if (delta < 0) {
      if (this.activeQueueIndex > 0) {
        this.setQueueFocus(this.activeQueueIndex - 1);
      }
    }
    if (event.preventDefault) event.preventDefault();
    return false;
  },

  /* ------------------------------------------------------------------------
     YouTube Music Recommendations & Up Next (XHR GET /api/music/related)
     ------------------------------------------------------------------------ */
  fetchRecommendations: function (videoId) {
    var self = this;
    if (!videoId) return;

    var xhr = new XMLHttpRequest();
    var url = SERVER_URL + '/api/music/related?videoId=' + encodeURIComponent(videoId) + '&limit=15';

    xhr.open('GET', url, true);
    xhr.setRequestHeader('Accept', 'application/json');

    xhr.onreadystatechange = function () {
      if (xhr.readyState !== 4) return;

      if (xhr.status === 200) {
        try {
          var recs = JSON.parse(xhr.responseText);
          self.recommendedTracks = recs || [];
          self.renderQueueList();
        } catch (err) {
          self.log('Recommendations parse error: ' + err);
        }
      }
    };

    try {
      xhr.send(null);
    } catch (e) {
      self.log('Failed to fetch recommendations: ' + e);
    }
  },

  renderQueueList: function () {
    var container = document.getElementById('queue-container');
    var badge = document.getElementById('queue-badge');

    if (badge) {
      badge.innerHTML = this.recommendedTracks ? this.recommendedTracks.length : '0';
    }

    if (!container) return;

    if (!this.recommendedTracks || this.recommendedTracks.length === 0) {
      container.innerHTML = '<div class="queue-placeholder">No upcoming recommended tracks.</div>';
      return;
    }

    var html = '';
    for (var i = 0; i < this.recommendedTracks.length; i++) {
      var item = this.recommendedTracks[i];
      var thumb = item.thumbnail ? item.thumbnail : 'icon.png';

      html += '<div id="queue-item-' + i + '" class="queue-item" onclick="App.playQueueItem(' + i + ')">' +
        '<img class="queue-item-thumb" src="' + this.escapeHtml(thumb) + '" alt="" onerror="this.src=\'icon.png\';" />' +
        '<div class="queue-item-info">' +
        '<div class="queue-item-title">' + this.escapeHtml(item.title || 'Untitled') + '</div>' +
        '<div class="queue-item-artist">' + this.escapeHtml(item.artist || 'Unknown Artist') + '</div>' +
        '</div>' +
        '<div class="queue-item-play">&#9658;</div>' +
        '</div>';
    }

    container.innerHTML = html;

    if (this.playerTab === 'queue') {
      this.setQueueFocus(this.activeQueueIndex || 0);
    }
  },

  playQueueItem: function (index) {
    if (!this.recommendedTracks || !this.recommendedTracks[index]) return;

    var selected = this.recommendedTracks[index];

    /* Prune tracks up to this selection from upcoming list */
    this.recommendedTracks.splice(0, index + 1);
    this.renderQueueList();

    this.castMusic(selected.videoId, selected);
  },

  /* Autoplay: seamlessly advances to next recommended song */
  playNextAuto: function () {
    this.log('playNextAuto triggered');
    if (this.recommendedTracks && this.recommendedTracks.length > 0) {
      var nextTrack = this.recommendedTracks.shift();
      this.renderQueueList();
      this.castMusic(nextTrack.videoId, nextTrack);
    } else {
      /* Fallback to server playlist queue */
      this.nextTrack();
    }
  },

  /* ------------------------------------------------------------------------
     Music Playback (XHR POST /cast)
     ------------------------------------------------------------------------ */
  castMusic: function (videoId, trackInfo) {
    var self = this;
    if (!videoId) return;

    this.currentVideoId = videoId;
    this.currentContentKey = '';
    this.currentLyricsRaw = '';
    this.lyricsList = [];
    this.activeLyricIndex = -1;
    this.isPlaying = true;
    this.isPaused = false;

    this.showPlayerView(trackInfo);

    /* Fetch intelligent Up Next recommendations in background */
    this.fetchRecommendations(videoId);

    var targetUrl = 'https://music.youtube.com/watch?v=' + videoId;
    var xhr = new XMLHttpRequest();
    xhr.open('POST', SERVER_URL + '/cast', true);
    xhr.setRequestHeader('Content-Type', 'application/json');

    xhr.onreadystatechange = function () {
      if (xhr.readyState === 4) {
        self.log('Cast response: ' + xhr.status);
        self.pollStatus();
      }
    };

    var payload = JSON.stringify({
      url: targetUrl,
      type: 'music',
      play_now: true
    });

    try {
      xhr.send(payload);
    } catch (castErr) {
      self.log('Failed to POST cast request: ' + castErr);
    }
  },

  stopMusic: function () {
    this.log('Stopping music playback');
    var self = this;

    this.currentContentKey = '';
    this.currentLyricsRaw = '';
    this.lyricsList = [];
    this.activeLyricIndex = -1;
    this.isPlaying = false;
    this.isPaused = false;

    /* Stop video element and free hardware decoder memory */
    if (this.videoElement) {
      try {
        this.videoElement.pause();
      } catch (pErr) {}
      this.videoElement.src = '';
      this.videoElement.removeAttribute('src');
      try {
        this.videoElement.load();
      } catch (lErr) {}
    }
    this.currentVideoId = '';
    this.recommendedTracks = [];

    var xhr = new XMLHttpRequest();
    xhr.open('POST', SERVER_URL + '/stop', true);
    xhr.setRequestHeader('Content-Type', 'application/json');
    try {
      xhr.send('{}');
    } catch (stopErr) {}

    this.updateMiniPlayerVisibility();
    this.showSearchView();
  },

  sendPlayPause: function () {
    var self = this;
    var xhr = new XMLHttpRequest();
    xhr.open('POST', SERVER_URL + '/playpause', true);
    xhr.setRequestHeader('Content-Type', 'application/json');

    xhr.onreadystatechange = function () {
      if (xhr.readyState === 4 && xhr.status === 200) {
        try {
          var data = JSON.parse(xhr.responseText);
          self.handlePauseSync(data.playback_state === 'paused');
        } catch (e) {}
      }
    };

    try {
      xhr.send('{}');
    } catch (err) {}
  },

  nextTrack: function () {
    this.log('Skipping to next track');
    var self = this;
    var xhr = new XMLHttpRequest();
    xhr.open('POST', SERVER_URL + '/next', true);
    xhr.setRequestHeader('Content-Type', 'application/json');

    xhr.onreadystatechange = function () {
      if (xhr.readyState === 4) {
        self.currentLyricsRaw = '';
        self.lyricsList = [];
        self.pollStatus();
      }
    };

    try {
      xhr.send('{}');
    } catch (err) {}
  },

  previousTrack: function () {
    this.log('Going to previous track');
    var self = this;
    var xhr = new XMLHttpRequest();
    xhr.open('POST', SERVER_URL + '/previous', true);
    xhr.setRequestHeader('Content-Type', 'application/json');

    xhr.onreadystatechange = function () {
      if (xhr.readyState === 4) {
        self.currentLyricsRaw = '';
        self.lyricsList = [];
        self.pollStatus();
      }
    };

    try {
      xhr.send('{}');
    } catch (err) {}
  },

  handlePauseSync: function (serverPaused) {
    var isPaused = !!serverPaused;
    this.isPaused = isPaused;

    var pauseIndicator = document.getElementById('player-pause-indicator');
    var badge = document.getElementById('player-badge');
    var playSymbol = document.getElementById('play-symbol');
    var miniPlayBtn = document.getElementById('mini-play-btn');

    if (isPaused) {
      if (pauseIndicator) pauseIndicator.style.display = 'block';
      if (badge) badge.innerHTML = 'PAUSED';
      if (playSymbol) playSymbol.innerHTML = '&#9658;';
      if (miniPlayBtn) miniPlayBtn.innerHTML = '&#9658;';

      if (this.videoElement) {
        try {
          this.videoElement.pause();
        } catch (e) {}
      }
    } else {
      if (pauseIndicator) pauseIndicator.style.display = 'none';
      if (badge) badge.innerHTML = 'PLAYING';
      if (playSymbol) playSymbol.innerHTML = '&#10074;&#10074;';
      if (miniPlayBtn) miniPlayBtn.innerHTML = '&#10074;&#10074;';

      if (this.videoElement) {
        try {
          this.videoElement.play();
        } catch (e) {}
      }
    }
  },

  /* ------------------------------------------------------------------------
     Synchronized Lyrics Parsing & UI Sync
     ------------------------------------------------------------------------ */
  parseLyrics: function (lrcString) {
    this.lyricsList = [];
    this.activeLyricIndex = -1;

    if (!lrcString) {
      this.renderLyrics(null);
      return;
    }

    var lines = lrcString.split(/\r?\n/);
    var hasTimestamps = false;
    var parsed = [];

    /* LRC format: [mm:ss.xx] or [mm:ss.xxx] */
    var timeRegex = /\[(\d{1,2}):(\d{2}(?:\.\d+)?)\]/g;

    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];
      if (!line) continue;

      timeRegex.lastIndex = 0;
      var match = timeRegex.exec(line);

      if (match) {
        hasTimestamps = true;
        var minutes = parseInt(match[1], 10);
        var seconds = parseFloat(match[2]);
        var timeSec = minutes * 60 + seconds;
        var text = line.replace(/\[\d{1,2}:\d{2}(?:\.\d+)?\]/g, '').replace(/^\s+|\s+$/g, '');

        if (text) {
          parsed.push({ time: timeSec, text: text });
        }
      } else {
        var cleanLine = line.replace(/^\s+|\s+$/g, '');
        if (cleanLine && cleanLine.charAt(0) !== '[') {
          parsed.push({ time: -1, text: cleanLine });
        }
      }
    }

    if (hasTimestamps) {
      /* Sort chronologically by timestamp */
      parsed.sort(function (a, b) {
        return a.time - b.time;
      });
    }

    this.lyricsList = parsed;
    this.renderLyrics(parsed);
  },

  renderLyrics: function (list) {
    var container = document.getElementById('lyrics-container');
    if (!container) return;

    if (!list || list.length === 0) {
      container.innerHTML = '<div class="lyrics-line placeholder-line">No synchronized lyrics available for this song.</div>';
      container.style.webkitTransform = 'translate3d(0, 0, 0)';
      container.style.transform = 'translate3d(0, 0, 0)';
      return;
    }

    var html = '';
    for (var i = 0; i < list.length; i++) {
      html += '<div id="lyric-line-' + i + '" class="lyrics-line" data-time="' + list[i].time + '">' +
        this.escapeHtml(list[i].text) +
        '</div>';
    }

    container.innerHTML = html;
    container.style.webkitTransform = 'translate3d(0, 0, 0)';
    container.style.transform = 'translate3d(0, 0, 0)';
  },

  updateLyricsSync: function (currentTime) {
    if (this.playerTab !== 'lyrics') return;
    if (!this.lyricsList || this.lyricsList.length === 0) return;
    if (this.lyricsList[0].time < 0) return; // Plain lyrics without timestamps

    var activeIdx = -1;
    for (var i = 0; i < this.lyricsList.length; i++) {
      if (this.lyricsList[i].time <= currentTime) {
        activeIdx = i;
      } else {
        break;
      }
    }

    if (activeIdx === this.activeLyricIndex) return;
    this.activeLyricIndex = activeIdx;

    /* Update active class on DOM lines */
    var lines = document.querySelectorAll('.lyrics-line');
    for (var j = 0; j < lines.length; j++) {
      if (j === activeIdx) {
        lines[j].className = 'lyrics-line active-line';
      } else {
        lines[j].className = 'lyrics-line';
      }
    }

    /* Scroll lyrics window to keep active line centered:
       Window height: 384px; Line height: 44px; Center = 192 - 22 = 170px */
    if (activeIdx >= 0) {
      var targetY = (activeIdx * 44) - 170;
      if (targetY < 0) targetY = 0;

      var container = document.getElementById('lyrics-container');
      if (container) {
        container.style.webkitTransform = 'translate3d(0, -' + targetY + 'px, 0)';
        container.style.transform = 'translate3d(0, -' + targetY + 'px, 0)';
      }
    }
  },

  /* ------------------------------------------------------------------------
     Video Events & Synchronization (with Autoplay)
     ------------------------------------------------------------------------ */
  bindVideoEvents: function () {
    var self = this;
    if (!this.videoElement) return;

    this.videoElement.addEventListener('timeupdate', function () {
      if (!self.videoElement) return;

      var cur = self.videoElement.currentTime;
      var dur = self.videoElement.duration || self.trackDuration || 0;

      /* Update lyrics line scroll */
      self.updateLyricsSync(cur);

      /* Update time labels */
      var curLabel = document.getElementById('time-current');
      if (curLabel) curLabel.innerHTML = self.formatTime(cur);

      var totalLabel = document.getElementById('time-total');
      if (totalLabel && dur > 0) totalLabel.innerHTML = self.formatTime(dur);

      /* Update progress scrubber bars */
      var pct = (dur > 0) ? Math.min(100, (cur / dur) * 100) : 0;
      var fill = document.getElementById('progress-bar-fill');
      if (fill) fill.style.width = pct + '%';

      var miniFill = document.getElementById('mini-progress-bar');
      if (miniFill) miniFill.style.width = pct + '%';
    });

    this.videoElement.addEventListener('loadstart', function () {
      self.log('Video stream loadstart');
      var badge = document.getElementById('player-badge');
      if (badge && !self.isPaused) badge.innerHTML = 'CONNECTING...';
    });

    this.videoElement.addEventListener('canplay', function () {
      self.log('Video stream canplay');
      var badge = document.getElementById('player-badge');
      if (badge && !self.isPaused) badge.innerHTML = 'READY';
    });

    this.videoElement.addEventListener('playing', function () {
      self.log('Video stream playing');
      var badge = document.getElementById('player-badge');
      if (badge && !self.isPaused) badge.innerHTML = 'PLAYING';
      self.handlePauseSync(false);
    });

    this.videoElement.addEventListener('waiting', function () {
      var badge = document.getElementById('player-badge');
      if (badge && !self.isPaused) badge.innerHTML = 'BUFFERING...';
    });

    /* AUTOPLAY: Next recommended track plays automatically upon track finish */
    this.videoElement.addEventListener('ended', function () {
      self.log('Track ended - auto-playing next recommended song');
      self.playNextAuto();
    });

    this.videoElement.addEventListener('error', function () {
      var err = self.videoElement.error ? self.videoElement.error.code : 'unknown';
      self.log('Video error encountered: ' + err);
      var badge = document.getElementById('player-badge');
      if (badge) badge.innerHTML = 'STREAM ERROR';
    });
  },

  /* ------------------------------------------------------------------------
     AJAX Status Polling (Recursive setTimeout, NO setInterval)
     ------------------------------------------------------------------------ */
  pollStatus: function () {
    var self = this;
    if (this.isPollingActive) return;

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
      if (xhr.readyState !== 4) return;

      var serverLabel = document.getElementById('server-status-label');

      if (xhr.status === 200) {
        try {
          var data = JSON.parse(xhr.responseText);
          if (serverLabel) serverLabel.innerHTML = 'Server: Connected';

          if (data.status === 'playing' || data.status === 'ready') {
            if (data.media_type === 'music') {
              self.isPlaying = true;

              if (data.duration) {
                self.trackDuration = data.duration;
              }

              /* Update metadata across player and mini-player */
              self.updatePlayerMetadata(data.title, data.artist, data.thumbnail);

              /* Check lyrics change */
              if (data.lyrics && data.lyrics !== self.currentLyricsRaw) {
                self.currentLyricsRaw = data.lyrics;
                self.parseLyrics(data.lyrics);
              }

              /* Start stream playback on video element if new track ready */
              var contentKey = (data.original_url || data.title || '') + '::' + (data.duration || '');
              if (self.currentContentKey !== contentKey) {
                self.currentContentKey = contentKey;
                var streamUrl = SERVER_URL + '/cast_stream.ts?_t=' + (new Date().getTime());
                self.log('Starting stream on video element: ' + streamUrl);
                if (self.videoElement) {
                  self.videoElement.src = streamUrl;
                  self.videoElement.volume = 1.0;
                  self.videoElement.muted = false;
                  try {
                    self.videoElement.load();
                  } catch (loadErr) {}
                  try {
                    self.videoElement.play();
                  } catch (playErr) {
                    self.log('Video play error: ' + playErr);
                  }
                }
              }

              self.handlePauseSync(data.playback_state === 'paused');
              self.updateMiniPlayerVisibility();
            }
          } else if (data.status === 'idle') {
            self.isPlaying = false;
            self.updateMiniPlayerVisibility();
          }
        } catch (jsonErr) {
          self.log('Status parse error: ' + jsonErr);
        }
      } else if (xhr.status === 204) {
        if (serverLabel) serverLabel.innerHTML = 'Server: Ready';
        self.isPlaying = false;
        self.updateMiniPlayerVisibility();
      } else {
        if (serverLabel) serverLabel.innerHTML = 'Server: Offline';
      }

      finalizePoll();
    };

    xhr.ontimeout = function () {
      var serverLabel = document.getElementById('server-status-label');
      if (serverLabel) serverLabel.innerHTML = 'Server: Timeout';
      finalizePoll();
    };

    xhr.onerror = function () {
      var serverLabel = document.getElementById('server-status-label');
      if (serverLabel) serverLabel.innerHTML = 'Server: Offline';
      finalizePoll();
    };

    try {
      xhr.send(null);
    } catch (err) {
      var serverLabel = document.getElementById('server-status-label');
      if (serverLabel) serverLabel.innerHTML = 'Server: Offline';
      finalizePoll();
    }
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
      var KEY_GREEN = (tvKey && tvKey.KEY_GREEN) ? tvKey.KEY_GREEN : 404;

      /* ====================================================================
         1. PLAYER VIEW KEY HANDLING
         ==================================================================== */
      if (self.currentView === 'player') {
        /* Back / Return -> Switch to Search view, keep background music playing! */
        if (code === KEY_RETURN || code === 27 || code === 8) {
          self.showSearchView();
          if (event.preventDefault) event.preventDefault();
          event.returnValue = false;
          return false;
        }

        /* Stop -> Stop stream and return to Search view */
        if (code === KEY_STOP || code === 83) {
          self.stopMusic();
          if (event.preventDefault) event.preventDefault();
          event.returnValue = false;
          return false;
        }

        /* Green Key / Tab (9) -> Switch between LYRICS and UP NEXT queue */
        if (code === KEY_GREEN || code === 9) {
          var nextTab = (self.playerTab === 'lyrics') ? 'queue' : 'lyrics';
          self.switchPlayerTab(nextTab);
          if (event.preventDefault) event.preventDefault();
          event.returnValue = false;
          return false;
        }

        /* Next Track (FastForward or Right arrow in lyrics view) */
        if (code === KEY_FF || code === 417 || code === 10253) {
          self.playNextAuto();
          if (event.preventDefault) event.preventDefault();
          event.returnValue = false;
          return false;
        }

        /* Previous Track (Rewind) */
        if (code === KEY_RW || code === 412 || code === 10254) {
          self.previousTrack();
          if (event.preventDefault) event.preventDefault();
          event.returnValue = false;
          return false;
        }

        /* Play / Pause Toggle */
        if (code === KEY_PLAY || code === KEY_PAUSE || code === KEY_PLAY_PAUSE || code === 32) {
          self.sendPlayPause();
          if (event.preventDefault) event.preventDefault();
          event.returnValue = false;
          return false;
        }

        /* Tab-specific Navigation */
        if (self.playerTab === 'queue') {
          if (code === 38) { // Up
            if (self.activeQueueIndex > 0) {
              self.setQueueFocus(self.activeQueueIndex - 1);
            }
            if (event.preventDefault) event.preventDefault();
            event.returnValue = false;
            return false;
          }

          if (code === 40) { // Down
            if (self.activeQueueIndex < self.recommendedTracks.length - 1) {
              self.setQueueFocus(self.activeQueueIndex + 1);
            }
            if (event.preventDefault) event.preventDefault();
            event.returnValue = false;
            return false;
          }

          if (code === 13) { // Enter -> Play selected queue item
            self.playQueueItem(self.activeQueueIndex);
            if (event.preventDefault) event.preventDefault();
            event.returnValue = false;
            return false;
          }

          if (code === 37) { // Left -> Switch back to Lyrics
            self.switchPlayerTab('lyrics');
            if (event.preventDefault) event.preventDefault();
            event.returnValue = false;
            return false;
          }
        } else {
          /* Lyrics Tab Navigation */
          if (code === 13) { // Enter -> Play / Pause
            self.sendPlayPause();
            if (event.preventDefault) event.preventDefault();
            event.returnValue = false;
            return false;
          }

          if (code === 39) { // Right -> Play next recommended track
            self.playNextAuto();
            if (event.preventDefault) event.preventDefault();
            event.returnValue = false;
            return false;
          }

          if (code === 37) { // Left -> Replay or previous track
            self.previousTrack();
            if (event.preventDefault) event.preventDefault();
            event.returnValue = false;
            return false;
          }

          if (code === 40) { // Down -> Open Up Next Queue
            self.switchPlayerTab('queue');
            if (event.preventDefault) event.preventDefault();
            event.returnValue = false;
            return false;
          }
        }

        return true;
      }

      /* ====================================================================
         2. SEARCH & BROWSE VIEW KEY HANDLING
         ==================================================================== */
      if (self.currentView === 'search') {
        /* A. Return / Exit Handling */
        if (code === KEY_RETURN || code === 27) {
          if (self.focusTarget === 'cards') {
            self.setPillFocus(self.activePillIndex);
            if (event.preventDefault) event.preventDefault();
            event.returnValue = false;
            return false;
          } else if (self.focusTarget === 'pills') {
            self.setInputFocus();
            if (event.preventDefault) event.preventDefault();
            event.returnValue = false;
            return false;
          } else if (self.focusTarget === 'miniplayer') {
            self.setCardFocus(self.activeCardIndex);
            if (event.preventDefault) event.preventDefault();
            event.returnValue = false;
            return false;
          } else {
            /* Input focused -> exit app */
            if (widgetAPI && widgetAPI.sendReturnEvent) {
              widgetAPI.sendReturnEvent();
              if (event.preventDefault) event.preventDefault();
              event.returnValue = false;
              return false;
            }
          }
        }

        /* Media Play/Pause toggle when browsing */
        if (code === KEY_PLAY_PAUSE || code === KEY_PLAY || code === KEY_PAUSE) {
          if (self.isPlaying) {
            self.sendPlayPause();
            if (event.preventDefault) event.preventDefault();
            event.returnValue = false;
            return false;
          }
        }

        /* Media Stop */
        if (code === KEY_STOP || code === 83) {
          if (self.isPlaying) {
            self.stopMusic();
            if (event.preventDefault) event.preventDefault();
            event.returnValue = false;
            return false;
          }
        }

        /* ==================================================================
           Focus Target: INPUT
           ================================================================== */
        if (self.focusTarget === 'input') {
          if (code === 13) { // Enter -> Submit Search
            self.submitSearch();
            if (event.preventDefault) event.preventDefault();
            event.returnValue = false;
            return false;
          }

          if (code === 40) { // Down -> Move to Pills
            self.blurInput();
            self.setPillFocus(self.activePillIndex);
            if (event.preventDefault) event.preventDefault();
            event.returnValue = false;
            return false;
          }

          // Let alphanumeric and editing keys pass directly to the input element
          return true;
        }

        /* ==================================================================
           Focus Target: PILLS
           ================================================================== */
        else if (self.focusTarget === 'pills') {
          if (code === 37) { // Left
            if (self.activePillIndex > 0) {
              self.setPillFocus(self.activePillIndex - 1);
            }
            if (event.preventDefault) event.preventDefault();
            event.returnValue = false;
            return false;
          }

          if (code === 39) { // Right
            if (self.activePillIndex < self.pills.length - 1) {
              self.setPillFocus(self.activePillIndex + 1);
            }
            if (event.preventDefault) event.preventDefault();
            event.returnValue = false;
            return false;
          }

          if (code === 38) { // Up -> Return to Input
            self.setInputFocus();
            if (event.preventDefault) event.preventDefault();
            event.returnValue = false;
            return false;
          }

          if (code === 40) { // Down -> Move to Cards
            if (self.searchResults && self.searchResults.length > 0) {
              self.setCardFocus(0);
            }
            if (event.preventDefault) event.preventDefault();
            event.returnValue = false;
            return false;
          }

          if (code === 13) { // Enter -> Select Pill & Search
            self.selectPill(self.activePillIndex, false);
            if (event.preventDefault) event.preventDefault();
            event.returnValue = false;
            return false;
          }
        }

        /* ==================================================================
           Focus Target: CARDS
           ================================================================== */
        else if (self.focusTarget === 'cards') {
          if (code === 13) { // Enter -> Cast Track
            if (self.searchResults && self.searchResults[self.activeCardIndex]) {
              var selected = self.searchResults[self.activeCardIndex];
              self.castMusic(selected.videoId, selected);
            }
            if (event.preventDefault) event.preventDefault();
            event.returnValue = false;
            return false;
          }

          if (code === 37) { // Left
            if (self.activeCardIndex > 0) {
              self.setCardFocus(self.activeCardIndex - 1);
            }
            if (event.preventDefault) event.preventDefault();
            event.returnValue = false;
            return false;
          }

          if (code === 39) { // Right
            if (self.activeCardIndex < self.searchResults.length - 1) {
              self.setCardFocus(self.activeCardIndex + 1);
            }
            if (event.preventDefault) event.preventDefault();
            event.returnValue = false;
            return false;
          }

          if (code === 38) { // Up
            if (self.activeCardIndex < 4) {
              self.setPillFocus(self.activePillIndex);
            } else {
              self.setCardFocus(self.activeCardIndex - 4);
            }
            if (event.preventDefault) event.preventDefault();
            event.returnValue = false;
            return false;
          }

          if (code === 40) { // Down
            var nextDown = self.activeCardIndex + 4;
            if (nextDown < self.searchResults.length) {
              self.setCardFocus(nextDown);
            } else if (self.isPlaying) {
              self.setMiniPlayerFocus();
            }
            if (event.preventDefault) event.preventDefault();
            event.returnValue = false;
            return false;
          }
        }

        /* ==================================================================
           Focus Target: MINIPLAYER
           ================================================================== */
        else if (self.focusTarget === 'miniplayer') {
          if (code === 38) { // Up -> Return to Cards
            self.setCardFocus(self.activeCardIndex);
            if (event.preventDefault) event.preventDefault();
            event.returnValue = false;
            return false;
          }

          if (code === 13) { // Enter -> Open Player View
            self.showPlayerView();
            if (event.preventDefault) event.preventDefault();
            event.returnValue = false;
            return false;
          }

          if (code === 32 || code === KEY_PLAY_PAUSE) { // Space/PlayPause
            self.sendPlayPause();
            if (event.preventDefault) event.preventDefault();
            event.returnValue = false;
            return false;
          }
        }
      }

      return true;
    };
  }
};
