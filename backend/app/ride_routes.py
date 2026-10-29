from flask import g, jsonify
from .routes import api, authenticated, body
from . import ride_service as service


@api.get('/workspace')
@authenticated()
def workspace():
    return jsonify(service.snapshot(g.user))


@api.post('/fares/quotes')
@authenticated('rider')
def quote():
    from time import monotonic
    from collections import deque
    from flask import current_app
    from .services import ApiError
    buckets=current_app.extensions.setdefault('quote_attempts',{})
    at=monotonic()
    for key in list(buckets):
        while buckets[key] and buckets[key][0]<=at-60:
            buckets[key].popleft()
        if not buckets[key]:
            del buckets[key]
    attempts=buckets.setdefault(g.user.id,deque())
    if len(attempts)>=10:
        raise ApiError('Too many fare requests. Try again in one minute',429)
    attempts.append(at)
    return jsonify(quote=service.quote(g.user, body())), 201


@api.post('/rides')
@authenticated('rider')
def book():
    return jsonify(ride=service.book(g.user, body())), 201


@api.get('/rides/<ride_id>')
@authenticated()
def details(ride_id):
    service.expire()
    return jsonify(ride=service.public(service.accessible(g.user, ride_id), g.user))


@api.post('/driver/availability')
@authenticated('driver')
def availability():
    return jsonify(service.availability(g.user, body()))


@api.put('/driver/location')
@authenticated('driver')
def location():
    from .location_service import update
    from . import ride_repository as repo
    result = update(g.user, body())
    repo.commit()
    return jsonify(location=result)


@api.post('/rides/<ride_id>/accept')
@authenticated('driver')
def accept(ride_id):
    return jsonify(ride=service.accept(g.user, ride_id))


@api.post('/rides/<ride_id>/reject')
@authenticated('driver')
def reject(ride_id):
    return jsonify(service.reject(g.user, ride_id))


@api.post('/rides/<ride_id>/<action>')
@authenticated()
def progress(ride_id, action):
    return jsonify(ride=service.move(g.user, ride_id, action))


@api.post('/admin/drivers/<int:driver_id>/approve')
@authenticated('admin')
def approve(driver_id):
    return jsonify(user=service.approve(g.user, driver_id, body()))


@api.get('/admin/fare-settings')
@authenticated('admin')
def fare_settings():
    from .fare_service import settings
    return jsonify(settings())


@api.put('/admin/fare-settings')
@authenticated('admin')
def update_fare_settings():
    from .fare_service import save
    return jsonify(save(g.user,body()))
