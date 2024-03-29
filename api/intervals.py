import bisect
import copy
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


@router.get('/datasets/{datasetId}/primitives/primitiveTraceForward')
def primitive_trace_forward(datasetId: str,
                            nodeId: str,
                            bins: int = 100,
                            begin: int = None,
                            end: int = None,
                            locations: str = None,
                            dLocations: str = None):
    datasetId = validateDataset(datasetId, requiredFiles=['otf2'], filesMustBeReady=['otf2'])

    if begin is None:
        begin = db[datasetId]['info']['intervalDomain'][0]
    if end is None:
        end = db[datasetId]['info']['intervalDomain'][1]

    if locations:
        locations = locations.split(',')
    if dLocations and dLocations == 'undefined':
        dLocations = None
    if dLocations:
        dLocations = dLocations.split(',')

    def traceForward():
        dependencyTree = db[datasetId]['dependencyTree']
        currentNode = dependencyTree
        if nodeId != currentNode.nodeId:
            currentNode = find_node_in_dependency_tree(dependencyTree, nodeId)
        if currentNode is None:
            print('Node in dependency tree not found')
            yield ''
            return

        def accumulateUtilizationData(sUtil, sbin, st, en):
            array = None
            if locations:
                array = {}
                for location in locations:
                    if location in sUtil.locationDict:
                        array[location] = sUtil.calcUtilizationForLocation(sbin, st, en, location)
            else:
                array = sUtil.calcUtilizationHistogram(sbin, st, en)
            return array

        binSize = (end - begin) / bins
        aggregatedData = dict()
        allDummyLocations = list()
        for dummy_location in currentNode.aggregatedUtil.locationDict:
            allDummyLocations.append(dummy_location)
            if dLocations and str(dummy_location) not in dLocations:
                continue
            aggUtilValues = currentNode.aggregatedUtil.calcUtilizationForLocation(bins, begin, end, dummy_location, False)

            last_id = -1
            each_bin = 0
            while each_bin < bins:
                if 0 <= (int(aggUtilValues[each_bin])-1) != last_id:
                    last_id = int(aggUtilValues[each_bin]) - 1
                    if currentNode.aggregatedBlockList[last_id].endTime < begin:
                        each_bin = each_bin + 1
                        continue

                    if dummy_location not in aggregatedData:
                        aggregatedData[dummy_location] = list()

                    snappedStart = int(((each_bin - 1) * binSize) + begin)
                    snappedBins = 1
                    while each_bin < bins:
                        if 0 > (int(aggUtilValues[each_bin])-1) or (int(aggUtilValues[each_bin])-1) != last_id:
                            break
                        snappedBins = snappedBins + 1
                        each_bin = each_bin + 1
                    snappedEnd = int((each_bin * binSize) + begin)

                    aggregatedData[dummy_location].append({
                        'startTime': currentNode.aggregatedBlockList[last_id].startTime,
                        'endTime': currentNode.aggregatedBlockList[last_id].endTime,
                        'name': currentNode.aggregatedBlockList[last_id].firstPrimitiveName,
                        'util': accumulateUtilizationData(currentNode.aggregatedBlockList[last_id].utilization, snappedBins, snappedStart, snappedEnd)})
                else:
                    each_bin = each_bin + 1

        results = {'data': aggregatedData, 'locations': allDummyLocations}
        yield json.dumps(results)

    return StreamingResponse(traceForward(), media_type='application/json')


@router.get('/datasets/{datasetId}/getDependencyTree')
def get_dependency_tree(datasetId: str):
    datasetId = validateDataset(datasetId, requiredFiles=['otf2'], filesMustBeReady=['otf2'])

    def generateTree():
        yield json.dumps(db[datasetId]['dependencyTree'].getTheTree())

    return StreamingResponse(generateTree(), media_type='application/json')