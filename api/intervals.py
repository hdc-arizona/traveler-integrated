import json

from fastapi import APIRouter
from starlette.responses import StreamingResponse

from . import db, validateDataset

router = APIRouter()

@router.get('/datasets/{datasetId}/intervals')
def get_intervals(datasetId: str, \
                  begin: int = None, \
                  end: int = None, \
                  includeDetails: bool = False, \
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

            if includeDetails:
                # Send back everything we know about the interval
                yield json.dumps(intervalObj)
            else:
                # To reduce the size of large queries, only return the
                # enter/leave timestamps and the intervalId
                yield json.dumps({
                    'enter': i.begin,
                    'leave': i.end,
                    'intervalId': i.data
                })
            firstItem = False
        yield ']'

    return StreamingResponse(intervalGenerator(), media_type='application/json')

@router.get('/datasets/{datasetId}/intervals/{intervalId}/trace')
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
