import copy
import uuid

from .sparseUtilizationList import SparseUtilizationList


def get_primitive_pretty_name_with_prefix(primitive: str):
    delimiter = '/'
    start = primitive.find(delimiter)
    start = primitive.find(delimiter, start+len(delimiter))
    return primitive[:start+1], primitive[start+1:]


class AggregatedBlock:
    def __init__(self, start, end):
        self.utilization = SparseUtilizationList()  # this is util for intervals
        self.isFinalized = False
        self.startTime = start
        self.endTime = end
        self.firstPrimitiveName = ''
        self.allLocations = None

    def updateStartTime(self, start):
        self.startTime = start

    def updateEndTime(self, end):
        self.endTime = end


class DependencyTreeNode:
    def __init__(self):
        self.nodeId = str(uuid.uuid4())
        self.name = 'root'
        self.children = list()  # list of DependencyTreeNode
        self.prefixList = list()  # list of string
        self.intervalList = list()  # containing just the enter and leave time of this interval, helper for creating aggreatedBlockList

        self.aggregatedUtil = SparseUtilizationList()  # this is util for aggregated blocks
        self.aggregatedBlockList = list()  # list of dictionary (start time, end time), convert it to (event, time) list later

    def isNotDummyRootNode(self):
        return self.name != 'root'

    def setName(self, primitiveName):
        pref, self.name = get_primitive_pretty_name_with_prefix(primitiveName)
        self.prefixList.append(pref)

    def addChildren(self, child):
        notFound = True
        for myChild in self.children:
            if myChild.name == child.name:
                notFound = False
                # update the children
                for otherSubChild in child.children:
                    myChild.addChildren(otherSubChild)
                # update prefixList
                for pre in child.prefixList:
                    if pre not in myChild.prefixList:
                        myChild.prefixList.append(pre)
                # update aggregatedBlockList
                myChild.aggregatedBlockList.extend(child.aggregatedBlockList)
                myChild.intervalList.extend(child.intervalList)
                break

        if notFound:
            self.children.append(child)

    def addChildrenList(self, childrenList):
        self.children.extend(childrenList)

    def resetChildrenList(self, childrenList):
        self.children.clear()
        self.children = childrenList

    def addPrefixList(self, pl):
        self.prefixList.extend(pl)

    def getTheTree(self):
        thisNode = dict()
        thisNode['nodeId'] = self.nodeId
        thisNode['name'] = self.name
        thisNode['prefixList'] = self.prefixList
        cnt = 0
        for ei in self.intervalList:
            cnt = cnt + (ei['leave'] - ei['enter'])
        thisNode['totalUtil'] = cnt
        cList = list()
        for child in self.children:
            cList.append(child.getTheTree())
        thisNode['children'] = cList
        return thisNode

    def addIntervalToIntervalList(self, startTime, endTime):
        self.intervalList.append({'enter': startTime, 'leave': endTime})

    def addIntervalToAggregatedList(self, intervalObj):
        startTime = intervalObj['enter']['Timestamp']
        endTime = intervalObj['leave']['Timestamp']
        primitive_name = intervalObj['Primitive']
        loc = intervalObj['Location']
        allLocations = set()
        allLocations.add(loc)
        ab = AggregatedBlock(startTime, endTime)

        self.intervalList.append({'enter': startTime, 'leave': endTime})
        maxTime = endTime
        for eachChild in self.children:
            aggMaxTime = endTime
            for eachAgg in eachChild.aggregatedBlockList:
                if eachAgg.endTime > aggMaxTime:
                    aggMaxTime = eachAgg.endTime
                for location, utilObj in eachAgg.utilization.locationDict.items():
                    if location not in ab.utilization.locationDict:
                        ab.utilization.locationDict[location] = list()
                    ab.utilization.locationDict[location].extend(copy.deepcopy(utilObj))
                    allLocations.add(location)
            maxTime = max(maxTime, aggMaxTime)

        ab.updateEndTime(maxTime)
        ab.firstPrimitiveName = primitive_name
        ab.utilization.setIntervalAtLocation({'index': int(startTime), 'counter': 1, 'util': 0, 'primitive': primitive_name}, loc)
        ab.utilization.setIntervalAtLocation({'index': int(endTime), 'counter': -1, 'util': 0, 'primitive': primitive_name}, loc)
        ab.allLocations = list(allLocations)
        self.aggregatedBlockList.append(ab)

    def finalizeTreeNode(self):
        locationEndTime = dict()
        self.aggregatedBlockList.sort(key=lambda x: x.startTime)
        dummyLocation = 1
        minAmongLocation = {'time': self.aggregatedBlockList[0].startTime + 1, 'location': dummyLocation}  # making sure to force into else in the for loop

        def updateMinAmongLocation():
            isFirstElement = True
            mal = dict()
            for dLocation in locationEndTime:
                if isFirstElement or mal['time'] > locationEndTime[dLocation]:
                    mal = {'time': locationEndTime[dLocation], 'location': dLocation}
                    isFirstElement = False
            return mal

        allDummyLocations = list()
        for ind, eachBlock in enumerate(self.aggregatedBlockList):
            if eachBlock.isFinalized is False:  # since the root node takes all children nodes, we need this check
                eachBlock.utilization.finalize(eachBlock.allLocations)
                eachBlock.isFinalized = True

            if minAmongLocation['time'] < eachBlock.startTime:
                self.aggregatedUtil.setIntervalAtLocation({'index': int(eachBlock.startTime), 'counter': 0, 'util': ind+1}, minAmongLocation['location'])
                self.aggregatedUtil.setIntervalAtLocation({'index': int(eachBlock.endTime), 'counter': 0, 'util': ind+1}, minAmongLocation['location'])
                locationEndTime[minAmongLocation['location']] = eachBlock.endTime
                minAmongLocation = updateMinAmongLocation()
            else:
                self.aggregatedUtil.setIntervalAtLocation({'index': int(eachBlock.startTime), 'counter': 0, 'util': ind+1}, dummyLocation)
                self.aggregatedUtil.setIntervalAtLocation({'index': int(eachBlock.endTime), 'counter': 0, 'util': ind+1}, dummyLocation)
                locationEndTime[dummyLocation] = eachBlock.endTime
                minAmongLocation = updateMinAmongLocation()
                allDummyLocations.append(dummyLocation)
                dummyLocation = dummyLocation + 1
        self.aggregatedUtil.finalize(allDummyLocations, False)

        for child in self.children:
            child.finalizeTreeNode()


def find_node_in_dependency_tree(currentNode, nodeId):
    for eachChild in currentNode.children:
        if eachChild.nodeId == nodeId:
            return eachChild
        else:
            ret = find_node_in_dependency_tree(eachChild, nodeId)
            if ret is not None:
                return ret
    return None
