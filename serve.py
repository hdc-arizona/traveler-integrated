#!/usr/bin/env python3
import asyncio

import uvicorn
from fastapi import FastAPI
from starlette.staticfiles import StaticFiles
from api import args, db, core, intervals, metrics, primitives

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

if __name__ == '__main__':
    asyncio.get_event_loop().run_until_complete(db.load())
    uvicorn.run(app, host='0.0.0.0', port=int(args.port))
