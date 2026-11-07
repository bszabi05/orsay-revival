import 'package:flutter/material.dart';
import '../services/api_service.dart';
import '../services/settings_service.dart';

/// Settings screen for configuring backend server connection.
class SettingsScreen extends StatefulWidget {
  const SettingsScreen({super.key});

  @override
  State<SettingsScreen> createState() => _SettingsScreenState();
}

class _SettingsScreenState extends State<SettingsScreen> {
  final TextEditingController _urlController = TextEditingController();
  bool _isLoading = true;
  bool _isTesting = false;
  String? _testResult;
  bool _isTestSuccess = false;

  @override
  void initState() {
    super.initState();
    _loadSettings();
  }

  @override
  void dispose() {
    _urlController.dispose();
    super.dispose();
  }

  Future<void> _loadSettings() async {
    final currentUrl = await SettingsService.getServerUrl();
    if (mounted) {
      setState(() {
        _urlController.text = currentUrl;
        _isLoading = false;
      });
    }
  }

  Future<void> _saveSettings() async {
    final newUrl = _urlController.text.trim();
    if (newUrl.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('Please enter a valid server URL!'),
          backgroundColor: Colors.redAccent,
        ),
      );
      return;
    }

    await SettingsService.setServerUrl(newUrl);
    final normalized = await SettingsService.getServerUrl();
    if (mounted) {
      setState(() {
        _urlController.text = normalized;
      });

      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text('Server URL saved: $normalized'),
          backgroundColor: Colors.green.shade700,
          behavior: SnackBarBehavior.floating,
        ),
      );
    }
  }

  Future<void> _testConnection() async {
    final targetUrl = _urlController.text.trim();
    if (targetUrl.isEmpty) return;

    setState(() {
      _isTesting = true;
      _testResult = null;
    });

    final success = await ApiService.testConnection(targetUrl);

    if (mounted) {
      setState(() {
        _isTesting = false;
        _isTestSuccess = success;
        _testResult = success
            ? 'Connection successful with Flask proxy!'
            : 'Could not reach server. Verify network connection and IP address!';
      });
    }
  }

  void _resetToDefault() {
    setState(() {
      _urlController.text = SettingsService.defaultServerUrl;
      _testResult = null;
    });
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    if (_isLoading) {
      return const Scaffold(
        body: Center(child: CircularProgressIndicator()),
      );
    }

    return Scaffold(
      appBar: AppBar(
        title: const Text('Settings'),
        centerTitle: true,
      ),
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(20.0),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Card(
              shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
              color: const Color(0xFF162032),
              elevation: 0,
              child: Padding(
                padding: const EdgeInsets.all(20.0),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        Container(
                          padding: const EdgeInsets.all(8),
                          decoration: BoxDecoration(
                            color: Colors.blue.withValues(alpha: 0.15),
                            borderRadius: BorderRadius.circular(10),
                          ),
                          child: const Icon(Icons.dns_rounded, color: Colors.blueAccent),
                        ),
                        const SizedBox(width: 14),
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(
                                'Flask Proxy Server',
                                style: theme.textTheme.titleMedium?.copyWith(
                                  fontWeight: FontWeight.bold,
                                ),
                              ),
                              const SizedBox(height: 2),
                              Text(
                                'Backend remuxing service running on your local network',
                                style: theme.textTheme.bodySmall?.copyWith(
                                  color: Colors.grey.shade400,
                                ),
                              ),
                            ],
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 20),
                    TextField(
                      controller: _urlController,
                      keyboardType: TextInputType.url,
                      decoration: InputDecoration(
                        labelText: 'Server URL & Port',
                        hintText: 'e.g. http://192.168.1.138:7833',
                        prefixIcon: const Icon(Icons.link_rounded),
                        suffixIcon: IconButton(
                          icon: const Icon(Icons.clear_rounded),
                          onPressed: () => _urlController.clear(),
                        ),
                        filled: true,
                        fillColor: const Color(0xFF0F172A),
                        border: OutlineInputBorder(
                          borderRadius: BorderRadius.circular(12),
                          borderSide: BorderSide(color: Colors.white.withValues(alpha: 0.1)),
                        ),
                        enabledBorder: OutlineInputBorder(
                          borderRadius: BorderRadius.circular(12),
                          borderSide: BorderSide(color: Colors.white.withValues(alpha: 0.1)),
                        ),
                        focusedBorder: OutlineInputBorder(
                          borderRadius: BorderRadius.circular(12),
                          borderSide: const BorderSide(color: Colors.blueAccent),
                        ),
                      ),
                    ),
                    const SizedBox(height: 16),
                    Row(
                      children: [
                        Expanded(
                          child: OutlinedButton.icon(
                            icon: _isTesting
                                ? const SizedBox(
                                    width: 16,
                                    height: 16,
                                    child: CircularProgressIndicator(strokeWidth: 2),
                                  )
                                : const Icon(Icons.wifi_find_rounded),
                            label: Text(_isTesting ? 'Testing...' : 'Test Connection'),
                            style: OutlinedButton.styleFrom(
                              padding: const EdgeInsets.symmetric(vertical: 13),
                              shape: RoundedRectangleBorder(
                                borderRadius: BorderRadius.circular(10),
                              ),
                            ),
                            onPressed: _isTesting ? null : _testConnection,
                          ),
                        ),
                        const SizedBox(width: 12),
                        Expanded(
                          child: ElevatedButton.icon(
                            icon: const Icon(Icons.save_rounded),
                            label: const Text('Save'),
                            style: ElevatedButton.styleFrom(
                              backgroundColor: Colors.blueAccent,
                              foregroundColor: Colors.white,
                              padding: const EdgeInsets.symmetric(vertical: 13),
                              shape: RoundedRectangleBorder(
                                borderRadius: BorderRadius.circular(10),
                              ),
                            ),
                            onPressed: _saveSettings,
                          ),
                        ),
                      ],
                    ),
                    if (_testResult != null) ...[
                      const SizedBox(height: 16),
                      Container(
                        padding: const EdgeInsets.all(12),
                        decoration: BoxDecoration(
                          color: _isTestSuccess
                              ? Colors.green.withValues(alpha: 0.12)
                              : Colors.red.withValues(alpha: 0.12),
                          borderRadius: BorderRadius.circular(10),
                          border: Border.all(
                            color: _isTestSuccess
                                ? Colors.green.withValues(alpha: 0.35)
                                : Colors.red.withValues(alpha: 0.35),
                          ),
                        ),
                        child: Row(
                          children: [
                            Icon(
                              _isTestSuccess
                                  ? Icons.check_circle_rounded
                                  : Icons.error_outline_rounded,
                              color: _isTestSuccess ? Colors.greenAccent : Colors.redAccent,
                              size: 22,
                            ),
                            const SizedBox(width: 10),
                            Expanded(
                              child: Text(
                                _testResult!,
                                style: theme.textTheme.bodySmall?.copyWith(
                                  color: _isTestSuccess
                                      ? Colors.green.shade200
                                      : Colors.red.shade200,
                                ),
                              ),
                            ),
                          ],
                        ),
                      ),
                    ],
                  ],
                ),
              ),
            ),
            const SizedBox(height: 16),
            TextButton.icon(
              icon: const Icon(Icons.restore_rounded, size: 18),
              label: const Text('Reset to default URL'),
              style: TextButton.styleFrom(foregroundColor: Colors.grey.shade400),
              onPressed: _resetToDefault,
            ),
            const SizedBox(height: 24),
            Card(
              shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
              color: const Color(0xFF162032).withValues(alpha: 0.6),
              elevation: 0,
              child: Padding(
                padding: const EdgeInsets.all(18.0),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      'Connection Tip',
                      style: theme.textTheme.titleSmall?.copyWith(
                        fontWeight: FontWeight.bold,
                        color: Colors.lightBlueAccent,
                      ),
                    ),
                    const SizedBox(height: 8),
                    Text(
                      'Your phone and Samsung Smart TV must be connected to the same local Wi-Fi network as the computer running the Flask backend. The default proxy port is 7833.',
                      style: theme.textTheme.bodySmall?.copyWith(
                        color: Colors.grey.shade400,
                        height: 1.4,
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
