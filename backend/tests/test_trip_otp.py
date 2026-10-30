import json
from app import db
from app.models import User
from app.services import rider_trip_otp
from test_auth import app, client
from test_rides import actors, prepare, book, post


def waiting(client, actors):
    prepare(client, actors)
    ride = book(client, actors)
    for action in ('accept', 'depart', 'arrive'):
        assert post(client, actors, 'driver', f"/rides/{ride['id']}/{action}").status_code == 200
    return ride


def test_fixed_private_code_and_required_start(client, app, actors):
    otp = client.get('/api/v1/workspace', headers=actors['rider']['headers']).json['trip_otp']
    assert len(otp) == 6 and otp.isascii() and otp.isdigit()
    # Re-fetching the persisted account in a fresh context reproduces its code.
    with app.app_context():
        assert rider_trip_otp(db.session.get(User, actors['rider']['id'])) == otp
    login = client.post('/api/v1/auth/login', json={'mobile': actors['rider']['mobile'], 'password': 'long-enough-password'})
    headers = {'Authorization': 'Bearer '+login.json['access_token']}
    assert client.get('/api/v1/workspace', headers=headers).json['trip_otp'] == otp
    ride = waiting(client, actors)
    path = f"/rides/{ride['id']}/start"
    for name in ('driver', 'admin', 'other'):
        data = client.get('/api/v1/workspace', headers=actors[name]['headers']).json
        if name == 'other':
            assert data['trip_otp'] != otp
        else:
            assert 'trip_otp' not in json.dumps(data)
    for name in ('rider', 'second', 'admin'):
        assert post(client, actors, name, path, otp=otp).status_code in (403, 404)
    for data in ({}, {'otp': 'wrong'}, {'otp': int(otp)}, {'otp': f'{(int(otp)+1)%1000000:06d}'}):
        assert post(client, actors, 'driver', path, **data).status_code == 400
        assert client.get('/api/v1/rides/'+ride['id'], headers=actors['rider']['headers']).json['ride']['status'] == 'WAITING'
    response = post(client, actors, 'driver', path, otp=otp)
    assert response.status_code == 200
    assert response.json['ride']['status'] == 'IN_PROGRESS'
    assert 'trip_otp' not in json.dumps(response.json)
    assert post(client, actors, 'driver', path, otp=otp).status_code == 200
    assert post(client, actors, 'driver', path).status_code == 400
    assert post(client, actors, 'driver', f"/rides/{ride['id']}/complete").status_code == 200
    assert client.get('/api/v1/workspace', headers=actors['rider']['headers']).json['trip_otp'] == otp
    assert book(client, actors)['id'] != ride['id']
    assert client.get('/api/v1/workspace', headers=actors['rider']['headers']).json['trip_otp'] == otp


def test_otp_attempt_limit(client, app, actors):
    from collections import deque
    from time import monotonic
    ride = waiting(client, actors)
    path = f"/rides/{ride['id']}/start"
    for _ in range(5):
        assert post(client, actors, 'driver', path, otp='bad').status_code == 400
    otp = client.get('/api/v1/workspace', headers=actors['rider']['headers']).json['trip_otp']
    assert post(client, actors, 'driver', path, otp=otp).status_code == 429
    assert client.get('/api/v1/rides/'+ride['id'], headers=actors['rider']['headers']).json['ride']['status'] == 'WAITING'
    app.extensions['trip_otp_attempts'][actors['driver']['id']] = deque([monotonic()-61]*5)
    assert post(client, actors, 'driver', path, otp=otp).status_code == 200


def test_leading_zero_code(client, app, actors):
    with app.app_context():
        rider = db.session.get(User, actors['rider']['id'])
        for index in range(1000):
            rider.user_code = f'RID-LEADING-ZERO-{index}'
            otp = rider_trip_otp(rider)
            if otp.startswith('0'):
                break
        assert otp.startswith('0')
        db.session.commit()
    ride = waiting(client, actors)
    assert post(client, actors, 'driver', f"/rides/{ride['id']}/start", otp=otp).status_code == 200
