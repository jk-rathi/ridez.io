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

SPEC['info']['version'] = '0.5.0'
SPEC['info']['title'] = 'ridez routes, fares and matching API'
SPEC['info']['description'] += ' Sample route fares; real GPS matching starts at 500 m and expands by 500 m every 30 seconds. Driver locations expire after 90 seconds. No live geocoding or payments. Socket.IO authenticates with auth.token and sends scoped workspace.changed invalidations; fetch /workspace on reconnect.'
SPEC['paths'].update({
    '/workspace': {'get': operation('Read your rides, active trip, invitations, earnings or admin driver queue', protected=True)},
    '/fares/quotes': {'post': operation('Create a five-minute simulated quote with pickup coordinates', ['pickup', 'destination', 'pickup_lat', 'pickup_lng'], protected=True, status='201')},
    '/rides': {'post': operation('Book a quote; quote ID is the idempotency key', ['quote_id'], protected=True, status='201')},
    '/driver/availability': {'post': operation('Change approved driver simulator availability', protected=True)},
})
SPEC['paths']['/driver/availability']['post']['requestBody'] = {'required': True, 'content': {'application/json': {'schema': {'type': 'object', 'required': ['available'], 'properties': {'available': {'type': 'boolean'}}}}}}
location_schema = {'type': 'object', 'required': ['latitude','longitude','accuracy_m','recorded_at'], 'properties': {'latitude': {'type':'number','minimum':-90,'maximum':90}, 'longitude': {'type':'number','minimum':-180,'maximum':180}, 'accuracy_m': {'type':'number','minimum':0,'maximum':200}, 'recorded_at': {'type':'string','format':'date-time'}}}
SPEC['paths']['/driver/location'] = {'put': operation('Update your own current location while available or on a trip', protected=True)}
SPEC['paths']['/driver/location']['put']['requestBody'] = {'required':True,'content':{'application/json':{'schema':location_schema}}}
availability_schema = SPEC['paths']['/driver/availability']['post']['requestBody']['content']['application/json']['schema']
availability_schema['properties'].update(location_schema['properties'])
availability_schema['description'] = 'All location fields are required when available=true. Only available=false is required to go offline.'
quote_properties = SPEC['paths']['/fares/quotes']['post']['requestBody']['content']['application/json']['schema']['properties']
quote_properties['pickup_lat'] = location_schema['properties']['latitude']
quote_properties['pickup_lng'] = location_schema['properties']['longitude']
quote_properties['destination_lat'] = location_schema['properties']['latitude']
quote_properties['destination_lng'] = location_schema['properties']['longitude']
SPEC['paths']['/fares/quotes']['post']['summary'] = 'Create a five-minute route/fare snapshot; destination coordinates required in Google mode'
SPEC['paths']['/admin/fare-settings'] = {'get': operation('Read versioned fare policy and audit history (admin)',protected=True), 'put':operation('Save a validated new fare policy version (admin)',protected=True)}
SPEC['paths']['/admin/fare-settings']['put']['requestBody'] = {'required':True,'content':{'application/json':{'schema':{'type':'object','required':['version','reason','policy'],'properties':{'version':{'type':'integer','minimum':0},'reason':{'type':'string','minLength':1,'maxLength':300},'policy':{'type':'object','description':'Complete policy returned by GET. Includes INR rates, minimum fare, timezone, capped surge, traffic/demand thresholds and scheduled circular zones.'}}}}}}
SPEC['paths']['/admin/revenue-share'] = {'get':operation('Read current and scheduled revenue shares plus immutable audit history (admin)',protected=True), 'put':operation('Save an immediate or future revenue split; percentages must total 100 (admin)',protected=True)}
SPEC['paths']['/admin/revenue-share']['put']['requestBody'] = {'required':True,'content':{'application/json':{'schema':{'type':'object','required':['version','driver_pct','company_pct','reason'],'properties':{'version':{'type':'integer','minimum':0},'driver_pct':{'type':'string','example':'85.00'},'company_pct':{'type':'string','example':'15.00'},'reason':{'type':'string','minLength':1,'maxLength':300},'effective_from':{'type':'string','format':'date-time','nullable':True,'description':'Null for immediately; otherwise future ISO timestamp with timezone, within one year.'}}}}}}
for action in ['accept', 'reject', 'cancel', 'depart', 'arrive', 'start', 'complete']:
    route = '/rides/{ride_id}/' + action
    SPEC['paths'][route] = {'parameters': [{'name': 'ride_id', 'in': 'path', 'required': True, 'schema': {'type': 'string'}}], 'post': operation(f'{action.capitalize()} a ride with permission and state checks', protected=True)}
SPEC['paths']['/rides/{ride_id}'] = {'parameters': [{'name': 'ride_id', 'in': 'path', 'required': True, 'schema': {'type': 'string'}}], 'get': operation('Get a ride you participate in (or admin)', protected=True)}
SPEC['paths']['/admin/drivers/{driver_id}/approve'] = {'parameters': [{'name': 'driver_id', 'in': 'path', 'required': True, 'schema': {'type': 'integer'}}], 'post': operation('Approve pending driver and record an audit reason', ['reason'], protected=True)}
