import 'package:shared_preferences/shared_preferences.dart';

/// Manages local persistence for Orsay Connect configuration.
class SettingsService {
  static const String _keyServerUrl = 'server_url';
  static const String defaultServerUrl = 'http://212.73.137.28:7833';

  /// Retrieve the configured Flask backend server URL.
  static Future<String> getServerUrl() async {
    final prefs = await SharedPreferences.getInstance();
    final url = prefs.getString(_keyServerUrl);
    if (url == null || url.trim().isEmpty) {
      return defaultServerUrl;
    }
    return normalizeUrl(url);
  }

  /// Persist a new server URL.
  static Future<void> setServerUrl(String url) async {
    final prefs = await SharedPreferences.getInstance();
    final cleanUrl = normalizeUrl(url);
    await prefs.setString(_keyServerUrl, cleanUrl);
  }

  /// Normalize URL by ensuring http/https protocol prefix and stripping trailing slashes.
  static String normalizeUrl(String input) {
    var trimmed = input.trim();
    if (trimmed.isEmpty) return defaultServerUrl;

    if (!trimmed.startsWith('http://') && !trimmed.startsWith('https://')) {
      trimmed = 'http://$trimmed';
    }

    while (trimmed.endsWith('/')) {
      trimmed = trimmed.substring(0, trimmed.length - 1);
    }

    return trimmed;
  }
}

