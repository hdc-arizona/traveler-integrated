#!/usr/bin/env python3
import argparse
import json
from enum import Enum
import uvicorn #pylint: disable=import-error
from fastapi import FastAPI, HTTPException #pylint: disable=import-error
from starlette.staticfiles import StaticFiles #pylint: disable=import-error
from starlette.responses import RedirectResponse, StreamingResponse #pylint: disable=import-error
from wrangling import common

parser = argparse.ArgumentParser(description='Serve data bundled by bundle.py')
parser.add_argument('-d', '--db_dir', dest='dbDir', default='/tmp/traveler-integrated',
                    help='Directory where the bundled data is stored (default: /tmp/traveler-integrated)')

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

@app.get('/datasets/{label}/tree')
def tree(label: str):
    if label not in db:
        raise HTTPException(status_code=404, detail='Dataset not found')
    if 'coreTree' not in db[label]:
        raise HTTPException(status_code=404, detail='Dataset does not contain tree data')
    return db[label]['coreTree']

@app.get('/datasets/{label}/code')
def code(label: str):
    if label not in db:
        raise HTTPException(status_code=404, detail='Dataset not found')
    if 'code' not in db[label]:
        raise HTTPException(status_code=404, detail='Dataset does not include source code')
    return db[label]['code']

@app.get('/datasets/{label}/primitives')
def primitives(label: str):
    if label not in db:
        raise HTTPException(status_code=404, detail='Dataset not found')
    return dict(db[label]['primitives'])

class HistogramMode(str, Enum):
    utilization = 'utilization'
    count = 'count'

@app.get('/datasets/{label}/histogram')
def histogram(label: str, \
              mode: HistogramMode = HistogramMode.utilization, \
              bins: int = 100, \
              begin: float = None, \
              end: float = None, \
              location: str = None, \
              primitive: str = None):
    if label not in db:
        raise HTTPException(status_code=404, detail='Dataset not found')
    if 'intervalIndexes' not in db[label]:
        raise HTTPException(status_code=404, detail='Dataset does not contain indexed interval data')

    def modeHelper(indexObj):
        if indexObj.is_empty():
            raise HTTPException(status_code=204, detail='An index exists for the query, but it is empty')
        return getattr(indexObj, 'compute%sHistogram' % (mode.title()))(bins, begin, end)

    if location is not None:
        if location not in db[label]['intervalIndexes']['locations']:
            raise HTTPException(status_code=404, detail='No index for location: %s' % location)
        if primitive is not None:
            if primitive not in db[label]['intervalIndexes']['both'][location]:
                raise HTTPException(status_code=404, detail='No index for location, primitive combination: %s, %s' % (location, primitive))
            return modeHelper(db[label]['intervalIndexes']['both'][location][primitive])
        return modeHelper(db[label]['intervalIndexes']['locations'][location])
    if primitive is not None:
        if primitive not in db[label]['intervalIndexes']['primitives']:
            raise HTTPException(status_code=404, detail='No index for primitive: %s' % primitive)
        return modeHelper(db[label]['intervalIndexes']['primitives'][primitive])
    return modeHelper(db[label]['intervalIndexes']['main'])

@app.get('/datasets/{label}/intervals')
def intervals(label: str, begin: float = None, end: float = None):
    if label not in db:
        raise HTTPException(status_code=404, detail='Dataset not found')
    if 'intervalIndexes' not in db[label]:
        raise HTTPException(status_code=404, detail='Dataset does not contain indexed interval data')

    if begin is None:
        begin = db[label]['intervalIndexes']['main'].top_node.begin
    if end is None:
        end = db[label]['intervalIndexes']['main'].top_node.end

    def intervalGenerator():
        yield '['
        firstItem = True
        for i in db[label]['intervalIndexes']['main'].iterOverlap(begin, end):
            if not firstItem:
                yield ','
            yield json.dumps(db[label]['intervals'][i.data])
            firstItem = False
        yield ']'
    return StreamingResponse(intervalGenerator(), media_type='application/json')

if __name__ == '__main__':
    uvicorn.run(app)
