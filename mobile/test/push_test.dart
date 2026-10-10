import 'package:flutter_test/flutter_test.dart';
import 'package:ridesync/state/push.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  test('without Firebase the app keeps working: push just stays off', () async {
    final token = await Push.start(onOpen: (_) {}, onNewToken: (_) {});
    expect(token, isNull);
  });
}
