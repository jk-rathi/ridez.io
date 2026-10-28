ERROR = {'description': 'Validation, authentication or permission error', 'content': {'application/json': {'schema': {'type': 'object', 'properties': {'error': {'type': 'string'}}}}}}
USER = {'type': 'object', 'properties': {key: {'type': 'string'} for key in ['name', 'mobile', 'user_code', 'role', 'status']}}


def operation(summary, fields=None, protected=False, status='200'):
    result = {'summary': summary, 'responses': {status: {'description': 'Success'}, '400': ERROR, '401': ERROR, '403': ERROR, '409': ERROR, '429': ERROR}}
    if fields:
        result['requestBody'] = {'required': True, 'content': {'application/json': {'schema': {'type': 'object', 'required': list(fields), 'properties': {key: {'type': 'string', **({'enum': ['rider', 'driver']} if key == 'role' else {}), **({'format': 'password'} if key == 'password' else {})} for key in fields}}}}}
    if protected:
        result['security'] = [{'bearerAuth': []}]
    return result


SPEC = {
    'openapi': '3.0.3',
    'info': {'title': 'ridez foundation API', 'version': '0.1.0', 'description': 'Mobile/password authentication and role-protected foundation. Tokens expire after 15 minutes. No refresh flow yet.'},
    'servers': [{'url': '/api/v1'}],
    'components': {'securitySchemes': {'bearerAuth': {'type': 'http', 'scheme': 'bearer', 'bearerFormat': 'JWT'}}, 'schemas': {'User': USER}},
    'paths': {
        '/health': {'get': operation('Runtime health and development storage mode')},
        '/auth/register': {'post': operation('Register rider or pending driver', ['name', 'mobile', 'password', 'role'], status='201')},
        '/auth/login': {'post': operation('Sign in with mobile and password', ['mobile', 'password'])},
        '/me': {'get': operation('Read your profile', protected=True)},
        '/driver/overview': {'get': operation('Driver-only workspace overview', protected=True)},
        '/admin/overview': {'get': operation('Admin-only foundation overview', protected=True)},
    },
}
