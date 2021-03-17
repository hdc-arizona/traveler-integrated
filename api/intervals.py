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

        # Second phase: yield intervals until we encounter one beyond
        # the queried range (or we run out)
        while intervalObj['parent'] is not None and intervalObj['leave']['Timestamp'] >= begin:
            if yieldComma:
                yield ','
            yieldComma = True
            childId = lastInterval['intervalId'] if lastInterval is not None else None
            yield format_interval(intervalObj, childId)
            lastInterval = intervalObj
            parentId = intervalObj['parent']
            intervalObj = db[datasetId]['intervals'][parentId]

        # Start on descendants
        yield '},"descendants":{'
        childQueue = [intervalId]
        fastForwarding = True
        yieldComma = False

        while len(childQueue) > 0:
            intervalObj = db[datasetId]['intervals'][childQueue.pop(0)]
            if fastForwarding:
                # First phase: from the targetInterval, fast forward until we
                # encounter an interval in the queried range
                if intervalObj['leave']['Timestamp'] >= begin:
                    fastForwarding = False

            if not fastForwarding and intervalObj['enter']['Timestamp'] <= end:
                # Second phase: yield intervals that fit the queried range
                if yieldComma:
                    yield ','
                yieldComma = True
                yield format_interval(intervalObj)

            # Only add children to the queue if this interval ends before the
            # queried range
            if intervalObj['leave']['Timestamp'] <= end:
                for childId in intervalObj['children']:
                    if not childId in childQueue:
                        childQueue.append(childId)

        # Finished
        yield '}}'

    return StreamingResponse(intervalGenerator(), media_type='application/json')
