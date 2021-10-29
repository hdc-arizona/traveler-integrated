#!/usr/bin/env python3
import asyncio

import uvicorn
from fastapi import FastAPI
from starlette.staticfiles import StaticFiles
from api import args, db, core, intervals, metrics, primitives, ClientLogger, profile

app = FastAPI(
    title=__name__,
    description='This is the API for traveler-integrated',
    version='0.1.1'
)
app.mount('/static', StaticFiles(directory='static'), name='static')

app.include_router(core.router)
app.include_router(intervals.router)
app.include_router(metrics.router)
app.include_router(primitives.router)
app.include_router(profile.router)

if __name__ == '__main__':
    logger = ClientLogger()
    asyncio.get_event_loop().run_until_complete(db.load(log=logger.log))
    if args.log_level == 'warning':
        # Uvicorn's "serving on" message won't display; as we use warning as the
        # default, we at least include one line of info for new users (actual
        # deployments should probably use critical or error anyway)
        print('Serving on localhost:%s' % args.port)
    uvicorn.run(app, host='0.0.0.0', port=int(args.port), log_level=args.log_level)
