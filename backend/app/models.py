from datetime import datetime, timezone
from . import db


class User(db.Model):
    __tablename__ = 'users'
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(100), nullable=False)
    mobile = db.Column(db.String(20), unique=True, nullable=False)
    password_hash = db.Column(db.String(512), nullable=False)
    user_code = db.Column(db.String(40), unique=True, nullable=False)
    role = db.Column(db.String(16), nullable=False)
    status = db.Column(db.String(16), nullable=False, default='active')
    created_at = db.Column(db.DateTime(timezone=True), nullable=False, default=lambda: datetime.now(timezone.utc))
    __table_args__ = (db.CheckConstraint("role IN ('rider','driver','admin')", name='valid_user_role'), db.CheckConstraint("status IN ('active','pending','disabled')", name='valid_user_status'))

    def public(self):
        return dict(id=self.id, name=self.name, mobile=self.mobile, user_code=self.user_code, role=self.role, status=self.status)


class DriverPresence(db.Model):
    __tablename__ = 'driver_presence'
    driver_id = db.Column(db.Integer, db.ForeignKey('users.id'), primary_key=True)
    available = db.Column(db.Boolean, nullable=False, default=False)


class FareQuote(db.Model):
    __tablename__ = 'fare_quotes'
    id = db.Column(db.String(36), primary_key=True)
    rider_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=False)
    pickup = db.Column(db.String(160), nullable=False)
    destination = db.Column(db.String(160), nullable=False)
    distance_km = db.Column(db.Numeric(10, 2), nullable=False)
    duration_min = db.Column(db.Integer, nullable=False)
    base = db.Column(db.Numeric(10, 2), nullable=False)
    distance_fare = db.Column(db.Numeric(10, 2), nullable=False)
    time_fare = db.Column(db.Numeric(10, 2), nullable=False)
    total = db.Column(db.Numeric(10, 2), nullable=False)
    expires_at = db.Column(db.DateTime, nullable=False)

    def public(self):
        return dict(id=self.id, pickup=self.pickup, destination=self.destination, distance_km=str(self.distance_km), duration_min=self.duration_min, base=str(self.base), distance_fare=str(self.distance_fare), time_fare=str(self.time_fare), total=str(self.total), currency='INR', provider='simulator', expires_at=self.expires_at.isoformat() + 'Z')


class Ride(db.Model):
    __tablename__ = 'rides'
    id = db.Column(db.String(36), primary_key=True)
    rider_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=False)
    driver_id = db.Column(db.Integer, db.ForeignKey('users.id'))
    quote_id = db.Column(db.String(36), db.ForeignKey('fare_quotes.id'), unique=True, nullable=False)
    status = db.Column(db.String(24), nullable=False)
    requested_at = db.Column(db.DateTime, nullable=False)
    expires_at = db.Column(db.DateTime, nullable=False)
    completed_at = db.Column(db.DateTime)
    __table_args__ = (db.CheckConstraint("status IN ('SEARCHING','ASSIGNED','ARRIVING','WAITING','IN_PROGRESS','COMPLETED','CANCELLED','NO_DRIVER_FOUND')", name='valid_ride_state'),)


class ActiveRide(db.Model):
    # One row per participant: a portable uniqueness guard for concurrent assignments.
    __tablename__ = 'active_rides'
    user_id = db.Column(db.Integer, db.ForeignKey('users.id'), primary_key=True)
    ride_id = db.Column(db.String(36), db.ForeignKey('rides.id'), nullable=False)


class Invitation(db.Model):
    __tablename__ = 'ride_invitations'
    ride_id = db.Column(db.String(36), db.ForeignKey('rides.id'), primary_key=True)
    driver_id = db.Column(db.Integer, db.ForeignKey('users.id'), primary_key=True)
    status = db.Column(db.String(16), nullable=False, default='PENDING')


class RevenueLedger(db.Model):
    __tablename__ = 'revenue_ledger'
    ride_id = db.Column(db.String(36), db.ForeignKey('rides.id'), primary_key=True)
    driver_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=False)
    eligible_fare = db.Column(db.Numeric(10, 2), nullable=False)
    driver_pct = db.Column(db.Numeric(5, 2), nullable=False)
    company_pct = db.Column(db.Numeric(5, 2), nullable=False)
    driver_amount = db.Column(db.Numeric(10, 2), nullable=False)
    company_amount = db.Column(db.Numeric(10, 2), nullable=False)

    def public(self):
        return {key: str(getattr(self, key)) for key in ('eligible_fare', 'driver_pct', 'company_pct', 'driver_amount', 'company_amount')} | {'currency': 'INR', 'status': 'ALLOCATED', 'ride_id': self.ride_id}


class AdminAudit(db.Model):
    __tablename__ = 'admin_audit'
    id = db.Column(db.String(36), primary_key=True)
    admin_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=False)
    driver_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=False)
    action = db.Column(db.String(40), nullable=False)
    reason = db.Column(db.String(300), nullable=False)
    created_at = db.Column(db.DateTime, nullable=False)
