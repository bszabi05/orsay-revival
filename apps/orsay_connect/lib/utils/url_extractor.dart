/// Utility to extract and sanitize URLs from shared text.
class UrlExtractor {
  static final RegExp _urlRegex = RegExp(
    r'https?://[^\s<>"{}|\\^`]+',
    caseSensitive: false,
  );

  /// Extracts the first valid HTTP/HTTPS URL found in [text].
  /// If no URL is matched, returns the trimmed input.
  static String extract(String? text) {
    if (text == null) return '';
    final trimmed = text.trim();
    if (trimmed.isEmpty) return '';

    final match = _urlRegex.firstMatch(trimmed);
    if (match != null) {
      return match.group(0) ?? trimmed;
    }

    return trimmed;
  }

  /// Checks whether [text] looks like a valid media URL.
  static bool isValidUrl(String text) {
    final extracted = extract(text);
    final uri = Uri.tryParse(extracted);
    return uri != null && (uri.scheme == 'http' || uri.scheme == 'https') && uri.hasAuthority;
  }
}

