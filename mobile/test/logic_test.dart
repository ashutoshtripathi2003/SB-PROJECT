import 'package:flutter_test/flutter_test.dart';
import 'package:ridesync/api/models.dart';
import 'package:ridesync/data/places.dart';
import 'package:ridesync/state/session.dart';
import 'package:ridesync/util/format.dart';
import 'package:ridesync/util/validation.dart';

void main() {
  test('fair fares: online payments before the start hold the maximum share', () {
    Booking b(Map<String, dynamic> extra) => Booking.fromJson({
          'id': 'b1', 'rideId': 'r1', 'riderId': 'u1', 'seats': 1, 'fare': 85, 'status': 'accepted', 'createdAt': '2026-10-11T08:00:00Z',
          'pickup': campus.toJson(), 'drop': popularPlaces.last.toJson(), ...extra,
        });
    final open = b({'fareMax': 155, 'fareFinal': false});
    expect(open.isShare, isTrue);
    expect(open.payNow('online'), 155);
    expect(open.payNow('wallet'), 155);
    expect(open.payNow('upi'), 155); // every method pays the booked price; lower comes back at the start
    expect(open.payNow('cash'), 85);
    expect(b({'fareMax': 155, 'fareFinal': true}).payNow('online'), 85);
    expect(b({}).payNow('online'), 85); // older fixed-price rides
    expect(b({'fareMax': 155, 'fareFinal': true, 'paidAmount': 130, 'settleDue': -45}).settleDue, -45);
  });

  test('car mileage is read from the server', () {
    final v = Vehicle.fromJson({'id': 'v', 'make': 'Hyundai', 'model': 'Venue', 'color': 'Grey', 'plate': 'MH 01 AB 4321', 'seats': 3, 'fuel': 'diesel', 'mileage': {'smooth': 6.5, 'city': 11.5, 'traffic': 3.5}});
    expect(v.hasMileage, isTrue);
    expect(v.mileageTraffic, 3.5);
    expect(Vehicle.fromJson({'fuel': 'petrol'}).hasMileage, isFalse);
  });

  test('server links are cleaned up', () {
    expect(normalizeServer(' ridesync.onrender.com/ '), 'https://ridesync.onrender.com');
    expect(normalizeServer('https://abc.trycloudflare.com/api'), 'https://abc.trycloudflare.com');
    expect(normalizeServer('http://192.168.1.5:5173'), 'http://192.168.1.5:5173');
  });

  test('search query is sent in the server’s format', () {
    final q = SearchQuery(pickup: campus, drop: popularPlaces.last, at: DateTime(2026, 10, 9, 8, 5), seats: 2).toJson();
    expect(q['date'], '2026-10-09');
    expect(q['time'], '08:05');
    expect(q['seats'], 2);
    expect((q['pickup'] as Map)['id'], 'vit-campus');
  });

  test('validation matches the website', () {
    expect(validatePhone('+91 98765 43210'), isNull);
    expect(validatePhone('12345'), isNotNull);
    expect(validatePlate('MH 01 AB 1234'), isNull);
    expect(validatePlate('XYZ'), isNotNull);
    expect(validateStudentId('VU1F2122001'), isNull);
    expect(validateName('Priya'), isNotNull);
  });

  test('booking JSON parses', () {
    final b = Booking.fromJson({
      'id': 'b1', 'rideId': 'r1', 'riderId': 'u1', 'seats': 1, 'fare': 60, 'status': 'confirmed', 'matchScore': 88,
      'createdAt': '2026-10-09T10:00:00.000Z', 'paymentStatus': 'unpaid', 'paymentMethod': 'cash',
      'pickup': campus.toJson(), 'drop': popularPlaces[1].toJson(),
    });
    expect(b.isActive, isTrue);
    expect(b.isPaid, isFalse);
    expect(paymentLabel(b.paymentMethod, b.paymentStatus), 'Cash at pickup');
  });

  test('safety fields parse: women-only, verified, ID status, ride PIN', () {
    final place = campus.toJson();
    Map<String, dynamic> ride({bool? womenOnly}) => {
          'id': 'r1', 'driverId': 'd1', 'origin': place, 'destination': popularPlaces[1].toJson(), 'departAt': '2026-10-09T10:00:00.000Z',
          'seatsTotal': 3, 'seatsBooked': 0, 'farePerSeat': 60, 'status': 'scheduled', 'womenOnly': ?womenOnly,
        };
    expect(Ride.fromJson(ride(womenOnly: true)).womenOnly, isTrue);
    expect(Ride.fromJson(ride()).womenOnly, isFalse);

    expect(PublicUser.fromJson({'id': 'u1', 'name': 'Asha Rao', 'verified': true}).verified, isTrue);
    expect(PublicUser.fromJson({'id': 'u2', 'name': 'Ravi K'}).verified, isFalse);

    final me = User.fromJson({'id': 'u1', 'name': 'Asha Rao', 'gender': 'female', 'idStatus': 'rejected', 'idNote': 'Photo is blurry.', 'isAdmin': true});
    expect(me.idStatus, 'rejected');
    expect(me.idNote, 'Photo is blurry.');
    expect(me.isAdmin, isTrue);
    expect(me.verified, isFalse);
    expect(User.fromJson({'id': 'u1', 'name': 'Asha Rao'}).idStatus, 'none');
    expect(User.fromJson({'id': 'u1', 'name': 'Asha Rao', 'idStatus': 'verified'}).verified, isTrue);

    Map<String, dynamic> detail({String? pin}) => {
          'role': 'rider',
          'booking': {'id': 'b1', 'rideId': 'r1', 'riderId': 'u1', 'status': 'confirmed', 'pickup': place, 'drop': place},
          'ride': ride(),
          'driver': {'id': 'd1', 'name': 'Ravi K', 'verified': true},
          'vehicle': {'id': 'v1', 'make': 'Maruti', 'model': 'Swift', 'color': 'White', 'plate': 'MH01AB1234', 'seats': 4, 'fuel': 'petrol'},
          'rider': {'id': 'u1', 'name': 'Asha Rao'},
          'ridePin': ?pin,
        };
    final d = BookingDetail.fromJson(detail(pin: '0427'));
    expect(d.ridePin, '0427');
    expect(d.driver.verified, isTrue);
    expect(BookingDetail.fromJson(detail()).ridePin, isNull);
  });
}
