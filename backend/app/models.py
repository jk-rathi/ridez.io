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
