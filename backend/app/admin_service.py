import json
from datetime import timedelta
from decimal import Decimal
from uuid import UUID
from flask import current_app
from sqlalchemy import select, func, literal, cast, String, union_all, or_
from . import db, ride_repository as repo
from .models import User, Ride, DriverPresence, DriverLocation, ActiveRide, RevenueLedger, AdminAudit, FarePolicy, RevenueShareSetting
from .location_service import utcnow
from .fare_service import DEFAULT_POLICY
from .services import ApiError


def metrics():
    at=utcnow()
    cutoff=at-timedelta(seconds=current_app.config['LOCATION_STALE_SECONDS'])
    statuses=dict(db.session.execute(select(Ride.status,func.count()).group_by(Ride.status)).all())
    pending=db.session.scalar(select(func.count()).select_from(User).where(User.role=='driver',User.status=='pending'))
    online=select(DriverPresence.driver_id).join(User,User.id==DriverPresence.driver_id).where(DriverPresence.available.is_(True),User.status=='active',~DriverPresence.driver_id.in_(select(ActiveRide.user_id)))
    available=db.session.scalar(select(func.count()).select_from(online.subquery()))
    fresh=db.session.scalar(select(func.count()).select_from(online.join(DriverLocation,DriverLocation.driver_id==DriverPresence.driver_id).where(DriverLocation.fresh.is_(True),DriverLocation.recorded_at>cutoff,DriverLocation.updated_at>cutoff).subquery()))
    driver,company=db.session.execute(select(func.sum(RevenueLedger.driver_amount),func.sum(RevenueLedger.company_amount))).one()
    return dict(active_rides=sum(count for status,count in statuses.items() if status in ('SEARCHING','ASSIGNED','ARRIVING','WAITING','IN_PROGRESS')),searching_rides=statuses.get('SEARCHING',0),completed_rides=statuses.get('COMPLETED',0),fresh_available_drivers=fresh,stale_available_drivers=max(0,available-fresh),pending_driver_applications=pending,driver_allocations=str(driver or Decimal('0.00')),company_allocations=str(company or Decimal('0.00')),currency='INR',as_of=at.isoformat()+'Z')


def events():
    return union_all(
        select(cast(AdminAudit.id,String(36)).label('id'),literal('driver').label('category'),AdminAudit.action.label('action'),AdminAudit.admin_id.label('actor_id'),AdminAudit.created_at.label('created_at'),AdminAudit.reason.label('reason'),cast(AdminAudit.driver_id,String(36)).label('target')),
        select(cast(FarePolicy.version,String(36)),literal('fares'),literal('fare.settings.changed'),FarePolicy.updated_by,FarePolicy.created_at,FarePolicy.reason,cast(FarePolicy.version,String(36))),
        select(cast(RevenueShareSetting.version,String(36)),literal('revenue'),literal('revenue.share.changed'),RevenueShareSetting.updated_by,RevenueShareSetting.created_at,RevenueShareSetting.reason,cast(RevenueShareSetting.version,String(36))),
    ).subquery()


def audit(params):
    try:
        page=int(params.get('page','1'))
        if not 1<=page<=100000:
            raise ValueError()
    except (ValueError,TypeError):
        raise ApiError('Page must be a positive integer')
    category=params.get('category','')
    if category not in ('','driver','fares','revenue'):
        raise ApiError('Choose driver, fares or revenue category')
    query_text=params.get('q','').strip()
    if len(query_text)>100:
        raise ApiError('Search must contain at most 100 characters')
    source=events()
    query=select(source,User.name.label('actor_name')).join(User,User.id==source.c.actor_id)
    if category:
        query=query.where(source.c.category==category)
    if query_text:
        pattern='%'+query_text.replace('\\','\\\\').replace('%','\\%').replace('_','\\_')+'%'
        query=query.where(or_(source.c.reason.ilike(pattern,escape='\\'),User.name.ilike(pattern,escape='\\'),source.c.action.ilike(pattern,escape='\\')))
    total=db.session.scalar(select(func.count()).select_from(query.subquery()))
    rows=db.session.execute(query.order_by(source.c.created_at.desc(),source.c.category,source.c.id.desc()).offset((page-1)*20).limit(20)).mappings().all()
    return dict(page=page,page_size=20,total=total,items=[dict(id=row['id'],category=row['category'],action=row['action'],actor_id=row['actor_id'],actor_name=row['actor_name'],created_at=row['created_at'].isoformat()+'Z',reason=row['reason'],target=row['target']) for row in rows])


def audit_detail(category,identifier):
    if category not in ('driver','fares','revenue'):
        raise ApiError('Audit entry not found',404)
    try:
        key=str(UUID(identifier)) if category=='driver' else int(identifier)
    except (ValueError,TypeError):
        raise ApiError('Audit entry not found',404)
    model={'driver':AdminAudit,'fares':FarePolicy,'revenue':RevenueShareSetting}[category]
    record=repo.get(model,key)
    if not record:
        raise ApiError('Audit entry not found',404)
    if category=='driver':
        driver=repo.get(User,record.driver_id)
        return dict(title='Driver approval',subject=f'{driver.name} · {driver.user_code}' if driver else 'Driver account',changes=[dict(field='Account status',before='Pending',after='Active')])
    if category=='revenue':
        return dict(title='Revenue allocation change',effective_from=record.effective_from.isoformat()+'Z',changes=[dict(field='Driver share',before=f'{record.previous_driver_pct}%',after=f'{record.driver_pct}%'),dict(field='Company share',before=f'{record.previous_company_pct}%',after=f'{record.company_pct}%')])
    previous=repo.get(FarePolicy,record.version-1)
    before=json.loads(previous.settings) if previous else DEFAULT_POLICY
    after=json.loads(record.settings)
    labels={'base':'Base fare','per_km':'Fare per km','per_minute':'Fare per minute','minimum':'Minimum fare','timezone':'Schedule timezone','surge_enabled':'Surge enabled','max_multiplier':'Maximum surge','traffic_enabled':'Traffic surge enabled','traffic_threshold':'Traffic threshold','traffic_multiplier':'Traffic multiplier','demand_enabled':'Demand surge enabled','demand_threshold':'Demand threshold','demand_multiplier':'Demand multiplier','demand_min_requests':'Minimum demand requests','zones':'Surge zones'}
    def describe(key,value):
        if key=='zones':
            days=['Mon','Tue','Wed','Thu','Fri','Sat','Sun']
            return '; '.join(f"{zone['name']} · {zone['multiplier']}× · {zone['radius_m']} m around {zone['latitude']}, {zone['longitude']} · {', '.join(days[day] for day in zone['days'])} · {zone['start']}–{zone['end']} · {'enabled' if zone['enabled'] else 'paused'}" for zone in value) or 'No zones'
        if isinstance(value,bool):
            return 'Enabled' if value else 'Disabled'
        return ('₹' if key in ('base','per_km','per_minute','minimum') else '')+str(value)
    return dict(title='Fare policy change',changes=[dict(field=labels.get(key,key),before=describe(key,before.get(key)),after=describe(key,value)) for key,value in after.items() if before.get(key)!=value])
