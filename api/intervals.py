import json

from fastapi import APIRouter
from starlette.responses import StreamingResponse

from . import db, validateDataset

router = APIRouter()
ignoredPrimitiveList = ['output_stream_write_async_action',
                        'symbol_namespace_bind_action',
                        'symbol_namespace_on_event_action',
                        'symbol_namespace_unbind_action',
                        'async',
                        'async_launch_policy_dispatch',
                        'run_helper',
                        'primary_namespace_route_action',
                        'primary_namespace_colocate_action',
                        'background_work',
                        'update_agas_cache_action',
                        'locality_namespace_free_action',
                        'dijkstra_termination_action',
                        'phylanx_primitive_eval_action']
# ignoredPrimitiveList = []

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


# @router.get('/datasets/{datasetId}/intervals/{intervalId}/traceEnd')
# def intervalTraceToEnd(datasetId: str,
#                   intervalId: str,
#                   begin: float = None,
#                   end: float = None):
#     datasetId = validateDataset(datasetId, requiredFiles=['otf2'], filesMustBeReady=['otf2'])
#
#     if begin is None:
#         begin = db[datasetId]['info']['intervalDomain'][0]
#     if end is None:
#         end = db[datasetId]['info']['intervalDomain'][1]
#
#     def updateTimes(startTime, endTime, intervalObj):
#         return min(startTime, intervalObj['enter']['Timestamp']), max(endTime, intervalObj['leave']['Timestamp'])
#
#     def startEndTimeFinder():
#         # Start on descendants
#         intervalObj = db[datasetId]['intervals'][intervalId]
#         startTime = intervalObj['enter']['Timestamp']
#         endTime = intervalObj['leave']['Timestamp']
#         childQueue = [intervalId]
#
#         while len(childQueue) > 0:
#             intervalObj = db[datasetId]['intervals'][childQueue.pop(0)]
#             # yield any interval where itself or its child (to allow offscreen
#             # lines to the left) is in the queried range
#             yieldThisInterval = False
#             if intervalObj['leave']['Timestamp'] >= begin:
#                 yieldThisInterval = True
#             else:
#                 for childId in intervalObj['children']:
#                     if db[datasetId]['intervals'][childId]['enter']['Timestamp'] >= begin:
#                         yieldThisInterval = True
#
#             if yieldThisInterval:
#                 startTime, endTime = updateTimes(startTime, endTime, intervalObj)
#
#             # Only add children to the queue if this interval ends before the
#             # queried range does
#             if intervalObj['leave']['Timestamp'] <= end:
#                 for childId in intervalObj['children']:
#                     if not childId in childQueue:
#                         childQueue.append(childId)
#
#         # Finished
#         results = {'startTime': startTime, 'endTime': endTime}
#         yield json.dumps(results)
#
#     return StreamingResponse(startEndTimeFinder(), media_type='application/json')


@router.get('/datasets/{datasetId}/primitives/primitiveTraceForward')
def primitive_trace_forward(datasetId: str,
                            primitive: str,
                            bins: int = 100,
                            begin: int = None,
                            end: int = None,
                            locations: str = None):
    datasetId = validateDataset(datasetId, requiredFiles=['otf2'], filesMustBeReady=['otf2'])

    if begin is None:
        begin = db[datasetId]['info']['intervalDomain'][0]
    if end is None:
        end = db[datasetId]['info']['intervalDomain'][1]

    primitiveSet = set()
    if locations:
        locations = locations.split(',')
    else:
        locations = db[datasetId]['info']['locationNames']

    def traceForward():
        intervalData = dict()

        if primitive not in db[datasetId]['sparseUtilizationList']['primitives']:
            raise HTTPException(status_code=404, detail='No utilization data for primitive: %s' % primitive)
        for location in locations:
            intervalData[location] = db[datasetId]['sparseUtilizationList']['primitives'][primitive].calcUtilizationForLocation(bins, begin, end, location)

        # find all interval of this primitive within a time range (bin)
        def intervalFinder(enter, leave, location):
            intervalList = []
            for i in db[datasetId]['intervalIndex'].iterOverlap(enter, leave):
                intervalObject = db[datasetId]['intervals'][i.data]
                if location is not None and intervalObject['Location'] != location:
                    continue
                if primitive is not None and intervalObject['Primitive'] != primitive:
                    continue
                if intervalObject['enter']['Timestamp'] >= enter:
                    intervalList.append(intervalObject)
            return intervalList

        def updateTimes(startTime, endTime, intervalObject):
            return min(startTime, intervalObject['enter']['Timestamp']), max(endTime, intervalObject['leave']['Timestamp'])

        def startEndTimeFinder(intervalObject):
            # Start on descendants
            childList = list()
            startTime = intervalObject['enter']['Timestamp']
            endTime = intervalObject['leave']['Timestamp']
            childQueue = [intervalObject['intervalId']]
            # search over the child subtrees
            while len(childQueue) > 0:
                intervalObj = db[datasetId]['intervals'][childQueue.pop(0)]
                # yield any interval where itself or its child (to allow offscreen
                # lines to the left) is in the queried range
                yieldThisInterval = False
                if intervalObj['leave']['Timestamp'] >= begin and intervalObj['Primitive'] not in ignoredPrimitiveList:
                    yieldThisInterval = True
                else:
                    for childId in intervalObj['children']:
                        if db[datasetId]['intervals'][childId]['enter']['Timestamp'] >= begin and intervalObj['Primitive'] not in ignoredPrimitiveList:
                            yieldThisInterval = True
                if yieldThisInterval:
                    startTime, endTime = updateTimes(startTime, endTime, intervalObj)
                    primitiveSet.add(intervalObj['Primitive'])
                    childList.append({'enter': intervalObj['enter']['Timestamp'],
                                      'leave': intervalObj['leave']['Timestamp'],
                                      'location': intervalObj['Location']})
                # Only add children to the queue if this interval ends before the
                # queried range does
                if intervalObj['leave']['Timestamp'] <= end:
                    for childId in intervalObj['children']:
                        if childId not in childQueue:
                            childQueue.append(childId)

            return {'totalTime': {'startTime': startTime, 'endTime': endTime}, 'childList': childList}

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

        traceForwardList = list()
        childrenList = list()
        step = (end - begin) / bins
        for location in intervalData:
            currentTime = begin
            previousIntervalEndTime = currentTime - 1
            for util in intervalData[location]:
                if previousIntervalEndTime < currentTime + step and util > 0:
                    startingInterval = intervalFinder(currentTime, currentTime + step, location)
                    for intervalObj in startingInterval:
                        previousIntervalEndTime = max(previousIntervalEndTime, intervalObj['leave']['Timestamp'])
                        stEndFinderObj = startEndTimeFinder(intervalObj)
                        stEndObj = stEndFinderObj['totalTime']
                        childrenList.extend(stEndFinderObj['childList'])
                        stEndObj['location'] = location
                        traceForwardList.append(stEndObj)
                        previousIntervalEndTime = max(previousIntervalEndTime, stEndObj['endTime'])
                        # this is for to make the run faster since we are drawing in a location from the starting interval
                currentTime = currentTime + step
        # primitiveSet.discard('async_launch_policy_dispatch') # safely remove some primitive
        results = {'primitives': list(primitiveSet), 'data': greedyIntervalAssignment(traceForwardList), 'childList': childrenList}
        yield json.dumps(results)

    return StreamingResponse(traceForward(), media_type='application/json')


@router.get('/datasets/{datasetId}/getDependencyTree')
def get_dependency_tree(datasetId: str,
                        intervalId: str):
    datasetId = validateDataset(datasetId, requiredFiles=['otf2'], filesMustBeReady=['otf2'])

    primitive_set = dict()
    last_interval_id = 14113
    for id in range(last_interval_id):
        if str(id) in db[datasetId]['intervals']:
            intervalObj = db[datasetId]['intervals'][str(id)]
            if intervalObj['parent'] is None:
                if '$' in intervalObj['Primitive']:
                    if intervalObj['Primitive'] not in primitive_set:
                        primitive_set[intervalObj['Primitive']] = list()
                    primitive_set[intervalObj['Primitive']].append(str(id))
    # print(len(primitive_set))
    # print(primitive_set.keys())

    def generateTree():

        def mergeChildList(childrenList):
            flag = [False] * len(childrenList)
            compactList = list()
            for ind, child in enumerate(childrenList):
                if flag[ind] is True:
                    continue
                flag[ind] = True
                compactList.append(child)
                for otherInd, otherChild in enumerate(childrenList[ind+1:], start=ind+1):
                    if otherChild['name'] == child['name']:
                        flag[otherInd] = True
                        combinedChild = child['children'] + otherChild['children']
                        # child['children'].extend(otherChild['children'])
                        child['children'] = mergeChildList(combinedChild)
            return compactList

        def getChildren(id):
            thisNode = dict()
            intervalObj = db[datasetId]['intervals'][id]
            thisNode['name'] = intervalObj['Primitive'][11:]
            childrenList = list()
            for childId in intervalObj['children']:
                if '$' in db[datasetId]['intervals'][childId]['Primitive']:
                    childrenList.append(getChildren(childId))
            thisNode['children'] = mergeChildList(childrenList)
            return thisNode

        def mergeTwoTrees(tree1, tree2):
            thisNode = dict()
            if tree1['name'] != tree2['name']:
                print("returning from here")
                return
            thisNode['name'] = tree1['name']
            childrenList = tree1['children'] + tree2['children']
            thisNode['children'] = mergeChildList(childrenList)
            return thisNode

        pre_c = None
        current_c = None
        checked_primitive_list = ['/phylanx$0/function$0$cannon/0$49$0',
                                  '/phylanx$1/function$0$cannon/0$49$0',
                                  '/phylanx$2/function$0$cannon/0$49$0',
                                  '/phylanx$3/function$0$cannon/0$49$0']
        for prim in checked_primitive_list:
            for each_interval_id in primitive_set[prim]:
                current_c = getChildren(each_interval_id)
                if pre_c is None:
                    pre_c = current_c
                else:
                    pre_c = mergeTwoTrees(pre_c, current_c)

        results = pre_c
        # results = getChildren(intervalId)
        yield json.dumps(results)

    return StreamingResponse(generateTree(), media_type='application/json')