/*
 * Legacy TV application controller for Samsung Orsay OS.
 *
 * This file strictly uses ES5 syntax only:
 *   - var, function declarations and anonymous functions
 *   - XMLHttpRequest for network requests
 *   - no promises, modules, classes, arrow functions or template literals
 *   - conservative memory allocation to prevent TV Out-Of-Memory (OOM) crashes
 *
 * Compatible with Samsung Smart TV Orsay WebKit runtime & desktop browsers.
 */

var widgetAPI = null;
var tvKey = null;
var pluginAPI = null;

try {
  if (typeof Common !== 'undefined' && Common.API && Common.API.Widget) {
    widgetAPI = new Common.API.Widget();
  }
} catch (ignoreWidgetError) {}

try {
  if (typeof Common !== 'undefined' && Common.API && Common.API.TVKeyValue) {
    tvKey = new Common.API.TVKeyValue();
  }
} catch (ignoreKeyError) {}

try {
  if (typeof Common !== 'undefined' && Common.API && Common.API.Plugin) {
    pluginAPI = new Common.API.Plugin();
  }
} catch (ignorePluginError) {}

var Audio = {
  plugin: null,
  init: function () {
    try {
      this.plugin = document.getElementById('pluginObjectAudio');
    } catch (e) {
      this.plugin = null;
    }
  },
  volumeUp: function () {
    if (this.plugin && this.plugin.SetVolumeWithKey) {
      try {
        this.plugin.SetVolumeWithKey(0);
        var vol = this.getVolume();
        App.updateVolumeUi(vol);
        return;
      } catch (e) {}
    }
    Player.changeVolume(5);
  },
  volumeDown: function () {
    if (this.plugin && this.plugin.SetVolumeWithKey) {
      try {
        this.plugin.SetVolumeWithKey(1);
        var vol = this.getVolume();
        App.updateVolumeUi(vol);
        return;
      } catch (e) {}
    }
    Player.changeVolume(-5);
  },
  getVolume: function () {
    if (this.plugin && this.plugin.GetVolume) {
      try {
        return this.plugin.GetVolume();
      } catch (e) {}
    }
    return Player.getVolume();
  },
  toggleMute: function () {
    if (this.plugin && this.plugin.SetSystemMute && this.plugin.GetSystemMute) {
      try {
        var current = this.plugin.GetSystemMute();
        this.plugin.SetSystemMute(!current);
        App.setStatus(!current ? 'TV Muted' : 'TV Unmuted');
        return;
      } catch (e) {}
    }
  }
};

var Player = {
  object: null,
  playing: false,
  currentUrl: '',
  volume: 100,
  aspect: 0,
  aspects: ['16:9', '4:3', 'Fill'],

  init: function () {
    this.object = document.getElementById('html5Player');
    this.bindEvents();
  },

  setStatus: function (message, isBuffering) {
    var buffering = document.getElementById('playerBuffering');
    if (buffering) {
      if (isBuffering && message) {
        buffering.innerHTML = this.escape(message);
        buffering.className = '';
      } else {
        buffering.className = 'hidden';
      }
    }
    if (window.console && window.console.log) {
      window.console.log('Player: ' + message);
    }
  },

  bindEvents: function () {
    var self = this;
    if (!this.object) return;

    this.object.addEventListener('loadstart', function () {
      self.setStatus('Connecting...', true);
    });
    this.object.addEventListener('waiting', function () {
      self.setStatus('Buffering...', true);
    });
    this.object.addEventListener('playing', function () {
      self.playing = true;
      self.setStatus('', false);
    });
    this.object.addEventListener('error', function () {
      self.playing = false;
      var errCode = self.object.error ? self.object.error.code : 'Unknown';
      self.setStatus('Error (Code: ' + errCode + ')', true);
      if (errCode === 4) {
        setTimeout(function () {
          if (App && typeof App.nextChannel === 'function') {
            App.nextChannel();
          }
        }, 3000);
      }
    });
  },

  setArea: function (mode) {
    var left = 0;
    var width = 960;
    if (mode === 1) {
      left = 120;
      width = 720;
    }
    if (this.object) {
      this.object.style.left = left + 'px';
      this.object.style.width = width + 'px';
    }
  },

  play: function (url) {
    if (!url) return;
    this.stop();

    var b64url = btoa(url);
    this.currentUrl = AppConfig.proxyUrl + b64url;

    this.setArea(this.aspect);
    this.setStatus('Connecting...', true);

    if (this.object) {
      this.object.src = this.currentUrl;
      try {
        this.object.play();
      } catch (playError) {
        this.setStatus('Error: ' + playError, true);
      }
    }
    this.setVolume(this.volume);
  },

  stop: function () {
    if (this.object) {
      try { this.object.pause(); } catch (e) {}
      this.object.src = '';
      this.object.removeAttribute('src');
    }
    this.playing = false;
    this.currentUrl = '';
    this.setStatus('', false);
  },

  toggle: function () {
    if (!this.object) return;
    if (this.playing) {
      try { this.object.pause(); } catch (e) {}
      this.playing = false;
      this.setStatus('Paused', true);
    } else {
      try { this.object.play(); } catch (e) {}
      this.playing = true;
      this.setStatus('', false);
    }
  },

  setVolume: function (value) {
    this.volume = Math.max(0, Math.min(100, value));
    if (this.object) {
      try { this.object.volume = this.volume / 100; } catch (e) {}
    }
    var volLabel = document.getElementById('volumeLabel');
    if (volLabel) volLabel.innerHTML = this.volume + '%';
  },

  getVolume: function () {
    if (this.object) {
      try { this.volume = Math.round(this.object.volume * 100); } catch (e) {}
    }
    return this.volume;
  },

  nextAspect: function () {
    this.aspect = (this.aspect + 1) % this.aspects.length;
    this.setArea(this.aspect);
    var aspectNames = ['16:9 (Fit)', '4:3 (Center)', 'Fill'];
    if (typeof App !== 'undefined') {
      App.setStatus('Aspect: ' + aspectNames[this.aspect]);
    }
  },

  escape: function (value) {
    return String(value || '').replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
};

var App = {
  channels: [],
  visibleChannels: [],
  favorites: [],
  epg: {},
  epgNames: {},
  category: 'favorites',
  language: 'all',
  pageSize: 15,
  currentPage: 1,
  totalPages: 1,
  currentChannel: null,

  focusIndex: 0,
  carouselIndex: 0,
  focusItems: [],
  focusZone: 'grid', // 'grid' | 'top'
  topFocusIndex: 0,
  topFocusIds: ['favoritesFilter', 'allFilter', 'categoryFilter', 'languageFilter', 'refreshButton'],

  quickTuneBuffer: '',
  quickTuneTimer: null,
  sleepTimer: null,
  sleepMinutes: 0,
  playerControlsTimer: null,
  clockTimer: null,

  dragStartY: null,
  dragStartX: null,
  dragValue: null,
  longPressTimer: null,

  init: function () {
    Player.init();
    Audio.init();
    this.loadState();
    this.bindMouseHandlers();
    this.initFilterFocus();
    this.installKeyHandler();
    this.ready();
    this.refreshChannels();
    this.loadEpg();
    this.startClock();
    try {
      window.focus();
      if (document.body && document.body.focus) {
        document.body.focus();
      }
    } catch (focusError) {}
  },

  updateVolumeUi: function (vol) {
    var volLabel = document.getElementById('volumeLabel');
    if (volLabel) volLabel.innerHTML = vol + '%';
    this.showPlayerControls();
  },

  initFilterFocus: function () {
    var self = this;
    var fav = document.getElementById('favoritesFilter');
    var all = document.getElementById('allFilter');
    var cat = document.getElementById('categoryFilter');
    var lang = document.getElementById('languageFilter');
    var ref = document.getElementById('refreshButton');

    if (fav) {
      fav.onfocus = function () {
        if (self.focusZone === 'top' && self.topFocusIndex === 0) return;
        self.focusZone = 'top';
        self.topFocusIndex = 0;
        self.updateTopFocus();
      };
    }
    if (all) {
      all.onfocus = function () {
        if (self.focusZone === 'top' && self.topFocusIndex === 1) return;
        self.focusZone = 'top';
        self.topFocusIndex = 1;
        self.updateTopFocus();
      };
    }
    if (cat) {
      cat.onfocus = function () {
        if (self.focusZone === 'top' && self.topFocusIndex === 2) return;
        self.focusZone = 'top';
        self.topFocusIndex = 2;
        self.updateTopFocus();
      };
    }
    if (lang) {
      lang.onfocus = function () {
        if (self.focusZone === 'top' && self.topFocusIndex === 3) return;
        self.focusZone = 'top';
        self.topFocusIndex = 3;
        self.updateTopFocus();
      };
    }
    if (ref) {
      ref.onfocus = function () {
        if (self.focusZone === 'top' && self.topFocusIndex === 4) return;
        self.focusZone = 'top';
        self.topFocusIndex = 4;
        self.updateTopFocus();
      };
    }
  },

  ready: function () {
    if (widgetAPI && widgetAPI.sendReadyEvent) {
      widgetAPI.sendReadyEvent();
    }
    this.registerKeys();
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
      97, 98, 99, 100, 101, 102, 103, 104, 105, 106, 107, 108, 109,
      110, 111, 112, 113, 114, 115, 116, 117, 118, 119, 120, 121, 122,
      123,
      8, 13, 27, 32, 33, 34, 37, 38, 39, 40,
      107, 109, 173, 174, 175, 187, 189
    ];
    for (var i = 0; i < customKeys.length; i++) {
      try {
        pluginAPI.registKey(customKeys[i]);
      } catch (e2) {}
    }
  },

  setStatus: function (message) {
    var status = document.getElementById('status');
    if (status) status.innerHTML = this.escape(message);
  },

  startClock: function () {
    var self = this;
    var update = function () {
      var timeEl = document.getElementById('playerTime');
      if (timeEl) {
        var now = new Date();
        timeEl.innerHTML = self.formatTime(now);
      }
    };
    update();
    if (this.clockTimer) clearInterval(this.clockTimer);
    this.clockTimer = setInterval(update, 30000);
  },

  loadState: function () {
    var storedFavorites = localStorage.getItem('legacy_tv_favorites');
    try {
      this.favorites = storedFavorites ? JSON.parse(storedFavorites) : [];
    } catch (e1) {
      this.favorites = [];
    }
    localStorage.removeItem('legacy_tv_history');
  },

  saveState: function () {
    localStorage.setItem('legacy_tv_favorites', JSON.stringify(this.favorites));
  },

  cycleSleepTimer: function () {
    var options = [0, 15, 30, 60];
    var current = 0;
    var i;
    for (i = 0; i < options.length; i++) {
      if (options[i] === this.sleepMinutes) current = i;
    }
    this.sleepMinutes = options[(current + 1) % options.length];
    if (this.sleepTimer) clearTimeout(this.sleepTimer);
    this.sleepTimer = null;
    if (this.sleepMinutes > 0) {
      var self = this;
      this.sleepTimer = setTimeout(function () {
        self.closePlayer();
        self.setStatus('Sleep timer stopped playback.');
      }, this.sleepMinutes * 60 * 1000);
      this.setStatus('Sleep timer: ' + this.sleepMinutes + ' minutes');
    } else {
      this.setStatus('Sleep timer off');
    }
  },

  refreshChannels: function () {
    var xhr = new XMLHttpRequest();
    var self = this;
    this.setStatus('Loading channels...');
    try {
      xhr.open('GET', 'channels.json?ts=' + new Date().getTime(), true);
    } catch (openError) {
      this.setStatus('Could not open channel request.');
      return;
    }
    xhr.onreadystatechange = function () {
      if (xhr.readyState !== 4) return;
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          self.channels = self.flattenChannels(JSON.parse(xhr.responseText));
          self.buildFilters();
          self.render();
          self.setStatus(self.channels.length + ' channels loaded');
        } catch (error) {
          self.setStatus('Invalid channels.json.');
        }
      } else {
        self.setStatus('Channel request failed: ' + xhr.status);
      }
    };
    try {
      xhr.send(null);
    } catch (sendError) {
      this.setStatus('Channel request failed to send.');
    }
  },

  flattenChannels: function (data) {
    var result = [];
    var categories = data && data.categories ? data.categories : [];
    var i, j;
    var globalIdx = 1;
    for (i = 0; i < categories.length; i++) {
      var category = categories[i];
      var list = category.channels || [];
      for (j = 0; j < list.length; j++) {
        var channel = list[j];
        channel.categoryId = category.id || 'other';
        channel.categoryName = category.name || 'Other';
        channel.channelNumber = globalIdx++;
        result.push(channel);
      }
    }
    return result;
  },

  buildFilters: function () {
    var categories = {};
    var languages = {};
    var i;
    var categorySelect = document.getElementById('categoryFilter');
    var languageSelect = document.getElementById('languageFilter');
    for (i = 0; i < this.channels.length; i++) {
      categories[this.channels[i].categoryId] = this.channels[i].categoryName;
      languages[this.channels[i].language || 'unknown'] = true;
    }
    categorySelect.innerHTML = '<option value="all">All categories</option>';
    for (var categoryId in categories) {
      if (categories.hasOwnProperty(categoryId)) {
        categorySelect.innerHTML += '<option value="' + this.escape(categoryId) + '">' +
          this.escape(categories[categoryId]) + '</option>';
      }
    }
    languageSelect.innerHTML = '<option value="all">All languages</option>';
    for (var language in languages) {
      if (languages.hasOwnProperty(language)) {
        languageSelect.innerHTML += '<option value="' + this.escape(language) + '">' +
          this.escape(language.toUpperCase()) + '</option>';
      }
    }
  },

  setCategory: function (value) {
    this.category = value;
    this.currentPage = 1;
    var allBtn = document.getElementById('allFilter');
    var favBtn = document.getElementById('favoritesFilter');
    var catSelect = document.getElementById('categoryFilter');
    if (allBtn) {
      allBtn.className = value === 'all' ? 'chip active' : 'chip';
    }
    if (favBtn) {
      favBtn.className = value === 'favorites' ? 'chip active' : 'chip';
    }
    if (catSelect) {
      if (value !== 'all' && value !== 'favorites') {
        catSelect.value = value;
      } else {
        catSelect.selectedIndex = 0;
      }
    }
    this.render();
    if (this.focusZone === 'top') {
      this.updateTopFocus();
    }
  },

  nextCategory: function () {
    var categorySelect = document.getElementById('categoryFilter');
    if (!categorySelect || !categorySelect.options.length) return;
    var options = categorySelect.options;
    var currentIdx = -1;
    var i;
    for (i = 0; i < options.length; i++) {
      if (options[i].value === this.category) currentIdx = i;
    }
    var nextIdx = (currentIdx + 1) % options.length;
    var nextVal = options[nextIdx].value;
    categorySelect.selectedIndex = nextIdx;
    this.setCategory(nextVal);
    this.setStatus('Category: ' + options[nextIdx].text);
  },

  setLanguage: function (value) {
    this.language = value;
    this.currentPage = 1;
    this.render();
  },

  filtered: function () {
    var result = [];
    var i;
    for (i = 0; i < this.channels.length; i++) {
      var channel = this.channels[i];
      if (this.category === 'favorites' && !this.isFavorite(channel.id)) continue;
      if (this.category !== 'all' && this.category !== 'favorites' &&
          channel.categoryId !== this.category) continue;
      if (this.language !== 'all' && channel.language !== this.language) continue;
      result.push(channel);
    }
    return result;
  },

  getFavoritesChannels: function () {
    var result = [];
    var i;
    for (i = 0; i < this.channels.length; i++) {
      if (this.isFavorite(this.channels[i].id)) {
        result.push(this.channels[i]);
      }
    }
    return result;
  },

  render: function () {
    if (this.category === 'favorites') {
      this.renderCarousel();
    } else {
      this.renderGrid();
    }
  },

  renderCarousel: function () {
    var grid = document.getElementById('channelGrid');
    var pagination = document.getElementById('pagination');
    var container = document.getElementById('carouselContainer');
    if (grid) grid.className = 'hidden';
    if (pagination) pagination.className = 'hidden';
    if (!container) return;
    container.className = '';

    var list = this.getFavoritesChannels();
    this.visibleChannels = list;

    if (!list.length) {
      container.innerHTML = '<div class="empty">No favorites yet. Switch to "All" to browse channels or press Red to favorite!</div>';
      this.focusZone = 'top';
      this.topFocusIndex = 0;
      this.updateTopFocus();
      return;
    }

    if (this.carouselIndex >= list.length) this.carouselIndex = list.length - 1;
    if (this.carouselIndex < 0) this.carouselIndex = 0;

    var html = '';
    var i;
    for (i = 0; i < list.length; i++) {
      html += this.carouselCardHtml(list[i], i);
    }
    container.innerHTML = html;
    this.updateCarouselClasses();
  },

  carouselCardHtml: function (channel, index) {
    var program = this.currentProgram(channel);
    var progress = program ? this.progress(program) : 0;
    var logo = '';
    if (channel.logoUrl) {
      var encodedLogoUrl = encodeURIComponent(btoa(channel.logoUrl));
      var proxiedLogoUrl = AppConfig.logoProxyUrl + '/logo?b64=' + encodedLogoUrl;
      logo = '<img class="carouselLogo" data-src="' + this.escape(proxiedLogoUrl) + '" alt="" onerror="this.style.display=\'none\';" />';
    }
    var chNum = channel.channelNumber || (index + 1);

    return '<div class="carouselCard" id="carousel-card-' + index + '" tabindex="0" data-index="' + index + '" data-id="' + this.escape(channel.id) + '">' +
      '<span class="carouselNumber">#' + chNum + '</span>' +
      '<button class="carouselFavBtn" data-id="' + this.escape(channel.id) + '">&#9733;</button>' +
      logo +
      '<div class="carouselName">' + this.escape(channel.name) + '</div>' +
      '<div class="carouselMeta">' + this.escape(channel.categoryName || 'Favorite') + '</div>' +
      '<div class="carouselProgram">' + (program ? this.escape(program.title) : 'No EPG data') + '</div>' +
      '<div class="carouselProgress"><span style="width:' + progress + '%;"></span></div>' +
      '<div class="carouselPrompt">PRESS ENTER TO WATCH</div>' +
      '</div>';
  },

  updateCarouselClasses: function () {
    var list = this.getFavoritesChannels();
    if (!list.length) return;
    var total = list.length;
    var cur = this.carouselIndex;

    var prev = (cur - 1 + total) % total;
    var next = (cur + 1) % total;
    var farPrev = (cur - 2 + total) % total;
    var farNext = (cur + 2) % total;

    var i;
    for (i = 0; i < total; i++) {
      var el = document.getElementById('carousel-card-' + i);
      if (!el) continue;

      var cls = 'carouselCard';
      if (i === cur) {
        cls += ' focused';
      } else if (total > 1 && i === prev) {
        cls += ' prev';
      } else if (total > 2 && i === next) {
        cls += ' next';
      } else if (total > 3 && i === farPrev) {
        cls += ' far-prev';
      } else if (total > 4 && i === farNext) {
        cls += ' far-next';
      }
      el.className = cls;

      if (cls !== 'carouselCard') {
        var img = el.getElementsByTagName('img')[0];
        if (img && !img.src && img.getAttribute('data-src')) {
          img.src = img.getAttribute('data-src');
        }
      }
    }

    var focusedEl = document.getElementById('carousel-card-' + cur);
    if (focusedEl && this.focusZone === 'grid') {
      try { if (focusedEl.focus) focusedEl.focus(); } catch (e) {}
    }
  },

  renderGrid: function () {
    var container = document.getElementById('carouselContainer');
    if (container) container.className = 'hidden';
    var grid = document.getElementById('channelGrid');
    if (grid) grid.className = '';
    var pagination = document.getElementById('pagination');
    if (pagination) pagination.className = '';

    var list = this.filtered();
    var pageStart, pageEnd;
    var html = '';
    var i;
    this.visibleChannels = list;
    this.totalPages = Math.max(1, Math.ceil(list.length / this.pageSize));
    if (this.currentPage > this.totalPages) this.currentPage = this.totalPages;
    pageStart = (this.currentPage - 1) * this.pageSize;
    pageEnd = Math.min(pageStart + this.pageSize, list.length);

    for (i = pageStart; i < pageEnd; i++) {
      html += this.cardHtml(list[i], i, list[i].channelNumber || (i + 1));
    }
    if (!html) {
      html = '<div class="empty">No channels match this filter.</div>';
    }
    grid.innerHTML = html;
    this.renderPagination();
    this.focusItems = this.findFocusableCards();
    if (this.focusZone === 'grid') {
      this.setFocus(this.focusIndex);
    }
  },

  cardHtml: function (channel, index, channelNumber) {
    var program = this.currentProgram(channel);
    var progress = program ? this.progress(program) : 0;
    var logo = '';
    if (channel.logoUrl) {
      var encodedLogoUrl = encodeURIComponent(btoa(channel.logoUrl));
      var proxiedLogoUrl = AppConfig.logoProxyUrl + '/logo?b64=' + encodedLogoUrl;
      logo = '<img src="' + this.escape(proxiedLogoUrl) + '" alt="" onerror="this.style.display=\'none\';" />';
    }
    var isFav = this.isFavorite(channel.id);
    var favoriteText = isFav ? '&#9733;' : '&#9734;';
    var favoriteClass = isFav ? 'favoriteButton isFav' : 'favoriteButton';

    return '<div class="channelCard" id="channel-' + index + '" tabindex="0" data-index="' + index +
      '" data-id="' + this.escape(channel.id) + '">' +
      '<span class="channelNumber">' + channelNumber + '</span>' +
      '<button class="' + favoriteClass + '" data-id="' + this.escape(channel.id) + '">' +
      favoriteText + '</button>' + logo +
      '<div class="channelName">' + this.escape(channel.name) + '</div>' +
      '<div class="channelMeta">' + this.escape(channel.categoryName || '') + '</div>' +
      '<div class="program">' + (program ? this.escape(program.title) : 'No EPG data') + '</div>' +
      '<div class="progress"><span style="width:' + progress + '%;"></span></div></div>';
  },

  renderPagination: function () {
    var previous = document.getElementById('previousPageButton');
    var next = document.getElementById('nextPageButton');
    var label = document.getElementById('pageLabel');
    if (previous) previous.disabled = this.currentPage <= 1;
    if (next) next.disabled = this.currentPage >= this.totalPages;
    if (label) label.innerHTML = 'Page ' + this.currentPage + ' / ' + this.totalPages;
  },

  previousPage: function () {
    if (this.currentPage <= 1) return;
    this.currentPage--;
    this.render();
  },

  nextPage: function () {
    if (this.currentPage >= this.totalPages) return;
    this.currentPage++;
    this.render();
  },

  findFocusableCards: function () {
    var cards = document.getElementById('channelGrid').getElementsByTagName('div');
    var result = [];
    var i;
    for (i = 0; i < cards.length; i++) {
      if (cards[i].className.indexOf('channelCard') !== -1) {
        result.push(cards[i]);
      }
    }
    return result;
  },

  setFocus: function (index) {
    var i;
    if (!this.focusItems.length) return;
    if (index < 0) index = 0;
    if (index >= this.focusItems.length) index = this.focusItems.length - 1;
    for (i = 0; i < this.focusItems.length; i++) {
      this.focusItems[i].className = this.focusItems[i].className.replace(' focused', '');
    }
    this.focusIndex = index;
    this.focusItems[index].className += ' focused';
    try {
      if (this.focusItems[index].focus) {
        this.focusItems[index].focus();
      }
    } catch (e) {}
  },

  clearGridFocus: function () {
    for (var i = 0; i < this.focusItems.length; i++) {
      this.focusItems[i].className = this.focusItems[i].className.replace(/\s*focused/g, '');
      try {
        if (this.focusItems[i].blur) {
          this.focusItems[i].blur();
        }
      } catch (e) {}
    }
  },

  updateTopFocus: function () {
    for (var i = 0; i < this.topFocusIds.length; i++) {
      var el = document.getElementById(this.topFocusIds[i]);
      if (el) {
        el.className = el.className.replace(/\s*topFocused/g, '');
        if (i === this.topFocusIndex) {
          el.className += ' topFocused';
          if (el.focus) {
            try { el.focus(); } catch (e) {}
          }
        }
      }
    }
  },

  clearTopFocus: function () {
    for (var i = 0; i < this.topFocusIds.length; i++) {
      var el = document.getElementById(this.topFocusIds[i]);
      if (el) {
        el.className = el.className.replace(/\s*topFocused/g, '');
        if (el.blur) {
          try { el.blur(); } catch (e) {}
        }
      }
    }
  },

  isPlayerOpen: function () {
    var playerView = document.getElementById('playerView');
    return playerView && playerView.className.indexOf('hidden') === -1;
  },

  isGuideOpen: function () {
    var guideModal = document.getElementById('guideModal');
    return guideModal && guideModal.className.indexOf('hidden') === -1;
  },

  installKeyHandler: function () {
    var self = this;
    var lastHandledTime = 0;
    var lastHandledKey = '';

    var keyListener = function (event) {
      event = event || window.event;
      var code = event.keyCode || event.which || event.charCode || 0;
      var key = self.keyName(code, event);

      if (!key) return true;

      var now = new Date().getTime();
      var isArrow = (key === 'left' || key === 'right' || key === 'up' || key === 'down');
      var debounceMs = isArrow ? 160 : 70;

      if (now - lastHandledTime < debounceMs && key === lastHandledKey) {
        self.prevent(event);
        return false;
      }
      lastHandledTime = now;
      lastHandledKey = key;

      if (self.isGuideOpen()) {
        if (key === 'return' || key === 'back' || key === 'yellow') {
          self.closeGuide();
          self.prevent(event);
          return false;
        }
        return true;
      }

      if (self.isPlayerOpen()) {
        return self.handlePlayerKey(key, event);
      } else {
        return self.handleGridKey(key, event);
      }
    };

    if (window.addEventListener) {
      // Use capture mode on window: catches key before target elements or browser spatial navigation
      window.addEventListener('keydown', keyListener, true);
      window.addEventListener('keypress', keyListener, true);
    } else {
      document.onkeydown = keyListener;
    }
  },

  handlePlayerKey: function (key, event) {
    if (key === 'up' || key === 'ch_up') {
      this.nextChannel();
      this.prevent(event);
      return false;
    }
    if (key === 'down' || key === 'ch_down') {
      this.previousChannel();
      this.prevent(event);
      return false;
    }
    if (key === 'vol_down' || key === 'left') {
      Audio.volumeDown();
      this.prevent(event);
      return false;
    }
    if (key === 'vol_up' || key === 'right') {
      Audio.volumeUp();
      this.prevent(event);
      return false;
    }
    if (key === 'mute') {
      Audio.toggleMute();
      this.prevent(event);
      return false;
    }
    if (key === 'enter' || key === 'info') {
      var controls = document.getElementById('playerControls');
      if (controls && controls.className.indexOf('controlsHidden') === -1) {
        this.hidePlayerControls();
      } else {
        this.showPlayerControls();
      }
      this.prevent(event);
      return false;
    }
    if (key === 'play' || key === 'pause' || key === 'play_pause') {
      Player.toggle();
      this.showPlayerControls();
      this.prevent(event);
      return false;
    }
    if (key === 'stop' || key === 'return' || key === 'back') {
      if (widgetAPI && widgetAPI.blockNavigation) {
        try { widgetAPI.blockNavigation(event); } catch (e) {}
      }
      this.closePlayer();
      this.prevent(event);
      return false;
    }
    if (key === 'red') {
      if (this.currentChannel) {
        this.toggleFavorite(this.currentChannel.id);
        var isFav = this.isFavorite(this.currentChannel.id);
        this.setStatus(isFav ? 'Added to favorites' : 'Removed from favorites');
      }
      this.prevent(event);
      return false;
    }
    if (key === 'blue') {
      Player.nextAspect();
      this.showPlayerControls();
      this.prevent(event);
      return false;
    }
    if (key === 'yellow') {
      this.showGuide();
      this.prevent(event);
      return false;
    }
    if (key >= '0' && key <= '9') {
      this.onNumberKey(key);
      this.prevent(event);
      return false;
    }
    return true;
  },

  handleGridKey: function (key, event) {
    if (key === 'left' || key === 'right' || key === 'up' || key === 'down') {
      this.moveFocus(key);
      this.prevent(event);
      return false;
    }
    if (key === 'all_filter') {
      this.setCategory('all');
      this.prevent(event);
      return false;
    }
    if (key === 'fav_filter') {
      this.setCategory('favorites');
      this.prevent(event);
      return false;
    }
    if (key === 'vol_up') {
      Audio.volumeUp();
      this.prevent(event);
      return false;
    }
    if (key === 'vol_down') {
      Audio.volumeDown();
      this.prevent(event);
      return false;
    }
    if (key === 'mute') {
      Audio.toggleMute();
      this.prevent(event);
      return false;
    }
    if (key === 'enter') {
      var activeEl = document.activeElement;
      if (activeEl && (activeEl.id === 'allFilter' || activeEl.id === 'favoritesFilter' || activeEl.id === 'refreshButton')) {
        if (activeEl.id === 'allFilter') {
          this.setCategory('all');
        } else if (activeEl.id === 'favoritesFilter') {
          this.setCategory('favorites');
        } else if (activeEl.id === 'refreshButton') {
          this.refreshChannels();
        }
        this.prevent(event);
        return false;
      }

      if (this.focusZone === 'top') {
        this.activateTopFocus();
      } else if (this.category === 'favorites') {
        var favList = this.getFavoritesChannels();
        if (favList.length && favList[this.carouselIndex]) {
          this.openChannelByChannel(favList[this.carouselIndex]);
        }
      } else {
        var targetCard = this.findChannelTarget(activeEl);
        if (targetCard && targetCard.className.indexOf('favoriteButton') !== -1) {
          this.toggleFavorite(targetCard.getAttribute('data-id'));
        } else if (targetCard && targetCard.getAttribute('data-index')) {
          var cardIdx = parseInt(targetCard.getAttribute('data-index'), 10);
          this.openChannel(cardIdx);
        } else {
          var pageStart = (this.currentPage - 1) * this.pageSize;
          var actualIndex = pageStart + this.focusIndex;
          this.openChannel(actualIndex);
        }
      }
      this.prevent(event);
      return false;
    }
    if (key === 'red') {
      if (this.focusZone === 'grid') {
        if (this.category === 'favorites') {
          var curFavs = this.getFavoritesChannels();
          if (curFavs.length && curFavs[this.carouselIndex]) {
            this.toggleFavorite(curFavs[this.carouselIndex].id);
          }
        } else {
          var pStart = (this.currentPage - 1) * this.pageSize;
          var aIdx = pStart + this.focusIndex;
          this.toggleFavoriteByIndex(aIdx);
        }
      } else {
        this.setCategory(this.category === 'favorites' ? 'all' : 'favorites');
      }
      this.prevent(event);
      return false;
    }
    if (key === 'green') {
      this.nextCategory();
      this.prevent(event);
      return false;
    }
    if (key === 'yellow') {
      if (this.category === 'favorites') {
        var curFavsGuide = this.getFavoritesChannels();
        if (curFavsGuide.length && curFavsGuide[this.carouselIndex]) {
          this.currentChannel = curFavsGuide[this.carouselIndex];
          this.showGuide();
        }
      } else {
        var pgStart = (this.currentPage - 1) * this.pageSize;
        var curIdx = pgStart + this.focusIndex;
        this.showGuideForIndex(curIdx);
      }
      this.prevent(event);
      return false;
    }
    if (key === 'blue') {
      this.refreshChannels();
      this.prevent(event);
      return false;
    }
    if (key === 'ch_up') {
      this.nextPage();
      this.prevent(event);
      return false;
    }
    if (key === 'ch_down') {
      this.previousPage();
      this.prevent(event);
      return false;
    }
    if (key >= '0' && key <= '9') {
      this.onNumberKey(key);
      this.prevent(event);
      return false;
    }
    if (key === 'return' || key === 'back') {
      if (widgetAPI && widgetAPI.sendReturnEvent) {
        widgetAPI.sendReturnEvent();
      }
      this.prevent(event);
      return false;
    }
    return true;
  },

  moveFocus: function (key) {
    if (this.focusZone === 'top') {
      if (key === 'left') {
        if (this.topFocusIndex > 0) {
          this.topFocusIndex--;
          this.updateTopFocus();
        }
      } else if (key === 'right') {
        if (this.topFocusIndex < this.topFocusIds.length - 1) {
          this.topFocusIndex++;
          this.updateTopFocus();
        }
      } else if (key === 'down') {
        this.focusZone = 'grid';
        this.clearTopFocus();
        if (this.category === 'favorites') {
          this.updateCarouselClasses();
        } else {
          if (this.focusIndex >= this.focusItems.length) this.focusIndex = 0;
          this.setFocus(this.focusIndex);
        }
      }
      return;
    }

    if (this.category === 'favorites') {
      var favs = this.getFavoritesChannels();
      if (!favs.length) {
        if (key === 'up') {
          this.focusZone = 'top';
          this.topFocusIndex = 0;
          this.updateTopFocus();
        }
        return;
      }
      if (key === 'left') {
        this.carouselIndex = (this.carouselIndex - 1 + favs.length) % favs.length;
        this.updateCarouselClasses();
      } else if (key === 'right') {
        this.carouselIndex = (this.carouselIndex + 1) % favs.length;
        this.updateCarouselClasses();
      } else if (key === 'up') {
        this.focusZone = 'top';
        this.topFocusIndex = 0;
        this.updateTopFocus();
        this.updateCarouselClasses();
      }
      return;
    }

    var columns = 5;
    var next = this.focusIndex;
    var lastIndex = this.focusItems.length - 1;

    if (key === 'left') next--;
    if (key === 'right') next++;
    if (key === 'down') next += columns;
    if (key === 'up') {
      if (next < columns) {
        this.focusZone = 'top';
        this.topFocusIndex = 0;
        this.clearGridFocus();
        this.updateTopFocus();
        return;
      }
      next -= columns;
    }

    if ((key === 'right' || key === 'down') && next > lastIndex) {
      if (this.currentPage < this.totalPages) {
        this.currentPage++;
        this.render();
        this.setFocus(0);
        return;
      }
    }
    if (key === 'left' && next < 0) {
      if (this.currentPage > 1) {
        this.currentPage--;
        this.render();
        this.setFocus(this.focusItems.length - 1);
        return;
      }
    }

    this.setFocus(next);
  },

  activateTopFocus: function () {
    var id = this.topFocusIds[this.topFocusIndex];
    if (id === 'favoritesFilter') {
      this.setCategory('favorites');
    } else if (id === 'allFilter') {
      this.setCategory('all');
    } else if (id === 'categoryFilter') {
      this.nextCategory();
    } else if (id === 'languageFilter') {
      var langSelect = document.getElementById('languageFilter');
      if (langSelect && langSelect.options.length) {
        var nextIdx = (langSelect.selectedIndex + 1) % langSelect.options.length;
        langSelect.selectedIndex = nextIdx;
        this.setLanguage(langSelect.options[nextIdx].value);
      }
    } else if (id === 'refreshButton') {
      this.refreshChannels();
    }
  },

  onNumberKey: function (digit) {
    var self = this;
    if (this.quickTuneTimer) {
      clearTimeout(this.quickTuneTimer);
    }
    this.quickTuneBuffer += digit;
    var el = document.getElementById('quickTuning');
    if (el) {
      el.innerHTML = 'CH ' + this.escape(this.quickTuneBuffer);
      el.className = '';
    }
    this.quickTuneTimer = setTimeout(function () {
      self.commitQuickTune();
    }, 1200);
  },

  commitQuickTune: function () {
    if (this.quickTuneTimer) {
      clearTimeout(this.quickTuneTimer);
      this.quickTuneTimer = null;
    }
    var el = document.getElementById('quickTuning');
    if (el) el.className = 'hidden';
    if (!this.quickTuneBuffer) return;
    var targetNumber = parseInt(this.quickTuneBuffer, 10);
    this.quickTuneBuffer = '';
    if (isNaN(targetNumber) || targetNumber <= 0) return;

    var list = this.channels;
    var i;
    for (i = 0; i < list.length; i++) {
      if (list[i].channelNumber === targetNumber) {
        this.visibleChannels = this.channels;
        this.openChannel(i);
        return;
      }
    }
    this.setStatus('Channel not found: ' + targetNumber);
  },

  keyName: function (code, event) {
    var keyChar = '';
    if (event && event.key) {
      keyChar = String(event.key).toLowerCase();
    }
    var isKeyPress = event && event.type === 'keypress';

    // 1. Enter and Space
    if (code === 13 || code === 32 || keyChar === 'enter' || keyChar === ' ') {
      return 'enter';
    }

    // 2. Return / Back / Exit:
    // Backspace (8), 'Q' (81 on keydown, 113 on keypress), 'X' (88 on keydown, 120 on keypress)
    // Note: Esc (27) is omitted to avoid TV OS full exit
    if (keyChar === 'q' || keyChar === 'x' || keyChar === 'backspace') {
      return 'return';
    }
    if (code === 8 || code === 81) return 'return';
    if (isKeyPress && (code === 113 || code === 120)) return 'return';

    // 3. Red button / 'R' / F1 (Favorite toggle)
    if (keyChar === 'r' || keyChar === 'f1') return 'red';
    if (code === 82 || (!isKeyPress && code === 112) || (isKeyPress && code === 114)) return 'red';

    // 4. Green button / 'G' / F2 (Category cycle)
    if (keyChar === 'g' || keyChar === 'f2') return 'green';
    if (code === 71 || (!isKeyPress && code === 113) || (isKeyPress && code === 103)) return 'green';

    // 5. Yellow button / 'Y' / 'Z' (QWERTZ Hungarian swap) / F3 (EPG Guide)
    if (keyChar === 'y' || keyChar === 'z' || keyChar === 'f3') return 'yellow';
    if (code === 89 || code === 90 || (!isKeyPress && code === 114) || (isKeyPress && (code === 121 || code === 122))) return 'yellow';

    // 6. Blue button / 'B' / F4 (Refresh channels / Aspect ratio)
    if (keyChar === 'b' || keyChar === 'f4') return 'blue';
    if (code === 66 || (!isKeyPress && code === 115) || (isKeyPress && code === 98)) return 'blue';

    // 7. 'A' -> All channels
    if (keyChar === 'a' || code === 65 || (isKeyPress && code === 97)) return 'all_filter';

    // 8. 'F' -> Favorites tab
    if (keyChar === 'f' || code === 70 || (isKeyPress && code === 102)) return 'fav_filter';

    // 9. 'I' -> Info
    if (keyChar === 'i' || code === 73 || (isKeyPress && code === 105)) return 'info';

    // 10. Volume controls:
    // Media keys (174, 175, 173), +/-, 'M', and F8 (Mute), F9 (Vol-), F10 (Vol+)
    if (keyChar === '+' || keyChar === 'f10' || code === 175 || code === 107 || code === 187 || (!isKeyPress && code === 121)) {
      return 'vol_up';
    }
    if (keyChar === '-' || keyChar === 'f9' || code === 174 || code === 109 || code === 189 || (!isKeyPress && code === 120)) {
      return 'vol_down';
    }
    if (keyChar === 'm' || keyChar === 'f8' || code === 173 || code === 77 || (!isKeyPress && code === 119) || (isKeyPress && code === 109)) {
      return 'mute';
    }

    // 11. Channel Up / Down via F11/F12 or PageUp/PageDown
    if (keyChar === 'pageup' || keyChar === 'f12' || code === 33 || (!isKeyPress && code === 123)) {
      return 'ch_up';
    }
    if (keyChar === 'pagedown' || keyChar === 'f11' || code === 34 || (!isKeyPress && code === 122)) {
      return 'ch_down';
    }

    // 12. TV Remote mappings from tvKey
    if (tvKey) {
      if (code === tvKey.KEY_LEFT) return 'left';
      if (code === tvKey.KEY_RIGHT) return 'right';
      if (code === tvKey.KEY_UP) return 'up';
      if (code === tvKey.KEY_DOWN) return 'down';
      if (code === tvKey.KEY_ENTER) return 'enter';
      if (code === tvKey.KEY_RETURN) return 'return';
      if (code === tvKey.KEY_VOL_UP || code === tvKey.KEY_VOLUP) return 'vol_up';
      if (code === tvKey.KEY_VOL_DOWN || code === tvKey.KEY_VOLDOWN) return 'vol_down';
      if (code === tvKey.KEY_MUTE) return 'mute';
      if (code === tvKey.KEY_RED) return 'red';
      if (code === tvKey.KEY_GREEN) return 'green';
      if (code === tvKey.KEY_YELLOW) return 'yellow';
      if (code === tvKey.KEY_BLUE) return 'blue';
      if (code === tvKey.KEY_CH_UP || code === tvKey.KEY_CHUP || code === tvKey.KEY_PAGE_UP) return 'ch_up';
      if (code === tvKey.KEY_CH_DOWN || code === tvKey.KEY_CHDOWN || code === tvKey.KEY_PAGE_DOWN) return 'ch_down';
      if (code === tvKey.KEY_INFO || code === tvKey.KEY_INFOLINK) return 'info';
      if (code === tvKey.KEY_PLAY) return 'play';
      if (code === tvKey.KEY_PAUSE) return 'pause';
      if (code === tvKey.KEY_STOP) return 'stop';
      if (code === tvKey.KEY_PLAY_PAUSE) return 'play_pause';
      if (code === tvKey.KEY_0) return '0';
      if (code === tvKey.KEY_1) return '1';
      if (code === tvKey.KEY_2) return '2';
      if (code === tvKey.KEY_3) return '3';
      if (code === tvKey.KEY_4) return '4';
      if (code === tvKey.KEY_5) return '5';
      if (code === tvKey.KEY_6) return '6';
      if (code === tvKey.KEY_7) return '7';
      if (code === tvKey.KEY_8) return '8';
      if (code === tvKey.KEY_9) return '9';
    }

    // 13. Directional arrows
    if (code === 37 || keyChar === 'arrowleft') return 'left';
    if (code === 38 || keyChar === 'arrowup') return 'up';
    if (code === 39 || keyChar === 'arrowright') return 'right';
    if (code === 40 || keyChar === 'arrowdown') return 'down';

    // 14. Standard Return / Back on PC or TV emulator
    if (code === 8 || code === 88) return 'return';

    // 15. Number keys (0-9)
    if (code >= 48 && code <= 57) return String(code - 48);
    if (code >= 96 && code <= 105) return String(code - 96);
    if (keyChar >= '0' && keyChar <= '9') return keyChar;

    return '';
  },

  openChannelByChannel: function (channel) {
    if (!channel) return;
    this.currentChannel = channel;
    this.updatePlayerOsd(channel);

    var playerView = document.getElementById('playerView');
    if (playerView) playerView.className = '';
    this.showPlayerControls();
    Player.play(channel.streamUrl);
  },

  openChannel: function (index) {
    var channel = this.visibleChannels[index];
    this.openChannelByChannel(channel);
  },

  updatePlayerOsd: function (channel) {
    var nameEl = document.getElementById('playerChannelName');
    var numEl = document.getElementById('playerChannelNumber');
    var logoEl = document.getElementById('playerChannelLogo');
    var progEl = document.getElementById('playerProgramName');
    var progTimeEl = document.getElementById('playerProgramTime');
    var nextProgEl = document.getElementById('playerNextProgram');
    var progBar = document.getElementById('playerProgressBar');

    if (nameEl) nameEl.innerHTML = this.escape(channel.name);
    if (numEl) numEl.innerHTML = channel.channelNumber ? '#' + channel.channelNumber : '';

    if (logoEl) {
      if (channel.logoUrl) {
        var encodedLogoUrl = encodeURIComponent(btoa(channel.logoUrl));
        logoEl.onerror = function () {
          this.className = 'hidden';
        };
        logoEl.onload = function () {
          this.className = '';
        };
        logoEl.src = AppConfig.logoProxyUrl + '/logo?b64=' + encodedLogoUrl;
      } else {
        logoEl.className = 'hidden';
      }
    }

    var currentProg = this.currentProgram(channel);
    var nextProg = this.nextProgram(channel);

    if (currentProg) {
      if (progEl) progEl.innerHTML = this.escape(currentProg.title);
      if (progTimeEl) {
        progTimeEl.innerHTML = '(' + this.formatTime(currentProg.start) + ' - ' +
          this.formatTime(currentProg.end) + ')';
      }
      if (progBar) progBar.style.width = this.progress(currentProg) + '%';
    } else {
      if (progEl) progEl.innerHTML = 'No program info';
      if (progTimeEl) progTimeEl.innerHTML = '';
      if (progBar) progBar.style.width = '0%';
    }

    if (nextProgEl) {
      if (nextProg) {
        nextProgEl.innerHTML = this.formatTime(nextProg.start) + ' ' + this.escape(nextProg.title);
      } else {
        nextProgEl.innerHTML = 'No data';
      }
    }
  },

  closePlayer: function () {
    Player.stop();
    this.hidePlayerControls();
    var playerView = document.getElementById('playerView');
    if (playerView) playerView.className = 'hidden';
    this.currentChannel = null;
    this.focusZone = 'grid';
    if (this.category === 'favorites') {
      this.updateCarouselClasses();
    } else {
      this.setFocus(this.focusIndex);
    }
  },

  previousChannel: function () {
    this.changeChannel(-1);
  },

  nextChannel: function () {
    this.changeChannel(1);
  },

  changeChannel: function (offset) {
    if (!this.currentChannel || !this.visibleChannels.length) return;
    var current = this.visibleChannels.indexOf(this.currentChannel);
    if (current < 0) current = 0;
    current = (current + offset + this.visibleChannels.length) % this.visibleChannels.length;
    this.openChannel(current);
  },

  togglePlay: function () { Player.toggle(); },
  changeAspect: function () { Player.nextAspect(); },
  changeVolume: function (delta) { Player.setVolume(Player.getVolume() + delta); },

  toggleFavoriteByIndex: function (index) {
    var channel = this.visibleChannels[index];
    if (!channel) return;
    this.toggleFavorite(channel.id);
  },

  toggleFavorite: function (id) {
    var position = this.favorites.indexOf(id);
    if (position === -1) {
      this.favorites.push(id);
    } else {
      this.favorites.splice(position, 1);
    }
    this.saveState();
    this.render();
  },

  isFavorite: function (id) {
    return this.favorites.indexOf(id) !== -1;
  },

  bindMouseHandlers: function () {
    var grid = document.getElementById('channelGrid');
    var carousel = document.getElementById('carouselContainer');
    var shade = document.getElementById('playerShade');
    var playerView = document.getElementById('playerView');
    var self = this;

    if (carousel) {
      carousel.onclick = function (event) {
        event = event || window.event;
        var target = event.target || event.srcElement;
        while (target && target !== carousel) {
          if (typeof target.className === 'string' && target.className.indexOf('carouselFavBtn') !== -1) {
            var favId = target.getAttribute('data-id');
            if (favId) {
              self.toggleFavorite(favId);
            }
            self.prevent(event);
            return false;
          }
          if (typeof target.className === 'string' && target.className.indexOf('carouselCard') !== -1) {
            var cardIdx = parseInt(target.getAttribute('data-index'), 10);
            if (!isNaN(cardIdx)) {
              if (self.carouselIndex === cardIdx) {
                var favList = self.getFavoritesChannels();
                if (favList[cardIdx]) {
                  self.openChannelByChannel(favList[cardIdx]);
                }
              } else {
                self.carouselIndex = cardIdx;
                self.focusZone = 'grid';
                self.clearTopFocus();
                self.updateCarouselClasses();
              }
            }
            self.prevent(event);
            return false;
          }
          target = target.parentNode;
        }
      };

      carousel.oncontextmenu = function (event) {
        event = event || window.event;
        var target = event.target || event.srcElement;
        while (target && target !== carousel) {
          if (typeof target.className === 'string' && target.className.indexOf('carouselCard') !== -1) {
            var cardIdx = parseInt(target.getAttribute('data-index'), 10);
            if (!isNaN(cardIdx)) {
              var favList = self.getFavoritesChannels();
              if (favList[cardIdx]) {
                self.currentChannel = favList[cardIdx];
                self.showGuide();
              }
            }
            self.prevent(event);
            return false;
          }
          target = target.parentNode;
        }
        return true;
      };
    }

    grid.onclick = function (event) {
      event = event || window.event;
      var target = self.findChannelTarget(event.target || event.srcElement);
      if (!target) return;
      if (target.className.indexOf('favoriteButton') !== -1) {
        self.toggleFavorite(target.getAttribute('data-id'));
      } else {
        var idx = parseInt(target.getAttribute('data-index'), 10);
        if (!isNaN(idx)) {
          var pageStart = (self.currentPage - 1) * self.pageSize;
          self.focusZone = 'grid';
          self.setFocus(idx - pageStart);
          self.openChannel(idx);
        }
      }
    };
    grid.onmouseover = function (event) {
      event = event || window.event;
      var target = self.findChannelTarget(event.target || event.srcElement);
      if (target && target.className.indexOf('channelCard') !== -1) {
        var idx = parseInt(target.getAttribute('data-index'), 10);
        if (!isNaN(idx)) {
          var pageStart = (self.currentPage - 1) * self.pageSize;
          self.focusZone = 'grid';
          self.mouseFocus(idx - pageStart);
        }
      }
    };
    grid.onfocusin = function (event) {
      event = event || window.event;
      var target = self.findChannelTarget(event.target || event.srcElement);
      if (target && target.className.indexOf('channelCard') !== -1) {
        var idx = parseInt(target.getAttribute('data-index'), 10);
        if (!isNaN(idx)) {
          var pageStart = (self.currentPage - 1) * self.pageSize;
          self.focusZone = 'grid';
          self.setFocus(idx - pageStart);
        }
      }
    };
    grid.oncontextmenu = function (event) {
      event = event || window.event;
      var target = self.findChannelTarget(event.target || event.srcElement);
      if (target && target.className.indexOf('channelCard') !== -1) {
        self.showGuideForIndex(parseInt(target.getAttribute('data-index'), 10));
        self.prevent(event);
        return false;
      }
      return true;
    };
    grid.onmousedown = function (event) {
      event = event || window.event;
      var target = self.findChannelTarget(event.target || event.srcElement);
      if (target && target.className.indexOf('channelCard') !== -1) {
        self.startLongPress(parseInt(target.getAttribute('data-index'), 10));
      }
    };
    grid.onmouseup = function () {
      self.cancelLongPress();
    };
    playerView.onmousemove = function () {
      self.showPlayerControls();
    };
    shade.onmousedown = function (event) {
      self.dragStartY = event.clientY;
      self.dragStartX = event.clientX;
      self.dragValue = event.clientX < 480 ? 0.5 : Player.getVolume() / 100;
    };
    shade.onmousemove = function (event) {
      if (self.dragStartY === null) return;
      var change = (self.dragStartY - event.clientY) / 180;
      if (self.dragStartX >= 480) {
        Player.setVolume(self.dragValue * 100 + change * 100);
      }
    };
    shade.onmouseup = function () {
      self.dragStartY = null;
      self.dragStartX = null;
    };
  },

  showPlayerControls: function () {
    var controls = document.getElementById('playerControls');
    var header = document.getElementById('playerHeader');
    if (!controls || !header) return;
    controls.className = '';
    header.className = '';
    if (this.playerControlsTimer) clearTimeout(this.playerControlsTimer);
    var self = this;
    this.playerControlsTimer = setTimeout(function () {
      self.hidePlayerControls();
    }, 4000);
  },

  hidePlayerControls: function () {
    var controls = document.getElementById('playerControls');
    var header = document.getElementById('playerHeader');
    if (this.playerControlsTimer) clearTimeout(this.playerControlsTimer);
    this.playerControlsTimer = null;
    if (controls) controls.className = 'controlsHidden';
    if (header) header.className = 'controlsHidden';
  },

  startLongPress: function (index) {
    var self = this;
    this.cancelLongPress();
    this.longPressTimer = setTimeout(function () {
      self.showGuideForIndex(index);
    }, 700);
  },

  cancelLongPress: function () {
    if (this.longPressTimer) clearTimeout(this.longPressTimer);
    this.longPressTimer = null;
  },

  showGuideForIndex: function (index) {
    var channel = this.visibleChannels[index];
    if (!channel) return;
    this.currentChannel = channel;
    this.showGuide();
  },

  showGuide: function () {
    var content = document.getElementById('guideContent');
    var channel = this.currentChannel;
    var list = channel ? this.programsFor(channel) : [];
    var html = '';
    var i;
    if (!list.length) {
      html = '<p>No guide data available for this channel.</p>';
    }
    for (i = 0; i < list.length; i++) {
      html += '<div class="guideEntry' + (this.isLive(list[i]) ? ' live' : '') + '">' +
        this.formatTime(list[i].start) + ' - ' + this.formatTime(list[i].end) +
        ' &nbsp; ' + this.escape(list[i].title) + '</div>';
    }
    if (content) content.innerHTML = html;
    var guideTitle = document.getElementById('guideTitle');
    if (guideTitle) {
      guideTitle.innerHTML = channel ?
        this.escape(channel.name) + ' - Daily guide' : 'Daily guide';
    }
    var guideModal = document.getElementById('guideModal');
    if (guideModal) guideModal.className = 'modal';
  },

  closeGuide: function () {
    var guideModal = document.getElementById('guideModal');
    if (guideModal) guideModal.className = 'modal hidden';
  },

  loadEpg: function () {
    var urls = AppConfig.epgUrls;
    if (!urls || !urls.length) return;
    var self = this;
    var trySource = function (position) {
      if (position >= urls.length) return;
      var xhr = new XMLHttpRequest();
      try {
        xhr.open('GET', urls[position], true);
      } catch (openError) {
        trySource(position + 1);
        return;
      }
      xhr.onreadystatechange = function () {
        if (xhr.readyState !== 4) return;
        if (xhr.status >= 200 && xhr.status < 300) {
          try {
            self.parseEpg(xhr.responseText);
          } catch (e) {
            trySource(position + 1);
          }
        } else {
          trySource(position + 1);
        }
      };
      try {
        xhr.send(null);
      } catch (sendError) {
        trySource(position + 1);
      }
    };
    trySource(0);
  },

  parseEpg: function (xmlText) {
    if (!xmlText) return;
    var documentXml = new DOMParser().parseFromString(xmlText, 'text/xml');
    var channelNodes = documentXml.getElementsByTagName('channel');
    var entries = documentXml.getElementsByTagName('programme');
    var i;
    for (i = 0; i < channelNodes.length; i++) {
      var channelNode = channelNodes[i];
      var channelKey = channelNode.getAttribute('id');
      var displayNode = channelNode.getElementsByTagName('display-name')[0];
      if (channelKey && displayNode) {
        this.epgNames[channelKey] = displayNode.textContent;
      }
    }
    var now = new Date().getTime();
    var maxHorizon = now + (24 * 60 * 60 * 1000); // Max 24 hours ahead to save memory

    for (i = 0; i < entries.length; i++) {
      var node = entries[i];
      var channelId = node.getAttribute('channel');
      var start = this.parseXmltvDate(node.getAttribute('start'));
      var end = this.parseXmltvDate(node.getAttribute('stop'));

      // Discard entries that are too old or too far in the future
      if (end.getTime() < now - (2 * 60 * 60 * 1000) || start.getTime() > maxHorizon) {
        continue;
      }

      var titleNode = node.getElementsByTagName('title')[0];
      var title = titleNode ? titleNode.textContent : '';
      var item = {
        channelId: channelId,
        title: title,
        start: start,
        end: end
      };
      if (!this.epg[channelId]) this.epg[channelId] = [];
      // Keep at most 12 programs per channel to prevent OOM
      if (this.epg[channelId].length < 12) {
        this.epg[channelId].push(item);
      }
    }
    this.render();
  },

  parseXmltvDate: function (value) {
    if (!value) return new Date(0);
    var parts = value.replace(/^\s+|\s+$/g, '').split(' ');
    var digits = parts[0];
    return new Date(
      parseInt(digits.substring(0, 4), 10),
      parseInt(digits.substring(4, 6), 10) - 1,
      parseInt(digits.substring(6, 8), 10),
      parseInt(digits.substring(8, 10), 10),
      parseInt(digits.substring(10, 12), 10)
    );
  },

  currentProgram: function (channel) {
    var list = this.programsFor(channel);
    var now = new Date().getTime();
    var i;
    for (i = 0; i < list.length; i++) {
      if (list[i].start.getTime() <= now && list[i].end.getTime() > now) {
        return list[i];
      }
    }
    return null;
  },

  nextProgram: function (channel) {
    var list = this.programsFor(channel);
    var now = new Date().getTime();
    var i;
    for (i = 0; i < list.length; i++) {
      if (list[i].start.getTime() > now) {
        return list[i];
      }
    }
    return null;
  },

  programsFor: function (channel) {
    var list = this.epg[channel.id] || this.epg[channel.name] || [];
    var normalizedChannelName = this.normalizeName(channel.name);
    if (!list.length) {
      for (var key in this.epgNames) {
        if (this.epgNames.hasOwnProperty(key) &&
            this.normalizeName(this.epgNames[key]) === normalizedChannelName) {
          list = this.epg[key] || [];
          break;
        }
      }
    }
    return list;
  },

  isLive: function (program) {
    var now = new Date().getTime();
    return program.start.getTime() <= now && program.end.getTime() > now;
  },

  progress: function (program) {
    var total = program.end.getTime() - program.start.getTime();
    var elapsed = new Date().getTime() - program.start.getTime();
    if (total <= 0) return 0;
    return Math.max(0, Math.min(100, Math.round(elapsed * 100 / total)));
  },

  channelById: function (id) {
    var i;
    for (i = 0; i < this.channels.length; i++) {
      if (this.channels[i].id === id) return this.channels[i];
    }
    return null;
  },

  findChannelTarget: function (target) {
    while (target && target !== document) {
      if (typeof target.className === 'string' &&
          (target.className.indexOf('channelCard') !== -1 ||
           target.className.indexOf('favoriteButton') !== -1)) {
        return target;
      }
      target = target.parentNode;
    }
    return null;
  },

  mouseFocus: function (index) { this.setFocus(index); },

  prevent: function (event) {
    if (!event) return;
    if (event.preventDefault) event.preventDefault();
    if (event.stopPropagation) event.stopPropagation();
    if (event.stopImmediatePropagation) event.stopImmediatePropagation();
    event.returnValue = false;
  },

  formatTime: function (date) {
    if (!date) return '';
    var h = date.getHours();
    var m = date.getMinutes();
    return (h < 10 ? '0' : '') + h + ':' + (m < 10 ? '0' : '') + m;
  },

  normalizeName: function (value) {
    return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
  },

  escape: function (value) {
    return String(value || '').replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
};

window.onload = function () { App.init(); };
