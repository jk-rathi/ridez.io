from collections import defaultdict, deque
from functools import wraps
from time import monotonic
import jwt
from flask import Blueprint, current_app, g, jsonify, request
from . import repositories as users
from .services import ApiError, login, register

api = Blueprint('api', __name__)


@api.errorhandler(ApiError)
def api_error(error):
    return jsonify(error=error.message), error.status


def body():
    data = request.get_json(silent=True)
    if not isinstance(data, dict):
        raise ApiError('A JSON object is required')
    return data


def authenticated(role=None):
    def decorate(fn):
        @wraps(fn)
        def wrapped(*args, **kwargs):
            header = request.headers.get('Authorization', '')
            try:
                if not header.startswith('Bearer '):
                    raise ValueError()
                payload = jwt.decode(header[7:], current_app.config['JWT_SECRET'], algorithms=['HS256'], options={'require': ['sub', 'exp', 'iat']})
                g.user = users.by_id(int(payload['sub']))
                if not g.user or g.user.status == 'disabled':
                    raise ValueError()
            except (jwt.InvalidTokenError, ValueError, TypeError):
                raise ApiError('Please sign in again', 401)
            if role and g.user.role != role:
                raise ApiError('You do not have access to this workspace', 403)
            return fn(*args, **kwargs)
        return wrapped
    return decorate


@api.before_request
def limit_auth():
    if request.method == 'POST' and request.path.endswith(('/auth/login', '/auth/register')):
        # Development limiter only; deploy a shared Redis limiter before multiple workers.
        buckets = current_app.extensions.setdefault('auth_attempts', defaultdict(deque))
        now = monotonic()
        for key in list(buckets):
            while buckets[key] and buckets[key][0] <= now - 60:
                buckets[key].popleft()
            if not buckets[key]:
                del buckets[key]
        key = request.remote_addr
        attempts = buckets[key]
        if len(attempts) >= 10:
            raise ApiError('Too many attempts. Try again in one minute', 429)
        attempts.append(now)


@api.get('/health')
def health():
    return jsonify(status='ok', stage='ride-simulator', simulator=current_app.config['SIMULATOR_ENABLED'], storage='sqlite-development' if current_app.config['SQLALCHEMY_DATABASE_URI'].startswith('sqlite') else 'sql-server')


@api.post('/auth/register')
def registration():
    return jsonify(user=register(body()).public()), 201


@api.post('/auth/login')
def sign_in():
    return jsonify(login(body()))


@api.get('/me')
@authenticated()
def me():
    return jsonify(user=g.user.public())


@api.get('/driver/overview')
@authenticated('driver')
def driver():
    from .ride_service import snapshot
    data = snapshot(g.user)
    return jsonify(approval=g.user.status, trips=sum(ride['status'] == 'COMPLETED' for ride in data['rides']), allocated_earnings=data['allocated_earnings'], availability_enabled=g.user.status == 'active' and data['simulator'], available=data['available'])


@api.get('/admin/overview')
@authenticated('admin')
def admin():
    from .ride_service import snapshot
    return jsonify(snapshot(g.user))


@api.get('/openapi.json')
def specification():
    from .spec import SPEC
    return jsonify(SPEC)


@api.get('/docs')
def docs():
    return '''<!doctype html><html lang="en"><head><title>ridez API</title><link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5/swagger-ui.css"></head><body><div id="swagger"></div><script src="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5/swagger-ui-bundle.js"></script><script>SwaggerUIBundle({url:'/api/v1/openapi.json',dom_id:'#swagger'})</script></body></html>'''
