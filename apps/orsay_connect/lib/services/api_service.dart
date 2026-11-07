import 'dart:convert';
import 'package:http/http.dart' as http;
import 'settings_service.dart';

/// Models representing backend cast state and playlist items.

class CastStatus {
  final String status; // 'idle', 'extracting', 'ready', 'playing', 'error'
  final String playbackState; // 'playing', 'paused'
  final String mediaType; // 'video', 'music'
  final String? originalUrl;
  final String? title;
  final String? artist;
  final String? thumbnail;
  final int queueIndex;
  final int queueCount;
  final bool hasNext;
  final bool hasPrev;
  final String? error;

  const CastStatus({
    required this.status,
    required this.playbackState,
    required this.mediaType,
    this.originalUrl,
    this.title,
    this.artist,
    this.thumbnail,
    required this.queueIndex,
    required this.queueCount,
    required this.hasNext,
    required this.hasPrev,
    this.error,
  });

  bool get isPlaying => (status == 'playing' || status == 'ready') && playbackState == 'playing';
  bool get isPaused => playbackState == 'paused';
  bool get isExtracting => status == 'extracting';
  bool get isIdle => status == 'idle' && queueCount == 0;

  factory CastStatus.idle() => const CastStatus(
        status: 'idle',
        playbackState: 'playing',
        mediaType: 'video',
        queueIndex: -1,
        queueCount: 0,
        hasNext: false,
        hasPrev: false,
      );

  factory CastStatus.fromJson(Map<String, dynamic> json) {
    return CastStatus(
      status: json['status']?.toString() ?? 'idle',
      playbackState: json['playback_state']?.toString() ?? 'playing',
      mediaType: json['media_type']?.toString() ?? 'video',
      originalUrl: json['original_url']?.toString(),
      title: json['title']?.toString(),
      artist: json['artist']?.toString(),
      thumbnail: json['thumbnail']?.toString(),
      queueIndex: json['queue_index'] as int? ?? -1,
      queueCount: json['queue_count'] as int? ?? 0,
      hasNext: json['has_next'] as bool? ?? false,
      hasPrev: json['has_prev'] as bool? ?? false,
      error: json['error']?.toString(),
    );
  }
}

class QueueItemModel {
  final int id;
  final String url;
  final String title;
  final String mediaType;
  final String? artist;
  final String? thumbnail;
  final String status;
  final int? duration;
  final String? error;

  const QueueItemModel({
    required this.id,
    required this.url,
    required this.title,
    required this.mediaType,
    this.artist,
    this.thumbnail,
    required this.status,
    this.duration,
    this.error,
  });

  factory QueueItemModel.fromJson(Map<String, dynamic> json) {
    return QueueItemModel(
      id: json['id'] as int? ?? 0,
      url: json['url']?.toString() ?? '',
      title: json['title']?.toString() ?? '',
      mediaType: json['media_type']?.toString() ?? 'video',
      artist: json['artist']?.toString(),
      thumbnail: json['thumbnail']?.toString(),
      status: json['status']?.toString() ?? 'pending',
      duration: json['duration'] as int?,
      error: json['error']?.toString(),
    );
  }
}

class QueueInfo {
  final int currentIndex;
  final int count;
  final List<QueueItemModel> items;

  const QueueInfo({
    required this.currentIndex,
    required this.count,
    required this.items,
  });

  factory QueueInfo.empty() => const QueueInfo(
        currentIndex: -1,
        count: 0,
        items: [],
      );

  factory QueueInfo.fromJson(Map<String, dynamic> json) {
    final list = json['items'] as List<dynamic>? ?? [];
    return QueueInfo(
      currentIndex: json['current_index'] as int? ?? -1,
      count: json['count'] as int? ?? 0,
      items: list.map((e) => QueueItemModel.fromJson(e as Map<String, dynamic>)).toList(),
    );
  }
}

class CastResult {
  final bool success;
  final String message;
  final int? statusCode;

  const CastResult({
    required this.success,
    required this.message,
    this.statusCode,
  });
}

/// Network service communicating with Flask backend.
class ApiService {
  /// Start casting URL immediately: POST /cast
  static Future<CastResult> castMedia({
    required String url,
    required String type,
    bool playNow = true,
  }) async {
    try {
      final serverUrl = await SettingsService.getServerUrl();
      final uri = Uri.parse('$serverUrl/cast');

      final body = jsonEncode({
        'url': url,
        'type': type,
        'play_now': playNow,
      });

      final response = await http
          .post(
            uri,
            headers: {'Content-Type': 'application/json'},
            body: body,
          )
          .timeout(const Duration(seconds: 10));

      if (response.statusCode == 202 || response.statusCode == 200 || response.statusCode == 201) {
        String? message;
        try {
          final data = jsonDecode(response.body) as Map<String, dynamic>;
          message = data['message'] as String?;
        } catch (_) {}

        return CastResult(
          success: true,
          message: message ?? 'Media cast started on TV',
          statusCode: response.statusCode,
        );
      } else {
        String errorMsg = 'Server returned code ${response.statusCode}';
        try {
          final data = jsonDecode(response.body) as Map<String, dynamic>;
          if (data['error'] != null) {
            errorMsg = data['error'].toString();
          }
        } catch (_) {}

        return CastResult(
          success: false,
          message: errorMsg,
          statusCode: response.statusCode,
        );
      }
    } catch (e) {
      return CastResult(
        success: false,
        message: 'Network error: ${e.toString().replaceAll('Exception:', '').trim()}',
      );
    }
  }

  /// Append an item to the playlist queue: POST /queue
  static Future<CastResult> addToQueue({
    required String url,
    required String type,
  }) async {
    try {
      final serverUrl = await SettingsService.getServerUrl();
      final uri = Uri.parse('$serverUrl/queue');

      final body = jsonEncode({
        'url': url,
        'type': type,
        'play_now': false,
      });

      final response = await http
          .post(
            uri,
            headers: {'Content-Type': 'application/json'},
            body: body,
          )
          .timeout(const Duration(seconds: 10));

      if (response.statusCode == 201 || response.statusCode == 200) {
        return const CastResult(
          success: true,
          message: 'Added to playlist queue',
        );
      } else {
        return CastResult(
          success: false,
          message: 'Failed to add to queue (${response.statusCode})',
        );
      }
    } catch (e) {
      return CastResult(
        success: false,
        message: 'Network error: ${e.toString().replaceAll('Exception:', '').trim()}',
      );
    }
  }

  /// Toggle play/pause: POST /playpause
  static Future<CastResult> togglePlayPause() async {
    try {
      final serverUrl = await SettingsService.getServerUrl();
      final uri = Uri.parse('$serverUrl/playpause');

      final response = await http
          .post(uri, headers: {'Content-Type': 'application/json'}, body: '{}')
          .timeout(const Duration(seconds: 5));

      if (response.statusCode == 200) {
        String state = 'toggled';
        try {
          final data = jsonDecode(response.body) as Map<String, dynamic>;
          state = data['playback_state']?.toString() ?? 'toggled';
        } catch (_) {}
        return CastResult(success: true, message: 'Playback $state');
      }
      return CastResult(success: false, message: 'Failed to toggle (${response.statusCode})');
    } catch (e) {
      return CastResult(success: false, message: 'Network error: $e');
    }
  }

  /// Skip to next track: POST /next
  static Future<CastResult> nextTrack() async {
    try {
      final serverUrl = await SettingsService.getServerUrl();
      final uri = Uri.parse('$serverUrl/next');

      final response = await http
          .post(uri, headers: {'Content-Type': 'application/json'}, body: '{}')
          .timeout(const Duration(seconds: 6));

      if (response.statusCode == 200) {
        return const CastResult(success: true, message: 'Skipped to next item');
      }
      return CastResult(success: false, message: 'Failed to skip (${response.statusCode})');
    } catch (e) {
      return CastResult(success: false, message: 'Network error: $e');
    }
  }

  /// Return to previous track: POST /previous
  static Future<CastResult> previousTrack() async {
    try {
      final serverUrl = await SettingsService.getServerUrl();
      final uri = Uri.parse('$serverUrl/previous');

      final response = await http
          .post(uri, headers: {'Content-Type': 'application/json'}, body: '{}')
          .timeout(const Duration(seconds: 6));

      if (response.statusCode == 200) {
        return const CastResult(success: true, message: 'Went to previous item');
      }
      return CastResult(success: false, message: 'Failed to go back (${response.statusCode})');
    } catch (e) {
      return CastResult(success: false, message: 'Network error: $e');
    }
  }

  /// Stop current playback: POST /stop
  static Future<CastResult> stopStream() async {
    try {
      final serverUrl = await SettingsService.getServerUrl();
      final uri = Uri.parse('$serverUrl/stop');

      final response = await http
          .post(uri, headers: {'Content-Type': 'application/json'}, body: '{}')
          .timeout(const Duration(seconds: 5));

      if (response.statusCode == 200 || response.statusCode == 204) {
        return const CastResult(success: true, message: 'Playback stopped');
      }
      return CastResult(success: false, message: 'Failed to stop (${response.statusCode})');
    } catch (e) {
      return CastResult(success: false, message: 'Network error: $e');
    }
  }

  /// Fetch full playlist queue: GET /queue
  static Future<QueueInfo> getQueue() async {
    try {
      final serverUrl = await SettingsService.getServerUrl();
      final uri = Uri.parse('$serverUrl/queue');

      final response = await http.get(uri).timeout(const Duration(seconds: 5));

      if (response.statusCode == 200) {
        final data = jsonDecode(response.body) as Map<String, dynamic>;
        return QueueInfo.fromJson(data);
      }
      return QueueInfo.empty();
    } catch (_) {
      return QueueInfo.empty();
    }
  }

  /// Remove single item from queue: DELETE /queue/<id>
  static Future<CastResult> removeQueueItem(int itemId) async {
    try {
      final serverUrl = await SettingsService.getServerUrl();
      final uri = Uri.parse('$serverUrl/queue/$itemId');

      final response = await http.delete(uri).timeout(const Duration(seconds: 5));

      if (response.statusCode == 200) {
        return const CastResult(success: true, message: 'Item removed from queue');
      }
      return CastResult(success: false, message: 'Failed to remove item (${response.statusCode})');
    } catch (e) {
      return CastResult(success: false, message: 'Network error: $e');
    }
  }

  /// Clear entire playlist queue: POST /queue/clear
  static Future<CastResult> clearQueue() async {
    try {
      final serverUrl = await SettingsService.getServerUrl();
      final uri = Uri.parse('$serverUrl/queue/clear');

      final response = await http
          .post(uri, headers: {'Content-Type': 'application/json'}, body: '{}')
          .timeout(const Duration(seconds: 5));

      if (response.statusCode == 200) {
        return const CastResult(success: true, message: 'Queue cleared');
      }
      return CastResult(success: false, message: 'Failed to clear queue (${response.statusCode})');
    } catch (e) {
      return CastResult(success: false, message: 'Network error: $e');
    }
  }

  /// Fetch live status from GET /status
  static Future<CastStatus> getStatus() async {
    try {
      final serverUrl = await SettingsService.getServerUrl();
      final uri = Uri.parse('$serverUrl/status');

      final response = await http.get(uri).timeout(const Duration(seconds: 4));

      if (response.statusCode == 204) {
        return CastStatus.idle();
      } else if (response.statusCode == 200) {
        final data = jsonDecode(response.body) as Map<String, dynamic>;
        return CastStatus.fromJson(data);
      }
      return CastStatus.idle();
    } catch (_) {
      return CastStatus.idle();
    }
  }

  /// Ping backend for health check
  static Future<bool> testConnection([String? customUrl]) async {
    try {
      final baseUrl = customUrl != null
          ? SettingsService.normalizeUrl(customUrl)
          : await SettingsService.getServerUrl();

      final uri = Uri.parse('$baseUrl/status');
      final response = await http.get(uri).timeout(const Duration(seconds: 4));

      return response.statusCode == 200 || response.statusCode == 204;
    } catch (_) {
      return false;
    }
  }
}
