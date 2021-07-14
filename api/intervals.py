import json

from fastapi import APIRouter
from starlette.responses import StreamingResponse

from . import db, validateDataset

router = APIRouter()

@router.get('/datasets/{datasetId}/intervals')
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

@router.get('/datasets/{datasetId}/intervals/{intervalId}')
def get_interval(datasetId: str, \
                 intervalId: str):
    datasetId = validateDataset(datasetId, requiredFiles=['otf2'], filesMustBeReady=['otf2'])
    return db[datasetId]['intervals'].get(intervalId, None)

@router.get('/datasets/{datasetId}/intervals/{intervalId}/trace')
def intervalTrace(datasetId: str,
                  intervalId: str,
                  begin: float = None,
                  end: float = None):
    # This streams back a graph formatted this way:
    # {
    #   "ancestors": {
    #     "id": {
    #       "enter": #####,
    #       "leave": #####,
    #       "location": "...",
    #       "child": "id"  <-- may be omitted if id==intervalId
    #     },
    #     ... (ancestors are streamed first, working backward; children always
    #     streamed before parents)
    #   },
    #   "descendants": {
    #     "id": {
    #       "enter": #####,
    #       "leave": #####,
    #       "location": "...",
    #       "parent": "id"
    #     },
    #     ... (descendants are streamed last, working forward; parents always
    #     streamed before children)
    #   }
    # }
    # If within the queried begin / end window, an object for the associated
    # intervalId will exist in both ancestors and descendants
    datasetId = validateDataset(datasetId, requiredFiles=['otf2'], filesMustBeReady=['otf2'])

    if begin is None:
        begin = db[datasetId]['info']['intervalDomain'][0]
    if end is None:
        end = db[datasetId]['info']['intervalDomain'][1]

    def format_interval(intervalObj, childId = None):
        result = {
            'enter': intervalObj['enter']['Timestamp'],
            'leave': intervalObj['leave']['Timestamp'],
            'location': intervalObj['Location']
        }
        if childId is None:
            result['parent'] = intervalObj['parent']
        else:
            result['child'] = childId
        return '"' + intervalObj['intervalId'] + '":' + json.dumps(result)

    def intervalGenerator():
        yield '{"ancestors":{'

        lastInterval = None
        yieldComma = False
        intervalObj = targetInterval = db[datasetId]['intervals'][intervalId]

        # First phase: from the targetInterval, rewind until we encounter
        # an interval in the queried range (or we run out of intervals)
        while intervalObj['parent'] is not None and intervalObj['enter']['Timestamp'] > end:
            lastInterval = intervalObj
            parentId = intervalObj['parent']
            intervalObj = db[datasetId]['intervals'][parentId]

        # Second phase: if we had to rewind, include the lastInterval to enable
        # drawing offscreen lines to the right
        if intervalObj != targetInterval:
            yield format_interval(lastInterval, None)
            yieldComma = True

        # Third phase: include intervals until we encounter one beyond
        # the queried range (or we run out)
        while intervalObj is not None and intervalObj['leave']['Timestamp'] >= begin:
            if yieldComma:
                yield ','
            yieldComma = True
            childId = lastInterval['intervalId'] if lastInterval is not None else None
            yield format_interval(intervalObj, childId)
            lastInterval = intervalObj
            parentId = intervalObj['parent']
            intervalObj = db[datasetId]['intervals'][parentId] if parentId is not None else None

        # Fourth phase: if the last intervalObj was offscreen, we still want to
        # include it to enable drawing a line offscreen to the left
        if intervalObj is not None:
            if yieldComma:
                yield ','
            yieldComma = True
            childId = lastInterval['intervalId'] if lastInterval is not None else None
            yield format_interval(intervalObj, childId)

        # Start on descendants
        yield '},"descendants":{'
        childQueue = [intervalId]
        yieldComma = False

        while len(childQueue) > 0:
            intervalObj = db[datasetId]['intervals'][childQueue.pop(0)]
            # yield any interval where itself or its child (to allow offscreen
            # lines to the left) is in the queried range
            yieldThisInterval = False
            if intervalObj['leave']['Timestamp'] >= begin:
                yieldThisInterval = True
            else:
                for childId in intervalObj['children']:
                    if db[datasetId]['intervals'][childId]['enter']['Timestamp'] >= begin:
                        yieldThisInterval = True

            if yieldThisInterval:
                if yieldComma:
                    yield ','
                yieldComma = True
                yield format_interval(intervalObj)

            # Only add children to the queue if this interval ends before the
            # queried range does
            if intervalObj['leave']['Timestamp'] <= end:
                for childId in intervalObj['children']:
                    if not childId in childQueue:
                        childQueue.append(childId)

        # Finished
        yield '}}'

    return StreamingResponse(intervalGenerator(), media_type='application/json')


@router.get('/datasets/{datasetId}/intervals/{intervalId}/traceEnd')
def intervalTraceToEnd(datasetId: str,
                  intervalId: str,
                  begin: float = None,
                  end: float = None):
    datasetId = validateDataset(datasetId, requiredFiles=['otf2'], filesMustBeReady=['otf2'])

    if begin is None:
        begin = db[datasetId]['info']['intervalDomain'][0]
    if end is None:
        end = db[datasetId]['info']['intervalDomain'][1]

    def updateTimes(startTime, endTime, intervalObj):
        return min(startTime, intervalObj['enter']['Timestamp']), max(endTime, intervalObj['leave']['Timestamp'])

    def startEndTimeFinder():
        # Start on descendants
        intervalObj = db[datasetId]['intervals'][intervalId]
        startTime = intervalObj['enter']['Timestamp']
        endTime = intervalObj['leave']['Timestamp']
        childQueue = [intervalId]

        while len(childQueue) > 0:
            intervalObj = db[datasetId]['intervals'][childQueue.pop(0)]
            # yield any interval where itself or its child (to allow offscreen
            # lines to the left) is in the queried range
            yieldThisInterval = False
            if intervalObj['leave']['Timestamp'] >= begin:
                yieldThisInterval = True
            else:
                for childId in intervalObj['children']:
                    if db[datasetId]['intervals'][childId]['enter']['Timestamp'] >= begin:
                        yieldThisInterval = True

            if yieldThisInterval:
                startTime, endTime = updateTimes(startTime, endTime, intervalObj)

            # Only add children to the queue if this interval ends before the
            # queried range does
            if intervalObj['leave']['Timestamp'] <= end:
                for childId in intervalObj['children']:
                    if not childId in childQueue:
                        childQueue.append(childId)

        # Finished
        results = {'startTime': startTime, 'endTime': endTime}
        yield json.dumps(results)

    return StreamingResponse(startEndTimeFinder(), media_type='application/json')