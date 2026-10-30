import base64
import hashlib
import hmac
from datetime import datetime, timedelta, timezone
import jwt
import phonenumbers
from flask import current_app
from sqlalchemy.exc import IntegrityError
from werkzeug.security import generate_password_hash, check_password_hash
from . import db, repositories as users
from .models import User


class ApiError(Exception):
    def __init__(self, message, status=400):
        self.message, self.status = message, status


def normalize(value):
    if not isinstance(value, str) or len(value) > 40:
        raise ApiError('Enter a valid mobile number including country code')
    try:
        number = phonenumbers.parse(value, None)
        if not phonenumbers.is_valid_number(number):
            raise ValueError()
        return phonenumbers.format_number(number, phonenumbers.PhoneNumberFormat.E164)
    except (phonenumbers.NumberParseException, ValueError, TypeError):
        raise ApiError('Enter a valid mobile number including country code')


def register(data, allow_admin=False):
    name, password, role = data.get('name'), data.get('password'), data.get('role', 'rider')
    if not isinstance(name, str) or not 1 <= len(name.strip()) <= 100:
        raise ApiError('Name must contain 1–100 characters')
    if not isinstance(password, str) or not 10 <= len(password) <= 128:
        raise ApiError('Password must contain 10–128 characters')
    if role not in (('rider', 'driver', 'admin') if allow_admin else ('rider', 'driver')):
        raise ApiError('Choose rider or driver')
    mobile = normalize(data.get('mobile'))
    if users.by_mobile(mobile):
        raise ApiError('An account with this mobile already exists', 409)
    digest = base64.b32encode(hmac.new(current_app.config['USER_CODE_SECRET'].encode(), f'{role}:{mobile}'.encode(), hashlib.sha256).digest()).decode().rstrip('=')
    prefix = {'rider': 'RID', 'driver': 'DRV', 'admin': 'ADM'}[role]
    code = None
    for length in range(12, 33, 4):
        candidate = f'{prefix}-{digest[:length]}'
        if not users.code_exists(candidate):
            code = candidate
            break
    if code is None:
        raise ApiError('Unable to allocate account code', 409)
    user = User(name=name.strip(), mobile=mobile, password_hash=generate_password_hash(password), user_code=code, role=role, status='pending' if role == 'driver' else 'active')
    try:
        return users.save(user)
    except IntegrityError:
        db.session.rollback()
        raise ApiError('Account already exists; please sign in', 409)


def login(data):
    try:
        mobile = normalize(data.get('mobile'))
    except ApiError:
        raise ApiError('Mobile or password is incorrect', 401)
    password = data.get('password')
    if not isinstance(password, str) or len(password) > 128:
        raise ApiError('Mobile or password is incorrect', 401)
    user = users.by_mobile(mobile)
    # Perform the same expensive hash check for unknown users.
    fallback = current_app.config.get('DUMMY_HASH')
    if not fallback:
        fallback = generate_password_hash('unused-random-account-password')
        current_app.config['DUMMY_HASH'] = fallback
    valid = check_password_hash(user.password_hash if user else fallback, password)
    if not user or not valid or user.status == 'disabled':
        raise ApiError('Mobile or password is incorrect', 401)
    now = datetime.now(timezone.utc)
    token = jwt.encode({'sub': str(user.id), 'iat': now, 'exp': now + timedelta(minutes=15)}, current_app.config['JWT_SECRET'], algorithm='HS256')
    return {'access_token': token, 'expires_in': 900, 'user': user.public()}


def rider_trip_otp(user):
    # Domain-separated from account codes; stable for existing and new accounts.
    digest = hmac.new(current_app.config['USER_CODE_SECRET'].encode(),
                      f'trip-otp:v1:{user.user_code}'.encode(), hashlib.sha256).digest()
    return f'{int.from_bytes(digest, "big") % 1000000:06d}'


def verify_trip_otp(rider, driver_id, value):
    from collections import deque
    from time import monotonic
    buckets = current_app.extensions.setdefault('trip_otp_attempts', {})
    at = monotonic()
    for key in list(buckets):
        while buckets[key] and buckets[key][0] <= at - 60:
            buckets[key].popleft()
        if not buckets[key]:
            del buckets[key]
    attempts = buckets.setdefault(driver_id, deque())
    if len(attempts) >= 5:
        raise ApiError('Too many OTP attempts. Try again in one minute', 429)
    if (not isinstance(value, str) or len(value) != 6 or not value.isascii()
            or not value.isdigit() or not hmac.compare_digest(value, rider_trip_otp(rider))):
        attempts.append(at)
        raise ApiError('Enter the correct six-digit OTP provided by the rider')
