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
        self.utilization = SparseUtilizationList()
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
        self.name = 'phylanx'
        self.children = list()  # list of DependencyTreeNode
        self.prefixList = list()  # list of string
        self.aggregatedBlockList = list()  # list of dictionary (start time, end time), convert it to (event, time) list later
        self.intervalList = list()  # containing just the enter and leave time of this interval, helper for creating aggreatedBlockList
        self.fastSearchInAggBlock = list()
        self.timeOnlyList = list()

    def isNotDummyRootNode(self):
        return self.name != 'phylanx'

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
        self.fastSearchInAggBlock.clear()
        self.timeOnlyList.clear()
        for ind, eachBlock in enumerate(self.aggregatedBlockList):
            if eachBlock.isFinalized is False:
                eachBlock.utilization.finalize(eachBlock.allLocations)
                eachBlock.isFinalized = True

            self.fastSearchInAggBlock.append({'time': eachBlock.startTime, 'event': 'enter', 'index': ind})
            self.fastSearchInAggBlock.append({'time': eachBlock.endTime, 'event': 'leave', 'index': ind})
        self.fastSearchInAggBlock.sort(key=lambda x: x['time'])
        self.timeOnlyList = [d['time'] for d in self.fastSearchInAggBlock]
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
