import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:ridesync/api/models.dart';
import 'package:ridesync/screens/assistant.dart';
import 'package:ridesync/util/format.dart';

Map<String, dynamic> place(String id) => {'id': id, 'name': id, 'area': 'Mumbai', 'lat': 19.07, 'lng': 72.87};

Map<String, dynamic> booking([Map<String, dynamic> extra = const {}]) => {
      'id': 'b1', 'rideId': 'r1', 'riderId': 'u1', 'seats': 1, 'fare': 60, 'status': 'driver_arrived', 'matchScore': 88,
      'createdAt': '2026-10-09T08:00:00.000Z', 'pickup': place('p'), 'drop': place('d'), 'paymentStatus': 'unpaid',
      ...extra,
    };

Map<String, dynamic> ride() => {
      'id': 'r1', 'driverId': 'u2', 'origin': place('o'), 'destination': place('x'), 'departAt': '2026-10-09T08:30:00.000Z',
      'seatsTotal': 3, 'seatsBooked': 1, 'farePerSeat': 60, 'status': 'scheduled', 'distanceKm': 12, 'durationMin': 35,
    };

void main() {
  test('booking parses arrivedAt', () {
    final b = Booking.fromJson(booking({'arrivedAt': '2026-10-09T08:31:00.000Z'}));
    expect(b.arrivedAt, DateTime.utc(2026, 10, 9, 8, 31).toLocal());
    expect(Booking.fromJson(booking()).arrivedAt, isNull);
  });

  test('driver’s rider booking parses live location and no-show risk', () {
    final r = RiderBooking.fromJson(booking({
      'rider': {'id': 'u1', 'name': 'Sara Khan', 'phone': '9876543210'},
      'riderLocation': {'lat': 19.1, 'lng': 72.9, 'accuracy': 12, 'at': '2026-10-09T08:32:00.000Z'},
      'noShowRisk': 0.31,
    }));
    expect(r.riderLocation!.lat, 19.1);
    expect(r.riderLocation!.point.lng, 72.9);
    expect(r.riderLocation!.accuracy, 12);
    expect(r.riderLocation!.at, DateTime.utc(2026, 10, 9, 8, 32).toLocal());
    expect(r.noShowRisk, 0.31);

    final plain = RiderBooking.fromJson(booking({'rider': {'id': 'u1', 'name': 'Sara'}}));
    expect(plain.riderLocation, isNull);
    expect(plain.noShowRisk, isNull);
  });

  test('search result parses aiChance', () {
    final base = {'ride': ride(), 'driver': {'id': 'u2', 'name': 'Raj'}, 'vehicle': {'id': 'v', 'seats': 4}, 'score': 82, 'tier': 'excellent'};
    expect(MatchResult.fromJson({...base, 'aiChance': 0.82}).aiChance, 0.82);
    expect(MatchResult.fromJson(base).aiChance, isNull);
  });

  test('wait timer text', () {
    expect(mmss(0), '0:00');
    expect(mmss(67), '1:07');
    expect(mmss(freeWaitSeconds), '5:00');
  });

  test('assistant reply parses actions and suggestions', () {
    final r = AssistantReply.fromJson({
      'intent': 'find_ride',
      'confidence': 0.92,
      'reply': 'Here are rides to Andheri tomorrow at 8 am.',
      'actions': [
        {'type': 'search', 'label': 'Show matching rides', 'query': {'pickup': place('vit-campus'), 'drop': place('andheri'), 'date': '2026-10-11', 'time': '08:00', 'seats': 2}},
        {'type': 'link', 'label': 'Open trip', 'to': '/trip/b1'},
        {'type': 'call', 'label': 'Call 112', 'tel': '112'},
        {'type': 'mystery', 'label': '?'},
      ],
      'suggestions': ['When is my next ride?'],
    });
    expect(r.intent, 'find_ride');
    expect(r.confidence, 0.92);
    expect(r.actions.map((a) => a.type), ['search', 'link', 'call']);
    expect(r.suggestions, ['When is my next ride?']);

    final q = r.actions[0].query(DateTime(2026, 10, 10, 18, 45))!;
    expect(q.pickup.id, 'vit-campus');
    expect(q.drop.id, 'andheri');
    expect(q.at, DateTime(2026, 10, 11, 8, 0));
    expect(q.seats, 2);
    expect(q.toJson()['time'], '08:00');
    expect(r.actions[1].to, '/trip/b1');
    expect(r.actions[1].query(DateTime.now()), isNull);
    expect(r.actions[2].tel, '112');
  });

  test('assistant search without date/time uses the fallback, 1 seat', () {
    final a = AssistantAction.fromJson({'type': 'search', 'label': 'Show rides', 'query': {'pickup': place('a'), 'drop': place('b')}});
    final q = a.query(DateTime(2026, 10, 10, 18, 45))!;
    expect(q.at, DateTime(2026, 10, 10, 18, 45));
    expect(q.seats, 1);
    expect(AssistantReply.fromJson({}).intent, 'unknown');
  });

  testWidgets('assistant sheet shows the greeting and suggestions', (tester) async {
    final history = <AssistantMsg>[];
    await tester.pumpWidget(MaterialApp(home: Scaffold(body: AssistantSheet(history: history))));
    await tester.pump();
    expect(find.text('RideSync Assistant'), findsOneWidget);
    expect(find.text('AI · understands English & Hinglish'), findsOneWidget);
    expect(find.textContaining('I’m the RideSync Assistant'), findsOneWidget);
    for (final s in assistantHello.suggestions) {
      expect(find.text(s), findsOneWidget);
    }
    expect(history.length, 1);
  });
}
