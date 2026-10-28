from sqlalchemy import select, update, delete
from . import db
from .models import User, DriverPresence, FareQuote, Ride, ActiveRide, Invitation, RevenueLedger


def get(model, key):
    return db.session.get(model, key)


def add(record):
    db.session.add(record)
    return record


def commit():
    db.session.commit()


def rollback():
    db.session.rollback()


def all_rides(user):
    query = select(Ride)
    if user.role == 'rider':
        query = query.where(Ride.rider_id == user.id)
    elif user.role == 'driver':
        query = query.where(Ride.driver_id == user.id)
    return db.session.scalars(query.order_by(Ride.requested_at.desc()).limit(100)).all()


def eligible_drivers():
    return db.session.scalars(select(DriverPresence).join(User, User.id == DriverPresence.driver_id).where(DriverPresence.available.is_(True), User.status == 'active', ~DriverPresence.driver_id.in_(select(ActiveRide.user_id)))).all()


def transition(ride_id, old, new, **values):
    return db.session.execute(update(Ride).where(Ride.id == ride_id, Ride.status == old).values(status=new, **values).execution_options(synchronize_session=False)).rowcount == 1


def assign(ride_id, driver_id, now):
    valid_invitation = select(Invitation.ride_id).where(Invitation.driver_id == driver_id, Invitation.status == 'PENDING')
    eligible = select(DriverPresence.driver_id).join(User, User.id == DriverPresence.driver_id).where(DriverPresence.driver_id == driver_id, DriverPresence.available.is_(True), User.status == 'active').exists()
    return db.session.execute(update(Ride).where(Ride.id == ride_id, Ride.status == 'SEARCHING', Ride.expires_at > now, Ride.id.in_(valid_invitation), eligible).values(status='ASSIGNED', driver_id=driver_id).execution_options(synchronize_session=False)).rowcount == 1


def release(ride_id):
    db.session.execute(delete(ActiveRide).where(ActiveRide.ride_id == ride_id))


def close_invitations(ride_id, status='EXPIRED'):
    db.session.execute(update(Invitation).where(Invitation.ride_id == ride_id, Invitation.status == 'PENDING').values(status=status))


def expired_searches(now):
    return db.session.scalars(select(Ride).where(Ride.status == 'SEARCHING', Ride.expires_at <= now)).all()


def invitations(driver_id):
    return db.session.scalars(select(Ride).join(Invitation, Invitation.ride_id == Ride.id).where(Invitation.driver_id == driver_id, Invitation.status == 'PENDING', Ride.status == 'SEARCHING').order_by(Ride.requested_at)).all()


def ledger(driver_id):
    return db.session.scalars(select(RevenueLedger).where(RevenueLedger.driver_id == driver_id)).all()


def drivers():
    return db.session.scalars(select(User).where(User.role == 'driver').order_by(User.id.desc()).limit(100)).all()


def ride_for_quote(quote_id):
    return db.session.scalar(select(Ride).where(Ride.quote_id == quote_id))


def set_available(driver_id, available):
    presence = get(DriverPresence, driver_id)
    if not presence:
        presence = add(DriverPresence(driver_id=driver_id, available=available))
    else:
        presence.available = available
    return presence
