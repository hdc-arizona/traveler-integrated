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
from starlette.responses import RedirectResponse, StreamingResponse, JSONResponse #pylint: disable=import-error
from starlette.middleware.cors import CORSMiddleware
from data_store import DataStore, ClientLogger
from data_store.sparseUtilizationList import loadSUL
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
    description='traveler-integrated API',
    version='0.1.0'
)
app.mount('/static', StaticFiles(directory='static'), name='static')


prf = Profilier()
profile = False


def checkDatasetExistence(label):
    if label not in db:
        raise HTTPException(status_code=404, detail='Dataset not found')


def checkDatasetHasTraceData(label):
    if not db[label]['meta']['hasTraceData']:
        raise HTTPException(status_code=404, detail='Dataset does not contain trace data')


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
                db.finishLoadingSourceFile(label, label + '.newick')
            if dataset.csv:
                db.addSourceFile(label, label + '.csv', 'csv')
                await db.processCsv(label, iter(dataset.csv.splitlines()), logger.log)
                db.finishLoadingSourceFile(label, label + '.csv')
            if dataset.dot:
                db.addSourceFile(label, label + '.dot', 'dot')
                await db.processDot(label, iter(dataset.dot.splitlines()), logger.log)
                db.finishLoadingSourceFile(label, label + '.dot')
            if dataset.physl:
                db.processCode(label, label + '.physl', dataset.physl.splitlines(), 'physl')
                await logger.log('Loaded physl code')
                db.finishLoadingSourceFile(label, label + '.physl')
            if dataset.python:
                db.processCode(label, label + '.py', dataset.python.splitlines(), 'python')
                await logger.log('Loaded python code')
                db.finishLoadingSourceFile(label, label + '.py')
            if dataset.cpp:
                db.processCode(label, label + '.cpp', dataset.cpp.splitlines(), 'cpp')
                await logger.log('Loaded C++ code')
                db.finishLoadingSourceFile(label, label + '.cpp')
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
        db.finishLoadingSourceFile(label, file.filename)
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
        db.finishLoadingSourceFile(label, file.filename)
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
        db.finishLoadingSourceFile(label, file.filename)
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
        db.finishLoadingSourceFile(label, file.filename)
        logger.finish()

    return StreamingResponse(logger.iterate(startProcess), media_type='text/text')


class FakeOtf2File:  # pylint: disable=R0903
    def __init__(self, request):
        self.name = 'APEX.otf2'
        self.request = request

    async def __aiter__(self):
        line = ''
        async for chunk in self.request.stream():
            line += chunk.decode()
            done = False
            while not done:
                done = True
                i = line.find('\n')
                if i >= 0:
                    yield line[0:i]
                    line = line[i+1:]
                    done = False


@app.post('/datasets/{label}/otf2')
async def add_otf2_trace(label: str, request: Request, storeEvents: bool = False):  # request: Request
    checkDatasetExistence(label)
    logger = ClientLogger()

    async def startProcess():
        db.addSourceFile(label, 'APEX.otf2', 'otf2')
        await db.processOtf2(label, FakeOtf2File(request), storeEvents, logger.log)
        await loadSUL(label, db)
        db.finishLoadingSourceFile(label, 'APEX.otf2')
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


@app.get('/datasets/{label}/intervals')
def intervals(label: str, begin: float = None, end: float = None, profile: bool = False):
    checkDatasetExistence(label)
    checkDatasetHasTraceData(label)

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
    checkDatasetHasTraceData(label)

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
    checkDatasetHasTraceData(label)

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

class IntervalFetchMode(str, Enum):
    primitive = 'primitive'
    guid = 'guid'
    duration = 'duration'

@app.get('/datasets/{label}/getIntervalInfo')
def getIntervalInfo(label: str, timestamp: int = None, location: str = '1'):
    checkDatasetExistence(label)
    checkDatasetHasTraceData(label)

    begin = timestamp
    if begin is None:
        begin = db[label]['meta']['intervalDomain'][0]
    end = begin + 1
    if end is None:
        end = db[label]['meta']['intervalDomain'][1]

    def intervalInfoGenerator():
        yield '['
        firstItem = True
        for i in db[label]['intervalIndexes']['locations'][location].iterOverlap(begin, end):
            if not firstItem:
                yield ','
            yield json.dumps(db[label]['intervals'][i.data])
            json.dumps(db[label]['intervals'][i.data])
            firstItem = False
        yield ']'

    def profIntervalInfoGenerator():
        firstItem = True
        for i in db[label]['intervalIndexes']['locations'][location].iterOverlap(begin, end):
            if not firstItem:
                pass
            json.dumps(db[label]['intervals'][i.data])
            firstItem = False

    if profile is True:
        return profIntervalInfoGenerator()
    else:
        return StreamingResponse(intervalInfoGenerator(), media_type='application/json')


@app.get('/datasets/{label}/getIntervalList')
def getIntervalList(label: str, \
                    begin: int = None, \
                    end: int = None, \
                    enter: int = None, \
                    leave: int = None, \
                    location: str = '1', \
                    primitive: str = None, \
                    mode: IntervalFetchMode = IntervalFetchMode.primitive):
    checkDatasetExistence(label)
    checkDatasetHasTraceData(label)

    locList = {}
    if enter is None:
        return locList

    if leave is None:
        leave = enter + 1

    if begin is None:
        begin = db[label]['meta']['intervalDomain'][0]
    if end is None:
        end = db[label]['meta']['intervalDomain'][1]

    prim = None
    if mode is not IntervalFetchMode.duration:
        for i in db[label]['intervalIndexes']['locations'][location].iterOverlap(enter, leave):
            prim = db[label]['intervals'][i.data]
        if prim is None:
            return locList

    for loc in db[label]['intervalIndexes']['locations']:
        locList[loc] = []
        for i in db[label]['intervalIndexes']['locations'][loc].iterOverlap(begin, end):
            cur = db[label]['intervals'][i.data]
            interval_length = (cur['leave']['Timestamp'] - cur['enter']['Timestamp'])
            if mode is IntervalFetchMode.primitive and cur['Primitive'] == prim['Primitive']:
                locList[loc].append({'enter': cur['enter']['Timestamp'], 'leave': cur['leave']['Timestamp']})
            elif mode is IntervalFetchMode.guid and cur['GUID'] == prim['GUID']:
                locList[loc].append({'enter': cur['enter']['Timestamp'], 'leave': cur['leave']['Timestamp']})
            elif mode is IntervalFetchMode.duration and primitive == cur['Primitive'] and enter <= interval_length <= leave:
                locList[loc].append({'enter': cur['enter']['Timestamp'], 'leave': cur['leave']['Timestamp']})
    return locList


@app.get('/datasets/{label}/getGUIDList')
def guidIntervalIds(label: str, timestamp: float = None, location: str = '1'):
    checkDatasetExistence(label)
    checkDatasetHasTraceData(label)

    begin = timestamp
    if begin is None:
        begin = db[label]['meta']['intervalDomain'][0]
    end = begin + 1
    if end is None:
        end = db[label]['meta']['intervalDomain'][1]

    def intervalInfoGenerator():
        yield '['
        firstItem = True
        for i in db[label]['intervalIndexes']['locations'][location].iterOverlap(begin, end):
            if not firstItem:
                yield ','
            yield json.dumps(db[label]['intervals'][i.data])
            json.dumps(db[label]['intervals'][i.data])
            firstItem = False
        yield ']'

    def profIntervalInfoGenerator():
        firstItem = True
        for i in db[label]['intervalIndexes']['locations'][location].iterOverlap(begin, end):
            if not firstItem:
                pass
            json.dumps(db[label]['intervals'][i.data])
            firstItem = False

    if profile is True:
        return profIntervalInfoGenerator()
    else:
        return StreamingResponse(intervalInfoGenerator(), media_type='application/json')


@app.get('/datasets/{label}/guids/{guid}/intervalIds')
def guidIntervalIds(label: str, guid: str):
    checkDatasetExistence(label)
    checkDatasetHasTraceData(label)
    if guid not in db[label]['guids']:
        raise HTTPException(status_code=404, detail='GUID %s not found' % guid)
    return db[label]['guids'][guid]


@app.get('/datasets/{label}/drawValues')
def getDrawValues(label: str, bins: int = 100, begin: int = None, end: int = None, location: str = None):
    checkDatasetExistence(label)
    if begin is None:
        begin = db[label]['meta']['intervalDomain'][0]
    if end is None:
        end = db[label]['meta']['intervalDomain'][1]

    ret = {}
    if location is None:
        ret['data'] = db[label]['sparseUtilizationList']['intervals'].calcUtilizationHistogram(bins, begin, end)
    else:
        ret['data'] = db[label]['sparseUtilizationList']['intervals'].calcUtilizationForLocation(bins, begin, end, location)
    ret['metadata'] = {'begin': begin, 'end': end, 'bins': bins}
    return ret


@app.get('/datasets/{label}/newMetricData')
def newMetricData(label: str, bins: int = 100, begin: int = None, end: int = None, location: str = None, metric_type: str = None):
    checkDatasetExistence(label)
    if begin is None:
        begin = db[label]['meta']['intervalDomain'][0]
    if end is None:
        end = db[label]['meta']['intervalDomain'][1]

    ret = {}
    if location is None:
        ret['data'] = db[label]['sparseUtilizationList']['metrics'][metric_type].calcMetricHistogram(bins, begin, end)
    else:
        ret['data'] = db[label]['sparseUtilizationList']['metrics'][metric_type].calcMetricHistogram(bins, begin, end, location)
    ret['metadata'] = {'begin': begin, 'end': end, 'bins': bins}
    return ret


@app.get('/datasets/{label}/ganttChartValues')
def ganttChartValues(label: str, bins: int=100, begin: int=None, end: int=None):
    checkDatasetExistence(label)
    if begin is None:
        begin = db[label]['meta']['intervalDomain'][0]
    if end is None:
        end = db[label]['meta']['intervalDomain'][1]

    ret = {}
    ret['data'] = db[label]['sparseUtilizationList']['intervals'].calcGanttHistogram(bins, begin, end)

    ret['metadata'] = {}
    ret['metadata']['begin'] = begin
    ret['metadata']['end'] = end
    ret['metadata']['bins'] = bins

    return json.dumps(ret)


@app.get('/datasets/{label}/getIntervalDuration')
def getIntervalDuration(label: str, bins: int = 100, begin: int = None, end: int = None, primitive: str = None):
    checkDatasetExistence(label)
    if begin is None:
        begin = int(db[label]['meta']['intervalDurationDomain'][primitive][0])
    if end is None:
        end = db[label]['meta']['intervalDurationDomain'][primitive][1]

    ret = {}
    if primitive is None:
        return ret
    ret['data'] = db[label]['sparseUtilizationList']['intervalDuration'][primitive].calcIntervalHistogram(bins, begin, end)
    ret['metadata'] = {'begin': begin, 'end': end, 'bins': bins}
    return ret

@app.get('/datasets/{label}/getPrimitiveList')
def getPrimitiveList(label: str):
    checkDatasetExistence(label)
    ret = []
    for primitive in db[label]['sparseUtilizationList']['intervalDuration']:
        ret.append(primitive)
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
