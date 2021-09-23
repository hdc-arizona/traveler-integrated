import bisect
import json
import math

from fastapi import APIRouter
from starlette.responses import StreamingResponse

from data_store.dependencyTree import find_node_in_dependency_tree
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

    def format_interval(intervalObj, childId=None):
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


def is_include_primitive_name(primitive: str):
    if '$' in primitive:
        return True
    return False


def get_primitive_pretty_name_with_prefix(primitive: str):
    delimiter = '/'
    start = primitive.find(delimiter)
    start = primitive.find(delimiter, start+len(delimiter))
    return primitive[:start+1], primitive[start+1:]


@router.get('/datasets/{datasetId}/primitives/primitiveTraceForward')
def primitive_trace_forward(datasetId: str,
                            nodeId: str,
                            bins: int = 100,
                            begin: int = None,
                            end: int = None,
                            locations: str = None):
    datasetId = validateDataset(datasetId, requiredFiles=['otf2'], filesMustBeReady=['otf2'])

    if begin is None:
        begin = db[datasetId]['info']['intervalDomain'][0]
    if end is None:
        end = db[datasetId]['info']['intervalDomain'][1]

    if locations:
        locations = locations.split(',')
    else:
        locations = db[datasetId]['info']['locationNames']

    def traceForward():
        dependencyTree = db[datasetId]['dependencyTree']
        currentNode = dependencyTree
        if nodeId != currentNode.nodeId:
            currentNode = find_node_in_dependency_tree(dependencyTree, nodeId)
        if currentNode is None:
            print('Node in dependency tree not found')
            yield ''
            return

        def updateMinAmongLocation(locationEndTime):
            isFirstElement = True
            minAmongLocation = dict()
            for dLocation in locationEndTime:
                if isFirstElement or minAmongLocation['time'] > locationEndTime[dLocation]:
                    minAmongLocation = {'time': locationEndTime[dLocation], 'location': dLocation}
                    isFirstElement = False
            return minAmongLocation

        def greedyIntervalAssignment(intervalList):
            intervalsCompacted = dict()
            if not intervalList:
                return intervalsCompacted
            locationEndTime = dict()
            minAmongLocation = {'time': intervalList[0]['startTime'] + 1, 'location': 0}  # making sure to force into else in the for loop
            intervalList.sort(key=lambda x: x['startTime'])

            dummyLocation = 1
            for interval in intervalList:
                if minAmongLocation['time'] < interval['startTime']:
                    intervalsCompacted[minAmongLocation['location']].append(interval)
                    locationEndTime[minAmongLocation['location']] = interval['endTime']
                    minAmongLocation = updateMinAmongLocation(locationEndTime)
                else:
                    intervalsCompacted[dummyLocation] = list()
                    intervalsCompacted[dummyLocation].append(interval)
                    locationEndTime[dummyLocation] = interval['endTime']
                    minAmongLocation = updateMinAmongLocation(locationEndTime)
                    dummyLocation = dummyLocation + 1
            return intervalsCompacted

        left_index = bisect.bisect_left(currentNode.timeOnlyList, begin)
        right_index = bisect.bisect_right(currentNode.timeOnlyList, end)  # not inclusive
        isFirstLeave = True
        traceForwardList = []
        binSize = int(math.floor((end - begin) / bins))
        minBinCheck = 10
        for ind in range(left_index, right_index):
            e = currentNode.aggregatedBlockList[currentNode.fastSearchInAggBlock[ind]['index']].endTime
            s = currentNode.aggregatedBlockList[currentNode.fastSearchInAggBlock[ind]['index']].startTime
            if (e-s) > (binSize*minBinCheck) and currentNode.fastSearchInAggBlock[ind]['event'] == 'enter':
                isFirstLeave = False
                traceForwardList.append({
                    'startTime': s,
                    'endTime': min(e, end),
                    'name': currentNode.aggregatedBlockList[currentNode.fastSearchInAggBlock[ind]['index']].firstPrimitiveName,
                    'util': currentNode.aggregatedBlockList[currentNode.fastSearchInAggBlock[ind]['index']].utilization.calcUtilizationHistogram(bins, begin, end)})
            elif isFirstLeave and (e-s) > (binSize*minBinCheck) and currentNode.fastSearchInAggBlock[ind]['event'] == 'leave':
                traceForwardList.append({
                    'startTime': max(s, begin),
                    'endTime': e,
                    'name': currentNode.aggregatedBlockList[currentNode.fastSearchInAggBlock[ind]['index']].firstPrimitiveName,
                    'util': currentNode.aggregatedBlockList[currentNode.fastSearchInAggBlock[ind]['index']].utilization.calcUtilizationHistogram(bins, begin, end)})
        results = {'data': greedyIntervalAssignment(traceForwardList)}
        yield json.dumps(results)

    return StreamingResponse(traceForward(), media_type='application/json')


@router.get('/datasets/{datasetId}/getDependencyTree')
def get_dependency_tree(datasetId: str):
    datasetId = validateDataset(datasetId, requiredFiles=['otf2'], filesMustBeReady=['otf2'])

    def generateTree():
        yield json.dumps(db[datasetId]['dependencyTree'].getTheTree())

    return StreamingResponse(generateTree(), media_type='application/json')