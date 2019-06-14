#!/usr/bin/env python3
import argparse
import json
import uvicorn #pylint: disable=import-error
from fastapi import FastAPI, HTTPException #pylint: disable=import-error
from starlette.staticfiles import StaticFiles #pylint: disable=import-error
from starlette.responses import RedirectResponse, StreamingResponse #pylint: disable=import-error
from wrangling import common

parser = argparse.ArgumentParser(description='Serve data bundled by bundle.py')
parser.add_argument('-d', '--db_dir', dest='dbDir', default='/tmp/traveler-integrated',
                    help='Directory where the bundled data is stored (default: /tmp/traveler-integrated')

args = parser.parse_args()
db = common.loadDatabase(args.dbDir)
app = FastAPI(
    title=__name__,
    description='This is a test',
    version='0.1.0'
)
app.mount('/static', StaticFiles(directory='static'), name='static')

@app.get('/')
def index():
    return RedirectResponse(url='/static/index.html')

@app.get('/datasets')
def datasets(includeMeta: bool = False):
    result = {}
    for label, data in db.items():
        if includeMeta:
            result[label] = dict(data['meta'])
        else:
            result[label] = {}
    return result

@app.get('/tree/{label}')
def tree(label: str):
    if label not in db:
        raise HTTPException(status_code=404, detail='Dataset not found')
    if 'coreTree' not in db[label]:
        raise HTTPException(status_code=404, detail='Dataset does not contain tree data')
    return db[label]['coreTree']

@app.get('/primitives/{label}')
def primitives(label: str):
    if label not in db:
        raise HTTPException(status_code=404, detail='Dataset not found')
    return dict(db[label]['primitives'])

@app.get('/histogram/{label}')
def histogram(label: str, bins: int = 100, begin: float = None, end: float = None):
    if label not in db:
        raise HTTPException(status_code=404, detail='Dataset not found')
    if 'rangeIndex' not in db[label]:
        raise HTTPException(status_code=404, detail='Dataset does not contain indexed range data')
    return db[label]['rangeIndex'].computeHistogram(bins, begin, end)

@app.get('/ranges/{label}')
def ranges(label: str, begin: float = None, end: float = None):
    if label not in db:
        raise HTTPException(status_code=404, detail='Dataset not found')
    if 'rangeIndex' not in db[label]:
        raise HTTPException(status_code=404, detail='Dataset does not contain indexed range data')

    async def rangeGenerator():
        for r in db[label]['rangeIndex'][begin:end]:
            yield json.dumps(db[label]['ranges'][r.data])
    return StreamingResponse(rangeGenerator(), media_type='application/json')

if __name__ == '__main__':
    uvicorn.run(app)
