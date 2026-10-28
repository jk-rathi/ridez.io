import hashlib
from datetime import datetime, timedelta, timezone
from decimal import Decimal, ROUND_HALF_UP
from uuid import uuid4
from flask import current_app
from sqlalchemy.exc import IntegrityError
from . import db
from . import ride_repository as repo
from .models import User, DriverPresence, FareQuote, Ride, ActiveRide, Invitation, RevenueLedger, AdminAudit
from .services import ApiError


def now():
    return datetime.now(timezone.utc).replace(tzinfo=None)


def money(value):
    return Decimal(value).quantize(Decimal('0.01'), rounding=ROUND_HALF_UP)


def simulator():
    if not current_app.config['SIMULATOR_ENABLED']:
        raise ApiError('Development ride simulator is disabled', 503)


def text(data, key, limit=160):
    value = data.get(key)
    if not isinstance(value, str) or not 1 <= len(value.strip()) <= limit:
        raise ApiError(f'{key.replace("_", " ").capitalize()} must contain 1–{limit} characters')
    return value.strip()


def quote(user, data):
    simulator()
    pickup, destination = text(data, 'pickup'), text(data, 'destination')
    if pickup.casefold() == destination.casefold():
        raise ApiError('Pickup and destination must be different')
    # Deterministic fixture, not geocoding, actual road distance, or commercial pricing.
    seed = int(hashlib.sha256(f'{pickup.casefold()}|{destination.casefold()}'.encode()).hexdigest()[:8], 16)
    distance = money(Decimal(200 + seed % 1800) / 100)
    duration = max(5, int(distance * 3))
    base, distance_fare, time_fare = money(40), money(distance * 12), money(Decimal(duration) * 2)
    result = repo.add(FareQuote(id=str(uuid4()), rider_id=user.id, pickup=pickup, destination=destination, distance_km=distance, duration_min=duration, base=base, distance_fare=distance_fare, time_fare=time_fare, total=base + distance_fare + time_fare, expires_at=now() + timedelta(minutes=5)))
    repo.commit()
    return result.public()


def expire():
    for ride in repo.expired_searches(now()):
        if repo.transition(ride.id, 'SEARCHING', 'NO_DRIVER_FOUND'):
            repo.close_invitations(ride.id)
            repo.release(ride.id)
    repo.commit()
    db.session.expire_all()


def accessible(user, ride_id):
    ride = repo.get(Ride, ride_id)
    if not ride or (user.role != 'admin' and user.id not in (ride.rider_id, ride.driver_id)):
        raise ApiError('Ride not found', 404)
    return ride


def public(ride, user, invitation=False):
    quoted = repo.get(FareQuote, ride.quote_id)
    driver = repo.get(User, ride.driver_id) if ride.driver_id else None
    rider = repo.get(User, ride.rider_id)
    result = dict(id=ride.id, status=ride.status, quote=quoted.public(), requested_at=ride.requested_at.isoformat() + 'Z', expires_at=ride.expires_at.isoformat() + 'Z', driver={'name': driver.name, 'user_code': driver.user_code} if driver else None, rider={'name': rider.name}, completed_at=ride.completed_at.isoformat() + 'Z' if ride.completed_at else None)
    if not invitation:
        allocation = repo.get(RevenueLedger, ride.id)
        result['settlement'] = allocation.public() if allocation else None
    return result


def book(user, data):
    simulator()
    expire()
    quote_id = data.get('quote_id')
    if not isinstance(quote_id, str):
        raise ApiError('A quote_id is required')
    quoted = repo.get(FareQuote, quote_id)
    if not quoted or quoted.rider_id != user.id:
        raise ApiError('Quote not found', 404)
    existing = repo.ride_for_quote(quote_id)
    if existing:
        return public(existing, user)
    if quoted.expires_at <= now():
        raise ApiError('Quote expired. Request a new estimate', 409)
    if repo.get(ActiveRide, user.id):
        raise ApiError('You already have an active ride', 409)
    ride = repo.add(Ride(id=str(uuid4()), rider_id=user.id, quote_id=quoted.id, status='SEARCHING', requested_at=now(), expires_at=now() + timedelta(seconds=30)))
    try:
        db.session.flush()
        repo.add(ActiveRide(user_id=user.id, ride_id=ride.id))
        for driver in repo.eligible_drivers():
            repo.add(Invitation(ride_id=ride.id, driver_id=driver.driver_id, status='PENDING'))
        repo.commit()
    except IntegrityError:
        repo.rollback()
        existing = repo.ride_for_quote(quote_id)
        if existing:
            return public(existing, user)
        raise ApiError('You already have an active ride', 409)
    return public(ride, user)


def availability(user, data):
    simulator()
    expire()
    if user.status != 'active':
        raise ApiError('Admin approval is required before going available', 403)
    available = data.get('available')
    if not isinstance(available, bool):
        raise ApiError('Available must be true or false')
    if repo.get(ActiveRide, user.id):
        raise ApiError('Complete your active trip before changing availability', 409)
    try:
        repo.set_available(user.id, available)
        repo.commit()
    except IntegrityError:
        repo.rollback()
        raise ApiError('Availability changed concurrently. Refresh and retry', 409)
    # Search invitations are snapshots: going online later applies to new bookings.
    return dict(available=available)


def accept(user, ride_id):
    simulator()
    expire()
    ride = repo.get(Ride, ride_id)
    invitation = repo.get(Invitation, (ride_id, user.id))
    presence = repo.get(DriverPresence, user.id)
    if not ride or not invitation:
        raise ApiError('Invitation not found', 404)
    if ride.driver_id == user.id and ride.status in ('ASSIGNED', 'ARRIVING', 'WAITING', 'IN_PROGRESS', 'COMPLETED'):
        return public(ride, user)
    if user.status != 'active' or not presence or not presence.available:
        raise ApiError('You must be approved and available to accept', 403)
    if invitation.status != 'PENDING' or ride.status != 'SEARCHING' or ride.expires_at <= now():
        raise ApiError('This invitation is no longer available', 409)
    if repo.get(ActiveRide, user.id):
        raise ApiError('You already have an active trip', 409)
    try:
        if not repo.assign(ride.id, user.id, now()):
            repo.rollback()
            raise ApiError('Another driver has already accepted this ride', 409)
        repo.add(ActiveRide(user_id=user.id, ride_id=ride.id))
        repo.close_invitations(ride.id, 'CLOSED')
        invitation.status = 'ACCEPTED'
        repo.set_available(user.id, False)
        repo.commit()
    except IntegrityError:
        repo.rollback()
        raise ApiError('Driver or ride was assigned elsewhere. Refresh and retry', 409)
    db.session.expire_all()
    return public(repo.get(Ride, ride_id), user)


def reject(user, ride_id):
    expire()
    invitation = repo.get(Invitation, (ride_id, user.id))
    if not invitation:
        raise ApiError('Invitation not found', 404)
    if invitation.status == 'PENDING':
        invitation.status = 'REJECTED'
        repo.commit()
    return dict(status=invitation.status)


def move(user, ride_id, action):
    expire()
    ride = accessible(user, ride_id)
    if action == 'cancel':
        if user.role != 'rider' or ride.rider_id != user.id:
            raise ApiError('Only the rider can cancel this request', 403)
        if ride.status == 'CANCELLED':
            return public(ride, user)
        if ride.status != 'SEARCHING':
            raise ApiError('Only searching requests can be cancelled in this milestone', 409)
        if not repo.transition(ride.id, 'SEARCHING', 'CANCELLED'):
            repo.rollback()
            raise ApiError('Ride changed. Refresh and retry', 409)
        repo.close_invitations(ride.id, 'CLOSED')
        repo.release(ride.id)
    else:
        if user.role != 'driver' or ride.driver_id != user.id:
            raise ApiError('Only the assigned driver can progress this trip', 403)
        transitions = {'depart': ('ASSIGNED', 'ARRIVING'), 'arrive': ('ARRIVING', 'WAITING'), 'start': ('WAITING', 'IN_PROGRESS'), 'complete': ('IN_PROGRESS', 'COMPLETED')}
        if action not in transitions:
            raise ApiError('Unknown trip action', 404)
        old, new = transitions[action]
        if ride.status == new:
            return public(ride, user)
        if ride.status != old:
            raise ApiError(f'Cannot {action} a trip in {ride.status.lower()} state', 409)
        if not repo.transition(ride.id, old, new, **({'completed_at': now()} if action == 'complete' else {})):
            repo.rollback()
            raise ApiError('Ride changed. Refresh and retry', 409)
        if action == 'complete':
            quoted = repo.get(FareQuote, ride.quote_id)
            driver_amount = money(quoted.total * Decimal('0.85'))
            repo.add(RevenueLedger(ride_id=ride.id, driver_id=user.id, eligible_fare=quoted.total, driver_pct=Decimal('85.00'), company_pct=Decimal('15.00'), driver_amount=driver_amount, company_amount=quoted.total - driver_amount))
            repo.release(ride.id)
            # End offline deliberately; driver chooses when to take another request.
    repo.commit()
    db.session.expire_all()
    return public(repo.get(Ride, ride_id), user)


def snapshot(user):
    expire()
    rides = repo.all_rides(user)
    active = repo.get(ActiveRide, user.id)
    result = {'rides': [public(ride, user) for ride in rides], 'active_ride': public(repo.get(Ride, active.ride_id), user) if active else None, 'simulator': current_app.config['SIMULATOR_ENABLED'], 'user': user.public()}
    if user.role == 'driver':
        presence = repo.get(DriverPresence, user.id)
        entries = repo.ledger(user.id)
        result.update(available=bool(presence and presence.available), invitations=[public(ride, user, invitation=True) for ride in repo.invitations(user.id)] if user.status == 'active' and presence and presence.available and not active else [], earnings=[entry.public() for entry in entries], allocated_earnings=str(money(sum((entry.driver_amount for entry in entries), Decimal(0)))))
    if user.role == 'admin':
        result['drivers'] = [driver.public() for driver in repo.drivers()]
    return result


def approve(user, driver_id, data):
    driver = repo.get(User, driver_id)
    if not driver or driver.role != 'driver':
        raise ApiError('Driver not found', 404)
    reason = text(data, 'reason', 300)
    if driver.status == 'disabled':
        raise ApiError('Disabled drivers require a separate reinstatement review', 409)
    if driver.status == 'pending':
        driver.status = 'active'
        repo.add(AdminAudit(id=str(uuid4()), admin_id=user.id, driver_id=driver.id, action='driver.approved', reason=reason, created_at=now()))
        repo.commit()
    return driver.public()
