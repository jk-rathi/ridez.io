import os
import secrets
from pathlib import Path
from flask import Flask, jsonify
from flask_sqlalchemy import SQLAlchemy
from flask_migrate import Migrate

db = SQLAlchemy()


def create_app(config=None):
    app = Flask(__name__)
    development = os.getenv('APP_ENV', 'development') == 'development'
    jwt_secret = os.getenv('JWT_SECRET')
    code_secret = os.getenv('USER_CODE_SECRET')
    if development and (not jwt_secret or not code_secret):
        # Persist local secrets so restarts preserve sessions and account-code derivation.
        directory = Path(app.instance_path)
        directory.mkdir(parents=True, exist_ok=True)
        for name in ('jwt', 'codes'):
            path = directory / f'{name}.key'
            try:
                with open(path, 'x', opener=lambda p, f: os.open(p, f, 0o600)) as out:
                    out.write(secrets.token_hex(32))
            except FileExistsError:
                pass
        jwt_secret = jwt_secret or (directory / 'jwt.key').read_text()
        code_secret = code_secret or (directory / 'codes.key').read_text()
    app.config.update(SQLALCHEMY_DATABASE_URI=os.getenv('DATABASE_URL', 'sqlite:///ridez.db') if development else os.getenv('DATABASE_URL'), JWT_SECRET=jwt_secret, USER_CODE_SECRET=code_secret, SQLALCHEMY_TRACK_MODIFICATIONS=False)
    if config:
        app.config.update(config)
    app.config.setdefault('SIMULATOR_ENABLED', development and os.getenv('SIMULATOR_ENABLED', '1') == '1')
    app.config.setdefault('LOCATION_STALE_SECONDS', 90)
    app.config.setdefault('MATCH_ROUND_SECONDS', 30)
    app.config.setdefault('MATCH_MAX_RADIUS_M', int(os.getenv('MATCH_MAX_RADIUS_M', '5000')))
    if app.config['MATCH_MAX_RADIUS_M'] not in range(500, 10001, 500):
        raise RuntimeError('MATCH_MAX_RADIUS_M must be a multiple of 500 between 500 and 10000')
    if not all(app.config.get(k) for k in ('SQLALCHEMY_DATABASE_URI', 'JWT_SECRET', 'USER_CODE_SECRET')):
        raise RuntimeError('DATABASE_URL, JWT_SECRET and USER_CODE_SECRET are required outside development')
    db.init_app(app)
    Migrate(app, db)
    from .routes import api
    from . import ride_routes
    app.register_blueprint(api, url_prefix='/api/v1')
    from .realtime import init_realtime
    init_realtime(app)

    @app.errorhandler(404)
    def missing(_):
        return jsonify(error='Resource not found'), 404

    @app.errorhandler(405)
    def method(_):
        return jsonify(error='Method not allowed'), 405

    @app.cli.command('init-db')
    def init_db():
        """Create local development tables. Production uses versioned migrations."""
        if not development:
            raise RuntimeError('Use flask db upgrade outside development')
        db.create_all()

    import click
    @app.cli.command('create-admin')
    @click.option('--mobile', prompt=True)
    @click.option('--name', prompt=True)
    @click.option('--password', prompt=True, hide_input=True, confirmation_prompt=True)
    def create_admin(mobile, name, password):
        from .services import register
        register({'mobile': mobile, 'name': name, 'password': password, 'role': 'admin'}, allow_admin=True)
        click.echo('Admin created')

    return app
