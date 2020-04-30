#!/usr/bin/env python3
import os
import argparse
import json
import asyncio
from enum import Enum

import numpy as np
import uvicorn  # pylint: disable=import-error
from fastapi import FastAPI, File, UploadFile, HTTPException  # pylint: disable=import-error
from pydantic import BaseModel  # pylint: disable=import-error
from starlette.staticfiles import StaticFiles  # pylint: disable=import-error
from starlette.requests import Request  # pylint: disable=import-error
from starlette.responses import RedirectResponse, StreamingResponse  # pylint: disable=import-error
from data_store import DataStore, ClientLogger
from profiling_tools.profilier import Profilier
import cProfile, pstats, io

parser = argparse.ArgumentParser(description='Serve the traveler-integrated interface')
parser.add_argument('-d', '--db_dir', dest='dbDir', default='/tmp/traveler-integrated',
                    help='Directory where the bundled data is already / will be stored (default: /tmp/traveler-integrated)')
parser.add_argument('-s', '--debug', dest='debug', action='store_true',
                    help='Store additional information for debugging source files, etc.')
parser.add_argument('-p', '--port', dest='port', default=os.environ.get('TRAVELER_PORT', '8000'),
                    help='Port to serve the interface from. Will override TRAVELER_PORT if specified.')

args = parser.parse_args()
db = DataStore(args.dbDir, args.debug)
app = FastAPI(
    title=__name__,
    description='This is a test',
    version='0.1.0'
)
app.mount('/static', StaticFiles(directory='static'), name='static')

prf = Profilier()
profile = False


def checkDatasetExistence(label):
    if label not in db:
        raise HTTPException(status_code=404, detail='Dataset not found')


def checkDatasetHasIntervals(label):
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
    checkDatasetExistence(label)
    return db[label]['meta']


class BasicDataset(BaseModel):  # pylint: disable=R0903
    # TODO: ideally, these should all be UploadFile arguments instead of
    # expecting pre-parsed strings, however, AFAIK there isn't a FastAPI way to
    # allow optional UploadFile arguments
    newick: str = None
    csv: str = None
    dot: str = None
    physl: str = None
    python: str = None
    cpp: str = None


@app.post('/datasets/{label}', status_code=201)
def create_dataset(label: str, dataset: BasicDataset = None):
    if label in db:
        raise HTTPException(status_code=409, detail='Dataset with label %s already exists' % label)
    logger = ClientLogger()

    async def startProcess():
        db.createDataset(label)
        if dataset:
            if dataset.newick:
                db.addSourceFile(label, label + '.newick', 'newick')
                await db.processNewickTree(label, dataset.newick, logger.log)
            if dataset.csv:
                db.addSourceFile(label, label + '.csv', 'csv')
                await db.processCsv(label, iter(dataset.csv.splitlines()), logger.log)
            if dataset.dot:
                db.addSourceFile(label, label + '.dot', 'dot')
                await db.processDot(label, iter(dataset.dot.splitlines()), logger.log)
            if dataset.physl:
                db.processCode(label, label + '.physl', dataset.physl.splitlines(), 'physl')
                await logger.log('Loaded physl code')
            if dataset.python:
                db.processCode(label, label + '.py', dataset.python.splitlines(), 'python')
                await logger.log('Loaded python code')
            if dataset.cpp:
                db.processCode(label, label + '.cpp', dataset.cpp.splitlines(), 'cpp')
                await logger.log('Loaded C++ code')
        await db.save(label, logger.log)
        logger.finish()

    return StreamingResponse(logger.iterate(startProcess), media_type='text/text')


@app.delete('/datasets/{label}')
def delete_dataset(label: str):
    checkDatasetExistence(label)
    db.purgeDataset(label)


class TreeSource(str, Enum):
    newick = 'newick'
    otf2 = 'otf2'
    graph = 'graph'


@app.get('/datasets/{label}/tree')
def get_tree(label: str, source: TreeSource = TreeSource.newick):
    checkDatasetExistence(label)
    if source not in db[label]['trees']:
        raise HTTPException(status_code=404, detail='Dataset does not contain %s tree data' % source.value)
    return db[label]['trees'][source]


@app.post('/datasets/{label}/tree')
def add_newick_tree(label: str, file: UploadFile = File(...)):
    checkDatasetExistence(label)
    logger = ClientLogger()

    async def startProcess():
        db.addSourceFile(label, file.filename, 'newick')
        await db.processNewickTree(label, (await file.read()).decode(), logger.log)
        await db.save(label, logger.log)
        logger.finish()

    return StreamingResponse(logger.iterate(startProcess), media_type='text/text')


@app.post('/datasets/{label}/csv')
def add_performance_csv(label: str, file: UploadFile = File(...)):
    checkDatasetExistence(label)
    logger = ClientLogger()

    async def startProcess():
        db.addSourceFile(label, file.filename, 'csv')
        await db.processCsv(label, iterUploadFile(await file.read()), logger.log)
        await db.save(label, logger.log)
        logger.finish()

    return StreamingResponse(logger.iterate(startProcess), media_type='text/text')


@app.post('/datasets/{label}/dot')
def add_dot_graph(label: str, file: UploadFile = File(...)):
    checkDatasetExistence(label)
    logger = ClientLogger()

    async def startProcess():
        db.addSourceFile(label, file.filename, 'dot')
        await db.processDot(label, iterUploadFile(await file.read()), logger.log)
        await db.save(label, logger.log)
        logger.finish()

    return StreamingResponse(logger.iterate(startProcess), media_type='text/text')


@app.post('/datasets/{label}/log')
def add_full_phylanx_log(label: str, file: UploadFile = File(...)):
    checkDatasetExistence(label)
    logger = ClientLogger()

    async def startProcess():
        db.addSourceFile(label, file.filename, 'log')
        await db.processPhylanxLog(label, iterUploadFile(await file.read()), logger.log)
        await db.save(label, logger.log)
        logger.finish()

    return StreamingResponse(logger.iterate(startProcess), media_type='text/text')


class FakeOtf2File:  # pylint: disable=R0903
    def __init__(self, request):
        self.name = 'APEX.otf2'
        self.request = request

    async def __aiter__(self):
        async for chunk in self.request.stream():
            for line in chunk.decode().split('\n'):
                if line != '':
                    yield line


@app.post('/datasets/{label}/otf2')
async def add_otf2_trace(label: str, request: Request, storeEvents: bool = False):  # request: Request
    checkDatasetExistence(label)
    logger = ClientLogger()

    async def startProcess():
        db.addSourceFile(label, 'APEX.otf2', 'otf2')
        await db.processOtf2(label, FakeOtf2File(request), storeEvents, logger.log)
        logger.finish()

    return StreamingResponse(logger.iterate(startProcess), media_type='text/text')


@app.get('/datasets/{label}/physl')
def get_physl(label: str):
    checkDatasetExistence(label)
    if 'physl' not in db[label]:
        raise HTTPException(status_code=404, detail='Dataset does not include physl source code')
    return db[label]['physl']


@app.post('/datasets/{label}/physl')
async def add_physl(label: str, file: UploadFile = File(...)):
    checkDatasetExistence(label)
    db.processCode(label, file.filename, iterUploadFile(await file.read()), 'physl')
    await db.save(label)


@app.get('/datasets/{label}/python')
def get_python(label: str):
    checkDatasetExistence(label)
    if 'python' not in db[label]:
        raise HTTPException(status_code=404, detail='Dataset does not include python source code')
    return db[label]['python']


@app.post('/datasets/{label}/python')
async def add_python(label: str, file: UploadFile = File(...)):
    checkDatasetExistence(label)
    db.processCode(label, file.filename, iterUploadFile(await file.read()), 'python')
    await db.save(label)


@app.get('/datasets/{label}/cpp')
def get_cpp(label: str):
    checkDatasetExistence(label)
    if 'cpp' not in db[label]:
        raise HTTPException(status_code=404, detail='Dataset does not include C++ source code')
    return db[label]['cpp']


@app.post('/datasets/{label}/cpp')
async def add_c_plus_plus(label: str, file: UploadFile = File(...)):
    checkDatasetExistence(label)
    db.processCode(label, file.filename, iterUploadFile(await file.read()), 'cpp')
    await db.save(label)


@app.get('/datasets/{label}/primitives')
def primitives(label: str):
    checkDatasetExistence(label)
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
    checkDatasetExistence(label)
    checkDatasetHasIntervals(label)

    if begin is None:
        begin = db[label]['meta']['intervalDomain'][0]
    if end is None:
        end = db[label]['meta']['intervalDomain'][1]

    def modeHelper(indexObj):
        # TODO: respond with a 204 when the histogram is empty
        # (d3.js doesn't have a good way to handle 204 error codes)
        # if indexObj.is_empty():
        #    raise HTTPException(status_code=204, detail='An index exists for the query, but it is empty')
        val = getattr(indexObj, 'compute%sHistogram' % (mode.title()))(bins, begin, end)
        return val

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
def intervals(label: str, begin: float = None, end: float = None, profile: bool = False):
    checkDatasetExistence(label)
    checkDatasetHasIntervals(label)

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
            json.dumps(db[label]['intervals'][i.data])
            firstItem = False
        yield ']'

    def profIntervalGenerator():
        firstItem = True
        for i in db[label]['intervalIndexes']['main'].iterOverlap(begin, end):
            if not firstItem:
                pass
            json.dumps(db[label]['intervals'][i.data])
            firstItem = False

    if profile is True:
        return profIntervalGenerator()
    else:
        return StreamingResponse(intervalGenerator(), media_type='application/json')


@app.get('/datasets/{label}/procMetrics')
def procMetrics(label: str):
    checkDatasetExistence(label)

    return db[label]['procMetrics']['procMetricList']


@app.get('/datasets/{label}/procMetrics/{metric}')
def procMetricValues(label: str, metric: str, begin: float = None, end: float = None):
    checkDatasetExistence(label)
    # checkDatasetHasIntervals(label)

    if begin is None:
        begin = db[label]['meta']['intervalDomain'][0]
    if end is None:
        end = db[label]['meta']['intervalDomain'][1]

    def procMetricGenerator():
        yield '['
        firstItem = True
        for tm in db[label]['procMetrics'][metric]:
            if float(tm) < begin or float(tm) > end:
                continue
            if not firstItem:
                yield ','
            yield json.dumps(db[label]['procMetrics'][metric][tm])
            firstItem = False
        yield ']'

    return StreamingResponse(procMetricGenerator(), media_type='application/json')


@app.get('/datasets/{label}/intervals/{intervalId}/trace')
def intervalTrace(label: str, intervalId: str, begin: float = None, end: float = None):
    # This streams back a list of string IDs, as well as two special metadata
    # objects for drawing lines to the left and right of the queried range when
    # the full traceback is not requested
    checkDatasetExistence(label)
    checkDatasetHasIntervals(label)

    if begin is None:
        begin = db[label]['meta']['intervalDomain'][0]
    if end is None:
        end = db[label]['meta']['intervalDomain'][1]

    def intervalIdGenerator():
        yield '['
        targetInterval = intervalObj = db[label]['intervals'][intervalId]
        lastInterval = None
        yieldComma = False

        # First phase: from the targetInterval, step backward until we encounter
        # an interval in the queried range (or we run out of intervals)
        while 'lastParentInterval' in intervalObj and intervalObj['enter']['Timestamp'] > end:
            lastInterval = intervalObj
            parentId = intervalObj['lastParentInterval']['id']
            intervalObj = db[label]['intervals'][parentId]

        if targetInterval != intervalObj:
            # Because the target interval isn't in the query window, yield some
            # metadata about the interval beyond the end boundary, so the client
            # can draw lines beyond the window (and won't need access to the
            # interval beyond the window itself)
            yield json.dumps({
                'type': 'beyondRight',
                'id': lastInterval['intervalId'],
                'location': lastInterval['Location'],
                'beginTimestamp': lastInterval['enter']['Timestamp']
            })
            yieldComma = True

        # Second phase: yield interval ids until we encounter an interval beyond
        # the queried range (or we run out)
        while 'lastParentInterval' in intervalObj and intervalObj['leave']['Timestamp'] >= begin:
            if yieldComma:
                yield ','
            yieldComma = True
            yield '"%s"' % intervalObj['intervalId']
            lastInterval = intervalObj
            parentId = intervalObj['lastParentInterval']['id']
            intervalObj = db[label]['intervals'][parentId]

        if 'lastParentInterval' not in intervalObj and intervalObj['leave']['Timestamp'] >= begin:
            # We ran out of intervals, and the last one was in range; just yield
            # its id (no beyondLeft metadata needed)
            if yieldComma:
                yield ','
            yieldComma = True
            yield '"%s"' % intervalObj['intervalId']
        elif lastInterval and lastInterval['leave']['Timestamp'] >= begin:
            # Yield some metadata about the interval beyond the begin boundary,
            # so the client can draw lines beyond the window (and won't need
            # access to the interval itself)
            if yieldComma:
                yield ','
            yieldComma = True
            yield json.dumps({
                'type': 'beyondLeft',
                'id': intervalObj['intervalId'],
                'location': intervalObj['Location'],
                'endTimestamp': intervalObj['leave']['Timestamp']
            })

        # Finished
        yield ']'

    return StreamingResponse(intervalIdGenerator(), media_type='application/json')


@app.get('/datasets/{label}/guids/{guid}/intervalIds')
def guidIntervalIds(label: str, guid: str):
    checkDatasetExistence(label)
    checkDatasetHasIntervals(label)
    if guid not in db[label]['guids']:
        raise HTTPException(status_code=404, detail='GUID %s not found' % guid)
    return db[label]['guids'][guid]


@app.get('/datasets/{label}/drawValues')
def getDrawValues(label: str, bins: int = 100, begin: int = None, end: int = None, location: str = None):
    if begin is None:
        begin = db[label]['meta']['intervalDomain'][0]
    if end is None:
        end = db[label]['meta']['intervalDomain'][1]

    if location is None:
        ret = db[label]['sparseUtilizationList']['intervals'].calcUtilizationHistogram(bins, begin, end)
    else:
        ret = db[label]['sparseUtilizationList']['intervals'].calcUtilizationForLocation(bins, begin, end, location)

    return ret


@app.get('/datasets/{label}/newMetricData')
def newMetricData(label: str, bins: int = 100, begin: int = None, end: int = None, location: str = None, metric_type: str = None):
    if begin is None:
        begin = db[label]['meta']['intervalDomain'][0]
    if end is None:
        end = db[label]['meta']['intervalDomain'][1]

    if location is None:
        ret = db[label]['sparseUtilizationList']['metrics'][metric_type].calcMetricUtilization(bins, begin, end)
    else:
        ret = db[label]['sparseUtilizationList']['metrics'][metric_type].calcUtilizationForLocation(bins, begin, end, location, False)

    return ret


#####################
# Profilier Wrappers#
#####################

@app.get('/profile/start')
def profileStart():
    prf.reset()


@app.get('/profile/datasets/{label}/drawValues')
def profileGetDrawValues(label: str, bins: int = 100, begin: int = None, end: int = None, location: str = None):
    prf.start()
    ret = getDrawValues(label, bins, begin, end, location)
    prf.end()

    return ret


@app.get('/profile/datasets/{label}/histogram')
def profileHistogram(label: str, \
                     mode: HistogramMode = HistogramMode.utilization, \
                     bins: int = 100, \
                     begin: float = None, \
                     end: float = None, \
                     location: str = None, \
                     primitive: str = None):
    prf.start()
    ret = histogram(label, mode, bins, begin, end, location, primitive)
    prf.end()

    return ret


@app.get('/profile/datasets/{label}/intervals')
def profileIntervals(label: str, begin: float = None, end: float = None):
    prf.start()
    intervals(label, begin, end, True)
    prf.end()

    return 0


@app.get('/profile/print/{sortby}/{filename}/{numberOfRuns}')
def profilePrint(sortby: str, filename: str, numberOfRuns: int):
    prf.dumpAverageStats(sortby, filename, numberOfRuns)


if __name__ == '__main__':
    asyncio.get_event_loop().run_until_complete(db.load())
    uvicorn.run(app, host='0.0.0.0', port=int(args.port))
