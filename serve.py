#!/usr/bin/env python3
import argparse
import json
import asyncio
from enum import Enum
import uvicorn #pylint: disable=import-error
from fastapi import FastAPI, File, UploadFile, HTTPException #pylint: disable=import-error
from starlette.staticfiles import StaticFiles #pylint: disable=import-error
from starlette.requests import Request #pylint: disable=import-error
from starlette.responses import RedirectResponse, StreamingResponse #pylint: disable=import-error
from database import Database
from clientLogger import ClientLogger

parser = argparse.ArgumentParser(description='Serve the traveler-integrated interface')
parser.add_argument('-d', '--db_dir', dest='dbDir', default='/tmp/traveler-integrated',
                    help='Directory where the bundled data is already / will be stored (default: /tmp/traveler-integrated)')
parser.add_argument('-s', '--debug', dest='debug', action='store_true',
                    help='Store additional information for debugging source files, etc.')

args = parser.parse_args()
db = Database(args.dbDir, args.debug)
app = FastAPI(
    title=__name__,
    description='This is a test',
    version='0.1.0'
)
app.mount('/static', StaticFiles(directory='static'), name='static')

def checkLabel(label):
    if label not in db:
        raise HTTPException(status_code=404, detail='Dataset not found')
def checkIntervals(label):
    if 'intervals' not in db[label] or 'intervalIndexes' not in db[label]:
        raise HTTPException(status_code=404, detail='Dataset does not contain indexed interval data')

def iterUploadFile(text):
    for line in text.decode().splitlines():
        yield line

@app.get('/')
def index():
    return RedirectResponse(url='/static/index.html')

@app.get('/datasets')
def list_datasets():
    return db.datasetList()

@app.get('/datasets/{label}')
def get_dataset(label: str):
    checkLabel(label)
    return db[label]['meta']
@app.post('/datasets/{label}', status_code=201)
async def create_dataset(label: str):
    db.createDataset(label)
    await db.save(label)
    return db[label]['meta']
@app.delete('/datasets/{label}')
def delete_dataset(label: str):
    db.purgeDataset(label)

class TreeSource(str, Enum):
    newick = 'newick'
    otf2 = 'otf2'
    graph = 'graph'
@app.get('/datasets/{label}/tree')
def get_tree(label: str, source: TreeSource = TreeSource.newick):
    checkLabel(label)
    if source not in db[label]['trees']:
        raise HTTPException(status_code=404, detail='Dataset does not contain %s tree data' % source.value)
    return db[label]['trees'][source]
@app.post('/datasets/{label}/tree')
def add_newick_tree(label: str, file: UploadFile = File(...)):
    checkLabel(label)
    logger = ClientLogger()
    async def startProcess():
        db.addSourceFile(label, file.filename, 'newick')
        await db.processNewickTree(label, (await file.read()).decode(), logger.log)
        await db.save(label, logger.log)
        logger.finish()
    return StreamingResponse(logger.iterate(startProcess), media_type='text/text')

@app.post('/datasets/{label}/csv')
def add_performance_csv(label: str, file: UploadFile = File(...)):
    checkLabel(label)
    logger = ClientLogger()
    async def startProcess():
        db.addSourceFile(label, file.filename, 'csv')
        await db.processCsv(label, iterUploadFile(await file.read()), logger.log)
        await db.save(label, logger.log)
        logger.finish()
    return StreamingResponse(logger.iterate(startProcess), media_type='text/text')

@app.post('/datasets/{label}/dot')
def add_dot_graph(label: str, file: UploadFile = File(...)):
    checkLabel(label)
    logger = ClientLogger()
    async def startProcess():
        db.addSourceFile(label, file.filename, 'dot')
        await db.processDot(label, iterUploadFile(await file.read()), logger.log)
        await db.save(label, logger.log)
        logger.finish()
    return StreamingResponse(logger.iterate(startProcess), media_type='text/text')

@app.post('/datasets/{label}/log')
def add_full_phylanx_log(label: str, file: UploadFile = File(...)):
    checkLabel(label)
    logger = ClientLogger()
    async def startProcess():
        db.addSourceFile(label, file.filename, 'log')
        await db.processPhylanxLog(label, iterUploadFile(await file.read()), logger.log)
        await db.save(label, logger.log)
        logger.finish()
    return StreamingResponse(logger.iterate(startProcess), media_type='text/text')

@app.post('/datasets/{label}/otf2')
async def add_otf2_trace(label: str, request: Request):
    # TODO: I think we can accept a raw stream instead of a otf2-print dump
    # (which would be a huge file):
    # async for chunk in request.stream()
    # ... but I'm not sure if this will even work with a linked Jupyter
    # approach, nor how to best map chunks to lines in db.processOtf2()
    raise HTTPException(status_code=501)

@app.get('/datasets/{label}/physl')
def get_physl(label: str):
    checkLabel(label)
    if 'physl' not in db[label]:
        raise HTTPException(status_code=404, detail='Dataset does not include physl source code')
    return db[label]['physl']
@app.post('/datasets/{label}/physl')
async def add_physl(label: str, file: UploadFile = File(...)):
    checkLabel(label)
    db.addSourceFile(label, file.filename, 'physl')
    db.processCode(label, file.filename, iterUploadFile(await file.read()), 'physl')
    await db.save(label)
@app.get('/datasets/{label}/python')
def get_python(label: str):
    checkLabel(label)
    if 'python' not in db[label]:
        raise HTTPException(status_code=404, detail='Dataset does not include python source code')
    return db[label]['python']
@app.post('/datasets/{label}/python')
async def add_python(label: str, file: UploadFile = File(...)):
    checkLabel(label)
    db.addSourceFile(label, file.filename, 'python')
    db.processCode(label, file.filename, iterUploadFile(await file.read()), 'python')
    await db.save(label)
@app.get('/datasets/{label}/cpp')
def get_cpp(label: str):
    checkLabel(label)
    if 'cpp' not in db[label]:
        raise HTTPException(status_code=404, detail='Dataset does not include C++ source code')
    return db[label]['cpp']
@app.post('/datasets/{label}/cpp')
async def add_c_plus_plus(label: str, file: UploadFile = File(...)):
    checkLabel(label)
    db.addSourceFile(label, file.filename, 'cpp')
    db.processCode(label, file.filename, iterUploadFile(await file.read()), 'cpp')
    await db.save(label)

@app.get('/datasets/{label}/primitives')
def primitives(label: str):
    checkLabel(label)
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
    checkLabel(label)
    checkIntervals(label)

    if begin is None:
        begin = db[label]['meta']['intervalDomain'][0]
    if end is None:
        end = db[label]['meta']['intervalDomain'][1]

    def modeHelper(indexObj):
        # TODO: respond with a 204 when the histogram is empty
        # (d3.js doesn't have a good way to handle 204 error codes)
        # if indexObj.is_empty():
        #    raise HTTPException(status_code=204, detail='An index exists for the query, but it is empty')
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
    checkLabel(label)
    checkIntervals(label)

    if begin is None:
        begin = db[label]['meta']['intervalDomain'][0]
    if end is None:
        end = db[label]['meta']['intervalDomain'][1]

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
    asyncio.get_event_loop().run_until_complete(db.load())
    uvicorn.run(app, host='0.0.0.0')
