import 'package:flutter/material.dart';

/// Placeholder tab for future IPTV channel list and remote features.
class IptvScreen extends StatelessWidget {
  const IptvScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return Scaffold(
      appBar: AppBar(
        title: const Text('IPTV Remote'),
        centerTitle: true,
      ),
      body: Center(
        child: Padding(
          padding: const EdgeInsets.all(28.0),
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Container(
                width: 90,
                height: 90,
                decoration: BoxDecoration(
                  color: Colors.blue.withValues(alpha: 0.12),
                  shape: BoxShape.circle,
                  border: Border.all(color: Colors.blue.withValues(alpha: 0.3), width: 2),
                ),
                child: const Icon(
                  Icons.tv_rounded,
                  size: 46,
                  color: Colors.blueAccent,
                ),
              ),
              const SizedBox(height: 24),
              Text(
                'Coming Soon...',
                style: theme.textTheme.headlineSmall?.copyWith(
                  fontWeight: FontWeight.bold,
                  letterSpacing: 0.5,
                ),
              ),
              const SizedBox(height: 12),
              Text(
                'Phase 2 will introduce the live TV channel lineup, EPG program guide, and virtual Samsung Orsay remote controls.',
                textAlign: TextAlign.center,
                style: theme.textTheme.bodyMedium?.copyWith(
                  color: Colors.grey.shade400,
                  height: 1.4,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
