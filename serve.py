#!/usr/bin/env python3
import os
import argparse
import json
import asyncio
from enum import Enum

import uvicorn  # pylint: disable=import-error
from fastapi import FastAPI, File, UploadFile, HTTPException  # pylint: disable=import-error
from pydantic import BaseModel  # pylint: disable=import-error
from starlette.staticfiles import StaticFiles  # pylint: disable=import-error
from starlette.requests import Request  # pylint: disable=import-error
from starlette.responses import RedirectResponse, StreamingResponse #pylint: disable=import-error
from data_store import DataStore, ClientLogger
from data_store.sparseUtilizationList import loadSUL

parser = argparse.ArgumentParser(description='Serve the traveler-integrated interface')
parser.add_argument('-d', '--db_dir', dest='dbDir', default='/tmp/traveler-integrated',
                    help=('Directory where the bundled data is already / will be stored '
                          '(default: /tmp/traveler-integrated)'))
parser.add_argument('-s', '--debug', dest='debug', action='store_true',
                    help='Store additional information for debugging source files, etc.')
parser.add_argument('-p', '--port', dest='port', default=os.environ.get('TRAVELER_PORT', '8000'),
                    help='Port to serve the interface from. Will override TRAVELER_PORT if specified.')

args = parser.parse_args()
db = DataStore(args.dbDir, args.debug)
app = FastAPI(
    title=__name__,
    description='This is the API for traveler-integrated',
    version='0.1.1'
)
app.mount('/static', StaticFiles(directory='static'), name='static')

def validateDataset(datasetId, requiredFiles=[], filesMustBeReady=[], allFilesMustBeReady=False):
    if datasetId not in db:
        # Not strictly RESTful, but we also support looking up datasets by their label
        for dataset in db:
            if dataset['info']['label'] == datasetId:
                datasetId = dataset['info']['datasetId']
                break
        if datasetId not in db:
            raise HTTPException(status_code=404, detail='Dataset not found')

    requiredFiles = set(requiredFiles)
    filesMustBeReady = set(filesMustBeReady)
    allFilesReady = True
    for sourceFile in db[datasetId]['info']['sourceFiles']:
        requiredFiles.discard(sourceFile['fileType'])
        if not sourceFile['stillLoading']:
            allFilesReady = False
            filesMustBeReady.discard(sourceFile['fileType'])
    if len(requiredFiles) > 0:
        raise HTTPException(status_code=404, detail='Dataset does not contain required data: %s' % ', '.join(requiredFiles))
    if allFilesMustBeReady and not allFilesReady:
        raise HTTPException(status_code=503, detail='Dataset is not finished loading')
    if len(filesMustBeReady) > 0:
        raise HTTPException(status_code=503, detail='Required data still loading: %s' % ', '.join(filesMustBeReady))

    return datasetId

def iterUploadFile(text):
    for line in text.decode().splitlines():
        yield line


@app.get('/')
def index():
    return RedirectResponse(url='/static/index.html')


@app.get('/datasets')
def list_datasets():
    for dataset in db:
        yield dataset['info']

@app.get('/datasets/{datasetId}')
def get_dataset(datasetId: str):
    datasetId = validateDataset(datasetId)
    return db[datasetId]['info']

class BasicDataset(BaseModel):
    # TODO: ideally, these should all be UploadFile arguments instead of
    # expecting pre-parsed strings, however, AFAIK there isn't a FastAPI way to
    # allow optional UploadFile arguments
    label: str = 'Untitled dataset'
    newick: str = None
    csv: str = None
    dot: str = None
    physl: str = None
    python: str = None
    cpp: str = None
    tags: list = None

@app.post('/datasets', status_code=201)
def create_dataset(dataset: BasicDataset = None):
    logger = ClientLogger()

    async def startProcess():
        datasetId = db.createDataset()['info']['datasetId']
        if dataset:
            if dataset.tags:
                tags = {t : True for t in dataset.tags}
                db.addTags(datasetId, tags)
            if dataset.newick:
                db.addSourceFile(datasetId, dataset.label + '.newick', 'newick')
                await db.processNewickTree(datasetId, dataset.newick, logger.log)
                db.finishLoadingSourceFile(datasetId, dataset.label + '.newick')
            if dataset.csv:
                db.addSourceFile(datasetId, dataset.label + '.csv', 'csv')
                await db.processCsv(datasetId, iter(dataset.csv.splitlines()), logger.log)
                db.finishLoadingSourceFile(datasetId, dataset.label + '.csv')
            if dataset.dot:
                db.addSourceFile(datasetId, dataset.label + '.dot', 'dot')
                await db.processDot(datasetId, iter(dataset.dot.splitlines()), logger.log)
                db.finishLoadingSourceFile(datasetId, dataset.label + '.dot')
            if dataset.physl:
                db.processCode(datasetId, dataset.label + '.physl', dataset.physl.splitlines(), 'physl')
                await logger.log('Loaded physl code')
            if dataset.python:
                db.processCode(datasetId, dataset.label + '.py', dataset.python.splitlines(), 'python')
                await logger.log('Loaded python code')
            if dataset.cpp:
                db.processCode(datasetId, dataset.label + '.cpp', dataset.cpp.splitlines(), 'cpp')
                await logger.log('Loaded C++ code')

        await db.save(datasetId, logger.log)
        logger.finish()

    return StreamingResponse(logger.iterate(startProcess), media_type='text/text')

@app.delete('/datasets/{datasetId}')
def delete_dataset(datasetId: str):
    datasetId = validateDataset(datasetId, allFilesMustBeReady=True)
    del db[datasetId]


class TreeSource(str, Enum):
    newick = 'newick'
    otf2 = 'otf2'
    graph = 'graph'

@app.get('/datasets/{datasetId}/tree')
def get_tree(datasetId: str, source: TreeSource = TreeSource.newick):
    datasetId = validateDataset(datasetId)
    if source not in db[datasetId]['trees']:
        raise HTTPException(status_code=404, detail='Dataset does not contain %s tree data' % source.value)
    return db[datasetId]['trees'][source]

@app.post('/datasets/{datasetId}/tree')
def add_newick_tree(datasetId: str, file: UploadFile = File(...)):
    datasetId = validateDataset(datasetId)
    logger = ClientLogger()

    async def startProcess():
        db.addSourceFile(datasetId, file.filename, 'newick')
        await db.processNewickTree(datasetId, (await file.read()).decode(), logger.log)
        db.finishLoadingSourceFile(datasetId, file.filename)
        await db.save(datasetId, logger.log)
        logger.finish()

    return StreamingResponse(logger.iterate(startProcess), media_type='text/text')


@app.post('/datasets/{datasetId}/csv')
def add_performance_csv(datasetId: str, file: UploadFile = File(...)):
    datasetId = validateDataset(datasetId)
    logger = ClientLogger()

    async def startProcess():
        db.addSourceFile(datasetId, file.filename, 'csv')
        await db.processCsv(datasetId, iterUploadFile(await file.read()), logger.log)
        db.finishLoadingSourceFile(datasetId, file.filename)
        await db.save(datasetId, logger.log)
        logger.finish()

    return StreamingResponse(logger.iterate(startProcess), media_type='text/text')


@app.post('/datasets/{datasetId}/dot')
def add_dot_graph(datasetId: str, file: UploadFile = File(...)):
    datasetId = validateDataset(datasetId)
    logger = ClientLogger()

    async def startProcess():
        db.addSourceFile(datasetId, file.filename, 'dot')
        await db.processDot(datasetId, iterUploadFile(await file.read()), logger.log)
        db.finishLoadingSourceFile(datasetId, file.filename)
        await db.save(datasetId, logger.log)
        logger.finish()

    return StreamingResponse(logger.iterate(startProcess), media_type='text/text')


@app.post('/datasets/{datasetId}/log')
def add_full_phylanx_log(datasetId: str, file: UploadFile = File(...)):
    datasetId = validateDataset(datasetId)
    logger = ClientLogger()

    async def startProcess():
        db.addSourceFile(datasetId, file.filename, 'log')
        await db.processPhylanxLog(datasetId, iterUploadFile(await file.read()), logger.log)
        db.finishLoadingSourceFile(datasetId, file.filename)
        await db.save(datasetId, logger.log)
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

@app.post('/datasets/{datasetId}/otf2')
async def add_otf2_trace(datasetId: str, request: Request):  # request: Request
    datasetId = validateDataset(datasetId)
    logger = ClientLogger()

    async def startProcess():
        db.addSourceFile(datasetId, 'APEX.otf2', 'otf2')
        await db.processOtf2(datasetId, FakeOtf2File(request), logger.log)
        await loadSUL(datasetId, db)
        db.finishLoadingSourceFile(datasetId, 'APEX.otf2')
        logger.finish()

    return StreamingResponse(logger.iterate(startProcess), media_type='text/text')


@app.get('/datasets/{datasetId}/physl')
def get_physl(datasetId: str):
    datasetId = validateDataset(datasetId, requiredFiles=['physl'], filesMustBeReady=['physl'])
    return db[datasetId]['physl']


@app.post('/datasets/{datasetId}/physl')
async def add_physl(datasetId: str, file: UploadFile = File(...)):
    datasetId = validateDataset(datasetId)
    db.processCode(datasetId, file.filename, iterUploadFile(await file.read()), 'physl')
    await db.save(datasetId)


@app.get('/datasets/{datasetId}/python')
def get_python(datasetId: str):
    datasetId = validateDataset(datasetId, requiredFiles=['python'], filesMustBeReady=['python'])
    return db[datasetId]['python']


@app.post('/datasets/{datasetId}/python')
async def add_python(datasetId: str, file: UploadFile = File(...)):
    datasetId = validateDataset(datasetId)
    db.processCode(datasetId, file.filename, iterUploadFile(await file.read()), 'python')
    await db.save(datasetId)


@app.get('/datasets/{datasetId}/cpp')
def get_cpp(datasetId: str):
    datasetId = validateDataset(datasetId, requiredFiles=['cpp'], filesMustBeReady=['cpp'])
    return db[datasetId]['cpp']


@app.post('/datasets/{datasetId}/cpp')
async def add_cpp(datasetId: str, file: UploadFile = File(...)):
    datasetId = validateDataset(datasetId)
    db.processCode(datasetId, file.filename, iterUploadFile(await file.read()), 'cpp')
    await db.save(datasetId)


@app.get('/datasets/{datasetId}/primitives')
def get_primitives(datasetId: str):
    datasetId = validateDataset(datasetId)
    return dict(db[datasetId]['primitives'])


@app.get('/datasets/{datasetId}/procMetrics')
def get_procMetrics(datasetId: str):
    datasetId = validateDataset(datasetId, requiredFiles=['otf2'])
    return db[datasetId]['info']['procMetricList']


@app.get('/datasets/{datasetId}/procMetrics/{metric}')
def get_procMetric_values(datasetId: str, metric: str, begin: float = None, end: float = None):
    datasetId = validateDataset(datasetId, requiredFiles=['otf2'], filesMustBeReady=['otf2'])

    if begin is None:
        begin = db[datasetId]['info']['intervalDomain'][0]
    if end is None:
        end = db[datasetId]['info']['intervalDomain'][1]

    def procMetricGenerator():
        yield '['
        firstItem = True
        for timestamp in db[datasetId]['procMetrics'][metric]:
            if float(timestamp) < begin or float(timestamp) > end:
                continue
            if not firstItem:
                yield ','
            yield json.dumps(db[datasetId]['procMetrics'][metric][timestamp])
            firstItem = False
        yield ']'

    return StreamingResponse(procMetricGenerator(), media_type='application/json')

@app.get('/datasets/{datasetId}/intervals')
def get_intervals(datasetId: str, \
                  begin: int = None, \
                  end: int = None, \
                  minDuration: int = None, \
                  maxDuration: int = None, \
                  location: str = None, \
                  guid: int = None, \
                  primitive: str = None):
    datasetId = validateDataset(datasetId, requiredFiles=['otf2'], filesMustBeReady=['otf2'])

    if begin is None:
        begin = db[datasetId]['info']['intervalDomain'][0]
    if end is None:
        end = db[datasetId]['info']['intervalDomain'][1]

    def intervalGenerator():
        yield '['
        firstItem = True
        for i in db[datasetId]['intervalIndex'].iterOverlap(begin, end):
            intervalObj = db[datasetId]['intervals'][i.data]

            # Filter by location
            if location is not None and intervalObj['Location'] != location:
                continue

            # Filter by primitive
            if primitive is not None and intervalObj['Primitive'] != primitive:
                continue

            # Filter by guid
            if guid is not None and intervalObj['GUID'] != guid:
                continue

            # Filter by interval duration
            if minDuration is not None or maxDuration is not None:
                intervalLength = (intervalObj['leave']['Timestamp'] - intervalObj['enter']['Timestamp'])
                if minDuration is not None and intervalLength < minDuration:
                    continue
                if maxDuration is not None and intervalLength > maxDuration:
                    continue

            # This interval has passed all filters; yield it
            if not firstItem:
                yield ','
            yield json.dumps(intervalObj)
            firstItem = False
        yield ']'

    return StreamingResponse(intervalGenerator(), media_type='application/json')

@app.get('/datasets/{datasetId}/intervals/{intervalId}/trace')
def intervalTrace(datasetId: str, intervalId: str, begin: float = None, end: float = None):
    # This streams back a list of string IDs, as well as two special metadata
    # objects for drawing lines to the left and right of the queried range when
    # the full traceback is not requested
    datasetId = validateDataset(datasetId, requiredFiles=['otf2'], filesMustBeReady=['otf2'])

    if begin is None:
        begin = db[datasetId]['info']['intervalDomain'][0]
    if end is None:
        end = db[datasetId]['info']['intervalDomain'][1]

    def intervalIdGenerator():
        yield '['
        targetInterval = intervalObj = db[datasetId]['intervals'][intervalId]
        lastInterval = None
        yieldComma = False

        # First phase: from the targetInterval, step backward until we encounter
        # an interval in the queried range (or we run out of intervals)
        while 'lastParentInterval' in intervalObj and intervalObj['enter']['Timestamp'] > end:
            lastInterval = intervalObj
            parentId = intervalObj['lastParentInterval']['id']
            intervalObj = db[datasetId]['intervals'][parentId]

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
            intervalObj = db[datasetId]['intervals'][parentId]

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

@app.get('/datasets/{datasetId}/utilizationHistogram')
def get_utilization_histogram(datasetId: str, bins: int = 100, begin: int = None, end: int = None, location: str = None):
    datasetId = validateDataset(datasetId, requiredFiles=['otf2'], filesMustBeReady=['otf2'])

    if begin is None:
        begin = db[datasetId]['info']['intervalDomain'][0]
    if end is None:
        end = db[datasetId]['info']['intervalDomain'][1]

    ret = {}
    if location is None:
        ret['data'] = db[datasetId]['sparseUtilizationList']['intervals'].calcUtilizationHistogram(bins, begin, end)
    else:
        ret['data'] = db[datasetId]['sparseUtilizationList']['intervals'].calcUtilizationForLocation(bins, begin, end, location)
    ret['metadata'] = {'begin': begin, 'end': end, 'bins': bins}
    return ret


@app.get('/datasets/{datasetId}/newMetricData')
def newMetricData(datasetId: str, bins: int = 100, begin: int = None, end: int = None, location: str = None, metric_type: str = None):
    datasetId = validateDataset(datasetId, requiredFiles=['otf2'], filesMustBeReady=['otf2'])

    if begin is None:
        begin = db[datasetId]['info']['intervalDomain'][0]
    if end is None:
        end = db[datasetId]['info']['intervalDomain'][1]

    ret = {}
    if location is None:
        ret['data'] = db[datasetId]['sparseUtilizationList']['metrics'][metric_type].calcMetricHistogram(bins, begin, end)
    else:
        ret['data'] = db[datasetId]['sparseUtilizationList']['metrics'][metric_type].calcMetricHistogram(bins, begin, end, location)
    ret['metadata'] = {'begin': begin, 'end': end, 'bins': bins}
    return ret


@app.get('/datasets/{datasetId}/ganttChartValues')
def ganttChartValues(datasetId: str, bins: int=100, begin: int=None, end: int=None):
    datasetId = validateDataset(datasetId, requiredFiles=['otf2'], filesMustBeReady=['otf2'])

    if begin is None:
        begin = db[datasetId]['info']['intervalDomain'][0]
    if end is None:
        end = db[datasetId]['info']['intervalDomain'][1]

    ret = {}
    ret['data'] = db[datasetId]['sparseUtilizationList']['intervals'].calcGanttHistogram(bins, begin, end)

    ret['metadata'] = {}
    ret['metadata']['begin'] = begin
    ret['metadata']['end'] = end
    ret['metadata']['bins'] = bins

    return json.dumps(ret)


@app.get('/datasets/{datasetId}/getIntervalDuration')
def getIntervalDuration(datasetId: str, bins: int = 100, begin: int = None, end: int = None, primitive: str = None):
    datasetId = validateDataset(datasetId, requiredFiles=['otf2'], filesMustBeReady=['otf2'])

    if begin is None:
        begin = int(db[datasetId]['info']['intervalDurationDomain'][primitive][0])
    if end is None:
        end = db[datasetId]['info']['intervalDurationDomain'][primitive][1]

    ret = {}
    if primitive is None:
        return ret
    ret['data'] = db[datasetId]['sparseUtilizationList']['intervalDuration'][primitive].calcIntervalHistogram(bins, begin, end)
    ret['metadata'] = {'begin': begin, 'end': end, 'bins': bins}
    return ret

if __name__ == '__main__':
    asyncio.get_event_loop().run_until_complete(db.load())
    uvicorn.run(app, host='0.0.0.0', port=int(args.port))
