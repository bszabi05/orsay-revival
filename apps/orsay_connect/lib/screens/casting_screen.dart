import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:receive_sharing_intent/receive_sharing_intent.dart';
import '../services/api_service.dart';
import '../utils/url_extractor.dart';

/// Main Casting controller screen: playback controls, now-playing card,
/// playlist queue inspector, and share intent receiver.
class CastingScreen extends StatefulWidget {
  const CastingScreen({super.key});

  @override
  State<CastingScreen> createState() => _CastingScreenState();
}

class _CastingScreenState extends State<CastingScreen> {
  final TextEditingController _urlController = TextEditingController();
  StreamSubscription<List<SharedMediaFile>>? _intentSub;
  Timer? _pollTimer;

  // Live backend states
  CastStatus _currentStatus = CastStatus.idle();
  QueueInfo _queueInfo = QueueInfo.empty();
  bool _isLoadingStatus = false;

  // Local action loaders
  bool _isCastingVideo = false;
  bool _isCastingMusic = false;
  bool _isAddingToQueue = false;
  bool _isControllingPlayback = false;

  @override
  void initState() {
    super.initState();
    _initShareIntentListener();
    _fetchLiveState();

    // Periodic live sync every 3 seconds
    _pollTimer = Timer.periodic(const Duration(seconds: 3), (_) {
      if (mounted) {
        _fetchLiveState(isBackground: true);
      }
    });
  }

  @override
  void dispose() {
    _pollTimer?.cancel();
    _intentSub?.cancel();
    _urlController.dispose();
    super.dispose();
  }

  /// Polls current cast status and playlist queue from Flask proxy.
  Future<void> _fetchLiveState({bool isBackground = false}) async {
    if (_isLoadingStatus && !isBackground) return;
    if (!isBackground) {
      setState(() => _isLoadingStatus = true);
    }

    try {
      final statusFuture = ApiService.getStatus();
      final queueFuture = ApiService.getQueue();

      final results = await Future.wait([statusFuture, queueFuture]);
      if (mounted) {
        setState(() {
          _currentStatus = results[0] as CastStatus;
          _queueInfo = results[1] as QueueInfo;
          _isLoadingStatus = false;
        });
      }
    } catch (_) {
      if (mounted && !isBackground) {
        setState(() => _isLoadingStatus = false);
      }
    }
  }

  /// Initialize listeners for incoming share intents (YouTube, Chrome, etc.)
  void _initShareIntentListener() {
    // 1. Warm Start: App is in memory or background
    _intentSub = ReceiveSharingIntent.instance.getMediaStream().listen(
      (List<SharedMediaFile> value) {
        if (!mounted || value.isEmpty) return;
        final rawText = value.first.path;
        final cleanUrl = UrlExtractor.extract(rawText);
        if (cleanUrl.isNotEmpty) {
          setState(() {
            _urlController.text = cleanUrl;
          });
          _triggerCast(cleanUrl, 'video', isAutoShared: true);
        }
      },
      onError: (err) {
        debugPrint('[OrsayConnect] Share intent stream error: $err');
      },
    );

    // 2. Cold Start: App was launched directly from the Share menu
    ReceiveSharingIntent.instance.getInitialMedia().then((List<SharedMediaFile> value) {
      if (!mounted || value.isEmpty) return;
      final rawText = value.first.path;
      final cleanUrl = UrlExtractor.extract(rawText);
      if (cleanUrl.isNotEmpty) {
        setState(() {
          _urlController.text = cleanUrl;
        });
        _triggerCast(cleanUrl, 'video', isAutoShared: true);
      }
      ReceiveSharingIntent.instance.reset();
    }).catchError((err) {
      debugPrint('[OrsayConnect] Initial share intent error: $err');
    });
  }

  /// Trigger immediate cast on TV.
  Future<void> _triggerCast(
    String url,
    String type, {
    bool isAutoShared = false,
  }) async {
    final cleanUrl = UrlExtractor.extract(url);
    if (cleanUrl.isEmpty) {
      _showFeedback('Please enter a valid video or music URL!', isSuccess: false);
      return;
    }

    setState(() {
      if (type == 'music') {
        _isCastingMusic = true;
      } else {
        _isCastingVideo = true;
      }
    });

    final prefix = isAutoShared ? '[Shared] ' : '';
    final result = await ApiService.castMedia(url: cleanUrl, type: type, playNow: true);

    if (!mounted) return;

    setState(() {
      _isCastingVideo = false;
      _isCastingMusic = false;
    });

    _showFeedback('$prefix${result.message}', isSuccess: result.success);
    _fetchLiveState();
  }

  /// Append to playlist queue without interrupting currently playing media.
  Future<void> _triggerAddToQueue(String url) async {
    final cleanUrl = UrlExtractor.extract(url);
    if (cleanUrl.isEmpty) {
      _showFeedback('Please enter a valid URL to add to queue!', isSuccess: false);
      return;
    }

    setState(() => _isAddingToQueue = true);
    final result = await ApiService.addToQueue(url: cleanUrl, type: 'video');

    if (!mounted) return;
    setState(() => _isAddingToQueue = false);

    _showFeedback(result.message, isSuccess: result.success);
    if (result.success) {
      _urlController.clear();
      _fetchLiveState();
    }
  }

  /// Toggle play / pause on TV.
  Future<void> _togglePlayPause() async {
    setState(() => _isControllingPlayback = true);
    final result = await ApiService.togglePlayPause();
    if (!mounted) return;
    setState(() => _isControllingPlayback = false);

    _showFeedback(result.message, isSuccess: result.success);
    _fetchLiveState();
  }

  /// Skip to next media item in queue.
  Future<void> _skipNext() async {
    setState(() => _isControllingPlayback = true);
    final result = await ApiService.nextTrack();
    if (!mounted) return;
    setState(() => _isControllingPlayback = false);

    _showFeedback(result.message, isSuccess: result.success);
    _fetchLiveState();
  }

  /// Go back to previous media item in queue.
  Future<void> _skipPrevious() async {
    setState(() => _isControllingPlayback = true);
    final result = await ApiService.previousTrack();
    if (!mounted) return;
    setState(() => _isControllingPlayback = false);

    _showFeedback(result.message, isSuccess: result.success);
    _fetchLiveState();
  }

  /// Stop current playback.
  Future<void> _stopPlayback() async {
    setState(() => _isControllingPlayback = true);
    final result = await ApiService.stopStream();
    if (!mounted) return;
    setState(() => _isControllingPlayback = false);

    _showFeedback(result.message, isSuccess: result.success);
    _fetchLiveState();
  }

  /// Remove a single item from the queue.
  Future<void> _removeItemFromQueue(int itemId) async {
    final result = await ApiService.removeQueueItem(itemId);
    _showFeedback(result.message, isSuccess: result.success);
    _fetchLiveState();
  }

  /// Clear all items from queue.
  Future<void> _clearQueue() async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        backgroundColor: const Color(0xFF162032),
        title: const Text('Clear Queue'),
        content: const Text('Are you sure you want to clear all items in the playlist queue?'),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(ctx).pop(false),
            child: const Text('Cancel'),
          ),
          ElevatedButton(
            style: ElevatedButton.styleFrom(backgroundColor: Colors.redAccent),
            onPressed: () => Navigator.of(ctx).pop(true),
            child: const Text('Clear', style: TextStyle(color: Colors.white)),
          ),
        ],
      ),
    );

    if (confirmed == true) {
      final result = await ApiService.clearQueue();
      _showFeedback(result.message, isSuccess: result.success);
      _fetchLiveState();
    }
  }

  /// Paste from system clipboard.
  Future<void> _pasteFromClipboard() async {
    final data = await Clipboard.getData(Clipboard.kTextPlain);
    if (data?.text != null && data!.text!.trim().isNotEmpty) {
      final clean = UrlExtractor.extract(data.text!);
      setState(() => _urlController.text = clean);
      _showFeedback('URL pasted from clipboard', isSuccess: true);
    }
  }

  void _showFeedback(String message, {required bool isSuccess}) {
    if (!mounted) return;
    ScaffoldMessenger.of(context).removeCurrentSnackBar();
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Row(
          children: [
            Icon(
              isSuccess ? Icons.check_circle_rounded : Icons.error_rounded,
              color: isSuccess ? Colors.greenAccent : Colors.redAccent,
              size: 20,
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Text(
                message,
                style: const TextStyle(fontWeight: FontWeight.w500),
              ),
            ),
          ],
        ),
        backgroundColor: isSuccess ? const Color(0xFF163828) : const Color(0xFF381616),
        behavior: SnackBarBehavior.floating,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
        duration: const Duration(seconds: 3),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final isAnyLoading = _isCastingVideo || _isCastingMusic || _isAddingToQueue || _isControllingPlayback;

    return Scaffold(
      appBar: AppBar(
        title: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            ClipRRect(
              borderRadius: BorderRadius.circular(6),
              child: Image.asset(
                'assets/conn_logo.png',
                width: 26,
                height: 26,
              ),
            ),
            const SizedBox(width: 10),
            const Text(
              'Orsay Cast',
              style: TextStyle(fontWeight: FontWeight.bold, letterSpacing: 0.5),
            ),
          ],
        ),
        centerTitle: true,
        actions: [
          IconButton(
            icon: _isLoadingStatus
                ? const SizedBox(
                    width: 18,
                    height: 18,
                    child: CircularProgressIndicator(strokeWidth: 2, color: Colors.blueAccent),
                  )
                : const Icon(Icons.refresh_rounded),
            tooltip: 'Refresh Status',
            onPressed: () => _fetchLiveState(),
          ),
        ],
      ),
      body: RefreshIndicator(
        onRefresh: () => _fetchLiveState(),
        child: SingleChildScrollView(
          physics: const AlwaysScrollableScrollPhysics(),
          padding: const EdgeInsets.symmetric(horizontal: 16.0, vertical: 14.0),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              // 1. Now Playing & Control Panel
              _buildNowPlayingCard(),

              const SizedBox(height: 18),

              // 2. Playlist Queue Section
              _buildPlaylistSection(),

              const SizedBox(height: 18),

              // 3. Cast Media Input Card
              _buildCastInputCard(isAnyLoading),
            ],
          ),
        ),
      ),
    );
  }

  /// Now Playing Card with live status and playback controls
  Widget _buildNowPlayingCard() {
    final theme = Theme.of(context);
    final hasActiveMedia = _currentStatus.title != null || _currentStatus.status != 'idle';
    final isPlaying = _currentStatus.isPlaying;
    final isPaused = _currentStatus.isPaused;
    final isExtracting = _currentStatus.isExtracting;

    Color statusColor;
    String statusLabel;
    if (isExtracting) {
      statusColor = const Color(0xFF3B82F6);
      statusLabel = 'EXTRACTING';
    } else if (isPlaying) {
      statusColor = const Color(0xFF22C55E);
      statusLabel = 'PLAYING';
    } else if (isPaused) {
      statusColor = const Color(0xFFF59E0B);
      statusLabel = 'PAUSED';
    } else if (_currentStatus.status == 'error') {
      statusColor = const Color(0xFFEF4444);
      statusLabel = 'ERROR';
    } else {
      statusColor = const Color(0xFF64748B);
      statusLabel = 'IDLE';
    }

    return Card(
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
      color: const Color(0xFF162032),
      elevation: 0,
      child: Padding(
        padding: const EdgeInsets.all(18.0),
        child: Column(
          children: [
            // Status Header Row
            Row(
              children: [
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                  decoration: BoxDecoration(
                    color: statusColor.withValues(alpha: 0.15),
                    borderRadius: BorderRadius.circular(6),
                    border: Border.all(color: statusColor.withValues(alpha: 0.4)),
                  ),
                  child: Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Container(
                        width: 7,
                        height: 7,
                        decoration: BoxDecoration(color: statusColor, shape: BoxShape.circle),
                      ),
                      const SizedBox(width: 6),
                      Text(
                        statusLabel,
                        style: TextStyle(
                          fontSize: 11,
                          fontWeight: FontWeight.bold,
                          color: statusColor,
                          letterSpacing: 0.8,
                        ),
                      ),
                    ],
                  ),
                ),
                const SizedBox(width: 8),
                if (_currentStatus.mediaType.isNotEmpty)
                  Container(
                    padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 4),
                    decoration: BoxDecoration(
                      color: Colors.white.withValues(alpha: 0.06),
                      borderRadius: BorderRadius.circular(6),
                    ),
                    child: Text(
                      _currentStatus.mediaType.toUpperCase(),
                      style: const TextStyle(
                        fontSize: 10,
                        fontWeight: FontWeight.w600,
                        color: Colors.grey,
                        letterSpacing: 0.5,
                      ),
                    ),
                  ),
                const Spacer(),
                if (_currentStatus.queueCount > 0)
                  Text(
                    'Item ${_currentStatus.queueIndex + 1} of ${_currentStatus.queueCount}',
                    style: theme.textTheme.bodySmall?.copyWith(color: Colors.grey.shade400),
                  ),
              ],
            ),

            const SizedBox(height: 14),

            // Track Details with Thumbnail
            Row(
              crossAxisAlignment: CrossAxisAlignment.center,
              children: [
                // Thumbnail or Media Icon
                Container(
                  width: 68,
                  height: 68,
                  decoration: BoxDecoration(
                    color: const Color(0xFF0F172A),
                    borderRadius: BorderRadius.circular(10),
                    border: Border.all(color: Colors.white.withValues(alpha: 0.08)),
                  ),
                  clipBehavior: Clip.antiAlias,
                  child: (_currentStatus.thumbnail != null && _currentStatus.thumbnail!.isNotEmpty)
                      ? Image.network(
                          _currentStatus.thumbnail!,
                          fit: BoxFit.cover,
                          errorBuilder: (_, __, ___) => Icon(
                            _currentStatus.mediaType == 'music'
                                ? Icons.music_note_rounded
                                : Icons.movie_rounded,
                            color: Colors.blueAccent,
                            size: 32,
                          ),
                        )
                      : Icon(
                          _currentStatus.mediaType == 'music'
                              ? Icons.music_note_rounded
                              : Icons.tv_rounded,
                          color: Colors.blueAccent,
                          size: 32,
                        ),
                ),
                const SizedBox(width: 14),
                // Title & Artist
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        _currentStatus.title ?? (hasActiveMedia ? 'Loading media...' : 'Nothing Playing'),
                        style: theme.textTheme.titleMedium?.copyWith(
                          fontWeight: FontWeight.bold,
                        ),
                        maxLines: 2,
                        overflow: TextOverflow.ellipsis,
                      ),
                      const SizedBox(height: 4),
                      Text(
                        _currentStatus.artist ??
                            (_currentStatus.originalUrl ?? 'Ready to receive media from phone'),
                        style: theme.textTheme.bodySmall?.copyWith(
                          color: Colors.grey.shade400,
                        ),
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                      ),
                    ],
                  ),
                ),
              ],
            ),

            const SizedBox(height: 18),
            const Divider(color: Color(0xFF1E293B), height: 1),
            const SizedBox(height: 14),

            // Playback Control Buttons
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceEvenly,
              children: [
                // Previous Button
                IconButton(
                  icon: const Icon(Icons.skip_previous_rounded),
                  iconSize: 32,
                  color: _currentStatus.hasPrev ? Colors.white : Colors.grey.shade600,
                  tooltip: 'Previous Track',
                  onPressed: _currentStatus.hasPrev ? _skipPrevious : null,
                ),

                // Stop Button
                IconButton(
                  icon: const Icon(Icons.stop_rounded),
                  iconSize: 30,
                  color: hasActiveMedia ? Colors.redAccent : Colors.grey.shade600,
                  tooltip: 'Stop Playback',
                  onPressed: hasActiveMedia ? _stopPlayback : null,
                ),

                // Play / Pause Main Button
                Container(
                  width: 54,
                  height: 54,
                  decoration: BoxDecoration(
                    color: const Color(0xFF2563EB),
                    shape: BoxShape.circle,
                    boxShadow: [
                      BoxShadow(
                        color: const Color(0xFF2563EB).withValues(alpha: 0.35),
                        blurRadius: 10,
                        offset: const Offset(0, 4),
                      ),
                    ],
                  ),
                  child: IconButton(
                    icon: Icon(
                      isPaused ? Icons.play_arrow_rounded : Icons.pause_rounded,
                      color: Colors.white,
                      size: 32,
                    ),
                    tooltip: isPaused ? 'Play' : 'Pause',
                    onPressed: hasActiveMedia ? _togglePlayPause : null,
                  ),
                ),

                // Next / Skip Button
                IconButton(
                  icon: const Icon(Icons.skip_next_rounded),
                  iconSize: 32,
                  color: _currentStatus.hasNext ? Colors.white : Colors.grey.shade600,
                  tooltip: 'Next Track',
                  onPressed: _currentStatus.hasNext ? _skipNext : null,
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }

  /// Playlist Queue Section
  Widget _buildPlaylistSection() {
    final theme = Theme.of(context);
    final count = _queueInfo.count;

    return Card(
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
      color: const Color(0xFF162032),
      elevation: 0,
      child: Padding(
        padding: const EdgeInsets.all(18.0),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            // Queue Header
            Row(
              children: [
                Container(
                  padding: const EdgeInsets.all(6),
                  decoration: BoxDecoration(
                    color: Colors.blue.withValues(alpha: 0.12),
                    borderRadius: BorderRadius.circular(8),
                  ),
                  child: const Icon(Icons.queue_music_rounded, color: Colors.blueAccent, size: 20),
                ),
                const SizedBox(width: 10),
                Text(
                  'Playlist Queue ($count)',
                  style: theme.textTheme.titleMedium?.copyWith(
                    fontWeight: FontWeight.bold,
                  ),
                ),
                const Spacer(),
                if (count > 0)
                  TextButton.icon(
                    icon: const Icon(Icons.delete_sweep_rounded, size: 16),
                    label: const Text('Clear'),
                    style: TextButton.styleFrom(
                      foregroundColor: Colors.redAccent,
                      padding: const EdgeInsets.symmetric(horizontal: 8),
                      visualDensity: VisualDensity.compact,
                    ),
                    onPressed: _clearQueue,
                  ),
              ],
            ),

            const SizedBox(height: 12),

            // Queue List or Empty State
            if (count == 0)
              Padding(
                padding: const EdgeInsets.symmetric(vertical: 18.0),
                child: Center(
                  child: Text(
                    'No items in queue. Cast a video or add links below!',
                    style: theme.textTheme.bodySmall?.copyWith(color: Colors.grey.shade400),
                  ),
                ),
              )
            else
              ListView.separated(
                shrinkWrap: true,
                physics: const NeverScrollableScrollPhysics(),
                itemCount: _queueInfo.items.length,
                separatorBuilder: (_, __) => const Divider(color: Color(0xFF1E293B), height: 1),
                itemBuilder: (context, index) {
                  final item = _queueInfo.items[index];
                  final isCurrent = index == _queueInfo.currentIndex;

                  return Container(
                    padding: const EdgeInsets.symmetric(vertical: 8, horizontal: 6),
                    decoration: BoxDecoration(
                      color: isCurrent ? Colors.blue.withValues(alpha: 0.08) : Colors.transparent,
                      borderRadius: BorderRadius.circular(8),
                    ),
                    child: Row(
                      children: [
                        // Index or Play Indicator
                        SizedBox(
                          width: 24,
                          child: isCurrent
                              ? const Icon(Icons.play_arrow_rounded, color: Colors.blueAccent, size: 20)
                              : Text(
                                  '${index + 1}',
                                  style: TextStyle(color: Colors.grey.shade500, fontSize: 13),
                                  textAlign: TextAlign.center,
                                ),
                        ),
                        const SizedBox(width: 8),

                        // Thumbnail / Icon
                        Container(
                          width: 42,
                          height: 42,
                          decoration: BoxDecoration(
                            color: const Color(0xFF0F172A),
                            borderRadius: BorderRadius.circular(6),
                          ),
                          clipBehavior: Clip.antiAlias,
                          child: (item.thumbnail != null && item.thumbnail!.isNotEmpty)
                              ? Image.network(
                                  item.thumbnail!,
                                  fit: BoxFit.cover,
                                  errorBuilder: (_, __, ___) => Icon(
                                    item.mediaType == 'music' ? Icons.music_note : Icons.movie,
                                    size: 18,
                                    color: Colors.grey,
                                  ),
                                )
                              : Icon(
                                  item.mediaType == 'music' ? Icons.music_note : Icons.movie,
                                  size: 18,
                                  color: Colors.grey,
                                ),
                        ),
                        const SizedBox(width: 12),

                        // Item Details
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(
                                item.title,
                                style: TextStyle(
                                  fontWeight: isCurrent ? FontWeight.bold : FontWeight.w500,
                                  color: isCurrent ? Colors.white : Colors.grey.shade300,
                                  fontSize: 13,
                                ),
                                maxLines: 1,
                                overflow: TextOverflow.ellipsis,
                              ),
                              if (item.artist != null && item.artist!.isNotEmpty)
                                Text(
                                  item.artist!,
                                  style: TextStyle(color: Colors.grey.shade500, fontSize: 11),
                                  maxLines: 1,
                                  overflow: TextOverflow.ellipsis,
                                ),
                            ],
                          ),
                        ),

                        // Delete from queue button
                        IconButton(
                          icon: const Icon(Icons.close_rounded, size: 18),
                          color: Colors.grey.shade500,
                          tooltip: 'Remove',
                          onPressed: () => _removeItemFromQueue(item.id),
                        ),
                      ],
                    ),
                  );
                },
              ),
          ],
        ),
      ),
    );
  }

  /// Manual URL Cast and Queue Input Card
  Widget _buildCastInputCard(bool isAnyLoading) {
    final theme = Theme.of(context);

    return Card(
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
      color: const Color(0xFF162032),
      elevation: 0,
      child: Padding(
        padding: const EdgeInsets.all(18.0),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Text(
                  'Cast Media URL',
                  style: theme.textTheme.titleSmall?.copyWith(
                    fontWeight: FontWeight.bold,
                    letterSpacing: 0.5,
                  ),
                ),
                TextButton.icon(
                  onPressed: _pasteFromClipboard,
                  icon: const Icon(Icons.paste_rounded, size: 16),
                  label: const Text('Paste'),
                  style: TextButton.styleFrom(
                    foregroundColor: Colors.blueAccent,
                    padding: const EdgeInsets.symmetric(horizontal: 8),
                    visualDensity: VisualDensity.compact,
                  ),
                ),
              ],
            ),
            const SizedBox(height: 10),
            TextField(
              controller: _urlController,
              keyboardType: TextInputType.url,
              maxLines: 2,
              minLines: 1,
              decoration: InputDecoration(
                hintText: 'https://www.youtube.com/watch?v=...',
                prefixIcon: const Icon(Icons.link_rounded),
                suffixIcon: _urlController.text.isNotEmpty
                    ? IconButton(
                        icon: const Icon(Icons.clear_rounded),
                        onPressed: () {
                          setState(() => _urlController.clear());
                        },
                      )
                    : null,
                filled: true,
                fillColor: const Color(0xFF0F172A),
                border: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(12),
                  borderSide: BorderSide(color: Colors.white.withValues(alpha: 0.08)),
                ),
                enabledBorder: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(12),
                  borderSide: BorderSide(color: Colors.white.withValues(alpha: 0.08)),
                ),
                focusedBorder: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(12),
                  borderSide: const BorderSide(color: Colors.blueAccent),
                ),
              ),
              onChanged: (_) => setState(() {}),
            ),
            const SizedBox(height: 16),

            // Action Buttons
            Row(
              children: [
                // 🎬 Cast Video
                Expanded(
                  child: ElevatedButton.icon(
                    icon: _isCastingVideo
                        ? const SizedBox(
                            width: 16,
                            height: 16,
                            child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white),
                          )
                        : const Text('🎬', style: TextStyle(fontSize: 14)),
                    label: Text(_isCastingVideo ? 'Casting...' : 'Cast Video'),
                    style: ElevatedButton.styleFrom(
                      backgroundColor: const Color(0xFF2563EB),
                      foregroundColor: Colors.white,
                      padding: const EdgeInsets.symmetric(vertical: 13),
                      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
                    ),
                    onPressed: isAnyLoading ? null : () => _triggerCast(_urlController.text, 'video'),
                  ),
                ),
                const SizedBox(width: 10),

                // 🎵 Cast Music
                Expanded(
                  child: ElevatedButton.icon(
                    icon: _isCastingMusic
                        ? const SizedBox(
                            width: 16,
                            height: 16,
                            child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white),
                          )
                        : const Text('🎵', style: TextStyle(fontSize: 14)),
                    label: Text(_isCastingMusic ? 'Casting...' : 'Cast Music'),
                    style: ElevatedButton.styleFrom(
                      backgroundColor: const Color(0xFF0284C7),
                      foregroundColor: Colors.white,
                      padding: const EdgeInsets.symmetric(vertical: 13),
                      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
                    ),
                    onPressed: isAnyLoading ? null : () => _triggerCast(_urlController.text, 'music'),
                  ),
                ),
              ],
            ),

            const SizedBox(height: 10),

            // ➕ Add to Queue Button
            OutlinedButton.icon(
              icon: _isAddingToQueue
                  ? const SizedBox(
                      width: 16,
                      height: 16,
                      child: CircularProgressIndicator(strokeWidth: 2, color: Colors.blueAccent),
                    )
                  : const Icon(Icons.playlist_add_rounded, size: 20),
              label: Text(_isAddingToQueue ? 'Adding...' : 'Add to Queue'),
              style: OutlinedButton.styleFrom(
                foregroundColor: Colors.blueAccent,
                side: BorderSide(color: Colors.blueAccent.withValues(alpha: 0.4), width: 1.2),
                padding: const EdgeInsets.symmetric(vertical: 12),
                shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
              ),
              onPressed: isAnyLoading ? null : () => _triggerAddToQueue(_urlController.text),
            ),
          ],
        ),
      ),
    );
  }
}
