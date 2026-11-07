import 'package:flutter_test/flutter_test.dart';
import 'package:orsay_connect/main.dart';

void main() {
  testWidgets('Orsay Connect smoke test - verify navigation tabs', (WidgetTester tester) async {
    await tester.pumpWidget(const OrsayConnectApp());
    await tester.pump();

    // Verify navigation tabs exist
    expect(find.text('Casting'), findsWidgets);
    expect(find.text('IPTV'), findsOneWidget);
    expect(find.text('Settings'), findsOneWidget);
  });
}
