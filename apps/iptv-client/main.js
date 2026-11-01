/*
 * Legacy TV application controller.
 *
 * This file deliberately uses ES5 syntax only:
 *   - var, function declarations and anonymous functions
 *   - XMLHttpRequest for network requests
 *   - no promises, modules, classes, arrow functions or framework code
 *
 * The Orsay WebKit runtime exposes widgetAPI and tvKey after the API scripts
 * in index.html have loaded. The guards below also make the UI inspectable in
 * a normal desktop browser, where those Samsung objects do not exist.
 */

var widgetAPI = null;
var tvKey = null;
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

var Player = {
  object: null,
  playing: false,
  currentUrl: '',
  volume: 100,
  aspect: 0,
  aspects: ['16:9', '4:3', 'Crop'],

  init: function () {
    this.object = document.getElementById('html5Player');
    this.bindEvents();
  },

  setStatus: function (message) {
    var status = document.getElementById('playerProgramName');
    if (status) status.innerHTML = 'Status: ' + message;
    if (window.console && window.console.log) {
      window.console.log('Player: ' + message);
    }
  },

  bindEvents: function () {
    var self = this;
    if (!this.object) return;

    this.object.addEventListener('loadstart', function () {
      self.setStatus('Loading via proxy...');
    });
    this.object.addEventListener('waiting', function () {
      self.setStatus('Buffering...');
    });
    this.object.addEventListener('playing', function () {
      self.playing = true;
      self.setStatus('Playing');
    });
    this.object.addEventListener('error', function () {
      self.playing = false;
      var errCode = self.object.error ? self.object.error.code : 'Unknown';
      if (errCode === 4) {
        self.setStatus('Stream Error 4. Skipping in 3s...');
        setTimeout(function() {
          if (App && typeof App.nextChannel === 'function') App.nextChannel();
        }, 3000);
      } else {
        self.setStatus('Playback Error (Code: ' + errCode + ')');
      }
    });
  },

  setArea: function (mode) {
    var left = 0, width = 960;
    if (mode === 1) { left = 120; width = 720; }
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
    this.setStatus('Connecting to proxy...');

    if (this.object) {
      this.object.src = this.currentUrl;
      try {
        this.object.play();
      } catch (playError) {
        this.setStatus('Play Request Error: ' + playError);
      }
    }
    this.setVolume(this.volume);
  },

  stop: function () {
    if (this.object) {
      try { this.object.pause(); } catch(e) {}
      this.object.src = '';
      this.object.removeAttribute('src');
    }
    this.playing = false;
    this.currentUrl = '';
  },

  toggle: function () {
    if (!this.object) return;
    if (this.playing) {
      try { this.object.pause(); } catch (e) {}
      this.playing = false;
    } else {
      try { this.object.play(); } catch (e) {}
      this.playing = true;
    }
  },

  setVolume: function (value) {
    this.volume = Math.max(0, Math.min(100, value));
    if (this.object) {
      try { this.object.volume = this.volume / 100; } catch (e) {}
    }
    document.getElementById('volumeLabel').innerHTML = this.volume + '%';
  },

  getVolume: function () {
    if (this.object) {
      try { this.volume = Math.round(this.object.volume * 100); } catch (e) {}
    }
    return this.volume;
  },

  nextAspect: function () {
    this.aspect = (this.aspect + 1) % this.aspects.length;
    if (this.object) {
      if (this.aspect === 0) this.object.style.objectFit = 'contain';
      else if (this.aspect === 1) this.object.style.objectFit = 'fill';
      else if (this.aspect === 2) this.object.style.objectFit = 'cover';
    }
    this.setArea(this.aspect);
    var aspectNames = ['16:9 (Fit)', 'Fill', 'Crop'];
    if (typeof App !== 'undefined') App.setStatus('Aspect: ' + aspectNames[this.aspect]);
  }
};

var App = {
  channels: [],
  visibleChannels: [],
  favorites: [],
  history: [],
  epg: {},
  epgNames: {},
  category: 'favorites',
  language: 'all',
  pageSize: 15,
  currentPage: 1,
  totalPages: 1,
  currentChannel: null,
  focusIndex: 0,
  focusItems: [],
  dragStartY: null,
  dragStartX: null,
  dragValue: null,
  longPressTimer: null,
  sleepTimer: null,
  sleepMinutes: 0,
  playerControlsTimer: null,

  init: function () {
    Player.init();
    this.loadState();
    this.bindMouseHandlers();
    this.installKeyHandler();
    this.ready();
    this.refreshChannels();
    this.loadEpg();
  },

  ready: function () {
    /* Without sendReadyEvent the TV will not route remote keys to us. */
    if (widgetAPI && widgetAPI.sendReadyEvent) {
      widgetAPI.sendReadyEvent();
    }
  },

  setStatus: function (message) {
    var status = document.getElementById('status');
    if (status) status.innerHTML = message;
  },

  loadState: function () {
    var storedFavorites = localStorage.getItem('legacy_tv_favorites');
    var storedHistory = localStorage.getItem('legacy_tv_history');
    try { this.favorites = storedFavorites ? JSON.parse(storedFavorites) : []; } catch (e1) { this.favorites = []; }
    try { this.history = storedHistory ? JSON.parse(storedHistory) : []; } catch (e2) { this.history = []; }
  },

  saveState: function () {
    localStorage.setItem('legacy_tv_favorites', JSON.stringify(this.favorites));
    localStorage.setItem('legacy_tv_history', JSON.stringify(this.history));
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
        self.setStatus('Sleep timer closed the player.');
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
      this.setStatus('Channel request could not be opened.');
      return;
    }
    xhr.onreadystatechange = function () {
      if (xhr.readyState !== 4) return;
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          self.channels = self.flattenChannels(JSON.parse(xhr.responseText));
          self.buildFilters();
          self.render();
          self.setStatus(self.channels.length + ' channels');
        } catch (error) {
          self.setStatus('Invalid channel JSON.');
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
    var i;
    var j;
    for (i = 0; i < categories.length; i++) {
      var category = categories[i];
      var list = category.channels || [];
      for (j = 0; j < list.length; j++) {
        var channel = list[j];
        channel.categoryId = category.id || 'other';
        channel.categoryName = category.name || 'Other';
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
    document.getElementById('allFilter').className = value === 'all' ? 'chip active' : 'chip';
    document.getElementById('favoritesFilter').className = value === 'favorites' ? 'chip active' : 'chip';
    this.currentPage = 1;
    this.render();
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

  render: function () {
    var grid = document.getElementById('channelGrid');
    var list = this.filtered();
    var pageStart;
    var pageEnd;
    var html = '';
    var i;
    this.visibleChannels = list;
    this.totalPages = Math.max(1, Math.ceil(list.length / this.pageSize));
    if (this.currentPage > this.totalPages) this.currentPage = this.totalPages;
    pageStart = (this.currentPage - 1) * this.pageSize;
    pageEnd = Math.min(pageStart + this.pageSize, list.length);
    for (i = pageStart; i < pageEnd; i++) {
      html += this.cardHtml(list[i], i);
    }
    if (!html) {
      html = this.category === 'favorites' && !this.favorites.length ?
        '<div class="empty">Nincsenek kedvencek. Válassz a kategóriák közül!</div>' :
        '<div class="empty">No channels match this filter.</div>';
    }
    grid.innerHTML = html;
    this.renderPagination();
    this.renderHistory();
    this.focusItems = this.findFocusableCards();
    this.setFocus(0);
  },

  cardHtml: function (channel, index) {
    var program = this.currentProgram(channel);
    var progress = program ? this.progress(program) : 0;
    var logo = '';
    if (channel.logoUrl) {
      var encodedLogoUrl = encodeURIComponent(btoa(channel.logoUrl));
      var proxiedLogoUrl = AppConfig.logoProxyUrl + '/logo?b64=' + encodedLogoUrl;
      logo = '<img src="' + this.escape(proxiedLogoUrl) + '" />';
    }
    var favoriteText = this.isFavorite(channel.id) ? 'Favorite' : 'Add favorite';
    return '<div class="channelCard" id="channel-' + index + '" tabindex="-1" data-index="' + index +
      '" data-id="' + this.escape(channel.id) + '">' +
      '<button class="favoriteButton" data-id="' + this.escape(channel.id) + '">' +
      favoriteText + '</button>' + logo +
      '<div class="channelName">' + this.escape(channel.name) + '</div>' +
      '<div class="channelMeta">' + this.escape(channel.categoryName || '') + ' / ' +
      this.escape(channel.language || '') + '</div>' +
      '<div class="program">' + (program ? this.escape(program.title) : 'No EPG data') + '</div>' +
      '<div class="progress"><span style="width:' + progress + '%;"></span></div></div>';
  },

  renderHistory: function () {
    var row = document.getElementById('historyRow');
    var html = '';
    var i;
    for (i = 0; i < this.history.length; i++) {
      var channel = this.channelById(this.history[i]);
      if (channel) {
        html += '<span class="historyItem" data-id="' + this.escape(channel.id) + '">' +
          this.escape(channel.name) + '</span>';
      }
    }
    row.innerHTML = html;
    row.className = html ? '' : 'hidden';
  },

  renderPagination: function () {
    var previous = document.getElementById('previousPageButton');
    var next = document.getElementById('nextPageButton');
    var label = document.getElementById('pageLabel');
    previous.disabled = this.currentPage <= 1;
    next.disabled = this.currentPage >= this.totalPages;
    label.innerHTML = 'Page ' + this.currentPage + ' / ' + this.totalPages;
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
      if (cards[i].className.indexOf('channelCard') !== -1) result.push(cards[i]);
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
  },

  moveFocus: function (key) {
    var columns = 5;
    var next = this.focusIndex;
    var lastIndex = this.focusItems.length - 1;
    if (key === 'left') next--;
    if (key === 'right') next++;
    if (key === 'up') next -= columns;
    if (key === 'down') next += columns;

    if ((key === 'right' || key === 'down') &&
        next > lastIndex && this.currentPage < this.totalPages) {
      this.currentPage++;
      this.render();
      this.setFocus(0);
      return;
    }
    if ((key === 'left' || key === 'up') &&
        next < 0 && this.currentPage > 1) {
      this.currentPage--;
      this.render();
      this.setFocus(this.focusItems.length - 1);
      return;
    }
    this.setFocus(next);
  },

  installKeyHandler: function () {
    var self = this;
    window.onkeydown = function (event) {
      var code = event.keyCode;
      var key = self.keyName(code);
      if (key && document.getElementById('playerView').className.indexOf('hidden') === -1) {
        self.showPlayerControls();
      }
      if (key === 'left' || key === 'right' || key === 'up' || key === 'down') {
        self.moveFocus(key);
        self.prevent(event);
        return false;
      }
      if (key === 'enter') {
        var focused = document.querySelector('.focused');
        if (!document.getElementById('playerView').className && focused) {
          focused.click();
        } else {
          Player.toggle();
        }
        self.prevent(event);
        return false;
      }
      if (key === 'return' || key === 'back') {
        if (document.getElementById('guideModal').className.indexOf('hidden') === -1) {
          self.closeGuide();
        } else if (document.getElementById('playerView').className.indexOf('hidden') === -1) {
          self.closePlayer();
        } else if (widgetAPI && widgetAPI.sendReturnEvent) {
          widgetAPI.sendReturnEvent();
        }
        self.prevent(event);
        return false;
      }
      return true;
    };
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

  keyName: function (code) {
    if (tvKey) {
      if (code === tvKey.KEY_LEFT) return 'left';
      if (code === tvKey.KEY_RIGHT) return 'right';
      if (code === tvKey.KEY_UP) return 'up';
      if (code === tvKey.KEY_DOWN) return 'down';
      if (code === tvKey.KEY_ENTER) return 'enter';
      if (code === tvKey.KEY_RETURN) return 'return';
    }
    if (code === 37) return 'left';
    if (code === 38) return 'up';
    if (code === 39) return 'right';
    if (code === 40) return 'down';
    if (code === 13) return 'enter';
    if (code === 8 || code === 27) return 'return';
    return '';
  },

  openChannel: function (index) {
    var channel = this.visibleChannels[index];
    if (!channel) return;
    this.currentChannel = channel;
    this.history.unshift(channel.id);
    this.history = this.uniqueFirstFive(this.history);
    this.saveState();
    document.getElementById('playerChannelName').innerHTML = this.escape(channel.name);
    document.getElementById('playerProgramName').innerHTML = this.currentProgram(channel) ?
      this.escape(this.currentProgram(channel).title) : '';
    document.getElementById('playerView').className = '';
    this.hidePlayerControls();
    Player.play(channel.streamUrl);
  },

  openById: function (id) {
    var i;
    for (i = 0; i < this.channels.length; i++) {
      if (this.channels[i].id === id) {
        this.visibleChannels = this.channels;
        this.openChannel(i);
        return;
      }
    }
  },

  closePlayer: function () {
    Player.stop();
    this.hidePlayerControls();
    document.getElementById('playerView').className = 'hidden';
    this.currentChannel = null;
    this.renderHistory();
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
    if (position === -1) this.favorites.push(id);
    else this.favorites.splice(position, 1);
    this.saveState();
    this.render();
  },

  isFavorite: function (id) { return this.favorites.indexOf(id) !== -1; },

  bindMouseHandlers: function () {
    var grid = document.getElementById('channelGrid');
    var history = document.getElementById('historyRow');
    var shade = document.getElementById('playerShade');
    var playerView = document.getElementById('playerView');
    var self = this;
    grid.onclick = function (event) {
      event = event || window.event;
      var target = self.findChannelTarget(event.target || event.srcElement);
      if (!target) return;
      if (target.className.indexOf('favoriteButton') !== -1) {
        self.toggleFavorite(target.getAttribute('data-id'));
      } else {
        self.openChannel(parseInt(target.getAttribute('data-index'), 10));
      }
    };
    grid.onmouseover = function (event) {
      event = event || window.event;
      var target = self.findChannelTarget(event.target || event.srcElement);
      if (target && target.className.indexOf('channelCard') !== -1) {
        self.mouseFocus(parseInt(target.getAttribute('data-index'), 10));
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
    history.onclick = function (event) {
      event = event || window.event;
      var target = event.target || event.srcElement;
      while (target && target !== history) {
        if (target.className && target.className.indexOf('historyItem') !== -1) {
          self.openById(target.getAttribute('data-id'));
          return;
        }
        target = target.parentNode;
      }
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
      } else {
        self.setBrightness(self.dragValue + change);
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
    }, 3500);
  },

  hidePlayerControls: function () {
    var controls = document.getElementById('playerControls');
    var header = document.getElementById('playerHeader');
    if (this.playerControlsTimer) clearTimeout(this.playerControlsTimer);
    this.playerControlsTimer = null;
    if (controls) controls.className = 'controlsHidden';
    if (header) header.className = 'controlsHidden';
  },

  setBrightness: function (value) {
    var brightness = Math.max(0, Math.min(100, Math.round(value * 100)));
    if (Player.object && Player.object.SetBrightness) {
      try { Player.object.SetBrightness(brightness); } catch (e) {}
      Player.setStatus('Brightness: ' + brightness + '%');
    } else {
      this.setStatus('Brightness API unavailable.');
    }
  },

  startLongPress: function (index) {
    var self = this;
    this.cancelLongPress();
    this.longPressTimer = setTimeout(function () { self.showGuideForIndex(index); }, 700);
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
    if (!list.length) html = '<p>No guide data available for this channel.</p>';
    for (i = 0; i < list.length; i++) {
      html += '<div class="guideEntry' + (this.isLive(list[i]) ? ' live' : '') + '">' +
        this.formatTime(list[i].start) + ' - ' + this.formatTime(list[i].end) +
        ' &nbsp; ' + this.escape(list[i].title) + '</div>';
    }
    content.innerHTML = html;
    document.getElementById('guideTitle').innerHTML = channel ?
      this.escape(channel.name) + ' - Daily guide' : 'Daily guide';
    document.getElementById('guideModal').className = 'modal';
  },

  closeGuide: function () { document.getElementById('guideModal').className = 'modal hidden'; },

  loadEpg: function () {
    var urls = AppConfig.epgUrls;
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
          self.parseEpg(xhr.responseText);
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
    for (i = 0; i < entries.length; i++) {
      var node = entries[i];
      var channelId = node.getAttribute('channel');
      var titleNode = node.getElementsByTagName('title')[0];
      var title = titleNode ? titleNode.textContent : '';
      var item = {
        channelId: channelId,
        title: title,
        start: this.parseXmltvDate(node.getAttribute('start')),
        end: this.parseXmltvDate(node.getAttribute('stop'))
      };
      if (!this.epg[channelId]) this.epg[channelId] = [];
      this.epg[channelId].push(item);
    }
    this.render();
  },

  parseXmltvDate: function (value) {
    if (!value) return new Date(0);
    var parts = value.replace(/^\s+|\s+$/g, '').split(' ');
    var digits = parts[0];
    var date = new Date(
      parseInt(digits.substring(0, 4), 10),
      parseInt(digits.substring(4, 6), 10) - 1,
      parseInt(digits.substring(6, 8), 10),
      parseInt(digits.substring(8, 10), 10),
      parseInt(digits.substring(10, 12), 10)
    );
    return date;
  },

  currentProgram: function (channel) {
    var list = this.programsFor(channel);
    var now = new Date().getTime();
    var i;
    for (i = 0; i < list.length; i++) {
      if (list[i].start.getTime() <= now && list[i].end.getTime() > now) return list[i];
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

  uniqueFirstFive: function (items) {
    var result = [];
    var i;
    for (i = 0; i < items.length && result.length < 5; i++) {
      if (result.indexOf(items[i]) === -1) result.push(items[i]);
    }
    return result;
  },

  channelById: function (id) {
    var i;
    for (i = 0; i < this.channels.length; i++) {
      if (this.channels[i].id === id) return this.channels[i];
    }
    return null;
  },

  mouseFocus: function (index) { this.setFocus(index); },
  prevent: function (event) {
    if (event && event.preventDefault) event.preventDefault();
    if (event) event.returnValue = false;
  },
  formatTime: function (date) {
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